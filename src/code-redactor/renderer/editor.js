import { state } from './state.js';
import { getDom } from './dom.js';
import { pathUtils, escapeHtml } from './utils.js';
import { saveAllConfig } from './save-hook.js';
import {
  hideWelcomePage,
  createTab,
  closeTab,
  switchToTab,
  setSplitView,
  openTabInSplit,
  updateTabsList,
  updateTabTitle,
  updateSecondaryChrome,
} from './tabs.js';
import { toggleTerminal } from './terminal.js';
import { registerEditorApi } from './editor-api.js';
import { isNotebookTab, isBrowserTab, isEditorTab } from './tab-model.js';
import { syncNotebookContent, createNotebookTab } from './notebook.js';
import { createSmartKeydown } from './smart-edit.js';
import { smartOptsFor } from './ext-contrib.js';

const dom = getDom();

export async function openFile() {
  try {
    const result = await window.electronAPI.openFile();
      if (result.success) {
        // Закрываем стартовую страницу при открытии файла
        hideWelcomePage();
        createTab(pathUtils.basename(result.filePath), result.content, result.filePath);
      }
  } catch (error) {
    console.error('Ошибка открытия файла:', error);
  }
}

export async function openFileOrFolder() {
  try {
    const result = await window.electronAPI.openFileOrFolder();
    if (result.success) {
      if (result.isDirectory) {
        const exp = await import('./explorer.js');
        state.currentFolder = result.folderPath || result.path;
        await exp.loadFolderContents(state.currentFolder);
        if (state.currentActivity !== 'explorer') {
          exp.switchActivity('explorer');
        }
      } else {
        // Открываем файл в редакторе
        hideWelcomePage();
        createTab(pathUtils.basename(result.filePath), result.content, result.filePath);
      }
    }
  } catch (error) {
    console.error('Ошибка открытия файла или папки:', error);
  }
}

/** The tab and text to save: the right pane when it has focus, otherwise the active (left) tab. */
function saveTarget() {
  if (state.splitView && state.focusedPane === 'right' && state.rightTabIndex >= 0) {
    const tab = state.currentTabs[state.rightTabIndex];
    const right = document.getElementById('editor-right');
    if (tab && isEditorTab(tab) && right) return { tab, content: right.value };
  }
  const tab = state.currentTabs[state.activeTabIndex];
  if (!tab || isBrowserTab(tab)) return null;
  if (isNotebookTab(tab)) {
    syncNotebookContent(tab);
    return { tab, content: tab.content || '' };
  }
  return { tab, content: dom.editor?.value ?? tab.content ?? '' };
}

export async function saveFile() {
  const target = saveTarget();
  if (target) {
    const { tab, content } = target;
    tab.content = content;
    try {
      let result;
      if (tab.filePath && window.electronAPI.writeFile) {
        result = await window.electronAPI.writeFile(tab.filePath, content);
        if (result.success) result.filePath = tab.filePath;
      } else if (tab.filePath) {
        result = await window.electronAPI.saveFile(content);
      } else {
        result = await window.electronAPI.saveFileAs(content);
      }
      
      if (result.success) {
        tab.diskContent = content;
        tab.filePath = result.filePath;
        tab.name = pathUtils.basename(result.filePath);
        tab.modified = false;
        updateTabsList();
        updateTabTitle();
        saveTabs();
      }
    } catch (error) {
      console.error('Ошибка сохранения файла:', error);
    }
  }
}

// Функции для работы с редактором

export async function saveFileAs() {
  const target = saveTarget();
  if (target) {
    const { tab, content } = target;
    tab.content = content;
    try {
      const result = await window.electronAPI.saveFileAs(content);
      if (result.success) {
        tab.filePath = result.filePath;
        tab.name = pathUtils.basename(result.filePath);
        tab.modified = false;
        if (/\.ipynb$/i.test(result.filePath)) {
          tab.kind = 'notebook';
        }
        updateTabsList();
        updateTabTitle();
        saveTabs();
      }
    } catch (error) {
      console.error('Ошибка сохранения файла:', error);
    }
  }
}

