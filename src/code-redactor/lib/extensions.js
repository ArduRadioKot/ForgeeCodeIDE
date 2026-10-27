/**
 * VS Code extensions from Open VSX (open-vsx.org).
 * Declarative package.json contributions (themes, snippets, languages, grammars, commands) always apply.
 * Extensions with `main` can also run via Frogee's vscode.* shim (lib/vscode-host.js) after user consent —
 * not a copy of VS Code's extension host; webviews/LSP debug adapters are unsupported.
 * Installed under Documents/FrogeeCodeIDE/extensions/<publisher>.<name>.
 */
const { ipcMain, shell, dialog, BrowserWindow } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const zlib = require('zlib');

const API = 'https://open-vsx.org/api';
const ROOT = path.join(os.homedir(), 'Documents', 'FrogeeCodeIDE');
const EXT_DIR = path.join(ROOT, 'extensions');
const THEMES_DIR = path.join(ROOT, 'themes');
const META = '.frogee.json';
const ID_RE = /^[a-z0-9][\w.-]{0,100}$/i;
const MAX_VSIX = 80 * 1024 * 1024;

// ───────────────────────── network ─────────────────────────

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Open VSX ответил ${res.status}`);
  return res.json();
}

function brief(e) {
  return {
    namespace: e.namespace,
    name: e.name,
    id: `${e.namespace}.${e.name}`,
    displayName: e.displayName || e.name,
    description: e.description || '',
    version: e.version || '',
    icon: e.files?.icon || '',
    downloads: e.downloadCount || 0,
  };
}

async function search({ query = '', category = '' } = {}) {
  const q = new URLSearchParams({ size: '30', sortBy: query ? 'relevance' : 'downloadCount', sortOrder: 'desc' });
  if (query) q.set('query', query);
  if (category) q.set('category', category);
  const data = await getJson(`${API}/-/search?${q}`);
  return (data.extensions || []).map(brief);
}

// ───────────────────────── a small zip reader (a .vsix is a zip) ─────────────────────────

function unzipEntries(buf) {
  // End of central directory: the last 0x06054b50 signature.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('файл расширения повреждён');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('файл расширения повреждён');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    out.push({ name, read: () => {
      const raw = buf.subarray(start, start + size);
      if (method === 0) return raw;
      if (method === 8) return zlib.inflateRawSync(raw);
      throw new Error(`неподдерживаемое сжатие (${method})`);
    } });
  }
  return out;
}

// ───────────────────────── VS Code JSON ─────────────────────────

/** VS Code JSON allows comments and trailing commas. */
function parseJsonc(text) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (c === '\\') { out += text[++i] || ''; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && text[i + 1] === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; continue; }
    out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1').replace(/^﻿/, ''));
}

function insideDir(dir, rel) {
  const full = path.resolve(dir, String(rel || ''));
  return full.startsWith(path.resolve(dir) + path.sep) ? full : null;
}

// ───────────────────────── themes ─────────────────────────

const COLOR_MAP = {
  'window-bg': ['sideBar.background', 'editorGroupHeader.tabsBackground', 'activityBar.background', 'editor.background'],
  'card-bg': ['sideBar.background', 'editorWidget.background', 'editor.background'],
  'header-bg': ['titleBar.activeBackground', 'editorGroupHeader.tabsBackground', 'sideBar.background'],
  'code-bg': ['editor.background'],
  'editor-bg': ['editor.background'],
  'text-color': ['editor.foreground', 'foreground'],
  'text-muted': ['descriptionForeground'],
  'text-faint': ['editorLineNumber.foreground'],
  'border-color': ['panel.border', 'sideBar.border', 'editorGroup.border', 'contrastBorder'],
  'hover-color': ['list.hoverBackground'],
  'active-bg': ['list.activeSelectionBackground', 'list.inactiveSelectionBackground'],
  'accent-color': ['activityBarBadge.background', 'button.background', 'focusBorder'],
  'accent-text': ['activityBarBadge.foreground', 'button.foreground'],
  'link-color': ['textLink.foreground'],
  selection: ['editor.selectionBackground'],
  'success-color': ['gitDecoration.addedResourceForeground', 'terminal.ansiGreen'],
  'warning-color': ['editorWarning.foreground', 'list.warningForeground'],
  'danger-color': ['editorError.foreground', 'errorForeground'],
};
// For each FrogeeCodeIDE token: TextMate scopes it stands for, most typical first.
const SYNTAX_MAP = {
  keyword: ['keyword.control.flow', 'keyword.control', 'storage.type.function', 'keyword'],
  string: ['string.quoted.double', 'string'],
  number: ['constant.numeric.decimal', 'constant.numeric'],
  comment: ['comment.line.double-slash', 'comment'],
  function: ['entity.name.function', 'support.function'],
  type: ['entity.name.type.class', 'entity.name.type', 'entity.name.class', 'support.type', 'storage.type'],
  field: ['variable.other.property', 'variable.other.object.property', 'meta.object-literal.key', 'support.variable.property'],
  tag: ['entity.name.tag'],
  attr: ['entity.other.attribute-name'],
  heading: ['markup.heading', 'entity.name.section'],
  annotation: ['meta.decorator', 'entity.name.function.decorator', 'storage.type.annotation'],
};
const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
const COLOR_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** The colour a rule list gives a scope: the most specific selector that is a prefix of the scope wins. */
function scopeColor(rules, scope) {
  let best = null;
  let bestLen = -1;
  for (const rule of rules) {
    const fg = rule?.settings?.foreground;
    if (!fg || !COLOR_RE.test(fg)) continue;
    const selectors = Array.isArray(rule.scope) ? rule.scope : String(rule.scope || '').split(',');
    for (let sel of selectors) {
      sel = sel.trim();
      if (!sel || sel.includes(' ')) continue; // descendant selectors ("meta.x string") are skipped
      if ((scope === sel || scope.startsWith(sel + '.')) && sel.length > bestLen) { best = fg; bestLen = sel.length; }
    }
  }
  return best;
}

async function readTheme(file, depth = 0) {
  if (/\.tmTheme$/i.test(file)) return parseTmTheme(await fsp.readFile(file, 'utf8'));
  const raw = parseJsonc(await fsp.readFile(file, 'utf8'));
  if (raw.include && depth < 4) {
    const base = await readTheme(path.resolve(path.dirname(file), raw.include), depth + 1).catch(() => null);
    if (base) {
      raw.colors = { ...(base.colors || {}), ...(raw.colors || {}) };
      raw.tokenColors = [...(base.tokenColors || []), ...(Array.isArray(raw.tokenColors) ? raw.tokenColors : [])];
      raw.type = raw.type || base.type;
    }
  }
  return raw;
}

/** Minimal plist/.tmTheme reader → { type, colors, tokenColors } for convertTheme. */
function parseTmTheme(xml) {
  const tokenColors = [];
  const dictRe = /<dict>([\s\S]*?)<\/dict>/gi;
  let m;
  while ((m = dictRe.exec(xml))) {
    const block = m[1];
    if (!/<key>scope<\/key>/i.test(block) && !/<key>name<\/key>/i.test(block)) continue;
    const scope = plistString(block, 'scope');
    const fg = plistString(block, 'foreground') || plistNested(block, 'settings', 'foreground');
    const bg = plistNested(block, 'settings', 'background');
    const fontStyle = plistNested(block, 'settings', 'fontStyle');
    if (!scope && !fg) continue;
    const settings = {};
    if (fg && COLOR_RE.test(fg)) settings.foreground = fg;
    if (bg && COLOR_RE.test(bg)) settings.background = bg;
    if (fontStyle) settings.fontStyle = fontStyle;
    if (!Object.keys(settings).length) continue;
    tokenColors.push({ scope: scope || undefined, settings });
  }
  const name = plistString(xml, 'name') || 'Theme';
  return { name, type: /light/i.test(name) ? 'light' : 'dark', colors: {}, tokenColors };
}

function plistString(block, key) {
  const re = new RegExp(`<key>${key}<\\/key>\\s*<string>([\\s\\S]*?)<\\/string>`, 'i');
  const m = re.exec(block);
  return m ? m[1].trim() : '';
}

function plistNested(block, parent, key) {
  const re = new RegExp(`<key>${parent}<\\/key>\\s*<dict>([\\s\\S]*?)<\\/dict>`, 'i');
  const m = re.exec(block);
  return m ? plistString(m[1], key) : '';
}

function convertTheme(vs, { label, uiTheme, author }) {
  const c = vs.colors || {};
  const pickColor = (keys) => keys.map((k) => c[k]).find((v) => typeof v === 'string' && COLOR_RE.test(v));
  const colors = {};
  for (const [key, list] of Object.entries(COLOR_MAP)) { const v = pickColor(list); if (v) colors[key] = v; }
  const rules = Array.isArray(vs.tokenColors) ? vs.tokenColors : [];
  const syntax = {};
  for (const [key, scopes] of Object.entries(SYNTAX_MAP)) {
    const v = scopes.map((s) => scopeColor(rules, s)).find(Boolean);
    if (v) syntax[key] = v;
  }
  const terminal = {};
  const tbg = c['terminal.background'] || c['panel.background'] || c['editor.background'];
  const tfg = c['terminal.foreground'] || c['editor.foreground'];
  if (tbg && COLOR_RE.test(tbg)) terminal.background = tbg;
  if (tfg && COLOR_RE.test(tfg)) terminal.foreground = tfg;
  if (c['terminalCursor.foreground']) terminal.cursor = c['terminalCursor.foreground'];
  for (const name of ANSI) {
    const cap = name[0].toUpperCase() + name.slice(1);
    if (COLOR_RE.test(c[`terminal.ansi${cap}`] || '')) terminal[name] = c[`terminal.ansi${cap}`];
    if (COLOR_RE.test(c[`terminal.ansiBright${cap}`] || '')) terminal[`bright${cap}`] = c[`terminal.ansiBright${cap}`];
  }
  const light = uiTheme === 'vs' || uiTheme === 'hc-light' || vs.type === 'light';
  return { name: label, type: light ? 'light' : 'dark', author, colors, syntax, terminal };
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60) || 'theme';

// ───────────────────────── install / list / remove ─────────────────────────

const PLUGINS_DIR = path.join(ROOT, 'plugins');
const PLUGIN_RE = /\.(?:js|css)$/i;
const MAX_FILES = 500;

/** What FrogeeCodeIDE takes from a VS Code package.json. */
function vsCodeCaps(pkg) {
  const contributes = pkg.contributes || {};
  const themes = Array.isArray(contributes.themes)
    ? contributes.themes.filter((t) => t?.path)
    : [];
  const snippets = Array.isArray(contributes.snippets)
    ? contributes.snippets.filter((s) => s?.path)
    : [];
  const languages = Array.isArray(contributes.languages)
    ? contributes.languages.filter((l) => l?.id)
    : [];
  const grammars = Array.isArray(contributes.grammars)
    ? contributes.grammars.filter((g) => g?.path && /\.json$/i.test(g.path))
    : [];
  const commands = Array.isArray(contributes.commands)
    ? contributes.commands.filter((c) => c?.command)
    : [];
  const main = typeof pkg.main === 'string' ? pkg.main : '';
  const browser = typeof pkg.browser === 'string' ? pkg.browser : '';
  return {
    themes,
    snippets,
    languages,
    grammars,
    commands,
    plugins: [],
    forFrogee: false,
    hasCode: !!(main || browser),
    main,
    browser,
    activationEvents: Array.isArray(pkg.activationEvents) ? pkg.activationEvents.map(String) : [],
  };
}

/**
 * An extension made for FrogeeCodeIDE is a folder with extension.json:
 *   { "publisher": "frogeesoft", "name": "exildraw", "version": "1.0.0", "displayName": "...", "description": "...", "icon": "icon.png",
 *     "plugins": ["plugin.js"], "themes": [{ "label": "...", "uiTheme": "vs-dark", "path": "themes/x.json" }],
 *     "snippets": [{ "language": "javascript", "path": "snippets/js.json" }] }
 * Plugins are FrogeeCodeIDE plugins (the frogee / fgs API) and run; themes and snippets use the VS Code formats.
 */
function frogeeManifest(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('extension.json пустой или повреждён');
  if (!ID_RE.test(String(raw.publisher || '')) || !ID_RE.test(String(raw.name || ''))) throw new Error('в extension.json нужны поля publisher и name (латиница, цифры, точка, дефис)');
  const list = (v) => (Array.isArray(v) ? v : []);
  return {
    manifest: raw,
    caps: {
      plugins: list(raw.plugins).map(String).filter((p) => PLUGIN_RE.test(p)),
      themes: list(raw.themes).filter((t) => t?.path),
      snippets: list(raw.snippets).filter((x) => x?.path),
      languages: list(raw.languages).filter((l) => l?.id),
      grammars: list(raw.grammars).filter((g) => g?.path),
      commands: list(raw.commands).filter((c) => c?.command),
      forFrogee: true,
      hasCode: false,
    },
  };
}
const usable = (caps) =>
  caps.themes.length || caps.snippets.length || caps.plugins.length
  || caps.languages?.length || caps.grammars?.length || caps.commands?.length
  || caps.hasCode;

/** Extract \b(word|word)\b style keywords from a TextMate JSON grammar (best-effort). */
function keywordsFromGrammar(grammar) {
  const found = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node.match === 'string') {
      for (const m of node.match.matchAll(/\\b\(([^)]+)\)\\b/g)) {
        for (const part of m[1].split('|')) {
          const w = part.replace(/\\/g, '');
          if (/^[A-Za-z_][\w$]*$/.test(w) && w.length > 1) found.add(w);
        }
      }
    }
    for (const v of Object.values(node)) walk(v);
  };
  walk(grammar);
  return [...found].slice(0, 250);
}

async function readMeta(dir) {
  try { return JSON.parse(await fsp.readFile(path.join(dir, META), 'utf8')); } catch { return null; }
}

/** Fill languages/grammars/commands/main from package.json for older installs. */
async function enrichDeclarative(dir, meta) {
  const needsDeclarative = !(Array.isArray(meta?.languages) && Array.isArray(meta?.grammars) && Array.isArray(meta?.commands));
  const needsMain = meta && meta.main === undefined && meta.hasCode;
  if (!meta || (!needsDeclarative && !needsMain && meta.main !== undefined)) {
    return meta;
  }
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return { ...meta, languages: meta.languages || [], grammars: meta.grammars || [], commands: meta.commands || [], main: meta.main || '', codeEnabled: !!meta.codeEnabled };
  }
  try {
    const caps = vsCodeCaps(parseJsonc(await fsp.readFile(pkgPath, 'utf8')));
    const languages = [];
    for (const lang of caps.languages) {
      const id = String(lang.id || '').trim();
      if (!id) continue;
      const entry = {
        id,
        extensions: (lang.extensions || []).map(String),
        filenames: (lang.filenames || []).map(String),
        aliases: (lang.aliases || []).map(String),
        configuration: lang.configuration || null,
        config: null,
      };
      if (lang.configuration) {
        const cfgPath = insideDir(dir, lang.configuration);
        if (cfgPath && fs.existsSync(cfgPath)) {
          try {
            const cfg = parseJsonc(await fsp.readFile(cfgPath, 'utf8'));
            entry.config = {
              lineComment: cfg.comments?.lineComment || null,
              blockComment: Array.isArray(cfg.comments?.blockComment) ? cfg.comments.blockComment : null,
              brackets: Array.isArray(cfg.brackets) ? cfg.brackets : null,
              autoClosingPairs: Array.isArray(cfg.autoClosingPairs)
                ? cfg.autoClosingPairs.map((p) => (Array.isArray(p) ? p : [p.open, p.close])).filter((p) => p[0] && p[1])
                : null,
            };
          } catch { /* skip bad config */ }
        }
      }
      languages.push(entry);
    }
    const grammars = [];
    for (const g of caps.grammars) {
      const file = insideDir(dir, g.path);
      if (!file || !fs.existsSync(file)) continue;
      const entry = { path: g.path, language: g.language || '', scopeName: g.scopeName || '', keywords: [] };
      try { entry.keywords = keywordsFromGrammar(parseJsonc(await fsp.readFile(file, 'utf8'))); } catch { /* skip */ }
      grammars.push(entry);
    }
    const commands = needsDeclarative
      ? caps.commands.map((c) => ({
        command: String(c.command),
        title: String(c.title || c.command),
        category: c.category ? String(c.category) : '',
      }))
      : (meta.commands || []);
    const next = {
      ...meta,
      languages: needsDeclarative ? languages : (meta.languages || []),
      grammars: needsDeclarative ? grammars : (meta.grammars || []),
      commands,
      main: meta.main || caps.main || '',
      browser: meta.browser || caps.browser || '',
      activationEvents: meta.activationEvents || caps.activationEvents || [],
      hasCode: !!(meta.main || caps.main || meta.browser || caps.browser || meta.hasCode),
      codeEnabled: !!meta.codeEnabled,
    };
    await fsp.writeFile(path.join(dir, META), JSON.stringify(next, null, 2)).catch(() => {});
    return next;
  } catch {
    return { ...meta, languages: meta.languages || [], grammars: meta.grammars || [], commands: meta.commands || [], main: meta.main || '', codeEnabled: !!meta.codeEnabled };
  }
}

async function listInstalled() {
  await fsp.mkdir(EXT_DIR, { recursive: true });
  const out = [];
  for (const ent of await fsp.readdir(EXT_DIR, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const dir = path.join(EXT_DIR, ent.name);
    let meta = await readMeta(dir);
    if (!meta) continue;
    meta = await enrichDeclarative(dir, meta);
    out.push(meta);
  }
  return out.sort((a, b) => a.displayName.localeCompare(b.displayName, 'ru'));
}

async function removeExtension(id) {
  if (!ID_RE.test(String(id))) throw new Error('Неизвестное расширение');
  const dir = path.join(EXT_DIR, id);
  const meta = await readMeta(dir);
  for (const file of meta?.themeFiles || []) {
    const full = insideDir(THEMES_DIR, file);
    if (full) await fsp.rm(full, { force: true });
  }
  for (const file of meta?.pluginFiles || []) {
    const full = insideDir(PLUGINS_DIR, file);
    if (full) await fsp.rm(full, { force: true });
  }
  if (!fs.existsSync(dir)) return;
  try { await shell.trashItem(dir); } catch { await fsp.rm(dir, { recursive: true, force: true }); }
}

/** A plugin / VS Code main runs with editor rights: ask before enabling code. */
async function confirmCode(win, displayName, files, { vsCode = false } = {}) {
  const detail = vsCode
    ? `В «${displayName}» есть код расширения VS Code (${files.join(', ')}). FrogeeCodeIDE запустит его через свой vscode.* API (не полный движок VS Code). Код увидит файлы проекта и сможет менять редактор. Webview, LSP-серверы и отладчик могут не работать. Устанавливайте только расширения, которым доверяете.`
    : `Это расширение для FrogeeCodeIDE с плагинами (${files.join(', ')}). Плагин выполняется внутри редактора, видит открытые файлы и может работать с проектом так же, как сам редактор. Устанавливайте только расширения, которым доверяете.`;
  const answer = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Установить и разрешить код', 'Отмена'],
    defaultId: 1,
    cancelId: 1,
    message: `Установить «${displayName}»?`,
    detail,
  });
  return answer.response === 0;
}

const unsupportedVsCode = (name) => ({
  success: false,
  unsupported: true,
  error: `«${name}» не даёт ни данных (темы, сниппеты, языки…), ни точки входа main/browser для запуска.`,
});

/**
 * The files are already in EXT_DIR/<id>: converts themes, copies plugins into the plugins folder and writes the record.
 * desc: { id, namespace, name, displayName, version, description, author, icon (URL or path inside the folder), source }
 */
async function finishInstall(dir, caps, desc) {
  const problems = [];

  await fsp.mkdir(THEMES_DIR, { recursive: true });
  const themeFiles = [];
  const themeIds = [];
  for (const t of caps.themes) {
    const file = insideDir(dir, t.path);
    if (!file) continue;
    try {
      const theme = convertTheme(await readTheme(file), { label: t.label || t.id || desc.displayName, uiTheme: t.uiTheme, author: String(desc.author || desc.namespace) });
      const fileName = `vsx-${slug(desc.id)}-${slug(t.label || t.id || path.basename(t.path, '.json'))}.json`;
      await fsp.writeFile(path.join(THEMES_DIR, fileName), JSON.stringify(theme, null, 2));
      themeFiles.push(fileName);
      themeIds.push(fileName.replace(/\.json$/, ''));
    } catch (err) {
      problems.push(`тема ${t.label || t.path}: ${err.message}`);
    }
  }

  // Plugins go into the plugins folder under the extension's name, so removing the extension removes them.
  await fsp.mkdir(PLUGINS_DIR, { recursive: true });
  const pluginFiles = [];
  for (const rel of caps.plugins) {
    const file = insideDir(dir, rel);
    if (!file || !fs.existsSync(file)) { problems.push(`нет файла плагина ${rel}`); continue; }
    const fileName = `${desc.id}--${path.basename(rel)}`.replace(/[\\/:*?"<>|\0]/g, '_').slice(0, 120);
    await fsp.copyFile(file, path.join(PLUGINS_DIR, fileName));
    pluginFiles.push(fileName);
  }

  const snippets = caps.snippets.map((x) => ({ language: x.language || '', path: x.path })).filter((x) => insideDir(dir, x.path));

  // Languages: extension → Frogee lang id, plus optional language-configuration.json
  const languages = [];
  for (const lang of caps.languages || []) {
    const id = String(lang.id || '').trim();
    if (!id) continue;
    const entry = {
      id,
      extensions: (lang.extensions || []).map(String),
      filenames: (lang.filenames || []).map(String),
      aliases: (lang.aliases || []).map(String),
      configuration: null,
      config: null,
    };
    if (lang.configuration) {
      const cfgPath = insideDir(dir, lang.configuration);
      if (cfgPath && fs.existsSync(cfgPath)) {
        entry.configuration = lang.configuration;
        try {
          const cfg = parseJsonc(await fsp.readFile(cfgPath, 'utf8'));
          entry.config = {
            lineComment: cfg.comments?.lineComment || null,
            blockComment: Array.isArray(cfg.comments?.blockComment) ? cfg.comments.blockComment : null,
            brackets: Array.isArray(cfg.brackets) ? cfg.brackets : null,
            autoClosingPairs: Array.isArray(cfg.autoClosingPairs)
              ? cfg.autoClosingPairs.map((p) => (Array.isArray(p) ? p : [p.open, p.close])).filter((p) => p[0] && p[1])
              : null,
          };
        } catch (err) {
          problems.push(`language-configuration ${lang.configuration}: ${err.message}`);
        }
      }
    }
    languages.push(entry);
  }

  // Grammars: keep path + extract keyword hints for the regex highlighter
  const grammars = [];
  for (const g of caps.grammars || []) {
    const file = insideDir(dir, g.path);
    if (!file || !fs.existsSync(file)) continue;
    const entry = {
      path: g.path,
      language: g.language || '',
      scopeName: g.scopeName || '',
      keywords: [],
    };
    try {
      const raw = parseJsonc(await fsp.readFile(file, 'utf8'));
      entry.keywords = keywordsFromGrammar(raw);
    } catch (err) {
      problems.push(`грамматика ${g.path}: ${err.message}`);
    }
    grammars.push(entry);
  }

  // Commands: store all; the renderer maps known ids onto Frogee actions
  const commands = (caps.commands || []).map((c) => ({
    command: String(c.command),
    title: String(c.title || c.command),
    category: c.category ? String(c.category) : '',
  }));

  let icon = /^https?:/i.test(desc.icon || '') ? desc.icon : '';
  if (!icon && desc.icon) {
    const file = insideDir(dir, desc.icon);
    if (file && fs.existsSync(file)) icon = `file://${file.split(path.sep).map(encodeURIComponent).join('/').replace(/^\/?/, '/')}`;
  }

  const meta = {
    id: desc.id, namespace: desc.namespace, name: desc.name, displayName: desc.displayName,
    version: desc.version || '', description: desc.description || '', icon,
    themes: caps.themes.map((t) => t.label || t.id || t.path), themeFiles, themeIds,
    snippets, pluginFiles, languages, grammars, commands,
    forFrogee: caps.forFrogee, hasCode: caps.hasCode,
    main: caps.main || '', browser: caps.browser || '',
    activationEvents: caps.activationEvents || [],
    codeEnabled: !!(desc.codeEnabled && caps.main),
    source: desc.source, installedAt: new Date().toISOString(),
  };
  await fsp.writeFile(path.join(dir, META), JSON.stringify(meta, null, 2));
  return { success: true, extension: meta, problems };
}

