import { state } from './state.js';
import { getDom } from './dom.js';
import { initializeApp, saveAllConfig } from './config-io.js';
import {
  createNewTab,
  createNewFile,
  handleNewFileAction,
  handleOpenFileAction,
  handleAiChatAction,
  handleWelcomeCheckboxChange,
  closeTab,
  switchToTab,
  setSplitView,
  openTabInSplit,
  updateTabsList,
  setupSplitUi,
  setupTabsBarDrop,
  showWelcomePage,
} from './tabs.js';
import { openFolder, switchActivity, registerSearchGlobals } from './explorer.js';
import {
  toggleChat,
  clearChatHistory,
  handleChatSubmit,
  handleChatKeydown,
  handleTextareaResize,
  handleAiProviderChange,
  handleAiModelChange,
  saveOpenRouterKey,
  updateDefaultAiProvider,
  setupChatStreamListener,
  updateOpenCodeStatus,
  refreshModelSelectForProvider,
  stopChatResponse,
} from './chat.js';
import {
  handleEditorInput,
  handleEditorKeydown,
  handleEditorScroll,
  updateCurrentLine,
  updateStatusBar,
  setupFindBar,
  changeEditorZoom,
  applyEditorZoom,
  handleZoomWheel,
  updateUiAutoScale,
  applyWordWrap,
  applyLineNumbers,
  openFindBar,
  openReplaceBar,
  closeFindBar,
  initAutoSave,
  openFileOrFolder,
  saveFile,
  saveFileAs,
  createNewNotebook,
} from './editor.js';
import {
  updateFontSize,
  updateTheme,
  updateTabSize,
  handleGlassOpacityChange,
  handleGlassBlurChange,
  handleGlassBlurCheckboxChange,
  applyExtendedGlassControls,
  applyAppearanceLayout,
  applyTerminalHeight,
  wireAppearanceControls,
} from './appearance.js';
import { setupTerminal, toggleTerminal } from './terminal.js';
import { openCommandPalette, openQuickOpen, openGoToLine, openSymbols, runCurrentFile, setupPaletteButtons, toggleSidebarPanel } from './palette.js';
import { openBrowserTab, setupBrowserEvents, focusBrowserUrl, browserCommand } from './browser.js';
import { setupLiveServer } from './liveserver-ui.js';
import { setupAgents } from './agents.js';
import { setupGlass } from './glass.js';
import { setupFonts } from './fonts.js';
import { setupFlow } from './flow.js';
import { setupThemeControls } from './themes.js';
import { reopenClosedTab } from './tabs.js';
import { isBrowserTab } from './tab-model.js';

const dom = getDom();

