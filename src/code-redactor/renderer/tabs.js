import { state } from './state.js';
import { createSmartKeydown, langFromName } from './smart-edit.js';
import { getDom } from './dom.js';
import { escapeHtml } from './utils.js';
import { saveAllConfig } from './save-hook.js';
import { toggleChat } from './chat.js';
import {
  applyTerminalPlacement,
  fitTerminal,
  ensureXterm,
  ensureTerminalStarted,
  getTerminalEditorHost,
  openTerminalAsEditorTab,
} from './terminal.js';
import {
  updateLineNumbers,
  updateSyntaxHighlight,
  updateStatusBar,
  saveTabs,
  openFileOrFolder,
} from './editor-api.js';
import { isTerminalTab, findTerminalTabIndex, isNotebookTab, isNotebookPath, isBrowserTab, isEditorTab } from './tab-model.js';
import { applyBrowserSurface, renderBrowser, destroyBrowser, createBrowserTab } from './browser.js';
import { registerTabsApi } from './tabs-api.js';
import {
  applyNotebookSurface,
  shutdownNotebookKernel,
  ensureNotebookModel,
  parseNotebook,
  renderNotebook,
  syncNotebookContent,
  createNotebookTab,
} from './notebook.js';

const dom = getDom();

export { isTerminalTab, findTerminalTabIndex, isNotebookTab, isNotebookPath };

const TAB_DRAG_MIME = 'application/x-frogee-tab';
const SPLIT_RIGHT_RATIO = 0.6;

function isTabDragEvent(e) {
  const types = [...(e.dataTransfer?.types || [])];
  return types.includes('text/plain') || types.includes(TAB_DRAG_MIME) || types.includes('text/tab-index');
}

function parseTabDragIndex(dataTransfer) {
  const frogee = dataTransfer.getData(TAB_DRAG_MIME);
  if (frogee !== '') return parseInt(frogee, 10);
  const tabIdx = dataTransfer.getData('text/tab-index');
  if (tabIdx !== '') return parseInt(tabIdx, 10);
  const plain = dataTransfer.getData('text/plain') || '';
  if (plain === 'terminal-panel') return NaN;
  return parseInt(plain, 10);
}

export function showWelcomePage() {
  if (dom.welcomePage) dom.welcomePage.style.display = 'flex';
  if (dom.editorTabs) dom.editorTabs.style.display = 'none';
  const editorsRow = document.getElementById('editors-row');
  if (editorsRow) editorsRow.style.display = 'none';
  if (dom.editorContainer) dom.editorContainer.style.display = 'none';
  const host = getTerminalEditorHost();
  if (host) host.style.display = 'none';
  applyNotebookSurface(false);
  applyBrowserSurface(false);
  // Если терминал был во вкладке — вернуть в dock
  if (state.terminalInEditor) {
    state.terminalInEditor = false;
    applyTerminalPlacement();
  }
}

export function hideWelcomePage() {
  if (dom.welcomePage) dom.welcomePage.style.display = 'none';
  if (dom.editorTabs) dom.editorTabs.style.display = 'flex';
  const editorsRow = document.getElementById('editors-row');
  if (editorsRow) {
    editorsRow.style.display = 'flex';
    editorsRow.style.flex = '1';
    editorsRow.style.minHeight = '0';
  }
  if (!state.terminalInEditor && dom.editorContainer) {
    dom.editorContainer.style.display = 'flex';
    dom.editorContainer.style.flex = '1';
    dom.editorContainer.style.minHeight = '0';
  }
}

export function handleNewFileAction() {
  hideWelcomePage();
  createNewFile();
}

export function handleOpenFileAction() {
  hideWelcomePage();
  openFileOrFolder();
}

export function handleAiChatAction() {
  // Открываем чат с AI
  if (!state.chatVisible) {
    toggleChat();
  }
}

export function handleWelcomeCheckboxChange() {
  saveAllConfig();
}

// Функции для работы с активностью

export function restoreTab(name, content = '', filePath = null, kind = 'file') {
  if (kind === 'terminal') return;
  if (kind === 'browser') {
    state.currentTabs.push(createBrowserTab(content || 'about:blank', name));
    return;
  }
  const notebook = isNotebookPath(name) || isNotebookPath(filePath) || kind === 'notebook';
  if (notebook) {
    const tab = createNotebookTab(name || 'Untitled.ipynb', filePath || null);
    if (content) {
      tab.content = content;
      tab.notebook = parseNotebook(content);
      tab.modified = false;
    }
    state.currentTabs.push(tab);
    return;
  }
  state.currentTabs.push({
    id: Date.now() + Math.random(),
    kind: 'file',
    name: name || 'Новый файл',
    content: content || '',
    filePath: filePath || null,
    modified: false
  });
}

