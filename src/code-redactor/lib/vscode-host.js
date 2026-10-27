/**
 * Extension host: loads VS Code extension `main` (CommonJS) in the Electron main process
 * with a vscode.* shim. Not VS Code's extension host — a Frogee-compatible runner.
 */
const { ipcMain, BrowserWindow } = require('electron');
const Module = require('module');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { createVscodeApi, Disposable, Position, Range, offsetToPosition } = require('./vscode-api');
const registry = require('./vscode-registry');

const EXT_DIR = path.join(require('os').homedir(), 'Documents', 'FrogeeCodeIDE', 'extensions');
const META = '.frogee.json';

/** @type {Map<string, { id: string, exports: any, context: any, vscode: any, commands: Map<string, Function>, dispose: Function }>} */
const active = new Map();
/** Global command registry across extensions + built-in bridges */
const globalCommands = new Map();
let uiSeq = 1;
/** @type {Map<number, { resolve: Function, reject: Function, timer: NodeJS.Timeout }>} */
const pendingUi = new Map();
/** Latest editor snapshot from the focused renderer */
let editorSnapshot = {
  path: null, name: null, text: '', selectionStart: 0, selectionEnd: 0,
  folder: null, languageId: 'plaintext', dirty: false, tabSize: 4, config: {}, version: 1,
};
let prevSnapshot = { ...editorSnapshot };

function getWindow() {
  const front = BrowserWindow.getFocusedWindow();
  if (front && !front.isDestroyed()) return front;
  const all = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  return all.length ? all[all.length - 1] : null;
}

function ui(channel, payload) {
  const win = getWindow();
  if (!win) return Promise.reject(new Error('Нет окна FrogeeCodeIDE'));
  const id = uiSeq++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingUi.delete(id);
      reject(new Error(`vscode UI timeout: ${channel}`));
    }, 120000);
    pendingUi.set(id, { resolve, reject, timer });
    win.webContents.send('vscode-ui', { id, channel, payload });
  });
}

async function executeCommand(id, ...args) {
  if (globalCommands.has(id)) return globalCommands.get(id)(...args);
  for (const ext of active.values()) {
    if (ext.commands.has(id)) return ext.commands.get(id)(...args);
  }
  // bridge a few workbench commands to the renderer
  const bridged = {
    'workbench.action.files.save': () => ui('save-active', {}),
    'workbench.action.files.saveAs': () => ui('save-as', {}),
    'workbench.action.quickOpen': () => ui('command', { id: 'quick-open' }),
    'workbench.action.showCommands': () => ui('command', { id: 'palette' }),
    'editor.action.formatDocument': () => ui('command', { id: 'format' }),
  };
  if (bridged[id]) return bridged[id]();
  throw new Error(`Команда не найдена: ${id}`);
}

function makeContext(extensionPath, storagePath) {
  const subscriptions = [];
  return {
    subscriptions,
    extensionPath,
    extensionUri: require('./vscode-api').Uri.file(extensionPath),
    storageUri: require('./vscode-api').Uri.file(storagePath),
    storagePath,
    globalStorageUri: require('./vscode-api').Uri.file(path.join(storagePath, '..', 'global')),
    globalStoragePath: path.join(storagePath, '..', 'global'),
    logUri: require('./vscode-api').Uri.file(path.join(storagePath, 'logs')),
    logPath: path.join(storagePath, 'logs'),
    extensionMode: 1, // Production
    environmentVariableCollection: { persistent: true, replace() {}, append() {}, prepend() {}, get() {}, forEach() {}, delete() {}, clear() {} },
    asAbsolutePath: (rel) => path.join(extensionPath, rel),
    secrets: {
      get: async (key) => {
        try { return JSON.parse(fs.readFileSync(path.join(storagePath, 'secrets.json'), 'utf8'))[key]; } catch { return undefined; }
      },
      store: async (key, value) => {
        await fsp.mkdir(storagePath, { recursive: true });
        let data = {};
        try { data = JSON.parse(await fsp.readFile(path.join(storagePath, 'secrets.json'), 'utf8')); } catch { /* */ }
        data[key] = value;
        await fsp.writeFile(path.join(storagePath, 'secrets.json'), JSON.stringify(data));
      },
      delete: async (key) => {
        try {
          const p = path.join(storagePath, 'secrets.json');
          const data = JSON.parse(await fsp.readFile(p, 'utf8'));
          delete data[key];
          await fsp.writeFile(p, JSON.stringify(data));
        } catch { /* */ }
      },
      onDidChange: () => Disposable(() => {}),
    },
    workspaceState: makeMemento(path.join(storagePath, 'workspace-state.json')),
    globalState: Object.assign(makeMemento(path.join(storagePath, 'global-state.json')), {
      setKeysForSync() {},
    }),
  };
}

