import { parentPort, workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { transpileBytes } from '@bytecodealliance/jco-transpile';

const { binary, plugin, version, runtime } = workerData;
const granted = new Set(runtime.capabilities);
let effects;
let editor;

function fail(tag, val) {
  throw Object.assign(new Error(val ?? tag), { payload: { tag, val } });
}

function requireCapability(capability) {
  if (!granted.has(capability)) fail('denied', capability);
}

function position(text, offset) {
  const lines = text.slice(0, offset).split('\n');
  return { line: lines.length - 1, character: lines.at(-1).length };
}

function lineStarts(lines) {
  const starts = [0];
  for (const line of lines) starts.push(starts.at(-1) + line.length + 1);
  return starts;
}

function offset(lines, starts, point) {
  const line = lines[point.line];
  if (line === undefined || point.character > line.length) fail('invalid', 'Invalid editor range');
  return starts[point.line] + point.character;
}

class TextEditor {
  #snapshot;
  #version = 1n;

  constructor(snapshot) { this.#snapshot = snapshot; }

  path() { return this.#snapshot.path; }
  language() { return this.#snapshot.language; }

  document() {
    if (this !== editor) fail('stale');
    requireCapability('editor.read');
    return { text: this.#snapshot.text, version: this.#version };
  }

  selections() {
    if (this !== editor) fail('stale');
    requireCapability('editor.read');
    const { text, from, to } = this.#snapshot;
    return [{ start: position(text, from), end: position(text, to) }];
  }

  setSelections(ranges) {
    if (this !== editor) fail('stale');
    const range = ranges[0];
    if (!range) return;
    const lines = this.#snapshot.text.split('\n');
    const starts = lineStarts(lines);
    this.#snapshot.from = offset(lines, starts, range.start);
    this.#snapshot.to = offset(lines, starts, range.end);
    effects.selection = { from: this.#snapshot.from, to: this.#snapshot.to };
  }

  reveal(range) { this.setSelections([range]); }

  applyEdits(version, edits) {
    requireCapability('editor.write');
    if (this !== editor || version !== this.#version) fail('stale');
    if (edits.length > 10000) fail('invalid', 'Too many edits');
    const { text } = this.#snapshot;
    const lines = text.split('\n');
    const starts = lineStarts(lines);
    const ordered = edits.map((edit) => ({
      from: offset(lines, starts, edit.range.start), to: offset(lines, starts, edit.range.end), text: edit.text,
    })).sort((a, b) => a.from - b.from);
    let cursor = 0;
    let next = '';
    for (const edit of ordered) {
      if (edit.from < cursor || edit.to < edit.from) fail('invalid', 'Overlapping or inverted editor ranges');
      next += text.slice(cursor, edit.from) + edit.text;
      cursor = edit.to;
      if (next.length > 2_000_000) fail('invalid', 'Editor result is too large');
    }
    next += text.slice(cursor);
    if (next.length > 2_000_000) fail('invalid', 'Editor result is too large');
    this.#snapshot.text = next;
    this.#snapshot.from = Math.min(this.#snapshot.from, next.length);
    this.#snapshot.to = Math.min(this.#snapshot.to, next.length);
    effects.text = next;
    this.#version += 1n;
    return this.#version;
  }
}

class Invocation {
  project() { return undefined; }
  editor() { return editor; }
  selectedPaths() { return []; }
}

class Pollable {
  ready() { return true; }
  block() {}
}

class InputStream {
  read() { throw { tag: 'closed' }; }
  blockingRead() { return this.read(); }
  subscribe() { return new Pollable(); }
}

class OutputStream {
  checkWrite() { return 65536n; }
  write() {}
  flush() {}
  blockingWriteAndFlush() {}
  blockingFlush() {}
  subscribe() { return new Pollable(); }
}

class TerminalInput {}
class TerminalOutput {}
const noTerminal = () => undefined;
const now = () => process.hrtime.bigint();

const imports = {
  'openidea:plugin/editor': { TextEditor },
  'openidea:plugin/invocation': { Invocation },
  'openidea:plugin/settings': { get: (key) => Object.hasOwn(runtime.settings, key) ? runtime.settings[key] : undefined },
  'openidea:plugin/views': { postMessage: (view, text) => {
    if (!runtime.views.some((entry) => entry.id === view) || text.length > 2_000_000 || effects.messages.length >= 20) {
      fail('invalid', 'Invalid tool view message');
    }
    effects.messages.push({ view, text });
  } },
  'openidea:plugin/log': { log: () => {} },
  'openidea:plugin/ui': { showNotification: (_level, title, body) => {
    if (effects.notices.length < 10) effects.notices.push((title + '\n' + body).slice(0, 1500));
  } },
  'wasi:cli/environment': { getEnvironment: () => [], getArguments: () => [], initialCwd: () => undefined },
  'wasi:cli/exit': { exit: () => { throw new Error('OpenIDEA plugin exited'); } },
  'wasi:cli/stdin': { getStdin: () => new InputStream() },
  'wasi:cli/stdout': { getStdout: () => new OutputStream() },
  'wasi:cli/stderr': { getStderr: () => new OutputStream() },
  'wasi:cli/terminal-input': { TerminalInput },
  'wasi:cli/terminal-output': { TerminalOutput },
  'wasi:cli/terminal-stdin': { getTerminalStdin: noTerminal },
  'wasi:cli/terminal-stdout': { getTerminalStdout: noTerminal },
  'wasi:cli/terminal-stderr': { getTerminalStderr: noTerminal },
  'wasi:clocks/monotonic-clock': {
    now, resolution: () => 1n, subscribeDuration: () => new Pollable(), subscribeInstant: () => new Pollable(),
  },
  'wasi:clocks/wall-clock': {
    now: () => ({ seconds: BigInt(Math.floor(Date.now() / 1000)), nanoseconds: (Date.now() % 1000) * 1_000_000 }),
    resolution: () => ({ seconds: 0n, nanoseconds: 1_000_000 }),
  },
  'wasi:io/error': { Error },
  'wasi:io/poll': { Pollable, poll: (items) => Uint32Array.from(items.keys()) },
  'wasi:io/streams': { InputStream, OutputStream },
  'wasi:random/insecure-seed': { insecureSeed: () => [randomBytes(8).readBigUInt64LE(), randomBytes(8).readBigUInt64LE()] },
};

function envelope() { return { notices: [], messages: [] }; }

let component;
try {
  const build = await transpileBytes(await readFile(binary), {
    name: 'plugin', instantiation: 'async', nodejsCompat: false,
    emitTypescriptDeclarations: false, base64Cutoff: 0, bindgenEnableWasmExnref: false,
  });
  const unsupported = build.imports.filter((id) => !Object.hasOwn(imports, id));
  if (unsupported.length) throw new Error('Unsupported OpenIDEA imports: ' + unsupported.join(', '));
  const entry = 'data:text/javascript;base64,' + Buffer.from(build.files['plugin.js']).toString('base64');
  const { instantiate } = await import(entry);
  component = await instantiate((name) => WebAssembly.compile(build.files[name]), imports);
  effects = envelope();
  await component.lifecycle.activate({ pluginId: plugin, pluginVersion: version, apiVersion: '1.15', capabilities: [...granted] });
  parentPort.postMessage({ ready: true });
} catch (error) {
  parentPort.postMessage({ error: describe(error) });
  parentPort.close();
}

function describe(error) {
  return String(error?.payload?.val || error?.message || error?.payload?.tag || 'OpenIDEA component error').slice(0, 1500);
}

if (component) parentPort.on('message', async ({ operation, name, value, snapshot }) => {
  effects = envelope();
  editor = snapshot && new TextEditor(snapshot);
  try {
    const invocation = new Invocation();
    if (operation === 'command') effects.notice = (await component.commands.run(name, invocation, value))?.slice(0, 1500);
    if (operation === 'render') {
      if (!component.viewProvider) throw new Error('The plugin exports no tool views');
      const view = await component.viewProvider.render(name, undefined, invocation);
      if (view.body.tag === 'html' && view.body.val.length > 1_000_000) throw new Error('OpenIDEA tool view is too large');
      effects.view = view;
    }
    if (operation === 'event') await component.viewProvider.handle(name, value, invocation);
    parentPort.postMessage(effects);
  } catch (error) {
    parentPort.postMessage({ error: describe(error) });
  } finally {
    effects = undefined;
    editor = undefined;
  }
});
