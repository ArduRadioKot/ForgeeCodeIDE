/**
 * .gitignore support: a matcher that follows git's rules (negation, anchoring, directory-only, **, nested files)
 * and IPC for the explorer and the project search.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { ipcMain } = require('electron');

function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const before = i === 0 || glob[i - 1] === '/';
        const after = glob[i + 2] === '/' || i + 2 === glob.length;
        if (before && after) {
          i += glob[i + 2] === '/' ? 2 : 1;
          re += glob[i] === '/' ? '(?:.*/)?' : '.*';
          continue;
        }
        i++;
      }
      re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '[') {
      const end = glob.indexOf(']', i + 2);
      if (end < 0) re += '\\[';
      else { let set = glob.slice(i + 1, end); if (set[0] === '!') set = '^' + set.slice(1); re += `[${set.replace(/\\/g, '\\\\')}]`; i = end; }
    } else if (c === '\\' && i + 1 < glob.length) re += glob[++i].replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    else re += c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  }
  return re;
}

function parseRules(text, baseRel = '') {
  const rules = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    let line = raw.replace(/(?<!\\)\s+$/, '');
    if (!line || line.startsWith('#')) return;
    const negate = line.startsWith('!');
    if (negate) line = line.slice(1);
    if (line.startsWith('\\#') || line.startsWith('\\!')) line = line.slice(1);
    const dirOnly = line.endsWith('/');
    if (dirOnly) line = line.slice(0, -1);
    if (!line) return;
    const anchored = line.includes('/');
    line = line.replace(/^\//, '');
    const body = globToRegex(line);
    const re = new RegExp(anchored ? `^${body}$` : `^(?:.*/)?${body}$`);
    rules.push({ re, negate, dirOnly, base: baseRel, text: raw.trim(), line: index + 1 });
  });
  return rules;
}

function findGitRoot(start) {
  let dir = start;
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

/** Rules in force for a directory: info/exclude, then every .gitignore from the repo root down to it. */
function rulesForDir(dir, root) {
  const rules = parseRules(readText(path.join(root, '.git', 'info', 'exclude')));
  const rel = path.relative(root, dir);
  const parts = rel ? rel.split(path.sep) : [];
  let cur = root;
  rules.push(...parseRules(readText(path.join(root, '.gitignore')), ''));
  for (let i = 0; i < parts.length; i++) {
    cur = path.join(cur, parts[i]);
    rules.push(...parseRules(readText(path.join(cur, '.gitignore')), parts.slice(0, i + 1).join('/')));
  }
  return rules;
}

function matches(rules, relFromRoot, isDir) {
  let ignored = false;
  for (const rule of rules) {
    if (rule.dirOnly && !isDir) continue;
    let target = relFromRoot;
    if (rule.base) {
      if (!relFromRoot.startsWith(rule.base + '/')) continue;
      target = relFromRoot.slice(rule.base.length + 1);
    }
    if (rule.re.test(target)) ignored = !rule.negate;
  }
  return ignored;
}

/** Is the entry itself, or any directory above it, ignored? */
function isIgnored(root, absPath, isDir) {
  const rel = path.relative(root, absPath).split(path.sep).join('/');
  if (!rel || rel.startsWith('..')) return false;
  const parts = rel.split('/');
  for (let i = 0; i < parts.length; i++) {
    const sub = parts.slice(0, i + 1).join('/');
    const dirHere = i < parts.length - 1 || isDir;
    if (matches(rulesForDir(path.join(root, ...parts.slice(0, i)), root), sub, dirHere)) return true;
  }
  return false;
}

/** Marks entries of one directory listing; cheap because the rules are parsed once for the folder. */
function markIgnored(dir, entries) {
  const root = findGitRoot(dir);
  if (!root) return entries;
  const rules = rulesForDir(dir, root);
  const relDir = path.relative(root, dir).split(path.sep).join('/');
  const parentIgnored = relDir ? isIgnored(root, dir, true) : false;
  for (const e of entries) {
    if (e.name === '.git') continue;
    const rel = relDir ? `${relDir}/${e.name}` : e.name;
    if (parentIgnored || matches(rules, rel, e.isDirectory)) e.ignored = true;
  }
  return entries;
}

/** A walker-friendly checker for the project search: ignores(absPath, isDir). */
function createIgnorer(root) {
  const gitRoot = findGitRoot(root);
  if (!gitRoot) return () => false;
  const cache = new Map();
  const rulesOf = (dir) => { if (!cache.has(dir)) cache.set(dir, rulesForDir(dir, gitRoot)); return cache.get(dir); };
  return (abs, isDir) => {
    const rel = path.relative(gitRoot, abs).split(path.sep).join('/');
    return matches(rulesOf(path.dirname(abs)), rel, isDir);
  };
}

function describe(root) {
  const gitRoot = findGitRoot(root);
  const file = path.join(root, '.gitignore');
  const text = readText(file);
  const rules = text ? text.split(/\r?\n/).map((t, i) => ({ line: i + 1, text: t })).filter((r) => r.text.trim()) : [];
  return { success: true, isRepo: !!gitRoot, file: fs.existsSync(file) ? file : null, rules, active: rules.filter((r) => !r.text.trim().startsWith('#')).length };
}

function registerGitignoreIpc() {
  ipcMain.handle('gitignore-info', async (_e, root) => {
    try { return describe(root); } catch (error) { return { success: false, error: error.message }; }
  });
  console.log('[gitignore] IPC handlers registered');
}

module.exports = { registerGitignoreIpc, markIgnored, createIgnorer, isIgnored, findGitRoot };
