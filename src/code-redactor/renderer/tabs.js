import { state } from './state.js';
import { createSmartKeydown } from './smart-edit.js';
import { smartOptsFor } from './ext-contrib.js';
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
import { isTerminalTab, findTerminalTabIndex, isNotebookTab, isNotebookPath, isBrowserTab, isEditorTab, isPreviewTab, isImageTab, isPluginTab } from './tab-model.js';
import { isImagePath, isBinaryPath, createImageTab, applyImageSurface, renderImage, toast } from './image-view.js';
import { syncMarkdownPane, previewOwnsPane, closeMarkdownPreview } from './markdown.js';
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
import { icon } from './glyphs.js';
import { getLang, uiText } from './i18n.js';

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
  const crumbs = document.getElementById('breadcrumbs');
  if (crumbs) crumbs.hidden = true;
  const editorsRow = document.getElementById('editors-row');
  if (editorsRow) editorsRow.style.display = 'none';
  if (dom.editorContainer) dom.editorContainer.style.display = 'none';
  const host = getTerminalEditorHost();
  if (host) host.style.display = 'none';
  applyNotebookSurface(false);
  applyBrowserSurface(false);
  // Если терминал был во вкладке - вернуть в dock
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
    if (!state.splitView && !state.mdPreview?.open) dom.editorContainer.style.flex = '1';
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
  if (kind === 'terminal' || kind === 'preview' || kind === 'plugin') return;
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
    name: name || uiText('Новый файл'),
    content: content || '',
    filePath: filePath || null,
    modified: false
  });
}

export function createTab(name, content = '', filePath = null) {
  // Pictures get a viewer; binary files (wheels, archives, executables…) are never shown as text.
  if (filePath && isImagePath(filePath)) {
    const at = state.currentTabs.findIndex((t) => isImageTab(t) && t.filePath === filePath);
    if (at >= 0) { hideWelcomePage(); showTab(at); return; }
    state.currentTabs.push(createImageTab(name || filePath.split(/[\\/]/).pop(), filePath));
    hideWelcomePage();
    showTab(state.currentTabs.length - 1);
    return;
  }
  if (content === null || (filePath && isBinaryPath(filePath))) {
    const shown = name || (filePath || '').split(/[\\/]/).pop();
    const ext = (/\.([A-Za-z0-9]+)$/.exec(shown) || [])[1];
    toast(isBinaryPath(shown) ? `«${shown}» - бинарный файл${ext ? ` (.${ext})` : ''}, в редакторе он не открывается` : `«${shown}» не открыт: файл бинарный или слишком большой`);
    return;
  }
  if (filePath) {
    const existing = state.currentTabs.findIndex(
      (t) => t && t.kind !== 'terminal' && t.filePath && t.filePath === filePath
    );
    if (existing >= 0) {
      const tab = state.currentTabs[existing];
      if (!tab.modified && tab.content !== content) {
        tab.content = content;
        tab.diskContent = content;
        if (isNotebookTab(tab)) tab.notebook = parseNotebook(content);
        if (isEditorTab(tab) && existing === state.activeTabIndex && dom.editor) dom.editor.value = content;
        if (isEditorTab(tab) && state.splitView && existing === state.rightTabIndex) renderRightPane();
      }
      hideWelcomePage();
      showTab(existing);
      return;
    }
  }
  // Если сейчас открыт терминал как вкладка - сначала вернуть редактор
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
  if (rightFocused && isEditorTab(tab) && !isBrowserSplit() && !previewOwnsPane()) {
    openTabInSplit(index);
  } else if (rightFocused && isBrowserTab(tab)) {
    openTabInSplit(index);
  } else {
    switchToTab(index);
  }
}

export function createNewTab() {
  createTab(uiText('Новый файл'));
}

export function createNewFile() {
  createTab(uiText('Новый файл'));
}