export function createNewNotebook() {
  hideWelcomePage();
  const tab = createNotebookTab('Untitled.ipynb', null);
  state.currentTabs.push(tab);
  switchToTab(state.currentTabs.length - 1);
  saveTabs();
}

// Функции для работы с чатом

export function handleEditorInput() {
  if (state.activeTabIndex >= 0 && state.activeTabIndex < state.currentTabs.length) {
    const tab = state.currentTabs[state.activeTabIndex];
    const currentContent = dom.editor.value;
    
    if (tab.content !== currentContent) {
      tab.content = currentContent;
      // the tab strip and title only change when the file first becomes modified, not on every key
      if (!tab.modified) {
        tab.modified = true;
        updateTabsList();
        updateTabTitle();
      }
    }
  }
  // The same file can be open in both panes: mirror the edit into the right one.
  if (state.splitView && state.rightTabIndex === state.activeTabIndex) {
    const right = document.getElementById('editor-right');
    if (right && right.value !== dom.editor.value) {
      right.value = dom.editor.value;
      updateSecondaryChrome();
    }
  }
  updateLineNumbers();
  updateSyntaxHighlight();
  updateStatusBar();
  if (state.findBarVisible) {
    updateFindMatches(false);
  }
}

const smartKeydown = createSmartKeydown(() => {
  const tab = state.currentTabs[state.activeTabIndex];
  return {
    tabSize: parseInt(dom.tabSizeSelect?.value || '4', 10),
    ...smartOptsFor(tab?.name || ''),
  };
});

/** Auto-pairs, auto-indent, block indent, comment toggle, line move/duplicate/delete. */
export function handleEditorKeydown(e) {
  smartKeydown(e);
}

// --- Autosave: flush modified file-backed tabs while the user is idle ---

let autoSaveTimer = null;

let autoSaving = false;
async function flushAutoSave() {
  if (!state.autoSave || autoSaving) return;
  autoSaving = true;
  let saved = false;
  try {
    for (const tab of state.currentTabs) {
      if (!tab || !tab.modified || !tab.filePath || tab.kind === 'terminal') continue;
      if (isNotebookTab(tab)) syncNotebookContent(tab);
      const content = tab.content ?? '';
      try {
        const res = await window.electronAPI.writeFile(tab.filePath, content);
        if (res?.success) {
          tab.diskContent = content; // our own write: the folder watcher must not "reload" it
          // typing may have gone on while the file was being written: then the tab is still modified
          if (tab.content === content) { tab.modified = false; saved = true; }
        }
      } catch (err) {
        console.warn('[autosave]', err);
      }
    }
  } finally {
    autoSaving = false;
  }
  if (saved) {
    updateTabsList();
    updateTabTitle();
  }
}

export function initAutoSave() {
  clearInterval(autoSaveTimer);
  autoSaveTimer = setInterval(flushAutoSave, 2000);
}

export function handleEditorScroll() {
  // Обновляем нумерацию строк при прокрутке
  updateLineNumbers();
  syncSyntaxScroll();
}

export function updateCurrentLine() {
  // Обновляем нумерацию строк при клике или нажатии клавиши
  updateLineNumbers();
}

let currentLineEl = null;

export function updateLineNumbers() {
  const value = dom.editor.value;
  const caret = dom.editor.selectionStart;
  let count = 1;
  let current = 1;
  for (let i = value.indexOf('\n'); i >= 0; i = value.indexOf('\n', i + 1)) {
    count++;
    if (i < caret) current++;
  }
  const scrollTop = dom.editor.scrollTop;
  const box = dom.lineNumbers;

  // Numbers depend only on the position, so a changed line count adds or removes rows at the end instead of rebuilding them all.
  const have = box.children.length;
  if (have < count) {
    let html = '';
    for (let n = have + 1; n <= count; n++) html += `<span class="line-number">${n}</span>`;
    box.insertAdjacentHTML('beforeend', html);
  } else if (have > count) {
    const range = document.createRange();
    range.setStartBefore(box.children[count]);
    range.setEndAfter(box.lastElementChild);
    range.deleteContents();
  }
  const next = box.children[current - 1] || null;
  if (next !== currentLineEl) {
    currentLineEl?.classList.remove('current');
    next?.classList.add('current');
    currentLineEl = next;
  } else if (next && !next.classList.contains('current')) {
    next.classList.add('current');
  }
  box.scrollTop = scrollTop;
}

