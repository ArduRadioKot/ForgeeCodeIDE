const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Функции чата (сохраняем существующие)
  getModels: () => ipcRenderer.invoke('get-models'),
  sendMessage: (message, model, signal, useOpenRouter) => ipcRenderer.invoke('send-message', { message, model, signal, useOpenRouter }),
  downloadModel: (model) => ipcRenderer.invoke('download-model', model),
  onStreamUpdate: (callback) => ipcRenderer.on('stream-update', callback),
  abortRequest: () => ipcRenderer.send('abort-request'),
  deleteModel: (model) => ipcRenderer.invoke('delete-model', model),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  
  // Новые функции для работы с файлами
  openFile: () => ipcRenderer.invoke('open-file'),
  saveFile: (content) => ipcRenderer.invoke('save-file', content),
  saveFileAs: (content) => ipcRenderer.invoke('save-file-as', content),
  newFile: () => ipcRenderer.invoke('new-file'),
  getFileContent: (filePath) => ipcRenderer.invoke('get-file-content', filePath),
  listFiles: (directory) => ipcRenderer.invoke('list-files', directory),
  
  // Функции для работы с OpenRouter
  setOpenRouterKey: (apiKey) => ipcRenderer.invoke('set-openrouter-key', apiKey),
  getOpenRouterKey: () => ipcRenderer.invoke('get-openrouter-key'),
  getOpenRouterModels: () => ipcRenderer.invoke('get-openrouter-models'),
}); 