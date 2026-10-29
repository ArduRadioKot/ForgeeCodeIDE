import { state } from './state.js';
import { getDom } from './dom.js';
import { saveAllConfig } from './save-hook.js';
import { isTerminalTab, findTerminalTabIndex } from './tab-model.js';
import {
  hideWelcomePage,
  closeTab,
  switchToTab,
  updateTabsList,
} from './tabs-api.js';
import { icon } from './glyphs.js';
import { getLang, uiText } from './i18n.js';

const dom = getDom();

/** xterm cannot parse color-mix(): turn the accent into a translucent rgba. A theme may give a plain colour. */
function terminalSelection(selection, accent, light) {
  if (selection && !/color-mix|var\(/.test(selection)) return selection;
  const m = /^#([0-9a-f]{6})$/i.exec(accent || '');
  if (!m) return light ? 'rgba(33, 170, 190, 0.28)' : 'rgba(33, 170, 190, 0.42)';
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${light ? 0.28 : 0.42})`;
}

/** xterm palette that follows the Islands tokens: surface/text from CSS, ANSI colours per theme. */
export function getXtermTheme() {
  const css = getComputedStyle(document.body);
  const v = (name) => css.getPropertyValue(name).trim();
  const light = document.body.classList.contains('light-theme');
  const ansi = light
    ? { black: '#27282e', red: '#d12f2c', green: '#3a9a4a', yellow: '#9e6a03', blue: '#2470b3', magenta: '#871094', cyan: '#00627a', white: '#6c707e',
        brightBlack: '#8c8c8c', brightRed: '#e5484d', brightGreen: '#2e8b3e', brightYellow: '#b8860b', brightBlue: '#3574f0', brightMagenta: '#a02bb0', brightCyan: '#0e7490', brightWhite: '#27282e' }
    : { black: '#27282c', red: '#f0524f', green: '#5fb865', yellow: '#e0bb73', blue: '#56a8f5', magenta: '#c77dbb', cyan: '#2aacb8', white: '#bcbec4',
        brightBlack: '#6f737a', brightRed: '#ff7b78', brightGreen: '#7fd185', brightYellow: '#f0cd8a', brightBlue: '#7dbcff', brightMagenta: '#dd9ad0', brightCyan: '#4fc7d3', brightWhite: '#ffffff' };
  const accent = v('--accent-color') || '#21aabe';
  ansi.green = accent;
  ansi.brightGreen = accent;
  return {
    background: v('--code-bg') || '#1f2023',
    foreground: v('--text-color') || '#dfe1e5',
    cursor: v('--accent-color') || '#21aabe',
    selectionBackground: terminalSelection(v('--selection'), v('--accent-color'), light),
    ...ansi,
    ...(state.activeTheme?.terminal || {}),
  };
}

export function applyTerminalFont() {
  if (!state.xterm) return;
  const mono = getComputedStyle(document.documentElement).getPropertyValue('--mono-font').trim();
  if (mono) state.xterm.options.fontFamily = mono;
  requestAnimationFrame(() => fitTerminal());
}

export function applyTerminalTheme() {
  if (state.xterm) state.xterm.options.theme = getXtermTheme();
}

function applyTerminalHeightLocal() {
  document.documentElement.style.setProperty('--terminal-height', (state.terminalHeight || 220) + 'px');
  if (dom.terminalPanel && state.terminalVisible && !state.terminalInEditor) {
    dom.terminalPanel.style.height = (state.terminalHeight || 220) + 'px';
  }
  requestAnimationFrame(() => fitTerminal());
}

export { isTerminalTab, findTerminalTabIndex };

export function getTerminalDock() {
  return document.getElementById('terminal-dock');
}

export function getTerminalEditorHost() {
  return document.getElementById('terminal-editor-host');
}

/** Перемещает панель терминала в dock (снизу) или во вкладку редактора */

export function applyTerminalPlacement() {
  if (!dom.terminalPanel) return;
  const dock = getTerminalDock();
  const host = getTerminalEditorHost();
  const leftPane = document.getElementById('editor-container');
  const rightPane = document.getElementById('editor-container-right');
  const splitResizer = document.getElementById('split-resizer');

  if (state.terminalInEditor && state.terminalVisible) {
    const nbHost = document.getElementById('notebook-host');
    if (nbHost) {
      nbHost.style.display = 'none';
      nbHost.innerHTML = '';
    }
    if (host && dom.terminalPanel.parentElement !== host) {
      host.appendChild(dom.terminalPanel);
    }
    if (host) {
      host.style.display = 'flex';
      host.style.flex = '1';
      host.style.minHeight = '0';
      host.style.minWidth = '0';
    }
    dom.terminalPanel.style.display = 'flex';
    dom.terminalPanel.style.height = '100%';
    dom.terminalPanel.style.maxHeight = 'none';
    dom.terminalPanel.style.flex = '1';
    dom.terminalPanel.classList.add('terminal-as-tab');
    if (leftPane) leftPane.style.display = 'none';
    if (rightPane) rightPane.style.display = 'none';
    if (splitResizer) splitResizer.style.display = 'none';
    const resizeEl = document.getElementById('terminal-resize');
    if (resizeEl) resizeEl.style.display = 'none';
  } else {
    if (dock && dom.terminalPanel.parentElement !== dock) {
      dock.appendChild(dom.terminalPanel);
    }
    if (host) host.style.display = 'none';
    dom.terminalPanel.classList.remove('terminal-as-tab');
    dom.terminalPanel.style.height = state.terminalHeight + 'px';
    dom.terminalPanel.style.maxHeight = '50vh';
    dom.terminalPanel.style.flex = '';
    const resizeEl = document.getElementById('terminal-resize');
    if (resizeEl) resizeEl.style.display = '';
    // Восстановить панели редактора, если welcome скрыт
    if (dom.welcomePage && dom.welcomePage.style.display === 'none') {
      if (leftPane) {
        leftPane.style.display = 'flex';
        leftPane.style.flex = '1';
      }
      if (state.splitView) {
        if (rightPane) rightPane.style.display = 'flex';
        if (splitResizer) splitResizer.style.display = 'block';
      }
    }
    if (dom.terminalPanel) {
      dom.terminalPanel.style.display = state.terminalVisible ? 'flex' : 'none';
    }
  }
  requestAnimationFrame(() => fitTerminal());
}

export function openTerminalAsEditorTab() {
  hideWelcomePage();
  state.terminalVisible = true;
  state.terminalInEditor = true;
  let idx = findTerminalTabIndex();
  if (idx < 0) {
    state.currentTabs.push({
      id: 'terminal-tab',
      kind: 'terminal',
      name: uiText('Терминал'),
      content: '',
      filePath: null,
      modified: false
    });
    idx = state.currentTabs.length - 1;
  }
  switchToTab(idx);
  if (dom.terminalBtn) dom.terminalBtn.classList.toggle('active', true);
  if (dom.statusTerminalBtn) dom.statusTerminalBtn.classList.toggle('active', true);
  saveAllConfig();
}

export function ensureTerminalTab(activate = true) {
  hideWelcomePage();
  let idx = findTerminalTabIndex();
  if (idx < 0) {
    state.currentTabs.push({
      id: 'terminal-tab',
      kind: 'terminal',
      name: uiText('Терминал'),
      content: '',
      filePath: null,
      modified: false
    });
    idx = state.currentTabs.length - 1;
  }
  if (activate) {
    switchToTab(idx);
  } else {
    updateTabsList();
  }
  return idx;
}

export function dockTerminalFromTab(keepVisible = false) {
  const idx = findTerminalTabIndex();
  if (idx >= 0) {
    state.currentTabs.splice(idx, 1);
    if (state.activeTabIndex >= state.currentTabs.length) {
      state.activeTabIndex = state.currentTabs.length - 1;
    } else if (state.activeTabIndex > idx) {
      state.activeTabIndex--;
    } else if (state.activeTabIndex === idx) {
      state.activeTabIndex = Math.min(idx, state.currentTabs.length - 1);
    }
  }
  state.terminalInEditor = false;
  applyTerminalPlacement();
  if (keepVisible) {
    state.terminalVisible = true;
    if (dom.terminalPanel) dom.terminalPanel.style.display = 'flex';
  }
  updateTabsList();
}

export function setupTerminalPanelDrag() {
  const handle = document.getElementById('terminal-drag-handle') || document.getElementById('terminal-header');
  const toTabBtn = document.getElementById('terminal-to-tab-btn');
  if (toTabBtn) {
    toTabBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openTerminalAsEditorTab();
    });
  }
  if (!handle || !dom.terminalPanel) return;

  // The panel can be grabbed by its grip or by any terminal tab and dropped on the editor tabs.
  const stripWasHidden = () => !dom.editorTabs || getComputedStyle(dom.editorTabs).display === 'none';
  let revealed = false;
  const begin = (e) => {
    e.dataTransfer.setData('text/terminal-panel', '1');
    e.dataTransfer.setData('text/plain', 'terminal-panel');
    e.dataTransfer.effectAllowed = 'move';
    dom.terminalPanel.classList.add('dragging-terminal');
    if (dom.editorTabs) {
      // With no file open the tab strip is hidden: show it so there is somewhere to drop.
      if (stripWasHidden()) { dom.editorTabs.style.display = 'flex'; revealed = true; }
      dom.editorTabs.classList.add('tabs-drop-target');
    }
  };
  const end = () => {
    dom.terminalPanel.classList.remove('dragging-terminal');
    if (dom.editorTabs) {
      dom.editorTabs.classList.remove('tabs-drop-target');
      dom.editorTabs.classList.remove('tabs-drop-hover');
      if (revealed && !state.currentTabs.length) dom.editorTabs.style.display = 'none';
      revealed = false;
    }
  };
  dom.terminalPanel.removeAttribute('draggable');
  handle.setAttribute('draggable', 'true');
  handle.addEventListener('dragstart', begin);
  handle.addEventListener('dragend', end);
  const list = document.getElementById('terminal-tab-list');
  if (list) {
    list.addEventListener('dragstart', (e) => { if (e.target.closest('.terminal-tab')) begin(e); });
    list.addEventListener('dragend', end);
  }
}

export function setupTerminal() {
  const terminalBtn = dom.terminalBtn || document.getElementById('terminal-btn');
  const statusTerminalBtn = dom.statusTerminalBtn || document.getElementById('status-terminal-btn');
  if (terminalBtn) {
    dom.terminalBtn = terminalBtn;
    terminalBtn.addEventListener('click', (e) => {
      e.preventDefault();
      toggleTerminal().catch((err) => console.error('[terminal] toggle:', err));
    });
  }
  if (statusTerminalBtn) {
    dom.statusTerminalBtn = statusTerminalBtn;
    statusTerminalBtn.addEventListener('click', (e) => {
      e.preventDefault();
      toggleTerminal().catch((err) => console.error('[terminal] toggle:', err));
    });
  }
  if (!dom.terminalPanel) {
    dom.terminalPanel = document.getElementById('terminal-panel');
  }
  if (!dom.terminalXtermHost) {
    dom.terminalXtermHost = document.getElementById('terminal-xterm');
  }
  if (!dom.terminalMeta) {
    dom.terminalMeta = document.getElementById('terminal-meta');
  }
  if (!dom.terminalCloseBtn) {
    dom.terminalCloseBtn = document.getElementById('terminal-close-btn');
  }
  if (!dom.terminalClearBtn) {
    dom.terminalClearBtn = document.getElementById('terminal-clear-btn');
  }
  if (!dom.terminalRestartBtn) {
    dom.terminalRestartBtn = document.getElementById('terminal-restart-btn');
  }
  if (!dom.terminalResizeHandle) {
    dom.terminalResizeHandle = document.getElementById('terminal-resize');
  }

  if (dom.terminalCloseBtn) {
    dom.terminalCloseBtn.addEventListener('click', () => {
      if (state.terminalInEditor) {
        const idx = findTerminalTabIndex();
        if (idx >= 0) closeTab(idx);
        else {
          state.terminalInEditor = false;
          setTerminalVisible(false, true);
        }
      } else {
        setTerminalVisible(false, true);
      }
    });
  }
  if (dom.terminalClearBtn) {
    dom.terminalClearBtn.addEventListener('click', () => {
      if (state.xterm) state.xterm.clear();
    });
  }
  document.getElementById('terminal-new-btn')?.addEventListener('click', () => newTerminalSession());
  document.getElementById('terminal-tab-list')?.addEventListener('click', (e) => {
    const tab = e.target.closest('.terminal-tab');
    if (!tab) return;
    if (e.target.closest('.terminal-tab-close')) closeTerminalSession(tab.dataset.id);
    else if (tab.dataset.id !== state.activeTerminalId) selectSession(tab.dataset.id);
  });
  if (dom.terminalRestartBtn) {
    dom.terminalRestartBtn.addEventListener('click', () => restartTerminal());
  }
  if (dom.terminalResizeHandle) {
    setupTerminalResize();
  }
  setupTerminalPanelDrag();

  if (window.electronAPI?.onTerminalData) {
    window.electronAPI.onTerminalData(({ id, data }) => {
      sessions.find((s) => s.id === id)?.xterm.write(data);
    });
  }
  if (window.electronAPI?.onTerminalExit) {
    window.electronAPI.onTerminalExit(({ id, code }) => {
      const s = sessions.find((x) => x.id === id);
      if (!s) return;
      s.started = false;
      s.meta = 'остановлен';
      s.xterm.writeln(getLang() === 'en' ? `\r\n[process exited${code != null ? ', code ' + code : ''}]` : `\r\n[процесс завершён${code != null ? ', код ' + code : ''}]`);
      syncActiveAlias();
      if (id === state.activeTerminalId && dom.terminalMeta) dom.terminalMeta.textContent = 'остановлен';
    });
  }
  window.addEventListener('resize', () => {
    if (state.terminalVisible) fitTerminal();
  });
}

// ───────────────────────── sessions (terminal tabs) ─────────────────────────

const sessions = []; // { id, title, xterm, fit, host, started }
let sessionSeq = 0;

const activeSession = () => sessions.find((s) => s.id === state.activeTerminalId) || null;

/** The rest of the app still talks about "the" terminal: keep these pointing at the front tab. */
function syncActiveAlias() {
  const s = activeSession();
  state.xterm = s?.xterm || null;
  state.fitAddon = s?.fit || null;
  state.terminalStarted = !!s?.started;
}

function xtermConstructors() {
  const Terminal = window.Terminal || window.Terminal?.Terminal;
  let Fit = null;
  if (typeof window.FitAddon === 'function') Fit = window.FitAddon;
  else if (window.FitAddon && typeof window.FitAddon.FitAddon === 'function') Fit = window.FitAddon.FitAddon;
  return { Terminal, Fit };
}

function createSession() {
  if (!dom.terminalXtermHost) dom.terminalXtermHost = document.getElementById('terminal-xterm');
  if (!dom.terminalXtermHost) return null;
  const { Terminal: TerminalCtor, Fit: FitCtor } = xtermConstructors();
  if (!TerminalCtor || !FitCtor) {
    console.error('[terminal] xterm не загружен');
    if (dom.terminalMeta) dom.terminalMeta.textContent = 'xterm не загружен';
    return null;
  }
  const id = `t${Date.now().toString(36)}${++sessionSeq}`;
  const host = document.createElement('div');
  host.className = 'term-host';
  dom.terminalXtermHost.appendChild(host);
  const xterm = new TerminalCtor({
    cursorBlink: true,
    cursorStyle: 'bar',
    fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--mono-font').trim() || "'JetBrains Mono', 'SF Mono', Menlo, Monaco, Consolas, monospace",
    fontSize: 13,
    lineHeight: 1.2,
    theme: getXtermTheme(),
    allowProposedApi: true,
    scrollback: 5000,
    convertEol: false
  });
  const fit = new FitCtor();
  xterm.loadAddon(fit);
  xterm.open(host);
  const session = { id, title: `${uiText('Терминал')} ${sessions.length + 1}`, xterm, fit, host, started: false, meta: '' };
  xterm.onData((data) => window.electronAPI?.terminalWrite?.(data, id)?.catch?.(() => {}));
  sessions.push(session);
  return session;
}

function selectSession(id) {
  state.activeTerminalId = id;
  sessions.forEach((s) => { s.host.style.display = s.id === id ? '' : 'none'; });
  syncActiveAlias();
  window.electronAPI?.terminalActive?.(id);
  const s = activeSession();
  if (dom.terminalMeta) dom.terminalMeta.textContent = s?.meta || '';
  renderTerminalTabs();
  requestAnimationFrame(() => { fitTerminal(); s?.xterm.focus(); });
}

export function renderTerminalTabs() {
  const list = document.getElementById('terminal-tab-list');
  if (!list) return;
  list.innerHTML = '';
  sessions.forEach((s) => {
    const tab = document.createElement('div');
    tab.className = `terminal-tab${s.id === state.activeTerminalId ? ' active' : ''}`;
    tab.draggable = true;
    tab.dataset.id = s.id;
    tab.innerHTML = '<span class="terminal-tab-name"></span><button type="button" class="terminal-tab-close" title="Закрыть терминал">' + icon('close', 10) + '</button>';
    tab.querySelector('.terminal-tab-name').textContent = s.title;
    list.appendChild(tab);
  });
}

/** A folder was opened: every terminal starts over in it (those already there, and run-configuration tabs, are left alone). */
export async function onFolderChanged(folder) {
  const cwd = folder || null;
  for (const s of sessions) {
    if (!s.started || s.cwd === cwd || [...keyed.values()].includes(s.id)) continue; // run configurations keep their own tab and process
    s.xterm.reset();
    s.started = false;
    await startSession(s, true);
    if (s.id === state.activeTerminalId && state.terminalVisible) { fitTerminal(); s.xterm.focus(); }
  }
}

const keyed = new Map(); // run key -> session id: a run configuration keeps its own tab

/** Run a command in a terminal tab of its own. The same key reuses the tab (it is interrupted first). */
export async function runInNamedTerminal(key, title, command, cwd) {
  let s = key ? sessions.find((x) => x.id === keyed.get(key)) : null;
  const fresh = !s;
  if (!s) {
    s = createSession();
    if (!s) return;
    s.title = title;
    if (key) keyed.set(key, s.id);
  } else s.title = title;
  selectSession(s.id);
  await setTerminalVisible(true, false);
  if (!s.started) await startSession(s);
  else if (!fresh) await window.electronAPI.terminalWrite('\x03', s.id);
  fitTerminal();
  const quote = (p) => (navigator.platform.startsWith('Win') ? `"${p}"` : `'${String(p).replace(/'/g, `'\\''`)}'`);
  await window.electronAPI.terminalWrite(`${cwd ? `cd ${quote(cwd)} && ` : ''}${command}\r`, s.id);
}

