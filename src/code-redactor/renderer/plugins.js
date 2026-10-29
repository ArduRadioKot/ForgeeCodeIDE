/**
 * Plugins, built like the ones in FgSNotes: .js and .css files in Documents/FrogeeCodeIDE/plugins.
 * A .css plugin is added to the page. A .js plugin is a function body that receives the API below, as `frogee`
 * and as `fgs`, so FgSNotes plugins run here unchanged. Plugins installed with the button start switched on,
 * files put into the folder by hand start switched off.
 *
 *   // ==FrogeePlugin==
 *   // @name        Вставить дату
 *   // @version     1.0
 *   // @description Кнопка слева вставляет сегодняшнюю дату
 *   // ==/FrogeePlugin==
 *   frogee.addButton({ title: 'Вставить дату', icon: 'calendar', run: (editor) => editor.insert(new Date().toLocaleDateString()) });
 */
import { state } from './state.js';
import { escapeHtml } from './utils.js';
import { toast } from './image-view.js';
import { isEditorTab } from './tab-model.js';
import { getLang, onLangChange } from './i18n.js';

const ENABLED = 'frogee.plugins.enabled';
const running = new Map(); // file -> { cleanups, preview, change, tab, error }
const buttons = []; // { file, title, icon, run } in the order plugins added them
let armed = null; // file whose "Удалить" was pressed once

const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; } };
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full */ } };
const enabledMap = () => read(ENABLED, {});
function setEnabled(file, on) {
  const all = enabledMap();
  if (on) all[file] = true; else delete all[file];
  write(ENABLED, all);
}

/** The header block; FgSNotes' ==FgsPlugin== header is understood as well. */
export function parseMeta(source, file) {
  const head = /==(?:FrogeePlugin|FgsPlugin)==([\s\S]*?)==\/(?:FrogeePlugin|FgsPlugin)==/.exec(String(source).slice(0, 4000));
  const field = (name) => { const m = head && new RegExp(`@${name}\\s+(.+)`).exec(head[1]); return m ? m[1].trim() : ''; };
  return { name: field('name') || file.replace(/\.(js|css)$/i, ''), version: field('version'), description: field('description'), author: field('author') };
}

// ───────────────────────── icons ─────────────────────────

const S = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
const ICONS = {
  sparkles: `<path ${S} d="M12 3.5c.6 3.8 2.700 5.900 6.500 6.500-3.800.600-5.900 2.700-6.500 6.500-.600-3.800-2.700-5.900-6.500-6.500 3.800-.600 5.900-2.700 6.500-6.500zM18.500 15.500c.3 1.500 1 2.200 2.500 2.500-1.500.3-2.200 1-2.500 2.500-.3-1.500-1-2.200-2.500-2.500 1.500-.3 2.200-1 2.500-2.500z"/>`,
  edit: `<path ${S} d="M4 20l1-4L15.500 5.500a2.100 2.100 0 0 1 3 3L8 19zM13.500 7.500l3 3"/>`,
  draw: `<path ${S} d="M4 17.500c2.200-1.200 3.600-.300 5 .600 1.600 1 3.200 1.800 5.600.400M14.600 4.600a2 2 0 0 1 2.800 0l2 2a2 2 0 0 1 0 2.800l-7.800 7.800-4.200 1 1-4.200zM13.200 6l4.800 4.800"/>`,
  calendar: `<rect ${S} x="3.500" y="5" width="17" height="15" rx="2.500"/><path ${S} d="M3.500 10h17M8 3v4M16 3v4"/>`,
  history: `<path ${S} d="M4 12a8 8 0 1 0 2.300-5.700M4 4v3.500h3.500M12 8v4.500l3 2"/>`,
  clock: `<circle ${S} cx="12" cy="12" r="8.500"/><path ${S} d="M12 7.500V12l3 2"/>`,
  code: `<path ${S} d="M8.500 8 4.500 12l4 4M15.500 8l4 4-4 4M13.500 6l-3 12"/>`,
  image: `<rect ${S} x="3.500" y="4.500" width="17" height="15" rx="2.500"/><circle ${S} cx="9" cy="10" r="1.700"/><path ${S} d="m20.500 16-5-5-8.500 8.500"/>`,
  star: `<path ${S} d="m12 4 2.400 5 5.400.700-4 3.800 1 5.400L12 16.300 7.200 18.900l1-5.400-4-3.800L9.600 9z"/>`,
  bolt: `<path ${S} d="M13 3 5 13.500h6L10 21l8-10.500h-6z"/>`,
  list: `<path ${S} d="M9 6.500h11M9 12h11M9 17.500h11M4.500 6.500h.01M4.500 12h.01M4.500 17.500h.01"/>`,
  more: `<g fill="currentColor"><circle cx="5.500" cy="12" r="1.600"/><circle cx="12" cy="12" r="1.600"/><circle cx="18.500" cy="12" r="1.600"/></g>`,
};
/** A built-in icon name or SVG markup from the plugin. */
function iconMarkup(icon) {
  if (/^\s*<svg[\s>]/i.test(String(icon || ''))) return String(icon);
  return `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">${ICONS[icon] || ICONS.sparkles}</svg>`;
}

