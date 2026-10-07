/**
 * Command palette (Ctrl/Cmd+Shift+P), quick open (Ctrl/Cmd+P, ":42" jumps to a line) and run-file.
 * One overlay, three modes; fuzzy matching on a subsequence with word-start bonuses.
 */
import { state } from './state.js';
import { getDom } from './dom.js';
import { saveAllConfig } from './save-hook.js';
import { isNotebookTab, isBrowserTab, isEditorTab } from './tab-model.js';
import { openBrowserTab, browserCommand } from './browser.js';
import { toggleLive, liveOpenCurrent, stopLive } from './liveserver-ui.js';
import { openAgentInTerminal, askAgent } from './agents.js';
import { createNewFile, closeTab, setSplitView, openTabInSplit, updateTabsList, switchToTab, reopenClosedTab } from './tabs.js';
import {
  saveFile, saveFileAs, openFileOrFolder, createNewNotebook, openFindBar, openReplaceBar,
  applyWordWrap, applyLineNumbers, changeEditorZoom, applyEditorZoom, updateStatusBar,
} from './editor.js';
import { toggleTerminal, setTerminalVisible, ensureTerminalStarted } from './terminal.js';
import { toggleChat } from './chat.js';
import { switchActivity, setActivityVisible, openSearchFile, openSearchFileAtLine, goToEditorLine } from './explorer.js';
import { applyThemeClass } from './appearance.js';
import { runNotebookCommand } from './notebook.js';
import { toggleGlass, attachGlassTo } from './glass.js';

const dom = getDom();
let overlay = null;
let input = null;
let list = null;
let items = [];
let shown = [];
let active = 0;
let mode = 'commands';
let fileCache = { root: null, at: 0, files: [] };

const RUNNERS = {
  py: (p) => `${navigator.platform.startsWith('Win') ? 'python' : 'python3'} "${p}"`,
  js: (p) => `node "${p}"`,
  mjs: (p) => `node "${p}"`,
  sh: (p) => `bash "${p}"`,
  rb: (p) => `ruby "${p}"`,
  go: (p) => `go run "${p}"`,
};

function fuzzy(query, text) {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let score = t.includes(q) ? 20 - Math.min(10, t.indexOf(q) * 0.2) : 0;
  let ti = 0;
  let prev = -2;
  for (const ch of q) {
    const at = t.indexOf(ch, ti);
    if (at < 0) return 0;
    score += 1;
    if (at === prev + 1) score += 2;
    if (at === 0 || /[\s/_.\-]/.test(t[at - 1])) score += 3;
    prev = at;
    ti = at + 1;
  }
  return score - t.length * 0.01;
}

