import fs from 'fs';
import path from 'path';

const root = path.dirname(new URL(import.meta.url).pathname);
const base = path.join(root, '..');
const srcPath = path.join(base, 'renderer.js');
const outDir = path.join(base, 'renderer');

const src = fs.readFileSync(srcPath, 'utf8');
const lines = src.split('\n');
let body = lines.slice(183).join('\n');
body = body.replace(/\n\/\/ Функции для работы с активностью window\.closeTab = closeTab;\s*$/, '\n');

const STATE_VARS = [
  'currentTabs', 'activeTabIndex', 'chatVisible', 'currentActivity', 'openRouterModels',
  'currentAiProvider', 'currentAiModel', 'defaultAiProvider', 'isTyping', 'currentFolder',
  'fileExplorerItems', 'expandedFolders', 'folderChildrenCache', 'selectedExplorerPath',
  'copiedFilePath', 'chatHistory', 'findBarVisible', 'findMatches', 'findMatchIndex',
  'findCaseSensitive', 'editorZoom', 'autoScaleEnabled', 'wordWrapEnabled', 'lineNumbersEnabled',
  'accentColor', 'uiRadius', 'uiGap', 'compactUi', 'terminalHeight', 'terminalVisible',
  'terminalStarted', 'terminalInEditor', 'xterm', 'fitAddon', 'splitView', 'rightTabIndex',
  'glassRim', 'glassShadow', 'editorDim', 'appBg', 'sidebarBg', 'editorBg', 'panelBg',
  'appOpacity', 'sidebarOpacity', 'activityOpacity', 'editorSurfaceOpacity', 'terminalOpacity',
  'bgImageUrl', 'bgImageOpacity', 'contextMenu',
];

const DOM_REFS = [
  'activityPanel', 'aiChatAction', 'aiModelSelect', 'aiProviderSelect', 'ambientBgCheckbox',
  'autoScaleCheckbox', 'chatBtn', 'chatMessages', 'chatPanel', 'chatStatus', 'clearChatBtn',
  'closeChatBtn', 'closeSettingsBtn', 'closeSettingsBtn2', 'compactUiCheckbox', 'debugBtn',
  'defaultAiProviderSelect', 'editor', 'editorContainer', 'editorDimRange', 'editorDimValue',
  'editorTabs', 'explorerBtn', 'extensionsBtn', 'fontSizeSelect', 'gitBtn', 'glassBlurCheckbox',
  'glassBlurRange', 'glassBlurValue', 'glassEnabledCheckbox', 'glassOpacityRange',
  'glassOpacityValue', 'glassRimRange', 'glassRimValue', 'glassShadowRange', 'glassShadowValue',
  'lineNumbers', 'lineNumbersCheckbox', 'newFileAction', 'newFileBtn', 'newTabBtn',
  'ollamaSection', 'openFileAction', 'openRouterKeyInput', 'openRouterSection', 'openRouterStatus',
  'saveOpenRouterKeyBtn', 'searchBtn', 'sendBtn', 'settingsBtn', 'settingsModal', 'showWelcomeCheckbox',
  'statusCursor', 'statusFile', 'statusLang', 'statusTerminalBtn', 'statusZoom', 'stopBtn',
  'tabSizeSelect', 'tabsList', 'terminalBtn', 'terminalClearBtn', 'terminalCloseBtn',
  'terminalHeightRange', 'terminalHeightValue', 'terminalMeta', 'terminalPanel',
  'terminalResizeHandle', 'terminalRestartBtn', 'terminalXtermHost', 'themeSelect',
  'uiGapRange', 'uiGapValue', 'uiRadiusRange', 'uiRadiusValue', 'userInput', 'welcomePage',
  'wordWrapCheckbox', 'zoomInBtn', 'zoomOutBtn', 'zoomResetBtn', 'zoomValueEl',
  'accentColorSelect', 'appBgColor', 'sidebarBgColor', 'editorBgColor', 'panelBgColor',
  'appOpacityRange', 'appOpacityValue', 'sidebarOpacityRange', 'sidebarOpacityValue',
  'activityOpacityRange', 'activityOpacityValue', 'editorSurfaceOpacityRange',
  'editorSurfaceOpacityValue', 'terminalOpacityRange', 'terminalOpacityValue',
  'bgImageUrlInput', 'bgImageOpacityRange', 'bgImageOpacityValue',
];