export function createTab(name, content = '', filePath = null) {
  if (filePath) {
    const existing = state.currentTabs.findIndex(
      (t) => t && t.kind !== 'terminal' && t.filePath && t.filePath === filePath
    );
    if (existing >= 0) {
      state.currentTabs[existing].content = content;
      if (isNotebookTab(state.currentTabs[existing]) || isNotebookPath(filePath)) {
        state.currentTabs[existing].kind = 'notebook';
        state.currentTabs[existing].notebook = parseNotebook(content);
      }
      hideWelcomePage();
      showTab(existing);
      return;
    }
  }
  // Если сейчас открыт терминал как вкладка — сначала вернуть редактор
  if (state.terminalInEditor) {
    state.terminalInEditor = false;
    applyTerminalPlacement();
  }
  restoreTab(name, content, filePath);
  hideWelcomePage();
  showTab(state.currentTabs.length - 1);
  saveTabs();
}

/** Show a tab in the pane the user is working in: the right one when it has focus, otherwise the left. */
/** True when the right pane shows a browser tab (live preview next to the code). */
export function isBrowserSplit() {
  return state.splitView && isBrowserTab(state.currentTabs[state.rightTabIndex]);
}

export function showTab(index) {
  const tab = state.currentTabs[index];
  const rightFocused = state.splitView && state.focusedPane === 'right' && state.rightTabIndex >= 0;
  if (rightFocused && isEditorTab(tab) && !isBrowserSplit()) {
    openTabInSplit(index);
  } else if (rightFocused && isBrowserTab(tab)) {
    openTabInSplit(index);
  } else {
    switchToTab(index);
  }
}

export function createNewTab() {
  createTab('Новый файл');
}

export function createNewFile() {
  createTab('Новый файл');
}

export function switchToTab(index) {
  if (index < 0 || index >= state.currentTabs.length) return;
  const tab = state.currentTabs[index];
  if (!tab) return;

  // Сохраняем содержимое текущей файловой вкладки
  if (state.activeTabIndex >= 0 && state.activeTabIndex < state.currentTabs.length) {
    const prev = state.currentTabs[state.activeTabIndex];
    if (prev && isNotebookTab(prev)) {
      syncNotebookContent(prev);
    } else if (isEditorTab(prev) && dom.editor && !state.terminalInEditor) {
      prev.content = dom.editor.value;
    }
  }

  // Picking another browser tab while a browser is open beside the code replaces the browser pane.
  if (isBrowserTab(tab) && isBrowserSplit() && index !== state.rightTabIndex && !isBrowserTab(state.currentTabs[state.activeTabIndex])) {
    state.rightTabIndex = index;
    setSplitView(true);
    renderRightPane();
    updateTabsList();
    return;
  }
  if (isBrowserTab(tab) && state.splitView && state.rightTabIndex === index) {
    // The split browser was asked for as the main view: it takes the whole area.
    setSplitView(false);
  }

  state.activeTabIndex = index;
  if (!(isBrowserSplit() && !isBrowserTab(tab))) applyBrowserSurface(false);

  if (isTerminalTab(tab)) {
    if (state.splitView) setSplitView(false);
    applyNotebookSurface(false);
    state.terminalVisible = true;
    state.terminalInEditor = true;
    hideWelcomePage();
    applyTerminalPlacement();
    ensureXterm();
    ensureTerminalStarted().then(() => {
      requestAnimationFrame(() => {
        fitTerminal();
        if (state.xterm) state.xterm.focus();
      });
    }).catch((err) => console.error('terminal start:', err));
    updateTabsList();
    updateTabTitle();
    updateStatusBar();
    return;
  }

  // Файловая вкладка — убрать терминал из области редактора (оставить в dock если был visible)
  if (state.terminalInEditor) {
    state.terminalInEditor = false;
    const stillHasTermTab = findTerminalTabIndex() >= 0;
    if (stillHasTermTab) {
      state.terminalVisible = false;
    }
    applyTerminalPlacement();
  }

  hideWelcomePage();

  if (isBrowserTab(tab)) {
    applyNotebookSurface(false);
    applyBrowserSurface(true);
    renderBrowser(tab);
    updateTabsList();
    updateTabTitle();
    updateStatusBar();
    return;
  }

  if (isNotebookTab(tab)) {
    ensureNotebookModel(tab);
    applyNotebookSurface(true);
    renderNotebook(tab).catch((err) => console.error('[notebook] render:', err));
    if (state.splitView) {
      setSplitView(true);
      renderRightPane();
    }
    updateTabsList();
    updateTabTitle();
    updateStatusBar();
    return;
  }

  applyNotebookSurface(false);
  if (dom.editorContainer) {
    dom.editorContainer.style.display = 'flex';
    dom.editorContainer.style.flex = '1';
  }
  if (dom.editor) {
    dom.editor.value = tab.content || '';
    try { dom.editor.focus(); } catch {}
  }

  updateTabsList();
  updateTabTitle();
  updateLineNumbers();
  updateSyntaxHighlight();
  updateStatusBar();
  if (state.splitView) {
    // Notebook / browser / terminal surfaces hide the second pane; bring it back with the editor.
    setSplitView(true);
    renderRightPane();
  }
}

