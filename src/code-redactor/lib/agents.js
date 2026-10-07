/**
 * External coding agents: Claude Code, Codex and OpenCode.
 *  - detect: find the CLI even when the GUI app has no shell PATH
 *  - send:   run Claude Code / Codex headless inside the project and stream the answer into the chat
 *  - serve:  keep `opencode serve` running for the existing OpenCode chat provider
 */
const { ipcMain } = require('electron');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const opencode = require('./opencode');

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

const running = new Set();
let serveProc = null;
let serveBase = '';

function abortAgents() {
  for (const child of running) { try { child.kill('SIGTERM'); } catch {} }
  running.clear();
}

function toolLine(block) {
  const input = block.input || {};
  const target = input.file_path || input.path || input.command || input.pattern || input.url || input.description || '';
  return `\n\n> **${block.name}** ${target ? '`' + String(target).slice(0, 160).replace(/`/g, "'") + '`' : ''}\n\n`;
}

function runClaude({ bin, prompt, cwd, model, mode, sessionId }, emit) {
  return new Promise((resolve) => {
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--permission-mode', mode === 'edit' ? 'acceptEdits' : 'plan'];
    if (model) args.push('--model', model);
    if (sessionId) args.push('--resume', sessionId);
    const child = spawn(bin, args, { cwd, env: agentEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    running.add(child);
    child.stdin.end(prompt);

    let full = '';
    let session = sessionId || '';
    let streamed = false;
    let failure = '';
    let buffer = '';
    let stderr = '';
    const push = (text) => { full += text; emit(text, full); };

    const handleLine = (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      if (msg.session_id) session = msg.session_id;
      if (msg.type === 'stream_event') {
        const d = msg.event?.delta;
        if (msg.event?.type === 'content_block_delta' && d?.type === 'text_delta' && d.text) { streamed = true; push(d.text); }
      } else if (msg.type === 'assistant') {
        for (const block of msg.message?.content || []) {
          if (block.type === 'tool_use') push(toolLine(block));
        }
      } else if (msg.type === 'result') {
        if (msg.is_error) failure = msg.result || 'Claude Code завершился с ошибкой';
        else if (!streamed && msg.result) push(msg.result);
      }
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) { handleLine(buffer.slice(0, nl)); buffer = buffer.slice(nl + 1); }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (t) => { stderr += t; });
    child.on('error', (err) => { running.delete(child); resolve({ success: false, error: err.message }); });
    child.on('close', (code, signal) => {
      running.delete(child);
      if (buffer.trim()) handleLine(buffer);
      if (signal === 'SIGTERM') resolve({ success: true, answer: full, sessionId: session, aborted: true });
      else if (failure || (code !== 0 && !full)) resolve({ success: false, error: failure || stderr.trim().slice(-600) || `Claude Code завершился с кодом ${code}` });
      else resolve({ success: true, answer: full, sessionId: session });
    });
  });
}

function runCodex({ bin, prompt, cwd, model, mode }, emit) {
  return new Promise((resolve) => {
    const args = ['exec', '--skip-git-repo-check', '-s', mode === 'edit' ? 'workspace-write' : 'read-only'];
    if (model) args.push('-m', model);
    args.push('-');
    const child = spawn(bin, args, { cwd, env: agentEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    running.add(child);
    child.stdin.end(prompt);
    let full = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (t) => { full += t; emit(t, full); });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (t) => { stderr += t; });
    child.on('error', (err) => { running.delete(child); resolve({ success: false, error: err.message }); });
    child.on('close', (code, signal) => {
      running.delete(child);
      if (signal === 'SIGTERM') resolve({ success: true, answer: full, aborted: true });
      else if (code !== 0 && !full.trim()) resolve({ success: false, error: stderr.trim().slice(-600) || `Codex завершился с кодом ${code}` });
      else resolve({ success: true, answer: full.trim() });
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

function registerAgentsIpc(getMainWindow) {
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
    if (!AGENTS[agent] || agent === 'opencode') return { success: false, error: 'Неизвестный агент' };
    if (!prompt || !String(prompt).trim()) return { success: false, error: 'Пустой запрос' };
    const bin = await resolveBin(agent, custom);
    if (!bin) return { success: false, error: `${AGENTS[agent].bin} не найден. Установите: ${AGENTS[agent].install}` };
    const emit = (content, fullMessage) => { try { event.sender.send('stream-update', { content, fullMessage }); } catch {} };
    const workdir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
    const args = { bin, prompt: String(prompt), cwd: workdir, model: model || '', mode, sessionId };
    return agent === 'claude' ? runClaude(args, emit) : runCodex(args, emit);
  });

  ipcMain.handle('agent-abort', () => { abortAgents(); return { success: true }; });
  ipcMain.handle('abort-request', () => { abortAgents(); return { success: true }; });

  ipcMain.handle('opencode-serve-start', async (e, { bin: custom, cwd, port } = {}) => {
    const bin = await resolveBin('opencode', custom);
    if (!bin) return { success: false, error: `opencode не найден. Установите: ${AGENTS.opencode.install}` };
    return startServe({ bin, cwd: cwd && fs.existsSync(cwd) ? cwd : os.homedir(), port: port || 4096 });
  });
  ipcMain.handle('opencode-serve-stop', () => { stopServe(); return { success: true }; });
  ipcMain.handle('opencode-serve-status', () => ({ running: !!serveProc }));
}

function killAgents() {
  abortAgents();
  stopServe();
}

module.exports = { registerAgentsIpc, killAgents };
