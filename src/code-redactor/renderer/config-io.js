import { state } from './state.js';
import { getDom } from './dom.js';
import {
  applyEditorAppearance,
  applyAppearanceLayout,
  applyGlassmorphismSettings,
  applyBackgroundCustomization,
  syncAppearanceControlsFromState,
  loadAppearanceFieldsFromConfig,
  getAppearanceConfigSlice,
  applyThemeClass,
  updateGlassOpacityValue,
  updateGlassBlurValue,
} from './appearance.js';
import { applyEditorZoom, applyWordWrap, applyLineNumbers, updateUiAutoScale, updateStatusBar } from './editor.js';
import { showWelcomePage, hideWelcomePage, restoreTab, updateTabsList, switchToTab } from './tabs.js';
import { setTerminalVisible } from './terminal.js';
import { loadChatHistory, initializeOpenRouter } from './chat.js';
import { setConfigSaver } from './save-hook.js';

import { syncAgentSettings } from './agents.js';
import { applyGlass } from './glass.js';
import { loadCustomThemes } from './themes.js';
import { applyFonts, syncFontControls } from './fonts.js';
const dom = getDom();
const DESIGN_VERSION = 3;

export async function initializeApp() {
  try {
    if (dom.settingsModal) dom.settingsModal.style.display = 'none';
    if (dom.chatPanel) dom.chatPanel.style.display = 'none';

    const config = await window.electronAPI.loadConfig();
    await loadCustomThemes();
    // Configs saved before the Islands redesign carry the old teal/glass values; drop them once.
    if (config.designVersion !== DESIGN_VERSION) {
      if (!config.designVersion || config.designVersion < 2) {
        delete config.accentColor;
        delete config.uiRadius;
        delete config.uiGap;
      } else if (config.accentColor === '#3574f0') {
        delete config.accentColor; // the old blue default: the new default is teal
      }
    }

    if (dom.fontSizeSelect) dom.fontSizeSelect.value = config.fontSize || '14';
    if (dom.themeSelect) {
      dom.themeSelect.value = config.theme || 'dark';
      if (dom.themeSelect.value !== (config.theme || 'dark')) dom.themeSelect.value = 'dark'; // custom theme was deleted
    }
    if (dom.tabSizeSelect) dom.tabSizeSelect.value = config.tabSize || '4';
    applyEditorAppearance(false);

    const glassOpacity = config.glassOpacity !== undefined ? config.glassOpacity : 0.78;
    const glassBlur = config.glassBlur !== undefined ? config.glassBlur : 16;
    const glassBlurEnabled = config.glassBlurEnabled !== undefined ? config.glassBlurEnabled : true;
    state.editorZoom = typeof config.editorZoom === 'number' ? config.editorZoom : 1;
    state.autoScaleEnabled = config.autoScaleEnabled !== false;
    state.wordWrapEnabled = !!config.wordWrapEnabled;
    state.autoSave = !!config.autoSave;
    state.editorFont = typeof config.editorFont === 'string' ? config.editorFont : '';
    state.uiFont = typeof config.uiFont === 'string' ? config.uiFont : '';
    state.fontLigatures = !!config.fontLigatures;
    applyFonts();
    syncFontControls();
    if (typeof config.activityWidth === 'number') state.activityWidth = Math.min(560, Math.max(180, config.activityWidth));
    document.documentElement.style.setProperty('--activity-width', state.activityWidth + 'px');
    if (typeof config.lgPreset === 'string') state.glassPreset = config.lgPreset;
    state.glassQuality = config.lgQuality || 'auto';
    state.glassOpacity = typeof config.lgOpacity === 'number' ? config.lgOpacity : null;
    state.glassBlur = typeof config.lgBlur === 'number' ? config.lgBlur : null;
    state.agentAccess = config.agentAccess === 'edit' ? 'edit' : 'read';
    state.agentPaths = { claude: '', codex: '', opencode: '', ...(config.agentPaths || {}) };
    syncAgentSettings();
    const autoSaveBox = document.getElementById('autosave-checkbox');
    if (autoSaveBox) autoSaveBox.checked = state.autoSave;
    state.lineNumbersEnabled = config.lineNumbersEnabled !== false;
    state.accentColor = config.accentColor || '#21aabe';
    state.uiRadius = typeof config.uiRadius === 'number' ? config.uiRadius : 12;
    state.uiGap = typeof config.uiGap === 'number' ? config.uiGap : 4;
    state.compactUi = !!config.compactUi;
    state.terminalHeight = typeof config.terminalHeight === 'number' ? config.terminalHeight : 220;
    state.terminalVisible = !!config.terminalVisible;

    if (dom.glassOpacityRange) {
      dom.glassOpacityRange.value = glassOpacity;
      updateGlassOpacityValue(glassOpacity);
    }
    if (dom.glassBlurRange) {
      dom.glassBlurRange.value = glassBlur;
      updateGlassBlurValue(glassBlur);
    }
    if (dom.glassEnabledCheckbox) dom.glassEnabledCheckbox.checked = glassBlurEnabled;
    if (dom.autoScaleCheckbox) dom.autoScaleCheckbox.checked = state.autoScaleEnabled;
    if (dom.wordWrapCheckbox) dom.wordWrapCheckbox.checked = state.wordWrapEnabled;
    if (dom.lineNumbersCheckbox) dom.lineNumbersCheckbox.checked = state.lineNumbersEnabled;
    if (dom.accentColorSelect) dom.accentColorSelect.value = state.accentColor;
    if (dom.uiRadiusRange) {
      dom.uiRadiusRange.value = state.uiRadius;
      if (dom.uiRadiusValue) dom.uiRadiusValue.textContent = state.uiRadius + 'px';
    }
    if (dom.uiGapRange) {
      dom.uiGapRange.value = state.uiGap;
      if (dom.uiGapValue) dom.uiGapValue.textContent = state.uiGap + 'px';
    }
    if (dom.compactUiCheckbox) dom.compactUiCheckbox.checked = state.compactUi;

    state.glassRim = typeof config.glassRim === 'number' ? config.glassRim : 10;
    state.glassShadow = typeof config.glassShadow === 'number' ? config.glassShadow : 12;
    state.editorDim = typeof config.editorDim === 'number' ? config.editorDim : 0.88;
    if (dom.glassRimRange) {
      dom.glassRimRange.value = state.glassRim;
      if (dom.glassRimValue) dom.glassRimValue.textContent = state.glassRim + '%';
    }
    if (dom.glassShadowRange) {
      dom.glassShadowRange.value = state.glassShadow;
      if (dom.glassShadowValue) dom.glassShadowValue.textContent = state.glassShadow + '%';
    }
    if (dom.editorDimRange) {
      dom.editorDimRange.value = state.editorDim;
      if (dom.editorDimValue) dom.editorDimValue.textContent = Math.round(state.editorDim * 100) + '%';
    }
    if (dom.terminalHeightRange) {
      dom.terminalHeightRange.value = state.terminalHeight;
      if (dom.terminalHeightValue) dom.terminalHeightValue.textContent = state.terminalHeight + 'px';
    }

    loadAppearanceFieldsFromConfig(config);
    syncAppearanceControlsFromState();
    applyGlassmorphismSettings(glassOpacity, glassBlur, glassBlurEnabled);
    applyBackgroundCustomization();
    applyAppearanceLayout(false);
    applyEditorZoom(state.editorZoom, false);
    applyWordWrap(state.wordWrapEnabled, false);
    applyLineNumbers(state.lineNumbersEnabled, false);
    updateUiAutoScale();
    updateStatusBar();
    if (state.terminalVisible) {
      setTerminalVisible(true, false);
    }

    applyThemeClass(dom.themeSelect ? dom.themeSelect.value : 'dark');
    applyGlass();

    if (config.editorTabs && Array.isArray(config.editorTabs) && config.editorTabs.length > 0) {
      if (config.editorTabs.length > 40) {
        console.warn('Повреждённый editorTabs в конфиге:', config.editorTabs.length, '— сбрасываем');
        state.currentTabs = [];
        showWelcomePage();
        setTimeout(() => saveAllConfig(), 0);
      } else {
        const savedTabs = config.editorTabs.slice();
        state.currentTabs = [];
        state.activeTabIndex = -1;
        for (const tab of savedTabs) {
          restoreTab(tab.name || 'Файл', tab.content || '', tab.filePath || null, tab.kind || 'file');
        }
        hideWelcomePage();
        updateTabsList();
        switchToTab(0);
      }
    } else {
      showWelcomePage();
    }

    state.defaultAiProvider = config.defaultAiProvider || 'ollama';
    state.currentAiProvider = config.currentAiProvider || state.defaultAiProvider;
    state.currentAiModel = config.currentAiModel || (state.currentAiProvider === 'openrouter' ? 'deepseek/deepseek-r1-0528:free' : 'llama3');
    state.opencodeBaseUrl = config.opencodeBaseUrl || 'http://127.0.0.1:4096';
    const ocUrl = document.getElementById('opencode-url');
    if (ocUrl) ocUrl.value = state.opencodeBaseUrl;

    if (dom.defaultAiProviderSelect) dom.defaultAiProviderSelect.value = state.defaultAiProvider;
    if (dom.aiProviderSelect) dom.aiProviderSelect.value = state.currentAiProvider;
    if (dom.aiModelSelect) {
      const { refreshModelSelectForProvider } = await import('./chat.js');
      await refreshModelSelectForProvider();
      if (state.currentAiModel) {
        try { dom.aiModelSelect.value = state.currentAiModel; } catch {}
      }
    }

    await initializeOpenRouter();

    if (config.chatHistory && config.chatHistory.length > 0) {
      state.chatHistory = config.chatHistory;
      loadChatHistory();
    }
  } catch (error) {
    console.error('Ошибка загрузки конфигурации:', error);
    showWelcomePage();
  }
}

