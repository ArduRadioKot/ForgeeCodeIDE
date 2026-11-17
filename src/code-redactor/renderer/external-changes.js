/**
 * Reacts quietly to changes made outside the editor (another editor, git, a script, Finder): the explorer is refreshed,
 * an open file that was edited elsewhere is reloaded when it has no unsaved edits, and a file that was deleted stays open
 * (marked in the tab) so saving simply writes it again. No alerts: these are normal events, not errors.
 */
import { state } from './state.js';
import { getDom } from './dom.js';
import { isEditorTab } from './tab-model.js';
import { refreshExplorerTree } from './explorer.js';
import { updateTabsList, updateSecondaryChrome } from './tabs.js';
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
  for (const tab of [...state.currentTabs]) {
    if (!tab?.filePath || !isEditorTab(tab)) continue;
    const path = tab.filePath;
    const st = await window.electronAPI.fileStat(path);
    if (tab.filePath !== path || !state.currentTabs.includes(tab)) continue;
    if (!st.exists) {
      if (!tab.missing) { tab.missing = true; changed = true; }
      continue;
    }
    if (tab.missing) { tab.missing = false; changed = true; }
    if (tab.modified) continue;
    const res = await window.electronAPI.getFileContent(path);
    if (!res?.success || typeof res.content !== 'string' || tab.filePath !== path) continue;
    const i = state.currentTabs.indexOf(tab);
    if (i < 0) continue;
    // our own save (autosave, Ctrl+S) also wakes the watcher: that is not a change from outside
    if (res.content === (tab.content ?? '') || res.content === tab.diskContent) continue;
    // the user may have typed while the file was being read
    if (tab.modified || (i === state.activeTabIndex && getDom().editor?.value !== (tab.content ?? ''))) continue;
    tab.content = res.content;
    tab.diskContent = res.content;
    if (i === state.activeTabIndex) {
      const editor = getDom().editor;
      refreshText(editor, res.content);
      updateLineNumbers();
      updateSyntaxHighlight();
    }
    if (state.splitView && i === state.rightTabIndex) {
      refreshText(document.getElementById('editor-right'), res.content);
      updateSecondaryChrome();
    }
  }
  if (changed) updateTabsList();
}

function refreshText(editor, content) {
  if (!editor) return;
  const { selectionStart, selectionEnd, scrollTop, scrollLeft } = editor;
  editor.value = content;
  editor.setSelectionRange(selectionStart, selectionEnd);
  editor.scrollTop = scrollTop;
  editor.scrollLeft = scrollLeft;
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
