/**
 * The window frame in the IntelliJ / OpenIDEA layout:
 *   main toolbar   project widget, VCS branch, run configuration with Run and Debug, Search Everywhere, AI, settings
 *   left stripe    side views on top (Project, Search, Git, Structure, Run, Extensions), bottom tool windows at its foot
 *   right stripe   AI chat, Browser, Database, HTTP client, MCP
 *   bottom place   Problems, TODO, Debugger (the terminal keeps its own dock and takes turns with them)
 *   status bar     breadcrumbs on the left, caret, indent, encoding and language on the right
 * The developer tools that used to share one dock are spread over these places (see workbench.js).
 */
import { state } from './state.js';
import { getDom } from './dom.js';
import { getLang, onLangChange } from './i18n.js';
import { pathUtils, escapeHtml } from './utils.js';
import { isEditorTab } from './tab-model.js';
import { switchActivity, registerActivity, openFolder, openSearchFile, openSearchFileAtLine } from './explorer.js';
import { toggleChat } from './chat.js';
import { toggleTerminal, setTerminalVisible } from './terminal.js';
import { openBrowserTab } from './browser.js';
import { switchToTab, openTabInSplit } from './tabs.js';
import { isBrowserTab } from './tab-model.js';
import { problemItems } from './diagnostics.js';
import { extractSymbols, openSearchEverywhere, openPicker, runCurrentFile, setupDoubleShift, registerPaletteCommands } from './palette.js';
import { listConfigs, selectedConfig, selectConfig, openRunConfigDialog } from './run-configs.js';
import { recentPaletteItems } from './nav-extras.js';
import { bookmarkItems, toggleBookmark } from './bookmarks.js';
import { workbenchPanel, workbenchTitle, setWorkbenchOpener } from './workbench.js';

const dom = getDom();
const tr = (en, ru) => (getLang() === 'en' ? en : ru);
const LAYOUT_KEY = 'frogee.shell.v1';
const isMac = () => window.electronAPI?.platform === 'darwin';

const svg = (body, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON = {
  structure: '<path d="M4 5h6M4 12h6M4 19h6"/><path d="M14 5h6M16 12h4M16 19h4"/><path d="M14 5v14"/>',
  problems: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5.5M12 16.3v.2"/>',
  todo: '<path d="M5 6.5 6.6 8 9.5 5"/><path d="M5 12.5 6.6 14 9.5 11"/><path d="M5 18.5 6.6 20 9.5 17"/><path d="M13 7h6M13 13h6M13 19h6"/>',
  debug: '<rect x="7.5" y="8" width="9" height="11" rx="4.5"/><path d="M12 8V5.5M9.5 6l-1.5-2M14.5 6l1.5-2M7.5 12H4M20 12h-3.5M7.5 16.5 5 18.5M16.5 16.5l2.5 2"/>',
  database: '<ellipse cx="12" cy="6" rx="7" ry="2.8"/><path d="M5 6v12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6"/><path d="M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8"/>',
  http: '<path d="M4 8h13l-3.5-3.5"/><path d="M20 16H7l3.5 3.5"/>',
  mcp: '<path d="M9 3v4M15 3v4"/><rect x="6" y="7" width="12" height="6" rx="2"/><path d="M12 13v3a3 3 0 0 1-3 3H7"/>',
  run: '<path d="M7 4.5v15l12-7.5z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  bookmarks: '<path d="M6 4h12v16l-6-4-6 4z"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
  branch: '<circle cx="6" cy="6" r="2.2"/><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="8" r="2.2"/><path d="M6 8.2v7.6M18 10.2c0 3.5-4 4-9.8 5.6"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  refresh: '<path d="M19 12a7 7 0 1 1-2.05-4.95"/><path d="M19 4.5V8h-3.5"/>',
  file: '<path d="M6 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20z"/><path d="M14 3.5V8h4"/>',
};

let layout = loadLayout();
function loadLayout() {
  try { return { right: null, bottom: null, rightWidth: 380, bottomHeight: 260, ...JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}') }; }
  catch { return { right: null, bottom: null, rightWidth: 380, bottomHeight: 260 }; }
}
function saveLayout() { try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch { /* storage full */ } }

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html != null) node.innerHTML = html;
  return node;
}
function stripeButton(id, iconName, title) {
  const b = el('button', 'sidebar-btn', svg(ICON[iconName]));
  b.type = 'button';
  b.id = id;
  b.dataset.title = title;
  return b;
}
function setTitle(button, text, key) {
  const full = key ? `${text} (${key})` : text;
  button.title = full;
  button.setAttribute('aria-label', text);
}

// ───────────────────────── popup menu ─────────────────────────

let menu = null;
function closeMenu() {
  if (!menu) return;
  menu.owner?.setAttribute('aria-expanded', 'false');
  menu.remove();
  menu = null;
  document.removeEventListener('mousedown', outside, true);
  document.removeEventListener('keydown', menuKeys, true);
}
function outside(e) { if (menu && !menu.contains(e.target) && !menu.owner?.contains(e.target)) closeMenu(); }
function menuKeys(e) {
  if (!menu) return;
  const buttons = [...menu.querySelectorAll('button:not(:disabled)')];
  const i = buttons.indexOf(document.activeElement);
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); const owner = menu.owner; closeMenu(); owner?.focus(); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); buttons[(i + 1) % buttons.length]?.focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length]?.focus(); }
}
/** items: { label, detail?, icon?, checked?, disabled?, run } | '-' | { heading } */
function openMenu(owner, items, { align = 'left' } = {}) {
  if (menu?.owner === owner) { closeMenu(); return; }
  closeMenu();
  menu = el('div', 'shell-menu');
  menu.setAttribute('role', 'menu');
  menu.owner = owner;
  for (const item of items) {
    if (item === '-') { menu.append(el('div', 'shell-menu-sep')); continue; }
    if (item.heading) { menu.append(el('div', 'shell-menu-heading', escapeHtml(item.heading))); continue; }
    const b = el('button', `shell-menu-item${item.checked ? ' checked' : ''}`);
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.disabled = !!item.disabled;
    b.innerHTML = `<span class="shell-menu-icon">${item.icon ? svg(ICON[item.icon] || item.icon, 15) : ''}</span><span class="shell-menu-label">${escapeHtml(item.label)}</span>${item.detail ? `<span class="shell-menu-detail">${escapeHtml(item.detail)}</span>` : ''}`;
    b.addEventListener('click', () => { closeMenu(); item.run?.(); });
    menu.append(b);
  }
  document.body.append(menu);
  owner.setAttribute('aria-expanded', 'true');
  const r = owner.getBoundingClientRect();
  const w = menu.offsetWidth;
  const left = align === 'right' ? r.right - w : r.left;
  menu.style.left = `${Math.max(6, Math.min(left, window.innerWidth - w - 6))}px`;
  menu.style.top = `${r.bottom + 4}px`;
  menu.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
  setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
  document.addEventListener('keydown', menuKeys, true);
}

