/** Custom themes: JSON files in ~/Documents/FrogeeCodeIDE/themes. Only whitelisted keys and plain colours are accepted. */
const { ipcMain, dialog, shell } = require('electron');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const USER_DIR = path.join(os.homedir(), 'Documents', 'FrogeeCodeIDE', 'themes');
const BUNDLED_DIR = path.join(__dirname, '..', 'themes');
const SEED_MARKER = '.seeded-v1';

const COLOR_KEYS = new Set(['window-bg', 'card-bg', 'header-bg', 'code-bg', 'editor-bg', 'text-color', 'text-muted', 'text-faint', 'border-color', 'hover-color', 'active-bg', 'accent-color', 'accent-text', 'link-color', 'selection', 'success-color', 'warning-color', 'danger-color', 'shadow-color', 'scrim']);
const SYNTAX_KEYS = new Set(['keyword', 'string', 'number', 'comment', 'function', 'type', 'field', 'tag', 'attr', 'heading', 'annotation']);
const TERMINAL_KEYS = new Set(['background', 'foreground', 'cursor', 'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite']);
const COLOR_RE = /^(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgb|rgba|hsl|hsla)\(\s*[0-9.\s,%/-]+\))$/i;

function pick(source, allowed) {
  const out = {};
  if (!source || typeof source !== 'object') return out;
  for (const [key, value] of Object.entries(source)) {
    if (allowed.has(key) && typeof value === 'string' && COLOR_RE.test(value.trim())) out[key] = value.trim();
  }
  return out;
}

function sanitizeTheme(raw, fallbackName) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || fallbackName).slice(0, 60);
  return {
    name,
    type: raw.type === 'light' ? 'light' : 'dark',
    author: raw.author ? String(raw.author).slice(0, 120) : '',
    colors: pick(raw.colors, COLOR_KEYS),
    syntax: pick(raw.syntax, SYNTAX_KEYS),
    terminal: pick(raw.terminal, TERMINAL_KEYS),
  };
}

/** First run: create the folder and drop the Dracula example in so there is something to copy from. */
async function ensureUserDir() {
  await fs.mkdir(USER_DIR, { recursive: true });
  const marker = path.join(USER_DIR, SEED_MARKER);
  try {
    await fs.access(marker);
    return;
  } catch { /* not seeded yet */ }
  try {
    const files = (await fs.readdir(BUNDLED_DIR)).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      const target = path.join(USER_DIR, file);
      try { await fs.access(target); } catch { await fs.copyFile(path.join(BUNDLED_DIR, file), target); }
    }
    await fs.copyFile(path.join(BUNDLED_DIR, 'README.md'), path.join(USER_DIR, 'README.md')).catch(() => {});
  } catch { /* bundled themes missing: nothing to seed */ }
  await fs.writeFile(marker, '1').catch(() => {});
}

async function readThemeDir(dir, source) {
  let files = [];
  try { files = (await fs.readdir(dir)).filter((f) => f.toLowerCase().endsWith('.json')); } catch { return []; }
  const themes = [];
  for (const file of files) {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(dir, file), 'utf8'));
      const theme = sanitizeTheme(raw, path.basename(file, '.json'));
      if (theme) themes.push({ id: path.basename(file, '.json'), source, ...theme });
    } catch (err) {
      console.warn('[themes] пропущен', file, err.message);
    }
  }
  return themes;
}

/** Bundled themes (Dracula) are always there; a file with the same name in the user folder replaces them. */
async function listThemes() {
  try { await ensureUserDir(); } catch (err) { console.warn('[themes] папка тем недоступна:', err.message); }
  const byId = new Map();
  for (const theme of await readThemeDir(BUNDLED_DIR, 'builtin')) byId.set(theme.id, theme);
  for (const theme of await readThemeDir(USER_DIR, 'user')) byId.set(theme.id, theme);
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function registerThemesIpc(getMainWindow) {
  for (const ch of ['themes-list', 'themes-open-folder', 'themes-import']) { try { ipcMain.removeHandler(ch); } catch {} }

  ipcMain.handle('themes-list', async () => {
    try { return { success: true, themes: await listThemes(), dir: USER_DIR }; } catch (err) { return { success: false, error: err.message, themes: [] }; }
  });

  ipcMain.handle('themes-open-folder', async () => {
    await ensureUserDir();
    const error = await shell.openPath(USER_DIR);
    return { success: !error, error };
  });

  ipcMain.handle('themes-import', async () => {
    const win = getMainWindow();
    const res = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Тема (JSON)', extensions: ['json'] }] });
    if (res.canceled || !res.filePaths.length) return { success: false, canceled: true };
    try {
      const file = res.filePaths[0];
      const theme = sanitizeTheme(JSON.parse(await fs.readFile(file, 'utf8')), path.basename(file, '.json'));
      if (!theme) return { success: false, error: 'Файл не похож на тему' };
      await ensureUserDir();
      const id = path.basename(file, '.json').replace(/[^\w.-]+/g, '_');
      await fs.writeFile(path.join(USER_DIR, `${id}.json`), JSON.stringify({ name: theme.name, type: theme.type, author: theme.author, colors: theme.colors, syntax: theme.syntax, terminal: theme.terminal }, null, 2));
      return { success: true, id };
    } catch (err) {
      return { success: false, error: `Не удалось прочитать тему: ${err.message}` };
    }
  });
}

module.exports = { registerThemesIpc, sanitizeTheme };