export function setupEventListeners() {
  // Настройки и терминал — раньше остального, чтобы UI не «умирал» из‑за ошибок ниже
  if (dom.settingsBtn && dom.settingsModal) {
    dom.settingsBtn.addEventListener('click', () => {
      dom.settingsModal.style.display = 'flex';
    });
  }
  if (dom.closeSettingsBtn && dom.settingsModal) {
    dom.closeSettingsBtn.addEventListener('click', () => {
      dom.settingsModal.style.display = 'none';
    });
  }
  if (dom.closeSettingsBtn2 && dom.settingsModal) {
    dom.closeSettingsBtn2.addEventListener('click', () => {
      dom.settingsModal.style.display = 'none';
    });
  }
  if (dom.settingsModal) {
    dom.settingsModal.addEventListener('click', (e) => {
      if (e.target === dom.settingsModal) {
        dom.settingsModal.style.display = 'none';
      }
    });
  }

  setupTerminal();

  // Кнопки вкладок
  if (dom.newTabBtn) {
    dom.newTabBtn.addEventListener('click', createNewTab);
  }
  
  // Кнопки файлов
  if (dom.newFileBtn) {
    dom.newFileBtn.addEventListener('click', createNewFile);
  }
  
  // Кнопки explorer
  const openFolderBtn = document.getElementById('open-folder-btn');
  if (openFolderBtn) {
    openFolderBtn.addEventListener('click', openFolder);
  }
  
  // Действия стартовой страницы
  if (dom.newFileAction) {
    dom.newFileAction.addEventListener('click', handleNewFileAction);
  }
  if (dom.openFileAction) {
    dom.openFileAction.addEventListener('click', handleOpenFileAction);
  }
  if (dom.aiChatAction) {
    dom.aiChatAction.addEventListener('click', handleAiChatAction);
  }
  const newNotebookAction = document.getElementById('new-notebook-action');
  if (newNotebookAction) {
    newNotebookAction.addEventListener('click', () => {
      createNewNotebook();
    });
  }
  
  // Чекбокс стартовой страницы
  if (dom.showWelcomeCheckbox) {
    dom.showWelcomeCheckbox.addEventListener('change', handleWelcomeCheckboxChange);
  }
  
  // Кнопки боковой панели
  if (dom.explorerBtn) {
    dom.explorerBtn.addEventListener('click', () => switchActivity('explorer', { toggle: true }));
  }
  if (dom.searchBtn) {
    dom.searchBtn.addEventListener('click', () => switchActivity('search', { toggle: true }));
  }
  if (dom.gitBtn) {
    dom.gitBtn.addEventListener('click', () => switchActivity('git', { toggle: true }));
  }
  if (dom.debugBtn) {
    dom.debugBtn.addEventListener('click', () => switchActivity('debug', { toggle: true }));
  }
  
  // Кнопки чата
  if (dom.chatBtn) {
    dom.chatBtn.addEventListener('click', toggleChat);
  }
  if (dom.closeChatBtn) {
    dom.closeChatBtn.addEventListener('click', toggleChat);
  }
  if (dom.clearChatBtn) {
    dom.clearChatBtn.addEventListener('click', clearChatHistory);
  }
  
  // Форма чата
  if (dom.sendBtn) {
    dom.sendBtn.addEventListener('click', handleChatSubmit);
  }
  if (dom.stopBtn) {
    dom.stopBtn.addEventListener('click', stopChatResponse);
  }
  
  // Обработка ввода в чате
  if (dom.userInput) {
    dom.userInput.addEventListener('keydown', handleChatKeydown);
    dom.userInput.addEventListener('input', handleTextareaResize);
  }
  
  // Селекторы AI
  if (dom.aiProviderSelect) {
    dom.aiProviderSelect.addEventListener('change', handleAiProviderChange);
  }
  if (dom.aiModelSelect) {
    dom.aiModelSelect.addEventListener('change', handleAiModelChange);
  }
  
  // OpenRouter настройки
  if (dom.saveOpenRouterKeyBtn) {
    dom.saveOpenRouterKeyBtn.addEventListener('click', saveOpenRouterKey);
  }
  const opencodeTestBtn = document.getElementById('opencode-test-btn');
  if (opencodeTestBtn) {
    opencodeTestBtn.addEventListener('click', async () => {
      const baseUrl = document.getElementById('opencode-url')?.value || 'http://127.0.0.1:4096';
      state.opencodeBaseUrl = baseUrl;
      updateOpenCodeStatus('not-checked');
      const health = await window.electronAPI.opencodeHealth(baseUrl);
      if (health.success && health.healthy) {
        updateOpenCodeStatus('connected');
        if (state.currentAiProvider === 'opencode') {
          await refreshModelSelectForProvider();
        }
        saveAllConfig();
      } else {
        updateOpenCodeStatus('error');
        alert(health.error || 'OpenCode недоступен. Запустите: opencode serve');
      }
    });
  }
  const opencodeUrl = document.getElementById('opencode-url');
  if (opencodeUrl) {
    opencodeUrl.addEventListener('change', () => {
      state.opencodeBaseUrl = opencodeUrl.value.trim() || 'http://127.0.0.1:4096';
      saveAllConfig();
    });
  }
  
  // Настройки редактора
  if (dom.fontSizeSelect) {
    dom.fontSizeSelect.addEventListener('change', updateFontSize);
  }
  if (dom.themeSelect) {
    dom.themeSelect.addEventListener('change', updateTheme);
  }
  if (dom.tabSizeSelect) {
    dom.tabSizeSelect.addEventListener('change', updateTabSize);
  }
  if (dom.defaultAiProviderSelect) {
    dom.defaultAiProviderSelect.addEventListener('change', updateDefaultAiProvider);
  }
  
  // Настройки прозрачности
  if (dom.glassOpacityRange && dom.glassOpacityValue) {
    dom.glassOpacityRange.addEventListener('input', handleGlassOpacityChange);
  }
  if (dom.glassBlurRange && dom.glassBlurValue) {
    dom.glassBlurRange.addEventListener('input', handleGlassBlurChange);
  }
  if (dom.glassEnabledCheckbox) {
    dom.glassEnabledCheckbox.addEventListener('change', handleGlassBlurCheckboxChange);
  }
  if (dom.autoScaleCheckbox) {
    dom.autoScaleCheckbox.addEventListener('change', () => {
      state.autoScaleEnabled = dom.autoScaleCheckbox.checked;
      updateUiAutoScale();
      saveAllConfig();
    });
  }
  if (dom.wordWrapCheckbox) {
    dom.wordWrapCheckbox.addEventListener('change', () => {
      applyWordWrap(dom.wordWrapCheckbox.checked, true);
    });
  }
  if (dom.lineNumbersCheckbox) {
    dom.lineNumbersCheckbox.addEventListener('change', () => {
      applyLineNumbers(dom.lineNumbersCheckbox.checked, true);
    });
  }
  if (dom.zoomInBtn) dom.zoomInBtn.addEventListener('click', () => changeEditorZoom(0.1));
  if (dom.zoomOutBtn) dom.zoomOutBtn.addEventListener('click', () => changeEditorZoom(-0.1));
  if (dom.zoomResetBtn) dom.zoomResetBtn.addEventListener('click', () => applyEditorZoom(1, true));

  if (dom.accentColorSelect) {
    dom.accentColorSelect.addEventListener('change', () => {
      state.accentColor = dom.accentColorSelect.value;
      applyAppearanceLayout(true);
    });
  }
  if (dom.uiRadiusRange) {
    dom.uiRadiusRange.addEventListener('input', () => {
      state.uiRadius = parseInt(dom.uiRadiusRange.value, 10);
      if (dom.uiRadiusValue) dom.uiRadiusValue.textContent = state.uiRadius + 'px';
      applyAppearanceLayout(true);
    });
  }
  if (dom.uiGapRange) {
    dom.uiGapRange.addEventListener('input', () => {
      state.uiGap = parseInt(dom.uiGapRange.value, 10);
      if (dom.uiGapValue) dom.uiGapValue.textContent = state.uiGap + 'px';
      applyAppearanceLayout(true);
    });
  }
  if (dom.compactUiCheckbox) {
    dom.compactUiCheckbox.addEventListener('change', () => {
      state.compactUi = dom.compactUiCheckbox.checked;
      applyAppearanceLayout(true);
    });
  }
  [dom.glassRimRange, dom.glassShadowRange, dom.editorDimRange, dom.glassOpacityRange, dom.glassBlurRange].forEach((el) => {
    if (!el) return;
    el.addEventListener('input', () => applyExtendedGlassControls(true));
    el.addEventListener('change', () => applyExtendedGlassControls(true));
  });
  if (dom.terminalHeightRange) {
    dom.terminalHeightRange.addEventListener('input', () => {
      state.terminalHeight = parseInt(dom.terminalHeightRange.value, 10);
      if (dom.terminalHeightValue) dom.terminalHeightValue.textContent = state.terminalHeight + 'px';
      applyTerminalHeight();
      saveAllConfig();
    });
  }

  wireAppearanceControls();
  setupTabsBarDrop();
  setupSplitUi();
  setupSettingsTabs();
  setupChatStreamListener();
  registerSearchGlobals();
  window.addEventListener('resize', () => updateUiAutoScale());
  document.addEventListener('wheel', handleZoomWheel, { passive: false });
  if (dom.statusZoom) {
    dom.statusZoom.style.cursor = 'pointer';
    dom.statusZoom.title = 'Сбросить масштаб';
    dom.statusZoom.addEventListener('click', () => applyEditorZoom(1, true));
  }
  
  // Редактор
  if (dom.editor) {
    dom.editor.addEventListener('input', handleEditorInput);
    dom.editor.addEventListener('keydown', handleEditorKeydown);
    dom.editor.addEventListener('scroll', handleEditorScroll);
    dom.editor.addEventListener('click', () => { updateCurrentLine(); updateStatusBar(); });
    dom.editor.addEventListener('keyup', () => { updateCurrentLine(); updateStatusBar(); });
  }

  setupFindBar();
  setupPaletteButtons();
  initAutoSave();
  setupBrowserEvents();
  setupLiveServer();
  setupAgents();
  setupGlass();
  setupFonts();
  setupFlow();
  setupThemeControls();
  setupActivityResizer();
  document.getElementById('browser-btn')?.addEventListener('click', () => openBrowserTab('about:blank'));
  
  // Горячие клавиши
  document.addEventListener('keydown', handleGlobalKeydown);
}

