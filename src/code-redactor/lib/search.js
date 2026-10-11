/**
 * Project-wide search and replace: case / whole word / regex, include and exclude globs, .gitignore aware,
 * binary and huge files skipped, results capped, running searches cancellable.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { ipcMain } = require('electron');
const { createIgnorer } = require('./gitignore');

const MAX_FILE = 2 * 1024 * 1024;
const MAX_MATCHES = 3000;
const MAX_FILES = 400;
const ALWAYS_SKIP = new Set(['.git', 'node_modules', '.DS_Store', '.hg', '.svn']);
const running = new Map();

function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') re += '(?:';
    else if (c === '}') re += ')';
    else if (c === ',') re += '|';
    else re += c.replace(/[.+^$()|[\]\\/]/g, '\\$&');
  }
  return re;
}

/** "src/**, *.js" → a predicate on a relative path; patterns without "/" match the file name or any folder name. */
function globList(text) {
  const list = String(text || '').split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  if (!list.length) return null;
  const tests = list.map((g) => {
    const dirOnly = g.endsWith('/');
    const clean = g.replace(/\/$/, '').replace(/^\.?\//, '');
    const hasSlash = clean.includes('/');
    const body = globToRegex(clean);
    return {
      full: new RegExp(`^${body}(?:/.*)?$`),
      anywhere: hasSlash ? null : new RegExp(`(?:^|/)${body}(?:/|$)`),
      ext: !hasSlash && !/[*?{]/.test(clean) && !clean.includes('.') ? new RegExp(`\\.${clean.replace(/[.+^$()|[\]\\]/g, '\\$&')}$`, 'i') : null,
      dirOnly,
    };
  });
  return (rel) => tests.some((t) => t.full.test(rel) || (t.anywhere && t.anywhere.test(rel)) || (t.ext && t.ext.test(rel)));
}

function buildRegex({ query, caseSensitive, wholeWord, regex }) {
  let src = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (wholeWord) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
  return new RegExp(src, `${caseSensitive ? '' : 'i'}gu`);
}

function isBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

async function* walk(root, accept, ignorer, signal) {
  const stack = [root];
  while (stack.length) {
    if (signal.cancelled) return;
    const dir = stack.pop();
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    const dirs = [];
    for (const e of entries) {
      if (ALWAYS_SKIP.has(e.name)) continue;
      const abs = path.join(dir, e.name);
      const rel = path.relative(root, abs).split(path.sep).join('/');
      if (ignorer && ignorer(abs, e.isDirectory())) continue;
      if (e.isDirectory()) { if (accept.excludeDir(rel)) continue; dirs.push(abs); }
      else if (e.isFile()) { if (accept.file(rel)) yield { abs, rel }; }
    }
    for (let i = dirs.length - 1; i >= 0; i--) stack.push(dirs[i]);
  }
}

function acceptor(include, exclude) {
  const inc = globList(include);
  const exc = globList(exclude);
  return {
    file: (rel) => (!inc || inc(rel)) && (!exc || !exc(rel)),
    excludeDir: (rel) => !!exc && exc(rel),
  };
}

async function search(opts) {
  const { id, root, query } = opts;
  if (!root) return { success: false, error: 'Папка не открыта' };
  if (!query) return { success: true, results: [], totalMatches: 0, filesScanned: 0 };
  let re;
  try { re = buildRegex(opts); } catch (err) { return { success: false, error: 'Неверное регулярное выражение: ' + err.message }; }
  const signal = { cancelled: false };
  if (id) running.set(id, signal);
  const results = [];
  let total = 0;
  let scanned = 0;
  let truncated = false;
  try {
    const ignorer = createIgnorer(root);
    for await (const file of walk(root, acceptor(opts.include, opts.exclude), ignorer, signal)) {
      if (signal.cancelled) return { success: true, cancelled: true, results: [], totalMatches: 0 };
      let stat;
      try { stat = await fsp.stat(file.abs); } catch { continue; }
      if (stat.size > MAX_FILE) continue;
      let buf;
      try { buf = await fsp.readFile(file.abs); } catch { continue; }
      if (isBinary(buf)) continue;
      scanned++;
      const lines = buf.toString('utf8').split('\n');
      const matches = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].replace(/\r$/, '');
        if (line.length > 4000) continue;
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(line)) !== null) {
          if (m[0] === '') { re.lastIndex++; continue; }
          matches.push({ line: i + 1, col: m.index, length: m[0].length, text: line.length > 300 ? line.slice(Math.max(0, m.index - 120), m.index + m[0].length + 160) : line, offset: line.length > 300 ? Math.max(0, m.index - 120) : 0 });
          if (++total >= MAX_MATCHES) { truncated = true; break; }
        }
        if (truncated) break;
      }
      if (matches.length) {
        results.push({ file: file.rel, fullPath: file.abs, matches, matchCount: matches.length });
        if (results.length >= MAX_FILES) truncated = true;
      }
      if (truncated) break;
    }
    return { success: true, results, totalMatches: total, filesScanned: scanned, truncated };
  } catch (error) {
    return { success: false, error: error.message };
  } finally {
    if (id) running.delete(id);
  }
}

async function replaceInFiles({ root, files, query, replacement, caseSensitive, wholeWord, regex }) {
  let re;
  try { re = buildRegex({ query, caseSensitive, wholeWord, regex }); } catch (err) { return { success: false, error: err.message }; }
  const real = fs.realpathSync(root);
  let changedFiles = 0;
  let replaced = 0;
  for (const file of files || []) {
    try {
      const abs = fs.realpathSync(file);
      if (!abs.startsWith(real + path.sep)) continue; // never write outside the opened project
      const text = await fsp.readFile(abs, 'utf8');
      let n = 0;
      const out = text.replace(re, (...args) => {
        n++;
        if (!regex) return replacement;
        const groups = args.slice(1, -2).filter((a) => typeof a === 'string' || a === undefined);
        return replacement.replace(/\$(\d+|&)/g, (_, k) => (k === '&' ? args[0] : groups[Number(k) - 1] ?? ''));
      });
      if (n) { await fsp.writeFile(abs, out, 'utf8'); changedFiles++; replaced += n; }
    } catch { /* skip unreadable files */ }
  }
  return { success: true, changedFiles, replaced };
}

function registerSearchIpc() {
  ipcMain.handle('project-search', (_e, opts) => search(opts || {}));
  ipcMain.handle('project-search-cancel', (_e, id) => { const s = running.get(id); if (s) s.cancelled = true; return true; });
  ipcMain.handle('project-replace', (_e, opts) => replaceInFiles(opts || {}));
  console.log('[search] IPC handlers registered');
}

module.exports = { registerSearchIpc, search, globList };
