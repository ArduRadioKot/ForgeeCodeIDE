/**
 * Built-in browser: a tab kind backed by one persistent <webview> per tab.
 * Views stay alive while hidden so pages keep their state when you switch tabs.
 */
import { state } from './state.js';
import { escapeHtml } from './utils.js';
import { saveAllConfig } from './save-hook.js';
import { isBrowserTab } from './tab-model.js';
import { updateTabsList, updateTabTitle, switchToTab, hideWelcomePage, openTabInSplit, setSplitView, setFocusedPane, isBrowserSplit } from './tabs-api.js';
import { isEditorTab, isNotebookTab } from './tab-model.js';

const views = new Map(); // tab.id -> view
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const DEVICES = {
  responsive: { label: 'Адаптивный', w: 0, h: 0 },
  phone: { label: 'Телефон 390×844', w: 390, h: 844, ua: MOBILE_UA },
  tablet: { label: 'Планшет 820×1180', w: 820, h: 1180, ua: MOBILE_UA },
  laptop: { label: 'Ноутбук 1280×800', w: 1280, h: 800 },
};

const ICON = {
  back: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.5 5.5 8l4.5 4.5"/></svg>',
  forward: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5 10.5 8 6 12.5"/></svg>',
  reload: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.8v2.6h-2.6"/></svg>',
  stop: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg>',
  console: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="3" width="11" height="10" rx="2"/><path d="m5.5 7 1.8 1.5L5.5 10M9 10h2"/></svg>',
  devtools: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5.5 4.5-3 3.5 3 3.5M10.5 4.5l3 3.5-3 3.5M9 3.5 7 12.5"/></svg>',
  split: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="3" width="11" height="10" rx="2"/><path d="M8 3v10"/></svg>',
  external: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 3h3.5v3.5M13 3 7.5 8.5M11 9.5V12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2.5"/></svg>',
};

export function getBrowserHost() {
  return document.getElementById('browser-host');
}

export function createBrowserTab(url = 'about:blank', name = '') {
  return { id: Date.now() + Math.random(), kind: 'browser', name: name || 'Новая вкладка', url, content: url, filePath: null, modified: false };
}

