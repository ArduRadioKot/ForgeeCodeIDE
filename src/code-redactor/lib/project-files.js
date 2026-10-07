const { ipcMain } = require('electron');
const fs = require('fs/promises');
const path = require('path');

const IGNORED = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__', 'dist', 'build', '.idea', '.vscode', '.next', '.cache', 'target', '.DS_Store', '.ipynb_checkpoints']);
const MAX_FILES = 8000;

async function listProjectFiles(root) {
  const files = [];
  const queue = [root];
  while (queue.length && files.length < MAX_FILES) {
    const dir = queue.shift();
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (IGNORED.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) queue.push(full);
      else files.push({ path: full, rel: path.relative(root, full) });
      if (files.length >= MAX_FILES) break;
    }
  }
  return files;
}

function registerProjectFilesIpc() {
  try { ipcMain.removeHandler('list-project-files'); } catch {}
  ipcMain.handle('list-project-files', async (e, root) => {
    if (!root) return { success: false, error: 'Папка не открыта', files: [] };
    try { return { success: true, files: await listProjectFiles(root) }; } catch (err) { return { success: false, error: err.message, files: [] }; }
  });
}

module.exports = { registerProjectFilesIpc };