function showTabMenu(event, index) {
  const tab = state.currentTabs[index];
  if (!tab) return;
  state.contextMenu?.remove();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.cssText = `position:fixed;left:${event.clientX}px;top:${event.clientY}px;z-index:10000`;
  const items = [];
  if (isBrowserTab(tab)) {
    const isRight = state.splitView && state.rightTabIndex === index;
    items.push(isRight
      ? { label: 'Развернуть на всё окно', run: () => { setSplitView(false); switchToTab(index); } }
      : { label: 'Открыть рядом с редактором', run: () => openTabInSplit(index) });
  }
  if (isEditorTab(tab)) {
    items.push({ label: 'Открыть справа', run: () => openTabInSplit(index) });
    items.push({ label: 'Открыть слева', run: () => { setFocusedPane('left'); switchToTab(index); } });
    if (state.splitView) items.push({ label: 'Закрыть разделение', run: () => { setSplitView(false); updateTabsList(); } });
    if (state.splitView) items.push({ label: 'Поменять панели местами', run: swapPanes });
  }
  if (tab.filePath) items.push({ label: 'Скопировать путь', run: () => navigator.clipboard?.writeText(tab.filePath) });
  items.push({ label: 'Закрыть', run: () => closeTab(index) });
  items.push({ label: 'Закрыть остальные', run: () => {
    for (let i = state.currentTabs.length - 1; i >= 0; i--) if (i !== index && state.currentTabs[i].kind !== 'terminal') closeTab(i);
  } });
  items.forEach((item) => {
    const el = document.createElement('div');
    el.className = 'context-menu-item';
    el.textContent = item.label;
    el.addEventListener('click', () => { menu.remove(); state.contextMenu = null; item.run(); });
    menu.appendChild(el);
  });
  document.body.appendChild(menu);
  state.contextMenu = menu;
  const close = (e) => {
    if (!menu.contains(e.target)) { menu.remove(); state.contextMenu = null; document.removeEventListener('mousedown', close, true); }
  };
  setTimeout(() => document.addEventListener('mousedown', close, true), 0);
}

export function setFocusedPane(side) {
  state.focusedPane = side === 'right' && state.splitView ? 'right' : 'left';
  document.getElementById('editor-container')?.classList.toggle('pane-focused', state.focusedPane === 'left');
  document.getElementById('editor-container-right')?.classList.toggle('pane-focused', state.focusedPane === 'right');
}

export function swapPanes() {
  if (!state.splitView || state.rightTabIndex < 0 || state.activeTabIndex < 0) return;
  if (!isEditorTab(state.currentTabs[state.activeTabIndex]) || !isEditorTab(state.currentTabs[state.rightTabIndex])) return;
  if (dom.editor) state.currentTabs[state.activeTabIndex].content = dom.editor.value;
  const right = state.rightTabIndex;
  state.rightTabIndex = state.activeTabIndex;
  state.activeTabIndex = -1;
  switchToTab(right);
  renderRightPane();
}

function updatePaneTitles() {
  const left = state.currentTabs[state.activeTabIndex];
  const leftTitle = document.getElementById('left-pane-title');
  if (leftTitle) leftTitle.textContent = left && isEditorTab(left) ? left.name + (left.modified ? ' *' : '') : '';
  const right = state.currentTabs[state.rightTabIndex];
  const rightTitle = document.getElementById('right-pane-title');
  if (rightTitle && state.splitView && right) rightTitle.textContent = right.name + (right.modified ? ' *' : '');
}