export function switchToTab(index) {
  if (index < 0 || index >= state.currentTabs.length) return;
  const tab = state.currentTabs[index];
  if (!tab) return;
  if (isPreviewTab(tab)) {
    if (tab.sourceId) state.mdPreview = { open: true, sourceId: tab.sourceId };
    syncMarkdownPane();
    return;
  }
  if (!isPluginTab(tab)) applyPluginSurface(false);
  if (!isImageTab(tab)) applyImageSurface(false);
  if (isImageTab(tab)) {
    // A picture takes the whole editor area.
    if (state.splitView) setSplitView(false);
    state.activeTabIndex = index;
    applyNotebookSurface(false);
    applyBrowserSurface(false);
    if (state.terminalInEditor) { state.terminalInEditor = false; applyTerminalPlacement(); }
    hideWelcomePage();
    applyImageSurface(true);
    renderImage(tab);
    updateTabsList();
    updateTabTitle();
    updateStatusBar();
    return;
  }

  // Сохраняем содержимое текущей файловой вкладки
  if (state.activeTabIndex >= 0 && state.activeTabIndex < state.currentTabs.length) {
    const prev = state.currentTabs[state.activeTabIndex];
    if (prev && isNotebookTab(prev)) {
      syncNotebookContent(prev);
    } else if (isEditorTab(prev) && dom.editor && !state.terminalInEditor) {
      prev.content = dom.editor.value;
    }
  }

  if (isPluginTab(tab)) {
    state.activeTabIndex = index;
    if (state.splitView) setSplitView(false);
    applyNotebookSurface(false);
    applyBrowserSurface(false);
    applyImageSurface(false);
    if (state.terminalInEditor) {
      state.terminalInEditor = false;
      applyTerminalPlacement();
    }
    hideWelcomePage();
    applyPluginSurface(true, tab);
    updateTabsList();
    updateTabTitle();
    updateStatusBar();
    return;
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

  // Файловая вкладка - убрать терминал из области редактора (оставить в dock если был visible)
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
    if (!state.splitView && !state.mdPreview?.open) dom.editorContainer.style.flex = '1';
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
  syncMarkdownPane();
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
  if (rightTitle && state.splitView && right) rightTitle.textContent = isPreviewTab(right) ? 'Просмотр' : right.name + (right.modified ? ' *' : '');
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

  if (isPluginTab(tab)) {
    if (tab.closing) return;
    tab.closing = true;
    const done = tab.onClose;
    tab.onClose = null;
    try { done?.(); } catch { /* the plugin is leaving anyway */ }
    tab.element?.remove();
    tab.element = null;
  }

  // A preview goes away with the file it shows.
  if (!isPreviewTab(tab)) {
    const pv = state.currentTabs.findIndex((t) => isPreviewTab(t) && t.sourceId === tab.id);
    if (pv >= 0) {
      closeTab(pv);
      closeTab(state.currentTabs.indexOf(tab));
      return;
    }
  }

  if (tab.modified) {
    if (!confirm(getLang() === 'en' ? `File "${tab.name}" is not saved. Close it?` : `Файл "${tab.name}" не сохранен. Закрыть?`)) {
      return;
    }
  }

  if (state.mdPreview?.open && state.mdPreview.sourceId === tab.id) {
    state.mdPreview = { open: false, sourceId: null };
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
    syncMarkdownPane();
  }

  saveTabs();
}

export function updateTabsList() {
  if (!dom.tabsList) return;
  dom.tabsList.innerHTML = '';

  state.currentTabs.forEach((tab, index) => {
    if (isPreviewTab(tab)) return;
    const tabElement = document.createElement('div');
    const isLeft = index === state.activeTabIndex;
    const isRight = state.splitView && index === state.rightTabIndex && (isEditorTab(tab) || isBrowserTab(tab) || isPreviewTab(tab));
    const isTerm = isTerminalTab(tab);
    const isNb = isNotebookTab(tab);
    const isBr = isBrowserTab(tab);
    const isPlugin = isPluginTab(tab);
    tabElement.className = `tab-item${isLeft ? ' active' : ''}${isRight ? ' split-active' : ''}${isTerm ? ' terminal-tab-item' : ''}${isNb ? ' notebook-tab-item' : ''}${isBr ? ' browser-tab-item' : ''}${isPlugin ? ' plugin-tab-item' : ''}${tab.missing ? ' tab-missing' : ''}`;
    tabElement.draggable = true;
    tabElement.dataset.index = String(index);
    tabElement.dataset.kind = isTerm ? 'terminal' : (isNb ? 'notebook' : (isBr ? 'browser' : (isPlugin ? 'plugin' : 'file')));
    tabElement.innerHTML = `
      <span class="tab-name">${escapeHtml(tab.name)}${tab.modified ? ' *' : ''}</span>
      ${isRight ? '<span class="tab-pane-badge" title="Справа">R</span>' : ''}
      <button class="tab-close" type="button" data-close="${index}" title="Закрыть">${icon('close', 10)}</button>
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
  if (isPreviewTab(tab)) {
    // The preview is a side pane, not a second file. Switching tabs must not jump back to its source.
    if (!tab.sourceId || !state.currentTabs.some((t) => t.id === tab.sourceId)) { closeTab(index); return; }
    state.mdPreview = { open: true, sourceId: tab.sourceId };
    hideWelcomePage();
    syncMarkdownPane();
    updateTabsList();
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
  if (isNotebookTab(tab) || isImageTab(tab)) {
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

  // Если перетаскивают активную вкладку - левая остаётся ею, справа открываем её же
  // (как в VS Code: одна вкладка может быть в двух панелях)
  state.rightTabIndex = index;
  if (state.activeTabIndex < 0) {
    state.activeTabIndex = index;
  }
  hideWelcomePage();
  setSplitView(true);
  applySplitRatio(readSplitRatio(), false);
  if (dom.editorContainer) dom.editorContainer.style.display = 'flex';
  if (state.activeTabIndex >= 0 && isEditorTab(state.currentTabs[state.activeTabIndex]) && dom.editor) {
    dom.editor.value = state.currentTabs[state.activeTabIndex].content || '';
  }
  renderRightPane();
  updateTabsList();
  updateLineNumbers();
  updateSyntaxHighlight();
}

const RATIO_KEY = 'frogee.splitRatio';
function readSplitRatio() {
  try {
    const n = Number(localStorage.getItem(RATIO_KEY));
    if (n >= 0.25 && n <= 0.75) return n;
  } catch { /* default half */ }
  return 0.5;
}
function splitPaneEls() {
  const firstId = isNotebookTab(state.currentTabs[state.activeTabIndex]) ? 'notebook-host' : 'editor-container';
  const secondId = isBrowserSplit() && !previewOwnsPane() ? 'browser-host' : 'editor-container-right';
  return [document.getElementById(firstId), document.getElementById(secondId)];
}
function applySplitRatio(ratio, persist) {
  const r = Math.min(0.75, Math.max(0.25, Number(ratio) || 0.5));
  if (persist) { try { localStorage.setItem(RATIO_KEY, String(r)); } catch { /* storage full */ } }
  const [first, second] = splitPaneEls();
  if (first) first.style.flex = `${r} 1 0px`;
  if (second) second.style.flex = `${1 - r} 1 0px`;
}

/** Lays out the second pane: another editor, the Markdown preview, or the browser host. */
function layoutSplit() {
  const right = document.getElementById('editor-container-right');
  const resizer = document.getElementById('split-resizer');
  const closeSplitBtn = document.getElementById('close-split-btn');
  const editorsRow = document.getElementById('editors-row');
  const browserHost = document.getElementById('browser-host');
  const previewSide = previewOwnsPane();
  const browserSide = isBrowserSplit() && !previewSide;
  const showSplit = state.splitView || previewSide;
  if (right) right.style.display = showSplit && !browserSide ? 'flex' : 'none';
  if (resizer) resizer.style.display = showSplit ? 'block' : 'none';
  if (closeSplitBtn) closeSplitBtn.style.display = showSplit ? 'inline-flex' : 'none';
  if (editorsRow) {
    editorsRow.classList.toggle('is-split', showSplit);
    editorsRow.classList.toggle('browser-split', browserSide);
    editorsRow.classList.toggle('md-split', previewSide);
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
  const was = state.splitView;
  state.splitView = !!enabled;
  if (!state.splitView) {
    state.rightTabIndex = -1;
    state.focusedPane = 'left';
    document.getElementById('editor-container')?.classList.remove('pane-focused');
    // The Markdown preview keeps the divider; only a real code split gives the editor the whole row.
    if (!previewOwnsPane()) {
      ['editor-container', 'editor-container-right', 'browser-host', 'notebook-host'].forEach((id) => { const el = document.getElementById(id); if (el) { el.style.flex = ''; if (id === 'notebook-host' || id === 'browser-host') el.style.width = ''; } });
      const active = state.currentTabs[state.activeTabIndex];
      if (dom.editorContainer && !isNotebookTab(active) && !isBrowserTab(active) && !isTerminalTab(active) && !isPluginTab(active)) {
        dom.editorContainer.style.display = 'flex';
        dom.editorContainer.style.flex = '1';
      }
    }
  }
  layoutSplit();
  if (state.splitView && !was) applySplitRatio(readSplitRatio(), false);
  if (previewOwnsPane()) syncMarkdownPane();
}

export function renderRightPane() {
  if (previewOwnsPane()) { syncMarkdownPane(); return; }
  const editorRight = document.getElementById('editor-right');
  const title = document.getElementById('right-pane-title');
  if (!state.splitView || state.rightTabIndex < 0 || !state.currentTabs[state.rightTabIndex]) return;
  if (!editorRight) return;
  const tab = state.currentTabs[state.rightTabIndex];
  const rightBody = document.querySelector('#editor-container-right > .editor-body');
  const previewBody = document.getElementById('md-preview-body');
  if (isPreviewTab(tab)) {
    if (tab.sourceId) state.mdPreview = { open: true, sourceId: tab.sourceId };
    syncMarkdownPane();
    return;
  }
  if (rightBody) rightBody.style.display = '';
  if (previewBody) previewBody.hidden = true;
  document.getElementById('editors-row')?.classList.remove('md-split');
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
    syntaxRight.scrollLeft = editorRight.scrollLeft;
  }
  window.dispatchEvent(new Event('frogee:content'));
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
      // слева - только preventDefault чтобы не блокировать, split не открываем
    };
  }
}

export function setupSplitUi() {
  document.getElementById('split-right-btn')?.addEventListener('click', () => {
    if (state.activeTabIndex >= 0) openTabInSplit(state.activeTabIndex);
  });
  const closeSplit = () => {
    if (state.mdPreview?.open && previewOwnsPane()) {
      closeMarkdownPreview();
      if (state.splitView) renderRightPane();
      updateTabsList();
      return;
    }
    setSplitView(false);
    updateTabsList();
  };
  document.getElementById('close-split-btn')?.addEventListener('click', closeSplit);
  document.getElementById('close-right-pane-btn')?.addEventListener('click', closeSplit);

  const editorRight = document.getElementById('editor-right');
  if (editorRight) {
    const smartRight = createSmartKeydown(() => ({
      tabSize: parseInt(dom.tabSizeSelect?.value || '4', 10),
      ...smartOptsFor(state.currentTabs[state.rightTabIndex]?.name || ''),
    }));
    editorRight.addEventListener('keydown', (e) => smartRight(e));
    editorRight.addEventListener('focus', () => setFocusedPane('right'));
    dom.editor?.addEventListener('focus', () => setFocusedPane('left'));
    document.getElementById('left-pane-header')?.addEventListener('mousedown', () => { setFocusedPane('left'); dom.editor?.focus(); });
    document.getElementById('right-pane-header')?.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      if (previewOwnsPane()) return;
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
      if (syntaxRight) {
        syntaxRight.scrollTop = editorRight.scrollTop;
        syntaxRight.scrollLeft = editorRight.scrollLeft;
      }
    });
  }

  const resizer = document.getElementById('split-resizer');
  if (resizer) {
    resizer.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (!state.splitView && !previewOwnsPane()) return;
      resizer.setPointerCapture(e.pointerId);
      resizer.classList.add('dragging');
      document.body.classList.add('resizing-panel');
      e.preventDefault();
    });
    resizer.addEventListener('pointermove', (e) => {
      if (!resizer.hasPointerCapture(e.pointerId)) return;
      const row = document.getElementById('editors-row');
      if (!row) return;
      const rect = row.getBoundingClientRect();
      applySplitRatio((e.clientX - rect.left) / Math.max(1, rect.width), false);
    });
    const stopDrag = (e) => {
      if (e && resizer.hasPointerCapture(e.pointerId)) resizer.releasePointerCapture(e.pointerId);
      if (!resizer.classList.contains('dragging')) return;
      resizer.classList.remove('dragging');
      document.body.classList.remove('resizing-panel');
      const grow = parseFloat(splitPaneEls()[0]?.style.flex);
      if (grow > 0) applySplitRatio(grow, true);
    };
    resizer.addEventListener('pointerup', stopDrag);
    resizer.addEventListener('pointercancel', stopDrag);
    resizer.addEventListener('dblclick', () => applySplitRatio(0.5, true));
  }
}

function applyPluginSurface(show, tab) {
  const host = document.getElementById('plugin-host');
  if (!host) return;
  if (!show) {
    host.hidden = true;
    host.style.display = 'none';
    host.querySelectorAll('.plugin-view-body').forEach((el) => { el.hidden = true; });
    return;
  }
  for (const id of ['editor-container', 'editor-container-right', 'split-resizer', 'terminal-editor-host', 'notebook-host', 'browser-host', 'image-host']) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }
  document.getElementById('editors-row')?.classList.remove('is-split', 'md-split', 'browser-split');
  host.hidden = false;
  host.style.display = 'flex';
  host.querySelectorAll('.plugin-view-body').forEach((el) => { el.hidden = el !== tab?.element; });
  if (tab?.element) {
    tab.element.hidden = false;
    tab.element.dispatchEvent(new CustomEvent('plugin-view-show'));
  }
}

/** A tab whose content is an element drawn by a plugin. The same key brings the existing tab forward. */
export function openPluginTab({ key, title, element, onClose } = {}) {
  const pluginKey = String(key || title || 'plugin');
  const handleFor = (tab) => ({
    id: tab.id,
    element: tab.element,
    close() {
      const i = state.currentTabs.indexOf(tab);
      if (i >= 0) closeTab(i);
    },
    focus() {
      const i = state.currentTabs.indexOf(tab);
      if (i >= 0) switchToTab(i);
    },
    setTitle(text) {
      tab.name = String(text || tab.name);
      updateTabsList();
      if (state.currentTabs[state.activeTabIndex] === tab) updateTabTitle();
    },
  });
  const existing = state.currentTabs.findIndex((t) => isPluginTab(t) && t.pluginKey === pluginKey);
  if (existing >= 0) {
    hideWelcomePage();
    switchToTab(existing);
    return { ...handleFor(state.currentTabs[existing]), created: false };
  }
  const el = element || document.createElement('div');
  el.classList.add('plugin-view-body');
  const tab = {
    id: Date.now() + Math.random(),
    kind: 'plugin',
    name: String(title || 'Плагин'),
    pluginKey,
    element: el,
    onClose,
    content: '',
    modified: false,
  };
  state.currentTabs.push(tab);
  document.getElementById('plugin-host')?.appendChild(el);
  hideWelcomePage();
  switchToTab(state.currentTabs.length - 1);
  return { ...handleFor(tab), created: true, element: el };
}

export function updateTabTitle() {
  if (state.activeTabIndex >= 0 && state.activeTabIndex < state.currentTabs.length) {
    const tab = state.currentTabs[state.activeTabIndex];
    document.title = `${tab.name}${tab.modified ? ' *' : ''} - FrogeeCodeIDE`;
  }
  window.dispatchEvent(new Event('frogee:title'));
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
  openPluginTab,
});