// ───────────────────────── main toolbar ─────────────────────────

let toolbar;
let gitInfo = { repo: false, branch: '' };

function projectColor(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
function initials(name) {
  const words = name.replace(/[-_.]+/g, ' ').split(/\s+|(?=[A-Z][a-z])/).filter(Boolean);
  return ((words[0]?.[0] || '?') + (words[1]?.[0] || words[0]?.[1] || '')).toUpperCase();
}

function buildToolbar() {
  toolbar = el('header', 'main-toolbar');
  toolbar.id = 'main-toolbar';
  toolbar.innerHTML = `
    <div class="mt-group mt-project-group">
      <button type="button" class="mt-widget" id="mt-project" aria-haspopup="menu" aria-expanded="false">
        <span class="mt-avatar"></span><span class="mt-text"></span><span class="mt-chevron">${svg(ICON.chevron, 14)}</span>
      </button>
      <button type="button" class="mt-widget" id="mt-vcs" aria-haspopup="menu" aria-expanded="false">
        <span class="mt-icon">${svg(ICON.branch, 16)}</span><span class="mt-text"></span><span class="mt-chevron">${svg(ICON.chevron, 14)}</span>
      </button>
    </div>
    <div class="mt-drag"></div>
    <div class="mt-group mt-run-group">
      <button type="button" class="mt-widget" id="mt-run-config" aria-haspopup="menu" aria-expanded="false">
        <span class="mt-icon">${svg(ICON.file, 16)}</span><span class="mt-text"></span><span class="mt-chevron">${svg(ICON.chevron, 14)}</span>
      </button>
      <button type="button" class="mt-tool mt-run" id="mt-run">${svg(ICON.run, 18)}</button>
      <button type="button" class="mt-tool mt-debug" id="mt-debug">${svg(ICON.debug, 18)}</button>
    </div>
    <span class="mt-sep" aria-hidden="true"></span>
    <div class="mt-group mt-utility-group">
      <button type="button" class="mt-tool" id="mt-search">${svg(ICON.search, 18)}</button>
    </div>`;
  const shell = document.getElementById('app-shell');
  shell.prepend(toolbar);

  // The settings gear moves from the stripe to the toolbar's end, where IntelliJ keeps it.
  const gear = document.getElementById('open-settings-btn');
  if (gear) {
    gear.classList.remove('sidebar-btn');
    gear.classList.add('mt-tool');
    toolbar.lastElementChild.append(gear);
  }

  toolbar.querySelector('#mt-project').addEventListener('click', (e) => openMenu(e.currentTarget, projectMenu()));
  toolbar.querySelector('#mt-vcs').addEventListener('click', async (e) => { const owner = e.currentTarget; openMenu(owner, await vcsMenu()); });
  toolbar.querySelector('#mt-run-config').addEventListener('click', (e) => openMenu(e.currentTarget, runMenu(), { align: 'right' }));
  toolbar.querySelector('#mt-run').addEventListener('click', () => runCurrentFile());
  toolbar.querySelector('#mt-debug').addEventListener('click', () => toggleBottom('debug'));
  toolbar.querySelector('#mt-search').addEventListener('click', () => openSearchEverywhere());
  paintToolbar();
}

function paintToolbar() {
  if (!toolbar) return;
  const folder = state.currentFolder;
  const name = folder ? pathUtils.basename(folder) : tr('No project', 'Без проекта');
  const project = toolbar.querySelector('#mt-project');
  project.querySelector('.mt-text').textContent = name;
  const avatar = project.querySelector('.mt-avatar');
  avatar.textContent = folder ? initials(name) : '·';
  avatar.style.setProperty('--hue', projectColor(name));
  setTitle(project, folder || tr('Open or create a project', 'Открыть или создать проект'));

  const vcs = toolbar.querySelector('#mt-vcs');
  vcs.hidden = !folder;
  vcs.querySelector('.mt-text').textContent = gitInfo.repo ? gitInfo.branch : tr('Version control', 'Контроль версий');
  setTitle(vcs, gitInfo.repo ? tr(`Branch ${gitInfo.branch}`, `Ветка ${gitInfo.branch}`) : tr('Set up Git', 'Подключить Git'));

  const cfg = selectedConfig();
  const tab = state.currentTabs[state.activeTabIndex];
  const runner = toolbar.querySelector('#mt-run-config');
  runner.querySelector('.mt-text').textContent = cfg ? cfg.name : (isEditorTab(tab) ? tab.name : tr('Current file', 'Текущий файл'));
  runner.querySelector('.mt-icon').innerHTML = svg(cfg ? ICON.run : ICON.file, 16);
  setTitle(runner, tr('Run configuration', 'Конфигурация запуска'));
  setTitle(toolbar.querySelector('#mt-run'), cfg ? tr(`Run “${cfg.name}”`, `Запустить «${cfg.name}»`) : tr('Run current file', 'Запустить текущий файл'), 'F5');
  setTitle(toolbar.querySelector('#mt-debug'), tr('Debugger', 'Отладчик'));
  setTitle(toolbar.querySelector('#mt-search'), tr('Search everywhere', 'Искать везде'), tr('Double Shift', 'Двойной Shift'));
  toolbar.querySelector('#mt-debug').classList.toggle('active', layout.bottom === 'debug');
  const gear = document.getElementById('open-settings-btn');
  if (gear) setTitle(gear, tr('Settings', 'Настройки'), isMac() ? '⌘,' : 'Ctrl+,');
}

let gitTimer = null;
async function refreshGit() {
  clearTimeout(gitTimer);
  const folder = state.currentFolder;
  if (!folder) { gitInfo = { repo: false, branch: '' }; paintToolbar(); return; }
  try {
    const res = await window.electronAPI.gitStatus(folder);
    if (folder !== state.currentFolder) return;
    gitInfo = res?.isRepo ? { repo: true, branch: res.branch || 'HEAD' } : { repo: false, branch: '' };
  } catch { gitInfo = { repo: false, branch: '' }; }
  paintToolbar();
}

function projectMenu() {
  const recent = recentPaletteItems().filter((it) => it.detail !== state.currentFolder).slice(0, 6);
  return [
    { label: tr('Open…', 'Открыть…'), icon: 'file', run: () => openFolder() },
    { label: tr('New project…', 'Новый проект…'), run: () => openToolDialog('project') },
    { label: tr('Remote project…', 'Удалённый проект…'), run: () => openToolDialog('remote') },
    { label: tr('New window', 'Новое окно'), run: () => window.electronAPI?.newWindow?.() },
    ...(recent.length ? ['-', { heading: tr('Recent projects', 'Недавние проекты') },
      ...recent.map((it) => ({ label: pathUtils.basename(it.detail) || it.detail, detail: it.detail.replace(/^\/Users\/[^/]+/, '~'), run: it.run }))] : []),
  ];
}

async function vcsMenu() {
  const folder = state.currentFolder;
  if (!gitInfo.repo) {
    return [{ label: tr('Create Git repository', 'Создать Git-репозиторий'), run: async () => { await window.electronAPI.gitInit(folder); refreshGit(); } }];
  }
  const res = await window.electronAPI.gitBranches(folder).catch(() => null);
  const branches = res?.branches || [];
  const git = (fn) => async () => { switchActivity('git'); await fn(folder); refreshGit(); };
  return [
    { label: tr('Commit…', 'Коммит…'), run: () => switchActivity('git') },
    { label: tr('Pull', 'Получить (pull)'), run: git(window.electronAPI.gitPull) },
    { label: tr('Push', 'Отправить (push)'), run: git(window.electronAPI.gitPush) },
    { label: tr('Fetch', 'Обновить ветки (fetch)'), run: git(window.electronAPI.gitFetch) },
    ...(branches.length ? ['-', { heading: tr('Local branches', 'Локальные ветки') }, ...branches.slice(0, 12).map((b) => ({
      label: b.name, icon: 'branch', checked: b.current, disabled: b.current,
      run: async () => {
        const out = await window.electronAPI.gitCheckout(folder, b.name, false);
        if (out && out.success === false) alert(out.error || tr('Checkout failed', 'Не удалось переключить ветку'));
        refreshGit();
      },
    }))] : []),
  ];
}

function runMenu() {
  const configs = listConfigs();
  const current = selectedConfig();
  return [
    { label: tr('Current file', 'Текущий файл'), icon: 'file', checked: !current, run: () => { selectConfig(null); paintToolbar(); } },
    ...configs.map((c) => ({ label: c.name, detail: c.command, icon: 'run', checked: current?.id === c.id, run: () => { selectConfig(c.id); paintToolbar(); } })),
    '-',
    ...(current ? [{ label: tr('Edit configuration…', 'Изменить конфигурацию…'), run: () => openRunConfigDialog(current) }] : []),
    { label: tr('New configuration…', 'Новая конфигурация…'), run: () => openRunConfigDialog() },
  ];
}

// ───────────────────────── stripes ─────────────────────────

const RIGHT_TOOLS = ['database', 'http', 'mcp'];
const BOTTOM_TOOLS = ['problems', 'todo', 'bookmarks', 'debug'];
const titles = {
  structure: () => tr('Structure', 'Структура'),
  problems: () => tr('Problems', 'Проблемы'),
  todo: () => 'TODO',
  bookmarks: () => tr('Bookmarks', 'Закладки'),
  debug: () => tr('Debugger', 'Отладчик'),
  database: () => tr('Database', 'База данных'),
  http: () => tr('HTTP client', 'HTTP-клиент'),
  mcp: () => tr('MCP tools', 'Инструменты MCP'),
};
const stripeButtons = new Map();

function buildStripes() {
  const left = document.getElementById('sidebar');
  left.querySelector('.sidebar-logo')?.remove();
  const debugBtn = document.getElementById('debug-btn');
  const structureBtn = stripeButton('structure-btn', 'structure');
  (debugBtn || document.getElementById('git-btn'))?.before(structureBtn);
  stripeButtons.set('structure', structureBtn);
  registerActivity('structure', structureBtn, showStructure);

  // Bottom tool windows sit at the foot of the left stripe next to the terminal, as in IntelliJ.
  const terminalBtn = document.getElementById('terminal-btn');
  for (const id of BOTTOM_TOOLS) {
    const b = stripeButton(`${id}-tool-btn`, id);
    b.addEventListener('click', () => toggleBottom(id));
    terminalBtn?.before(b);
    stripeButtons.set(id, b);
  }

  // Right stripe: the AI chat and the browser move here from the left one, then the right tool windows.
  const right = el('nav', 'right-stripe');
  right.id = 'right-stripe';
  for (const id of ['chat-btn', 'browser-btn']) {
    const b = document.getElementById(id);
    if (b) right.append(b);
  }
  right.append(el('div', 'sidebar-separator'));
  for (const id of RIGHT_TOOLS) {
    const b = stripeButton(`${id}-tool-btn`, id);
    b.addEventListener('click', () => toggleRight(id));
    right.append(b);
    stripeButtons.set(id, b);
  }
  document.getElementById('main-layout').append(right);
  // The browser button opens the browser beside the editor instead of a separate tab.
  const browserBtn = document.getElementById('browser-btn');
  if (browserBtn) {
    const fresh = browserBtn.cloneNode(true);
    browserBtn.replaceWith(fresh);
    fresh.addEventListener('click', toggleSideBrowser);
  }
  paintStripes();
}

function toggleSideBrowser() {
  const right = state.splitView ? state.currentTabs[state.rightTabIndex] : null;
  if (right && isBrowserTab(right)) {
    import('./tabs.js').then((m) => { m.setSplitView(false); m.updateTabsList(); });
    return;
  }
  const existing = state.currentTabs.findIndex((t) => isBrowserTab(t));
  if (existing >= 0) openTabInSplit(existing);
  else openBrowserTab('about:blank', { side: true });
  setTimeout(paintStripes, 50);
}

function paintStripes() {
  for (const [id, b] of stripeButtons) {
    setTitle(b, titles[id]());
    const on = id === 'structure' ? state.activityVisible !== false && state.currentActivity === 'structure'
      : RIGHT_TOOLS.includes(id) ? layout.right === id : layout.bottom === id;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  }
  const browserBtn = document.getElementById('browser-btn');
  if (browserBtn) {
    const right = state.splitView ? state.currentTabs[state.rightTabIndex] : null;
    browserBtn.classList.toggle('active', !!right && isBrowserTab(right));
  }
  document.getElementById('chat-btn')?.classList.toggle('active', !!state.chatVisible);
}

// ───────────────────────── right place ─────────────────────────

let rightHost;
let rightResizer;

function buildRight() {
  const main = document.getElementById('workspace-main');
  rightResizer = el('div', 'shell-resizer shell-resizer-v');
  rightResizer.hidden = true;
  rightHost = el('aside', 'tool-window panel-bubble');
  rightHost.id = 'right-tool';
  rightHost.hidden = true;
  rightHost.innerHTML = `<div class="tool-window-header"><h3></h3><div class="tool-window-actions"><button type="button" class="activity-btn" data-tw-close>${svg(ICON.close, 14)}</button></div></div><div class="tool-window-body"></div>`;
  rightHost.querySelector('[data-tw-close]').addEventListener('click', () => toggleRight(layout.right));
  main.append(rightResizer, rightHost);
  dragResize(rightResizer, 'x', () => layout.rightWidth, (v) => { layout.rightWidth = v; applySizes(); }, 280, () => window.innerWidth * 0.55);
}

function toggleRight(id) {
  if (!id) return;
  if (layout.right === id && !rightHost.hidden) showRight(null);
  else showRight(id);
}

function showRight(id) {
  layout.right = id;
  saveLayout();
  if (id && state.chatVisible) toggleChat(); // one window per side, as in IntelliJ
  rightHost.hidden = !id;
  rightResizer.hidden = !id;
  if (id) {
    rightHost.dataset.tool = id;
    rightHost.querySelector('h3').textContent = titles[id]();
    rightHost.querySelector('[data-tw-close]').title = tr('Hide', 'Скрыть');
    const body = rightHost.querySelector('.tool-window-body');
    body.replaceChildren(workbenchPanel(id));
    applySizes();
  }
  paintStripes();
}

// ───────────────────────── bottom place ─────────────────────────

let bottomHost;
let bottomResizer;

function buildBottom() {
  const dock = document.getElementById('terminal-dock');
  bottomResizer = el('div', 'shell-resizer shell-resizer-h');
  bottomResizer.hidden = true;
  bottomHost = el('section', 'tool-window tool-window-bottom panel-bubble');
  bottomHost.id = 'bottom-tool';
  bottomHost.hidden = true;
  bottomHost.innerHTML = `<div class="tool-window-header"><div class="tool-window-tabs" role="tablist"></div><div class="tool-window-actions"><button type="button" class="activity-btn" data-tw-bookmark hidden>${svg(ICON.add, 14)}</button><button type="button" class="activity-btn" data-tw-refresh>${svg(ICON.refresh, 14)}</button><button type="button" class="activity-btn" data-tw-close>${svg(ICON.close, 14)}</button></div></div><div class="tool-window-body"></div>`;
  bottomHost.querySelector('[data-tw-close]').addEventListener('click', () => showBottom(null));
  bottomHost.querySelector('[data-tw-refresh]').addEventListener('click', () => renderBottom(true));
  bottomHost.querySelector('[data-tw-bookmark]').addEventListener('click', () => toggleBookmark(true));
  bottomHost.querySelector('.tool-window-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tool]');
    if (tab) showBottom(tab.dataset.tool);
  });
  dock.before(bottomResizer, bottomHost);
  dragResize(bottomResizer, 'y', () => layout.bottomHeight, (v) => { layout.bottomHeight = v; applySizes(); }, 120, () => window.innerHeight * 0.7);
}

