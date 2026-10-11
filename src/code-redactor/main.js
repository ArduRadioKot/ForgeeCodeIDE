const { app, BrowserWindow, shell, ipcMain, nativeTheme, Menu } = require('electron');
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
const { registerOllamaIpc } = require('./lib/ollama');
const { registerBionicIpc } = require('./lib/bionic');
const { registerDiagnosticsIpc } = require('./lib/diagnostics');
const { registerSearchIpc } = require('./lib/search');
const { registerGitignoreIpc } = require('./lib/gitignore');
const { registerContextFilesIpc } = require('./lib/context-files');

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

// Only macOS gives a translucent window (vibrancy). On Windows the acrylic material is unreliable (the window can come out
// plain white, and the whole glass UI with it), so Windows and Linux get an opaque window in the theme colour and Liquid
// Glass works inside the app: lenses and frosted panels over the page.
const nativeBlur = process.platform === 'darwin';
const windowColor = () => (nativeTheme.shouldUseDarkColors ? '#17181a' : '#e8ebf1');

// The native blur follows the system appearance, so keep it in step with the app theme.
ipcMain.on('set-native-theme', (event, theme) => {
  nativeTheme.themeSource = theme === 'light' ? 'light' : 'dark';
  if (!nativeBlur && mainWindow && !mainWindow.isDestroyed()) mainWindow.setBackgroundColor(windowColor());
});

/** Menu entries just tell the renderer which command to run; shortcuts are shown but handled by the page itself. */
function buildMacMenu() {
  const send = (id) => () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('menu-command', id); };
  const item = (label, id, accelerator) => ({ label, click: send(id), ...(accelerator ? { accelerator, registerAccelerator: false } : {}) });
  const sep = { type: 'separator' };
  return Menu.buildFromTemplate([
    { label: app.getName(), submenu: [{ role: 'about', label: 'О программе ' + app.getName() }, sep, item('Настройки…', 'settings', 'Cmd+,'), sep, { role: 'hide', label: 'Скрыть' }, { role: 'hideOthers', label: 'Скрыть остальные' }, { role: 'unhide', label: 'Показать все' }, sep, { role: 'quit', label: 'Выйти' }] },
    { label: 'Файл', submenu: [
      item('Новый файл', 'new-file', 'Cmd+N'), item('Новый ноутбук', 'new-notebook'), sep,
      item('Открыть файл или папку…', 'open', 'Cmd+O'), item('Открыть папку проекта…', 'open-folder'), item('Быстрое открытие…', 'quick-open', 'Cmd+P'), sep,
      item('Сохранить', 'save', 'Cmd+S'), item('Сохранить как…', 'save-as', 'Shift+Cmd+S'), item('Автосохранение', 'autosave'), sep,
      item('Закрыть вкладку', 'close-tab', 'Cmd+W'), item('Открыть закрытую вкладку', 'reopen-tab', 'Shift+Cmd+T'),
    ] },
    { label: 'Правка', submenu: [
      { role: 'undo', label: 'Отменить' }, { role: 'redo', label: 'Повторить' }, sep,
      { role: 'cut', label: 'Вырезать' }, { role: 'copy', label: 'Копировать' }, { role: 'paste', label: 'Вставить' }, { role: 'selectAll', label: 'Выделить всё' }, sep,
      item('Найти в файле', 'find', 'Cmd+F'), item('Найти и заменить', 'replace', 'Alt+Cmd+F'), item('Перейти к строке…', 'goto-line', 'Ctrl+G'), item('Перейти к символу…', 'symbols', 'Shift+Cmd+O'), sep,
      item('Форматировать документ', 'format', 'Shift+Alt+F'), sep,
      item('Поиск по проекту', 'search-project', 'Shift+Cmd+F'), item('TODO / FIXME проекта', 'todos'), sep,
      item('Палитра команд…', 'palette', 'Shift+Cmd+P'),
    ] },
    { label: 'Вид', submenu: [
      item('Проводник', 'view-explorer'), item('Поиск', 'view-search'), item('Git', 'view-git'), item('Запуск', 'view-run'), sep,
      item('Боковая панель', 'toggle-sidebar', 'Cmd+B'), item('Терминал', 'toggle-terminal', 'Cmd+`'), item('AI-чат', 'toggle-chat'), item('Браузер', 'browser', 'Shift+Cmd+B'),
      item('Предпросмотр Markdown', 'md-preview', 'Shift+Cmd+V'), item('Разделить редактор', 'split', 'Cmd+\\'), sep,
      item('Увеличить масштаб', 'zoom-in', 'Cmd+Plus'), item('Уменьшить масштаб', 'zoom-out', 'Cmd+-'), item('Сбросить масштаб', 'zoom-reset', 'Cmd+0'), sep,
      { role: 'togglefullscreen', label: 'Полноэкранный режим' },
    ] },
    { label: 'Запуск', submenu: [
      item('Выполнить текущий файл', 'run-file', 'F5'), item('Live Server: запустить / остановить', 'live'), item('Браузер рядом с редактором', 'browser-side'), item('Терминал', 'terminal'),
    ] },
    { role: 'windowMenu', label: 'Окно' },
  ]);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    // A translucent native window: the page stays opaque until Liquid Glass makes its background transparent.
    // Without a system blur the window is a plain themed one (a transparent colour would show black or white).
    backgroundColor: nativeBlur ? '#00000000' : windowColor(),
    ...(nativeBlur ? { vibrancy: 'under-window', visualEffectState: 'active' } : {}),
    webPreferences: {
      additionalArguments: [`--frogee-native-blur=${nativeBlur ? 1 : 0}`],
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

  // macOS gets the native menu bar at the top of the screen; Windows and Linux use the system window frame without a menu.
  Menu.setApplicationMenu(process.platform === 'darwin' ? buildMacMenu() : null);
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
  registerOllamaIpc();
  registerBionicIpc();
  registerDiagnosticsIpc();
  registerSearchIpc();
  registerGitignoreIpc();
  registerContextFilesIpc(getMainWindow);
}

// Terminal + git must be available as soon as the app is ready
app.setName('FrogeeCodeIDE');
app.setAboutPanelOptions({
  applicationName: 'FrogeeCodeIDE',
  applicationVersion: app.getVersion(),
  version: '',
  copyright: '© Frogeesoft',
  credits: 'Автор: arduradiokot\nКомпания: Frogeesoft',
  iconPath: path.join(__dirname, 'images', 'icon.png'),
});

app.whenReady().then(async () => {
  if (process.platform === 'darwin') { try { app.dock.setIcon(path.join(__dirname, 'images', 'icon.png')); } catch {} }
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