function makeMemento(file) {
  const read = () => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
  };
  return {
    get(key, defaultValue) {
      const data = read();
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : defaultValue;
    },
    keys() { return Object.keys(read()); },
    async update(key, value) {
      await fsp.mkdir(path.dirname(file), { recursive: true });
      const data = read();
      if (value === undefined) delete data[key]; else data[key] = value;
      await fsp.writeFile(file, JSON.stringify(data));
    },
  };
}

function loadWithVscode(entryPath, vscodeApi) {
  const resolved = require.resolve(entryPath);
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === 'vscode') return vscodeApi;
    return originalLoad.apply(this, arguments);
  };
  try {
    delete require.cache[resolved];
    return require(resolved);
  } finally {
    Module._load = originalLoad;
  }
}

async function readMeta(id) {
  try {
    return JSON.parse(await fsp.readFile(path.join(EXT_DIR, id, META), 'utf8'));
  } catch { return null; }
}

async function activateExtension(meta) {
  if (!meta?.id || active.has(meta.id)) return { ok: true, already: true };
  if (!meta.codeEnabled || !meta.main) {
    return { ok: false, error: 'У расширения нет runnable main или код выключен' };
  }
  const extensionPath = path.join(EXT_DIR, meta.id);
  const entry = path.resolve(extensionPath, meta.main);
  if (!entry.startsWith(extensionPath + path.sep) && entry !== extensionPath) {
    return { ok: false, error: 'Некорректный main в package.json' };
  }
  if (!fs.existsSync(entry)) return { ok: false, error: `Нет файла ${meta.main}` };

  let pkg = {};
  try { pkg = JSON.parse(await fsp.readFile(path.join(extensionPath, 'package.json'), 'utf8')); } catch { /* */ }

  const commands = new Map();
  const host = {
    getWindow,
    ui,
    editorState: () => editorSnapshot,
    executeCommand,
    commands,
    extensionId: meta.id,
    extensionPath,
    pkg,
    exports: undefined,
  };
  const vscodeApi = createVscodeApi(host);
  const storagePath = path.join(require('os').homedir(), 'Documents', 'FrogeeCodeIDE', 'extension-storage', meta.id);
  await fsp.mkdir(storagePath, { recursive: true });
  const context = makeContext(extensionPath, storagePath);

  let mod;
  try {
    mod = loadWithVscode(entry, vscodeApi);
  } catch (err) {
    return { ok: false, error: `Не удалось загрузить: ${err.message}` };
  }
  host.exports = mod;
  try {
    if (typeof mod.activate === 'function') {
      const result = await mod.activate(context);
      host.exports = result !== undefined ? result : mod;
    }
  } catch (err) {
    for (const s of context.subscriptions) try { s.dispose?.(); } catch { /* */ }
    return { ok: false, error: `activate() упал: ${err.message}` };
  }

  // Register contributed commands that only point at activate-registered handlers
  for (const [cmdId, fn] of commands) globalCommands.set(cmdId, fn);

  // Titles from package.json contributes.commands
  for (const c of meta.commands || []) {
    if (c?.command) {
      registry.setCommandMeta(c.command, {
        title: c.title || c.command,
        category: c.category || '',
        extensionId: meta.id,
      });
    }
  }
  for (const c of (pkg.contributes?.commands || [])) {
    if (c?.command) {
      registry.setCommandMeta(c.command, {
        title: c.title || c.command,
        category: c.category || '',
        extensionId: meta.id,
      });
    }
  }

  const dispose = async () => {
    try {
      if (typeof mod.deactivate === 'function') await mod.deactivate();
    } catch (err) {
      console.warn('[vscode-host] deactivate', meta.id, err.message);
    }
    for (const s of context.subscriptions) try { s.dispose?.(); } catch { /* */ }
    for (const cmdId of commands.keys()) {
      if (globalCommands.get(cmdId) === commands.get(cmdId)) globalCommands.delete(cmdId);
    }
    registry.removeExtension(meta.id);
    active.delete(meta.id);
  };

  active.set(meta.id, { id: meta.id, exports: host.exports, context, vscode: vscodeApi, commands, dispose, displayName: meta.displayName, meta });
  return { ok: true, id: meta.id, commands: [...commands.keys()] };
}