// ── VS Code extensions (.vsix from Open VSX) ──

async function installVsix(buf, info, { win = null, codeEnabled = false } = {}) {
  if (buf.length > MAX_VSIX) throw new Error('Расширение больше 80 МБ');
  const entries = unzipEntries(buf);
  const pkgEntry = entries.find((e) => e.name === 'extension/package.json');
  if (!pkgEntry) throw new Error('Это не расширение VS Code: в архиве нет extension/package.json');
  const pkg = parseJsonc(pkgEntry.read().toString('utf8'));
  const namespace = info?.namespace || pkg.publisher;
  const name = info?.name || pkg.name;
  if (!ID_RE.test(String(namespace)) || !ID_RE.test(String(name))) throw new Error('В package.json нет корректных publisher и name');
  const caps = vsCodeCaps(pkg);
  const displayName = info?.displayName || pkg.displayName || name;
  if (!usable(caps)) return unsupportedVsCode(displayName);

  let allowCode = !!codeEnabled;
  if (caps.hasCode && caps.main && !allowCode) {
    const entry = caps.main || caps.browser || 'main';
    if (!(await confirmCode(win, displayName, [entry], { vsCode: true }))) {
      // Still install declarative parts if any; otherwise cancel.
      if (!(caps.themes.length || caps.snippets.length || caps.languages.length || caps.grammars.length)) {
        return { success: false, canceled: true };
      }
      allowCode = false;
    } else {
      allowCode = true;
    }
  }

  const id = `${namespace}.${name}`;
  const dir = path.join(EXT_DIR, id);
  await removeExtension(id).catch(() => {});
  await fsp.mkdir(dir, { recursive: true });
  // Only the extension/ folder of the .vsix is the extension itself.
  for (const entry of entries) {
    if (!entry.name.startsWith('extension/')) continue;
    const target = insideDir(dir, entry.name.slice('extension/'.length));
    if (!target) continue;
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, entry.read());
  }
  return finishInstall(dir, caps, {
    id, namespace, name, displayName,
    version: info?.version || pkg.version, description: info?.description || pkg.description,
    author: info?.publishedBy?.loginName || pkg.author?.name || pkg.author || namespace,
    icon: info?.files?.icon || pkg.icon || '',
    source: 'open-vsx',
    codeEnabled: allowCode && !!caps.main,
  });
}

