const { BrowserWindow, ipcMain } = require('electron');
const { randomUUID } = require('node:crypto');

const page = 'data:text/html;charset=utf-8,' + encodeURIComponent(
  '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; worker-src blob:; script-src \'unsafe-eval\'; connect-src \'none\'">',
);

// Serialized into an isolated web worker. It has no DOM, Electron bridge, or network access.
function pluginWorker(source) {
  const actions = [];
  const info = [];
  const submit = self.postMessage.bind(self);
  let content = '';
  let selection = { from: 0, to: 0 };
  let file = null;
  let notices = [];
  const editor = Object.freeze({
    get: () => content, selection: () => content.slice(selection.from, selection.to),
    cursor: () => ({ ...selection }), file: () => file && { ...file },
    set: (text) => { content = String(text); },
    insert: (text) => {
      const value = String(text);
      content = content.slice(0, selection.from) + value + content.slice(selection.to);
      const offset = selection.from + value.length;
      selection = { from: offset, to: offset };
    },
    replace: (from, to, text) => { content = content.slice(0, from) + String(text) + content.slice(to); },
  });
  const api = Object.freeze({
    version: 1, app: 'FrogeeCodeIDE',
    addButton({ title, icon, run }) {
      if (typeof run !== 'function' || actions.length >= 30) return;
      info.push({ title: String(title || 'Plugin').slice(0, 120), icon: String(icon || '').slice(0, 20) });
      actions.push(run);
    },
    notify(text) { if (notices.length < 10) notices.push(String(text).slice(0, 500)); },
    editor,
  });
  try {
    new Function('frogee', 'fgs', source)(api, api);
    submit({ buttons: info });
  } catch (error) { submit({ error: String(error.message || error) }); }

  self.onmessage = async ({ data }) => {
    content = data.text;
    selection = data.selection;
    file = data.file;
    notices = [];
    try {
      await actions[data.index](editor);
      if (content.length > 2000000) throw new Error('Plugin edit exceeds 2 MB.');
      submit({ text: content, notices });
    } catch (error) { submit({ error: String(error.message || error) }); }
  };
}

async function invoke(win, expression) {
  let timer;
  try {
    return await Promise.race([
      win.webContents.executeJavaScript(expression),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('Plugin execution timed out.'));
          if (!win.isDestroyed()) win.destroy();
        }, 3500);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

function registerIsolatedPlugins() {
  const hosts = new Map();
  const key = (sender, file) => `${sender.id}:${file}`;
  function close(id) {
    const session = hosts.get(id);
    if (!session) return;
    hosts.delete(id);
    session.sender.removeListener('destroyed', session.cleanup);
    if (!session.win.isDestroyed()) session.win.destroy();
  }

  ipcMain.handle('isolated-plugin:start', async ({ sender }, file, source) => {
    if (typeof source !== 'string' || source.length > 2000000) throw new Error('Plugin exceeds 2 MB.');
    const id = key(sender, file);
    close(id);
    const win = new BrowserWindow({
      show: false, skipTaskbar: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: `frogee-plugin-${randomUUID()}`, devTools: false, webviewTag: false },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    win.webContents.session.setPermissionCheckHandler(() => false);
    win.webContents.session.webRequest.onBeforeRequest(({ url }, callback) => callback({ cancel: url !== page && !url.startsWith('blob:') }));
    const cleanup = () => close(id);
    sender.once('destroyed', cleanup);
    const session = { win, sender, cleanup, pending: true };
    hosts.set(id, session);
    win.once('closed', () => {
      if (hosts.get(id) === session) close(id);
    });
    try {
      await win.loadURL(page);
      const script = '(' + pluginWorker.toString() + ')(' + JSON.stringify(source) + ')';
      const result = await invoke(win, `(() => {
        const url = URL.createObjectURL(new Blob([${JSON.stringify(script)}], { type: 'text/javascript' }));
        const worker = new Worker(url);
        let receive;
        let fail;
        worker.onmessage = ({ data }) => {
          URL.revokeObjectURL(url);
          receive(data);
        };
        worker.onerror = ({ message }) => {
          URL.revokeObjectURL(url);
          fail(new Error(message));
        };
        window.runPluginAction = (data) => new Promise((resolve, reject) => {
          receive = resolve;
          fail = reject;
          worker.postMessage(data);
        });
        return new Promise((resolve, reject) => { receive = resolve; fail = reject; });
      })()`);
      if (result.error) throw new Error(result.error);
      session.pending = false;
      if (!Array.isArray(result.buttons)) throw new Error('Invalid plugin registration.');
      return result.buttons.slice(0, 30).map((spec) => ({
        title: typeof spec?.title === 'string' ? spec.title.slice(0, 120) : 'Plugin',
        icon: typeof spec?.icon === 'string' ? spec.icon.slice(0, 20) : '',
      }));
    } catch (error) {
      if (hosts.get(id) === session) close(id);
      throw error;
    }
  });
  ipcMain.handle('isolated-plugin:run', async ({ sender }, file, input) => {
    const session = hosts.get(key(sender, file));
    if (!session || session.pending) throw new Error('Plugin is unavailable or busy.');
    if (typeof input.text !== 'string' || input.text.length > 2000000) throw new Error('Plugin input exceeds 2 MB.');
    session.pending = true;
    try {
      const result = await invoke(session.win, `window.runPluginAction(${JSON.stringify(input)})`);
      if (result.error) throw new Error(result.error);
      if (typeof result.text !== 'string' || result.text.length > 2000000) throw new Error('Invalid plugin result.');
      const notices = Array.isArray(result.notices) ? result.notices.filter((notice) => typeof notice === 'string').slice(0, 10).map((notice) => notice.slice(0, 500)) : [];
      return { text: result.text, notices };
    } finally { session.pending = false; }
  });
  ipcMain.handle('isolated-plugin:stop', ({ sender }, file) => close(key(sender, file)));
}

module.exports = { registerIsolatedPlugins };