async function deactivateExtension(id) {
  const ext = active.get(id);
  if (!ext) return { ok: true };
  await ext.dispose();
  return { ok: true };
}

function wantsEager(events) {
  if (!events?.length) return true;
  return events.includes('*')
    || events.includes('onStartupFinished')
    || events.includes('onStartup')
    || events.some((e) => e.startsWith('workspaceContains:') || e.startsWith('onView:') || e === 'onUri');
}

async function activateAll() {
  await fsp.mkdir(EXT_DIR, { recursive: true });
  const results = [];
  let names = [];
  try { names = await fsp.readdir(EXT_DIR); } catch { return results; }
  for (const name of names) {
    const meta = await readMeta(name);
    if (!meta?.codeEnabled || !meta.main) continue;
    if (!wantsEager(meta.activationEvents)) continue;
    results.push({ id: meta.id, ...(await activateExtension(meta)) });
  }
  // Also activate onLanguage for the current editor language
  if (editorSnapshot.languageId) await ensureLanguageExtension(editorSnapshot.languageId);
  return results;
}

async function ensureCommandExtension(commandId) {
  if ([...active.values()].some((e) => e.commands.has(commandId))) return;
  await fsp.mkdir(EXT_DIR, { recursive: true });
  let names = [];
  try { names = await fsp.readdir(EXT_DIR); } catch { return; }
  for (const name of names) {
    const meta = await readMeta(name);
    if (!meta?.codeEnabled || !meta.main || active.has(meta.id)) continue;
    const events = meta.activationEvents || [];
    const contributes = (meta.commands || []).some((c) => c.command === commandId);
    const wants = events.includes('*')
      || events.includes(`onCommand:${commandId}`)
      || contributes;
    if (!wants) continue;
    await activateExtension(meta);
    if ([...active.values()].some((e) => e.commands.has(commandId))) return;
  }
}

async function ensureLanguageExtension(languageId) {
  if (!languageId) return;
  const aliases = {
    js: ['javascript', 'javascriptreact'], jsx: ['javascriptreact', 'javascript'],
    ts: ['typescript', 'typescriptreact'], tsx: ['typescriptreact', 'typescript'],
    py: ['python'], sh: ['shellscript'], md: ['markdown'],
  };
  const ids = new Set([languageId, ...(aliases[languageId] || []), languageId]);
  await fsp.mkdir(EXT_DIR, { recursive: true });
  let names = [];
  try { names = await fsp.readdir(EXT_DIR); } catch { return; }
  for (const name of names) {
    const meta = await readMeta(name);
    if (!meta?.codeEnabled || !meta.main || active.has(meta.id)) continue;
    const events = meta.activationEvents || [];
    const hit = events.some((e) => {
      if (!e.startsWith('onLanguage:')) return false;
      return ids.has(e.slice('onLanguage:'.length));
    });
    if (hit || wantsEager(events)) await activateExtension(meta);
  }
}

