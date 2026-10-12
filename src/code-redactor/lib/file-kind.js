/** What a file is for the editor: text to edit, an image to view, or something binary that must not be opened as text. */
const fs = require('fs').promises;
const path = require('path');

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif']);
const BINARY = new Set([
  // Python wheels and other packages
  'whl', 'egg', 'pyc', 'pyo', 'pyd', 'so', 'dylib', 'dll', 'exe', 'bin', 'o', 'a', 'lib', 'obj', 'class', 'jar', 'war', 'wasm',
  // archives and disk images
  'zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', '7z', 'rar', 'dmg', 'pkg', 'iso', 'img', 'deb', 'rpm', 'apk', 'ipa',
  // databases and data
  'db', 'sqlite', 'sqlite3', 'npy', 'npz', 'pkl', 'pickle', 'parquet', 'h5', 'hdf5', 'feather',
  // documents, media, fonts
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'xlsm', 'ppt', 'pptx', 'odt', 'ods', 'psd', 'ai', 'sketch', 'tif', 'tiff', 'heic', 'icns',
  'mp3', 'mp4', 'm4a', 'mov', 'avi', 'mkv', 'wav', 'flac', 'ogg', 'webm', 'woff', 'woff2', 'ttf', 'otf', 'eot',
]);
const MAX_TEXT = 8 * 1024 * 1024;

const extOf = (filePath) => path.extname(String(filePath || '')).slice(1).toLowerCase();

/** { content, kind }: content is null for everything that is not editable text. */
async function readForEditor(filePath) {
  const ext = extOf(filePath);
  if (IMAGE.has(ext)) return { content: null, kind: 'image' };
  if (BINARY.has(ext)) return { content: null, kind: 'binary' };
  const stat = await fs.stat(filePath);
  if (stat.size > MAX_TEXT) return { content: null, kind: 'large', size: stat.size };
  const buf = await fs.readFile(filePath);
  if (buf.subarray(0, 8000).includes(0)) return { content: null, kind: 'binary' }; // a NUL byte: not text whatever the extension says
  return { content: buf.toString('utf8'), kind: 'text' };
}

module.exports = { readForEditor, extOf, IMAGE, BINARY };