async function install(namespace, name, win = null) {
  if (!ID_RE.test(String(namespace)) || !ID_RE.test(String(name))) throw new Error('Неверное имя расширения');
  const info = await getJson(`${API}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
  // package.json first: an extension FrogeeCodeIDE cannot use is refused before anything is downloaded.
  const pkg = info.files?.manifest ? await getJson(info.files.manifest).catch(() => null) : null;
  if (pkg && !usable(vsCodeCaps(pkg))) return unsupportedVsCode(info.displayName || name);
  const url = info.files?.download;
  if (!url) throw new Error('У расширения нет файла для скачивания');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Скачивание не удалось (${res.status})`);
  return installVsix(Buffer.from(await res.arrayBuffer()), info, { win });
}

// ── extensions for FrogeeCodeIDE (a folder with extension.json) ──

function frogeeDesc(m, source, icon) {
  return {
    id: `${m.publisher}.${m.name}`, namespace: m.publisher, name: m.name, displayName: String(m.displayName || m.name),
    version: String(m.version || ''), description: String(m.description || ''), author: m.author || m.publisher,
    icon: icon || m.icon || '', source,
  };
}

/** "Установить из папки": a folder with extension.json, from disk. */
async function installFromFolder(win) {
  const picked = await dialog.showOpenDialog(win, {
    title: 'Папка расширения (с файлом extension.json)',
    buttonLabel: 'Установить',
    properties: ['openDirectory'],
  });
  if (picked.canceled || !picked.filePaths[0]) return { success: false, canceled: true };
  const src = picked.filePaths[0];
  let raw;
  try { raw = parseJsonc(await fsp.readFile(path.join(src, 'extension.json'), 'utf8')); } catch (err) {
    throw new Error(err.code === 'ENOENT' ? 'В папке нет extension.json. Выберите папку расширения FrogeeCodeIDE.' : `extension.json не читается: ${err.message}`);
  }
  const { manifest, caps } = frogeeManifest(raw);
  const desc = frogeeDesc(manifest, 'folder');
  if (!usable(caps)) throw new Error('В extension.json не указаны ни плагины, ни темы, ни сниппеты');
  if (caps.plugins.length && !(await confirmCode(win, desc.displayName, caps.plugins))) return { success: false, canceled: true };
  const dir = path.join(EXT_DIR, desc.id);
  if (path.resolve(src) !== path.resolve(dir)) {
    await removeExtension(desc.id).catch(() => {});
    await fsp.cp(src, dir, { recursive: true, filter: (f) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(f) });
  }
  return finishInstall(dir, caps, desc);
}