// ───────────────────────── left stripe with an overflow menu ─────────────────────────

const slot = () => document.getElementById('plugin-slot');
let layoutFrame = 0;
let menu = null;

/** How many buttons fit between the built-in ones: the stripe never scrolls. */
function capacity() {
  const sidebar = document.getElementById('sidebar');
  const s = slot();
  if (!sidebar || !s) return buttons.length;
  const step = (document.getElementById('explorer-btn')?.offsetHeight || 40) + 4;
  const prev = s.style.display;
  s.style.display = 'none';
  let used = 0;
  for (const el of sidebar.children) if (el !== s && !el.classList.contains('sidebar-spacer')) used += el.offsetHeight + 4;
  s.style.display = prev;
  return Math.max(1, Math.floor((sidebar.clientHeight - used - 24) / step));
}

function stripeButton(entry) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'sidebar-btn plugin-btn';
  b.title = entry.title;
  b.setAttribute('aria-label', entry.title);
  b.innerHTML = iconMarkup(entry.icon);
  b.addEventListener('mousedown', (e) => e.preventDefault()); // keep the editor's selection
  b.addEventListener('click', () => entry.run());
  return b;
}

function doLayout() {
  layoutFrame = 0;
  closeMenu();
  const s = slot();
  if (!s) return;
  s.replaceChildren();
  if (!buttons.length) return;
  s.insertAdjacentHTML('beforeend', '<div class="sidebar-separator"></div>');
  const fits = capacity();
  const direct = buttons.length <= fits ? buttons : buttons.slice(0, fits - 1);
  direct.forEach((entry) => s.appendChild(stripeButton(entry)));
  if (direct.length < buttons.length) {
    const rest = buttons.slice(direct.length);
    const more = stripeButton({ title: `Ещё плагины (${rest.length})`, icon: 'more', run() {} });
    more.classList.add('plugin-more');
    more.setAttribute('aria-haspopup', 'menu');
    more.setAttribute('aria-expanded', 'false');
    more.addEventListener('click', (e) => { e.stopPropagation(); if (menu && !menu.hidden) closeMenu(); else openMenu(more, rest); });
    s.appendChild(more);
  }
}
const layout = () => { if (!layoutFrame) layoutFrame = requestAnimationFrame(doLayout); };

function closeMenu() {
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  document.querySelector('.plugin-more')?.setAttribute('aria-expanded', 'false');
}

function openMenu(opener, entries) {
  if (!menu) {
    menu = document.createElement('div');
    menu.className = 'plugin-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Плагины');
    document.body.append(menu);
    document.addEventListener('mousedown', (e) => { if (!menu.hidden && !menu.contains(e.target) && !e.target.closest('.plugin-more')) closeMenu(); }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { closeMenu(); document.querySelector('.plugin-more')?.focus(); } });
    window.addEventListener('resize', closeMenu);
  }
  menu.replaceChildren(Object.assign(document.createElement('div'), { className: 'plugin-menu-title', textContent: 'Плагины' }));
  for (const entry of entries) {
    const item = document.createElement('button');
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    item.innerHTML = `${iconMarkup(entry.icon)}<span></span>`;
    item.querySelector('span').textContent = entry.title;
    item.addEventListener('mousedown', (e) => e.preventDefault());
    item.addEventListener('click', () => { closeMenu(); entry.run(); });
    menu.append(item);
  }
  const box = opener.getBoundingClientRect();
  menu.style.left = `${Math.round(box.right + 8)}px`;
  menu.style.bottom = `${Math.max(8, Math.round(innerHeight - box.bottom))}px`;
  menu.hidden = false;
  opener.setAttribute('aria-expanded', 'true');
  menu.querySelector('button')?.focus({ preventScroll: true });
}

