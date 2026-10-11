/** Files the user attaches to a chat message as context for the model. */
const fs = require('fs').promises;
const path = require('path');
const { ipcMain, dialog } = require('electron');

const MAX_BYTES = 300 * 1024; // what is read from disk
const MAX_CHARS = 40000; // what goes to the model per file

async function readOne(file) {
  const stat = await fs.stat(file);
  if (!stat.isFile()) return { error: 'Это не файл' };
  const buf = await fs.readFile(file);
  const head = buf.subarray(0, Math.min(buf.length, 8000));
  if (head.includes(0)) return { error: 'Бинарный файл нельзя использовать как контекст' };
  let text = buf.subarray(0, MAX_BYTES).toString('utf8');
  const truncated = buf.length > MAX_BYTES || text.length > MAX_CHARS;
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS);
  return { path: file, name: path.basename(file), content: text, truncated };
}

function registerContextFilesIpc(getMainWindow) {
  for (const ch of ['pick-context-files', 'read-context-file']) { try { ipcMain.removeHandler(ch); } catch {} }

  ipcMain.handle('pick-context-files', async () => {
    try {
      const result = await dialog.showOpenDialog(getMainWindow(), { properties: ['openFile', 'multiSelections'], title: 'Файлы для контекста' });
      if (result.canceled) return { success: true, files: [], errors: [] };
      const files = [];
      const errors = [];
      for (const file of result.filePaths) {
        try {
          const one = await readOne(file);
          if (one.error) errors.push(`${path.basename(file)}: ${one.error}`); else files.push(one);
        } catch (err) { errors.push(`${path.basename(file)}: ${err.message}`); }
      }
      return { success: true, files, errors };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('read-context-file', async (_event, file) => {
    try {
      const one = await readOne(String(file));
      return one.error ? { success: false, error: one.error } : { success: true, file: one };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  console.log('[context] IPC handlers registered');
}

module.exports = { registerContextFilesIpc };