function rememberClosedTab(tab) {
  if (!tab.filePath && !tab.content) return;
  if (!state.closedTabs) state.closedTabs = [];
  state.closedTabs.push({ name: tab.name, content: tab.content || '', filePath: tab.filePath || null, kind: tab.kind || 'file' });
  if (state.closedTabs.length > 20) state.closedTabs.shift();
}

export function reopenClosedTab() {
  const last = state.closedTabs?.pop();
  if (!last) return false;
  restoreTab(last.name, last.content, last.filePath, last.kind);
  switchToTab(state.currentTabs.length - 1);
  saveTabs();
  return true;
}

export function closeTab(index) {
  if (index < 0 || index >= state.currentTabs.length) return;
  const tab = state.currentTabs[index];
  if (!tab) return;

  if (isTerminalTab(tab)) {
    state.currentTabs.splice(index, 1);
    state.terminalInEditor = false;
    state.terminalVisible = false;
    applyTerminalPlacement();
    if (dom.terminalBtn) dom.terminalBtn.classList.remove('active');
    if (dom.statusTerminalBtn) dom.statusTerminalBtn.classList.remove('active');
    if (state.currentTabs.length === 0) {
      state.activeTabIndex = -1;
      showWelcomePage();
    } else {
      const next = Math.min(index, state.currentTabs.length - 1);
      state.activeTabIndex = -1; // force full switch
      switchToTab(next);
    }
    saveTabs();
    return;
  }

  if (tab.modified) {
    if (!confirm(`Файл "${tab.name}" не сохранен. Закрыть?`)) {
      return;
    }
  }

  if (state.splitView && state.rightTabIndex === index) {
    setSplitView(false);
  } else if (state.rightTabIndex > index) {
    state.rightTabIndex--;
  }

  if (isNotebookTab(tab)) shutdownNotebookKernel(tab);
  if (isBrowserTab(tab)) destroyBrowser(tab);
  else if (isEditorTab(tab) || isNotebookTab(tab)) rememberClosedTab(tab);
  const wasActive = state.activeTabIndex === index;
  state.currentTabs.splice(index, 1);

  if (state.activeTabIndex > index) state.activeTabIndex--;

  if (state.currentTabs.length === 0) {
    state.activeTabIndex = -1;
    showWelcomePage();
    setSplitView(false);
  } else if (wasActive) {
    const next = Math.min(index, state.currentTabs.length - 1);
    state.activeTabIndex = -1;
    switchToTab(next);
  } else {
    updateTabsList();
    updateTabTitle();
    updateStatusBar();
  }

  saveTabs();
}

export function updateTabsList() {
  if (!dom.tabsList) return;
  dom.tabsList.innerHTML = '';

  state.currentTabs.forEach((tab, index) => {
    const tabElement = document.createElement('div');
    const isLeft = index === state.activeTabIndex;
    const isRight = state.splitView && index === state.rightTabIndex && (isEditorTab(tab) || isBrowserTab(tab));
    const isTerm = isTerminalTab(tab);
    const isNb = isNotebookTab(tab);
    const isBr = isBrowserTab(tab);
    tabElement.className = `tab-item${isLeft ? ' active' : ''}${isRight ? ' split-active' : ''}${isTerm ? ' terminal-tab-item' : ''}${isNb ? ' notebook-tab-item' : ''}${isBr ? ' browser-tab-item' : ''}`;
    tabElement.draggable = true;
    tabElement.dataset.index = String(index);
    tabElement.dataset.kind = isTerm ? 'terminal' : (isNb ? 'notebook' : (isBr ? 'browser' : 'file'));
    tabElement.innerHTML = `
      <span class="tab-name">${isTerm ? '⌘ ' : ''}${escapeHtml(tab.name)}${tab.modified ? ' *' : ''}</span>
      ${isRight ? '<span class="tab-pane-badge" title="Справа">R</span>' : ''}
      <button class="tab-close" type="button" data-close="${index}" title="Закрыть">&times;</button>
    `;
    tabElement.querySelector('.tab-close')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeTab(index);
    });
    tabElement.addEventListener('click', (e) => {
      if (e.target.closest('.tab-close')) return;
      if (isEditorTab(tab) && e.altKey) {
        openTabInSplit(index);
        return;
      }
      showTab(index);
    });
    tabElement.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showTabMenu(e, index);
    });

    tabElement.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', String(index));
      e.dataTransfer.setData('text/tab-index', String(index));
      e.dataTransfer.setData('application/x-frogee-tab', String(index));
      e.dataTransfer.setData('text/tab-kind', isTerm ? 'terminal' : 'file');
      e.dataTransfer.effectAllowed = 'copyMove';
      tabElement.classList.add('dragging');
      document.body.classList.add('is-dragging-tab');
    });
    tabElement.addEventListener('dragend', () => {
      tabElement.classList.remove('dragging');
      document.body.classList.remove('is-dragging-tab');
      document.getElementById('editors-row')?.classList.remove('split-drop-hover');
      document.getElementById('split-drop-zone')?.classList.remove('active');
    });
    tabElement.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      tabElement.classList.add('drag-over');
    });
    tabElement.addEventListener('dragleave', () => tabElement.classList.remove('drag-over'));
    tabElement.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      tabElement.classList.remove('drag-over');
      const plain = e.dataTransfer.getData('text/plain') || '';
      if (e.dataTransfer.getData('text/terminal-panel') === '1' || plain === 'terminal-panel') {
        openTerminalAsEditorTab();
        return;
      }
      const fromRaw = e.dataTransfer.getData('text/tab-index') || plain;
      const from = parseInt(fromRaw, 10);
      const to = index;
      if (Number.isNaN(from) || from === to) return;
      reorderTab(from, to);
    });

    dom.tabsList.appendChild(tabElement);
  });

  updatePaneTitles();
  setupSplitDropTargets();
  setupTabsBarDrop();
}

