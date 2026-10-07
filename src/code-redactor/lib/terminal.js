const { ipcMain } = require('electron');
const { spawn } = require('child_process');
const os = require('os');

let terminalPty = null;
let terminalIpcRegistered = false;

function safeRemoveHandler(channel) {
  try {
    ipcMain.removeHandler(channel);
  } catch {}
}

function killTerminalProcess() {
  if (!terminalPty) return;
  try {
    terminalPty.kill();
  } catch (err) {
    console.warn('terminal kill:', err?.message || err);
  }
  terminalPty = null;
}

function startTerminalProcess(getMainWindow, cwd, cols = 80, rows = 24) {
  killTerminalProcess();

  const shellPath = process.env.SHELL || (process.platform === 'win32' ? (process.env.ComSpec || 'powershell.exe') : '/bin/zsh');
  const workDir = cwd && typeof cwd === 'string' ? cwd : os.homedir();
  const args = process.platform === 'win32' ? [] : ['-l'];
  const colsN = Math.max(20, cols | 0);
  const rowsN = Math.max(5, rows | 0);

  const send = (channel, payload) => {
    const mainWindow = typeof getMainWindow === 'function' ? getMainWindow() : getMainWindow;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload);
    }
  };

  try {
    const pty = require('node-pty');
    terminalPty = pty.spawn(shellPath, args, {
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
    terminalPty.onData((data) => send('terminal-data', data));
    terminalPty.onExit(({ exitCode }) => {
      terminalPty = null;
      send('terminal-exit', { code: exitCode });
    });
    console.log('[terminal] PTY started', shellPath, workDir);
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
    terminalPty = {
      write: (data) => child.stdin.write(data),
      resize: () => {},
      kill: () => {
        try { child.kill(); } catch {}
      }
    };
    child.stdout.on('data', (d) => send('terminal-data', d.toString()));
    child.stderr.on('data', (d) => send('terminal-data', d.toString()));
    child.on('close', (code) => {
      terminalPty = null;
      send('terminal-exit', { code });
    });
    send('terminal-data', `[fallback shell] ${shellPath}\r\n`);
    return { success: true, shell: shellPath, cwd: workDir, pty: false };
  } catch (err) {
    terminalPty = null;
    return { success: false, error: err.message || String(err) };
  }
}

function registerTerminalIpc(getMainWindow) {
  const channels = ['terminal-start', 'terminal-write', 'terminal-resize', 'terminal-restart', 'terminal-kill', 'terminal-ping'];
  for (const ch of channels) safeRemoveHandler(ch);

  ipcMain.handle('terminal-ping', async () => ({ ok: true, pty: !!terminalPty }));

  ipcMain.handle('terminal-start', async (event, options = {}) => {
    try {
      const cwd = typeof options === 'string' ? options : options?.cwd;
      const cols = typeof options === 'object' ? options?.cols : undefined;
      const rows = typeof options === 'object' ? options?.rows : undefined;
      return startTerminalProcess(getMainWindow, cwd, cols, rows);
    } catch (err) {
      console.error('[terminal] start error:', err);
      return { success: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('terminal-write', async (event, data) => {
    try {
      if (!terminalPty) return { success: false, error: 'Terminal is not running' };
      terminalPty.write(String(data ?? ''));
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('terminal-resize', async (event, size = {}) => {
    try {
      if (!terminalPty) return { success: false, error: 'Terminal is not running' };
      const cols = Math.max(20, (size.cols | 0) || 80);
      const rows = Math.max(5, (size.rows | 0) || 24);
      if (typeof terminalPty.resize === 'function') {
        terminalPty.resize(cols, rows);
      }
      return { success: true, cols, rows };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('terminal-restart', async (event, options = {}) => {
    try {
      const cwd = typeof options === 'string' ? options : options?.cwd;
      const cols = typeof options === 'object' ? options?.cols : undefined;
      const rows = typeof options === 'object' ? options?.rows : undefined;
      return startTerminalProcess(getMainWindow, cwd, cols, rows);
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('terminal-kill', async () => {
    killTerminalProcess();
    return { success: true };
  });

  terminalIpcRegistered = true;
  console.log('[terminal] IPC handlers registered');
}

module.exports = {
  killTerminalProcess,
  registerTerminalIpc,
  startTerminalProcess,
  terminalIpcRegistered: () => terminalIpcRegistered
};