// Files this long are highlighted only around the visible lines (the rest of the overlay is blank lines of the same height),
// otherwise every key press re-colours the whole file and typing lags.
const WINDOW_FROM_LINES = 300;
const WINDOW_MARGIN = 60;
let hlWindow = null; // { first, last } of the lines currently coloured, or null when the whole file is

// getComputedStyle forces a style pass: the line height is read once per zoom / font change, not on every key
let lineHeightCache = 0;
function editorLineHeight() {
  if (!lineHeightCache && dom.editor) lineHeightCache = parseFloat(getComputedStyle(dom.editor).lineHeight) || 22;
  return lineHeightCache || 22;
}
export function resetEditorMetrics() { lineHeightCache = 0; }
window.addEventListener('frogee:metrics', resetEditorMetrics);

export function updateSyntaxHighlight() {
  const syntaxEl = document.getElementById('syntax-highlight');
  if (!syntaxEl || !dom.editor || !window.SyntaxHighlight) return;

  const fileName = state.activeTabIndex >= 0 ? state.currentTabs[state.activeTabIndex]?.name : '';
  const text = dom.editor.value || '';
  let lineCount = 1;
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) lineCount++;
  hlWindow = null;
  if (lineCount > WINDOW_FROM_LINES && !dom.editor.classList.contains('word-wrap')) {
    const lh = editorLineHeight();
    const first = Math.max(0, Math.floor(dom.editor.scrollTop / lh) - WINDOW_MARGIN);
    const last = Math.min(lineCount, Math.ceil((dom.editor.scrollTop + dom.editor.clientHeight) / lh) + WINDOW_MARGIN);
    let from = 0;
    for (let n = 0; n < first; n++) from = text.indexOf('\n', from) + 1;
    let to = from;
    for (let n = first; n < last && to >= 0; n++) { to = text.indexOf('\n', to); if (to >= 0) to++; }
    const slice = text.slice(from, to < 0 ? text.length : to);
    syntaxEl.innerHTML = '\n'.repeat(first) + window.SyntaxHighlight.highlight(slice, fileName);
    hlWindow = { first, last };
  } else {
    syntaxEl.innerHTML = window.SyntaxHighlight.highlight(text, fileName);
  }
  syncSyntaxScroll();
  window.dispatchEvent(new Event('frogee:content'));
}

let rewindowFrame = 0;
export function syncSyntaxScroll() {
  const syntaxEl = document.getElementById('syntax-highlight');
  if (!syntaxEl || !dom.editor) return;
  syntaxEl.scrollTop = dom.editor.scrollTop;
  syntaxEl.scrollLeft = dom.editor.scrollLeft;
  const findLayer = document.getElementById('find-layer');
  if (findLayer && state.findBarVisible) { findLayer.scrollTop = dom.editor.scrollTop; findLayer.scrollLeft = dom.editor.scrollLeft; }
  if (hlWindow && !rewindowFrame) {
    // Scrolled close to the edge of the coloured part: move the window.
    const lh = editorLineHeight();
    const top = Math.floor(dom.editor.scrollTop / lh);
    const bottom = Math.ceil((dom.editor.scrollTop + dom.editor.clientHeight) / lh);
    if ((top < hlWindow.first + 15 && hlWindow.first > 0) || bottom > hlWindow.last - 15) {
      rewindowFrame = requestAnimationFrame(() => { rewindowFrame = 0; updateSyntaxHighlight(); });
    }
  }
}

// Для обратной совместимости

export function changeEditorZoom(delta) {
  applyEditorZoom(Math.round((state.editorZoom + delta) * 10) / 10, true);
}

export function applyEditorZoom(value, shouldSave = true) {
  resetEditorMetrics();
  state.editorZoom = Math.min(2, Math.max(0.7, value));
  document.documentElement.style.setProperty('--editor-zoom', String(state.editorZoom));
  const label = Math.round(state.editorZoom * 100) + '%';
  if (dom.zoomValueEl) dom.zoomValueEl.textContent = label;
  if (dom.statusZoom) dom.statusZoom.textContent = label;
  updateStatusBar();
  if (shouldSave) saveAllConfig();
}