function toggleBottom(id) {
  if (layout.bottom === id && !bottomHost.hidden) showBottom(null);
  else showBottom(id);
}

function showBottom(id) {
  layout.bottom = id;
  saveLayout();
  if (id && state.terminalVisible && !state.terminalInEditor) setTerminalVisible(false, true);
  bottomHost.hidden = !id;
  bottomResizer.hidden = !id;
  if (id) renderBottom(false);
  applySizes();
  paintStripes();
  paintToolbar();
}

function renderBottom(force) {
  const id = layout.bottom;
  if (!id) return;
  const tabs = bottomHost.querySelector('.tool-window-tabs');
  tabs.innerHTML = BOTTOM_TOOLS.map((t) => `<button type="button" role="tab" class="tool-window-tab${t === id ? ' active' : ''}" aria-selected="${t === id}" data-tool="${t}">${escapeHtml(titles[t]())}<span class="tool-window-count" data-count="${t}"></span></button>`).join('');
  bottomHost.querySelector('[data-tw-refresh]').title = tr('Refresh', 'Обновить');
  bottomHost.querySelector('[data-tw-close]').title = tr('Hide', 'Скрыть');
  bottomHost.querySelector('[data-tw-refresh]').hidden = id === 'debug' || id === 'bookmarks';
  const addBookmark = bottomHost.querySelector('[data-tw-bookmark]');
  addBookmark.hidden = id !== 'bookmarks';
  setTitle(addBookmark, tr('Bookmark current line', 'Добавить закладку на текущей строке'));
  const body = bottomHost.querySelector('.tool-window-body');
  if (id === 'debug') body.replaceChildren(workbenchPanel('dap'));
  if (id === 'problems') renderProblems(body);
  if (id === 'todo') renderTodo(body, force);
  if (id === 'bookmarks') renderBookmarks(body);
  paintCounts();
}

