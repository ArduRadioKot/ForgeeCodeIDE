/**
 * External coding agents: Claude Code, Codex and OpenCode.
 *  - detect: find the CLI even when the GUI app has no shell PATH
 *  - send:   run Claude Code / Codex headless inside the project and stream the answer into the chat
 *  - serve:  keep `opencode serve` running for the existing OpenCode chat provider
 */
const { ipcMain } = require('electron');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const { createInterface } = require('readline');
const net = require('net');
const os = require('os');
const path = require('path');
const opencode = require('./opencode');
const { track, abortAll } = require('./abort');
const { agentOutput } = require('./agent-output');

const AGENTS = {
  claude: { bin: 'claude', install: 'npm i -g @anthropic-ai/claude-code' },
  codex: { bin: 'codex', install: 'npm i -g @openai/codex' },
  opencode: { bin: 'opencode', install: 'curl -fsSL https://opencode.ai/install | bash' },
};

const isWin = process.platform === 'win32';
const home = os.homedir();
const EXTRA_DIRS = isWin
  ? [path.join(process.env.APPDATA || '', 'npm'), path.join(home, '.opencode', 'bin'), path.join(home, '.local', 'bin')]
  : ['/opt/homebrew/bin', '/usr/local/bin', path.join(home, '.local/bin'), path.join(home, '.opencode/bin'), path.join(home, '.npm-global/bin'),
     path.join(home, '.bun/bin'), path.join(home, '.cargo/bin'), path.join(home, '.volta/bin'), '/usr/bin', '/bin'];

function agentEnv() {
  const sep = isWin ? ';' : ':';
  const current = (process.env.PATH || '').split(sep).filter(Boolean);
  return { ...process.env, PATH: [...new Set([...current, ...EXTRA_DIRS])].join(sep), FORCE_COLOR: '0', NO_COLOR: '1' };
}

function isExecutable(file) {
  try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile(); } catch { return false; }
}

function loginShellLookup(name) {
  return new Promise((resolve) => {
    if (isWin) { resolve(null); return; }
    execFile(process.env.SHELL || '/bin/zsh', ['-ilc', `command -v ${name}`], { timeout: 4000 }, (err, stdout) => {
      const line = String(stdout || '').trim().split('\n').pop();
      resolve(!err && line && isExecutable(line) ? line : null);
    });
  });
}

async function resolveBin(agent, custom) {
  if (custom && isExecutable(custom)) return custom;
  const name = AGENTS[agent].bin;
  const exts = isWin ? ['.cmd', '.exe', '.bat', ''] : [''];
  for (const dir of agentEnv().PATH.split(isWin ? ';' : ':')) {
    for (const ext of exts) {
      const file = path.join(dir, name + ext);
      if (isExecutable(file)) return file;
    }
  }
  return loginShellLookup(name);
}

function versionOf(bin) {
  return new Promise((resolve) => {
    execFile(bin, ['--version'], { timeout: 6000, env: agentEnv() }, (err, stdout) => {
      resolve(err ? '' : String(stdout).trim().split('\n')[0]);
    });
  });
}

// ───────── running headless agents ─────────

let serveProc = null;
let serveBase = '';

function agentArgs(agent, { model, mode, sessionId }) {
  if (agent === 'claude') {
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--permission-mode', mode === 'edit' ? 'acceptEdits' : 'plan'];
    if (model) args.push('--model', model);
    if (sessionId) args.push('--resume', sessionId);
    return args;
  }
  const args = ['exec', '--skip-git-repo-check', '-s', mode === 'edit' ? 'workspace-write' : 'read-only'];
  if (sessionId) args.push('resume');
  args.push('--json');
  if (model) args.push('-m', model);
  if (sessionId) args.push(sessionId);
  return [...args, '-'];
}

function runAgent(agent, { bin, prompt, cwd, signal, ...settings }, emit) {
  return new Promise((resolve) => {
    const child = spawn(bin, agentArgs(agent, settings), {
      cwd, env: agentEnv(), detached: !isWin, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const output = agentOutput(agent, emit);
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on('line', (line) => output.line(line));
    let stderr = '';
    let processError = '';
    let killTimer;
    const kill = (signalName) => {
      if (!child.pid) return;
      try {
        if (isWin) child.kill(signalName);
        else process.kill(-child.pid, signalName);
      } catch { /* The process already exited. */ }
    };
    const cancel = () => {
      kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), 1500);
      killTimer.unref();
    };
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();

    child.stdin.on('error', (err) => { if (err.code !== 'EPIPE') processError = err.message; });
    child.stdin.end(prompt);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-3000); });
    child.on('error', (err) => { processError = err.message; });
    child.on('close', (code) => {
      clearTimeout(killTimer);
      signal.removeEventListener('abort', cancel);
      const { error, ...result } = output.result(signal.aborted || code !== 0);
      if (signal.aborted) resolve({ success: true, ...result, aborted: true });
      else if (code !== 0 || error || processError) {
        resolve({ success: false, ...result, error: error || processError || stderr.trim() || `${AGENTS[agent].bin} exited with code ${code}` });
      } else resolve({ success: true, ...result });
    });
  });
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