function fireEditorEvents(next) {
  const prev = prevSnapshot;
  prevSnapshot = { ...next };
  for (const ext of active.values()) {
    const api = ext.vscode;
    if (!api?._frogee) continue;
    try {
      const doc = api._frogee.makeDocument(next);
      const editor = api._frogee.makeEditor();
      if (prev.path !== next.path || prev.name !== next.name) {
        if (doc) api._frogee.onDidOpenTextDocument.fire(doc);
        api._frogee.onDidChangeActiveTextEditor.fire(editor);
      }
      if (prev.text !== next.text && doc) {
        api._frogee.onDidChangeTextDocument.fire({
          document: doc,
          contentChanges: [{
            range: new Range(0, 0, 0, 0),
            rangeOffset: 0,
            rangeLength: 0,
            text: next.text,
          }],
          reason: undefined,
        });
      }
      if (prev.selectionStart !== next.selectionStart || prev.selectionEnd !== next.selectionEnd) {
        api._frogee.onDidChangeTextEditorSelection.fire({
          textEditor: editor,
          selections: editor ? editor.selections : [],
          kind: undefined,
        });
      }
      if (prev.dirty && !next.dirty && doc) api._frogee.onDidSaveTextDocument.fire(doc);
    } catch (err) {
      console.warn('[vscode-host] event', ext.id, err.message);
    }
  }
  if (prev.languageId !== next.languageId) ensureLanguageExtension(next.languageId).catch(() => {});
}

async function invokeProviders(kind, payload = {}) {
  const snap = { ...editorSnapshot, ...(payload.document || {}) };
  // Ensure language extensions are up
  await ensureLanguageExtension(snap.languageId);
  const anyApi = [...active.values()][0]?.vscode;
  if (!anyApi?._frogee) return [];
  const doc = anyApi._frogee.makeDocument(snap);
  if (!doc) return [];
  const list = registry.providersFor(kind, doc);
  const pos = payload.position
    ? new Position(payload.position.line || 0, payload.position.character || 0)
    : offsetToPosition(snap.text || '', snap.selectionStart || 0);
  const token = { isCancellationRequested: false, onCancellationRequested: () => Disposable(() => {}) };
  const out = [];
  for (const provider of list) {
    try {
      let result;
      if (kind === 'completion' && provider.provideCompletionItems) {
        result = await provider.provideCompletionItems(doc, pos, token, {
          triggerKind: payload.triggerKind || 0,
          triggerCharacter: payload.triggerCharacter,
        });
      } else if (kind === 'hover' && provider.provideHover) {
        result = await provider.provideHover(doc, pos, token);
      } else if (kind === 'definition' && provider.provideDefinition) {
        result = await provider.provideDefinition(doc, pos, token);
      } else if (kind === 'formatting' && provider.provideDocumentFormattingEdits) {
        result = await provider.provideDocumentFormattingEdits(doc, payload.options || { tabSize: 4, insertSpaces: true }, token);
      } else if (kind === 'rangeFormatting' && provider.provideDocumentRangeFormattingEdits) {
        const range = payload.range
          ? new Range(payload.range.start.line, payload.range.start.character, payload.range.end.line, payload.range.end.character)
          : new Range(0, 0, Math.max(0, doc.lineCount - 1), 0);
        result = await provider.provideDocumentRangeFormattingEdits(doc, range, payload.options || { tabSize: 4, insertSpaces: true }, token);
      } else if (kind === 'documentSymbol' && provider.provideDocumentSymbols) {
        result = await provider.provideDocumentSymbols(doc, token);
      } else if (kind === 'codeActions' && provider.provideCodeActions) {
        const range = payload.range
          ? new Range(payload.range.start.line, payload.range.start.character, payload.range.end.line, payload.range.end.character)
          : new Range(pos, pos);
        result = await provider.provideCodeActions(doc, range, payload.context || { diagnostics: [], only: undefined, triggerKind: 1 }, token);
      } else if (kind === 'rename' && provider.provideRenameEdits) {
        result = await provider.provideRenameEdits(doc, pos, payload.newName || 'name', token);
      }
      if (result == null) continue;
      if (Array.isArray(result)) out.push(...result);
      else if (result.items) out.push(...result.items);
      else out.push(result);
    } catch (err) {
      console.warn('[vscode-host] provider', kind, err.message);
    }
  }
  return serializeProviderResults(kind, out, snap.text || '');
}