function transformCode(code) {
  let out = code;
  for (const v of STATE_VARS.sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`\\b${v}\\b`, 'g'), `state.${v}`);
  }
  for (const d of DOM_REFS.sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`\\b${d}\\b`, 'g'), `dom.${d}`);
  }
  out = out.replace(/\bpathUtils\b/g, 'pathUtils');
  out = out.replace(/\bescapeHtml\b/g, 'escapeHtml');
  return out;
}

function extractFunctions(text) {
  const funcs = new Map();
  const re = /^(async )?function (\w+)\(/gm;
  const starts = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    starts.push({ name: m[2], index: m.index, async: !!m[1] });
  }
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i].index;
    const end = i + 1 < starts.length ? starts[i + 1].index : text.length;
    funcs.set(starts[i].name, text.slice(start, end).trim());
  }
  const windowBlock = text.match(/if \(window\.electronAPI[\s\S]*?\n\}/);
  if (windowBlock) funcs.set('__streamListener__', windowBlock[0]);
  const windowExports = [...text.matchAll(/^window\.(\w+) = (\w+);$/gm)];
  funcs.set('__windowExports__', windowExports.map((x) => x[0]).join('\n'));
  return funcs;
}

const MODULE_FUNCS = {
  'config-io.js': ['initializeApp', 'saveAllConfig'],
  'chat.js': [
    'handleAiProviderChange', 'handleAiModelChange', 'saveOpenRouterKey', 'updateDefaultAiProvider',
    'initializeOpenRouter', 'updateOpenRouterModelSelect', 'updateOpenRouterStatus',
    'toggleChat', 'handleChatKeydown', 'handleTextareaResize', 'handleChatSubmit',
    'addChatMessage', 'showTypingIndicator', 'hideTypingIndicator', 'setChatStatus',
    'stopChatResponse', 'loadChatHistory', 'saveChatHistory', 'clearChatHistory',
  ],
  'git-panel.js': ['showGitPanel', 'refreshGitPanel'],
  'tabs.js': [
    'showWelcomePage', 'hideWelcomePage', 'handleNewFileAction', 'handleOpenFileAction',
    'handleAiChatAction', 'handleWelcomeCheckboxChange', 'isTerminalTab', 'findTerminalTabIndex',
    'restoreTab', 'createTab', 'createNewTab', 'createNewFile', 'switchToTab', 'closeTab',
    'updateTabsList', 'setupTabsBarDrop', 'reorderTab', 'openTabInSplit', 'setSplitView',
    'renderRightPane', 'updateSecondaryChrome', 'setupSplitDropTargets', 'setupSplitUi',
    'updateTabTitle',
  ],
  'terminal.js': [
    'getTerminalDock', 'getTerminalEditorHost', 'applyTerminalPlacement', 'openTerminalAsEditorTab',
    'ensureTerminalTab', 'dockTerminalFromTab', 'setupTerminalPanelDrag', 'setupTerminal',
    'ensureXterm', 'fitTerminal', 'setupTerminalResize', 'toggleTerminal', 'setTerminalVisible',
    'ensureTerminalStarted', 'restartTerminal',
  ],
  'explorer.js': [
    'switchActivity', 'showExplorerPanel', 'showSearchPanel', 'showDebugPanel', 'showExtensionsPanel',
    'performSearch', 'buildSearchRegex', 'performSearchInCurrentFile', 'goToEditorLine',
    'openSearchFile', 'openSearchFileAtLine', 'openFolder', 'loadFolderContents', 'sortExplorerItems',
    'refreshExplorerTree', 'updateFileExplorer', 'renderExplorerChildren', 'toggleFolderExpand',
    'getFileIcon', 'createNewFileInFolder', 'createNewFolderInFolder', 'showContextMenu',
    'showContextMenuForFolder', 'renameFileItem', 'applyRename', 'copyFileItem', 'pasteFileItem',
    'deleteFileItem', 'handleFileItemClick',
  ],
  'editor.js': [
    'openFile', 'openFileOrFolder', 'saveFile', 'saveFileAs', 'handleEditorInput', 'handleEditorKeydown',
    'handleEditorScroll', 'updateCurrentLine', 'updateLineNumbers', 'updateSyntaxHighlight',
    'syncSyntaxScroll', 'changeEditorZoom', 'applyEditorZoom', 'handleZoomWheel', 'updateUiAutoScale',
    'applyWordWrap', 'applyLineNumbers', 'updateStatusBar', 'saveTabs', 'setupFindBar', 'openFindBar',
    'closeFindBar', 'updateFindMatches', 'updateFindCount', 'selectFindMatch', 'findNext', 'findPrev',
    'path',
  ],
  'appearance.js': [
    'applyEditorAppearance', 'updateFontSize', 'updateTheme', 'applyThemeClass', 'applyAppearanceLayout',
    'updateTabSize', 'handleGlassOpacityChange', 'handleGlassBlurChange', 'handleGlassBlurCheckboxChange',
    'updateGlassOpacityValue', 'updateGlassBlurValue', 'applyGlassmorphismSettings',
    'applyExtendedGlassControls', 'applyTerminalHeight',
  ],
  'app.js': ['setupEventListeners', 'setupSettingsTabs', 'handleGlobalKeydown'],
};

