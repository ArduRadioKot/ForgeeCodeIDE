/**
 * Sidebar search: live results for the current file or the whole project, with case / whole word / regex,
 * include & exclude globs, .gitignore awareness, grouped collapsible results, keyboard navigation and replace.
 */
import { state } from './state.js';
import { getDom } from './dom.js';
import { escapeHtml, pathUtils } from './utils.js';
import { openSearchFileAtLine, goToEditorLine } from './explorer.js';
import { icon } from './glyphs.js';

const dom = getDom();
const STORE = 'frogee.search';
const DEBOUNCE = 260;

const opts = { mode: 'workspace', caseSensitive: false, wholeWord: false, regex: false, include: '', exclude: '', replaceOpen: false };
let timer = 0;
let seq = 0;
let currentId = '';
let last = null;
const collapsed = new Set();
const excluded = new Set();

try { Object.assign(opts, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch { /* defaults */ }
const persist = () => { try { localStorage.setItem(STORE, JSON.stringify(opts)); } catch { /* private mode */ } };
const $ = (id) => document.getElementById(id);

function buildRegex(query) {
  let src = opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (opts.wholeWord) src = `(?<![A-Za-z0-9_])(?:${src})(?![A-Za-z0-9_])`;
  return new RegExp(src, `${opts.caseSensitive ? '' : 'i'}g`);
}

function lineHtml(m) {
  const lead = m.text.length - m.text.trimStart().length;
  let text = m.text.slice(lead);
  let col = m.col - m.offset - lead;
  let prefix = m.offset > 0 ? '…' : '';
  if (col > 70) { text = text.slice(col - 40); prefix = '…'; col = 40; }
  const end = col + m.length;
  return `${prefix}${escapeHtml(text.slice(0, col))}<mark class="search-match">${escapeHtml(text.slice(col, end))}</mark>${escapeHtml(text.slice(end, end + 160))}`;
}

function placeholder(text, error = false) {
  $('search-results').innerHTML = `<div class="search-placeholder${error ? ' error' : ''}">${escapeHtml(text)}</div>`;
  $('search-actions').hidden = true;
}

function searchInFile(query) {
  const tab = state.currentTabs[state.activeTabIndex];
  if (!tab || !dom.editor || tab.kind === 'browser' || tab.kind === 'terminal' || tab.kind === 'notebook') return placeholder('Откройте файл для поиска');
  let re;
  try { re = buildRegex(query); } catch { return placeholder('Неверное регулярное выражение', true); }
  const matches = [];
  dom.editor.value.split('\n').forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line)) !== null) {
      if (!m[0]) { re.lastIndex++; continue; }
      matches.push({ line: i + 1, col: m.index, length: m[0].length, text: line, offset: 0 });
      if (matches.length >= 2000) return;
    }
  });
  last = matches.length ? { results: [{ file: tab.name, fullPath: tab.filePath || '', matches, matchCount: matches.length, current: true }], totalMatches: matches.length } : null;
  if (!last) return placeholder('Ничего не найдено');
  renderResults(last, `${matches.length} в ${tab.name}`);
}

async function searchInProject(query) {
  if (!state.currentFolder) return placeholder('Откройте папку, чтобы искать по проекту');
  if (!window.electronAPI?.projectSearch) {
    return placeholder('Поиск недоступен — пересоберите / перезапустите приложение', true);
  }
  if (currentId) {
    try { window.electronAPI.projectSearchCancel?.(currentId); } catch { /* ignore */ }
  }
  const mine = ++seq;
  currentId = `s${mine}`;
  const box = $('search-results');
  if (box) box.classList.add('busy');
  let res;
  try {
    res = await window.electronAPI.projectSearch({
      id: currentId, root: state.currentFolder, query, caseSensitive: opts.caseSensitive, wholeWord: opts.wholeWord, regex: opts.regex,
      include: opts.include, exclude: opts.exclude,
    });
  } catch (err) {
    if (mine === seq && box) box.classList.remove('busy');
    return placeholder(err?.message || 'Ошибка поиска', true);
  }
  if (mine !== seq || res?.cancelled) return;
  if (box) box.classList.remove('busy');
  if (!res || !res.success) return placeholder(res?.error || 'Ошибка поиска', true);
  if (!res.results?.length) { last = null; return placeholder(`Ничего не найдено (просмотрено файлов: ${res.filesScanned || 0})`); }
  last = { ...res, query };
  excluded.clear();
  const files = res.results.length;
  renderResults(last, `${res.totalMatches}${res.truncated ? '+' : ''} в ${files} ${plural(files, 'файле', 'файлах', 'файлах')}`);
}

