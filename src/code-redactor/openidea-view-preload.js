const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Set();
ipcRenderer.on('openidea-view-result', (_event, text) => {
  if (typeof text === 'string') {
    for (const callback of listeners) callback(text);
  }
});
ipcRenderer.on('openidea-view-theme', (_event, theme) => {
  if (typeof theme === 'string') document.documentElement.style.cssText = theme;
});

contextBridge.exposeInMainWorld('openidea', {
  postMessage(text) {
    if (typeof text === 'string' && text.length <= 2_000_000) ipcRenderer.sendToHost('openidea-view-message', text);
  },
  onMessage(callback) {
    if (typeof callback === 'function' && listeners.size < 20) listeners.add(callback);
  },
});