export function normalizeUrl(input) {
  const v = String(input || '').trim();
  if (!v) return 'about:blank';
  if (/^(https?|file):\/\//i.test(v) || v === 'about:blank') return v;
  if (/^\d{2,5}$/.test(v)) return `http://127.0.0.1:${v}`;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(v)) return `http://${v}`;
  if (!/\s/.test(v) && /^[\w-]+(\.[\w-]+)+(:\d+)?([/?#].*)?$/.test(v)) return `https://${v}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(v)}`;
}

export function applyBrowserSurface(show) {
  const host = getBrowserHost();
  if (!host) return;
  if (show) {
    host.style.display = 'flex';
    for (const id of ['editor-container', 'editor-container-right', 'split-resizer', 'terminal-editor-host', 'notebook-host']) {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    }
  } else {
    host.style.display = 'none';
  }
}

function buildView(tab) {
  const el = document.createElement('div');
  el.className = 'browser-view';
  el.innerHTML = `
    <div class="browser-bar">
      <button type="button" class="browser-btn" data-act="back" title="Назад (Alt+←)" disabled>${ICON.back}</button>
      <button type="button" class="browser-btn" data-act="forward" title="Вперёд (Alt+→)" disabled>${ICON.forward}</button>
      <button type="button" class="browser-btn" data-act="reload" title="Обновить">${ICON.reload}</button>
      <input class="browser-url" type="text" spellcheck="false" placeholder="Адрес сайта, порт (5500) или поисковый запрос" />
      <select class="browser-device" title="Размер окна">${Object.entries(DEVICES).map(([k, d]) => `<option value="${k}">${d.label}</option>`).join('')}</select>
      <button type="button" class="browser-btn" data-act="console" title="Консоль страницы">${ICON.console}<span class="browser-badge" hidden></span></button>
      <button type="button" class="browser-btn" data-act="devtools" title="Инструменты разработчика">${ICON.devtools}</button>
      <button type="button" class="browser-btn" data-act="split" title="Показать рядом с редактором">${ICON.split}</button>
      <button type="button" class="browser-btn" data-act="external" title="Открыть в системном браузере">${ICON.external}</button>
    </div>
    <div class="browser-progress"></div>
    <div class="browser-stage"><webview class="browser-webview" partition="persist:frogee-browser"></webview>
      <div class="browser-error" hidden></div></div>
    <div class="browser-console" hidden>
      <div class="browser-console-head"><span>Консоль</span><button type="button" class="browser-btn" data-act="console-clear" title="Очистить">${ICON.stop}</button></div>
      <div class="browser-console-lines"></div>
    </div>`;

  const view = { tab, el, wv: el.querySelector('webview'), ready: false, device: 'responsive', logs: 0, errors: 0 };
  const urlInput = el.querySelector('.browser-url');
  const errorBox = el.querySelector('.browser-error');
  const badge = el.querySelector('.browser-badge');
  const consoleBox = el.querySelector('.browser-console');
  const lines = el.querySelector('.browser-console-lines');

  const syncNav = () => {
    if (!view.ready) return;
    el.querySelector('[data-act="back"]').disabled = !view.wv.canGoBack();
    el.querySelector('[data-act="forward"]').disabled = !view.wv.canGoForward();
  };
  const setLoading = (on) => {
    el.classList.toggle('loading', on);
    el.querySelector('[data-act="reload"]').innerHTML = on ? ICON.stop : ICON.reload;
    el.querySelector('[data-act="reload"]').title = on ? 'Остановить' : 'Обновить';
  };
  const setUrl = (url) => {
    if (!url || url === 'about:blank') return;
    tab.url = url;
    tab.content = url;
    if (document.activeElement !== urlInput) urlInput.value = url;
    saveAllConfig();
  };
  view.navigate = (raw) => {
    const url = normalizeUrl(raw);
    errorBox.hidden = true;
    tab.url = url;
    tab.content = url;
    urlInput.value = url === 'about:blank' ? '' : url;
    if (view.ready) view.wv.loadURL(url).catch(() => {});
    else view.wv.setAttribute('src', url);
  };
  view.applyDevice = (key) => {
    view.device = key;
    const d = DEVICES[key];
    const stage = el.querySelector('.browser-stage');
    stage.classList.toggle('framed', !!d.w);
    view.wv.style.width = d.w ? `${d.w}px` : '';
    view.wv.style.height = d.h ? `${d.h}px` : '';
    if (view.ready) {
      view.wv.setUserAgent(d.ua || '');
      view.wv.reload();
    } else if (d.ua) {
      view.wv.setAttribute('useragent', d.ua);
    }
  };

  const wv = view.wv;
  wv.addEventListener('dom-ready', () => {
    view.ready = true;
    syncNav();
  });
  wv.addEventListener('did-start-loading', () => { setLoading(true); errorBox.hidden = true; });
  wv.addEventListener('did-stop-loading', () => { setLoading(false); syncNav(); });
  wv.addEventListener('did-navigate', (e) => { setUrl(e.url); syncNav(); });
  wv.addEventListener('did-navigate-in-page', (e) => { if (e.isMainFrame) { setUrl(e.url); syncNav(); } });
  wv.addEventListener('page-title-updated', (e) => {
    tab.name = (e.title || tab.url || 'Браузер').slice(0, 40);
    updateTabsList();
    updateTabTitle();
  });
  wv.addEventListener('did-fail-load', (e) => {
    if (!e.isMainFrame || e.errorCode === -3) return;
    errorBox.hidden = false;
    errorBox.innerHTML = `<h3>Страница не загрузилась</h3><p>${escapeHtml(e.validatedURL || tab.url || '')}</p><p class="browser-error-code">${escapeHtml(e.errorDescription || '')} (${e.errorCode})</p>
      <button type="button" class="btn-primary" data-act="retry">Повторить</button>`;
  });
  wv.addEventListener('console-message', (e) => {
    const level = ['log', 'info', 'warn', 'error'][e.level] || 'log';
    const row = document.createElement('div');
    row.className = `browser-log ${level}`;
    row.textContent = e.message;
    row.title = `${e.sourceId || ''}:${e.line || ''}`;
    lines.appendChild(row);
    while (lines.childElementCount > 300) lines.firstChild.remove();
    lines.scrollTop = lines.scrollHeight;
    if (level === 'error') {
      view.errors += 1;
      badge.hidden = false;
      badge.textContent = String(view.errors);
    }
  });

  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); view.navigate(urlInput.value); wv.focus?.(); }
    else if (e.key === 'Escape') { urlInput.value = tab.url === 'about:blank' ? '' : tab.url; urlInput.blur(); }
  });
  urlInput.addEventListener('focus', () => urlInput.select());
  el.querySelector('.browser-device').addEventListener('change', (e) => view.applyDevice(e.target.value));

  el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'back' && view.ready && wv.canGoBack()) wv.goBack();
    else if (act === 'forward' && view.ready && wv.canGoForward()) wv.goForward();
    else if (act === 'reload') { if (el.classList.contains('loading')) wv.stop(); else if (view.ready) wv.reload(); else view.navigate(tab.url); }
    else if (act === 'retry') view.navigate(tab.url);
    else if (act === 'split') {
      const index = state.currentTabs.indexOf(tab);
      if (state.splitView && state.rightTabIndex === index) { setSplitView(false); switchToTab(index); } else openTabInSplit(index);
    } else if (act === 'devtools' && view.ready) wv.openDevTools();
    else if (act === 'external' && tab.url && tab.url !== 'about:blank') window.electronAPI.openExternal(tab.url);
    else if (act === 'console') {
      consoleBox.hidden = !consoleBox.hidden;
      if (!consoleBox.hidden) { view.errors = 0; badge.hidden = true; }
    } else if (act === 'console-clear') { lines.innerHTML = ''; view.errors = 0; badge.hidden = true; }
  });

  // Clicking into the page makes the browser the active pane (so tabs and files open in the other one).
  const markPane = () => {
    const index = state.currentTabs.indexOf(tab);
    if (state.splitView && state.rightTabIndex === index) setFocusedPane('right');
  };
  wv.addEventListener('focus', markPane);
  el.addEventListener('mousedown', markPane, true);

  getBrowserHost().appendChild(el);
  view.navigate(tab.url || 'about:blank');
  return view;
}