const plural = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many);

function renderResults(res, summary) {
  const project = opts.mode === 'workspace';
  const html = res.results.map((f, fi) => {
    const closed = collapsed.has(f.fullPath || f.file);
    const name = pathUtils.basename(f.file);
    const dir = f.file.slice(0, f.file.length - name.length).replace(/[\\/]$/, '');
    const rows = closed ? '' : f.matches.map((m, mi) => `<div class="search-match-line" tabindex="-1" data-f="${fi}" data-m="${mi}"><span class="search-line-number">${m.line}</span><span class="search-line-text">${lineHtml(m)}</span></div>`).join('');
    return `<div class="search-file-group" data-f="${fi}">
      <div class="search-file-header" tabindex="-1" data-f="${fi}">
        <span class="tree-twistie ${closed ? '' : 'open'}" aria-hidden="true"></span>
        <span class="search-file-name">${escapeHtml(name)}</span>
        <span class="search-file-dir">${escapeHtml(dir)}</span>
        <span class="search-file-matches">${f.matchCount}</span>
        ${project && opts.replaceOpen ? `<button type="button" class="search-skip${excluded.has(f.fullPath) ? ' on' : ''}" data-skip="${fi}" title="${excluded.has(f.fullPath) ? 'Вернуть в замену' : 'Не заменять в этом файле'}">${excluded.has(f.fullPath) ? icon('plus', 10) : icon('close', 10)}</button>` : ''}
      </div>${rows}</div>`;
  }).join('');
  $('search-results').innerHTML = `<div class="search-summary">${escapeHtml(summary)}${res.truncated ? ' · показаны не все результаты' : ''}</div>${html}`;
  $('search-actions').hidden = !(project && opts.replaceOpen);
  updateReplaceButton();
}

function updateReplaceButton() {
  const btn = $('search-replace-all');
  if (!btn || !last) return;
  const files = last.results.filter((f) => !excluded.has(f.fullPath));
  const count = files.reduce((n, f) => n + f.matchCount, 0);
  btn.textContent = `Заменить все (${count})`;
  btn.disabled = !count;
}

function run() {
  const query = $('search-input').value;
  if (!query) { last = null; if (currentId) window.electronAPI.projectSearchCancel(currentId); return placeholder(opts.mode === 'file' ? 'Введите текст для поиска в текущем файле' : 'Введите текст для поиска по проекту'); }
  if (opts.mode === 'file') return searchInFile(query);
  try { buildRegex(query); } catch (e) { return placeholder('Неверное регулярное выражение', true); }
  return searchInProject(query);
}

const schedule = () => { clearTimeout(timer); timer = setTimeout(run, DEBOUNCE); };

