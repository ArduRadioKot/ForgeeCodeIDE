import { state } from './state.js';
import { getDom } from './dom.js';
import { pathUtils } from './utils.js';
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
import { createSmartKeydown, langFromName } from './smart-edit.js';

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
      tab.modified = true;
      tab.content = currentContent;
      updateTabsList();
      updateTabTitle();
      saveAllConfig();
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
    lang: langFromName(tab?.name || ''),
  };
});

/** Auto-pairs, auto-indent, block indent, comment toggle, line move/duplicate/delete. */
export function handleEditorKeydown(e) {
  smartKeydown(e);
}

// --- Autosave: flush modified file-backed tabs while the user is idle ---

let autoSaveTimer = null;

async function flushAutoSave() {
  if (!state.autoSave) return;
  for (const tab of state.currentTabs) {
    if (!tab || !tab.modified || !tab.filePath || tab.kind === 'terminal') continue;
    if (isNotebookTab(tab)) syncNotebookContent(tab);
    try {
      const res = await window.electronAPI.writeFile(tab.filePath, tab.content ?? '');
      if (res?.success) tab.modified = false;
    } catch (err) {
      console.warn('[autosave]', err);
    }
  }
  updateTabsList();
  updateTabTitle();
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

export function updateLineNumbers() {
  const lines = dom.editor.value.split('\n');
  const scrollTop = dom.editor.scrollTop;
  const lineHeight = parseInt(getComputedStyle(dom.editor).lineHeight);
  const visibleLines = Math.ceil(dom.editor.clientHeight / lineHeight);
  const startLine = Math.floor(scrollTop / lineHeight);
  const endLine = Math.min(startLine + visibleLines + 1, lines.length);
  
  // Получаем текущую позицию курсора
  const cursorPosition = dom.editor.selectionStart;
  const textBeforeCursor = dom.editor.value.substring(0, cursorPosition);
  const currentLineNumber = textBeforeCursor.split('\n').length;
  
  let lineNumberHtml = '';
  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const isCurrentLine = lineNum === currentLineNumber;
    const lineClass = isCurrentLine ? 'line-number current' : 'line-number';
    lineNumberHtml += `<span class="${lineClass}">${lineNum}</span>`;
  }
  
  dom.lineNumbers.innerHTML = lineNumberHtml;
  
  // Синхронизируем прокрутку нумерации строк с редактором
  dom.lineNumbers.scrollTop = scrollTop;
}

export function updateSyntaxHighlight() {
  const syntaxEl = document.getElementById('syntax-highlight');
  if (!syntaxEl || !dom.editor || !window.SyntaxHighlight) return;

  const fileName = state.activeTabIndex >= 0 ? state.currentTabs[state.activeTabIndex]?.name : '';
  syntaxEl.innerHTML = window.SyntaxHighlight.highlight(dom.editor.value || '', fileName);
  syncSyntaxScroll();
}

export function syncSyntaxScroll() {
  const syntaxEl = document.getElementById('syntax-highlight');
  if (!syntaxEl || !dom.editor) return;
  syntaxEl.scrollTop = dom.editor.scrollTop;
  syntaxEl.scrollLeft = dom.editor.scrollLeft;
}

// Для обратной совместимости

export function changeEditorZoom(delta) {
  applyEditorZoom(Math.round((state.editorZoom + delta) * 10) / 10, true);
}

export function applyEditorZoom(value, shouldSave = true) {
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

export function setupFindBar() {
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
  dom.editor.focus();
  dom.editor.setSelectionRange(m.start, m.end);
  document.execCommand('insertText', false, replacement);
  updateFindMatches(true);
}

export function replaceAll() {
  const regex = buildFindRegex();
  if (!regex || !dom.editor) return;
  const replacement = document.getElementById('replace-input')?.value ?? '';
  const next = dom.editor.value.replace(regex, () => replacement);
  if (next === dom.editor.value) return;
  dom.editor.focus();
  dom.editor.select();
  document.execCommand('insertText', false, next);
  updateFindMatches(false);
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
  if (findBar) findBar.style.display = 'none';
  state.findBarVisible = false;
  state.findMatches = [];
  state.findMatchIndex = -1;
  updateFindCount();
  dom.editor?.focus();
}

export function updateFindMatches(jumpToFirst) {
  const findInput = document.getElementById('find-input');
  const query = findInput ? findInput.value : '';
  state.findMatches = [];
  state.findMatchIndex = -1;

  if (!query || !dom.editor) {
    updateFindCount();
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
    if (jumpToFirst) selectFindMatch(state.findMatchIndex);
  }

  updateFindCount();
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

export function selectFindMatch(index) {
  if (!state.findMatches.length || !dom.editor) return;
  state.findMatchIndex = ((index % state.findMatches.length) + state.findMatches.length) % state.findMatches.length;
  const match = state.findMatches[state.findMatchIndex];
  dom.editor.focus();
  dom.editor.setSelectionRange(match.start, match.end);

  const textBefore = dom.editor.value.substring(0, match.start);
  const line = textBefore.split('\n').length - 1;
  const lineHeight = parseFloat(getComputedStyle(dom.editor).lineHeight) || 24;
  dom.editor.scrollTop = Math.max(0, line * lineHeight - dom.editor.clientHeight / 3);
  syncSyntaxScroll();
  updateFindCount();
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

// Обработчик потоковых обновлений от AI
if (window.electronAPI && typeof window.electronAPI.onStreamUpdate === 'function') {
  window.electronAPI.onStreamUpdate((event, data) => {
    if (!dom.chatMessages) return;
    const aiMessages = dom.chatMessages.querySelectorAll('.message.ai');
    if (aiMessages.length > 0) {
      const lastMessage = aiMessages[aiMessages.length - 1];
      try {
        lastMessage.innerHTML = data.fullMessage.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                                               .replace(/\*(.*?)\*/g, '<em>$1</em>')
                                               .replace(/`(.*?)`/g, '<code>$1</code>')
                                               .replace(/\n/g, '<br>');
      } catch (error) {
        lastMessage.textContent = data.fullMessage;
      }
      setTimeout(() => {
        dom.chatMessages.scrollTo({
          top: dom.chatMessages.scrollHeight,
          behavior: 'auto'
        });
      }, 10);
    }
  });
} 

// Функции для работы с папками и файлами