export function setupTabsBarDrop() {
  if (!dom.editorTabs) return;
  dom.editorTabs.ondragover = (e) => {
    const types = [...(e.dataTransfer?.types || [])];
    const plain = (() => { try { return e.dataTransfer.getData('text/plain'); } catch { return ''; } })();
    if (
      types.includes('text/terminal-panel') ||
      types.includes('text/tab-index') ||
      types.includes('text/plain') ||
      plain === 'terminal-panel'
    ) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      dom.editorTabs.classList.add('tabs-drop-hover');
    }
  };
  dom.editorTabs.ondragleave = (e) => {
    if (!dom.editorTabs.contains(e.relatedTarget)) {
      dom.editorTabs.classList.remove('tabs-drop-hover');
    }
  };
  dom.editorTabs.ondrop = (e) => {
    dom.editorTabs.classList.remove('tabs-drop-hover');
    e.preventDefault();
    e.stopPropagation();
    const plain = e.dataTransfer.getData('text/plain') || '';
    const isTerminalDrag =
      e.dataTransfer.getData('text/terminal-panel') === '1' ||
      plain === 'terminal-panel';
    if (isTerminalDrag) {
      openTerminalAsEditorTab();
      return;
    }
    const fromRaw = e.dataTransfer.getData('text/tab-index') || plain;
    const from = parseInt(fromRaw, 10);
    if (!Number.isNaN(from) && from >= 0 && from < state.currentTabs.length) {
      reorderTab(from, state.currentTabs.length - 1);
    }
  };
}

export function reorderTab(from, to) {
  if (from < 0 || to < 0 || from >= state.currentTabs.length || to >= state.currentTabs.length) return;
  if (from === to) return;
  const [item] = state.currentTabs.splice(from, 1);
  state.currentTabs.splice(to, 0, item);
  if (state.activeTabIndex === from) state.activeTabIndex = to;
  else if (from < state.activeTabIndex && to >= state.activeTabIndex) state.activeTabIndex--;
  else if (from > state.activeTabIndex && to <= state.activeTabIndex) state.activeTabIndex++;
  if (state.rightTabIndex === from) state.rightTabIndex = to;
  else if (from < state.rightTabIndex && to >= state.rightTabIndex) state.rightTabIndex--;
  else if (from > state.rightTabIndex && to <= state.rightTabIndex) state.rightTabIndex++;
  updateTabsList();
  saveTabs();
}