// ── the catalog on the project site ──

// The site publishes extensions/index.json and every extension's folder next to it (scripts/build-extensions.js builds them).
const REGISTRY = process.env.FROGEE_EXTENSIONS_URL || 'https://arduradiokot.github.io/ForgeeCodeIDE/extensions/index.json';

function safeUrl(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && /^(127\.0\.0\.1|localhost)$/.test(u.hostname))) throw new Error('Каталог отдал небезопасную ссылку');
  return u;
}

async function frogeeCatalog() {
  const data = await getJson(REGISTRY);
  const base = new URL('.', REGISTRY);
  return (Array.isArray(data.extensions) ? data.extensions : [])
    .filter((e) => ID_RE.test(String(e.publisher || '')) && ID_RE.test(String(e.name || '')) && e.path && Array.isArray(e.files))
    .map((e) => {
      const folder = new URL(String(e.path).replace(/\/?$/, '/'), base);
      return {
        id: `${e.publisher}.${e.name}`,
        namespace: e.publisher,
        name: e.name,
        displayName: String(e.displayName || e.name),
        description: String(e.description || ''),
        version: String(e.version || ''),
        icon: e.icon ? new URL(e.icon, folder).href : '',
        folder: folder.href,
        files: e.files.map(String),
        plugins: e.plugins || 0,
        themes: e.themes || 0,
        snippets: e.snippets || 0,
        frogee: true,
      };
    });
}

