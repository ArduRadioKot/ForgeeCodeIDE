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
  getFileContent: (filePath) => ipcRenderer.invoke('get-file-content', filePath),
  
  // Функции для операций с файлами в explorer
  createFileInFolder: (folderPath, fileName) => ipcRenderer.invoke('create-file-in-folder', folderPath, fileName),
  createFolderInFolder: (parentPath, folderName) => ipcRenderer.invoke('create-folder-in-folder', parentPath, folderName),
  renameFile: (oldPath, newName) => ipcRenderer.invoke('rename-file', oldPath, newName),
  deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
  copyFile: (sourcePath, destinationPath) => ipcRenderer.invoke('copy-file', sourcePath, destinationPath),
  
  // Поиск в файлах
  searchInFiles: (folderPath, query, options) => ipcRenderer.invoke('search-in-files', folderPath, query, options),
  
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