function ensureOverlay() {
  if (overlay) return;
  overlay = document.createElement('div');
  overlay.className = 'palette-overlay';
  overlay.hidden = true;
  overlay.innerHTML = '<div class="palette" role="dialog" aria-modal="true"><input class="palette-input" type="text" spellcheck="false" autocomplete="off"><div class="palette-list" role="listbox"></div><div class="palette-foot"></div></div>';
  document.body.appendChild(overlay);
  const dialog = overlay.querySelector('.palette');
  dialog.setAttribute('data-glass', 'dialog');
  attachGlassTo(dialog);
  input = overlay.querySelector('.palette-input');
  list = overlay.querySelector('.palette-list');
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closePalette(); });
  input.addEventListener('input', () => { active = 0; refresh(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(shown[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  });
  list.addEventListener('click', (e) => {
    const row = e.target.closest('.palette-item');
    if (row) choose(shown[Number(row.dataset.i)]);
  });
}

function move(dir) {
  if (!shown.length) return;
  active = (active + dir + shown.length) % shown.length;
  paint();
}

function choose(item) {
  if (!item) return;
  closePalette();
  setTimeout(() => item.run(), 0);
}

function closePalette() {
  if (overlay) overlay.hidden = true;
  const ed = state.findBarVisible ? null : dom.editor;
  ed?.focus();
}

let onSubmit = null;

function refresh() {
  const raw = input.value;
  if (mode === 'input') {
    shown = [{ label: raw ? `Применить: ${raw}` : 'Введите значение', run: () => raw && onSubmit?.(raw) }];
    paint();
    return;
  }
  if (mode === 'files' && raw.startsWith(':')) {
    const n = parseInt(raw.slice(1), 10);
    shown = [{ label: Number.isFinite(n) ? `Перейти к строке ${n}` : 'Введите номер строки', run: () => Number.isFinite(n) && goToEditorLine(n) }];
    paint();
    return;
  }
  const scored = items
    .map((it) => ({ it, s: fuzzy(raw, it.search || it.label) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || (a.it.order ?? 0) - (b.it.order ?? 0))
    .slice(0, 60)
    .map((x) => x.it);
  shown = scored;
  paint();
}

function paint() {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  list.innerHTML = shown.length
    ? shown.map((it, i) => `<div class="palette-item${i === active ? ' active' : ''}" data-i="${i}" role="option"><span class="palette-label">${esc(it.label)}</span>${it.detail ? `<span class="palette-detail">${esc(it.detail)}</span>` : ''}${it.key ? `<kbd>${esc(it.key)}</kbd>` : ''}</div>`).join('')
    : '<div class="palette-empty">Ничего не найдено</div>';
  list.querySelector('.palette-item.active')?.scrollIntoView({ block: 'nearest' });
}

function open(nextMode, placeholder, nextItems, foot) {
  ensureOverlay();
  mode = nextMode;
  items = nextItems;
  active = 0;
  input.value = '';
  input.placeholder = placeholder;
  overlay.querySelector('.palette-foot').textContent = foot;
  overlay.hidden = false;
  refresh();
  input.focus();
}

// ───────── commands ─────────

function activeTab() {
  return state.currentTabs[state.activeTabIndex];
}

export async function runCurrentFile() {
  const tab = activeTab();
  if (!tab) return;
  if (isNotebookTab(tab)) { runNotebookCommand(tab, 'run-all'); return; }
  if (isBrowserTab(tab)) { browserCommand('reload'); return; }
  if (/\.html?$/i.test(tab.name || '')) { await liveOpenCurrent(saveFile); return; }
  const ext = (/\.([a-z0-9]+)$/i.exec(tab.name || '') || [])[1]?.toLowerCase();
  const build = RUNNERS[ext];
  if (!build) {
    if (dom.statusFile) {
      const prev = dom.statusFile.textContent;
      dom.statusFile.textContent = 'Для этого типа файлов запуск не настроен';
      setTimeout(() => { dom.statusFile.textContent = prev; }, 2500);
    }
    return;
  }
  if (!tab.filePath || tab.modified) await saveFile();
  if (!tab.filePath) return;
  await setTerminalVisible(true, false);
  await ensureTerminalStarted();
  await window.electronAPI.terminalWrite(`${build(tab.filePath)}\r`);
}

function toggleTheme() {
  const next = document.body.classList.contains('light-theme') ? 'dark' : 'light';
  if (dom.themeSelect) dom.themeSelect.value = next;
  applyThemeClass(next);
  saveAllConfig();
}

function buildCommands() {
  const tab = activeTab();
  const nb = tab && isNotebookTab(tab);
  const cmd = (label, run, key = '', group = '') => ({ label, run, key, detail: group });
  const list = [
    cmd('Файл: новый файл', createNewFile, 'Ctrl+N'),
    cmd('Файл: новый ноутбук', createNewNotebook),
    cmd('Файл: открыть…', openFileOrFolder, 'Ctrl+O'),
    cmd('Файл: сохранить', saveFile, 'Ctrl+S'),
    cmd('Файл: сохранить как…', saveFileAs, 'Ctrl+Shift+S'),
    cmd('Файл: закрыть вкладку', () => state.activeTabIndex >= 0 && closeTab(state.activeTabIndex), 'Ctrl+W'),
    cmd('Файл: автосохранение вкл/выкл', () => {
      state.autoSave = !state.autoSave;
      const box = document.getElementById('autosave-checkbox');
      if (box) box.checked = state.autoSave;
      saveAllConfig();
    }),
    cmd('Правка: найти в файле', openFindBar, 'Ctrl+F'),
    cmd('Правка: найти и заменить', openReplaceBar, 'Ctrl+Alt+F'),
    cmd('Правка: перейти к строке…', openGoToLine, 'Ctrl+G'),
    cmd('Правка: поиск по проекту', () => switchActivity('search'), 'Ctrl+Shift+F'),
    cmd('Вид: терминал', toggleTerminal, 'Ctrl+`'),
    cmd('Вид: AI-чат', toggleChat),
    cmd('Вид: проводник', () => switchActivity('explorer')),
    cmd('Вид: Git', () => switchActivity('git')),
    cmd('Вид: разделить редактор', () => {
      if (state.splitView) { setSplitView(false); updateTabsList(); } else if (state.activeTabIndex >= 0) openTabInSplit(state.activeTabIndex);
    }, 'Ctrl+\\'),
    cmd('Вид: сменить тему (светлая/тёмная)', toggleTheme),
    cmd('Вид: Liquid Glass вкл/выкл', toggleGlass),
    cmd('Вид: перенос строк', () => applyWordWrap(!state.wordWrapEnabled, true)),
    cmd('Вид: номера строк', () => applyLineNumbers(!state.lineNumbersEnabled, true)),
    cmd('Вид: увеличить масштаб', () => changeEditorZoom(0.1), 'Ctrl++'),
    cmd('Вид: уменьшить масштаб', () => changeEditorZoom(-0.1), 'Ctrl+-'),
    cmd('Вид: сбросить масштаб', () => applyEditorZoom(1, true), 'Ctrl+0'),
    cmd('Запуск: выполнить текущий файл', runCurrentFile, 'F5'),
    cmd('Правка: перейти к символу…', openSymbols, 'Ctrl+Shift+O'),
    cmd('Правка: переименовать слово во всём файле…', renameWord, 'Shift+F6'),
    cmd('Правка: форматировать документ', formatDocument, 'Shift+Alt+F'),
    cmd('Правка: ВЕРХНИЙ РЕГИСТР', () => transformSelection((t) => t.toUpperCase()), 'Ctrl+Shift+U'),
    cmd('Правка: нижний регистр', () => transformSelection((t) => t.toLowerCase())),
    cmd('Правка: сортировать строки', () => transformSelection((t) => t.split('\n').sort((a, b) => a.localeCompare(b)).join('\n'), true)),
    cmd('Правка: удалить повторяющиеся строки', () => transformSelection((t) => [...new Set(t.split('\n'))].join('\n'), true)),
    cmd('Файл: открыть закрытую вкладку', reopenClosedTab, 'Ctrl+Shift+T'),
    cmd('Файл: закрыть остальные вкладки', () => {
      const keep = state.currentTabs[state.activeTabIndex];
      for (let i = state.currentTabs.length - 1; i >= 0; i--) if (state.currentTabs[i] !== keep && state.currentTabs[i].kind !== 'terminal') closeTab(i);
    }),
    cmd('Файл: закрыть все вкладки', () => { for (let i = state.currentTabs.length - 1; i >= 0; i--) closeTab(i); }),
    cmd('Файл: скопировать путь', () => copyPath(false)),
    cmd('Файл: скопировать относительный путь', () => copyPath(true)),
    cmd('Проект: TODO / FIXME', openTodos),
    cmd('Вид: боковая панель вкл/выкл', toggleSidebarPanel, 'Ctrl+B'),
    cmd('Вид: режим без отвлечений', toggleZen),
    cmd('Браузер: новая вкладка', () => openBrowserTab('about:blank'), 'Ctrl+Shift+B'),
    cmd('Браузер: открыть адрес…', () => askInput('Адрес сайта или порт (например 3000)', '', (v) => openBrowserTab(v))),
    cmd('Браузер: показать рядом с редактором', () => {
      const front = state.currentTabs[state.activeTabIndex];
      if (isBrowserTab(front)) openTabInSplit(state.activeTabIndex);
      else {
        const existing = state.currentTabs.findIndex((t) => isBrowserTab(t));
        if (existing >= 0) openTabInSplit(existing); else openBrowserTab('about:blank', { side: true });
      }
    }),
    cmd('Live Server: запустить / остановить', toggleLive),
    cmd('Live Server: открыть текущий HTML', () => liveOpenCurrent(saveFile)),
    cmd('Агент: Claude Code в терминале', () => openAgentInTerminal('claude')),
    cmd('Агент: Codex в терминале', () => openAgentInTerminal('codex')),
    cmd('Агент: OpenCode в терминале', () => openAgentInTerminal('opencode')),
    cmd('Агент: объяснить выделенный код', () => agentPrompt('Объясни, что делает выделенный код, и отметь возможные проблемы.')),
    cmd('Агент: найти ошибки в файле', () => agentPrompt('Проверь открытый файл на ошибки и предложи исправления.')),
    cmd('Агент: написать тесты', () => agentPrompt('Напиши тесты для открытого файла.')),
    cmd('Настройки', () => { if (dom.settingsModal) dom.settingsModal.style.display = 'flex'; }),
  ];
  if (tab && isBrowserTab(tab)) {
    list.push(
      cmd('Браузер: обновить страницу', () => browserCommand('reload'), 'F5'),
      cmd('Браузер: инструменты разработчика', () => browserCommand('devtools')),
      cmd('Браузер: назад', () => browserCommand('back'), 'Alt+←'),
      cmd('Браузер: вперёд', () => browserCommand('forward'), 'Alt+→'),
    );
  }
  if (nb) {
    list.push(
      cmd('Ноутбук: выполнить все ячейки', () => runNotebookCommand(tab, 'run-all')),
      cmd('Ноутбук: перезапустить ядро', () => runNotebookCommand(tab, 'restart')),
      cmd('Ноутбук: перезапустить и выполнить всё', () => runNotebookCommand(tab, 'restart-run')),
      cmd('Ноутбук: прервать выполнение', () => runNotebookCommand(tab, 'interrupt'), 'I, I'),
      cmd('Ноутбук: очистить все выводы', () => runNotebookCommand(tab, 'clear')),
      cmd('Ноутбук: добавить ячейку с кодом', () => runNotebookCommand(tab, 'add-code'), 'B'),
      cmd('Ноутбук: добавить текстовую ячейку', () => runNotebookCommand(tab, 'add-md')),
    );
  }
  return list.map((c, i) => ({ ...c, order: i }));
}

function askInput(placeholder, initial, callback, foot = 'Enter — применить · Esc — отмена') {
  open('input', placeholder, [], foot);
  onSubmit = callback;
  input.value = initial || '';
  input.select();
  refresh();
}

// ───────── editor tools ─────────

const SYMBOL_RULES = {
  py: [[/^\s*class\s+(\w+)/, 'class'], [/^\s*(?:async\s+)?def\s+(\w+)/, 'def']],
  js: [[/^\s*(?:export\s+)?(?:default\s+)?class\s+(\w+)/, 'class'], [/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+(\w+)/, 'function'],
       [/^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>/, 'fn'], [/^\s{2,}(?:async\s+|static\s+|get\s+|set\s+)*(\w+)\s*\([^)]*\)\s*\{/, 'method']],
  go: [[/^func\s+(?:\([^)]*\)\s*)?(\w+)/, 'func'], [/^type\s+(\w+)/, 'type']],
  rs: [[/^\s*(?:pub\s+)?fn\s+(\w+)/, 'fn'], [/^\s*(?:pub\s+)?(?:struct|enum|trait)\s+(\w+)/, 'type'], [/^\s*impl(?:<[^>]*>)?\s+(\w+)/, 'impl']],
  java: [[/^\s*(?:public|private|protected)?\s*(?:abstract\s+|final\s+)?(?:class|interface|enum)\s+(\w+)/, 'class'], [/^\s*(?:public|private|protected)\s+(?:static\s+)?[\w<>\[\]]+\s+(\w+)\s*\(/, 'method']],
  css: [[/^\s*([.#@]?[\w-][^{;]*?)\s*\{/, 'rule']],
  md: [[/^(#{1,6})\s+(.+?)\s*#*$/, 'h']],
};
SYMBOL_RULES.ts = SYMBOL_RULES.jsx = SYMBOL_RULES.tsx = SYMBOL_RULES.mjs = SYMBOL_RULES.js;
SYMBOL_RULES.scss = SYMBOL_RULES.css;
const NOT_METHODS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'else']);

function extractSymbols(text, name) {
  const ext = (/\.([a-z0-9]+)$/i.exec(name || '') || [])[1]?.toLowerCase() || '';
  const rules = SYMBOL_RULES[ext];
  if (!rules) return [];
  const out = [];
  text.split('\n').forEach((line, i) => {
    for (const [re, kind] of rules) {
      const m = re.exec(line);
      if (!m) continue;
      const label = kind === 'h' ? m[2] : m[1];
      if (kind === 'method' && NOT_METHODS.has(label)) continue;
      out.push({ label: kind === 'h' ? `${'  '.repeat(m[1].length - 1)}${label}` : label, detail: `${kind} · ${i + 1}`, search: label, order: i, run: () => goToEditorLine(i + 1) });
      break;
    }
  });
  return out;
}

export function openSymbols() {
  const tab = activeTab();
  if (!isEditorTab(tab) || !dom.editor) return;
  const symbols = extractSymbols(dom.editor.value, tab.name);
  open('symbols', symbols.length ? 'Перейти к символу…' : 'Символы для этого типа файлов не найдены', symbols, 'Классы, функции и заголовки текущего файла');
}

export async function openTodos() {
  if (!state.currentFolder) { alert('Откройте папку проекта'); return; }
  const res = await window.electronAPI.searchInFiles(state.currentFolder, '\\b(TODO|FIXME|HACK|XXX)\\b', { useRegex: true, caseSensitive: true });
  const todos = [];
  for (const file of res?.results || []) {
    for (const m of file.matches) {
      todos.push({ label: m.text.slice(0, 120), detail: `${file.file}:${m.line}`, search: `${m.text} ${file.file}`, order: todos.length, run: () => openSearchFileAtLine(file.fullPath, m.line) });
    }
  }
  open('todos', todos.length ? 'Фильтр по TODO / FIXME…' : 'TODO не найдены', todos, `${todos.length} заметок в проекте`);
}

function replaceEditorText(next) {
  if (!dom.editor || next === dom.editor.value) return;
  const top = dom.editor.scrollTop;
  const pos = dom.editor.selectionStart;
  dom.editor.focus();
  dom.editor.select();
  document.execCommand('insertText', false, next);
  dom.editor.setSelectionRange(Math.min(pos, next.length), Math.min(pos, next.length));
  dom.editor.scrollTop = top;
}

function transformSelection(fn, wholeIfEmpty = false) {
  const ed = dom.editor;
  if (!ed) return;
  let { selectionStart: s, selectionEnd: e } = ed;
  if (s === e) {
    if (!wholeIfEmpty) return;
    s = 0;
    e = ed.value.length;
  }
  ed.focus();
  ed.setSelectionRange(s, e);
  const out = fn(ed.value.slice(s, e));
  document.execCommand('insertText', false, out);
  ed.setSelectionRange(s, s + out.length);
}

function formatDocument() {
  const tab = activeTab();
  if (!isEditorTab(tab) || !dom.editor) return;
  const text = dom.editor.value;
  if (/\.json$/i.test(tab.name || '')) {
    try {
      const unit = '    '.slice(0, parseInt(dom.tabSizeSelect?.value || '2', 10)) || '  ';
      replaceEditorText(JSON.stringify(JSON.parse(text), null, unit) + '\n');
      return;
    } catch (err) {
      alert(`JSON не разобран: ${err.message}`);
      return;
    }
  }
  replaceEditorText(text.replace(/[ \t]+$/gm, '').replace(/\n*$/, '\n'));
}

function renameWord() {
  const ed = dom.editor;
  if (!ed) return;
  let word = ed.value.slice(ed.selectionStart, ed.selectionEnd);
  if (!word) {
    const left = /[\w$]*$/.exec(ed.value.slice(0, ed.selectionStart))[0];
    const right = /^[\w$]*/.exec(ed.value.slice(ed.selectionStart))[0];
    word = left + right;
  }
  if (!word || /\W/.test(word.replace(/\$/g, ''))) return;
  const re = new RegExp(`(?<![\\w$])${word.replace(/\$/g, '\\$')}(?![\\w$])`, 'g');
  const count = (ed.value.match(re) || []).length;
  askInput(`Переименовать «${word}» (${count} вхождений в файле)`, word, (next) => {
    replaceEditorText(ed.value.replace(re, () => next));
  });
}

function copyPath(relative) {
  const tab = activeTab();
  if (!tab?.filePath) return;
  const rel = state.currentFolder && tab.filePath.startsWith(state.currentFolder) ? tab.filePath.slice(state.currentFolder.length).replace(/^[\\/]/, '') : tab.filePath;
  navigator.clipboard?.writeText(relative ? rel : tab.filePath);
}

export function toggleSidebarPanel() {
  setActivityVisible(state.activityVisible === false);
}

export function toggleZen() {
  document.body.classList.toggle('zen');
}

function agentPrompt(instruction) {
  const provider = dom.aiProviderSelect?.value || 'ollama';
  const ed = dom.editor;
  let text = instruction;
  if (provider !== 'claude-code' && provider !== 'codex' && ed && ed.selectionEnd > ed.selectionStart) {
    text += `\n\n\`\`\`\n${ed.value.slice(ed.selectionStart, ed.selectionEnd).slice(0, 6000)}\n\`\`\``;
  }
  askAgent(text);
}

export function openCommandPalette() {
  open('commands', 'Введите команду…', buildCommands(), '↑↓ выбор · Enter выполнить · Esc закрыть');
}

async function loadFiles() {
  const root = state.currentFolder;
  if (!root) return [];
  if (fileCache.root === root && Date.now() - fileCache.at < 30000) return fileCache.files;
  const res = await window.electronAPI.listProjectFiles?.(root);
  fileCache = { root, at: Date.now(), files: res?.files || [] };
  return fileCache.files;
}

export async function openQuickOpen() {
  const files = await loadFiles();
  const openTabs = state.currentTabs
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t && t.kind !== 'terminal')
    .map(({ t, i }) => ({ label: t.name, detail: 'открыта', search: t.name, order: -100 + i, run: () => switchToTab(i) }));
  const known = new Set(state.currentTabs.map((t) => t.filePath).filter(Boolean));
  const fromDisk = files.filter((f) => !known.has(f.path)).map((f, i) => ({
    label: f.rel.split(/[\\/]/).pop(),
    detail: f.rel,
    search: f.rel,
    order: i,
    run: () => openSearchFile(f.path),
  }));
  open('files', state.currentFolder ? 'Имя файла или :номер строки' : 'Откройте папку, чтобы искать файлы · :номер строки', [...openTabs, ...fromDisk], 'Enter открыть · «:42» — перейти к строке');
}

export function openGoToLine() {
  open('files', 'Номер строки', [], 'Введите номер строки и нажмите Enter');
  input.value = ':';
  refresh();
}

export function setupPaletteButtons() {
  document.getElementById('run-file-btn')?.addEventListener('click', runCurrentFile);
  document.getElementById('autosave-checkbox')?.addEventListener('change', (e) => {
    state.autoSave = e.target.checked;
    saveAllConfig();
  });
}

export { updateStatusBar };
