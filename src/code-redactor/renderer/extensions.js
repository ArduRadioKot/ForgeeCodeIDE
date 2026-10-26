/**
 * The "Расширения" side panel: search Open VSX, install and remove VS Code extensions.
 * From an extension the editor takes its colour themes (they join the theme list) and snippets (they join the suggestions);
 * extension code is never run.
 */
import { state } from './state.js';
import { getDom } from './dom.js';
import { escapeHtml } from './utils.js';
import { toast } from './image-view.js';
import { loadCustomThemes } from './themes.js';
import { enablePluginFiles, disablePluginFiles } from './plugins.js';

const dom = getDom();
let installed = [];
let results = [];
let frogeeList = []; // the catalog of extensions for FrogeeCodeIDE on the project site
let frogeeError = '';
let lastQuery = null;
let searchTimer = 0;
const busy = new Set(); // ids being installed or removed

// ───────────────────────── snippets for the suggestions ─────────────────────────

let snippetSets = [];
// FrogeeCodeIDE language (window.SyntaxHighlight.detectLanguage) -> VS Code language ids
const VS_LANG = {
  js: ['javascript', 'javascriptreact'], jsx: ['javascriptreact', 'javascript'], ts: ['typescript', 'typescriptreact'], tsx: ['typescriptreact', 'typescript'],
  py: ['python'], html: ['html'], css: ['css'], scss: ['scss', 'css'], less: ['less', 'css'], json: ['json', 'jsonc'], md: ['markdown'],
  go: ['go'], rs: ['rust'], java: ['java'], kt: ['kotlin'], c: ['c'], cpp: ['cpp'], cs: ['csharp'], sh: ['shellscript'], yaml: ['yaml'],
  php: ['php'], rb: ['ruby'], swift: ['swift'], sql: ['sql'], lua: ['lua'], vue: ['vue', 'html'], dart: ['dart'], pde: ['processing', 'java'],
};

export async function loadSnippets() {
  try {
    const res = await window.electronAPI.extensionsSnippets();
    snippetSets = Array.isArray(res) ? res : [];
  } catch {
    snippetSets = [];
  }
}

