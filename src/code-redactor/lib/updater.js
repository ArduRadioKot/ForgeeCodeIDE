/** Update checks and downloads for the packaged Electron app. */
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { spawn, execFile } = require('node:child_process');

const REPO = 'ArduRadioKot/ForgeeCodeIDE';
const RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASE_PAGE = `https://github.com/${REPO}/releases/latest`;
const MAX_DOWNLOAD = 1024 * 1024 * 1024;

function compareVersions(a, b) {
  const parts = (value) => String(value || '').replace(/^v/i, '').split(/[.+-]/).filter(Boolean).map((part) => /^\d+$/.test(part) ? Number(part) : part);
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const x = left[i] ?? 0;
    const y = right[i] ?? 0;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x < y ? -1 : 1;
    return String(x) < String(y) ? -1 : 1;
  }
  return 0;
}

function pickAsset(assets, env) {
  const list = Array.isArray(assets) ? assets.filter((asset) => asset && typeof asset.name === 'string') : [];
  const compatible = (asset) => {
    const name = asset.name.toLowerCase();
    const tagged = /(?:^|[ ._-])(arm64|aarch64|x64|x86_64|ia32|x86)(?:[ ._-]|$)/i.exec(name)?.[1];
    if (!tagged) return true;
    if (env.arch === 'arm64') return tagged === 'arm64' || tagged === 'aarch64';
    if (env.arch === 'ia32') return tagged === 'ia32' || tagged === 'x86';
    return tagged === 'x64' || tagged === 'x86_64';
  };
  const find = (pattern) => list.find((asset) => pattern.test(asset.name) && compatible(asset)) || null;
  if (env.platform === 'darwin') return find(/\.dmg$/i);
  if (env.platform === 'win32') return find(/(?:setup|installer).*\.exe$/i) || find(/\.exe$/i);
  if (env.platform === 'linux') return find(/\.AppImage$/i) || find(/\.deb$/i);
  return null;
}

function installPlan(env, asset) {
  if (!asset) return 'browser';
  const name = String(asset.name || '');
  if (env.platform === 'darwin' && /\.dmg$/i.test(name)) return 'mac';
  if (env.platform === 'win32' && /(?:setup|installer).*\.exe$/i.test(name)) return 'windows';
  if (env.platform === 'linux' && env.appImage && /\.AppImage$/i.test(name)) return 'appimage';
  return 'manual';
}

function describeRelease(release, current, env) {
  const latest = String(release?.tag_name || '').replace(/^v/i, '');
  return {
    current: String(current),
    latest,
    available: !!latest && compareVersions(latest, current) > 0,
    notes: String(release?.body || '').trim().slice(0, 1200),
    url: /^https:\/\/github\.com\/ArduRadioKot\/ForgeeCodeIDE\/releases\//.test(release?.html_url || '') ? release.html_url : RELEASE_PAGE,
    asset: pickAsset(release?.assets, env),
  };
}

function isAllowedUrl(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && (url.hostname === 'api.github.com' || url.hostname === 'github.com' || url.hostname.endsWith('.githubusercontent.com'));
  } catch { return false; }
}

function request(raw, headers, depth = 0) {
  if (!isAllowedUrl(raw)) return Promise.reject(new Error('Недопустимый адрес обновления'));
  return new Promise((resolve, reject) => {
    const req = https.get(raw, { headers }, (response) => {
      const code = response.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(code) && response.headers.location) {
        response.resume();
        if (depth >= 5) { reject(new Error('Слишком много перенаправлений')); return; }
        request(new URL(response.headers.location, raw).href, headers, depth + 1).then(resolve, reject);
        return;
      }
      resolve(response);
    });
    req.setTimeout(20000, () => req.destroy(new Error('Время ожидания GitHub истекло')));
    req.on('error', reject);
  });
}

async function readJson(response) {
  if (response.statusCode !== 200) {
    response.resume();
    throw new Error(response.statusCode === 403 ? 'GitHub временно ограничил запросы' : 'Не удалось проверить релиз');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw new Error('Ответ GitHub слишком большой');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function safeName(value) {
  const name = String(value || '');
  return /^[A-Za-z0-9][A-Za-z0-9._ -]{0,179}$/.test(name) && path.basename(name) === name ? name : '';
}

function launchDetached(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', env: { ...process.env, ...env } });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout));
  });
}

