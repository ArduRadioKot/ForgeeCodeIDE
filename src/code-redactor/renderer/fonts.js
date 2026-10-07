/** Font settings: editor (monospace) and interface fonts, ligatures. Fonts must be installed on the system. */
import { state } from './state.js';
import { saveAllConfig } from './save-hook.js';
import { applyTerminalFont } from './terminal.js';

const MONO = ['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Source Code Pro', 'IBM Plex Mono', 'Hack', 'SF Mono', 'Menlo', 'Consolas', 'Monaco', 'Courier New'];
const UI = ['Inter', 'SF Pro Text', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'IBM Plex Sans', 'Noto Sans', 'Source Sans 3', 'Verdana'];
const MONO_FALLBACK = "'JetBrains Mono', 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace";
const UI_FALLBACK = "Inter, 'Inter Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'SF Pro Text', sans-serif";
const CUSTOM = '__custom';
const SAFE_NAME = /^[\w .+-]{1,60}$/;

let probe = null;
/** A font counts as installed when it changes the width of a test string against two different fallbacks. */
function isInstalled(name) {
  try {
    const ctx = (probe ||= document.createElement('canvas').getContext('2d'));
    const text = 'mmmmmmmmmmlli WwQq@#0123456789';
    const width = (family) => { ctx.font = `72px ${family}`; return ctx.measureText(text).width; };
    return ['monospace', 'serif', 'sans-serif'].some((base) => width(`'${name}', ${base}`) !== width(base));
  } catch {
    return true;
  }
}

function stack(name, kind) {
  if (!name || !SAFE_NAME.test(name)) return '';
  return `'${name}', ${kind === 'mono' ? MONO_FALLBACK : UI_FALLBACK}`;
}

export function applyFonts() {
  const root = document.documentElement;
  const mono = stack(state.editorFont, 'mono');
  const ui = stack(state.uiFont, 'ui');
  if (mono) root.style.setProperty('--mono-font', mono); else root.style.removeProperty('--mono-font');
  if (ui) root.style.setProperty('--ui-font', ui); else root.style.removeProperty('--ui-font');
  root.style.setProperty('--editor-ligatures', state.fontLigatures ? 'normal' : 'none');
  applyTerminalFont();
}

function fillSelect(select, fonts, value) {
  select.innerHTML = '';
  const add = (v, label) => { const o = document.createElement('option'); o.value = v; o.textContent = label; select.appendChild(o); };
  add('', 'По умолчанию');
  fonts.forEach((name) => add(name, isInstalled(name) ? name : `${name} — не найден`));
  add(CUSTOM, 'Другой…');
  select.value = value && !fonts.includes(value) ? CUSTOM : (value || '');
}

export function syncFontControls() {
  [['editor-font', MONO, state.editorFont], ['ui-font', UI, state.uiFont]].forEach(([id, fonts, value]) => {
    const select = document.getElementById(`${id}-select`);
    const input = document.getElementById(`${id}-custom`);
    if (!select) return;
    fillSelect(select, fonts, value);
    if (input) {
      input.hidden = select.value !== CUSTOM;
      input.value = select.value === CUSTOM ? value : '';
    }
  });
  const lig = document.getElementById('font-ligatures');
  if (lig) lig.checked = state.fontLigatures;
}

export function setupFonts() {
  const bind = (id, key) => {
    const select = document.getElementById(`${id}-select`);
    const input = document.getElementById(`${id}-custom`);
    select?.addEventListener('change', () => {
      if (select.value === CUSTOM) {
        input.hidden = false;
        input.focus();
        return;
      }
      input.hidden = true;
      state[key] = select.value;
      applyFonts();
      saveAllConfig();
    });
    input?.addEventListener('change', () => {
      const name = input.value.trim();
      if (name && !SAFE_NAME.test(name)) { input.value = ''; return; }
      state[key] = name;
      applyFonts();
      saveAllConfig();
    });
  };
  bind('editor-font', 'editorFont');
  bind('ui-font', 'uiFont');
  document.getElementById('font-ligatures')?.addEventListener('change', (e) => {
    state.fontLigatures = e.target.checked;
    applyFonts();
    saveAllConfig();
  });
  syncFontControls();
}
