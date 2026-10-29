/**
 * The "Расширения" side panel: search Open VSX, install and remove VS Code extensions.
 * From VS Code packages Frogee takes declarative data only (themes, snippets, languages,
 * language-configuration, JSON grammar keywords, mappable commands). Extension JS never runs.
 */
import { state } from './state.js';
import { getDom } from './dom.js';
import { escapeHtml } from './utils.js';
import { toast } from './image-view.js';
import { loadCustomThemes } from './themes.js';
import { enablePluginFiles, disablePluginFiles } from './plugins.js';
import { loadContributions } from './ext-contrib.js';
import { activateExtensionRuntime, deactivateExtensionRuntime } from './vscode-bridge.js';
import { icon } from './glyphs.js';
import { getLang, onLangChange, t } from './i18n.js';

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
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace('.0', '')}${getLang() === 'en' ? 'M' : ' млн'}`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}${getLang() === 'en' ? 'K' : ' тыс.'}`;
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
  const en = getLang() === 'en';
  const working = busy.has(id);
  const parts = [];
  if (!isInstalled && ext.frogee) {
    if (ext.plugins) parts.push(`${en ? 'plugins' : 'плагины'}: ${ext.plugins}`);
    if (ext.themes) parts.push(`${en ? 'themes' : 'темы'}: ${ext.themes}`);
    if (ext.snippets) parts.push(`${en ? 'snippets' : 'сниппеты'}: ${ext.snippets}`);
  }
  if (isInstalled) {
    if (ext.pluginFiles?.length) parts.push(`${en ? 'plugins' : 'плагины'}: ${ext.pluginFiles.length}`);
    if (ext.themeIds?.length) parts.push(`${en ? 'themes' : 'темы'}: ${ext.themeIds.length}`);
    if (ext.snippets?.length) parts.push(`${en ? 'snippets' : 'сниппеты'}: ${ext.snippets.length}`);
    if (ext.languages?.length) parts.push(`${en ? 'languages' : 'языки'}: ${ext.languages.length}`);
    if (ext.grammars?.length) parts.push(`${en ? 'grammars' : 'грамматики'}: ${ext.grammars.length}`);
    if (ext.commands?.length) parts.push(`${en ? 'commands' : 'команды'}: ${ext.commands.length}`);
    if (ext.main) parts.push(ext.codeEnabled ? (en ? 'code: enabled' : 'код: включён') : (en ? 'code: off' : 'код: выкл.'));
  }
  const newer = isInstalled ? frogeeList.find((x) => x.id === id && newerVersion(x.version, ext.version)) : null;
  const codeBtn = isInstalled && ext.main
    ? (ext.codeEnabled
      ? `<button type="button" class="ext-btn ghost" data-code-off="${escapeHtml(id)}" ${working ? 'disabled' : ''}>${t('ext.stopCode')}</button>`
      : `<button type="button" class="ext-btn" data-code-on="${escapeHtml(id)}" ${working ? 'disabled' : ''}>${t('ext.runCode')}</button>`)
    : '';
  const action = isInstalled
    ? `${newer ? `<button type="button" class="ext-btn" data-install="${escapeHtml(id)}" ${working ? 'disabled' : ''}>${en ? 'Update to' : 'Обновить до'} ${escapeHtml(newer.version)}</button>` : ''}${ext.themeIds?.length ? `<button type="button" class="ext-btn" data-apply="${escapeHtml(id)}">${t('ext.applyTheme')}</button>` : ''}${codeBtn}<button type="button" class="ext-btn ghost" data-remove="${escapeHtml(id)}" ${working ? 'disabled' : ''}>${t(working ? 'ext.removing' : 'ext.remove')}</button>`
    : `<button type="button" class="ext-btn" data-install="${escapeHtml(id)}" ${working ? 'disabled' : ''}>${t(working ? 'ext.installing' : 'ext.install')}</button>`;
  return `<div class="ext-row" data-id="${escapeHtml(id)}">
    ${iconHtml(ext)}
    <div class="ext-main">
      <div class="ext-name">${escapeHtml(ext.displayName || ext.name)}${ext.version ? ` <span>${escapeHtml(ext.version)}</span>` : ''}</div>
      <div class="ext-meta">${ext.forFrogee || ext.frogee ? `<em class="ext-badge">${en ? 'for' : 'для'} FrogeeCodeIDE</em>` : ''}${escapeHtml(ext.namespace || '')}${ext.downloads != null && !isInstalled ? ` · ${fmtDownloads(ext.downloads)} ${en ? 'downloads' : 'загрузок'}` : ''}${parts.length ? ` · ${escapeHtml(parts.join(', '))}` : ''}</div>
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
    : `<p class="ext-empty">${t('ext.empty')}</p>`;
  host.querySelector('#ext-installed-title').hidden = false;
  const frogee = frogeeList.filter((e) => !ids.has(e.id)).map((e) => ({ ...e, frogee: true }));
  const fSec = host.querySelector('#ext-frogee');
  fSec.innerHTML = frogee.length
    ? frogee.map((e) => row(e, false)).join('')
    : `<p class="ext-empty${frogeeError ? ' ext-error' : ''}">${frogeeError ? (getLang() === 'en' ? `The website extension catalog is unavailable: ${escapeHtml(frogeeError)}. Check your connection.` : `Каталог расширений на сайте недоступен: ${escapeHtml(frogeeError)}. Проверьте интернет.`) : frogeeList.length ? (getLang() === 'en' ? 'All catalog extensions are installed.' : 'Все расширения из каталога уже установлены.') : (getLang() === 'en' ? 'The catalog is empty.' : 'В каталоге пока пусто.')}</p>`;
  host.querySelector('#ext-frogee-title').hidden = !!lastQuery;
  fSec.hidden = !!lastQuery;
  const fIds = new Set(frogee.map((e) => e.id));
  const list = results.filter((e) => !ids.has(e.id) && (lastQuery || !fIds.has(e.id)));
  host.querySelector('#ext-results').innerHTML = list.length
    ? list.map((e) => row(e, false)).join('')
    : `<p class="ext-empty">${lastQuery ? 'Ничего не найдено. Попробуйте другое название.' : ''}</p>`;
  host.querySelector('#ext-results-title').textContent = lastQuery ? `Open VSX: «${lastQuery}»` : t('ext.popular');
}

onLangChange(() => { if (panel()) render(); });

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
    if (host) host.querySelector('#ext-results').innerHTML = `<p class="ext-empty ext-error">${getLang() === 'en' ? 'Open VSX is unavailable' : 'Open VSX недоступен'}: ${escapeHtml(res?.error || (getLang() === 'en' ? 'no connection' : 'нет связи'))}. ${getLang() === 'en' ? 'Check your connection and try again.' : 'Проверьте интернет и повторите поиск.'}</p>`;
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
  if (select.value !== `custom:${id}`) { toast(getLang() === 'en' ? 'Theme not listed yet: open Settings → Appearance' : 'Тема ещё не в списке: откройте Настройки → Внешний вид'); return; }
  select.dispatchEvent(new Event('change'));
  toast(getLang() === 'en' ? `Theme “${ext.themes?.[0] || ext.displayName}” applied` : `Тема «${ext.themes?.[0] || ext.displayName}» применена`);
}

async function afterInstall(res) {
  if (res?.canceled) return;
  if (!res?.success) { toast(res?.error || (getLang() === 'en' ? 'Could not install extension' : 'Не удалось установить расширение')); return; }
  const got = res.extension;
  await Promise.all([refreshInstalled(), loadCustomThemes(), loadSnippets(), loadContributions()]);
  if (got.pluginFiles?.length) await enablePluginFiles(got.pluginFiles);
  const en = getLang() === 'en';
  const what = [
    got.pluginFiles?.length ? `${en ? 'plugins' : 'плагинов'}: ${got.pluginFiles.length}` : '',
    got.themeIds?.length ? `${en ? 'themes' : 'тем'}: ${got.themeIds.length}` : '',
    got.snippets?.length ? `${en ? 'snippet sets' : 'наборов сниппетов'}: ${got.snippets.length}` : '',
    got.languages?.length ? `${en ? 'languages' : 'языков'}: ${got.languages.length}` : '',
    got.grammars?.length ? `${en ? 'grammars' : 'грамматик'}: ${got.grammars.length}` : '',
    got.commands?.length ? `${en ? 'commands' : 'команд'}: ${got.commands.length}` : '',
    got.codeEnabled ? (en ? 'code running' : 'код запущен') : (got.main ? (en ? 'code off' : 'код выкл.') : ''),
  ].filter(Boolean).join(', ');
  toast(en ? `“${got.displayName}” installed (${what || 'data enabled'})` : `«${got.displayName}» установлено (${what || 'данные подключены'})`);
  if (got.codeEnabled) {
    const act = await activateExtensionRuntime(got.id);
    if (act?.ok === false) toast(`Код «${got.displayName}»: ${act.error}`);
  }
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
  if (b.dataset.codeOn || b.dataset.codeOff) {
    const id = b.dataset.codeOn || b.dataset.codeOff;
    const on = !!b.dataset.codeOn;
    if (busy.has(id)) return;
    busy.add(id);
    render();
    try {
      if (on) {
        const name = installed.find((x) => x.id === id)?.displayName || id;
        const ok = window.confirm(getLang() === 'en' ? `Run extension code “${name}”?\n\nIt runs with editor permissions through Frogee’s vscode.* API (not full VS Code).` : `Запустить код расширения «${name}»?\n\nКод выполняется с правами редактора через vscode.* API Frogee (не полный VS Code).`);
        if (!ok) return;
        const res = await window.electronAPI.extensionsSetCode({ id, enabled: true });
        if (!res?.success) { toast(res?.error || (getLang() === 'en' ? 'Could not enable code' : 'Не удалось включить код')); return; }
        await refreshInstalled();
        const act = await activateExtensionRuntime(id);
        toast(act?.ok === false ? `${getLang() === 'en' ? 'Error' : 'Ошибка'}: ${act.error}` : (getLang() === 'en' ? 'Extension code started' : 'Код расширения запущен'));
      } else {
        await deactivateExtensionRuntime(id);
        await window.electronAPI.extensionsSetCode({ id, enabled: false });
        await refreshInstalled();
        toast(getLang() === 'en' ? 'Extension code stopped' : 'Код расширения остановлен');
      }
    } finally {
      busy.delete(id);
      render();
    }
    return;
  }
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
      if (ext?.codeEnabled) await deactivateExtensionRuntime(id);
      await disablePluginFiles(ext?.pluginFiles || []);
      const res = await window.electronAPI.extensionsRemove(id);
      if (!res?.success) { toast(res?.error || (getLang() === 'en' ? 'Could not remove extension' : 'Не удалось удалить расширение')); return; }
      await Promise.all([refreshInstalled(), loadCustomThemes(), loadSnippets(), loadContributions()]);
      if (usesTheme && select) { select.value = 'dark'; select.dispatchEvent(new Event('change')); }
      toast(getLang() === 'en' ? `“${ext?.displayName || id}” removed` : `«${ext?.displayName || id}» удалено`);
    }
  } finally {
    busy.delete(id);
    render();
  }
}

export async function showExtensionsPanel() {
  dom.activityPanel.innerHTML = `
    <div class="activity-header"><h3>Расширения</h3>
      <div class="activity-buttons"><button class="activity-btn" id="ext-from-folder" title="Установить из папки (с extension.json)">${icon('folderAdd', 16)}</button><button class="activity-btn" id="ext-open-folder" title="Открыть папку установленных расширений">${icon('folderOpen', 16)}</button></div>
    </div>
    <div class="ext-panel" id="ext-panel">
      <input type="search" class="ext-search" id="ext-search" placeholder="Поиск в Open VSX: темы, сниппеты, языки…" spellcheck="false" value="${escapeHtml(lastQuery || '')}">
      <p class="ext-note" data-i18n="ext.note">${t('ext.note')}</p>
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
  loadContributions();
}

state.extensions = { snippetsFor, expandSnippet };
