/**
 * Prefetch Electron zips with Node (app-builder's DNS resolver fails on
 * macOS), put GNU ar on PATH so .deb packages are real archives, then
 * run electron-builder with the given arguments.
 */
const { spawnSync } = require('child_process');
const path = require('path');
const { prefetch, ensureLinuxTools } = require('./prefetch-electron');

const args = process.argv.slice(2);

function platformsFor(builderArgs) {
  const platforms = [];
  if (builderArgs.includes('--mac')) platforms.push('darwin');
  if (builderArgs.includes('--win')) platforms.push('win32');
  if (builderArgs.includes('--linux')) platforms.push('linux');
  if (platforms.length === 0) platforms.push(process.platform);
  return platforms;
}

async function main() {
  const platforms = platformsFor(args);
  await prefetch(platforms);
  const env = { ...process.env };
  if (platforms.includes('linux')) {
    const bin = await ensureLinuxTools();
    if (bin) {
      env.PATH = `${bin}${path.delimiter}${env.PATH || ''}`;
      const lib = path.join(bin, '..', 'lib');
      env.DYLD_LIBRARY_PATH = [lib, env.DYLD_LIBRARY_PATH].filter(Boolean).join(path.delimiter);
    }
  }
  const cli = path.join(__dirname, '..', 'node_modules', 'electron-builder', 'cli.js');
  const result = spawnSync(process.execPath, [cli, ...args], { stdio: 'inherit', env });
  process.exit(result.status == null ? 1 : result.status);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
