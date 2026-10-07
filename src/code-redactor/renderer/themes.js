/** Custom themes: loading from the themes folder, filling the selector and applying colours to <body>. */
import { state } from './state.js';
import { saveAllConfig } from './save-hook.js';

const applied = new Set();

const BUNDLED_FALLBACK = ['dracula'];
const COLOR_KEYS = ['window-bg', 'card-bg', 'header-bg', 'code-bg', 'editor-bg', 'text-color', 'text-muted', 'text-faint', 'border-color', 'hover-color', 'active-bg', 'accent-color', 'accent-text', 'link-color', 'selection', 'success-color', 'warning-color', 'danger-color', 'shadow-color', 'scrim'];
const SYNTAX_KEYS = ['keyword', 'string', 'number', 'comment', 'function', 'type', 'field', 'tag', 'attr', 'heading', 'annotation'];
const TERMINAL_KEYS = ['background', 'foreground', 'cursor', 'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'];
const COLOR_RE = /^(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgb|rgba|hsl|hsla)\(\s*[0-9.\s,%/-]+\))$/i;

function pick(source, keys) {
  const out = {};
  for (const key of keys) {
    const value = source && typeof source[key] === 'string' ? source[key].trim() : '';
    if (COLOR_RE.test(value)) out[key] = value;
  }
  return out;
}

/** Same whitelist as the main process: a theme file can only set known colour tokens. */
function sanitize(raw, id) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id, source: 'builtin', name: String(raw.name || id).slice(0, 60), type: raw.type === 'light' ? 'light' : 'dark', author: String(raw.author || '').slice(0, 120),
    colors: pick(raw.colors, COLOR_KEYS), syntax: pick(raw.syntax, SYNTAX_KEYS), terminal: pick(raw.terminal, TERMINAL_KEYS),
  };
}

/** Used when the main process cannot list themes (e.g. the window was reloaded without restarting the app). */
async function loadBundledFallback() {
  const themes = [];
  for (const id of BUNDLED_FALLBACK) {
    try {
      const res = await fetch(`themes/${id}.json`);
      const theme = sanitize(await res.json(), id);
      if (theme) themes.push(theme);
    } catch { /* not reachable: nothing to offer */ }
  }
  return themes;
}

function showThemesStatus(text) {
  const el = document.getElementById('themes-status');
  if (!el) return;
  el.hidden = !text;
  el.textContent = text || '';
}

export async function loadCustomThemes() {
  let error = '';
  try {
    if (!window.electronAPI?.themesList) throw new Error('themesList недоступен');
    const res = await window.electronAPI.themesList();
    if (!res?.success) throw new Error(res?.error || 'ошибка чтения папки тем');
    state.customThemes = res.themes;
    state.themesDir = res.dir || '';
  } catch (err) {
    error = err?.message || String(err);
    state.customThemes = await loadBundledFallback();
  }
  showThemesStatus(error ? `Папка тем недоступна (${error}). Полностью перезапустите приложение (выйдите и запустите снова) — встроенная тема Dracula доступна и сейчас.` : '');
  fillThemeSelect();
  return state.customThemes;
}

/** theme-select value for a custom theme is "custom:<id>". */
export function findCustomTheme(value) {
  if (typeof value !== 'string' || !value.startsWith('custom:')) return null;
  const id = value.slice(7);
  return state.customThemes.find((t) => t.id === id) || null;
}

export function fillThemeSelect() {
  const select = document.getElementById('theme-select');
  if (!select) return;
  const current = select.value;
  select.querySelector('#custom-themes-group')?.remove();
  if (state.customThemes.length) {
    const group = document.createElement('optgroup');
    group.id = 'custom-themes-group';
    group.label = 'Свои темы';
    for (const theme of state.customThemes) {
      const option = document.createElement('option');
      option.value = `custom:${theme.id}`;
      option.textContent = theme.name;
      group.appendChild(option);
    }
    select.appendChild(group);
  }
  if ([...select.options].some((o) => o.value === current)) select.value = current;
}

/** Colours of the theme go on <body>: inline style beats both :root and body.light-theme tokens. */
export function applyThemeVars(theme) {
  const body = document.body;
  applied.forEach((name) => body.style.removeProperty(name));
  applied.clear();
  state.activeTheme = theme || null;
  if (theme) {
    const set = (name, value) => { body.style.setProperty(name, value); applied.add(name); };
    Object.entries(theme.colors || {}).forEach(([k, v]) => set(`--${k}`, v));
    Object.entries(theme.syntax || {}).forEach(([k, v]) => set(`--syn-${k}`, v));
    // A theme that defines its own accent wins over the accent picker.
    if (theme.colors?.['accent-color']) document.documentElement.style.removeProperty('--accent-color');
  } else {
    document.documentElement.style.setProperty('--accent-color', state.accentColor);
  }
  const accentSelect = document.getElementById('accent-color-select');
  if (accentSelect) {
    const locked = !!theme?.colors?.['accent-color'];
    accentSelect.disabled = locked;
    accentSelect.title = locked ? 'Акцент задан выбранной темой' : '';
  }
}

export function setupThemeControls() {
  const needRestart = () => alert('Эта функция появится после полного перезапуска приложения (выйдите и запустите снова).');
  document.getElementById('themes-open-btn')?.addEventListener('click', () => {
    if (!window.electronAPI?.themesOpenFolder) { needRestart(); return; }
    window.electronAPI.themesOpenFolder().catch(needRestart);
  });
  document.getElementById('themes-refresh-btn')?.addEventListener('click', async () => {
    await loadCustomThemes();
    document.getElementById('theme-select')?.dispatchEvent(new Event('change'));
  });
  document.getElementById('themes-import-btn')?.addEventListener('click', async () => {
    let res;
    try { res = await window.electronAPI.themesImport(); } catch { needRestart(); return; }
    if (res?.canceled) return;
    if (!res?.success) { alert(res?.error || 'Не удалось импортировать тему'); return; }
    await loadCustomThemes();
    const select = document.getElementById('theme-select');
    if (select) {
      select.value = `custom:${res.id}`;
      select.dispatchEvent(new Event('change'));
    }
  });
}