function makeScript(dir, body) {
  const file = path.join(dir, process.platform === 'win32' ? 'install.ps1' : 'install.sh');
  fs.writeFileSync(file, body, { mode: 0o700 });
  return file;
}

async function installMac(dmg, dir) {
  const bundle = path.resolve(process.execPath, '../../..');
  if (!bundle.endsWith('.app')) throw new Error('Не удалось определить приложение');
  const plist = await run('hdiutil', ['attach', '-nobrowse', '-readonly', '-plist', dmg]);
  const volume = [...plist.matchAll(/<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/g)].map((match) => match[1]).find((point) => point.startsWith('/Volumes/'));
  if (!volume) throw new Error('Не удалось открыть образ диска');
  const source = path.join(volume, 'FrogeeCodeIDE.app');
  if (!fs.existsSync(path.join(source, 'Contents', 'Info.plist'))) {
    execFile('hdiutil', ['detach', volume], () => {});
    throw new Error('В образе нет FrogeeCodeIDE.app');
  }
  const script = [
    'while kill -0 "$UPDATE_PID" 2>/dev/null; do sleep 0.3; done',
    'if ! cp -R "$UPDATE_SOURCE" "$UPDATE_STAGE"; then open "$UPDATE_VOLUME"; exit 1; fi',
    'if ! mv "$UPDATE_TARGET" "$UPDATE_BACKUP"; then rm -rf "$UPDATE_STAGE"; open "$UPDATE_VOLUME"; exit 1; fi',
    'if ! mv "$UPDATE_STAGE" "$UPDATE_TARGET"; then mv "$UPDATE_BACKUP" "$UPDATE_TARGET"; open "$UPDATE_VOLUME"; exit 1; fi',
    'xattr -dr com.apple.quarantine "$UPDATE_TARGET" 2>/dev/null || true',
    'codesign --force --deep --sign - --timestamp=none "$UPDATE_TARGET" >/dev/null 2>&1 || true',
    'rm -rf "$UPDATE_BACKUP"',
    'hdiutil detach "$UPDATE_VOLUME" >/dev/null 2>&1 || true',
    'open "$UPDATE_TARGET"',
  ].join('\n');
  const scriptFile = makeScript(dir, script);
  const suffix = `${Date.now()}-${process.pid}`;
  await launchDetached('sh', [scriptFile], {
    UPDATE_PID: String(process.pid), UPDATE_SOURCE: source, UPDATE_VOLUME: volume,
    UPDATE_TARGET: bundle, UPDATE_STAGE: `${bundle}.new-${suffix}`, UPDATE_BACKUP: `${bundle}.previous-${suffix}`,
  });
}

async function installWindows(file, dir) {
  const script = [
    '$target = [int]$env:UPDATE_PID',
    'while (Get-Process -Id $target -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 400 }',
    'Start-Process -FilePath $env:UPDATE_FILE -ArgumentList "/S"',
  ].join('; ');
  await launchDetached('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-File', makeScript(dir, script)], {
    UPDATE_PID: String(process.pid), UPDATE_FILE: file,
  });
}

async function installAppImage(file, dir) {
  const current = process.env.APPIMAGE;
  if (!current) throw new Error('Приложение запущено не как AppImage');
  const script = [
    'while kill -0 "$UPDATE_PID" 2>/dev/null; do sleep 0.3; done',
    'if ! mv "$UPDATE_FILE" "$UPDATE_TARGET"; then exit 1; fi',
    'chmod +x "$UPDATE_TARGET"',
    '"$UPDATE_TARGET" >/dev/null 2>&1 &',
  ].join('\n');
  await launchDetached('sh', [makeScript(dir, script)], {
    UPDATE_PID: String(process.pid), UPDATE_FILE: file, UPDATE_TARGET: current,
  });
}

