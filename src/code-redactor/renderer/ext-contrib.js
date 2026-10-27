/**
 * Declarative VS Code contributions (languages, grammars, commands) loaded from
 * installed extensions. Extension JS never runs — only package.json data.
 */
import { langFromName } from './smart-edit.js';

const VS_TO_FROGEE = {
  javascript: 'js', javascriptreact: 'jsx', typescript: 'ts', typescriptreact: 'tsx',
  python: 'py', shellscript: 'sh', shell: 'sh', bash: 'sh', csharp: 'cs', 'c++': 'cpp',
  'c#': 'cs', golang: 'go', rust: 'rs', ruby: 'rb', markdown: 'md', dockerfile: 'dockerfile',
  yaml: 'yaml', yml: 'yaml', jsonc: 'json', plaintext: 'plain',
};

let languages = [];
let grammars = [];
let commands = [];
/** Frogee/VS lang id → language-configuration subset */
const configs = new Map();

function frogId(id) {
  const key = String(id || '').toLowerCase();
  return VS_TO_FROGEE[key] || key;
}

function applyToSyntax() {
  const SH = window.SyntaxHighlight;
  if (!SH?.registerExtensionLang) return;
  SH.clearExtensionLangs?.();
  const kwByLang = new Map();
  for (const g of grammars) {
    const id = frogId(g.language);
    if (!id || !g.keywords?.length) continue;
    const prev = kwByLang.get(id) || [];
    kwByLang.set(id, [...new Set([...prev, ...g.keywords])]);
  }
  for (const lang of languages) {
    const id = frogId(lang.id);
    if (!id) continue;
    SH.registerExtensionLang({
      id,
      extensions: lang.extensions || [],
      filenames: lang.filenames || [],
      aliases: lang.aliases || [],
      label: (lang.aliases && lang.aliases[0]) || lang.id,
      keywords: kwByLang.get(id) || [],
      lineComment: lang.config?.lineComment || null,
      blockComment: !!lang.config?.blockComment,
    });
  }
  // Grammars whose language id was not listed under contributes.languages
  for (const [id, kws] of kwByLang) {
    if (languages.some((l) => frogId(l.id) === id)) continue;
    SH.registerExtensionLang({ id, keywords: kws, label: id });
  }
}

function rebuildConfigs() {
  configs.clear();
  for (const lang of languages) {
    const id = frogId(lang.id);
    if (id && lang.config) configs.set(id, lang.config);
  }
}

/** Reload languages / grammars / commands from the main process and push into SyntaxHighlight. */
export async function loadContributions() {
  try {
    const res = await window.electronAPI.extensionsContributions?.();
    if (!res || res.error || res.success === false) {
      languages = [];
      grammars = [];
      commands = [];
    } else {
      languages = Array.isArray(res.languages) ? res.languages : [];
      grammars = Array.isArray(res.grammars) ? res.grammars : [];
      commands = Array.isArray(res.commands) ? res.commands : [];
    }
  } catch {
    languages = [];
    grammars = [];
    commands = [];
  }
  rebuildConfigs();
  applyToSyntax();
}

/** Smart-edit options for a file name: lang id, comment token, auto-closing pairs. */
export function smartOptsFor(fileName = '') {
  const detect = window.SyntaxHighlight?.detectLanguage;
  const lang = (detect ? detect(fileName) : null) || langFromName(fileName);
  const cfg = configs.get(lang) || null;
  const opts = { lang, autoPair: true };
  if (cfg?.lineComment) opts.comment = String(cfg.lineComment);
  if (Array.isArray(cfg?.autoClosingPairs) && cfg.autoClosingPairs.length) {
    const pairs = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
    for (const p of cfg.autoClosingPairs) {
      const open = Array.isArray(p) ? p[0] : p?.open;
      const close = Array.isArray(p) ? p[1] : p?.close;
      if (typeof open === 'string' && open.length === 1 && typeof close === 'string' && close.length >= 1) {
        pairs[open] = close[0];
      }
    }
    opts.pairs = pairs;
  }
  return opts;
}

/**
 * VS Code command ids Frogee can honour → runner keys used by paletteCommandRunners().
 * Unmapped contributes.commands stay hidden (extension code does not run).
 */
const VS_CMD = {
  'workbench.action.files.newUntitledFile': 'newFile',
  'workbench.action.files.openFile': 'open',
  'workbench.action.files.openFileFolder': 'open',
  'workbench.action.files.save': 'save',
  'workbench.action.files.saveAs': 'saveAs',
  'workbench.action.closeActiveEditor': 'closeTab',
  'workbench.action.quickOpen': 'quickOpen',
  'workbench.action.showCommands': 'commands',
  'workbench.action.gotoLine': 'gotoLine',
  'workbench.action.findInFiles': 'search',
  'workbench.view.search': 'search',
  'actions.find': 'find',
  'editor.action.startFindReplaceAction': 'replace',
  'editor.action.formatDocument': 'format',
  'editor.action.marker.next': 'nextProblem',
  'workbench.action.terminal.toggleTerminal': 'terminal',
  'workbench.action.togglePanel': 'terminal',
  'workbench.view.explorer': 'explorer',
  'workbench.view.scm': 'git',
  'workbench.action.toggleSidebarVisibility': 'sidebar',
  'workbench.action.openSettings': 'settings',
  'workbench.action.toggleZenMode': 'zen',
  'markdown.showPreview': 'mdPreview',
  'markdown.showPreviewToSide': 'mdPreview',
};

/** Palette entries for installed extension commands that map onto Frogee actions. */
export function extensionPaletteCommands(runners) {
  if (!runners) return [];
  const seen = new Set();
  const out = [];
  for (const c of commands) {
    const key = VS_CMD[c.command];
    if (!key || !runners[key] || seen.has(c.command)) continue;
    seen.add(c.command);
    const title = c.category ? `${c.category}: ${c.title}` : c.title;
    out.push({
      label: title,
      detail: c.extension ? `расширение · ${c.extension}` : 'расширение',
      run: runners[key],
    });
  }
  return out;
}

export function getContributions() {
  return { languages, grammars, commands };
}