export function handleZoomWheel(e) {
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  changeEditorZoom(e.deltaY < 0 ? 0.05 : -0.05);
}

export function updateUiAutoScale() {
  let scale = 1;
  if (state.autoScaleEnabled) {
    const width = window.innerWidth || 1200;
    if (width < 1100) scale = 0.92;
    if (width < 900) scale = 0.86;
    if (width < 760) scale = 0.8;
  }
  document.documentElement.style.setProperty('--ui-scale', String(scale));
}

export function applyWordWrap(enabled, shouldSave = true) {
  state.wordWrapEnabled = !!enabled;
  if (dom.editor) dom.editor.classList.toggle('word-wrap', state.wordWrapEnabled);
  const editorRight = document.getElementById('editor-right');
  if (editorRight) editorRight.classList.toggle('word-wrap', state.wordWrapEnabled);
  const syntaxEl = document.getElementById('syntax-highlight');
  if (syntaxEl) syntaxEl.classList.toggle('word-wrap', state.wordWrapEnabled);
  const syntaxRight = document.getElementById('syntax-highlight-right');
  if (syntaxRight) syntaxRight.classList.toggle('word-wrap', state.wordWrapEnabled);
  updateSyntaxHighlight();
  if (shouldSave) saveAllConfig();
}

export function applyLineNumbers(enabled, shouldSave = true) {
  state.lineNumbersEnabled = !!enabled;
  if (dom.lineNumbers) dom.lineNumbers.classList.toggle('hidden', !state.lineNumbersEnabled);
  const lineRight = document.getElementById('line-numbers-right');
  if (lineRight) lineRight.classList.toggle('hidden', !state.lineNumbersEnabled);
  if (shouldSave) saveAllConfig();
}

export function updateStatusBar() {
  if (dom.statusFile) {
    if (state.activeTabIndex >= 0 && state.currentTabs[state.activeTabIndex]) {
      dom.statusFile.textContent = state.currentTabs[state.activeTabIndex].name || 'Untitled';
    } else {
      dom.statusFile.textContent = 'Welcome';
    }
  }
  if (dom.statusCursor && dom.editor) {
    const pos = dom.editor.selectionStart || 0;
    const before = dom.editor.value.substring(0, pos);
    const line = before.split('\n').length;
    const col = before.split('\n').pop().length + 1;
    dom.statusCursor.textContent = `Ln ${line}, Col ${col}`;
  }
  if (dom.statusZoom) {
    dom.statusZoom.textContent = Math.round(state.editorZoom * 100) + '%';
  }
  if (dom.statusLang) {
    const name = state.activeTabIndex >= 0 ? state.currentTabs[state.activeTabIndex]?.name : '';
    const lang = (window.SyntaxHighlight && name)
      ? window.SyntaxHighlight.detectLanguage(name)
      : 'plain';

    if (state.activeTabIndex >= 0 && isNotebookTab(state.currentTabs[state.activeTabIndex])) {
      dom.statusLang.textContent = 'Jupyter Notebook';
    } else if (state.currentTabs[state.activeTabIndex]?.kind === 'image') {
      dom.statusLang.textContent = 'Изображение';
    } else {
      dom.statusLang.textContent = window.SyntaxHighlight ? window.SyntaxHighlight.label(lang) : lang.toUpperCase();
    }
  }
}

export function saveTabs() {
  saveAllConfig();
}

registerEditorApi({
  updateLineNumbers,
  updateSyntaxHighlight,
  updateStatusBar,
  saveTabs,
  openFileOrFolder,
});


// --- Find in file (Ctrl+F) ---

