const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { ipcMain } = require('electron');

const IGNORED = /(^|[\\/])(node_modules|\.git|\.venv|venv|__pycache__|dist|\.DS_Store)([\\/]|$)/;
const watchers = new Map(); // webContents.id -> { folder, watcher, timer, paths }

function stop(id) {
  const w = watchers.get(id);
  if (!w) return;
  clearTimeout(w.timer);
  try { w.watcher.close(); } catch {}
  watchers.delete(id);
}

function start(wc, folder) {
  stop(wc.id);
  if (!folder) return false;
  const entry = { folder, watcher: null, timer: null, paths: new Set() };
  const onEvent = (_evt, name) => {
    if (name && IGNORED.test(String(name))) return;
    if (name) entry.paths.add(path.join(folder, String(name)));
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      const paths = [...entry.paths];
      entry.paths.clear();
      if (!wc.isDestroyed()) wc.send('fs-changed', { folder, paths });
    }, 350);
  };
  try {
    try { entry.watcher = fs.watch(folder, { recursive: true }, onEvent); }
    catch { entry.watcher = fs.watch(folder, onEvent); } // recursive watching is not available everywhere
    entry.watcher.on('error', () => stop(wc.id));
  } catch { return false; }
  watchers.set(wc.id, entry);
  wc.once('destroyed', () => stop(wc.id));
  return true;
}

function registerFolderWatchIpc() {
  for (const ch of ['watch-folder', 'file-stat']) { try { ipcMain.removeHandler(ch); } catch {} }
  ipcMain.handle('watch-folder', (e, folder) => ({ success: start(e.sender, folder) }));
  ipcMain.handle('file-stat', async (e, filePath) => {
    try {
      const st = await fsp.stat(filePath);
      return { exists: true, mtimeMs: st.mtimeMs, size: st.size };
    } catch {
      return { exists: false };
    }
  });
}

module.exports = { registerFolderWatchIpc };