export async function newTerminalSession() {
  const session = createSession();
  if (!session) return;
  selectSession(session.id);
  await startSession(session);
}

export function closeTerminalSession(id) {
  const index = sessions.findIndex((s) => s.id === id);
  if (index < 0) return;
  const [session] = sessions.splice(index, 1);
  window.electronAPI?.terminalKill?.(id);
  try { session.xterm.dispose(); } catch {}
  session.host.remove();
  if (!sessions.length) {
    state.activeTerminalId = null;
    syncActiveAlias();
    renderTerminalTabs();
    if (state.terminalInEditor) {
      const idx = findTerminalTabIndex();
      if (idx >= 0) closeTab(idx);
    }
    setTerminalVisible(false, true);
    return;
  }
  selectSession(sessions[Math.min(index, sessions.length - 1)].id);
}

export function ensureXterm() {
  if (sessions.length) return;
  const session = createSession();
  if (session) selectSession(session.id);
}

export function fitTerminal() {
  const s = activeSession();
  if (!s || !state.terminalVisible) return;
  try {
    s.fit.fit();
    if (s.started) window.electronAPI.terminalResize({ id: s.id, cols: s.xterm.cols, rows: s.xterm.rows });
  } catch (err) {
    console.warn('fitTerminal:', err);
  }
}