let findFrame = 0;
export function setupFindBar() {
  // a tab switch or an edit re-runs the search on the new text (without moving the view)
  window.addEventListener('frogee:content', () => { if (!state.findBarVisible || findFrame) return; findFrame = requestAnimationFrame(() => { findFrame = 0; if (state.findBarVisible) updateFindMatches(false); }); });
  const findInput = document.getElementById('find-input');
  const findPrevBtn = document.getElementById('find-prev-btn');
  const findNextBtn = document.getElementById('find-next-btn');
  const findCaseBtn = document.getElementById('find-case-btn');
  const findCloseBtn = document.getElementById('find-close-btn');

  if (!findInput) return;

  findInput.addEventListener('input', () => updateFindMatches(true));
  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) findPrev();
      else findNext();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeFindBar();
    }
  });
  findPrevBtn?.addEventListener('click', findPrev);
  findNextBtn?.addEventListener('click', findNext);
  findCaseBtn?.addEventListener('click', () => {
    state.findCaseSensitive = !state.findCaseSensitive;
    findCaseBtn.classList.toggle('active', state.findCaseSensitive);
    updateFindMatches(true);
  });
  findCloseBtn?.addEventListener('click', closeFindBar);

  const replaceInput = document.getElementById('replace-input');
  replaceInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      replaceCurrent();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeFindBar();
    }
  });
  document.getElementById('replace-btn')?.addEventListener('click', replaceCurrent);
  document.getElementById('replace-all-btn')?.addEventListener('click', replaceAll);
}

function buildFindRegex() {
  const query = document.getElementById('find-input')?.value || '';
  if (!query) return null;
  try {
    return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), state.findCaseSensitive ? 'g' : 'gi');
  } catch {
    return null;
  }
}

export function replaceCurrent() {
  const replacement = document.getElementById('replace-input')?.value ?? '';
  if (!state.findMatches.length) {
    updateFindMatches(true);
    return;
  }
  const m = state.findMatches[state.findMatchIndex];
  if (!m) return;
  const back = document.activeElement;
  dom.editor.focus();
  dom.editor.setSelectionRange(m.start, m.end);
  document.execCommand('insertText', false, replacement);
  updateFindMatches(true);
  if (back && back !== dom.editor) back.focus(); // the replace field keeps the keyboard
}

export function replaceAll() {
  const regex = buildFindRegex();
  if (!regex || !dom.editor) return;
  const replacement = document.getElementById('replace-input')?.value ?? '';
  const next = dom.editor.value.replace(regex, () => replacement);
  if (next === dom.editor.value) return;
  const back = document.activeElement;
  dom.editor.focus();
  dom.editor.select();
  document.execCommand('insertText', false, next);
  updateFindMatches(false);
  if (back && back !== dom.editor) back.focus();
}

export function openReplaceBar() {
  openFindBar();
  document.getElementById('replace-input')?.focus();
}

export function openFindBar() {
  const findBar = document.getElementById('find-bar');
  const findInput = document.getElementById('find-input');
  if (!findBar || !findInput) return;

  if (dom.editorContainer && dom.editorContainer.style.display === 'none') {
    hideWelcomePage();
  }

  findBar.style.display = 'flex';
  state.findBarVisible = true;

  const selected = dom.editor.value.substring(dom.editor.selectionStart, dom.editor.selectionEnd);
  if (selected && !selected.includes('\n')) {
    findInput.value = selected;
  }

  findInput.focus();
  findInput.select();
  updateFindMatches(true);
}

export function closeFindBar() {
  const findBar = document.getElementById('find-bar');
  const current = state.findMatches[state.findMatchIndex];
  if (findBar) findBar.style.display = 'none';
  state.findBarVisible = false;
  state.findMatches = [];
  state.findMatchIndex = -1;
  updateFindCount();
  paintFindLayer();
  // like in other editors: closing the search leaves the current match selected in the text
  dom.editor?.focus();
  if (current && dom.editor) dom.editor.setSelectionRange(current.start, current.end);
}

