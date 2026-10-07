/** Late-bound tab UI APIs — breaks terminal ↔ tabs circular imports */
const api = {
  hideWelcomePage() {},
  showWelcomePage() {},
  switchToTab() {},
  closeTab() {},
  updateTabsList() {},
  updateTabTitle() {},
  createTab() {},
  openTabInSplit() {},
  setSplitView() {},
  setFocusedPane() {},
  isBrowserSplit() { return false; },
};

export function registerTabsApi( partial ) {
  Object.assign(api, partial || {});
}

export function hideWelcomePage(...a) { return api.hideWelcomePage(...a); }
export function showWelcomePage(...a) { return api.showWelcomePage(...a); }
export function switchToTab(...a) { return api.switchToTab(...a); }
export function closeTab(...a) { return api.closeTab(...a); }
export function updateTabsList(...a) { return api.updateTabsList(...a); }
export function updateTabTitle(...a) { return api.updateTabTitle(...a); }
export function createTab(...a) { return api.createTab(...a); }
export function openTabInSplit(...a) { return api.openTabInSplit(...a); }
export function setSplitView(...a) { return api.setSplitView(...a); }
export function setFocusedPane(...a) { return api.setFocusedPane(...a); }
export function isBrowserSplit(...a) { return api.isBrowserSplit(...a); }