async function startServe({ bin, cwd, port: preferred }) {
  const firstBase = `http://127.0.0.1:${preferred}`;
  const health = await opencode.checkHealth(firstBase).catch(() => ({}));
  if (health && health.healthy) return { success: true, baseUrl: firstBase, external: true };
  if (serveProc) return { success: true, baseUrl: serveBase || firstBase };
  // Another tool may already hold the default port: take the next free one.
  let port = preferred;
  while (!(await isPortFree(port)) && port < preferred + 20) port += 1;
  const base = `http://127.0.0.1:${port}`;
  serveBase = base;
  serveProc = spawn(bin, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], { cwd, env: agentEnv(), stdio: 'ignore' });
  serveProc.on('exit', () => { serveProc = null; });
  serveProc.on('error', () => { serveProc = null; });
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (!serveProc) return { success: false, error: 'opencode serve завершился сразу после запуска' };
    const h = await opencode.checkHealth(base).catch(() => ({}));
    if (h && h.healthy) return { success: true, baseUrl: base };
  }
  return { success: false, error: 'opencode serve не ответил за 15 с' };
}

function stopServe() {
  if (serveProc) { try { serveProc.kill('SIGTERM'); } catch {} serveProc = null; }
}

function registerAgentsIpc() {
  for (const ch of ['agents-detect', 'agent-send', 'agent-abort', 'abort-request', 'opencode-serve-start', 'opencode-serve-stop', 'opencode-serve-status']) {
    try { ipcMain.removeHandler(ch); } catch {}
  }

  ipcMain.handle('agents-detect', async (e, paths = {}) => {
    const out = {};
    await Promise.all(Object.keys(AGENTS).map(async (agent) => {
      const bin = await resolveBin(agent, paths[agent]);
      out[agent] = bin
        ? { found: true, path: bin, version: await versionOf(bin), install: AGENTS[agent].install }
        : { found: false, install: AGENTS[agent].install };
    }));
    out.opencodeServe = { running: !!serveProc };
    return out;
  });

  ipcMain.handle('agent-send', async (event, payload = {}) => {
    const { agent, prompt, cwd, model, mode, sessionId, bin: custom } = payload;
    if (!Object.hasOwn(AGENTS, agent) || agent === 'opencode') return { success: false, error: 'Неизвестный агент' };
    if (typeof prompt !== 'string' || !prompt.trim()) return { success: false, error: 'Пустой запрос' };
    if (sessionId && !/^[a-f0-9-]{36}$/i.test(sessionId)) return { success: false, error: 'Некорректный идентификатор сессии' };

    const controller = new AbortController();
    const untrack = track(controller, event.sender.id);
    try {
      const workdir = typeof cwd === 'string' && path.isAbsolute(cwd) ? await fs.promises.realpath(cwd).catch(() => null) : null;
      if (!workdir || !(await fs.promises.stat(workdir)).isDirectory()) {
        return { success: false, error: 'Откройте существующую папку проекта' };
      }
      const bin = await resolveBin(agent, custom);
      if (controller.signal.aborted) return { success: true, aborted: true };
      if (!bin) return { success: false, error: `${AGENTS[agent].bin} не найден. Установите: ${AGENTS[agent].install}` };
      const emit = (data) => { if (!event.sender.isDestroyed()) event.sender.send('stream-update', data); };
      return await runAgent(agent, { bin, prompt, cwd: workdir, model, mode, sessionId, signal: controller.signal }, emit);
    } catch (err) {
      return { success: false, error: err.message };
    } finally {
      untrack();
    }
  });

  const cancelChat = (event) => { abortAll(event.sender.id); return { success: true }; };
  ipcMain.handle('agent-abort', cancelChat);
  ipcMain.handle('abort-request', cancelChat);

  ipcMain.handle('opencode-serve-start', async (e, { bin: custom, cwd, port } = {}) => {
    const bin = await resolveBin('opencode', custom);
    if (!bin) return { success: false, error: `opencode не найден. Установите: ${AGENTS.opencode.install}` };
    return startServe({ bin, cwd: cwd && fs.existsSync(cwd) ? cwd : os.homedir(), port: port || 4096 });
  });
  ipcMain.handle('opencode-serve-stop', () => { stopServe(); return { success: true }; });
  ipcMain.handle('opencode-serve-status', () => ({ running: !!serveProc }));
}

function killAgents() {
  abortAll();
  stopServe();
}

module.exports = { registerAgentsIpc, killAgents };
