/**
 * Plugins, the same way FgSNotes does them: .js and .css files in ~/Documents/FrogeeCodeIDE/plugins, found and installed like themes.
 * The "Установить…" button picks files, warns that a plugin runs inside the editor, and copies them into the plugins folder.
 */
const { ipcMain, dialog, shell, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

const NAME_RE = /^[^\\/:*?"<>|\0]{1,120}\.(?:js|css)$/i;
const MAX_SIZE = 2 * 1024 * 1024;

function pluginsDir() {
  const dir = path.join(os.homedir(), 'Documents', 'FrogeeCodeIDE', 'plugins');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function registerPluginsIpc() {
  for (const ch of ['plugins-list', 'plugin-read', 'plugin-install', 'plugin-remove', 'plugins-open']) { try { ipcMain.removeHandler(ch); } catch {} }

  ipcMain.handle('plugins-list', () => {
    try {
      return fs.readdirSync(pluginsDir()).filter((name) => NAME_RE.test(name) && !name.startsWith('.'))
        .map((name) => ({ file: name, size: fs.statSync(path.join(pluginsDir(), name)).size }));
    } catch (err) {
      console.error('[plugins] папка недоступна:', err);
      return [];
    }
  });

  ipcMain.handle('plugin-read', (e, file) => {
    if (!NAME_RE.test(String(file))) throw new Error('Неверное имя плагина');
    const target = path.join(pluginsDir(), file);
    if (fs.statSync(target).size > MAX_SIZE) throw new Error('Плагин больше 2 МБ');
    return fs.readFileSync(target, 'utf8');
  });

  // Pick files, confirm (a plugin is a program with the editor's rights), copy them into the plugins folder.
  ipcMain.handle('plugin-install', async (e, lang) => {
    const en = lang === 'en';
    const win = BrowserWindow.fromWebContents(e.sender);
    const picked = await dialog.showOpenDialog(win, {
      title: en ? 'Install plugin' : 'Установить плагин',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: en ? 'FrogeeCodeIDE plugins (.js, .css)' : 'Плагины FrogeeCodeIDE (.js, .css)', extensions: ['js', 'css'] }],
    });
    if (picked.canceled || !picked.filePaths.length) return { canceled: true, installed: [] };
    const files = picked.filePaths.filter((file) => NAME_RE.test(path.basename(file)));
    if (!files.length) return { canceled: false, installed: [], error: en ? 'Choose .js or .css files' : 'Нужны файлы .js или .css' };
    const answer = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: en ? ['Install', 'Cancel'] : ['Установить', 'Отмена'],
      defaultId: 1,
      cancelId: 1,
      message: files.length === 1 ? (en ? `Install plugin “${path.basename(files[0])}”?` : `Установить плагин «${path.basename(files[0])}»?`) : (en ? `Install plugins (${files.length})?` : `Установить плагины (${files.length})?`),
      detail: en ? 'A plugin runs inside FrogeeCodeIDE and can access open files and your project. Install only plugins you trust.\n\nThe files will be copied to Documents/FrogeeCodeIDE/plugins.' : 'Плагин — это программа: он выполняется внутри FrogeeCodeIDE, видит открытые файлы и может работать с проектом так же, как сам редактор. Устанавливайте только те плагины, которым доверяете.\n\nФайлы будут скопированы в папку Documents/FrogeeCodeIDE/plugins.',
    });
    if (answer.response !== 0) return { canceled: true, installed: [] };
    const installed = [];
    const skipped = [];
    for (const file of files) {
      const name = path.basename(file);
      if (fs.statSync(file).size > MAX_SIZE) { skipped.push(`${name}: ${en ? 'over 2 MB' : 'больше 2 МБ'}`); continue; }
      fs.copyFileSync(file, path.join(pluginsDir(), name));
      installed.push(name);
    }
    return { canceled: false, installed, error: skipped.length ? `${en ? 'Not installed' : 'Не установлены'}: ${skipped.join('; ')}` : '' };
  });

  // Removing moves the file to the Trash, so it can be brought back.
  ipcMain.handle('plugin-remove', async (e, file) => {
    if (!NAME_RE.test(String(file))) throw new Error('Неверное имя плагина');
    const target = path.join(pluginsDir(), file);
    if (!fs.existsSync(target)) return true;
    try { await shell.trashItem(target); } catch { fs.rmSync(target, { force: true }); }
    return true;
  });

  ipcMain.handle('plugins-open', () => shell.openPath(pluginsDir()));
}

module.exports = { registerPluginsIpc };
