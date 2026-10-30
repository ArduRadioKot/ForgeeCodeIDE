/**
 * electron-builder downloads Electron zips with a Go binary (app-builder)
 * whose DNS resolver on macOS queries [::1]:53 and fails with
 * "connection refused". Node uses the system resolver, so fetch the zips
 * into the cache app-builder already checks before it tries the network.
 *
 * Usage: node scripts/prefetch-electron.js darwin win32 linux
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');

const version = require('electron/package.json').version.replace(/^v/, '');
const arch = process.arch;
const platforms = process.argv.slice(2);
if (platforms.length === 0) platforms.push(process.platform);

function cacheDir() {
  if (process.env.ELECTRON_CACHE) return process.env.ELECTRON_CACHE;
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Caches', 'electron');
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(local, 'electron', 'Cache');
  }
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'electron');
}

function mirrorBase() {
  const mirror = process.env.ELECTRON_MIRROR || process.env.npm_config_electron_mirror;
  if (!mirror) return 'https://github.com/electron/electron/releases/download/';
  return mirror.endsWith('/') ? mirror : `${mirror}/`;
}

function artifactUrl(name) {
  return `${mirrorBase()}v${version}/${name}`;
}

async function readShasums(dir) {
  const file = path.join(dir, `SHASUMS256.txt-${version}`);
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  const url = artifactUrl('SHASUMS256.txt');
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'FrogeeCodeIDE-build' } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  const text = await res.text();
  fs.writeFileSync(file, text);
  return text;
}

function expectedHash(shasums, name) {
  for (const line of shasums.split('\n')) {
    const match = /^([a-f0-9]{64})\s+\*?(\S+)/.exec(line.trim());
    if (match && match[2] === name) return match[1];
  }
  throw new Error(`SHASUMS256 has no entry for ${name}`);
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'FrogeeCodeIDE-build' } });
  if (!res.ok || !res.body) throw new Error(`GET ${url} -> ${res.status}`);
  const tmp = `${dest}.partial`;
  const hash = crypto.createHash('sha256');
  const hasher = new Transform({
    transform(chunk, _enc, cb) {
      hash.update(chunk);
      cb(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body), hasher, fs.createWriteStream(tmp));
  return { tmp, hash: hash.digest('hex') };
}

async function ensureZip(dir, platform, shasums) {
  const name = `electron-v${version}-${platform}-${arch}.zip`;
  const dest = path.join(dir, name);
  const want = expectedHash(shasums, name);
  if (fs.existsSync(dest) && (await sha256File(dest)) === want) {
    console.log(`electron cache hit ${name}`);
    return;
  }
  const url = artifactUrl(name);
  console.log(`downloading ${name}`);
  const { tmp, hash } = await download(url, dest);
  if (hash !== want) {
    fs.unlinkSync(tmp);
    throw new Error(`${name} checksum ${hash} != ${want}`);
  }
  fs.renameSync(tmp, dest);
  console.log(`cached ${name}`);
}

async function main() {
  const dir = cacheDir();
  fs.mkdirSync(dir, { recursive: true });
  const shasums = await readShasums(dir);
  for (const platform of platforms) {
    await ensureZip(dir, platform, shasums);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