export function updateFindMatches(jumpToFirst) {
  const findInput = document.getElementById('find-input');
  const query = findInput ? findInput.value : '';
  const keepStart = state.findMatches[state.findMatchIndex]?.start; // the match the user was on
  state.findMatches = [];
  state.findMatchIndex = -1;

  if (!query || !dom.editor) {
    updateFindCount();
    paintFindLayer();
    return;
  }

  const text = dom.editor.value;
  const flags = state.findCaseSensitive ? 'g' : 'gi';
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let regex;
  try {
    regex = new RegExp(escaped, flags);
  } catch {
    updateFindCount();
    paintFindLayer();
    return;
  }

  let match;
  while ((match = regex.exec(text)) !== null) {
    state.findMatches.push({ start: match.index, end: match.index + match[0].length });
    if (match[0].length === 0) regex.lastIndex++;
  }

  if (state.findMatches.length > 0) {
    const cursor = dom.editor.selectionStart;
    state.findMatchIndex = state.findMatches.findIndex(m => m.start >= cursor);
    if (state.findMatchIndex < 0) state.findMatchIndex = 0;
    if (!jumpToFirst && keepStart !== undefined) {
      const same = state.findMatches.findIndex((m) => m.start === keepStart);
      if (same >= 0) state.findMatchIndex = same;
    }
    if (jumpToFirst) selectFindMatch(state.findMatchIndex);
  }

  updateFindCount();
  paintFindLayer();
}

export function updateFindCount() {
  const findCount = document.getElementById('find-count');
  if (!findCount) return;
  if (!state.findMatches.length) {
    findCount.textContent = '0/0';
  } else {
    findCount.textContent = `${state.findMatchIndex + 1}/${state.findMatches.length}`;
  }
}

/**
 * Make match `index` the current one. The caret stays where it is (in the search field while typing): the matches are
 * painted by their own layer, so searching never takes the keyboard away. `select: true` also selects the match in the editor.
 */
export function selectFindMatch(index, { select = false } = {}) {
  if (!state.findMatches.length || !dom.editor) return;
  state.findMatchIndex = ((index % state.findMatches.length) + state.findMatches.length) % state.findMatches.length;
  const match = state.findMatches[state.findMatchIndex];
  const ed = dom.editor;

  const before = ed.value.substring(0, match.start);
  const line = before.split('\n').length - 1;
  const lineHeight = parseFloat(getComputedStyle(ed).lineHeight) || 24;
  const top = line * lineHeight;
  // scroll only when the match is out of sight
  if (top < ed.scrollTop + lineHeight || top > ed.scrollTop + ed.clientHeight - lineHeight * 2) ed.scrollTop = Math.max(0, top - ed.clientHeight / 3);
  if (!ed.classList.contains('word-wrap')) {
    const col = match.start - (before.lastIndexOf('\n') + 1);
    const ctx = (selectFindMatch.ctx ||= document.createElement('canvas').getContext('2d'));
    const cs = getComputedStyle(ed);
    ctx.font = `${cs.fontSize} ${cs.fontFamily}`;
    const x = col * ctx.measureText('M').width;
    if (x < ed.scrollLeft || x > ed.scrollLeft + ed.clientWidth - 160) ed.scrollLeft = Math.max(0, x - 120);
  }
  if (select) {
    ed.focus();
    ed.setSelectionRange(match.start, match.end);
  }
  syncSyntaxScroll();
  paintFindLayer();
  updateFindCount();
}

/** All matches highlighted in a layer of their own, the current one stronger. */
export function paintFindLayer() {
  const layer = document.getElementById('find-layer');
  if (!layer || !dom.editor) return;
  if (!state.findBarVisible || !state.findMatches.length || dom.editor.value.length > 600000) { layer.innerHTML = ''; return; }
  const text = dom.editor.value;
  let html = '';
  let pos = 0;
  state.findMatches.forEach((m, i) => {
    if (m.start < pos) return;
    html += `${escapeHtml(text.slice(pos, m.start))}<mark class="fm${i === state.findMatchIndex ? ' cur' : ''}">${escapeHtml(text.slice(m.start, m.end))}</mark>`;
    pos = m.end;
  });
  layer.innerHTML = `${html}${escapeHtml(text.slice(pos))}\n`;
  layer.scrollTop = dom.editor.scrollTop;
  layer.scrollLeft = dom.editor.scrollLeft;
}

export function findNext() {
  if (!state.findMatches.length) updateFindMatches(true);
  else selectFindMatch(state.findMatchIndex + 1);
}

export function findPrev() {
  if (!state.findMatches.length) updateFindMatches(true);
  else selectFindMatch(state.findMatchIndex - 1);
}

// --- Syntax highlighting ---

export function path() {
  return pathUtils;
}

// Функции для работы с папками и файлами