export function openTabInSplit(index) {
  if (index < 0 || index >= state.currentTabs.length) return;
  const tab = state.currentTabs[index];
  if (!tab) return;
  if (isTerminalTab(tab)) {
    openTerminalAsEditorTab();
    return;
  }
  if (isBrowserTab(tab)) {
    // Beside the code: the left pane keeps (or picks) an editor / notebook tab.
    const usable = (t) => isEditorTab(t) || isNotebookTab(t);
    let leftIndex = state.activeTabIndex;
    if (!usable(state.currentTabs[leftIndex])) {
      leftIndex = -1;
      for (let i = state.currentTabs.length - 1; i >= 0; i--) {
        if (i !== index && usable(state.currentTabs[i])) { leftIndex = i; break; }
      }
    }
    if (leftIndex < 0) {
      switchToTab(index); // nothing to put next to it
      return;
    }
    state.rightTabIndex = index;
    state.splitView = true;
    hideWelcomePage();
    if (state.activeTabIndex !== leftIndex) switchToTab(leftIndex);
    setSplitView(true);
    renderRightPane();
    updateTabsList();
    return;
  }
  if (isNotebookTab(tab)) {
    switchToTab(index);
    return;
  }
  if (!isEditorTab(state.currentTabs[state.activeTabIndex])) {
    switchToTab(index); // the other pane is not a text editor: nothing to split against
    return;
  }

  // Выходим из режима «терминал как вкладка», чтобы показать оба редактора
  if (state.terminalInEditor) {
    state.terminalInEditor = false;
    state.terminalVisible = false;
    applyTerminalPlacement();
  }

  if (state.activeTabIndex >= 0 && dom.editor && isEditorTab(state.currentTabs[state.activeTabIndex])) {
    state.currentTabs[state.activeTabIndex].content = dom.editor.value;
  }

  // Если перетаскивают активную вкладку — левая остаётся ею, справа открываем её же
  // (как в VS Code: одна вкладка может быть в двух панелях)
  state.rightTabIndex = index;
  if (state.activeTabIndex < 0) {
    state.activeTabIndex = index;
  }
  hideWelcomePage();
  setSplitView(true);
  // Гарантировать видимость левой панели
  if (dom.editorContainer) {
    dom.editorContainer.style.display = 'flex';
    dom.editorContainer.style.flex = '1';
  }
  if (state.activeTabIndex >= 0 && isEditorTab(state.currentTabs[state.activeTabIndex]) && dom.editor) {
    dom.editor.value = state.currentTabs[state.activeTabIndex].content || '';
  }
  renderRightPane();
  updateTabsList();
  updateLineNumbers();
  updateSyntaxHighlight();
}

/** Lays out the second pane: another editor, or the browser host (the webview must never be re-parented). */
function layoutSplit() {
  const right = document.getElementById('editor-container-right');
  const resizer = document.getElementById('split-resizer');
  const closeSplitBtn = document.getElementById('close-split-btn');
  const editorsRow = document.getElementById('editors-row');
  const browserHost = document.getElementById('browser-host');
  const browserSide = isBrowserSplit();
  if (right) right.style.display = state.splitView && !browserSide ? 'flex' : 'none';
  if (resizer) resizer.style.display = state.splitView ? 'block' : 'none';
  if (closeSplitBtn) closeSplitBtn.style.display = state.splitView ? 'inline-flex' : 'none';
  if (editorsRow) {
    editorsRow.classList.toggle('is-split', state.splitView);
    editorsRow.classList.toggle('browser-split', browserSide);
  }
  // A notebook on the left owns that pane: the text editor must stay hidden (hideWelcomePage re-shows it).
  const front = state.currentTabs[state.activeTabIndex];
  if (state.splitView && isNotebookTab(front)) {
    if (dom.editorContainer) dom.editorContainer.style.display = 'none';
    const nbHost = document.getElementById('notebook-host');
    if (nbHost) {
      nbHost.style.display = 'flex';
      if (browserSide) { nbHost.style.flex = nbHost.style.flex.startsWith('1 1') || !nbHost.style.flex ? '1 1 0' : nbHost.style.flex; nbHost.style.width = 'auto'; }
    }
  }
  if (browserHost) {
    if (browserSide) browserHost.style.display = 'flex';
    else if (!isBrowserTab(state.currentTabs[state.activeTabIndex])) browserHost.style.display = 'none';
  }
}

export function setSplitView(enabled) {
  state.splitView = !!enabled;
  layoutSplit();
  if (!state.splitView) {
    state.rightTabIndex = -1;
    state.focusedPane = 'left';
    document.getElementById('editor-container')?.classList.remove('pane-focused');
    // Forget a dragged ratio so the next split starts 50/50.
    ['editor-container', 'editor-container-right', 'browser-host', 'notebook-host'].forEach((id) => { const el = document.getElementById(id); if (el) { el.style.flex = ''; if (id === 'notebook-host' || id === 'browser-host') el.style.width = ''; } });
    const active = state.currentTabs[state.activeTabIndex];
    if (dom.editorContainer && !isNotebookTab(active) && !isBrowserTab(active) && !isTerminalTab(active)) {
      dom.editorContainer.style.display = 'flex';
      dom.editorContainer.style.flex = '1';
    }
  }
}

