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
      name: 'Терминал',
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
      name: 'Терминал',
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

  // Drag only from header handle, not whole panel (avoids fighting state.xterm)
  dom.terminalPanel.removeAttribute('draggable');
  handle.setAttribute('draggable', 'true');
  handle.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/terminal-panel', '1');
    e.dataTransfer.setData('text/plain', 'terminal-panel');
    e.dataTransfer.effectAllowed = 'move';
    dom.terminalPanel.classList.add('dragging-terminal');
    if (dom.editorTabs) dom.editorTabs.classList.add('tabs-drop-target');
  });
  handle.addEventListener('dragend', () => {
    dom.terminalPanel.classList.remove('dragging-terminal');
    if (dom.editorTabs) {
      dom.editorTabs.classList.remove('tabs-drop-target');
      dom.editorTabs.classList.remove('tabs-drop-hover');
    }
  });
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
  if (dom.terminalRestartBtn) {
    dom.terminalRestartBtn.addEventListener('click', () => restartTerminal());
  }
  if (dom.terminalResizeHandle) {
    setupTerminalResize();
  }
  setupTerminalPanelDrag();

  if (window.electronAPI?.onTerminalData) {
    window.electronAPI.onTerminalData((data) => {
      if (state.xterm) state.xterm.write(data);
    });
  }
  if (window.electronAPI?.onTerminalExit) {
    window.electronAPI.onTerminalExit((payload) => {
      state.terminalStarted = false;
      if (state.xterm) {
        state.xterm.writeln(`\r\n[процесс завершён${payload && payload.code != null ? ', код ' + payload.code : ''}]`);
      }
      if (dom.terminalMeta) dom.terminalMeta.textContent = 'остановлен';
    });
  }
  window.addEventListener('resize', () => {
    if (state.terminalVisible) fitTerminal();
  });
}

export function ensureXterm() {
  if (state.xterm || !dom.terminalXtermHost) {
    if (!dom.terminalXtermHost) {
      const host = document.getElementById('terminal-xterm');
      if (host) dom.terminalXtermHost = host;
    }
    if (state.xterm || !dom.terminalXtermHost) return;
  }

  const TerminalCtor =
    window.Terminal ||
    window.Terminal?.Terminal ||
    (typeof window.exports !== 'undefined' && window.exports.Terminal);

  let FitCtor = null;
  if (typeof window.FitAddon === 'function') {
    FitCtor = window.FitAddon;
  } else if (window.FitAddon && typeof window.FitAddon.FitAddon === 'function') {
    FitCtor = window.FitAddon.FitAddon;
  }

  if (!TerminalCtor || !FitCtor) {
    console.error('[terminal] xterm не загружен', {
      Terminal: !!TerminalCtor,
      FitAddon: !!window.FitAddon,
    });
    if (dom.terminalMeta) dom.terminalMeta.textContent = 'xterm не загружен';
    return;
  }

  state.xterm = new TerminalCtor({
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

  state.fitAddon = new FitCtor();
  state.xterm.loadAddon(state.fitAddon);
  state.xterm.open(dom.terminalXtermHost);
  state.xterm.onData((data) => {
    if (window.electronAPI?.terminalWrite) {
      window.electronAPI.terminalWrite(data).catch(() => {});
    }
  });
}

export function fitTerminal() {
  if (!state.xterm || !state.fitAddon || !state.terminalVisible) return;
  try {
    state.fitAddon.fit();
    const dims = { cols: state.xterm.cols, rows: state.xterm.rows };
    if (state.terminalStarted) {
      window.electronAPI.terminalResize(dims);
    }
  } catch (err) {
    console.warn('fitTerminal:', err);
  }
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
  // Если терминал уже как вкладка — просто активировать / скрыть
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
        state.xterm.writeln(`[ошибка терминала] ${err?.message || err}`);
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
  if (!window.electronAPI?.terminalStart) {
    if (state.xterm) state.xterm.writeln('[терминал] API недоступен — перезапустите приложение');
    return;
  }
  if (state.terminalStarted) {
    fitTerminal();
    return;
  }
  ensureXterm();
  // Проверка IPC
  try {
    if (window.electronAPI.terminalPing) {
      await window.electronAPI.terminalPing();
    }
  } catch (err) {
    const msg = err?.message || String(err);
    if (state.xterm) {
      state.xterm.writeln('[терминал] IPC не зарегистрирован. Полностью перезапустите приложение (Quit → Start).');
      state.xterm.writeln(msg);
    }
    if (dom.terminalMeta) dom.terminalMeta.textContent = 'нет IPC';
    return;
  }

  fitTerminal();
  const cols = state.xterm ? state.xterm.cols : 80;
  const rows = state.xterm ? state.xterm.rows : 24;
  let result;
  try {
    result = await window.electronAPI.terminalStart({
      cwd: state.currentFolder || undefined,
      cols,
      rows
    });
  } catch (err) {
    result = { success: false, error: err?.message || String(err) };
  }
  if (result && result.success) {
    state.terminalStarted = true;
    if (dom.terminalMeta) {
      const shellName = (result.shell || '').split(/[\\/]/).pop() || 'shell';
      dom.terminalMeta.textContent = `${shellName} · ${result.cwd || '~'}${result.pty ? '' : ' · fallback'}`;
    }
  } else if (state.xterm) {
    state.xterm.writeln(`[не удалось запустить терминал] ${(result && result.error) || ''}`);
    if (dom.terminalMeta) dom.terminalMeta.textContent = 'ошибка';
  }
}

export async function restartTerminal() {
  ensureXterm();
  if (state.xterm) state.xterm.reset();
  state.terminalStarted = false;
  fitTerminal();
  const result = await window.electronAPI.terminalRestart({
    cwd: state.currentFolder || undefined,
    cols: state.xterm ? state.xterm.cols : 80,
    rows: state.xterm ? state.xterm.rows : 24
  });
  if (result && result.success) {
    state.terminalStarted = true;
    if (dom.terminalMeta) {
      dom.terminalMeta.textContent = `${result.shell.split('/').pop()} · ${result.cwd} · сеть системы`;
    }
    if (state.xterm) state.xterm.focus();
  } else if (state.xterm) {
    state.xterm.writeln(`[ошибка перезапуска] ${(result && result.error) || ''}`);
  }
}
/** Run a shell command in the integrated terminal (optionally after cd-ing into a folder). */
export async function runInTerminal(command, cwd) {
  await setTerminalVisible(true, false);
  await ensureTerminalStarted();
  const quote = (p) => (navigator.platform.startsWith('Win') ? `"${p}"` : `'${String(p).replace(/'/g, `'\\''`)}'`);
  await window.electronAPI.terminalWrite(`${cwd ? `cd ${quote(cwd)} && ` : ''}${command}\r`);
}