async function installFromCatalog(id, win) {
  const entry = (await frogeeCatalog()).find((e) => e.id === id);
  if (!entry) throw new Error('Расширение не найдено в каталоге FrogeeCodeIDE');
  if (entry.files.length > MAX_FILES) throw new Error('В расширении слишком много файлов');
  const folder = safeUrl(entry.folder);
  // The manifest first: what the extension brings decides whether to ask about code.
  const raw = await getJson(new URL('extension.json', folder).href);
  const { manifest, caps } = frogeeManifest(raw);
  if (`${manifest.publisher}.${manifest.name}` !== id) throw new Error('extension.json в каталоге не совпадает с записью каталога');
  const desc = frogeeDesc(manifest, 'catalog', entry.icon);
  if (caps.plugins.length && !(await confirmCode(win, desc.displayName, caps.plugins))) return { success: false, canceled: true };

  // Download into a fresh folder next to the old one, then swap: a broken download never leaves half an extension.
  const tmp = path.join(EXT_DIR, `.${id}.download`);
  await fsp.rm(tmp, { recursive: true, force: true });
  await fsp.mkdir(tmp, { recursive: true });
  let total = 0;
  try {
    for (const rel of entry.files) {
      const target = insideDir(tmp, rel);
      if (!target || rel.includes('..')) throw new Error(`недопустимый путь в каталоге: ${rel}`);
      const url = new URL(rel.split('/').map(encodeURIComponent).join('/'), folder);
      if (!url.href.startsWith(folder.href)) throw new Error(`недопустимый путь в каталоге: ${rel}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`не скачался ${rel} (${res.status})`);
      const buf = Buffer.from(await res.arrayBuffer());
      total += buf.length;
      if (total > MAX_VSIX) throw new Error('Расширение больше 80 МБ');
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, buf);
    }
  } catch (err) {
    await fsp.rm(tmp, { recursive: true, force: true });
    throw err;
  }
  const dir = path.join(EXT_DIR, id);
  await removeExtension(id).catch(() => {});
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.rename(tmp, dir);
  return finishInstall(dir, caps, desc);
}

/** All snippets of installed extensions: [{ language, extension, items: [{ prefix: [], body, description, name }] }]. */
async function loadSnippets() {
  const out = [];
  for (const ext of await listInstalled()) {
    const dir = path.join(EXT_DIR, ext.id);
    for (const s of ext.snippets || []) {
      const file = insideDir(dir, s.path);
      if (!file) continue;
      try {
        const data = parseJsonc(await fsp.readFile(file, 'utf8'));
        const items = [];
        for (const [title, v] of Object.entries(data || {})) {
          if (!v || typeof v !== 'object' || v.body == null) continue;
          const prefix = (Array.isArray(v.prefix) ? v.prefix : [v.prefix || title]).map(String).filter(Boolean);
          const body = Array.isArray(v.body) ? v.body.map(String).join('\n') : String(v.body);
          items.push({ name: title, prefix, body, description: v.description ? String(v.description) : '', scope: v.scope ? String(v.scope) : '' });
        }
        out.push({ language: s.language, extension: ext.displayName, items });
      } catch (err) {
        console.warn('[extensions] сниппеты', ext.id, err.message);
      }
    }
  }
  return out;
}

/** Aggregate declarative contributions from every installed extension (for the renderer). */
async function loadContributions() {
  const languages = [];
  const grammars = [];
  const commands = [];
  for (const ext of await listInstalled()) {
    for (const lang of ext.languages || []) {
      languages.push({ ...lang, extension: ext.displayName, extensionId: ext.id });
    }
    for (const g of ext.grammars || []) {
      grammars.push({ ...g, extension: ext.displayName, extensionId: ext.id });
    }
    for (const c of ext.commands || []) {
      commands.push({ ...c, extension: ext.displayName, extensionId: ext.id });
    }
  }
  return { languages, grammars, commands };
}

async function setCodeEnabled(id, enabled) {
  if (!ID_RE.test(String(id))) throw new Error('Неизвестное расширение');
  const dir = path.join(EXT_DIR, id);
  const meta = await readMeta(dir);
  if (!meta) throw new Error('Расширение не установлено');
  if (enabled && !meta.main) throw new Error('У расширения нет main — запускать нечего');
  meta.codeEnabled = !!enabled && !!meta.main;
  meta.hasCode = !!(meta.main || meta.browser);
  await fsp.writeFile(path.join(dir, META), JSON.stringify(meta, null, 2));
  return { success: true, extension: meta };
}

function registerExtensionsIpc() {
  const handlers = {
    'extensions-search': (e, opts) => search(opts),
    'extensions-installed': () => listInstalled(),
    'extensions-install': (e, { namespace, name, source } = {}) => (source === 'frogee'
      ? installFromCatalog(`${namespace}.${name}`, BrowserWindow.fromWebContents(e.sender))
      : install(namespace, name, BrowserWindow.fromWebContents(e.sender))),
    'extensions-install-folder': (e) => installFromFolder(BrowserWindow.fromWebContents(e.sender)),
    'extensions-frogee': () => frogeeCatalog(),
    'extensions-remove': async (e, id) => { await removeExtension(id); return { success: true }; },
    'extensions-set-code': (e, { id, enabled } = {}) => setCodeEnabled(id, enabled),
    'extensions-snippets': () => loadSnippets(),
    'extensions-contributions': () => loadContributions(),
    'extensions-open-folder': async () => { await fsp.mkdir(EXT_DIR, { recursive: true }); return shell.openPath(EXT_DIR); },
  };
  for (const [ch, fn] of Object.entries(handlers)) {
    try { ipcMain.removeHandler(ch); } catch {}
    ipcMain.handle(ch, async (...args) => {
      try { return await fn(...args); } catch (err) { return { success: false, error: err.message || String(err) }; }
    });
  }
}

module.exports = { registerExtensionsIpc, convertTheme, parseJsonc, unzipEntries, installVsix, installFromCatalog, installFromFolder, parseTmTheme, keywordsFromGrammar };
