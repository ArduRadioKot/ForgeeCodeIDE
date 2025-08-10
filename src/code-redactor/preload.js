const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Существующие функции
  abortRequest: () => ipcRenderer.invoke('abort-request'),
  onStreamUpdate: (callback) => ipcRenderer.on('stream-update', callback),
  saveFile: (content) => ipcRenderer.invoke('save-file', content),
  saveFileAs: (content) => ipcRenderer.invoke('save-file-as', content),
  openFile: () => ipcRenderer.invoke('open-file'),
  openFileOrFolder: () => ipcRenderer.invoke('open-file-or-folder'),
  listFiles: (folderPath) => ipcRenderer.invoke('list-files', folderPath),
  
  // Функции конфигурации
  loadConfig: () => ipcRenderer.invoke('load-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  
  // OpenRouter функции
  setOpenRouterKey: (key) => ipcRenderer.invoke('set-openrouter-key', key),
  getOpenRouterKey: () => ipcRenderer.invoke('get-openrouter-key'),
  getOpenRouterModels: () => ipcRenderer.invoke('get-openrouter-models'),
  sendMessage: (message, model, useOpenRouter) => ipcRenderer.invoke('send-message', message, model, useOpenRouter),
  
  // Ollama функции
  getModels: () => ipcRenderer.invoke('get-models'),
  downloadModel: (model) => ipcRenderer.invoke('download-model', model),
  deleteModel: (model) => ipcRenderer.invoke('delete-model', model),
  
  // Внешние ссылки
  openExternal: (url) => ipcRenderer.invoke('open-external', url)
}); 