async function startSession(s, restart = false) {
  if (!window.electronAPI?.terminalStart) {
    s.xterm.writeln(getLang() === 'en' ? '[terminal] API unavailable - restart the app' : '[терминал] API недоступен - перезапустите приложение');
    return;
  }
  if (s.id === state.activeTerminalId) fitTerminal();
  else try { s.fit.fit(); } catch {}
  const options = { id: s.id, cwd: state.currentFolder || undefined, cols: s.xterm.cols, rows: s.xterm.rows };
  let result;
  try {
    result = await (restart ? window.electronAPI.terminalRestart(options) : window.electronAPI.terminalStart(options));
  } catch (err) {
    result = { success: false, error: err?.message || String(err) };
  }
  if (result && result.success) {
    s.started = true;
    s.cwd = options.cwd || null;
    const shellName = (result.shell || '').split(/[\\/]/).pop() || 'shell';
    s.meta = `${shellName} · ${result.cwd || '~'}${result.pty ? '' : ' · fallback'}`;
    s.title = shellName === 'shell' ? s.title : s.title.replace(/^Терминал/, 'Терминал');
  } else {
    s.xterm.writeln(`[${getLang() === 'en' ? 'could not start terminal' : 'не удалось запустить терминал'}] ${(result && result.error) || ''}`);
    s.meta = 'ошибка';
  }
  syncActiveAlias();
  if (s.id === state.activeTerminalId && dom.terminalMeta) dom.terminalMeta.textContent = s.meta;
}