export function renderRightPane() {
  const editorRight = document.getElementById('editor-right');
  const title = document.getElementById('right-pane-title');
  if (!state.splitView || state.rightTabIndex < 0 || !state.currentTabs[state.rightTabIndex]) return;
  if (!editorRight) return;
  const tab = state.currentTabs[state.rightTabIndex];
  if (isBrowserTab(tab)) {
    layoutSplit();
    renderBrowser(tab);
    return;
  }
  if (!isEditorTab(tab)) {
    setSplitView(false);
    return;
  }
  if (title) title.textContent = tab.name + (tab.modified ? ' *' : '');
  editorRight.value = tab.content || '';
  updateSecondaryChrome();
}

export function updateSecondaryChrome() {
  const editorRight = document.getElementById('editor-right');
  const lineRight = document.getElementById('line-numbers-right');
  const syntaxRight = document.getElementById('syntax-highlight-right');
  if (!editorRight) return;
  const text = editorRight.value || '';
  const lines = text.split('\n').length;
  if (lineRight) {
    let html = '';
    for (let i = 1; i <= Math.max(1, lines); i++) html += `<span class="line-number">${i}</span>`;
    lineRight.innerHTML = html;
    lineRight.scrollTop = editorRight.scrollTop;
    markRightCurrentLine();
  }
  if (syntaxRight && window.SyntaxHighlight) {
    const name = state.rightTabIndex >= 0 ? state.currentTabs[state.rightTabIndex]?.name : '';
    syntaxRight.innerHTML = window.SyntaxHighlight.highlight(text, name || '');
    syntaxRight.scrollTop = editorRight.scrollTop;
  }
}

export function markRightCurrentLine() {
  const editorRight = document.getElementById('editor-right');
  const lineRight = document.getElementById('line-numbers-right');
  if (!editorRight || !lineRight) return;
  const current = editorRight.value.slice(0, editorRight.selectionStart).split('\n').length - 1;
  lineRight.querySelectorAll('.line-number.current').forEach((el) => el.classList.remove('current'));
  lineRight.children[current]?.classList.add('current');
}

