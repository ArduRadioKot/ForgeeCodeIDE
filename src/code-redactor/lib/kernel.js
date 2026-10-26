const { ipcMain, app } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

let resolvedWorker = null;

/**
 * Python cannot open scripts inside app.asar (Errno 20 Not a directory).
 * Prefer a real file on disk: extraResources → asar.unpacked → copy into userData.
 */
function workerPath() {
  if (resolvedWorker && fs.existsSync(resolvedWorker) && !isInsideAsar(resolvedWorker)) {
    return resolvedWorker;
  }

  const name = 'kernel_worker.py';
  const candidates = [
    // electron-builder extraResources
    process.resourcesPath && path.join(process.resourcesPath, name),
    process.resourcesPath && path.join(process.resourcesPath, 'lib', name),
    // asarUnpack next to this module
    path.join(String(__dirname).replace(/app\.asar([\\/])/, 'app.asar.unpacked$1'), name),
    process.resourcesPath && path.join(process.resourcesPath, 'app.asar.unpacked', 'lib', name),
    // development / unpackaged
    path.join(__dirname, name),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (!isInsideAsar(candidate) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        resolvedWorker = candidate;
        return resolvedWorker;
      }
    } catch { /* try next */ }
  }

  // Last resort: materialize from asar (Electron fs can read asar; Python cannot).
  const src = path.join(__dirname, name);
  const destDir = path.join(app.getPath('userData'), 'runtime');
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, name);
  const body = fs.readFileSync(src);
  // Rewrite when missing or content differs (upgrade-safe).
  let needWrite = true;
  try {
    if (fs.existsSync(dest) && fs.readFileSync(dest).equals(body)) needWrite = false;
  } catch { needWrite = true; }
  if (needWrite) fs.writeFileSync(dest, body);
  resolvedWorker = dest;
  return resolvedWorker;
}

function isInsideAsar(p) {
  // app.asar.unpacked is fine; bare app.asar/ is not
  return /(?:^|[\\/])app\.asar[\\/]/.test(String(p || '')) && !/(?:^|[\\/])app\.asar\.unpacked[\\/]/.test(String(p || ''));
}

const kernels = new Map(); // kernelId -> { proc, pythonPath, cwd, current }

function emit(getMainWindow, payload) {
  const win = getMainWindow && getMainWindow();
  if (win && !win.isDestroyed()) win.webContents.send('kernel-event', payload);
}

function stopKernel(kernelId) {
  const k = kernels.get(kernelId);
  if (!k) return;
  kernels.delete(kernelId);
  k.silent = true;
  try { k.proc.kill('SIGKILL'); } catch {}
}

function startKernel(getMainWindow, { id, pythonPath, cwd }) {
  return new Promise((resolve) => {
    const existing = kernels.get(id);
    if (existing && existing.pythonPath === pythonPath && existing.ready) {
      resolve({ success: true, reused: true, python: existing.python });
      return;
    }
    stopKernel(id);

    let script;
    try {
      script = workerPath();
    } catch (err) {
      resolve({ success: false, error: `Не удалось подготовить kernel_worker.py: ${err.message}` });
      return;
    }
    if (isInsideAsar(script)) {
      resolve({ success: false, error: `kernel_worker.py всё ещё внутри asar: ${script}` });
      return;
    }

    let proc;
    try {
      proc = spawn(pythonPath, ['-u', script], {
        cwd: cwd || os.homedir(),
        env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', MPLBACKEND: 'Agg' },
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (err) {
      resolve({ success: false, error: err.message });
      return;
    }

    const k = { proc, pythonPath, cwd, current: null, ready: false, python: '', buffer: '', startErr: '' };
    kernels.set(id, k);
    let settled = false;
    const settle = (res) => { if (!settled) { settled = true; clearTimeout(timer); resolve(res); } };
    const timer = setTimeout(() => settle({ success: false, error: 'Kernel не ответил за 20 с' }), 20000);

    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      k.buffer += chunk;
      let nl;
      while ((nl = k.buffer.indexOf('\n')) >= 0) {
        const line = k.buffer.slice(0, nl);
        k.buffer = k.buffer.slice(nl + 1);
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.type === 'ready') {
          k.ready = true;
          k.python = msg.python || '';
          settle({ success: true, python: k.python });
        }
        emit(getMainWindow, { kernelId: id, ...msg });
      }
    });
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (text) => {
      if (!k.ready) k.startErr = (k.startErr + text).slice(-1500);
      emit(getMainWindow, { kernelId: id, id: k.current, type: 'stream', name: 'stderr', text });
    });
    proc.on('error', (err) => settle({ success: false, error: err.message }));
    proc.on('exit', (code, signal) => {
      const tail = k.startErr.trim().split('\n').slice(-3).join('\n');
      settle({ success: false, error: `Kernel завершился (${signal || code})${tail ? `: ${tail}` : ''}` });
      if (kernels.get(id) === k) kernels.delete(id);
      if (!k.silent) emit(getMainWindow, { kernelId: id, type: 'dead', code, signal });
    });
  });
}

function registerKernelIpc(getMainWindow) {
  for (const ch of ['kernel-start', 'kernel-execute', 'kernel-vars', 'kernel-interrupt', 'kernel-restart', 'kernel-shutdown']) {
    try { ipcMain.removeHandler(ch); } catch {}
  }

  ipcMain.handle('kernel-start', (e, opts = {}) => startKernel(getMainWindow, opts));

  ipcMain.handle('kernel-execute', (e, { id, msgId, code, op } = {}) => {
    const k = kernels.get(id);
    if (!k || !k.ready) return { success: false, error: 'Kernel не запущен' };
    k.current = msgId;
    k.proc.stdin.write(JSON.stringify({ id: msgId, op: op || 'exec', code: code || '' }) + '\n');
    return { success: true };
  });

  ipcMain.handle('kernel-vars', (e, { id, msgId } = {}) => {
    const k = kernels.get(id);
    if (!k || !k.ready) return { success: false, error: 'Kernel не запущен' };
    k.proc.stdin.write(JSON.stringify({ id: msgId, op: 'vars' }) + '\n');
    return { success: true };
  });

  ipcMain.handle('kernel-interrupt', (e, { id } = {}) => {
    const k = kernels.get(id);
    if (!k) return { success: false, error: 'Kernel не запущен' };
    if (process.platform === 'win32') return { success: false, error: 'Прерывание недоступно в Windows — перезапустите ядро' };
    try { k.proc.kill('SIGINT'); return { success: true }; } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('kernel-restart', async (e, opts = {}) => {
    stopKernel(opts.id);
    return startKernel(getMainWindow, opts);
  });

  ipcMain.handle('kernel-shutdown', (e, { id } = {}) => {
    stopKernel(id);
    return { success: true };
  });
}

function killAllKernels() {
  for (const id of [...kernels.keys()]) stopKernel(id);
}

module.exports = { registerKernelIpc, killAllKernels, workerPath };
