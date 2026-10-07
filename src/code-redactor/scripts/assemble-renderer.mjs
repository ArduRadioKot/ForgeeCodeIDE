import fs from 'fs';
import path from 'path';

const base = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'renderer');

function fixPart(text) {
  return text
    .replace(/config\.state\./g, 'config.')
    .replace(/\bambientBgEnabled\b/g, 'false /* ambientBg removed */')
    .replace(/^function /gm, 'export function ')
    .replace(/^async function /gm, 'export async function ');
}

const headers = {
  'config-io.js': `import { state } from './state.js';
import { getDom } from './dom.js';
import {
  applyEditorAppearance,
  applyAppearanceLayout,
  applyGlassmorphismSettings,
  applyBackgroundCustomization,
  syncAppearanceControlsFromState,
  updateGlassOpacityValue,
  updateGlassBlurValue,
} from './appearance.js';
import { applyEditorZoom, applyWordWrap, applyLineNumbers, updateUiAutoScale, updateStatusBar } from './editor.js';
import { showWelcomePage, hideWelcomePage, restoreTab, updateTabsList, switchToTab } from './tabs.js';
import { setTerminalVisible } from './terminal.js';
import { loadChatHistory, initializeOpenRouter, updateOpenRouterModelSelect } from './chat.js';

const dom = getDom();

`,

  'chat.js': `import { state } from './state.js';
import { getDom } from './dom.js';
import { saveAllConfig } from './config-io.js';

const dom = getDom();

`,

  'git-panel.js': `import { state } from './state.js';
import { pathUtils, escapeHtml } from './utils.js';
import { hideWelcomePage, createTab } from './tabs.js';

`,

  'tabs.js': `import { state } from './state.js';
import { getDom } from './dom.js';
import { escapeHtml } from './utils.js';
import { saveAllConfig } from './config-io.js';
import { saveTabs } from './editor.js';
import { openFileOrFolder } from './editor.js';
import { toggleChat } from './chat.js';
import {
  applyTerminalPlacement,
  fitTerminal,
  ensureXterm,
  ensureTerminalStarted,
  getTerminalEditorHost,
  openTerminalAsEditorTab,
} from './terminal.js';
import { updateLineNumbers, updateSyntaxHighlight, updateStatusBar } from './editor.js';

const dom = getDom();

`,

  'terminal.js': `import { state } from './state.js';
import { getDom } from './dom.js';
import { saveAllConfig } from './config-io.js';
import {
  isTerminalTab,
  findTerminalTabIndex,
  hideWelcomePage,
  closeTab,
  switchToTab,
  updateTabsList,
} from './tabs.js';
import { setupTabsBarDrop } from './tabs.js';

const dom = getDom();

`,

  'explorer.js': `import { state } from './state.js';
import { getDom, invalidateDomCache } from './dom.js';
import { pathUtils, escapeHtml } from './utils.js';
import { hideWelcomePage, createTab, closeTab } from './tabs.js';
import { updateLineNumbers, updateSyntaxHighlight } from './editor.js';
import { showGitPanel, refreshGitPanel } from './git-panel.js';

const dom = getDom();

`,

  'editor.js': `import { state } from './state.js';
import { getDom } from './dom.js';
import { pathUtils } from './utils.js';
import { saveAllConfig } from './config-io.js';
import {
  hideWelcomePage,
  createTab,
  closeTab,
  switchToTab,
  setSplitView,
  openTabInSplit,
  updateTabsList,
  updateTabTitle,
} from './tabs.js';
import { toggleTerminal } from './terminal.js';
import { switchActivity, performSearch } from './explorer.js';

const dom = getDom();

`,

  'appearance.js': `import { state } from './state.js';
import { getDom } from './dom.js';
import { saveAllConfig } from './config-io.js';
import { updateLineNumbers, updateSyntaxHighlight } from './editor.js';
import { fitTerminal } from './terminal.js';

const dom = getDom();

`,

  'app.js': `import { getDom } from './dom.js';
import { initializeApp, saveAllConfig } from './config-io.js';
import {
  createNewTab,
  createNewFile,
  handleNewFileAction,
  handleOpenFileAction,
  handleAiChatAction,
  handleWelcomeCheckboxChange,
} from './tabs.js';
import { openFolder } from './explorer.js';
import { switchActivity } from './explorer.js';
import { toggleChat, clearChatHistory, handleChatSubmit, handleChatKeydown, handleTextareaResize, handleAiProviderChange, handleAiModelChange, saveOpenRouterKey, updateDefaultAiProvider, setupChatStreamListener } from './chat.js';
import {
  updateFontSize,
  updateTheme,
  updateTabSize,
  handleEditorInput,
  handleEditorKeydown,
  handleEditorScroll,
  updateCurrentLine,
  updateStatusBar,
  handleGlobalKeydown,
  setupFindBar,
  changeEditorZoom,
  applyEditorZoom,
  handleZoomWheel,
  updateUiAutoScale,
  applyWordWrap,
  applyLineNumbers,
} from './editor.js';
import {
  handleGlassOpacityChange,
  handleGlassBlurChange,
  handleGlassBlurCheckboxChange,
  applyExtendedGlassControls,
  applyAppearanceLayout,
  applyTerminalHeight,
  wireAppearanceControls,
} from './appearance.js';
import { setupTerminal } from './terminal.js';
import { setupSplitUi } from './tabs.js';
import { registerSearchGlobals } from './explorer.js';

const dom = getDom();

`,
};

for (const file of Object.keys(headers)) {
  const partPath = path.join(base, file.replace('.js', '.js.part'));
  if (!fs.existsSync(partPath)) {
    console.warn('missing', partPath);
    continue;
  }
  let body = fixPart(fs.readFileSync(partPath, 'utf8'));
  fs.writeFileSync(path.join(base, file), headers[file] + body);
  fs.unlinkSync(partPath);
  console.log('Wrote', file);
}