function renderBookmarks(body) {
  const items = bookmarkItems();
  if (!items.length) {
    body.replaceChildren(el('div', 'tool-empty', tr('Add a bookmark from a file with Cmd/Ctrl+F2.', 'Добавьте закладку в файле через Cmd/Ctrl+F2.')));
    return;
  }
  const list = el('div', 'tool-list');
  for (const item of items) {
    const row = el('div', 'tool-row');
    const open = el('button', 'tool-row-main');
    open.type = 'button';
    open.title = item.detail;
    open.append(el('span', 'tool-row-label', escapeHtml(item.label)),
      el('span', 'tool-row-detail bookmark-path', escapeHtml(pathUtils.dirname(item.detail))));
    open.addEventListener('click', item.run);
    const remove = el('button', 'activity-btn bookmark-remove', svg(ICON.close, 13));
    remove.type = 'button';
    setTitle(remove, tr('Remove bookmark', 'Удалить закладку'));
    remove.addEventListener('click', item.remove);
    row.append(open, remove);
    list.append(row);
  }
  body.replaceChildren(list);
}

function paintCounts() {
  const count = problemItems().length;
  bottomHost?.querySelector('[data-count="problems"]')?.replaceChildren(count ? String(count) : '');
  const b = stripeButtons.get('problems');
  if (b) b.dataset.badge = count ? String(Math.min(count, 99)) : '';
}