// ───────────────────────── API handed to a plugin ─────────────────────────

function textEditor() {
  const tab = state.currentTabs[state.activeTabIndex];
  return isEditorTab(tab) ? document.getElementById('editor') : null;
}
function needEditor() {
  const area = textEditor();
  if (!area) throw new Error('Откройте текстовый файл: плагин работает с текстом в редакторе');
  return area;
}
const changed = (area) => area.dispatchEvent(new Event('input', { bubbles: true }));

function makeApi(file, run) {
  const track = (fn) => { run.cleanups.push(fn); };
  const storageKey = (key) => `frogee.plugin.${file}.${key}`;
  const editor = {
    get: () => textEditor()?.value ?? '',
    set(text) { const area = needEditor(); area.value = String(text); changed(area); },
    insert(text) {
      const area = needEditor();
      area.focus();
      area.setRangeText(String(text), area.selectionStart, area.selectionEnd, 'end');
      changed(area);
    },
    selection: () => { const area = textEditor(); return area ? area.value.slice(area.selectionStart, area.selectionEnd) : ''; },
    cursor: () => { const area = textEditor(); return area ? { from: area.selectionStart, to: area.selectionEnd } : { from: 0, to: 0 }; },
    replace(from, to, text) { const area = needEditor(); area.focus(); area.setRangeText(String(text), from, to, 'end'); changed(area); },
    // name, path and language of the open file (null when no text file is open)
    file: () => {
      const tab = state.currentTabs[state.activeTabIndex];
      return isEditorTab(tab) ? { name: tab.name, path: tab.filePath || null, extension: (/\.([^.\\/]+)$/.exec(tab.name || '') || [])[1] || '' } : null;
    },
  };
  const api = {
    version: 1,
    file,
    app: 'FrogeeCodeIDE',
    // CSS added to the page for as long as the plugin is on.
    addStyle(css) {
      const style = document.createElement('style');
      style.dataset.plugin = file;
      style.textContent = String(css);
      document.head.appendChild(style);
      track(() => style.remove());
    },
    // fn(previewElement) runs after every redraw of the Markdown preview.
    onPreview(fn) { run.preview.push(fn); },
    // fn(text) runs when the text in the editor changes.
    onChange(fn) { run.change.push(fn); },
    // fn(file) runs when another tab becomes active; file as in editor.file().
    onTabChange(fn) { run.tab.push(fn); },
    // A button on the left stripe. When there are more than fit, the rest move into a "…" menu.
    // icon: a built-in name (sparkles, edit, draw, calendar, history, clock, code, image, star, bolt, list) or SVG markup.
    addButton({ title, icon = 'sparkles', run: action }) {
      const entry = {
        file,
        title: String(title || file),
        icon,
        run: () => { try { action(editor); } catch (err) { console.error(`[plugin ${file}]`, err); toast(err.message || String(err)); } },
      };
      buttons.push(entry);
      layout();
      track(() => { buttons.splice(buttons.indexOf(entry), 1); layout(); });
    },
    editor,
    // Small private storage for the plugin.
    storage: {
      get(key, fallback) { try { const v = localStorage.getItem(storageKey(key)); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
      set(key, value) { try { localStorage.setItem(storageKey(key), JSON.stringify(value)); } catch { /* storage full */ } },
    },
    // A short message at the bottom of the window.
    notify(text) { toast(String(text)); },
    // fn() runs when the plugin is switched off or removed.
    onUnload: track,
  };
  return api;
}

async function start(file) {
  if (running.has(file)) return;
  const run = { cleanups: [], preview: [], change: [], tab: [], error: '' };
  running.set(file, run);
  try {
    const text = await window.electronAPI.readPlugin(file);
    const api = makeApi(file, run);
    if (/\.css$/i.test(file)) api.addStyle(text);
    else new Function('frogee', 'fgs', text)(api, api); // eslint-disable-line no-new-func
  } catch (err) {
    run.error = err?.message || String(err);
    console.error(`[plugin ${file}]`, err);
  }
}

function stop(file) {
  const run = running.get(file);
  if (!run) return;
  run.cleanups.forEach((fn) => { try { fn(); } catch { /* the plugin is leaving anyway */ } });
  running.delete(file);
}

function emit(kind, value) {
  running.forEach((run, file) => {
    for (const fn of run[kind] || []) { try { fn(value); } catch (err) { console.error(`[plugin ${file}]`, err); } }
  });
}

// ───────────────────────── settings → Плагины ─────────────────────────

async function files() {
  try { return (await window.electronAPI.getPlugins()).map((p) => p.file); } catch { return []; }
}

async function drawList() {
  const host = document.getElementById('plugins-list');
  if (!host) return;
  const on = enabledMap();
  const rows = await Promise.all((await files()).map(async (file) => {
    let info = { name: file, version: '', description: '', author: '' };
    try { info = parseMeta(await window.electronAPI.readPlugin(file), file); } catch { /* unreadable: listed by its name */ }
    const err = running.get(file)?.error;
    return `<div class="plugin-row" data-file="${escapeHtml(file)}">
      <div class="plugin-row-main">
        <div class="plugin-row-name">${escapeHtml(info.name)}${info.version ? ` <span>${escapeHtml(info.version)}</span>` : ''}</div>
        <div class="plugin-row-desc">${escapeHtml(info.description || file)}</div>
        ${err ? `<div class="plugin-row-error">${getLang() === 'en' ? 'Error' : 'Ошибка'}: ${escapeHtml(err)}</div>` : ''}
      </div>
      <button type="button" class="settings-btn ghost" data-act="remove">${armed === file ? 'Точно удалить?' : 'Удалить'}</button>
      <label class="plugin-switch" title="${on[file] ? 'Выключить' : 'Включить'}"><input type="checkbox" data-act="toggle" ${on[file] ? 'checked' : ''} aria-label="${getLang() === 'en' ? 'Enable plugin' : 'Включить плагин'} ${escapeHtml(info.name)}"><span aria-hidden="true"></span></label>
    </div>`;
  }));
  host.innerHTML = rows.join('') || '<p class="settings-hint">Плагинов пока нет. Нажмите «Установить…» и выберите файл .js или .css.</p>';
}
onLangChange(() => { if (document.getElementById('plugins-list')) drawList(); });

async function install() {
  const res = await window.electronAPI.installPlugins(getLang());
  for (const file of res?.installed || []) { setEnabled(file, true); stop(file); await start(file); }
  if (res?.error) alert(res.error);
  await drawList();
}

async function remove(file) {
  setEnabled(file, false);
  stop(file);
  await window.electronAPI.removePlugin(file);
  await drawList();
}

/** Plugins that came with an extension for FrogeeCodeIDE: switched on right after the extension is installed. */
export async function enablePluginFiles(list = []) {
  for (const file of list) { setEnabled(file, true); stop(file); await start(file); }
  await drawList();
}

/** The extension is being removed: its plugins stop first. */
export async function disablePluginFiles(list = []) {
  for (const file of list) { setEnabled(file, false); stop(file); }
  await drawList();
}

export async function setupPlugins() {
  const host = document.getElementById('settings-panel-plugins');
  host?.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'plugins-install-btn') await install();
    else if (b.id === 'plugins-open-btn') window.electronAPI.openPluginsFolder();
    else if (b.id === 'plugins-refresh-btn') await drawList();
    else if (b.dataset.act === 'remove') {
      const file = b.closest('.plugin-row').dataset.file;
      if (armed !== file) {
        armed = file;
        setTimeout(() => { if (armed === file) { armed = null; drawList(); } }, 3000);
        await drawList();
        return;
      }
      armed = null;
      await remove(file);
    }
  });
  host?.addEventListener('change', async (e) => {
    const box = e.target.closest('input[data-act="toggle"]');
    if (!box) return;
    const file = box.closest('.plugin-row').dataset.file;
    setEnabled(file, box.checked);
    if (box.checked) await start(file); else stop(file);
    await drawList();
  });
  document.querySelector('[data-settings-tab="plugins"]')?.addEventListener('click', drawList);

  // events plugins can follow
  document.getElementById('editor')?.addEventListener('input', (e) => emit('change', e.target.value));
  window.addEventListener('frogee:preview', (e) => emit('preview', e.detail));
  let lastTab = null;
  window.addEventListener('frogee:content', () => {
    const tab = state.currentTabs[state.activeTabIndex];
    if (tab === lastTab) return;
    lastTab = tab;
    emit('tab', isEditorTab(tab) ? { name: tab.name, path: tab.filePath || null } : null);
  });
  window.addEventListener('resize', layout);

  const on = enabledMap();
  for (const file of await files()) if (on[file]) await start(file);
  drawList();
}

window.FrogeePlugins = { files, running: () => [...running.keys()], parseMeta, install, remove };
