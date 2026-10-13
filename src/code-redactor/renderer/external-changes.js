/**
 * Reacts quietly to changes made outside the editor (another editor, git, a script, Finder): the explorer is refreshed,
 * an open file that was edited elsewhere is reloaded when it has no unsaved edits, and a file that was deleted stays open
 * (marked in the tab) so saving simply writes it again. No alerts: these are normal events, not errors.
 */
import { state } from './state.js';
import { getDom } from './dom.js';
import { isEditorTab } from './tab-model.js';
import { refreshExplorerTree } from './explorer.js';
import { updateTabsList } from './tabs.js';
import { updateSyntaxHighlight, updateLineNumbers } from './editor.js';

let timer = 0;

async function dropMissingFolders() {
  for (const folder of [...state.expandedFolders]) {
    if (folder === state.currentFolder) continue;
    const st = await window.electronAPI.fileStat(folder);
    if (!st.exists) {
      state.expandedFolders.delete(folder);
      state.folderChildrenCache.delete(folder);
    }
  }
}

async function syncTabs() {
  let changed = false;
  for (let i = 0; i < state.currentTabs.length; i++) {
    const tab = state.currentTabs[i];
    if (!tab?.filePath || !isEditorTab(tab)) continue;
    const st = await window.electronAPI.fileStat(tab.filePath);
    if (!st.exists) {
      if (!tab.missing) { tab.missing = true; changed = true; }
      continue;
    }
    if (tab.missing) { tab.missing = false; changed = true; }
    if (tab.modified) continue;
    const res = await window.electronAPI.getFileContent(tab.filePath);
    if (!res?.success || typeof res.content !== 'string' || res.content === (tab.content ?? '')) continue;
    tab.content = res.content;
    if (i === state.activeTabIndex) {
      const dom = getDom();
      const { selectionStart, selectionEnd, scrollTop } = dom.editor;
      dom.editor.value = res.content;
      dom.editor.setSelectionRange(Math.min(selectionStart, res.content.length), Math.min(selectionEnd, res.content.length));
      dom.editor.scrollTop = scrollTop;
      updateLineNumbers();
      updateSyntaxHighlight();
    }
  }
  if (changed) updateTabsList();
}

async function onChange() {
  try {
    await dropMissingFolders();
    await refreshExplorerTree();
    await syncTabs();
  } catch (err) {
    console.warn('[external-changes]', err);
  }
}

export function setupExternalChanges() {
  window.electronAPI?.onFsChanged?.(() => {
    clearTimeout(timer);
    timer = setTimeout(onChange, 150);
  });
  window.addEventListener('focus', () => { clearTimeout(timer); timer = setTimeout(onChange, 150); });
}