export function setupTerminalResize() {
  let dragging = false;
  let startY = 0;
  let startH = 0;
  dom.terminalResizeHandle.addEventListener('mousedown', (e) => {
    dragging = true;
    startY = e.clientY;
    startH = state.terminalHeight;
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const delta = startY - e.clientY;
    state.terminalHeight = Math.min(480, Math.max(140, startH + delta));
    if (dom.terminalHeightRange) dom.terminalHeightRange.value = state.terminalHeight;
    if (dom.terminalHeightValue) dom.terminalHeightValue.textContent = state.terminalHeight + 'px';
    applyTerminalHeightLocal();
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    saveAllConfig();
  });
}

export async function toggleTerminal() {
  // Если терминал уже как вкладка - просто активировать / скрыть
  const termIdx = findTerminalTabIndex();
  if (state.terminalInEditor && termIdx >= 0) {
    if (state.activeTabIndex === termIdx) {
      // закрыть вкладку терминала → dock
      closeTab(termIdx);
    } else {
      switchToTab(termIdx);
    }
    return;
  }
  if (!state.terminalVisible) {
    setTerminalVisible(true, true);
  } else {
    setTerminalVisible(false, true);
  }
}

export async function setTerminalVisible(visible, shouldSave = true) {
  state.terminalVisible = !!visible;
  if (!state.terminalVisible) {
    state.terminalInEditor = false;
  }
  if (!dom.terminalPanel) {
    dom.terminalPanel = document.getElementById('terminal-panel');
  }
  applyTerminalPlacement();
  if (dom.terminalPanel && state.terminalVisible && !state.terminalInEditor) {
    dom.terminalPanel.style.display = 'flex';
    dom.terminalPanel.style.height = (state.terminalHeight || 220) + 'px';
  }
  if (dom.terminalBtn) dom.terminalBtn.classList.toggle('active', state.terminalVisible);
  if (dom.statusTerminalBtn) dom.statusTerminalBtn.classList.toggle('active', state.terminalVisible);
  applyTerminalHeightLocal();
  if (state.terminalVisible) {
    ensureXterm();
    try {
      await ensureTerminalStarted();
    } catch (err) {
      console.error('[terminal] start failed:', err);
      if (state.xterm) {
        state.xterm.writeln(`[${getLang() === 'en' ? 'terminal error' : 'ошибка терминала'}] ${err?.message || err}`);
      }
    }
    requestAnimationFrame(() => {
      fitTerminal();
      requestAnimationFrame(() => {
        fitTerminal();
        if (state.xterm) state.xterm.focus();
      });
    });
  }
  if (shouldSave) saveAllConfig();
}

export async function ensureTerminalStarted() {
  ensureXterm();
  const s = activeSession();
  if (!s) return;
  if (s.started) { fitTerminal(); return; }
  try {
    await window.electronAPI?.terminalPing?.();
  } catch (err) {
    s.xterm.writeln(getLang() === 'en' ? '[terminal] IPC is not registered. Restart the app completely.' : '[терминал] IPC не зарегистрирован. Полностью перезапустите приложение.');
    if (dom.terminalMeta) dom.terminalMeta.textContent = 'нет IPC';
    return;
  }
  await startSession(s);
}

export async function restartTerminal() {
  ensureXterm();
  const s = activeSession();
  if (!s) return;
  s.xterm.reset();
  s.started = false;
  await startSession(s, true);
  s.xterm.focus();
}

/** Run a shell command in the integrated terminal (optionally after cd-ing into a folder). */
export async function runInTerminal(command, cwd) {
  await setTerminalVisible(true, false);
  await ensureTerminalStarted();
  const quote = (p) => (navigator.platform.startsWith('Win') ? `"${p}"` : `'${String(p).replace(/'/g, `'\\''`)}'`);
  await window.electronAPI.terminalWrite(`${cwd ? `cd ${quote(cwd)} && ` : ''}${command}\r`);
}