function renderProblems(body) {
  const items = problemItems();
  const tab = state.currentTabs[state.activeTabIndex];
  if (!items.length) {
    body.innerHTML = `<div class="tool-empty">${escapeHtml(isEditorTab(tab) ? tr(`No problems in ${tab.name}`, `В файле ${tab.name} проблем нет`) : tr('Open a file to see its problems', 'Откройте файл, чтобы увидеть проблемы'))}</div>`;
    return;
  }
  body.innerHTML = `<div class="tool-list-head">${escapeHtml(tab?.name || '')}</div><div class="tool-list"></div>`;
  const list = body.querySelector('.tool-list');
  items.forEach((it) => {
    const row = el('div', `tool-row problem-row${/ошибка|error/.test(it.detail) ? ' is-error' : ' is-warning'}`);
    row.innerHTML = `<span class="tool-row-dot"></span><button type="button" class="tool-row-main"><span class="tool-row-label"></span><span class="tool-row-detail"></span></button><button type="button" class="tool-row-action">${escapeHtml(tr('Ask AI', 'Спросить ИИ'))}</button>`;
    row.querySelector('.tool-row-label').textContent = it.label;
    row.querySelector('.tool-row-detail').textContent = it.detail;
    row.querySelector('.tool-row-main').addEventListener('click', it.run);
    row.querySelector('.tool-row-action').addEventListener('click', () => askAiAbout(it, tab));
    list.append(row);
  });
}

function askAiAbout(problem, tab) {
  it_run(problem);
  if (!state.chatVisible) toggleChat();
  const input = dom.userInput || document.getElementById('user-input');
  if (!input) return;
  input.value = tr(`How do I fix this problem in ${tab?.name || 'the file'} (${problem.detail})?\n${problem.label}`,
    `Как исправить проблему в ${tab?.name || 'файле'} (${problem.detail})?\n${problem.label}`);
  input.dispatchEvent(new Event('input'));
  input.focus();
}
function it_run(item) { try { item.run(); } catch { /* the line may be gone */ } }

let todoCache = { folder: null, items: [] };
async function renderTodo(body, force) {
  const folder = state.currentFolder;
  if (!folder) { body.innerHTML = `<div class="tool-empty">${escapeHtml(tr('Open a project folder to collect TODO notes', 'Откройте папку проекта, чтобы собрать заметки TODO'))}</div>`; return; }
  if (force || todoCache.folder !== folder) {
    body.innerHTML = `<div class="tool-empty">${escapeHtml(tr('Searching…', 'Поиск…'))}</div>`;
    // Only notes in comments (// # /* * <!-- --), one row per line.
    const res = await window.electronAPI.searchInFiles(folder, '(?://|#|/\\*|^\\s*\\*|<!--|--|;)\\s*(TODO|FIXME|HACK|XXX)\\b', { useRegex: true, caseSensitive: true }).catch(() => null);
    todoCache = { folder, items: (res?.results || []).map((f) => ({ ...f, matches: f.matches.filter((m, i, all) => all.findIndex((x) => x.line === m.line) === i) })) };
    if (layout.bottom !== 'todo') return;
  }
  const files = todoCache.items;
  const total = files.reduce((n, f) => n + f.matches.length, 0);
  bottomHost.querySelector('[data-count="todo"]')?.replaceChildren(total ? String(total) : '');
  if (!total) { body.innerHTML = `<div class="tool-empty">${escapeHtml(tr('No TODO, FIXME or HACK notes', 'Заметок TODO, FIXME и HACK нет'))}</div>`; return; }
  body.innerHTML = '<div class="tool-list"></div>';
  const list = body.firstChild;
  for (const file of files) {
    const head = el('div', 'tool-list-head');
    head.textContent = `${file.file} · ${file.matches.length}`;
    list.append(head);
    for (const m of file.matches) {
      const row = el('button', 'tool-row todo-row');
      row.type = 'button';
      const tag = (/\b(TODO|FIXME|HACK|XXX)\b/.exec(m.text) || [])[1] || 'TODO';
      row.innerHTML = `<span class="todo-tag" data-tag="${tag}">${tag}</span><span class="tool-row-label"></span><span class="tool-row-detail">${m.line}</span>`;
      row.querySelector('.tool-row-label').textContent = m.text.replace(/^.*?\b(TODO|FIXME|HACK|XXX)\b[:\s-]*/, '').trim() || m.text.trim();
      row.addEventListener('click', () => openSearchFileAtLine(file.fullPath, m.line));
      list.append(row);
    }
  }
}

