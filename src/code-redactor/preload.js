const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  abortRequest: () => ipcRenderer.invoke('abort-request'),
  onStreamUpdate: (callback) => ipcRenderer.on('stream-update', callback),
  saveFile: (content) => ipcRenderer.invoke('save-file', content),
  saveFileAs: (content) => ipcRenderer.invoke('save-file-as', content),
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content),
  runPythonCode: (payload) => ipcRenderer.invoke('run-python-code', payload),
  listKernels: (workspace) => ipcRenderer.invoke('list-kernels', workspace),
  listPythonEnvs: (workspace) => ipcRenderer.invoke('list-python-envs', workspace),
  runKernelCode: (payload) => ipcRenderer.invoke('run-kernel-code', payload),
  openFile: () => ipcRenderer.invoke('open-file'),
  openFolder: () => ipcRenderer.invoke('open-folder'),
  openFileOrFolder: () => ipcRenderer.invoke('open-file-or-folder'),
  listFiles: (folderPath) => ipcRenderer.invoke('list-files', folderPath),
  getFileContent: (filePath) => ipcRenderer.invoke('get-file-content', filePath),

  createFileInFolder: (folderPath, fileName) => ipcRenderer.invoke('create-file-in-folder', folderPath, fileName),
  createFolderInFolder: (parentPath, folderName) => ipcRenderer.invoke('create-folder-in-folder', parentPath, folderName),
  renameFile: (oldPath, newName) => ipcRenderer.invoke('rename-file', oldPath, newName),
  deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
  copyFile: (sourcePath, destinationPath) => ipcRenderer.invoke('copy-file', sourcePath, destinationPath),

  searchInFiles: (folderPath, query, options) => ipcRenderer.invoke('search-in-files', folderPath, query, options),

  loadConfig: () => ipcRenderer.invoke('load-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),

  setOpenRouterKey: (key) => ipcRenderer.invoke('set-openrouter-key', key),
  getOpenRouterKey: () => ipcRenderer.invoke('get-openrouter-key'),
  getOpenRouterModels: () => ipcRenderer.invoke('get-openrouter-models'),
  sendMessage: (message, model, options) => ipcRenderer.invoke('send-message', message, model, options),

  getModels: () => ipcRenderer.invoke('get-models'),
  downloadModel: (model) => ipcRenderer.invoke('download-model', model),
  deleteModel: (model) => ipcRenderer.invoke('delete-model', model),

  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  opencodeHealth: (baseUrl) => ipcRenderer.invoke('opencode-health', baseUrl),
  opencodeModels: (payload) => ipcRenderer.invoke('opencode-models', payload),
  opencodeSend: (payload) => ipcRenderer.invoke('opencode-send', payload),
  terminalPing: () => ipcRenderer.invoke('terminal-ping'),
  terminalStart: (options) => ipcRenderer.invoke('terminal-start', options),
  terminalWrite: (data) => ipcRenderer.invoke('terminal-write', data),
  terminalResize: (size) => ipcRenderer.invoke('terminal-resize', size),
  terminalRestart: (options) => ipcRenderer.invoke('terminal-restart', options),
  terminalKill: () => ipcRenderer.invoke('terminal-kill'),
  onTerminalData: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('terminal-data', handler);
    return () => ipcRenderer.removeListener('terminal-data', handler);
  },
  onTerminalExit: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('terminal-exit', handler);
    return () => ipcRenderer.removeListener('terminal-exit', handler);
  },

  themesList: () => ipcRenderer.invoke('themes-list'),
  themesOpenFolder: () => ipcRenderer.invoke('themes-open-folder'),
  themesImport: () => ipcRenderer.invoke('themes-import'),
  setNativeTheme: (theme) => ipcRenderer.send('set-native-theme', theme),
  listProjectFiles: (root) => ipcRenderer.invoke('list-project-files', root),
  liveStart: (opts) => ipcRenderer.invoke('live-start', opts),
  liveStop: (opts) => ipcRenderer.invoke('live-stop', opts),
  liveList: () => ipcRenderer.invoke('live-list'),
  onLiveEvent: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('live-event', handler);
    return () => ipcRenderer.removeListener('live-event', handler);
  },
  onBrowserNewTab: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('browser-new-tab', handler);
    return () => ipcRenderer.removeListener('browser-new-tab', handler);
  },
  agentsDetect: (paths) => ipcRenderer.invoke('agents-detect', paths),
  agentSend: (payload) => ipcRenderer.invoke('agent-send', payload),
  agentAbort: () => ipcRenderer.invoke('agent-abort'),
  opencodeServeStart: (opts) => ipcRenderer.invoke('opencode-serve-start', opts),
  opencodeServeStop: () => ipcRenderer.invoke('opencode-serve-stop'),
  kernelStart: (opts) => ipcRenderer.invoke('kernel-start', opts),
  kernelExecute: (opts) => ipcRenderer.invoke('kernel-execute', opts),
  kernelVars: (opts) => ipcRenderer.invoke('kernel-vars', opts),
  kernelInterrupt: (opts) => ipcRenderer.invoke('kernel-interrupt', opts),
  kernelRestart: (opts) => ipcRenderer.invoke('kernel-restart', opts),
  kernelShutdown: (opts) => ipcRenderer.invoke('kernel-shutdown', opts),
  onKernelEvent: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('kernel-event', handler);
    return () => ipcRenderer.removeListener('kernel-event', handler);
  },

  gitStatus: (cwd) => ipcRenderer.invoke('git-status', cwd),
  gitStage: (cwd, filePath) => ipcRenderer.invoke('git-stage', cwd, filePath),
  gitUnstage: (cwd, filePath) => ipcRenderer.invoke('git-unstage', cwd, filePath),
  gitCommit: (cwd, message) => ipcRenderer.invoke('git-commit', cwd, message),
  gitPush: (cwd) => ipcRenderer.invoke('git-push', cwd),
  gitPull: (cwd) => ipcRenderer.invoke('git-pull', cwd),
  gitInit: (cwd) => ipcRenderer.invoke('git-init', cwd),
  gitDiff: (cwd, filePath, staged, untracked) => ipcRenderer.invoke('git-diff', cwd, filePath, staged, untracked),
  gitBranches: (cwd) => ipcRenderer.invoke('git-branches', cwd),
  gitCheckout: (cwd, branch, create) => ipcRenderer.invoke('git-checkout', cwd, branch, create),
  gitDiscard: (cwd, filePath, untracked) => ipcRenderer.invoke('git-discard', cwd, filePath, untracked),
  gitLog: (cwd, limit) => ipcRenderer.invoke('git-log', cwd, limit),
  gitFetch: (cwd) => ipcRenderer.invoke('git-fetch', cwd)
});