export function renderBrowser(tab) {
  const host = getBrowserHost();
  if (!host || !tab) return;
  const splitBtn = () => {
    const index = state.currentTabs.indexOf(tab);
    const isSide = state.splitView && state.rightTabIndex === index;
    const btn = views.get(tab.id)?.el.querySelector('[data-act="split"]');
    if (btn) {
      btn.classList.toggle('active', isSide);
      btn.title = isSide ? 'Развернуть на всё окно' : 'Показать рядом с редактором';
    }
  };
  let view = views.get(tab.id);
  if (!view) {
    view = buildView(tab);
    views.set(tab.id, view);
  }
  views.forEach((v) => { v.el.hidden = v !== view; });
  splitBtn();
  if (!tab.url || tab.url === 'about:blank') requestAnimationFrame(() => view.el.querySelector('.browser-url')?.focus());
}

export function destroyBrowser(tab) {
  const view = views.get(tab?.id);
  if (!view) return;
  view.el.remove();
  views.delete(tab.id);
}

export function focusBrowserUrl() {
  const tab = state.currentTabs[state.activeTabIndex];
  const view = isBrowserTab(tab) ? views.get(tab.id) : null;
  view?.el.querySelector('.browser-url')?.focus();
  return !!view;
}

export function browserCommand(cmd) {
  const tab = state.currentTabs[state.activeTabIndex];
  const view = isBrowserTab(tab) ? views.get(tab.id) : null;
  if (!view?.ready) return;
  if (cmd === 'reload') view.wv.reload();
  else if (cmd === 'devtools') view.wv.openDevTools();
  else if (cmd === 'back' && view.wv.canGoBack()) view.wv.goBack();
  else if (cmd === 'forward' && view.wv.canGoForward()) view.wv.goForward();
}

/** Open (or reuse a tab on the same origin) and show a URL in the built-in browser. */
export function openBrowserTab(rawUrl = 'about:blank', { reuseOrigin = false, side = false } = {}) {
  const url = normalizeUrl(rawUrl);
  // side: open beside the code when an editor / notebook is in front, otherwise take the whole area.
  const front = state.currentTabs[state.activeTabIndex];
  const canSide = side && (isEditorTab(front) || isNotebookTab(front));
  if (reuseOrigin && /^https?:/i.test(url)) {
    const origin = new URL(url).origin;
    const index = state.currentTabs.findIndex((t) => isBrowserTab(t) && /^https?:/i.test(t.url || '') && new URL(t.url).origin === origin);
    if (index >= 0) {
      const tab = state.currentTabs[index];
      if (canSide) openTabInSplit(index); else switchToTab(index);
      views.get(tab.id)?.navigate(url);
      return tab;
    }
  }
  const tab = createBrowserTab(url);
  hideWelcomePage();
  state.currentTabs.push(tab);
  const index = state.currentTabs.length - 1;
  if (canSide) openTabInSplit(index); else switchToTab(index);
  saveAllConfig();
  return tab;
}

export function setupBrowserEvents() {
  window.electronAPI?.onBrowserNewTab?.(({ url }) => openBrowserTab(url));
}