// ───────────────────────── Structure (left) ─────────────────────────

let structureFilter = '';

function showStructure() {
  const panel = dom.activityPanel;
  panel.innerHTML = `
    <div class="activity-header"><h3>${escapeHtml(titles.structure())}</h3></div>
    <div class="structure-panel">
      <input type="search" class="settings-input structure-filter" placeholder="${escapeHtml(tr('Filter symbols', 'Фильтр символов'))}" spellcheck="false">
      <div class="structure-list" role="tree"></div>
      <details class="structure-lsp">
        <summary>${escapeHtml(workbenchTitle('lsp'))}<span>${escapeHtml(tr('definition, references, rename', 'определение, ссылки, переименование'))}</span></summary>
      </details>
    </div>`;
  const filter = panel.querySelector('.structure-filter');
  filter.value = structureFilter;
  filter.addEventListener('input', () => { structureFilter = filter.value; paintStructure(); });
  panel.querySelector('.structure-lsp').append(workbenchPanel('lsp'));
  if (layout.lspOpen) panel.querySelector('.structure-lsp').open = true;
  panel.querySelector('.structure-lsp').addEventListener('toggle', (e) => { layout.lspOpen = e.target.open; saveLayout(); });
  paintStructure();
}

function paintStructure() {
  if (state.currentActivity !== 'structure' || state.activityVisible === false) return;
  const list = dom.activityPanel.querySelector('.structure-list');
  if (!list) return;
  const tab = state.currentTabs[state.activeTabIndex];
  if (!isEditorTab(tab)) { list.innerHTML = `<div class="tool-empty">${escapeHtml(tr('Open a source file', 'Откройте файл с кодом'))}</div>`; return; }
  const editor = dom.editor;
  const symbols = extractSymbols(editor?.value || '', tab.name);
  const q = structureFilter.trim().toLowerCase();
  const shown = q ? symbols.filter((s) => s.search.toLowerCase().includes(q)) : symbols;
  if (!shown.length) {
    list.innerHTML = `<div class="tool-empty">${escapeHtml(symbols.length ? tr('Nothing matches the filter', 'Под фильтр ничего не подходит') : tr(`No symbols in ${tab.name}`, `В ${tab.name} нет символов`))}</div>`;
    return;
  }
  const caretLine = editor ? editor.value.slice(0, editor.selectionStart).split('\n').length : 0;
  let currentIndex = -1;
  shown.forEach((s, i) => { if (Number(s.detail.split('·').pop()) <= caretLine) currentIndex = i; });
  list.innerHTML = '';
  shown.forEach((s, i) => {
    const [kind, line] = s.detail.split('·').map((x) => x.trim());
    const depth = (/^\s*/.exec(s.label)[0].length / 2) | 0;
    const row = el('button', `structure-row${i === currentIndex ? ' current' : ''}`);
    row.type = 'button';
    row.setAttribute('role', 'treeitem');
    row.style.setProperty('--depth', depth);
    row.innerHTML = `<span class="structure-kind" data-kind="${escapeHtml(kind)}">${escapeHtml(kindLetter(kind))}</span><span class="structure-name"></span><span class="structure-line">${escapeHtml(line)}</span>`;
    row.querySelector('.structure-name').textContent = s.label.trim();
    row.addEventListener('click', () => { s.run(); dom.editor?.focus(); });
    list.append(row);
  });
}
const kindLetter = (kind) => ({ class: 'C', type: 'T', impl: 'I', function: 'ƒ', fn: 'ƒ', func: 'ƒ', def: 'ƒ', method: 'm', rule: '#', h: 'H' })[kind] || kind[0]?.toUpperCase() || '·';

// ───────────────────────── dialogs (New project, Remote project) ─────────────────────────

function openToolDialog(key) {
  document.querySelector('.tool-dialog-overlay')?.remove();
  const overlay = el('div', 'modal-overlay tool-dialog-overlay');
  overlay.style.display = 'flex';
  overlay.innerHTML = `<div class="modal-window tool-dialog" role="dialog" aria-modal="true"><div class="rc-head"><h2></h2><button type="button" class="icon-btn" data-close>${svg(ICON.close, 14)}</button></div><div class="tool-dialog-body"></div></div>`;
  overlay.querySelector('h2').textContent = workbenchTitle(key);
  overlay.querySelector('[role=dialog]').setAttribute('aria-label', workbenchTitle(key));
  overlay.querySelector('[data-close]').title = tr('Close', 'Закрыть');
  overlay.querySelector('.tool-dialog-body').append(workbenchPanel(key));
  const close = () => { overlay.remove(); document.removeEventListener('keydown', esc, true); };
  const esc = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-close]').addEventListener('click', close);
  document.addEventListener('keydown', esc, true);
  document.body.append(overlay);
  overlay.querySelector('input, select, button:not([data-close])')?.focus();
}

/** Where each developer tool opens now. */
function openTool(key, { preserveFocus } = {}) {
  if (key === 'project' || key === 'remote') { openToolDialog(key); return; }
  if (key === 'lsp') {
    switchActivity('structure');
    const details = dom.activityPanel.querySelector('.structure-lsp');
    if (details) details.open = true;
    return;
  }
  if (key === 'dap') { if (layout.bottom !== 'debug') showBottom('debug'); return; }
  showRight(key);
  if (!preserveFocus) rightHost.querySelector('input, select, textarea')?.focus({ preventScroll: true });
}

// ───────────────────────── Recent files (Cmd/Ctrl+E) ─────────────────────────

const recentFiles = [];
const RECENT_FILES_KEY = 'frogee.recentFiles.v1';
let lastRecentFile = null;

function readRecentFiles() {
  try {
    const records = JSON.parse(localStorage.getItem(RECENT_FILES_KEY));
    return Array.isArray(records) ? records : [];
  } catch { return []; }
}

