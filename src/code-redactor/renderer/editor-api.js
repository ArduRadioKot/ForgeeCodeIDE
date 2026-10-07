/** Late-bound editor chrome APIs — breaks tabs ↔ editor cycles */
const api = {
  updateLineNumbers() {},
  updateSyntaxHighlight() {},
  updateStatusBar() {},
  saveTabs() {},
  openFileOrFolder() {},
};

export function registerEditorApi(partial) {
  Object.assign(api, partial || {});
}

export function updateLineNumbers(...a) { return api.updateLineNumbers(...a); }
export function updateSyntaxHighlight(...a) { return api.updateSyntaxHighlight(...a); }
export function updateStatusBar(...a) { return api.updateStatusBar(...a); }
export function saveTabs(...a) { return api.saveTabs(...a); }
export function openFileOrFolder(...a) { return api.openFileOrFolder(...a); }