/** Snippets that apply to a FrogeeCodeIDE language id: [{ prefix, body, description, name, extension }]. */
export function snippetsFor(lang) {
  const ids = VS_LANG[lang] || [lang];
  const out = [];
  const seen = new Set();
  for (const set of snippetSets) {
    const all = !set.language || set.language === '*';
    for (const item of set.items) {
      // a snippet file without a language ("global" snippets) names its languages in "scope"
      const scopes = item.scope ? item.scope.split(',').map((s) => s.trim()) : null;
      if (!all && !ids.includes(set.language)) continue;
      if (all && scopes && !scopes.some((s) => ids.includes(s))) continue;
      for (const prefix of item.prefix) {
        // the same snippet often comes for javascript and javascriptreact: offer it once
        const key = `${prefix}\u0000${item.body}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ prefix, body: item.body, description: item.description || item.name, extension: set.extension });
      }
    }
  }
  return out;
}

/**
 * Turns a VS Code snippet body into plain text: placeholders become their default text, choices their first option,
 * known variables are filled in. Returns the text and where the caret goes ($1, else $0, else the end).
 */
export function expandSnippet(body, { indent = '', fileName = '', selection = '', tabUnit = '\t' } = {}) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const vars = {
    TM_FILENAME: fileName, TM_FILENAME_BASE: fileName.replace(/\.[^.]+$/, ''), TM_SELECTED_TEXT: selection, SELECTION: selection,
    CURRENT_YEAR: String(now.getFullYear()), CURRENT_YEAR_SHORT: String(now.getFullYear()).slice(2), CURRENT_MONTH: pad(now.getMonth() + 1),
    CURRENT_DATE: pad(now.getDate()), CURRENT_HOUR: pad(now.getHours()), CURRENT_MINUTE: pad(now.getMinutes()), CURRENT_SECOND: pad(now.getSeconds()),
    UUID: (crypto.randomUUID ? crypto.randomUUID() : ''), BLOCK_COMMENT_START: '/*', BLOCK_COMMENT_END: '*/', LINE_COMMENT: '//',
  };
  const stops = new Map(); // tab stop number -> offset in the expanded text (before indenting)
  const mark = (n, at) => { if (!stops.has(n)) stops.set(n, at); };
  const defaults = new Map(); // a repeated $1 repeats the text of ${1:...}
  const text = String(body).replace(/\t/g, tabUnit); // tabs in snippet bodies follow the editor's indent setting
  let i = 0;
  // Reads text until the end, or until the "}" closing a ${n:...} when nested; base is where that text starts in the output.
  function parse(nested, base) {
    let acc = '';
    while (i < text.length) {
      const c = text[i];
      if (c === '\\' && i + 1 < text.length) { acc += text[i + 1]; i += 2; continue; }
      if (nested && c === '}') { i++; return acc; }
      if (c === '$') {
        const rest = text.slice(i);
        let m;
        if ((m = /^\$(\d+)/.exec(rest)) || (m = /^\$\{(\d+)\}/.exec(rest))) { mark(+m[1], base + acc.length); acc += defaults.get(+m[1]) || ''; i += m[0].length; continue; }
        if ((m = /^\$\{(\d+)\|([^|]*)\|\}/.exec(rest))) { mark(+m[1], base + acc.length); const pick = m[2].split(',')[0]; if (!defaults.has(+m[1])) defaults.set(+m[1], pick); acc += pick; i += m[0].length; continue; }
        if ((m = /^\$\{(\d+):/.exec(rest))) { mark(+m[1], base + acc.length); i += m[0].length; const inner = parse(true, base + acc.length); if (!defaults.has(+m[1])) defaults.set(+m[1], inner); acc += inner; continue; }
        if ((m = /^\$\{([A-Za-z_]+):/.exec(rest))) { i += m[0].length; const def = parse(true, base + acc.length); acc += vars[m[1]] || def; continue; }
        if ((m = /^\$\{([A-Za-z_]+)\}/.exec(rest)) || (m = /^\$([A-Za-z_]+)/.exec(rest))) { acc += vars[m[1]] ?? ''; i += m[0].length; continue; }
      }
      acc += c;
      i++;
    }
    return acc;
  }
  const plain = parse(false, 0);
  const first = [...stops.keys()].filter((n) => n > 0).sort((a, b) => a - b)[0];
  const at = first != null ? stops.get(first) : stops.has(0) ? stops.get(0) : plain.length;
  // following lines get the indentation of the line the snippet starts on
  const linesBefore = plain.slice(0, at).split('\n').length - 1;
  // the first placeholder's text is selected, so typing replaces it (as in VS Code)
  const selected = first != null ? (defaults.get(first) || '').length : 0;
  return { text: plain.split('\n').join('\n' + indent), caret: at + linesBefore * indent.length, selected };
}

// ───────────────────────── panel ─────────────────────────

const panel = () => document.getElementById('ext-panel');

function fmtDownloads(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace('.0', '')} млн`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} тыс.`;
  return String(n || 0);
}

function iconHtml(ext) {
  return ext.icon
    ? `<img class="ext-icon" src="${escapeHtml(ext.icon)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : `<span class="ext-icon ext-icon-letter">${escapeHtml((ext.displayName || ext.name || '?').slice(0, 1).toUpperCase())}</span>`;
}

/** true when version a is later than b ("1.10.0" > "1.9.2"). */
function newerVersion(a, b) {
  const pa = String(a || '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

function row(ext, isInstalled) {
  const id = ext.id;
  const working = busy.has(id);
  const parts = [];
  if (!isInstalled && ext.frogee) {
    if (ext.plugins) parts.push(`плагины: ${ext.plugins}`);
    if (ext.themes) parts.push(`темы: ${ext.themes}`);
    if (ext.snippets) parts.push(`сниппеты: ${ext.snippets}`);
  }
  if (isInstalled) {
    if (ext.pluginFiles?.length) parts.push(`плагины: ${ext.pluginFiles.length}`);
    if (ext.themeIds?.length) parts.push(`темы: ${ext.themeIds.length}`);
    if (ext.snippets?.length) parts.push(`сниппеты: ${ext.snippets.length}`);
  }
  const newer = isInstalled ? frogeeList.find((x) => x.id === id && newerVersion(x.version, ext.version)) : null;
  const action = isInstalled
    ? `${newer ? `<button type="button" class="ext-btn" data-install="${escapeHtml(id)}" ${working ? 'disabled' : ''}>Обновить до ${escapeHtml(newer.version)}</button>` : ''}${ext.themeIds?.length ? `<button type="button" class="ext-btn" data-apply="${escapeHtml(id)}">Применить тему</button>` : ''}<button type="button" class="ext-btn ghost" data-remove="${escapeHtml(id)}" ${working ? 'disabled' : ''}>${working ? 'Удаление…' : 'Удалить'}</button>`
    : `<button type="button" class="ext-btn" data-install="${escapeHtml(id)}" ${working ? 'disabled' : ''}>${working ? 'Установка…' : 'Установить'}</button>`;
  return `<div class="ext-row" data-id="${escapeHtml(id)}">
    ${iconHtml(ext)}
    <div class="ext-main">
      <div class="ext-name">${escapeHtml(ext.displayName || ext.name)}${ext.version ? ` <span>${escapeHtml(ext.version)}</span>` : ''}</div>
      <div class="ext-meta">${ext.forFrogee || ext.frogee ? '<em class="ext-badge">для FrogeeCodeIDE</em>' : ''}${escapeHtml(ext.namespace || '')}${ext.downloads != null && !isInstalled ? ` · ${fmtDownloads(ext.downloads)} загрузок` : ''}${parts.length ? ` · ${escapeHtml(parts.join(', '))}` : ''}</div>
      ${ext.description ? `<div class="ext-desc">${escapeHtml(ext.description)}</div>` : ''}
      <div class="ext-actions">${action}</div>
    </div>
  </div>`;
}

function render() {
  const host = panel();
  if (!host) return;
  const ids = new Set(installed.map((e) => e.id));
  host.querySelector('#ext-installed').innerHTML = installed.length
    ? installed.map((e) => row(e, true)).join('')
    : '<p class="ext-empty">Пока ничего не установлено. Своё расширение можно поставить из папки кнопкой с плюсом вверху.</p>';
  host.querySelector('#ext-installed-title').hidden = false;
  const frogee = frogeeList.filter((e) => !ids.has(e.id)).map((e) => ({ ...e, frogee: true }));
  const fSec = host.querySelector('#ext-frogee');
  fSec.innerHTML = frogee.length
    ? frogee.map((e) => row(e, false)).join('')
    : `<p class="ext-empty${frogeeError ? ' ext-error' : ''}">${frogeeError ? `Каталог расширений на сайте недоступен: ${escapeHtml(frogeeError)}. Проверьте интернет.` : frogeeList.length ? 'Все расширения из каталога уже установлены.' : 'В каталоге пока пусто.'}</p>`;
  host.querySelector('#ext-frogee-title').hidden = !!lastQuery;
  fSec.hidden = !!lastQuery;
  const fIds = new Set(frogee.map((e) => e.id));
  const list = results.filter((e) => !ids.has(e.id) && (lastQuery || !fIds.has(e.id)));
  host.querySelector('#ext-results').innerHTML = list.length
    ? list.map((e) => row(e, false)).join('')
    : `<p class="ext-empty">${lastQuery ? 'Ничего не найдено. Попробуйте другое название.' : ''}</p>`;
  host.querySelector('#ext-results-title').textContent = lastQuery ? `Open VSX: «${lastQuery}»` : 'Популярное в Open VSX: темы';
}

async function refreshInstalled() {
  const res = await window.electronAPI.extensionsInstalled();
  installed = Array.isArray(res) ? res : [];
}

async function runSearch(query) {
  lastQuery = query;
  const host = panel();
  if (host) host.querySelector('#ext-results').innerHTML = '<p class="ext-empty">Ищу…</p>';
  const res = await window.electronAPI.extensionsSearch(query ? { query } : { category: 'Themes' });
  if (query !== lastQuery) return; // a newer search started
  if (!Array.isArray(res)) {
    results = [];
    if (host) host.querySelector('#ext-results').innerHTML = `<p class="ext-empty ext-error">Open VSX недоступен: ${escapeHtml(res?.error || 'нет связи')}. Проверьте интернет и повторите поиск.</p>`;
    return;
  }
  results = res;
  render();
}

function applyTheme(ext) {
  const select = document.getElementById('theme-select');
  const id = ext?.themeIds?.[0];
  if (!select || !id) return;
  select.value = `custom:${id}`;
  if (select.value !== `custom:${id}`) { toast('Тема ещё не в списке: откройте Настройки → Внешний вид'); return; }
  select.dispatchEvent(new Event('change'));
  toast(`Тема «${ext.themes?.[0] || ext.displayName}» применена`);
}

async function afterInstall(res) {
  if (res?.canceled) return;
  if (!res?.success) { toast(res?.error || 'Не удалось установить расширение'); return; }
  const got = res.extension;
  await Promise.all([refreshInstalled(), loadCustomThemes(), loadSnippets()]);
  if (got.pluginFiles?.length) await enablePluginFiles(got.pluginFiles);
  const what = [
    got.pluginFiles?.length ? `плагинов: ${got.pluginFiles.length}` : '',
    got.themeIds?.length ? `тем: ${got.themeIds.length}` : '',
    got.snippets?.length ? `наборов сниппетов: ${got.snippets.length}` : '',
  ].filter(Boolean).join(', ');
  const codeNote = got.hasCode && !got.forFrogee ? '. Код расширения VS Code не запускается.' : '';
  toast(`«${got.displayName}» установлено (${what})${codeNote}`);
  if (res.problems?.length) console.warn('[extensions]', res.problems);
}

async function onClick(e) {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.id === 'ext-open-folder') { window.electronAPI.extensionsOpenFolder(); return; }
  if (b.id === 'ext-from-folder') {
    b.disabled = true;
    try { await afterInstall(await window.electronAPI.extensionsInstallFolder()); } finally { b.disabled = false; render(); }
    return;
  }
  if (b.dataset.apply) { applyTheme(installed.find((x) => x.id === b.dataset.apply)); return; }
  const id = b.dataset.install || b.dataset.remove;
  if (!id || busy.has(id)) return;
  busy.add(id);
  render();
  try {
    if (b.dataset.install) {
      const fromSite = frogeeList.find((x) => x.id === id);
      const ext = fromSite || results.find((x) => x.id === id);
      const res = await window.electronAPI.extensionsInstall({ namespace: ext.namespace, name: ext.name, source: fromSite ? 'frogee' : 'open-vsx' });
      await afterInstall(res);
    } else {
      const ext = installed.find((x) => x.id === id);
      const select = document.getElementById('theme-select');
      const usesTheme = ext?.themeIds?.some((t) => select?.value === `custom:${t}`);
      await disablePluginFiles(ext?.pluginFiles || []);
      const res = await window.electronAPI.extensionsRemove(id);
      if (!res?.success) { toast(res?.error || 'Не удалось удалить расширение'); return; }
      await Promise.all([refreshInstalled(), loadCustomThemes(), loadSnippets()]);
      if (usesTheme && select) { select.value = 'dark'; select.dispatchEvent(new Event('change')); }
      toast(`«${ext?.displayName || id}» удалено`);
    }
  } finally {
    busy.delete(id);
    render();
  }
}

export async function showExtensionsPanel() {
  dom.activityPanel.innerHTML = `
    <div class="activity-header"><h3>Расширения</h3>
      <div class="activity-buttons"><button class="activity-btn" id="ext-from-folder" title="Установить из папки (с extension.json)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/><path d="M12 10v6M9 13h6"/></svg></button><button class="activity-btn" id="ext-open-folder" title="Открыть папку установленных расширений"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-8 8M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/></svg></button></div>
    </div>
    <div class="ext-panel" id="ext-panel">
      <input type="search" class="ext-search" id="ext-search" placeholder="Поиск в Open VSX: темы и сниппеты VS Code" spellcheck="false" value="${escapeHtml(lastQuery || '')}">
      <p class="ext-note">Расширения для FrogeeCodeIDE берутся из каталога на сайте или из папки и работают полностью. Поиск ниже идёт по Open VSX: из расширений VS Code берутся темы оформления и сниппеты, их код не запускается.</p>
      <div class="run-title" id="ext-installed-title" hidden>Установленные</div>
      <div id="ext-installed"></div>
      <div class="run-title" id="ext-frogee-title">Для FrogeeCodeIDE <a class="ext-link" href="https://arduradiokot.github.io/ForgeeCodeIDE/extensions.html" target="_blank" rel="noopener">каталог на сайте</a></div>
      <div id="ext-frogee"><p class="ext-empty">Загрузка…</p></div>
      <div class="run-title" id="ext-results-title">Популярное в Open VSX: темы</div>
      <div id="ext-results"><p class="ext-empty">Загрузка…</p></div>
    </div>`;
  // the side panel element stays, its content is replaced: listeners go on the new elements only
  const host = dom.activityPanel;
  host.querySelector('#ext-panel').addEventListener('click', onClick);
  host.querySelector('#ext-open-folder').addEventListener('click', onClick);
  host.querySelector('#ext-from-folder').addEventListener('click', onClick);
  const input = host.querySelector('#ext-search');
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(input.value.trim()), 350);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(searchTimer); runSearch(input.value.trim()); } });
  await refreshInstalled();
  render();
  window.electronAPI.extensionsFrogee().then((list) => {
    frogeeList = Array.isArray(list) ? list : [];
    frogeeError = Array.isArray(list) ? '' : (list?.error || 'нет связи');
    if (panel()) render();
  });
  if (results.length && lastQuery !== null) render();
  else runSearch(lastQuery || '');
}

export function setupExtensions() {
  loadSnippets();
}

state.extensions = { snippetsFor, expandSnippet };
