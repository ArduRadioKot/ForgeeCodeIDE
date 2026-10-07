import { state } from './state.js';

export function isTerminalTab(tab) {
  return !!(tab && tab.kind === 'terminal');
}

export function isNotebookTab(tab) {
  return !!(tab && tab.kind === 'notebook');
}

export function isBrowserTab(tab) {
  return !!(tab && tab.kind === 'browser');
}

/** Tabs that edit text in the main textarea (everything that is not a special surface). */
export function isEditorTab(tab) {
  return !!(tab && tab.kind !== 'terminal' && tab.kind !== 'notebook' && tab.kind !== 'browser');
}

export function isNotebookPath(filePathOrName) {
  if (!filePathOrName) return false;
  return /\.ipynb$/i.test(String(filePathOrName));
}

export function findTerminalTabIndex() {
  return state.currentTabs.findIndex((t) => isTerminalTab(t));
}
