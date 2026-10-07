const { app, BrowserWindow, shell, ipcMain, nativeTheme } = require('electron');
const path = require('path');
const axios = require('axios');

const { loadConfig, setOpenRouterApiKey } = require('./lib/config');
const { killTerminalProcess, registerTerminalIpc } = require('./lib/terminal');
const { registerGitIpc } = require('./lib/git');
const { registerFileIpc } = require('./lib/ipc-files');
const { registerAiIpc } = require('./lib/ipc-ai');
const { registerKernelIpc, killAllKernels } = require('./lib/kernel');
const { registerProjectFilesIpc } = require('./lib/project-files');
const { registerLiveServerIpc, stopAllLiveServers } = require('./lib/liveserver');
const { registerAgentsIpc, killAgents } = require('./lib/agents');
const { registerThemesIpc } = require('./lib/themes');

let mainWindow = null;

function getMainWindow() {
  return mainWindow;
}

async function checkOllamaRunning() {
  try {
    await axios.get('http://localhost:11434/api/tags', { timeout: 1000 });
    return true;
  } catch {
    return false;
  }
}

// The native blur follows the system appearance, so keep it in step with the app theme.
ipcMain.on('set-native-theme', (event, theme) => { nativeTheme.themeSource = theme === 'light' ? 'light' : 'dark'; });

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    // A translucent native window: the page stays opaque until Liquid Glass makes its background transparent.
    ...(process.platform === 'darwin' ? { backgroundColor: '#00000000', vibrancy: 'under-window', visualEffectState: 'active' } : {}),
    ...(process.platform === 'win32' ? { backgroundColor: '#00000000', backgroundMaterial: 'acrylic' } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true // built-in browser tab; hardened in will-attach-webview below
    }
  });

  // The IDE shell may only navigate within itself; external links open in the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload;
    delete webPreferences.preloadURL;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
    webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false;
    if (!/^(https?:|file:|about:blank)/i.test(params.src || 'about:blank')) event.preventDefault();
  });

  // Pages that try to open a window become a new browser tab inside the IDE.
  mainWindow.webContents.on('did-attach-webview', (event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url) && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('browser-new-tab', { url });
      }
      return { action: 'deny' };
    });
  });

  mainWindow.loadFile('index.html');
}

function registerCoreIpc() {
  try {
    registerTerminalIpc(getMainWindow);
    registerGitIpc();
  } catch (err) {
    console.error('[ipc] Failed to register core handlers:', err);
  }
}

function registerAllIpc() {
  registerCoreIpc();
  registerFileIpc(getMainWindow);
  registerAiIpc();
  registerKernelIpc(getMainWindow);
  registerProjectFilesIpc();
  registerLiveServerIpc(getMainWindow);
  registerAgentsIpc(getMainWindow);
  registerThemesIpc(getMainWindow);
}

// Terminal + git must be available as soon as the app is ready
app.whenReady().then(async () => {
  registerAllIpc();

  const ollamaRunning = await checkOllamaRunning();
  if (!ollamaRunning) {
    console.log('Ollama не запущен. Пользователь должен запустить его вручную.');
  }

  try {
    const config = await loadConfig();
    setOpenRouterApiKey((config && config.openRouterApiKey) || '');
  } catch (err) {
    console.error('Не удалось загрузить конфиг при старте:', err);
    setOpenRouterApiKey('');
  }

  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  killTerminalProcess();
  killAllKernels();
  stopAllLiveServers();
  killAgents();
});