function serializeProviderResults(kind, items, text) {
  if (kind === 'completion') {
    return items.map((it) => {
      const label = typeof it.label === 'string' ? it.label : (it.label?.label || '');
      const insert = typeof it.insertText === 'string' ? it.insertText
        : (it.insertText?.value || label);
      return {
        label,
        insertText: insert,
        detail: it.detail || '',
        kind: it.kind,
        documentation: typeof it.documentation === 'string' ? it.documentation : it.documentation?.value,
      };
    }).filter((x) => x.label);
  }
  if (kind === 'hover') {
    return items.map((h) => ({
      contents: (h.contents || []).map((c) => (typeof c === 'string' ? c : c?.value || '')).filter(Boolean),
      range: h.range ? { start: h.range.start, end: h.range.end } : null,
    }));
  }
  if (kind === 'formatting' || kind === 'rangeFormatting') {
    return items.map((e) => ({
      start: e.range ? require('./vscode-api').positionToOffset(text, e.range.start) : 0,
      end: e.range ? require('./vscode-api').positionToOffset(text, e.range.end) : 0,
      text: e.newText ?? '',
    }));
  }
  if (kind === 'definition') {
    return items.map((loc) => {
      const uri = loc.targetUri || loc.uri;
      const range = loc.targetRange || loc.targetSelectionRange || loc.range;
      return { path: uri?.fsPath || uri?.path, line: (range?.start?.line ?? 0) + 1, character: range?.start?.character ?? 0 };
    }).filter((x) => x.path);
  }
  if (kind === 'documentSymbol') {
    const flatten = (syms, acc = []) => {
      for (const s of syms || []) {
        acc.push({
          name: s.name,
          detail: s.detail || s.containerName || '',
          kind: s.kind,
          line: (s.range?.start?.line ?? s.location?.range?.start?.line ?? 0) + 1,
        });
        if (s.children?.length) flatten(s.children, acc);
      }
      return acc;
    };
    return flatten(items);
  }
  return items;
}

function listRuntime() {
  return [...active.values()].map((e) => {
    const cmds = [...e.commands.keys()].map((command) => {
      const meta = registry.getCommandMeta(command);
      return {
        command,
        title: meta?.title || command,
        category: meta?.category || '',
      };
    });
    return {
      id: e.id,
      displayName: e.displayName,
      commands: cmds.map((c) => c.command),
      commandDetails: cmds,
    };
  });
}

function registerVscodeHostIpc() {
  const handlers = {
    'vscode-host-activate-all': () => activateAll(),
    'vscode-host-activate': async (_e, id) => {
      const meta = await readMeta(id);
      if (!meta) return { ok: false, error: 'Расширение не установлено' };
      return activateExtension(meta);
    },
    'vscode-host-deactivate': (_e, id) => deactivateExtension(id),
    'vscode-host-list': () => listRuntime(),
    'vscode-host-execute': async (_e, { command, args = [] } = {}) => {
      await ensureCommandExtension(command);
      return executeCommand(command, ...args);
    },
    'vscode-host-set-editor': (_e, snap) => {
      editorSnapshot = { ...editorSnapshot, ...(snap || {}), version: (editorSnapshot.version || 0) + 1 };
      fireEditorEvents(editorSnapshot);
      return true;
    },
    'vscode-host-providers': (_e, { kind, payload } = {}) => invokeProviders(kind, payload || {}),
    'vscode-host-diagnostics': () => registry.allDiagnostics(),
    'vscode-host-commands': () => {
      const fromRuntime = listRuntime().flatMap((e) => (e.commandDetails || []).map((c) => ({ ...c, extension: e.displayName, extensionId: e.id })));
      const fromMeta = registry.allCommandMeta().filter((c) => !fromRuntime.some((r) => r.command === c.command));
      return [...fromRuntime, ...fromMeta];
    },
  };
  for (const [ch, fn] of Object.entries(handlers)) {
    try { ipcMain.removeHandler(ch); } catch { /* */ }
    ipcMain.handle(ch, async (...args) => {
      try { return await fn(...args); } catch (err) { return { ok: false, error: err.message || String(err) }; }
    });
  }

  try { ipcMain.removeHandler('vscode-ui-reply'); } catch { /* */ }
  ipcMain.on('vscode-ui-reply', (_event, msg) => {
    const pending = pendingUi.get(msg?.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingUi.delete(msg.id);
    if (msg.error) pending.reject(new Error(msg.error));
    else pending.resolve(msg.value);
  });
}

module.exports = {
  registerVscodeHostIpc,
  activateAll,
  activateExtension,
  deactivateExtension,
  executeCommand,
  listRuntime,
  ensureCommandExtension,
  ensureLanguageExtension,
  invokeProviders,
};
