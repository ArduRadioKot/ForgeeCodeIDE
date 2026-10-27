/**
 * Lightweight vscode.* shim for running Open VSX extension `main` in the Electron main process.
 * Not a copy of VS Code's extension host — a subset of the public API bridged to FrogeeCodeIDE.
 */
const { EventEmitter: NodeEventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { dialog } = require('electron');
const registry = require('./vscode-registry');

function Disposable(fn) {
  let done = false;
  return { dispose() { if (done) return; done = true; try { fn?.(); } catch { /* ignore */ } } };
}
Disposable.from = (...items) => Disposable(() => { for (const i of items) try { i?.dispose?.(); } catch { /* ignore */ } });

class Emitter {
  constructor() { this._ee = new NodeEventEmitter(); this._ee.setMaxListeners(50); }
  get event() {
    return (listener, thisArgs, disposables) => {
      const fn = thisArgs ? listener.bind(thisArgs) : listener;
      this._ee.on('e', fn);
      const d = Disposable(() => this._ee.off('e', fn));
      if (Array.isArray(disposables)) disposables.push(d);
      return d;
    };
  }
  fire(data) { this._ee.emit('e', data); }
  dispose() { this._ee.removeAllListeners(); }
}

class Uri {
  constructor(scheme, authority, pathName, query = '', fragment = '') {
    this.scheme = scheme;
    this.authority = authority || '';
    this.path = pathName || '';
    this.query = query || '';
    this.fragment = fragment || '';
  }
  get fsPath() {
    if (this.scheme !== 'file') return this.path;
    if (process.platform === 'win32' && /^\/[A-Za-z]:/.test(this.path)) return this.path.slice(1).replace(/\//g, '\\');
    return this.path;
  }
  toString(skipEncoding) {
    const auth = this.authority ? '//' + this.authority : (this.scheme === 'file' ? '//' : '');
    let p = this.path || '';
    if (!skipEncoding) p = p.split('/').map(encodeURIComponent).join('/').replace(/%3A/gi, ':');
    return `${this.scheme}:${auth}${p}${this.query ? '?' + this.query : ''}${this.fragment ? '#' + this.fragment : ''}`;
  }
  with(change = {}) {
    return new Uri(
      change.scheme ?? this.scheme,
      change.authority ?? this.authority,
      change.path ?? this.path,
      change.query ?? this.query,
      change.fragment ?? this.fragment,
    );
  }
  static file(p) {
    let norm = path.resolve(String(p || '')).replace(/\\/g, '/');
    if (!norm.startsWith('/')) norm = '/' + norm;
    return new Uri('file', '', norm);
  }
  static parse(value) {
    try {
      const u = new URL(String(value));
      return new Uri(u.protocol.replace(/:$/, ''), u.hostname, decodeURIComponent(u.pathname), u.search.slice(1), u.hash.slice(1));
    } catch {
      return Uri.file(String(value));
    }
  }
  static joinPath(base, ...parts) {
    const joined = path.posix.join(base.path || '/', ...parts.map(String));
    return base.with({ path: joined });
  }
}

class Position {
  constructor(line, character) { this.line = line | 0; this.character = character | 0; }
  isBefore(other) { return this.line < other.line || (this.line === other.line && this.character < other.character); }
  isAfter(other) { return other.isBefore(this); }
  isEqual(other) { return this.line === other.line && this.character === other.character; }
  translate(lineDelta = 0, characterDelta = 0) {
    if (typeof lineDelta === 'object') return this.translate(lineDelta.lineDelta || 0, lineDelta.characterDelta || 0);
    return new Position(this.line + lineDelta, this.character + characterDelta);
  }
  with(line = this.line, character = this.character) {
    if (typeof line === 'object') return this.with(line.line ?? this.line, line.character ?? this.character);
    return new Position(line, character);
  }
}

class Range {
  constructor(a, b, c, d) {
    if (a instanceof Position) {
      this.start = a;
      this.end = b instanceof Position ? b : new Position(b, c);
    } else {
      this.start = new Position(a, b);
      this.end = new Position(c, d);
    }
    if (this.end.isBefore(this.start)) { const t = this.start; this.start = this.end; this.end = t; }
  }
  get isEmpty() { return this.start.isEqual(this.end); }
  get isSingleLine() { return this.start.line === this.end.line; }
  contains(x) {
    if (x instanceof Range) return this.contains(x.start) && this.contains(x.end);
    return !x.isBefore(this.start) && !x.isAfter(this.end);
  }
  isEqual(other) { return this.start.isEqual(other.start) && this.end.isEqual(other.end); }
  intersection(other) {
    const start = this.start.isAfter(other.start) ? this.start : other.start;
    const end = this.end.isBefore(other.end) ? this.end : other.end;
    return start.isAfter(end) ? undefined : new Range(start, end);
  }
  union(other) {
    const start = this.start.isBefore(other.start) ? this.start : other.start;
    const end = this.end.isAfter(other.end) ? this.end : other.end;
    return new Range(start, end);
  }
  with(start = this.start, end = this.end) {
    if (typeof start === 'object' && !(start instanceof Position)) return this.with(start.start ?? this.start, start.end ?? this.end);
    return new Range(start, end);
  }
}

class Selection extends Range {
  constructor(a, b, c, d) {
    super(a, b, c, d);
    this.anchor = this.start;
    this.active = this.end;
  }
  get isReversed() { return this.active.isBefore(this.anchor); }
}

class EventEmitter {
  constructor() { this._inner = new Emitter(); }
  get event() { return this._inner.event; }
  fire(data) { this._inner.fire(data); }
  dispose() { this._inner.dispose(); }
}

class CancellationTokenSource {
  constructor() {
    this._cancelled = false;
    this._onCancel = new Emitter();
    const self = this;
    this.token = {
      get isCancellationRequested() { return self._cancelled; },
      onCancellationRequested: this._onCancel.event,
    };
  }
  cancel() { if (this._cancelled) return; this._cancelled = true; this._onCancel.fire(); }
  dispose() { this.cancel(); this._onCancel.dispose(); }
}

class ThemeColor { constructor(id) { this.id = id; } }
class ThemeIcon {
  constructor(id, color) { this.id = id; this.color = color; }
  static get File() { return new ThemeIcon('file'); }
  static get Folder() { return new ThemeIcon('folder'); }
}
class MarkdownString {
  constructor(value = '', supportThemeIcons = false) {
    this.value = value;
    this.supportThemeIcons = supportThemeIcons;
    this.isTrusted = false;
    this.supportHtml = false;
  }
  appendText(t) { this.value += String(t).replace(/[\\`*_{}[\]()#+\-.!]/g, '\\$&'); return this; }
  appendMarkdown(md) { this.value += String(md); return this; }
  appendCodeblock(lang, code) { this.value += `\n\`\`\`${lang || ''}\n${code}\n\`\`\`\n`; return this; }
}
class SnippetString {
  constructor(value = '') { this.value = String(value); }
  appendText(t) { this.value += String(t).replace(/\$|\\/g, '\\$&'); return this; }
  appendTabstop(n = 0) { this.value += `$${n}`; return this; }
  appendPlaceholder(value, n = 1) {
    this.value += typeof value === 'function' ? `\${${n}:}` : `\${${n}:${value}}`;
    return this;
  }
  appendChoice(values, n = 1) { this.value += `\${${n}|${values.join(',')}|}`; return this; }
  appendVariable(name, defaultValue) {
    this.value += defaultValue != null ? `\${${name}:${defaultValue}}` : `$${name}`;
    return this;
  }
}
class RelativePattern {
  constructor(base, pattern) {
    this.base = typeof base === 'string' ? base : (base?.fsPath || base?.path || '');
    this.baseUri = typeof base === 'string' ? Uri.file(base) : (base?.scheme ? base : Uri.file(this.base));
    this.pattern = pattern;
  }
}

const EndOfLine = { LF: 1, CRLF: 2 };
const StatusBarAlignment = { Left: 1, Right: 2 };
const ViewColumn = { Active: -1, Beside: -2, One: 1, Two: 2, Three: 3 };
const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 };
const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
const ProgressLocation = { SourceControl: 1, Window: 10, Notification: 15 };
const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };
const TextEditorRevealType = { Default: 0, InCenter: 1, InCenterIfOutsideViewport: 2, AtTop: 3 };
const ExtensionKind = { UI: 1, Workspace: 2 };
const UIKind = { Desktop: 1, Web: 2 };
const TextEditorSelectionChangeKind = { Keyboard: 1, Mouse: 2, Command: 3 };
const TextDocumentChangeReason = { Undo: 1, Redo: 2 };
const CompletionTriggerKind = { Invoke: 0, TriggerCharacter: 1, TriggerForIncompleteCompletions: 2 };
const SymbolKind = {
  File: 0, Module: 1, Namespace: 2, Package: 3, Class: 4, Method: 5, Property: 6, Field: 7,
  Constructor: 8, Enum: 9, Interface: 10, Function: 11, Variable: 12, Constant: 13, String: 14,
  Number: 15, Boolean: 16, Array: 17, Object: 18, Key: 19, Null: 20, EnumMember: 21, Struct: 22,
  Event: 23, Operator: 24, TypeParameter: 25,
};
const CodeActionKind = {
  Empty: '', QuickFix: 'quickfix', Refactor: 'refactor', RefactorExtract: 'refactor.extract',
  RefactorInline: 'refactor.inline', RefactorRewrite: 'refactor.rewrite', Source: 'source',
  SourceOrganizeImports: 'source.organizeImports', SourceFixAll: 'source.fixAll',
};
const FoldingRangeKind = { Comment: 1, Imports: 2, Region: 3 };
const OverviewRulerLane = { Left: 1, Center: 2, Right: 4, Full: 7 };
const Decoration = { };
const TerminalLocation = { Panel: 1, Editor: 2 };

function globToRegExp(pattern) {
  const p = String(pattern || '*').replace(/\\/g, '/');
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*' && p[i + 1] === '*') {
      re += '.*';
      i++;
      if (p[i + 1] === '/') i++;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if ('+.^${}()|[]\\'.includes(c)) re += '\\' + c;
    else re += c;
  }
  return new RegExp('^' + re + '$', 'i');
}

async function walkFindFiles(root, includeRe, excludeRe, maxResults, out) {
  if (out.length >= maxResults) return;
  let ents;
  try { ents = await fsp.readdir(root, { withFileTypes: true }); } catch { return; }
  for (const ent of ents) {
    if (out.length >= maxResults) return;
    if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === '.venv' || ent.name === 'dist') continue;
    const full = path.join(root, ent.name);
    const rel = full.slice(root.length).replace(/\\/g, '/').replace(/^\//, '');
    // For RelativePattern, root is base; match against relative or basename
    if (ent.isDirectory()) {
      await walkFindFiles(full, includeRe, excludeRe, maxResults, out);
    } else {
      const name = ent.name;
      const ok = includeRe.test(rel) || includeRe.test(name) || includeRe.test(full.replace(/\\/g, '/'));
      if (!ok) continue;
      if (excludeRe && (excludeRe.test(rel) || excludeRe.test(name))) continue;
      out.push(Uri.file(full));
    }
  }
}

function offsetToPosition(text, offset) {
  const slice = text.slice(0, Math.max(0, offset));
  const lines = slice.split('\n');
  return new Position(lines.length - 1, lines[lines.length - 1].length);
}
function positionToOffset(text, pos) {
  const lines = text.split('\n');
  let off = 0;
  for (let i = 0; i < pos.line && i < lines.length; i++) off += lines[i].length + 1;
  return off + Math.min(pos.character, (lines[pos.line] || '').length);
}

/**
 * @param {object} host
 * @param {() => import('electron').BrowserWindow | null} host.getWindow
 * @param {(ch: string, payload: any) => Promise<any>} host.ui  ask renderer
 * @param {() => object} host.editorState  { path, name, text, selectionStart, selectionEnd, folder }
 * @param {(cmd: string, ...args: any[]) => Promise<any>} host.executeCommand
 * @param {Map<string, Function>} host.commands
 * @param {string} host.extensionId
 * @param {string} host.extensionPath
 * @param {object} host.pkg
 */
function createVscodeApi(host) {
  const outputChannels = new Map();
  const statusItems = [];
  const onDidChangeConfig = new Emitter();
  const onDidChangeWorkspaceFolders = new Emitter();
  const onDidOpenTextDocument = new Emitter();
  const onDidChangeTextDocument = new Emitter();
  const onDidSaveTextDocument = new Emitter();
  const onDidChangeActiveTextEditor = new Emitter();
  const onDidChangeTextEditorSelection = new Emitter();

  function workspaceFolders() {
    const folder = host.editorState()?.folder;
    if (!folder) return undefined;
    const uri = Uri.file(folder);
    return [{ uri, name: path.basename(folder), index: 0 }];
  }

  function makeDocument(state) {
    if (!state) return undefined;
    const uri = state.path ? Uri.file(state.path) : Uri.parse(`untitled:${state.name || 'Untitled'}`);
    const text = state.text ?? '';
    return {
      uri,
      fileName: state.path || state.name || 'Untitled',
      isUntitled: !state.path,
      languageId: state.languageId || 'plaintext',
      version: state.version || 1,
      isDirty: !!state.dirty,
      isClosed: false,
      eol: EndOfLine.LF,
      lineCount: text.split('\n').length,
      getText(range) {
        if (!range) return text;
        return text.slice(positionToOffset(text, range.start), positionToOffset(text, range.end));
      },
      lineAt(lineOrPos) {
        const line = typeof lineOrPos === 'number' ? lineOrPos : lineOrPos.line;
        const lines = text.split('\n');
        const value = lines[line] ?? '';
        return {
          lineNumber: line,
          text: value,
          range: new Range(line, 0, line, value.length),
          rangeIncludingLineBreak: new Range(line, 0, line, value.length + (line < lines.length - 1 ? 1 : 0)),
          firstNonWhitespaceCharacterIndex: value.search(/\S|$/),
          isEmptyOrWhitespace: !/\S/.test(value),
        };
      },
      offsetAt: (pos) => positionToOffset(text, pos),
      positionAt: (off) => offsetToPosition(text, off),
      validateRange: (r) => r,
      validatePosition: (p) => p,
      getWordRangeAtPosition(pos) {
        const line = text.split('\n')[pos.line] || '';
        const m = line.slice(0, pos.character).match(/[A-Za-z0-9_$]+$/) || { 0: '', index: pos.character };
        const start = m.index;
        const endMatch = line.slice(pos.character).match(/^[A-Za-z0-9_$]*/);
        const end = pos.character + (endMatch ? endMatch[0].length : 0);
        if (start === end) return undefined;
        return new Range(pos.line, start, pos.line, end);
      },
      save: async () => { await host.ui('save-active', {}); return true; },
    };
  }

  function makeEditor() {
    const state = host.editorState();
    const doc = makeDocument(state);
    if (!doc) return undefined;
    const text = state.text ?? '';
    const selStart = offsetToPosition(text, state.selectionStart || 0);
    const selEnd = offsetToPosition(text, state.selectionEnd || 0);
    const selection = new Selection(selStart, selEnd);
    return {
      document: doc,
      selection,
      selections: [selection],
      visibleRanges: [new Range(0, 0, Math.max(0, doc.lineCount - 1), 0)],
      options: { tabSize: state.tabSize || 4, insertSpaces: true },
      viewColumn: ViewColumn.One,
      edit: async (callback) => {
        const edits = [];
        const editBuilder = {
          replace(range, value) { edits.push({ range, value: String(value) }); },
          insert(pos, value) { edits.push({ range: new Range(pos, pos), value: String(value) }); },
          delete(range) { edits.push({ range, value: '' }); },
          setEndOfLine() {},
        };
        callback(editBuilder);
        await host.ui('apply-edits', { edits: edits.map((e) => ({
          start: positionToOffset(text, e.range.start),
          end: positionToOffset(text, e.range.end),
          text: e.value,
        })) });
        return true;
      },
      insertSnippet: async (snippet) => {
        const body = typeof snippet === 'string' ? snippet : snippet?.value || '';
        await host.ui('insert-text', { text: body.replace(/\$\{\d+:([^}]*)\}/g, '$1').replace(/\$\d+/g, '') });
        return true;
      },
      setDecorations(decorationType, rangesOrOptions) {
        const key = decorationType?.key || decorationType;
        const ranges = (rangesOrOptions || []).map((r) => {
          const range = r.range || r;
          return {
            startLine: range.start?.line ?? 0,
            startCharacter: range.start?.character ?? 0,
            endLine: range.end?.line ?? 0,
            endCharacter: range.end?.character ?? 0,
            hoverMessage: typeof r.hoverMessage === 'string' ? r.hoverMessage : r.hoverMessage?.value,
          };
        });
        host.ui('decorations', { key, ranges }).catch(() => {});
      },
      revealRange(range) {
        host.ui('reveal-line', { line: (range?.start?.line ?? 0) + 1 }).catch(() => {});
      },
      show() {},
      hide() {},
    };
  }

  function makeWebview(hostRef, id, options = {}) {
    let html = '';
    const onDidReceiveMessage = new Emitter();
    return {
      get html() { return html; },
      set html(v) {
        html = String(v || '');
        hostRef.ui('webview-html', { id, html, enableScripts: options.enableScripts !== false }).catch(() => {});
      },
      options,
      cspSource: "file:",
      asWebviewUri: (uri) => uri,
      postMessage: async (msg) => { hostRef.ui('webview-post', { id, message: msg }).catch(() => {}); return true; },
      onDidReceiveMessage: onDidReceiveMessage.event,
      _receive(msg) { onDidReceiveMessage.fire(msg); },
    };
  }

  function configProxy(section) {
    const read = () => host.editorState()?.config || {};
    return {
      get(key, defaultValue) {
        const all = read();
        const full = section ? `${section}.${key}` : key;
        const parts = full.split('.');
        let cur = all;
        for (const p of parts) {
          if (cur && typeof cur === 'object' && p in cur) cur = cur[p];
          else return defaultValue;
        }
        return cur === undefined ? defaultValue : cur;
      },
      has(key) { return this.get(key) !== undefined; },
      inspect(key) { return { key, defaultValue: undefined, globalValue: this.get(key), workspaceValue: undefined }; },
      async update() { /* Frogee settings are not a full VS Code config store */ },
    };
  }

  const vscode = {
    version: '1.85.0',
    Disposable, EventEmitter, ThemeColor, ThemeIcon, MarkdownString, SnippetString,
    Uri, Position, Range, Selection, RelativePattern, CancellationTokenSource,
    EndOfLine, StatusBarAlignment, ViewColumn, DiagnosticSeverity, TreeItemCollapsibleState,
    ProgressLocation, ConfigurationTarget, TextEditorRevealType, ExtensionKind, UIKind,
    TextEditorSelectionChangeKind, TextDocumentChangeReason, CompletionTriggerKind,
    SymbolKind, CodeActionKind, FoldingRangeKind, OverviewRulerLane, TerminalLocation,

    commands: {
      registerCommand(id, callback, thisArg) {
        const fn = thisArg ? callback.bind(thisArg) : callback;
        host.commands.set(id, fn);
        return Disposable(() => { if (host.commands.get(id) === fn) host.commands.delete(id); });
      },
      registerTextEditorCommand(id, callback, thisArg) {
        return vscode.commands.registerCommand(id, (...args) => {
          const editor = makeEditor();
          if (!editor) return;
          return (thisArg ? callback.bind(thisArg) : callback)(editor, editor.edit.bind(editor), ...args);
        });
      },
      executeCommand: (id, ...args) => host.executeCommand(id, ...args),
      getCommands: async (filterInternal) => {
        const ids = [...host.commands.keys()];
        return filterInternal ? ids.filter((c) => !c.startsWith('_')) : ids;
      },
    },

    window: {
      get activeTextEditor() { return makeEditor(); },
      get visibleTextEditors() { const e = makeEditor(); return e ? [e] : []; },
      get activeTerminal() { return undefined; },
      get terminals() { return []; },
      showInformationMessage: (msg, ...items) => host.ui('message', { type: 'info', message: String(msg), items: items.filter((i) => typeof i === 'string') }),
      showWarningMessage: (msg, ...items) => host.ui('message', { type: 'warn', message: String(msg), items: items.filter((i) => typeof i === 'string') }),
      showErrorMessage: (msg, ...items) => host.ui('message', { type: 'error', message: String(msg), items: items.filter((i) => typeof i === 'string') }),
      showQuickPick: async (items, options = {}) => host.ui('quick-pick', {
        items: (await Promise.resolve(items)).map((i) => (typeof i === 'string' ? { label: i } : i)),
        placeholder: options.placeHolder || options.placeholder || '',
        canPickMany: !!options.canPickMany,
      }),
      showInputBox: (options = {}) => host.ui('input-box', {
        prompt: options.prompt || '',
        placeHolder: options.placeHolder || '',
        value: options.value || '',
        password: !!options.password,
      }),
      showOpenDialog: async (options = {}) => {
        const win = host.getWindow();
        const res = await dialog.showOpenDialog(win || undefined, {
          title: options.openLabel,
          properties: [
            ...(options.canSelectFiles !== false ? ['openFile'] : []),
            ...(options.canSelectFolders ? ['openDirectory'] : []),
            ...(options.canSelectMany ? ['multiSelections'] : []),
          ].filter(Boolean),
          defaultPath: options.defaultUri?.fsPath,
          filters: (options.filters || []).map((f) => ({ name: f.name, extensions: f.extensions || ['*'] })),
        });
        if (res.canceled) return undefined;
        return res.filePaths.map((p) => Uri.file(p));
      },
      showSaveDialog: async (options = {}) => {
        const win = host.getWindow();
        const res = await dialog.showSaveDialog(win || undefined, {
          defaultPath: options.defaultUri?.fsPath,
          filters: (options.filters || []).map((f) => ({ name: f.name, extensions: f.extensions || ['*'] })),
        });
        return res.canceled ? undefined : Uri.file(res.filePath);
      },
      createOutputChannel(name) {
        const lines = [];
        const ch = {
          name,
          append(v) { lines.push(String(v)); },
          appendLine(v) { lines.push(String(v) + '\n'); },
          clear() { lines.length = 0; },
          show() { host.ui('output', { name, text: lines.join('') }).catch(() => {}); },
          hide() {},
          dispose() { outputChannels.delete(name); },
          replace(v) { lines.length = 0; lines.push(String(v)); },
        };
        outputChannels.set(name, ch);
        return ch;
      },
      createStatusBarItem(alignment, priority) {
        const item = {
          alignment: typeof alignment === 'number' ? alignment : StatusBarAlignment.Left,
          priority: priority || 0,
          text: '',
          tooltip: undefined,
          command: undefined,
          color: undefined,
          backgroundColor: undefined,
          name: undefined,
          show() { host.ui('status-bar', { id: item._id, text: item.text, tooltip: item.tooltip, show: true }).catch(() => {}); },
          hide() { host.ui('status-bar', { id: item._id, show: false }).catch(() => {}); },
          dispose() {
            item.hide();
            const i = statusItems.indexOf(item);
            if (i >= 0) statusItems.splice(i, 1);
          },
          _id: `sb-${statusItems.length}-${Date.now()}`,
        };
        statusItems.push(item);
        return item;
      },
      createTextEditorDecorationType(options = {}) {
        const key = `dec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        host.ui('decoration-type', { key, options }).catch(() => {});
        return {
          key,
          dispose() { host.ui('decoration-type', { key, dispose: true }).catch(() => {}); },
        };
      },
      withProgress: async (options, task) => {
        const title = options?.title || 'Работаю…';
        await host.ui('toast', { text: title }).catch(() => {});
        const progress = {
          report(value) {
            if (value?.message) host.ui('toast', { text: `${title}: ${value.message}` }).catch(() => {});
          },
        };
        const cts = new CancellationTokenSource();
        try { return await task(progress, cts.token); } finally { cts.dispose(); }
      },
      showTextDocument: async (docOrUri, _column, _preserve) => {
        const uri = docOrUri?.uri || docOrUri;
        const fsPath = uri?.fsPath || (typeof docOrUri === 'string' ? docOrUri : '');
        if (fsPath) await host.ui('open-file', { path: fsPath });
        return makeEditor();
      },
      setStatusBarMessage: (text, hideAfter) => {
        host.ui('toast', { text: String(text) }).catch(() => {});
        const d = Disposable(() => {});
        if (typeof hideAfter === 'number') setTimeout(() => d.dispose(), hideAfter);
        return d;
      },
      onDidChangeActiveTextEditor: onDidChangeActiveTextEditor.event,
      onDidChangeTextEditorSelection: onDidChangeTextEditorSelection.event,
      onDidChangeVisibleTextEditors: new Emitter().event,
      onDidChangeActiveTerminal: new Emitter().event,
      onDidOpenTerminal: new Emitter().event,
      onDidCloseTerminal: new Emitter().event,
      createTerminal(nameOrOptions) {
        const name = typeof nameOrOptions === 'string' ? nameOrOptions : (nameOrOptions?.name || 'Terminal');
        const cwd = typeof nameOrOptions === 'object' ? nameOrOptions?.cwd : undefined;
        const term = {
          name,
          processId: Promise.resolve(undefined),
          creationOptions: nameOrOptions,
          exitStatus: undefined,
          state: { isInteractedWith: false },
          sendText(text, addNewLine = true) {
            host.ui('terminal-write', { text: addNewLine && !text.endsWith('\n') ? text + '\n' : text, cwd: cwd?.fsPath || cwd }).catch(() => {});
          },
          show() { host.ui('terminal-show', {}).catch(() => {}); },
          hide() {},
          dispose() {},
        };
        return term;
      },
      registerTreeDataProvider(viewId, provider) {
        host.ui('tree-register', { viewId, extensionId: host.extensionId }).catch(() => {});
        return Disposable(() => {});
      },
      createTreeView(viewId, options = {}) {
        const onDidChangeVisibility = new Emitter();
        host.ui('tree-register', { viewId, extensionId: host.extensionId }).catch(() => {});
        return {
          onDidChangeVisibility: onDidChangeVisibility.event,
          onDidChangeSelection: new Emitter().event,
          onDidExpandElement: new Emitter().event,
          onDidCollapseElement: new Emitter().event,
          selection: [],
          visible: false,
          title: options?.title,
          message: undefined,
          badge: undefined,
          reveal: async () => {},
          dispose() { onDidChangeVisibility.dispose(); },
        };
      },
      registerWebviewViewProvider(viewId, provider) {
        // Resolve once into a side panel when Frogee asks — best-effort
        Promise.resolve().then(async () => {
          try {
            const webviewView = {
              webview: makeWebview(host, viewId),
              viewType: viewId,
              title: viewId,
              description: undefined,
              visible: true,
              onDidDispose: new Emitter().event,
              onDidChangeVisibility: new Emitter().event,
              show() {},
            };
            await provider.resolveWebviewView?.(webviewView, { state: undefined }, new CancellationTokenSource().token);
          } catch (err) {
            console.warn('[vscode] webview view', viewId, err.message);
          }
        });
        return Disposable(() => {});
      },
      createWebviewPanel(viewType, title, _showOptions, options = {}) {
        const id = `wv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const webview = makeWebview(host, id, options);
        host.ui('webview-open', { id, viewType, title, html: '' }).catch(() => {});
        const onDidDispose = new Emitter();
        const panel = {
          viewType,
          title,
          webview,
          active: true,
          visible: true,
          viewColumn: ViewColumn.Beside,
          onDidDispose: onDidDispose.event,
          onDidChangeViewState: new Emitter().event,
          reveal() { host.ui('webview-open', { id, viewType, title, html: webview.html }).catch(() => {}); },
          dispose() {
            host.ui('webview-close', { id }).catch(() => {});
            onDidDispose.fire();
          },
        };
        return panel;
      },
      registerCustomEditorProvider() { return Disposable(() => {}); },
      registerUriHandler() { return Disposable(() => {}); },
      registerFileDecorationProvider() { return Disposable(() => {}); },
      tabGroups: {
        all: [],
        activeTabGroup: { tabs: [], isActive: true, viewColumn: 1 },
        onDidChangeTabs: new Emitter().event,
        onDidChangeTabGroups: new Emitter().event,
        close: async () => true,
      },
    },

    workspace: {
      get workspaceFolders() { return workspaceFolders(); },
      get name() { const f = workspaceFolders(); return f?.[0]?.name; },
      get workspaceFile() { return undefined; },
      get textDocuments() { const d = makeDocument(host.editorState()); return d ? [d] : []; },
      getConfiguration: (section) => configProxy(section),
      onDidChangeConfiguration: onDidChangeConfig.event,
      onDidChangeWorkspaceFolders: onDidChangeWorkspaceFolders.event,
      onDidOpenTextDocument: onDidOpenTextDocument.event,
      onDidChangeTextDocument: onDidChangeTextDocument.event,
      onDidSaveTextDocument: onDidSaveTextDocument.event,
      onDidCloseTextDocument: new Emitter().event,
      openTextDocument: async (uriOrOptions) => {
        if (typeof uriOrOptions === 'string' || uriOrOptions?.fsPath || uriOrOptions?.scheme) {
          const p = typeof uriOrOptions === 'string' ? uriOrOptions : uriOrOptions.fsPath;
          const text = await fsp.readFile(p, 'utf8');
          return makeDocument({ path: p, name: path.basename(p), text });
        }
        const content = uriOrOptions?.content || '';
        return makeDocument({ name: 'Untitled', text: content, languageId: uriOrOptions?.language });
      },
      fs: {
        readFile: async (uri) => new Uint8Array(await fsp.readFile(uri.fsPath)),
        writeFile: async (uri, content) => { await fsp.writeFile(uri.fsPath, Buffer.from(content)); },
        delete: async (uri) => { await fsp.rm(uri.fsPath, { recursive: true, force: true }); },
        rename: async (src, dst) => { await fsp.rename(src.fsPath, dst.fsPath); },
        copy: async (src, dst) => { await fsp.copyFile(src.fsPath, dst.fsPath); },
        createDirectory: async (uri) => { await fsp.mkdir(uri.fsPath, { recursive: true }); },
        readDirectory: async (uri) => {
          const ents = await fsp.readdir(uri.fsPath, { withFileTypes: true });
          return ents.map((e) => [e.name, e.isDirectory() ? 2 : 1]);
        },
        stat: async (uri) => {
          const s = await fsp.stat(uri.fsPath);
          return {
            type: s.isDirectory() ? 2 : 1,
            ctime: s.ctimeMs, mtime: s.mtimeMs, size: s.size,
          };
        },
      },
      findFiles: async (include, exclude, maxResults = 100) => {
        const folder = host.editorState()?.folder;
        let base = folder;
        let pattern = '**/*';
        if (include instanceof RelativePattern) {
          base = include.base || include.baseUri?.fsPath || folder;
          pattern = include.pattern;
        } else if (typeof include === 'string') {
          pattern = include;
        }
        if (!base) return [];
        const out = [];
        const excludeRe = exclude ? globToRegExp(typeof exclude === 'string' ? exclude : exclude.pattern || '**/.git/**') : null;
        await walkFindFiles(base, globToRegExp(pattern), excludeRe, maxResults || 100, out);
        return out;
      },
      createFileSystemWatcher(globPattern, ignoreCreate, ignoreChange, ignoreDelete) {
        const onCreate = new Emitter();
        const onChange = new Emitter();
        const onDelete = new Emitter();
        let base = host.editorState()?.folder;
        let pattern = '**/*';
        if (globPattern instanceof RelativePattern) {
          base = globPattern.base || globPattern.baseUri?.fsPath || base;
          pattern = globPattern.pattern;
        } else if (typeof globPattern === 'string') {
          pattern = globPattern;
        }
        const re = globToRegExp(pattern);
        const watchers = [];
        const watchDir = (dir) => {
          if (!dir || !fs.existsSync(dir)) return;
          try {
            const w = fs.watch(dir, { recursive: true }, (event, filename) => {
              if (!filename) return;
              const full = path.join(dir, filename);
              const rel = filename.replace(/\\/g, '/');
              if (!re.test(rel) && !re.test(path.basename(filename))) return;
              const uri = Uri.file(full);
              if (event === 'rename') {
                if (fs.existsSync(full)) { if (!ignoreCreate) onCreate.fire(uri); }
                else if (!ignoreDelete) onDelete.fire(uri);
              } else if (!ignoreChange) onChange.fire(uri);
            });
            watchers.push(w);
          } catch { /* recursive watch unsupported on some platforms */ }
        };
        if (base) watchDir(base);
        return {
          onDidCreate: onCreate.event,
          onDidChange: onChange.event,
          onDidDelete: onDelete.event,
          dispose() {
            for (const w of watchers) try { w.close(); } catch { /* */ }
            onCreate.dispose(); onChange.dispose(); onDelete.dispose();
          },
        };
      },
      saveAll: async () => { await host.ui('save-active', {}); return true; },
      updateWorkspaceFolders: () => false,
      getWorkspaceFolder: (uri) => {
        const folders = workspaceFolders();
        if (!folders) return undefined;
        const p = uri?.fsPath || '';
        return folders.find((f) => p === f.uri.fsPath || p.startsWith(f.uri.fsPath + path.sep));
      },
      asRelativePath: (pathOrUri, _includeFolder) => {
        const p = typeof pathOrUri === 'string' ? pathOrUri : pathOrUri.fsPath;
        const folder = host.editorState()?.folder;
        if (folder && p.startsWith(folder)) return p.slice(folder.length).replace(/^[\\/]/, '');
        return p;
      },
      applyEdit: async (edit) => {
        const entries = edit?._edits || edit?.entries?.() || [];
        for (const entry of entries) {
          const [uri, edits] = Array.isArray(entry) ? entry : [entry?.uri, entry?.edits];
          if (!uri || !edits) continue;
          let text = '';
          try { text = await fsp.readFile(uri.fsPath, 'utf8'); } catch {
            text = host.editorState()?.path === uri.fsPath ? (host.editorState()?.text || '') : '';
          }
          await host.ui('workspace-edit', {
            path: uri.fsPath,
            edits: edits.map((e) => ({
              start: e.range ? positionToOffset(text, e.range.start) : 0,
              end: e.range ? positionToOffset(text, e.range.end) : 0,
              text: e.newText ?? '',
            })),
          });
        }
        return true;
      },
      registerTextDocumentContentProvider(scheme, provider) {
        host.contentProviders = host.contentProviders || new Map();
        host.contentProviders.set(scheme, provider);
        return Disposable(() => host.contentProviders?.delete(scheme));
      },
      registerFileSystemProvider() { return Disposable(() => {}); },
      registerTaskProvider() { return Disposable(() => {}); },
      isTrusted: true,
      onDidGrantWorkspaceTrust: new Emitter().event,
    },

    languages: {
      getLanguages: async () => [
        'plaintext', 'javascript', 'javascriptreact', 'typescript', 'typescriptreact',
        'python', 'json', 'jsonc', 'html', 'css', 'scss', 'markdown', 'shellscript',
        'yaml', 'xml', 'sql', 'go', 'rust', 'java', 'c', 'cpp', 'csharp', 'php', 'ruby',
      ],
      setTextDocumentLanguage: async (doc, languageId) => {
        await host.ui('set-language', { languageId });
        return { ...doc, languageId };
      },
      match: (selector, doc) => (registry.selectorMatches(selector, doc) ? 10 : 0),
      createDiagnosticCollection(name = 'frogee') {
        const store = new Map();
        const publish = () => {
          const flat = [];
          for (const [uriKey, items] of store) {
            registry.setDiagnostics(name, uriKey, items);
            for (const d of items) {
              flat.push({
                uri: uriKey,
                message: d.message,
                severity: d.severity === 0 ? 'error' : d.severity === 1 ? 'warning' : 'info',
                line: (d.range?.start?.line ?? 0) + 1,
                col: (d.range?.start?.character ?? 0) + 1,
                endCol: (d.range?.end?.character ?? 0) + 1,
                source: d.source || name,
              });
            }
          }
          host.ui('diagnostics', { collection: name, items: flat }).catch(() => {});
        };
        return {
          name,
          set(uri, diags) {
            if (uri == null) { store.clear(); registry.clearDiagnostics(name); publish(); return; }
            if (Array.isArray(uri)) {
              for (const [u, d] of uri) store.set(u.toString(), d || []);
            } else {
              store.set(uri.toString(), diags || []);
            }
            publish();
          },
          delete(uri) { store.delete(uri.toString()); registry.clearDiagnostics(name, uri.toString()); publish(); },
          clear() { store.clear(); registry.clearDiagnostics(name); publish(); },
          forEach(cb) { for (const [k, v] of store) cb(Uri.parse(k), v, this); },
          get(uri) { return store.get(uri.toString()) || []; },
          has(uri) { return store.has(uri.toString()); },
          dispose() { store.clear(); registry.clearDiagnostics(name); },
        };
      },
      registerCompletionItemProvider(selector, provider, ...triggerCharacters) {
        provider.triggerCharacters = triggerCharacters;
        return Disposable(registry.registerProvider('completion', selector, provider, host.extensionId));
      },
      registerHoverProvider(selector, provider) {
        return Disposable(registry.registerProvider('hover', selector, provider, host.extensionId));
      },
      registerDefinitionProvider(selector, provider) {
        return Disposable(registry.registerProvider('definition', selector, provider, host.extensionId));
      },
      registerCodeActionsProvider(selector, provider) {
        return Disposable(registry.registerProvider('codeActions', selector, provider, host.extensionId));
      },
      registerDocumentFormattingEditProvider(selector, provider) {
        return Disposable(registry.registerProvider('formatting', selector, provider, host.extensionId));
      },
      registerDocumentRangeFormattingEditProvider(selector, provider) {
        return Disposable(registry.registerProvider('rangeFormatting', selector, provider, host.extensionId));
      },
      registerDocumentSymbolProvider(selector, provider) {
        return Disposable(registry.registerProvider('documentSymbol', selector, provider, host.extensionId));
      },
      registerWorkspaceSymbolProvider(provider) {
        return Disposable(registry.registerProvider('workspaceSymbol', '*', provider, host.extensionId));
      },
      registerSignatureHelpProvider(selector, provider, ...triggerCharacters) {
        provider.triggerCharacters = triggerCharacters;
        return Disposable(registry.registerProvider('signatureHelp', selector, provider, host.extensionId));
      },
      registerReferenceProvider(selector, provider) {
        return Disposable(registry.registerProvider('reference', selector, provider, host.extensionId));
      },
      registerRenameProvider(selector, provider) {
        return Disposable(registry.registerProvider('rename', selector, provider, host.extensionId));
      },
      registerCodeLensProvider(selector, provider) {
        return Disposable(registry.registerProvider('codeLens', selector, provider, host.extensionId));
      },
      registerDocumentHighlightProvider(selector, provider) {
        return Disposable(registry.registerProvider('documentHighlight', selector, provider, host.extensionId));
      },
      registerFoldingRangeProvider(selector, provider) {
        return Disposable(registry.registerProvider('folding', selector, provider, host.extensionId));
      },
      registerInlayHintsProvider(selector, provider) {
        return Disposable(registry.registerProvider('inlayHints', selector, provider, host.extensionId));
      },
      registerDocumentLinkProvider(selector, provider) {
        return Disposable(registry.registerProvider('documentLink', selector, provider, host.extensionId));
      },
      registerColorProvider(selector, provider) {
        return Disposable(registry.registerProvider('color', selector, provider, host.extensionId));
      },
      registerOnTypeFormattingEditProvider(selector, provider, ...trigger) {
        provider.triggerCharacters = trigger;
        return Disposable(registry.registerProvider('onTypeFormatting', selector, provider, host.extensionId));
      },
      registerSelectionRangeProvider(selector, provider) {
        return Disposable(registry.registerProvider('selectionRange', selector, provider, host.extensionId));
      },
      registerCallHierarchyProvider(selector, provider) {
        return Disposable(registry.registerProvider('callHierarchy', selector, provider, host.extensionId));
      },
      onDidChangeDiagnostics: registry.onDiagnostics
        ? ((listener) => {
          const fn = () => listener();
          registry.onDiagnostics.on('change', fn);
          return Disposable(() => registry.onDiagnostics.off('change', fn));
        })
        : new Emitter().event,
    },

    extensions: {
      getExtension(id) {
        if (id !== host.extensionId) return undefined;
        return {
          id: host.extensionId,
          extensionUri: Uri.file(host.extensionPath),
          extensionPath: host.extensionPath,
          isActive: true,
          packageJSON: host.pkg,
          exports: host.exports,
          activate: async () => host.exports,
        };
      },
      get all() {
        return [{
          id: host.extensionId,
          extensionUri: Uri.file(host.extensionPath),
          extensionPath: host.extensionPath,
          isActive: true,
          packageJSON: host.pkg,
          exports: host.exports,
        }];
      },
      onDidChange: new Emitter().event,
    },

    env: {
      appName: 'FrogeeCodeIDE',
      appRoot: path.dirname(host.extensionPath),
      language: 'ru',
      machineId: 'frogee',
      sessionId: `frogee-${process.pid}`,
      shell: process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/zsh'),
      uriScheme: 'frogee',
      uiKind: UIKind.Desktop,
      clipboard: {
        readText: async () => host.ui('clipboard-read', {}),
        writeText: async (text) => host.ui('clipboard-write', { text: String(text) }),
      },
      openExternal: async (uri) => {
        const { shell } = require('electron');
        await shell.openExternal(uri.toString(true));
        return true;
      },
    },

    // Stubs for APIs that need the full VS Code workbench
    debug: {
      registerDebugConfigurationProvider() { return Disposable(() => {}); },
      startDebugging: async () => false,
      activeDebugSession: undefined,
      onDidStartDebugSession: new Emitter().event,
      onDidTerminateDebugSession: new Emitter().event,
    },
    tasks: {
      registerTaskProvider() { return Disposable(() => {}); },
      executeTask: async () => undefined,
      onDidStartTask: new Emitter().event,
      onDidEndTask: new Emitter().event,
    },
    scm: { createSourceControl() { return { createResourceGroup() { return { dispose() {} }; }, dispose() {} }; } },
    notebooks: {},
    l10n: { t: (msg, ...args) => { let i = 0; return String(msg).replace(/\{(\d+)\}/g, () => String(args[i++] ?? '')); } },
  };

  // WorkspaceEdit helper class
  vscode.WorkspaceEdit = class WorkspaceEdit {
    constructor() { this._edits = []; }
    set(uri, edits) { this._edits.push([uri, edits]); }
    get(uri) { return (this._edits.find((e) => e[0].fsPath === uri.fsPath) || [])[1] || []; }
    has(uri) { return this._edits.some((e) => e[0].fsPath === uri.fsPath); }
    entries() { return this._edits; }
    get size() { return this._edits.length; }
    createFile() {}
    deleteFile() {}
    renameFile() {}
  };
  vscode.TextEdit = {
    replace: (range, newText) => ({ range, newText }),
    insert: (pos, newText) => ({ range: new Range(pos, pos), newText }),
    delete: (range) => ({ range, newText: '' }),
  };
  vscode.CompletionItem = class CompletionItem {
    constructor(label, kind) {
      this.label = label;
      this.kind = kind;
      this.detail = undefined;
      this.documentation = undefined;
      this.insertText = undefined;
      this.filterText = undefined;
      this.sortText = undefined;
      this.range = undefined;
      this.commitCharacters = undefined;
      this.command = undefined;
      this.additionalTextEdits = undefined;
    }
  };
  vscode.CompletionList = class CompletionList {
    constructor(items = [], isIncomplete = false) {
      this.items = items;
      this.isIncomplete = isIncomplete;
    }
  };
  vscode.CompletionItemKind = {
    Text: 0, Method: 1, Function: 2, Constructor: 3, Field: 4, Variable: 5, Class: 6,
    Interface: 7, Module: 8, Property: 9, Unit: 10, Value: 11, Enum: 12, Keyword: 13,
    Snippet: 14, Color: 15, File: 16, Reference: 17, Folder: 18, EnumMember: 19,
    Constant: 20, Struct: 21, Event: 22, Operator: 23, TypeParameter: 24, User: 25, Issue: 26,
  };
  vscode.Hover = class Hover { constructor(contents, range) { this.contents = Array.isArray(contents) ? contents : [contents]; this.range = range; } };
  vscode.Diagnostic = class Diagnostic {
    constructor(range, message, severity = 0) {
      this.range = range; this.message = message; this.severity = severity;
      this.source = undefined; this.code = undefined; this.relatedInformation = [];
      this.tags = [];
    }
  };
  vscode.DiagnosticRelatedInformation = class DiagnosticRelatedInformation {
    constructor(location, message) { this.location = location; this.message = message; }
  };
  vscode.DiagnosticTag = { Unnecessary: 1, Deprecated: 2 };
  vscode.Location = class Location {
    constructor(uri, rangeOrPos) {
      this.uri = uri;
      this.range = rangeOrPos instanceof Range ? rangeOrPos
        : rangeOrPos instanceof Position ? new Range(rangeOrPos, rangeOrPos)
          : rangeOrPos;
    }
  };
  vscode.LocationLink = class LocationLink {
    constructor() {
      this.originSelectionRange = undefined;
      this.targetUri = undefined;
      this.targetRange = undefined;
      this.targetSelectionRange = undefined;
    }
  };
  vscode.SymbolInformation = class SymbolInformation {
    constructor(name, kind, containerNameOrRange, locationOrUri, location) {
      this.name = name;
      this.kind = kind;
      if (containerNameOrRange instanceof Range) {
        this.containerName = '';
        this.location = new vscode.Location(locationOrUri, containerNameOrRange);
      } else {
        this.containerName = containerNameOrRange || '';
        this.location = location || locationOrUri;
      }
    }
  };
  vscode.DocumentSymbol = class DocumentSymbol {
    constructor(name, detail, kind, range, selectionRange) {
      this.name = name; this.detail = detail; this.kind = kind;
      this.range = range; this.selectionRange = selectionRange; this.children = [];
    }
  };
  vscode.CodeAction = class CodeAction {
    constructor(title, kind) {
      this.title = title; this.kind = kind;
      this.edit = undefined; this.command = undefined; this.diagnostics = [];
      this.isPreferred = false; this.disabled = undefined;
    }
  };
  vscode.CodeLens = class CodeLens {
    constructor(range, command) { this.range = range; this.command = command; this.isResolved = !!command; }
  };
  vscode.DocumentHighlight = class DocumentHighlight {
    constructor(range, kind = 1) { this.range = range; this.kind = kind; }
  };
  vscode.DocumentHighlightKind = { Text: 0, Read: 1, Write: 2 };
  vscode.FoldingRange = class FoldingRange {
    constructor(start, end, kind) { this.start = start; this.end = end; this.kind = kind; }
  };
  vscode.SignatureHelp = class SignatureHelp {
    constructor() { this.signatures = []; this.activeSignature = 0; this.activeParameter = 0; }
  };
  vscode.SignatureInformation = class SignatureInformation {
    constructor(label, documentation) {
      this.label = label; this.documentation = documentation; this.parameters = [];
      this.activeParameter = undefined;
    }
  };
  vscode.ParameterInformation = class ParameterInformation {
    constructor(label, documentation) { this.label = label; this.documentation = documentation; }
  };
  vscode.InlayHint = class InlayHint {
    constructor(position, label, kind) { this.position = position; this.label = label; this.kind = kind; }
  };
  vscode.InlayHintKind = { Type: 1, Parameter: 2 };
  vscode.DocumentLink = class DocumentLink {
    constructor(range, target) { this.range = range; this.target = target; this.tooltip = undefined; }
  };
  vscode.Color = class Color {
    constructor(r, g, b, a) { this.red = r; this.green = g; this.blue = b; this.alpha = a; }
  };
  vscode.ColorInformation = class ColorInformation {
    constructor(range, color) { this.range = range; this.color = color; }
  };
  vscode.ColorPresentation = class ColorPresentation {
    constructor(label) { this.label = label; this.textEdit = undefined; this.additionalTextEdits = []; }
  };
  vscode.SelectionRange = class SelectionRange {
    constructor(range, parent) { this.range = range; this.parent = parent; }
  };
  vscode.TreeItem = class TreeItem {
    constructor(label, collapsibleState) {
      this.label = label;
      this.collapsibleState = collapsibleState ?? 0;
      this.id = undefined; this.iconPath = undefined; this.description = undefined;
      this.resourceUri = undefined; this.tooltip = undefined; this.command = undefined;
      this.contextValue = undefined; this.checkboxState = undefined;
    }
  };
  vscode.QuickPickItemKind = { Separator: -1, Default: 0 };
  vscode.InputBoxValidationSeverity = { Info: 1, Warning: 2, Error: 3 };
  vscode.FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 };
  vscode.FilePermission = { Readonly: 1 };
  vscode.FileSystemError = class FileSystemError extends Error {
    constructor(msgOrUri) { super(typeof msgOrUri === 'string' ? msgOrUri : 'FileSystemError'); this.code = 'EntryNotFound'; }
    static FileNotFound(msg) { return new FileSystemError(msg || 'FileNotFound'); }
    static FileExists(msg) { return new FileSystemError(msg || 'FileExists'); }
    static FileNotADirectory(msg) { return new FileSystemError(msg || 'FileNotADirectory'); }
    static FileIsADirectory(msg) { return new FileSystemError(msg || 'FileIsADirectory'); }
    static NoPermissions(msg) { return new FileSystemError(msg || 'NoPermissions'); }
    static Unavailable(msg) { return new FileSystemError(msg || 'Unavailable'); }
  };
  vscode.StatusBarItem = class {};
  vscode.TextEditorDecorationType = class {};
  vscode.DecorationRangeBehavior = { OpenOpen: 0, ClosedClosed: 1, OpenClosed: 2, ClosedOpen: 3 };
  vscode.OverviewRulerLane = OverviewRulerLane;
  vscode.ProcessExecution = class ProcessExecution {
    constructor(process, args = [], options = {}) { this.process = process; this.args = args; this.options = options; }
  };
  vscode.ShellExecution = class ShellExecution {
    constructor(commandLineOrCmd, argsOrOptions, options) {
      if (typeof commandLineOrCmd === 'string' && !Array.isArray(argsOrOptions)) {
        this.commandLine = commandLineOrCmd; this.options = argsOrOptions;
      } else {
        this.command = commandLineOrCmd; this.args = argsOrOptions; this.options = options;
      }
    }
  };
  vscode.Task = class Task {
    constructor(definition, ...rest) {
      this.definition = definition;
      if (typeof rest[0] === 'number') {
        this.scope = rest[0]; this.name = rest[1]; this.source = rest[2]; this.execution = rest[3];
      } else {
        this.scope = undefined; this.name = rest[0]; this.source = rest[1]; this.execution = rest[2];
      }
      this.problemMatchers = []; this.isBackground = false;
    }
  };
  vscode.TaskScope = { Global: 1, Workspace: 2 };
  vscode.TaskPanelKind = { Shared: 1, Dedicated: 2, New: 3 };
  vscode.TaskRevealKind = { Always: 1, Silent: 2, Never: 3 };
  vscode.TaskGroup = { Build: { id: 'build' }, Test: { id: 'test' }, Clean: { id: 'clean' } };

  // expose emitters for host lifecycle hooks
  vscode._frogee = {
    onDidChangeActiveTextEditor,
    onDidChangeTextEditorSelection,
    onDidChangeTextDocument,
    onDidSaveTextDocument,
    onDidOpenTextDocument,
    makeDocument,
    makeEditor,
  };

  return vscode;
}

module.exports = {
  createVscodeApi,
  Uri,
  Position,
  Range,
  Selection,
  Disposable,
  Emitter,
  offsetToPosition,
  positionToOffset,
};