async function replaceAll() {
  if (!last || opts.mode !== 'workspace') return;
  const files = last.results.filter((f) => !excluded.has(f.fullPath));
  const count = files.reduce((n, f) => n + f.matchCount, 0);
  if (!count) return;
  const replacement = $('replace-input-sidebar').value;
  const modified = state.currentTabs.filter((t) => t.modified && t.filePath && files.some((f) => f.fullPath === t.filePath));
  const note = modified.length ? `\n\nНесохранённые изменения в открытых файлах (${modified.map((t) => t.name).join(', ')}) могут быть потеряны.` : '';
  if (!window.confirm(`Заменить «${$('search-input').value}» на «${replacement}»: ${count} в ${files.length} ${plural(files.length, 'файле', 'файлах', 'файлах')}?${note}\nДействие нельзя отменить.`)) return;
  const res = await window.electronAPI.projectReplace({ root: state.currentFolder, files: files.map((f) => f.fullPath), query: $('search-input').value, replacement, caseSensitive: opts.caseSensitive, wholeWord: opts.wholeWord, regex: opts.regex });
  if (!res.success) return placeholder(res.error || 'Не удалось заменить', true);
  // Open tabs show the old text: reload the ones that have no unsaved edits.
  for (const tab of state.currentTabs) {
    if (!tab.filePath || tab.modified || !files.some((f) => f.fullPath === tab.filePath)) continue;
    const fresh = await window.electronAPI.getFileContent(tab.filePath);
    if (!fresh.success || fresh.content == null) continue;
    tab.content = fresh.content;
    if (state.currentTabs[state.activeTabIndex] === tab && dom.editor) { dom.editor.value = fresh.content; dom.editor.dispatchEvent(new Event('input', { bubbles: true })); }
  }
  await run();
  $('search-results').insertAdjacentHTML('afterbegin', `<div class="search-summary ok">Заменено: ${res.replaced} в ${res.changedFiles} ${plural(res.changedFiles, 'файле', 'файлах', 'файлах')}</div>`);
}

function openMatch(fi, mi) {
  const f = last?.results[fi];
  const m = f?.matches[mi];
  if (!m) return;
  if (f.current) goToEditorLine(m.line);
  else openSearchFileAtLine(f.fullPath, m.line);
}

function moveFocus(from, dir) {
  const items = [...$('search-results').querySelectorAll('.search-file-header, .search-match-line')];
  const next = items[Math.max(0, Math.min(items.length - 1, items.indexOf(from) + dir))];
  next?.focus();
}