function trackRecent() {
  const tab = state.currentTabs[state.splitView && state.focusedPane === 'right' ? state.rightTabIndex : state.activeTabIndex];
  if (!tab || tab.kind === 'terminal') return;
  const key = tab.filePath || tab.id;
  const i = recentFiles.indexOf(key);
  if (i !== 0) {
    if (i > 0) recentFiles.splice(i, 1);
    recentFiles.unshift(key);
    recentFiles.length = Math.min(recentFiles.length, 30);
  }
  if (!tab.filePath) return;
  const folder = state.currentFolder || '';
  if (folder && recentFileDetail(tab.filePath) === tab.filePath) return;
  if (lastRecentFile?.path === tab.filePath && lastRecentFile.folder === folder) return;
  lastRecentFile = { folder, path: tab.filePath };
  const records = readRecentFiles();
  if (records[0]?.path === tab.filePath && records[0]?.folder === folder) return;
  const next = [lastRecentFile, ...records.filter((item) => item.folder !== folder || item.path !== tab.filePath)];
  try { localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(next.slice(0, 100))); } catch { /* Storage full. */ }
}

function recentFileDetail(filePath) {
  const root = state.currentFolder;
  if (!root) return filePath;
  const normalizedRoot = root.replace(/[\\/]+$/, '');
  return filePath.startsWith(normalizedRoot + '/') || filePath.startsWith(normalizedRoot + '\\')
    ? filePath.slice(normalizedRoot.length + 1) : filePath;
}

function openRecentFiles() {
  const windows = [
    ['explorer', tr('Project', 'Проект'), () => switchActivity('explorer')],
    ['structure', titles.structure(), () => switchActivity('structure')],
    ['git', 'Git', () => switchActivity('git')],
    ['problems', titles.problems(), () => showBottom('problems')],
    ['todo', 'TODO', () => showBottom('todo')],
    ['terminal', tr('Terminal', 'Терминал'), () => toggleTerminal()],
    ['chat', tr('AI chat', 'AI-чат'), () => { if (!state.chatVisible) toggleChat(); }],
    ['database', titles.database(), () => showRight('database')],
    ['http', titles.http(), () => showRight('http')],
  ].map(([id, label, run]) => ({ kind: 'window', label, search: label, run }));
  const openTabs = new Map(state.currentTabs.flatMap((tab, index) => tab.kind === 'terminal' ? [] : [[tab.filePath || tab.id, index]]));
  const recentPaths = readRecentFiles().filter((item) => item.folder === (state.currentFolder || '')).map((item) => item.path);
  const keys = [...new Set([...recentFiles.filter((key) => openTabs.has(key)), ...recentPaths, ...openTabs.keys()])];
  const current = state.currentTabs[state.activeTabIndex];
  const activeKey = current?.filePath || current?.id;
  const files = [...keys.filter((key) => key !== activeKey), ...keys.filter((key) => key === activeKey)].map((key) => {
    const tab = state.currentTabs[openTabs.get(key)];
    const filePath = tab ? tab.filePath : key;
    const label = tab?.name || pathUtils.basename(filePath);
    const detail = filePath ? recentFileDetail(filePath) : '';
    const run = () => {
      const index = tab ? state.currentTabs.indexOf(tab) : -1;
      if (index >= 0) switchToTab(index);
      else if (filePath) openSearchFile(filePath);
    };
    return { kind: tab ? 'tab' : 'file', label, detail, search: `${label} ${detail}`, run };
  });
  openPicker(tr('Recent files and tool windows', 'Недавние файлы и окна инструментов'), [...files, ...windows],
    tr('Cmd/Ctrl+E · Enter opens', 'Cmd/Ctrl+E · Enter открывает'));
}

// ───────────────────────── status bar ─────────────────────────

function buildStatusBar() {
  const left = document.querySelector('#status-bar .status-left');
  const right = document.querySelector('#status-bar .status-right');
  const crumbs = document.getElementById('breadcrumbs');
  if (left && crumbs) {
    crumbs.classList.add('status-crumbs');
    left.prepend(crumbs);
  }
  document.getElementById('status-file')?.setAttribute('hidden', '');
  const cursor = document.getElementById('status-cursor');
  const encoding = document.getElementById('status-encoding');
  if (right && cursor && encoding) {
    encoding.before(cursor);
    const indent = el('span', 'status-indent');
    indent.id = 'status-indent';
    encoding.before(indent);
  }
  document.getElementById('status-terminal-btn')?.setAttribute('hidden', '');
  paintStatus();
}

function paintStatus() {
  const indent = document.getElementById('status-indent');
  if (indent) {
    const size = Number(dom.tabSizeSelect?.value || state.tabSize || 4);
    indent.textContent = tr(`${size} spaces`, `${size} ${size === 1 ? 'пробел' : size < 5 ? 'пробела' : 'пробелов'}`);
    indent.hidden = !isEditorTab(state.currentTabs[state.activeTabIndex]);
  }
  // Breadcrumbs take the file name's place in the status bar.
  const crumbs = document.getElementById('breadcrumbs');
  const file = document.getElementById('status-file');
  if (crumbs && file) file.hidden = !crumbs.hidden;
}

// ───────────────────────── sizes ─────────────────────────

function applySizes() {
  const root = document.documentElement.style;
  root.setProperty('--right-tool-w', `${Math.round(layout.rightWidth)}px`);
  root.setProperty('--bottom-tool-h', `${Math.round(layout.bottomHeight)}px`);
}

function dragResize(handle, axis, get, set, min, max) {
  let drag = null;
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;
    drag = { from: axis === 'x' ? e.clientX : e.clientY, size: get(), scale };
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    document.body.classList.add('resizing');
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const pos = axis === 'x' ? e.clientX : e.clientY;
    set(Math.max(min, Math.min(max() / drag.scale, drag.size + (drag.from - pos) / drag.scale)));
  });
  const end = () => {
    if (!drag) return;
    drag = null;
    handle.classList.remove('dragging');
    document.body.classList.remove('resizing');
    saveLayout();
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('lostpointercapture', end);
}

// ───────────────────────── welcome and chat hooks ─────────────────────────