/** Drag the divider to resize the side panel; double-click resets it. */
function setupActivityResizer() {
  const handle = document.getElementById('activity-resizer');
  const panel = document.getElementById('activity-panel');
  if (!handle || !panel) return;
  const apply = (width) => {
    state.activityWidth = Math.round(Math.min(560, Math.max(180, width)));
    document.documentElement.style.setProperty('--activity-width', state.activityWidth + 'px');
  };
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panel.getBoundingClientRect().width;
    const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;
    handle.classList.add('dragging');
    document.body.classList.add('resizing-panel');
    const move = (ev) => apply(startWidth + (ev.clientX - startX) / scale);
    const up = () => {
      handle.classList.remove('dragging');
      document.body.classList.remove('resizing-panel');
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      saveAllConfig();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
  handle.addEventListener('dblclick', () => { apply(260); saveAllConfig(); });
}

export function setupSettingsTabs() {
  const nav = document.getElementById('settings-nav');
  if (!nav) return;
  nav.querySelectorAll('.settings-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.settingsTab;
      nav.querySelectorAll('.settings-nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.settings-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === `settings-panel-${tab}`);
      });
    });
  });
}

export function handleGlobalKeydown(e) {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
    e.preventDefault();
    openCommandPalette();
    return;
  }
  if (mod && !e.shiftKey && !e.altKey && (e.key === 'p' || e.key === 'P')) {
    e.preventDefault();
    openQuickOpen();
    return;
  }
  if (e.ctrlKey && !e.metaKey && (e.key === 'g' || e.key === 'G')) {
    e.preventDefault();
    openGoToLine();
    return;
  }
  if (e.key === 'F5') {
    e.preventDefault();
    runCurrentFile();
    return;
  }
  if (mod && e.shiftKey && (e.key === 'O' || e.key === 'o')) {
    e.preventDefault();
    openSymbols();
    return;
  }
  if (mod && e.shiftKey && (e.key === 'T' || e.key === 't')) {
    e.preventDefault();
    reopenClosedTab();
    return;
  }
  if (mod && e.shiftKey && (e.key === 'B' || e.key === 'b')) {
    e.preventDefault();
    openBrowserTab('about:blank');
    return;
  }
  if (mod && !e.shiftKey && !e.altKey && (e.key === 'b' || e.key === 'B')) {
    e.preventDefault();
    toggleSidebarPanel();
    return;
  }
  if (mod && !e.shiftKey && (e.key === 'l' || e.key === 'L') && isBrowserTab(state.currentTabs[state.activeTabIndex])) {
    e.preventDefault();
    focusBrowserUrl();
    return;
  }
  if (e.altKey && !mod && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && isBrowserTab(state.currentTabs[state.activeTabIndex])) {
    e.preventDefault();
    browserCommand(e.key === 'ArrowLeft' ? 'back' : 'forward');
    return;
  }
  if (mod && e.altKey && (e.key === 'f' || e.key === 'F' || e.key === 'ƒ')) {
    e.preventDefault();
    openReplaceBar();
    return;
  }

  // Ctrl+N / Cmd+N - новый файл
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
    e.preventDefault();
    createNewFile();
  }
  
  // Ctrl+O / Cmd+O - открыть файл или папку
  if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
    e.preventDefault();
    openFileOrFolder();
  }
  
  // Ctrl+S / Cmd+S - сохранить файл
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    saveFile();
  }
  
  // Ctrl+Shift+S / Cmd+Shift+S - сохранить как
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S') {
    e.preventDefault();
    saveFileAs();
  }
  
  // Ctrl+W / Cmd+W - закрыть вкладку
  if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
    e.preventDefault();
    if (state.activeTabIndex >= 0) {
      closeTab(state.activeTabIndex);
    }
  }
  
  // Ctrl+Tab / Cmd+Tab - следующая вкладка
  if ((e.ctrlKey || e.metaKey) && e.key === 'Tab') {
    e.preventDefault();
    if (state.currentTabs.length > 1) {
      const nextIndex = (state.activeTabIndex + 1) % state.currentTabs.length;
      switchToTab(nextIndex);
    }
  }
  
  // Ctrl+Shift+F / Cmd+Shift+F - поиск по проекту
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
    e.preventDefault();
    switchActivity('search');
    return;
  }

  // Ctrl+F / Cmd+F - поиск в текущем файле
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'f' || e.key === 'F')) {
    e.preventDefault();
    openFindBar();
    return;
  }

  // Ctrl+` / Cmd+` - терминал
  if ((e.ctrlKey || e.metaKey) && e.key === '`') {
    e.preventDefault();
    toggleTerminal();
    return;
  }

  // Ctrl+\ / Cmd+\ - split
  if ((e.ctrlKey || e.metaKey) && (e.key === '\\' || e.code === 'Backslash')) {
    e.preventDefault();
    if (state.splitView) {
      setSplitView(false);
      updateTabsList();
    } else if (state.activeTabIndex >= 0) {
      openTabInSplit(state.activeTabIndex);
    }
    return;
  }

  // Zoom
  if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
    e.preventDefault();
    changeEditorZoom(0.1);
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === '-') {
    e.preventDefault();
    changeEditorZoom(-0.1);
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === '0') {
    e.preventDefault();
    applyEditorZoom(1, true);
    return;
  }

  // Esc - закрыть find bar / settings
  if (e.key === 'Escape') {
    if (state.findBarVisible) {
      e.preventDefault();
      closeFindBar();
      return;
    }
    if (dom.settingsModal && dom.settingsModal.style.display === 'flex') {
      dom.settingsModal.style.display = 'none';
    }
  }
}

function boot() {
  try {
    setupEventListeners();
    initializeApp().catch((error) => {
      console.error('Ошибка инициализации приложения:', error);
      showWelcomePage();
    });
  } catch (error) {
    console.error('Ошибка инициализации приложения:', error);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