function paint() {
  document.querySelectorAll('.search-mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === opts.mode));
  const project = opts.mode === 'workspace';
  $('search-filters').hidden = !project;
  $('search-replace-row').hidden = !(project && opts.replaceOpen);
  $('search-replace-toggle').classList.toggle('open', opts.replaceOpen);
  $('search-replace-toggle').hidden = !project;
  for (const [id, key] of [['search-case-sensitive', 'caseSensitive'], ['search-whole-word', 'wholeWord'], ['search-regex', 'regex']]) $(id)?.classList.toggle('active', !!opts[key]);
  $('search-input').placeholder = project ? 'Найти в проекте' : 'Найти в текущем файле';
}

export function showSearchPanel() {
  dom.activityPanel.innerHTML = `
    <div class="activity-header"><h3>Поиск</h3></div>
    <div class="search-panel">
      <div class="search-mode-tabs">
        <button class="search-mode-btn" data-mode="workspace">В проекте</button>
        <button class="search-mode-btn" data-mode="file">В файле</button>
      </div>
      <div class="search-field">
        <button type="button" id="search-replace-toggle" class="search-chevron" title="Замена"><span class="tree-twistie" aria-hidden="true"></span></button>
        <div class="search-field-inputs">
          <div class="search-input-container">
            <input type="text" id="search-input" class="search-input" spellcheck="false" autocomplete="off" />
            <div class="search-options">
              <button class="search-option-btn" id="search-case-sensitive" title="Учитывать регистр">Aa</button>
              <button class="search-option-btn" id="search-whole-word" title="Слово целиком"><u>ab</u></button>
              <button class="search-option-btn" id="search-regex" title="Регулярное выражение">.*</button>
            </div>
          </div>
          <div id="search-replace-row" class="search-input-container" hidden>
            <input type="text" id="replace-input-sidebar" class="search-input" placeholder="Заменить на" spellcheck="false" autocomplete="off" />
          </div>
        </div>
      </div>
      <div id="search-filters" class="search-filters">
        <input type="text" id="search-include" class="search-filter-input" placeholder="Включить: *.js, src/**" spellcheck="false" />
        <input type="text" id="search-exclude" class="search-filter-input" placeholder="Исключить: *.min.js, dist/" spellcheck="false" />
      </div>
      <div id="search-actions" class="search-actions" hidden><button type="button" id="search-replace-all" class="search-btn">Заменить все</button></div>
      <div id="search-results" class="search-results"></div>
    </div>`;
  const input = $('search-input');
  const sel = window.getSelection?.().toString();
  const picked = dom.editor && dom.editor.selectionEnd > dom.editor.selectionStart ? dom.editor.value.slice(dom.editor.selectionStart, dom.editor.selectionEnd) : sel;
  if (picked && !picked.includes('\n') && picked.length < 200) input.value = picked;
  else if (last?.query) input.value = last.query;
  $('search-include').value = opts.include;
  $('search-exclude').value = opts.exclude;
  paint();
  run();

  document.querySelectorAll('.search-mode-btn').forEach((b) => b.addEventListener('click', () => { opts.mode = b.dataset.mode; persist(); paint(); run(); }));
  for (const [id, key] of [['search-case-sensitive', 'caseSensitive'], ['search-whole-word', 'wholeWord'], ['search-regex', 'regex']]) {
    $(id).addEventListener('click', () => { opts[key] = !opts[key]; persist(); paint(); run(); });
  }
  $('search-replace-toggle').addEventListener('click', () => { opts.replaceOpen = !opts.replaceOpen; persist(); paint(); if (last) renderResults(last, $('search-results').querySelector('.search-summary')?.textContent.replace(/ · показаны.*/, '') || ''); });
  input.addEventListener('input', schedule);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { clearTimeout(timer); run(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); $('search-results').querySelector('.search-file-header, .search-match-line')?.focus(); }
    if (e.key === 'Escape' && input.value) { input.value = ''; run(); }
  });
  $('search-include').addEventListener('input', (e) => { opts.include = e.target.value; persist(); schedule(); });
  $('search-exclude').addEventListener('input', (e) => { opts.exclude = e.target.value; persist(); schedule(); });
  $('replace-input-sidebar').addEventListener('keydown', (e) => { if (e.key === 'Enter') replaceAll(); });
  $('search-replace-all').addEventListener('click', replaceAll);

  const results = $('search-results');
  results.addEventListener('click', (e) => {
    const skip = e.target.closest('[data-skip]');
    if (skip) {
      const f = last.results[Number(skip.dataset.skip)];
      if (excluded.has(f.fullPath)) excluded.delete(f.fullPath); else excluded.add(f.fullPath);
      skip.classList.toggle('on');
      skip.innerHTML = excluded.has(f.fullPath) ? icon('plus', 10) : icon('close', 10);
      updateReplaceButton();
      return;
    }
    const line = e.target.closest('.search-match-line');
    if (line) return openMatch(Number(line.dataset.f), Number(line.dataset.m));
    const head = e.target.closest('.search-file-header');
    if (head) {
      const f = last.results[Number(head.dataset.f)];
      const key = f.fullPath || f.file;
      if (collapsed.has(key)) collapsed.delete(key); else collapsed.add(key);
      renderResults(last, results.querySelector('.search-summary')?.textContent.replace(/ · показаны.*/, '') || '');
    }
  });
  results.addEventListener('keydown', (e) => {
    const t = e.target.closest('.search-file-header, .search-match-line');
    if (!t) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(t, 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (t === results.querySelector('.search-file-header')) input.focus(); else moveFocus(t, -1); }
    else if (e.key === 'Enter') { e.preventDefault(); t.click(); }
  });
  setTimeout(() => { input.focus(); input.select(); }, 0);
}