export async function saveAllConfig() {
  try {
    const config = {
      designVersion: DESIGN_VERSION,
      fontSize: dom.fontSizeSelect ? dom.fontSizeSelect.value : '14',
      theme: dom.themeSelect ? dom.themeSelect.value : 'dark',
      tabSize: dom.tabSizeSelect ? dom.tabSizeSelect.value : '4',
      defaultAiProvider: state.defaultAiProvider,
      currentAiProvider: state.currentAiProvider,
      currentAiModel: state.currentAiModel,
      showWelcomePage: dom.showWelcomeCheckbox ? dom.showWelcomeCheckbox.checked : true,
      editorTabs: state.currentTabs
        .filter((t) => t && t.kind !== 'terminal')
        .map((t) => ({
          name: t.name,
          content: t.content || '',
          filePath: t.filePath || null,
          modified: !!t.modified,
          kind: t.kind === 'notebook' ? 'notebook' : (t.kind === 'browser' ? 'browser' : 'file')
        })),
      chatHistory: state.chatHistory,
      glassOpacity: dom.glassOpacityRange ? parseFloat(dom.glassOpacityRange.value) : 0.78,
      glassBlur: dom.glassBlurRange ? parseInt(dom.glassBlurRange.value, 10) : 16,
      glassBlurEnabled: dom.glassEnabledCheckbox ? dom.glassEnabledCheckbox.checked : true,
      editorZoom: state.editorZoom,
      autoScaleEnabled: state.autoScaleEnabled,
      wordWrapEnabled: state.wordWrapEnabled,
      autoSave: state.autoSave,
      editorFont: state.editorFont,
      uiFont: state.uiFont,
      fontLigatures: state.fontLigatures,
      activityWidth: state.activityWidth,
      lgPreset: state.glassPreset,
      lgQuality: state.glassQuality,
      lgOpacity: state.glassOpacity,
      lgBlur: state.glassBlur,
      agentAccess: state.agentAccess,
      agentPaths: state.agentPaths,
      lineNumbersEnabled: state.lineNumbersEnabled,
      accentColor: state.accentColor,
      uiRadius: state.uiRadius,
      uiGap: state.uiGap,
      ambientBgEnabled: false,
      compactUi: state.compactUi,
      glassRim: state.glassRim,
      glassShadow: state.glassShadow,
      editorDim: state.editorDim,
      terminalHeight: state.terminalHeight,
      terminalVisible: state.terminalVisible,
      opencodeBaseUrl: document.getElementById('opencode-url')?.value || state.opencodeBaseUrl || 'http://127.0.0.1:4096',
      ...getAppearanceConfigSlice()
    };

    await window.electronAPI.saveConfig(config);
  } catch (error) {
    console.error('Ошибка сохранения конфигурации:', error);
  }
}

setConfigSaver(saveAllConfig);
