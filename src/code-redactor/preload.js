const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Существующие функции
  sendMessage: (message, model, useOpenRouter) => ipcRenderer.invoke('send-message', message, model, useOpenRouter),
  abortRequest: () => ipcRenderer.invoke('abort-request'),
  onStreamUpdate: (callback) => ipcRenderer.on('stream-update', callback),
  
  // Функции для работы с файлами
  openFile: () => ipcRenderer.invoke('open-file'),
  saveFile: (content) => ipcRenderer.invoke('save-file', content),
  saveFileAs: (content) => ipcRenderer.invoke('save-file-as', content),
  newFile: () => ipcRenderer.invoke('new-file'),
  getFileContent: (filePath) => ipcRenderer.invoke('get-file-content', filePath),
  listFiles: (folderPath) => ipcRenderer.invoke('list-files', folderPath),
  openFolder: () => ipcRenderer.invoke('open-folder'),
  openFileOrFolder: () => ipcRenderer.invoke('open-file-or-folder'),
  
  // OpenRouter функции
  setOpenRouterKey: (apiKey) => ipcRenderer.invoke('set-openrouter-key', apiKey),
  getOpenRouterKey: () => ipcRenderer.invoke('get-openrouter-key'),
  getOpenRouterModels: () => ipcRenderer.invoke('get-openrouter-models'),
}); 