const IMPORTS = {
  'config-io.js': `import { state } from './state.js';
import { getDom } from './dom.js';
import { saveAllConfig as _noop } from './config-io.js';
import { applyEditorAppearance, applyAppearanceLayout, applyGlassmorphismSettings, applyExtendedGlassControls, applyBackgroundCustomization, syncAppearanceControlsFromState } from './appearance.js';
import { applyEditorZoom, applyWordWrap, applyLineNumbers, updateUiAutoScale, updateStatusBar } from './editor.js';
import { showWelcomePage, hideWelcomePage, restoreTab, updateTabsList, switchToTab } from './tabs.js';
import { setTerminalVisible } from './terminal.js';
import { loadChatHistory, initializeOpenRouter, updateOpenRouterModelSelect } from './chat.js';
`,
};

// Simpler: build imports per module manually after generation
const funcs = extractFunctions(body);

fs.mkdirSync(outDir, { recursive: true });

for (const [file, names] of Object.entries(MODULE_FUNCS)) {
  const chunks = [];
  for (const name of names) {
    const f = funcs.get(name);
    if (!f) {
      console.warn('Missing function', name, 'for', file);
      continue;
    }
    chunks.push(transformCode(f));
  }
  if (file === 'chat.js') {
    const stream = funcs.get('__streamListener__');
    if (stream) chunks.push(transformCode(stream.replace(/^if \(window\.electronAPI/, 'export function setupChatStreamListener() {\nif (window.electronAPI').replace(/\}\s*$/, '\n}')));
  }
  if (file === 'explorer.js') {
    chunks.push(`export function registerSearchGlobals() {
  window.openSearchFile = openSearchFile;
  window.openSearchFileAtLine = openSearchFileAtLine;
  window.goToEditorLine = goToEditorLine;
}
`);
  }
  fs.writeFileSync(path.join(outDir, file + '.part'), chunks.join('\n\n'));
}

console.log('Extracted parts to renderer/*.part — run assemble step');
