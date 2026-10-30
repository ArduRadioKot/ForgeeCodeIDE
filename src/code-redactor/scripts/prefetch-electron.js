/**
 * electron-builder downloads Electron zips with a Go binary (app-builder)
 * whose DNS resolver on macOS queries [::1]:53 and fails with
 * "connection refused". Node uses the system resolver, so fetch the zips
 * into the cache app-builder already checks before it tries the network.
 *
 * Usage: node scripts/prefetch-electron.js darwin win32 linux
 */
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');

const version = require('electron/package.json').version.replace(/^v/, '');
const arch = process.arch;

const LINUX_TOOLS = {
  arm64: {
    file: 'linux-tools-mac-darwin-arm64.tar.gz',
    sha256: '204e76f08364352edb28a6a4be87e8f9bd9340213865d9a0d1c664aa46fcf053',
  },
  x64: {
    file: 'linux-tools-mac-darwin-x86_64.tar.gz',
    sha256: '7ee26dfbd0d2a4c2c83b55a9416a30cc84876eef01c6497ca49bb016a190c726',
  },
};

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

async function prefetch(platforms) {
  const list = platforms && platforms.length ? platforms : [process.platform];
  const dir = cacheDir();
  fs.mkdirSync(dir, { recursive: true });
  const shasums = await readShasums(dir);
  for (const platform of list) {
    await ensureZip(dir, platform, shasums);
  }
}

/**
 * macOS /usr/bin/ar is BSD ar. It drops non-Mach-O members and writes a
 * 96-byte deb that contains only __.SYMDEF. GNU ar from electron-builder's
 * linux-tools-mac toolset produces a real Debian package.
 * Returns the bin directory, or null when it is not needed.
 */
async function ensureLinuxTools() {
  if (process.platform !== 'darwin') return null;
  const spec = LINUX_TOOLS[arch === 'arm64' ? 'arm64' : 'x64'];
  if (!spec) return null;
  const root = path.join(cacheDir(), `linux-tools-mac-1.0.0-${arch === 'arm64' ? 'arm64' : 'x64'}`);
  const tgz = path.join(root, spec.file);
  const extracted = path.join(root, 'extracted');
  const bin = path.join(extracted, 'linux-tools-mac', 'bin');
  fs.mkdirSync(root, { recursive: true });
  const valid = fs.existsSync(tgz) && (await sha256File(tgz)) === spec.sha256;
  if (!valid) {
    const url = `https://github.com/electron-userland/electron-builder-binaries/releases/download/linux-tools-mac@1.0.0/${spec.file}`;
    console.log(`downloading ${spec.file}`);
    const { tmp, hash } = await download(url, tgz);
    if (hash !== spec.sha256) {
      fs.unlinkSync(tmp);
      throw new Error(`${spec.file} checksum ${hash} != ${spec.sha256}`);
    }
    fs.renameSync(tmp, tgz);
    fs.rmSync(extracted, { recursive: true, force: true });
  }
  if (!fs.existsSync(path.join(bin, 'ar'))) {
    fs.mkdirSync(extracted, { recursive: true });
    const tar = spawnSync('tar', ['-xzf', tgz, '-C', extracted], { stdio: 'inherit' });
    if (tar.status !== 0) throw new Error(`failed to extract ${spec.file}`);
  }
  if (!fs.existsSync(path.join(bin, 'ar'))) throw new Error('GNU ar is missing from linux-tools-mac');
  console.log(`linux tools cache hit ${spec.file}`);
  return bin;
}

module.exports = { prefetch, ensureLinuxTools };

if (require.main === module) {
  prefetch(process.argv.slice(2)).catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