export function setupSplitDropTargets() {
  const right = document.getElementById('editor-container-right');
  const left = document.getElementById('editor-container');
  const editorsRow = document.getElementById('editors-row');
  if (!editorsRow) return;

  // Постоянная зона дропа справа (создаём один раз)
  let zone = document.getElementById('split-drop-zone');
  if (!zone) {
    zone = document.createElement('div');
    zone.id = 'split-drop-zone';
    zone.className = 'split-drop-zone';
    zone.innerHTML = '<span>Открыть справа</span>';
    editorsRow.appendChild(zone);
  }

  const clearHover = () => {
    editorsRow.classList.remove('split-drop-hover');
    zone.classList.remove('active');
  };

  const onDragOverRow = (e) => {
    if (!isTabDragEvent(e)) return;
    const rect = editorsRow.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / Math.max(1, rect.width);
    if (state.splitView) {
      // With two panes open, each half is its own drop target.
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      editorsRow.classList.remove('split-drop-hover');
      zone.classList.remove('active');
      return;
    }
    if (ratio > SPLIT_RIGHT_RATIO) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      editorsRow.classList.add('split-drop-hover');
      zone.classList.add('active');
    } else {
      clearHover();
    }
  };

  const onDropSplit = (e) => {
    clearHover();
    const rect = editorsRow.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / Math.max(1, rect.width);
    // drop на правую зону или на правую панель
    const mid = state.splitView ? (document.getElementById('split-resizer')?.getBoundingClientRect().left ?? rect.left + rect.width / 2) : null;
    const onRight = state.splitView
      ? e.clientX > mid
      : ratio > SPLIT_RIGHT_RATIO || e.currentTarget === right || e.currentTarget === zone;
    if (!isTabDragEvent(e)) return;
    const from = parseTabDragIndex(e.dataTransfer);
    if (Number.isNaN(from) || from < 0 || from >= state.currentTabs.length) return;
    if (!onRight && !state.splitView) return;
    e.preventDefault();
    e.stopPropagation();
    if (onRight) {
      openTabInSplit(from);
    } else if (isEditorTab(state.currentTabs[from])) {
      setFocusedPane('left');
      switchToTab(from);
    }
  };

  editorsRow.ondragover = onDragOverRow;
  editorsRow.ondragleave = (e) => {
    if (!editorsRow.contains(e.relatedTarget)) clearHover();
  };
  editorsRow.ondrop = onDropSplit;

  zone.ondragover = (e) => {
    if (!isTabDragEvent(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    zone.classList.add('active');
    editorsRow.classList.add('split-drop-hover');
  };
  zone.ondrop = onDropSplit;

  if (right) {
    right.ondragover = (e) => {
      if (!isTabDragEvent(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    };
    right.ondrop = onDropSplit;
  }
  if (left) {
    left.ondragover = (e) => {
      if (!isTabDragEvent(e)) return;
      // слева — только preventDefault чтобы не блокировать, split не открываем
    };
  }
}

export function setupSplitUi() {
  document.getElementById('split-right-btn')?.addEventListener('click', () => {
    if (state.activeTabIndex >= 0) openTabInSplit(state.activeTabIndex);
  });
  document.getElementById('close-split-btn')?.addEventListener('click', () => {
    setSplitView(false);
    updateTabsList();
  });
  document.getElementById('close-right-pane-btn')?.addEventListener('click', () => {
    setSplitView(false);
    updateTabsList();
  });

  const editorRight = document.getElementById('editor-right');
  if (editorRight) {
    const smartRight = createSmartKeydown(() => ({
      tabSize: parseInt(dom.tabSizeSelect?.value || '4', 10),
      lang: langFromName(state.currentTabs[state.rightTabIndex]?.name || ''),
    }));
    editorRight.addEventListener('keydown', (e) => smartRight(e));
    editorRight.addEventListener('focus', () => setFocusedPane('right'));
    dom.editor?.addEventListener('focus', () => setFocusedPane('left'));
    document.getElementById('left-pane-header')?.addEventListener('mousedown', () => { setFocusedPane('left'); dom.editor?.focus(); });
    document.getElementById('right-pane-header')?.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      setFocusedPane('right');
      editorRight.focus();
    });
    ['keyup', 'click'].forEach((evt) => editorRight.addEventListener(evt, markRightCurrentLine));
    editorRight.addEventListener('input', () => {
      if (state.rightTabIndex >= 0 && state.currentTabs[state.rightTabIndex]) {
        state.currentTabs[state.rightTabIndex].content = editorRight.value;
        state.currentTabs[state.rightTabIndex].modified = true;
        // The same file can be open in both panes: keep them identical.
        if (state.rightTabIndex === state.activeTabIndex && dom.editor && dom.editor.value !== editorRight.value) {
          dom.editor.value = editorRight.value;
          updateLineNumbers();
          updateSyntaxHighlight();
        }
        updateTabsList();
        updateSecondaryChrome();
        saveAllConfig();
      }
    });
    editorRight.addEventListener('scroll', () => {
      const lineRight = document.getElementById('line-numbers-right');
      const syntaxRight = document.getElementById('syntax-highlight-right');
      if (lineRight) lineRight.scrollTop = editorRight.scrollTop;
      if (syntaxRight) syntaxRight.scrollTop = editorRight.scrollTop;
    });
  }

  const resizer = document.getElementById('split-resizer');
  if (resizer) {
    let dragging = false;
    resizer.addEventListener('mousedown', (e) => {
      dragging = true;
      document.body.classList.add('resizing-panel');
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging || !state.splitView) return;
      const row = document.getElementById('editors-row');
      if (!row) return;
      const rect = row.getBoundingClientRect();
      const ratio = Math.min(0.8, Math.max(0.2, (e.clientX - rect.left) / rect.width));
      const second = document.getElementById(isBrowserSplit() ? 'browser-host' : 'editor-container-right');
      const first = document.getElementById(isNotebookTab(state.currentTabs[state.activeTabIndex]) ? 'notebook-host' : 'editor-container');
      if (first) first.style.flex = String(ratio);
      if (second) second.style.flex = String(1 - ratio);
    });
    document.addEventListener('mouseup', () => {
      dragging = false;
      document.body.classList.remove('resizing-panel');
    });
  }
}

export function updateTabTitle() {
  if (state.activeTabIndex >= 0 && state.activeTabIndex < state.currentTabs.length) {
    const tab = state.currentTabs[state.activeTabIndex];
    document.title = `${tab.name}${tab.modified ? ' *' : ''} - FrogeeCodeIDE`;
  }
}

registerTabsApi({
  hideWelcomePage,
  showWelcomePage,
  switchToTab,
  closeTab,
  updateTabsList,
  updateTabTitle,
  createTab,
  openTabInSplit,
  setSplitView,
  setFocusedPane,
  isBrowserSplit,
});
