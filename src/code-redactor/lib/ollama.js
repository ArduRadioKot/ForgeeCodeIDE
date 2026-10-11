/** Ollama management: status, installed models, model installer with live progress, delete, start. */
const { ipcMain } = require('electron');
const { spawn, execFile } = require('child_process');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadConfig } = require('./config');

const DEFAULT_BASE = 'http://127.0.0.1:11434';
const pulls = new Map(); // name -> AbortController

async function baseUrl() {
  try {
    const config = await loadConfig();
    // Electron's Node tries only ::1 for "localhost", while Ollama listens on IPv4: always use 127.0.0.1.
    return String(config.ollamaBaseUrl || DEFAULT_BASE).replace(/\/+$/, '').replace('//localhost', '//127.0.0.1');
  } catch {
    return DEFAULT_BASE;
  }
}

function findExecutable(name) {
  const dirs = (process.env.PATH || '').split(path.delimiter).concat(process.platform === 'win32'
    ? [path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama')]
    : ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin']);
  for (const dir of dirs) {
    for (const ext of process.platform === 'win32' ? ['.exe', '.cmd', ''] : ['']) {
      const file = path.join(dir, name + ext);
      try { fs.accessSync(file, fs.constants.X_OK); if (fs.statSync(file).isFile()) return file; } catch {}
    }
  }
  return null;
}

function appInstalled() {
  if (process.platform === 'darwin') return fs.existsSync('/Applications/Ollama.app') || fs.existsSync(path.join(os.homedir(), 'Applications', 'Ollama.app'));
  if (process.platform === 'win32') return fs.existsSync(path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama app.exe'));
  return false;
}

async function api(method, route, data, timeout = 3000) {
  const base = await baseUrl();
  return axios({ method, url: `${base}${route}`, data, timeout });
}

async function status() {
  const bin = findExecutable('ollama');
  const out = { installed: !!bin || appInstalled(), binary: bin, running: false, version: '', models: [], loaded: [], baseUrl: await baseUrl() };
  try {
    const version = await api('get', '/api/version', undefined, 1500);
    out.running = true;
    out.version = version.data?.version || '';
    const tags = await api('get', '/api/tags', undefined, 4000);
    out.models = (tags.data?.models || []).map((m) => ({
      name: m.name,
      size: m.size || 0,
      modified: m.modified_at,
      family: m.details?.family || '',
      params: m.details?.parameter_size || '',
      quant: m.details?.quantization_level || '',
      capabilities: m.capabilities || [],
    })).sort((a, b) => a.name.localeCompare(b.name));
    try {
      const ps = await api('get', '/api/ps', undefined, 1500);
      out.loaded = (ps.data?.models || []).map((m) => m.name);
    } catch {}
  } catch { /* not running */ }
  return out;
}

async function waitUntilRunning(ms = 15000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { await api('get', '/api/version', undefined, 1000); return true; } catch { await new Promise((r) => setTimeout(r, 400)); }
  }
  return false;
}

async function start() {
  if ((await status()).running) return { success: true };
  try {
    if (process.platform === 'darwin' && fs.existsSync('/Applications/Ollama.app')) {
      spawn('open', ['-a', 'Ollama'], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'win32' && appInstalled()) {
      spawn(path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama app.exe'), [], { detached: true, stdio: 'ignore' }).unref();
    } else {
      const bin = findExecutable('ollama');
      if (!bin) return { success: false, error: 'Ollama не установлена. Скачайте её на ollama.com/download' };
      spawn(bin, ['serve'], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
  return (await waitUntilRunning()) ? { success: true } : { success: false, error: 'Ollama не ответила за 15 секунд' };
}

async function pull(event, name) {
  if (!name || !/^[\w.\-:/@]+$/.test(name)) return { success: false, error: 'Некорректное имя модели' };
  if (pulls.has(name)) return { success: false, error: 'Эта модель уже загружается' };
  const controller = new AbortController();
  pulls.set(name, controller);
  const send = (payload) => { try { event.sender.send('ollama-pull-progress', { name, ...payload }); } catch {} };
  const layers = new Map();
  let last = 0;
  try {
    const base = await baseUrl();
    const response = await axios.post(`${base}/api/pull`, { model: name, stream: true }, { responseType: 'stream', signal: controller.signal, timeout: 0 });
    await new Promise((resolve, reject) => {
      let buffer = '';
      response.data.setEncoding('utf8');
      response.data.on('data', (chunk) => {
        buffer += chunk;
        let nl;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          let data;
          try { data = JSON.parse(line); } catch { continue; }
          if (data.error) { reject(new Error(data.error)); return; }
          if (data.digest && data.total) layers.set(data.digest, { total: data.total, completed: data.completed || 0 });
          let total = 0;
          let completed = 0;
          layers.forEach((l) => { total += l.total; completed += l.completed; });
          const now = Date.now();
          if (now - last > 120 || data.status === 'success') {
            last = now;
            send({ status: data.status, total, completed, percent: total ? Math.min(100, (completed / total) * 100) : 0 });
          }
        }
      });
      response.data.on('end', resolve);
      response.data.on('error', reject);
    });
    send({ status: 'success', percent: 100, done: true });
    return { success: true };
  } catch (err) {
    if (controller.signal.aborted) { send({ status: 'cancelled', cancelled: true }); return { success: false, cancelled: true }; }
    const message = err?.response?.status === 404 ? 'Модель не найдена в библиотеке Ollama' : (err?.message || String(err));
    send({ status: 'error', error: message });
    return { success: false, error: message };
  } finally {
    pulls.delete(name);
  }
}

function registerOllamaIpc() {
  for (const ch of ['ollama-status', 'ollama-start', 'ollama-pull', 'ollama-pull-cancel', 'ollama-delete']) { try { ipcMain.removeHandler(ch); } catch {} }
  ipcMain.handle('ollama-status', () => status());
  ipcMain.handle('ollama-start', () => start());
  ipcMain.handle('ollama-pull', (event, name) => pull(event, String(name || '').trim()));
  ipcMain.handle('ollama-pull-cancel', (event, name) => { pulls.get(name)?.abort(); return { success: true }; });
  ipcMain.handle('ollama-delete', async (event, name) => {
    try {
      const base = await baseUrl();
      await axios.delete(`${base}/api/delete`, { data: { model: name }, timeout: 15000 });
      return { success: true };
    } catch (err) {
      return { success: false, error: err?.response?.data?.error || err.message };
    }
  });
}

module.exports = { registerOllamaIpc };
