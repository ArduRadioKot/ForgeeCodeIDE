const { ipcMain } = require('electron');
const { spawn } = require('child_process');
const os = require('os');

// Any number of shells, one per terminal tab. `activeId` is where writes without an id go (agents, "run file").
const sessions = new Map(); // id -> { write, resize, kill, owner }
const activeBySender = new Map(); // webContents id -> its front terminal
let activeId = null;
let terminalIpcRegistered = false;

function safeRemoveHandler(channel) {
  try {
    ipcMain.removeHandler(channel);
  } catch {}
}

function killSession(id) {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  try {
    session.kill();
  } catch (err) {
    console.warn('terminal kill:', err?.message || err);
  }
  if (activeId === id) activeId = sessions.size ? [...sessions.keys()].pop() : null;
}

/** A closed window takes its shells with it. */
function killSessionsOf(webContents) {
  for (const [id, s] of [...sessions]) if (s.owner === webContents) killSession(id);
}

function killTerminalProcess() {
  for (const id of [...sessions.keys()]) killSession(id);
}

function startTerminalProcess(getMainWindow, id, cwd, cols = 80, rows = 24, owner = null) {
  killSession(id);

  const shellPath = process.env.SHELL || (process.platform === 'win32' ? (process.env.ComSpec || 'powershell.exe') : '/bin/zsh');
  const workDir = cwd && typeof cwd === 'string' ? cwd : os.homedir();
  const args = process.platform === 'win32' ? [] : ['-l'];
  const colsN = Math.max(20, cols | 0);
  const rowsN = Math.max(5, rows | 0);

  const send = (channel, payload) => {
    // Output goes to the window that started the shell, not to whichever one is in front.
    if (owner && !owner.isDestroyed()) { owner.send(channel, payload); return; }
    const mainWindow = typeof getMainWindow === 'function' ? getMainWindow() : getMainWindow;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload);
    }
  };
  const finish = (code) => {
    // A restart replaces the session under the same id: only the current one may report its own exit.
    if (sessions.get(id) !== current) return;
    sessions.delete(id);
    send('terminal-exit', { id, code });
  };
  let current = null;

  try {
    const pty = require('node-pty');
    const proc = pty.spawn(shellPath, args, {
      name: 'xterm-256color',
      cols: colsN,
      rows: rowsN,
      cwd: workDir,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        LANG: process.env.LANG || 'en_US.UTF-8'
      }
    });
    current = { write: (d) => proc.write(d), resize: (c, r) => proc.resize(c, r), kill: () => proc.kill(), owner };
    sessions.set(id, current);
    activeId = id;
    if (owner) activeBySender.set(owner.id, id);
    proc.onData((data) => send('terminal-data', { id, data }));
    proc.onExit(({ exitCode }) => finish(exitCode));
    console.log('[terminal] PTY started', id, shellPath, workDir);
    return { success: true, shell: shellPath, cwd: workDir, pty: true };
  } catch (err) {
    console.warn('[terminal] PTY failed, fallback spawn:', err.message || err);
  }

  try {
    const child = spawn(shellPath, args, {
      cwd: workDir,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    current = {
      write: (data) => child.stdin.write(data),
      resize: () => {},
      kill: () => { try { child.kill(); } catch {} },
      owner
    };
    sessions.set(id, current);
    activeId = id;
    if (owner) activeBySender.set(owner.id, id);
    child.stdout.on('data', (d) => send('terminal-data', { id, data: d.toString() }));
    child.stderr.on('data', (d) => send('terminal-data', { id, data: d.toString() }));
    child.on('close', (code) => finish(code));
    send('terminal-data', { id, data: `[fallback shell] ${shellPath}\r\n` });
    return { success: true, shell: shellPath, cwd: workDir, pty: false };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

function registerTerminalIpc(getMainWindow) {
  const channels = ['terminal-start', 'terminal-write', 'terminal-resize', 'terminal-restart', 'terminal-kill', 'terminal-ping', 'terminal-active'];
  for (const ch of channels) safeRemoveHandler(ch);

  ipcMain.handle('terminal-ping', async () => ({ ok: true, sessions: sessions.size }));

  const start = async (event, options = {}) => {
    try {
      const o = typeof options === 'object' && options ? options : { cwd: options };
      return startTerminalProcess(getMainWindow, o.id || 't1', o.cwd, o.cols, o.rows, event.sender);
    } catch (err) {
      console.error('[terminal] start error:', err);
      return { success: false, error: err.message || String(err) };
    }
  };
  ipcMain.handle('terminal-start', start);
  ipcMain.handle('terminal-restart', start);

  // "The" terminal of a window is the one it last started or brought to the front.
  const frontOf = (event, id) => id || activeBySender.get(event.sender.id) || activeId;

  ipcMain.handle('terminal-active', async (event, id) => {
    if (sessions.has(id)) { activeId = id; activeBySender.set(event.sender.id, id); }
    return { success: true };
  });

  ipcMain.handle('terminal-write', async (event, data, id) => {
    try {
      const session = sessions.get(frontOf(event, id));
      if (!session) return { success: false, error: 'Terminal is not running' };
      session.write(String(data ?? ''));
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('terminal-resize', async (event, size = {}) => {
    try {
      const session = sessions.get(frontOf(event, size.id));
      if (!session) return { success: false, error: 'Terminal is not running' };
      const cols = Math.max(20, (size.cols | 0) || 80);
      const rows = Math.max(5, (size.rows | 0) || 24);
      session.resize(cols, rows);
      return { success: true, cols, rows };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('terminal-kill', async (event, id) => {
    killSession(frontOf(event, id));
    return { success: true };
  });

  terminalIpcRegistered = true;
  console.log('[terminal] IPC handlers registered');
}

module.exports = {
  killTerminalProcess,
  killSessionsOf,
  registerTerminalIpc,
  startTerminalProcess,
  terminalIpcRegistered: () => terminalIpcRegistered
};