function hookWelcome() {
  const after = document.getElementById('new-file-action');
  if (!after || document.querySelector('.welcome-new-project')) return;
  const action = el('button', 'action-item welcome-new-project');
  action.type = 'button';
  action.innerHTML = `<div class="action-icon">${svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10v6M9 13h6"/>', 18)}</div><div class="action-text"><div class="action-title"></div><div class="action-description"></div></div>`;
  const paint = () => {
    action.querySelector('.action-title').textContent = tr('New project…', 'Новый проект…');
    action.querySelector('.action-description').textContent = tr('From a template: web, Node.js, Python and more', 'Из шаблона: сайт, Node.js, Python и другие');
  };
  paint();
  onLangChange(paint);
  action.addEventListener('click', () => openToolDialog('project'));
  after.after(action);

}

function hookChatTools() {
  const before = document.querySelector('.composer-right');
  if (before) {
    const mcp = el('button', 'composer-chip chat-mcp-btn', svg(ICON.mcp, 13) + '<span>MCP</span>');
    mcp.type = 'button';
    const t = () => { mcp.title = titles.mcp(); mcp.setAttribute('aria-label', titles.mcp()); };
    t();
    onLangChange(t);
    mcp.addEventListener('click', () => showRight('mcp'));
    before.before(mcp);
  }
}

// ───────────────────────── setup ─────────────────────────

export function setupIdeShell() {
  if (toolbar) return;
  const shell = document.getElementById('app-shell');
  shell?.classList.add('ide-shell');
  if (isMac()) {
    shell?.classList.add('platform-mac');
    if (window.electronAPI.titlebarHeight > 0) shell?.style.setProperty('--native-titlebar-height', window.electronAPI.titlebarHeight + 'px');
  }
  buildToolbar();
  buildStripes();
  buildRight();
  buildBottom();
  buildStatusBar();
  hookWelcome();
  hookChatTools();
  applySizes();
  setWorkbenchOpener(openTool);
  setupDoubleShift();

  // Restore what was open.
  if (layout.right && RIGHT_TOOLS.includes(layout.right)) showRight(layout.right);
  if (layout.bottom && BOTTOM_TOOLS.includes(layout.bottom)) showBottom(layout.bottom);

  // Keep the chat and terminal in turn with the right and bottom places.
  const chat = document.getElementById('chat-panel');
  if (chat) new MutationObserver(() => {
    const visible = chat.style.display !== 'none';
    if (visible && layout.right) showRight(null);
    paintStripes();
    paintToolbar();
  }).observe(chat, { attributes: true, attributeFilter: ['style'] });
  const terminal = document.getElementById('terminal-panel');
  if (terminal) new MutationObserver(() => {
    if (terminal.style.display !== 'none' && state.terminalVisible && layout.bottom) showBottom(null);
  }).observe(terminal, { attributes: true, attributeFilter: ['style'] });

  let frame = 0;
  const onContent = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      trackRecent();
      paintToolbar();
      paintStatus();
      paintStructure();
      paintStripes();
      if (layout.bottom === 'problems') renderBottom(false);
      else paintCounts();
    });
  };
  window.addEventListener('frogee:content', onContent);
  window.addEventListener('frogee:ext-diagnostics', onContent);
  window.addEventListener('frogee:activity', paintStripes);
  for (const event of ['frogee:bookmarks', 'frogee:workspace']) {
    window.addEventListener(event, () => {
      if (layout.bottom === 'bookmarks') renderBookmarks(bottomHost.querySelector('.tool-window-body'));
    });
  }
  window.addEventListener('frogee:title', () => {
    onContent();
    refreshGit();
    if (todoCache.folder !== state.currentFolder) { todoCache.folder = null; if (layout.bottom === 'todo') renderBottom(false); }
  });
  window.addEventListener('focus', () => { gitTimer = setTimeout(refreshGit, 200); });
  document.addEventListener('selectionchange', () => {
    if (document.activeElement === dom.editor && state.currentActivity === 'structure') onContent();
  });
  document.addEventListener('keydown', (e) => {
    const mod = isMac() ? e.metaKey : e.ctrlKey;
    if (mod && !e.shiftKey && !e.altKey && (e.key === 'e' || e.key === 'E')) { e.preventDefault(); openRecentFiles(); }
    if (mod && !e.shiftKey && e.altKey && (e.code === 'Digit6')) { e.preventDefault(); toggleBottom('problems'); }
    if (mod && !e.shiftKey && e.key === ',') { e.preventDefault(); document.getElementById('open-settings-btn')?.click(); }
    if (e.altKey && !mod && !e.shiftKey && e.code === 'Digit7') { e.preventDefault(); switchActivity('structure', { toggle: true }); }
  });
  onLangChange(() => {
    paintToolbar();
    paintStripes();
    paintStatus();
    if (layout.right) rightHost.querySelector('h3').textContent = titles[layout.right]();
    if (layout.bottom) renderBottom(false);
  });
  refreshGit();
  registerPaletteCommands(() => [
    { label: tr('Search everywhere', 'Искать везде'), key: tr('Double Shift', 'Двойной Shift'), run: () => openSearchEverywhere() },
    { label: tr('View: recent files', 'Вид: недавние файлы'), key: 'Ctrl+E', run: openRecentFiles },
    { label: tr('View: structure', 'Вид: структура'), key: 'Alt+7', run: () => switchActivity('structure') },
    { label: tr('View: problems', 'Вид: проблемы'), key: 'Ctrl+Alt+6', run: () => showBottom('problems') },
    { label: tr('View: TODO', 'Вид: TODO'), run: () => showBottom('todo') },
    { label: tr('View: debugger', 'Вид: отладчик'), run: () => showBottom('debug') },
    { label: tr('View: code navigation (language server)', 'Вид: навигация по коду (языковой сервер)'), run: () => openTool('lsp') },
    { label: tr('View: database', 'Вид: база данных'), run: () => showRight('database') },
    { label: tr('View: HTTP client', 'Вид: HTTP-клиент'), run: () => showRight('http') },
    { label: tr('View: MCP tools', 'Вид: инструменты MCP'), run: () => showRight('mcp') },
    { label: tr('Project: new project…', 'Проект: новый проект…'), run: () => openToolDialog('project') },
    { label: tr('Project: remote project…', 'Проект: удалённый проект…'), run: () => openToolDialog('remote') },
  ]);
}
