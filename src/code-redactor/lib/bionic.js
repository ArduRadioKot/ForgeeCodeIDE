/**
 * Bionic (LM Studio's agent app) shares LM Studio's runtime: an OpenAI-compatible server on localhost:1234
 * and the `lms` CLI. We drive both: status, start/stop the server, list models, open the app.
 */
const { ipcMain } = require('electron');
const { spawn, execFile } = require('child_process');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadConfig } = require('./config');

const DEFAULT_BASE = 'http://127.0.0.1:1234';

async function baseUrl() {
  try {
    const config = await loadConfig();
    return String(config.bionicBaseUrl || DEFAULT_BASE).replace(/\/+$/, '').replace(/\/v1$/, '').replace('//localhost', '//127.0.0.1');
  } catch {
    return DEFAULT_BASE;
  }
}

function findLms() {
  const home = os.homedir();
  const candidates = [
    path.join(home, '.lmstudio', 'bin', process.platform === 'win32' ? 'lms.exe' : 'lms'),
    ...((process.env.PATH || '').split(path.delimiter).map((d) => path.join(d, process.platform === 'win32' ? 'lms.exe' : 'lms'))),
  ];
  return candidates.find((file) => { try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile(); } catch { return false; } }) || null;
}

function findApp() {
  const home = os.homedir();
  const candidates = process.platform === 'darwin'
    ? ['/Applications/Bionic.app', path.join(home, 'Applications', 'Bionic.app')]
    : process.platform === 'win32'
      ? [path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Bionic', 'Bionic.exe'), path.join(process.env.LOCALAPPDATA || '', 'Bionic', 'Bionic.exe')]
      : [];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function run(file, args, timeout = 30000) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => resolve({ ok: !error, stdout: String(stdout || ''), stderr: String(stderr || ''), error }));
  });
}

async function serverModels(base) {
  const res = await axios.get(`${base}/v1/models`, { timeout: 2500 });
  return (res.data?.data || []).map((m) => ({ id: m.id, name: m.id })).filter((m) => !/embed/i.test(m.id));
}

async function diskModels(lms) {
  const res = await run(lms, ['ls', '--json'], 20000);
  if (!res.ok) return [];
  try {
    return JSON.parse(res.stdout).filter((m) => m.type === 'llm').map((m) => ({
      id: m.modelKey,
      name: m.displayName || m.modelKey,
      size: m.sizeBytes || 0,
      params: m.paramsString || '',
      arch: m.architecture || '',
      vision: !!m.vision,
      tools: !!m.trainedForToolUse,
    }));
  } catch {
    return [];
  }
}

async function status() {
  const base = await baseUrl();
  const lms = findLms();
  const app = findApp();
  const out = { appInstalled: !!app, appPath: app, lmsPath: lms, running: false, baseUrl: base, models: [] };
  try {
    out.models = await serverModels(base);
    out.running = true;
    // Rich details (size, params) come from the CLI when it is available.
    if (lms) {
      const disk = await diskModels(lms);
      const byId = new Map(disk.map((m) => [m.id, m]));
      out.models = out.models.map((m) => ({ ...m, ...(byId.get(m.id) || {}) }));
    }
  } catch {
    if (lms) out.models = await diskModels(lms);
  }
  return out;
}

async function startServer(port) {
  const lms = findLms();
  if (!lms) return { success: false, error: 'CLI lms не найден. Установите LM Studio или Bionic и запустите их один раз.' };
  const base = await baseUrl();
  const wanted = port || Number(new URL(base).port) || 1234;
  const res = await run(lms, ['server', 'start', '--port', String(wanted)], 60000);
  for (let i = 0; i < 30; i++) {
    try { await serverModels(base); return { success: true }; } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  return { success: false, error: (res.stderr || res.stdout || 'Сервер не ответил').trim().slice(-300) };
}

function registerBionicIpc() {
  for (const ch of ['bionic-status', 'bionic-server', 'bionic-open']) { try { ipcMain.removeHandler(ch); } catch {} }
  ipcMain.handle('bionic-status', () => status());
  ipcMain.handle('bionic-server', async (event, { action, port } = {}) => {
    if (action === 'stop') {
      const lms = findLms();
      if (!lms) return { success: false, error: 'CLI lms не найден' };
      const res = await run(lms, ['server', 'stop'], 20000);
      return { success: res.ok, error: res.ok ? null : (res.stderr || res.stdout).trim() };
    }
    return startServer(port);
  });
  ipcMain.handle('bionic-open', (event, folder) => {
    const app = findApp();
    if (!app) return { success: false, error: 'Bionic не найден. Установите приложение с lmstudio.ai' };
    try {
      if (process.platform === 'darwin') spawn('open', ['-a', app, ...(folder ? [folder] : [])], { detached: true, stdio: 'ignore' }).unref();
      else spawn(app, folder ? [folder] : [], { detached: true, stdio: 'ignore' }).unref();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

module.exports = { registerBionicIpc, startServer, baseUrl: () => baseUrl(), status };