function registerUpdaterIpc({ app, ipcMain, BrowserWindow, shell }) {
  let pending = null;
  let downloading = null;
  const environment = () => ({ platform: process.platform, arch: process.arch, appImage: !!process.env.APPIMAGE });
  const headers = { 'User-Agent': `FrogeeCodeIDE/${app.getVersion()}`, Accept: 'application/vnd.github+json', 'Accept-Encoding': 'identity' };

  function publicInfo() {
    if (!pending) return { ok: false, error: 'Обновления ещё не проверены' };
    const { info, asset } = pending;
    return { ok: true, ...info, packaged: app.isPackaged, installMode: installPlan(environment(), asset), asset: asset ? { name: asset.name, size: asset.size || 0 } : null };
  }

  async function check() {
    if (downloading && pending) return publicInfo();
    const release = await readJson(await request(RELEASE_API, headers));
    const info = describeRelease(release, app.getVersion(), environment());
    const asset = info.asset && safeName(info.asset.name) && isAllowedUrl(info.asset.browser_download_url) ? info.asset : null;
    const sameDownloaded = pending?.file && pending.info.latest === info.latest && pending.asset?.name === asset?.name && fs.existsSync(pending.file);
    pending = { info, asset, file: sameDownloaded ? pending.file : null, dir: sameDownloaded ? pending.dir : null };
    return publicInfo();
  }

  async function download() {
    if (downloading) return downloading;
    downloading = (async () => {
      if (!pending) await check();
      const current = pending;
      if (!current.info.available) return { ok: false, error: 'Установлена последняя версия' };
      if (!current.asset) return { ok: false, error: 'Для этой системы нет файла в релизе' };
      if (current.file && fs.existsSync(current.file)) return { ok: true, name: current.asset.name, size: fs.statSync(current.file).size };
      const dir = fs.mkdtempSync(path.join(app.getPath('temp'), 'frogeecodeide-update-'));
      const destination = path.join(dir, safeName(current.asset.name));
      const response = await request(current.asset.browser_download_url, { ...headers, Accept: 'application/octet-stream' });
      if (response.statusCode !== 200) { response.resume(); throw new Error('Не удалось скачать обновление'); }
      const total = Number(response.headers['content-length']) || Number(current.asset.size) || 0;
      if (total > MAX_DOWNLOAD) { response.resume(); throw new Error('Файл обновления слишком большой'); }
      const hash = crypto.createHash('sha256');
      let received = 0;
      const meter = new Transform({
        transform(chunk, _encoding, callback) {
          received += chunk.length;
          if (received > MAX_DOWNLOAD) { callback(new Error('Файл обновления слишком большой')); return; }
          hash.update(chunk);
          for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) win.webContents.send('updates-progress', { received, total });
          }
          callback(null, chunk);
        },
      });
      try {
        await pipeline(response, meter, fs.createWriteStream(destination));
        if (total && total !== received) throw new Error('Файл обновления скачан не полностью');
        const digest = String(current.asset.digest || '').toLowerCase();
        if (digest.startsWith('sha256:') && hash.digest('hex') !== digest.slice(7)) throw new Error('Контрольная сумма обновления не совпала');
        current.file = destination;
        current.dir = dir;
        return { ok: true, name: current.asset.name, size: received };
      } catch (error) {
        fs.rmSync(dir, { recursive: true, force: true });
        throw error;
      }
    })();
    try { return await downloading; } finally { downloading = null; }
  }

  for (const channel of ['updates-current', 'updates-check', 'updates-download', 'updates-install']) {
    try { ipcMain.removeHandler(channel); } catch { /* first registration */ }
  }
  ipcMain.handle('updates-current', () => ({ version: app.getVersion(), packaged: app.isPackaged }));
  ipcMain.handle('updates-check', async () => {
    try { return await check(); } catch (error) { return { ok: false, error: error.message || 'Не удалось проверить обновления' }; }
  });
  ipcMain.handle('updates-download', async () => {
    try { return await download(); } catch (error) { return { ok: false, error: error.message || 'Не удалось скачать обновление' }; }
  });
  ipcMain.handle('updates-install', async () => {
    try {
      if (!app.isPackaged) return { ok: false, error: 'Установка доступна только в собранном приложении' };
      if (!pending?.file || !fs.existsSync(pending.file)) return { ok: false, error: 'Сначала скачайте обновление' };
      const plan = installPlan(environment(), pending.asset);
      if (plan === 'browser' || plan === 'manual') {
        shell.showItemInFolder(pending.file);
        return { ok: true, mode: 'manual', message: 'Обновление скачано. Установите файл вручную.' };
      }
      if (plan === 'mac') await installMac(pending.file, pending.dir);
      else if (plan === 'windows') await installWindows(pending.file, pending.dir);
      else if (plan === 'appimage') await installAppImage(pending.file, pending.dir);
      setImmediate(() => app.quit());
      return { ok: true, mode: 'restart' };
    } catch (error) { return { ok: false, error: error.message || 'Не удалось установить обновление' }; }
  });
}

module.exports = { compareVersions, pickAsset, installPlan, describeRelease, isAllowedUrl, registerUpdaterIpc };
