/**
 * Python interpreters for the notebook kernel picker, found the way VS Code does it:
 *  1. virtual environments of the project: next to the file, in every parent folder up to the project / home,
 *     under their usual names, and anywhere below the project (a folder with pyvenv.cfg, whatever it is called);
 *  2. environments kept in well-known places: ~/.virtualenvs, pyenv, poetry, pipenv, conda (also those listed in ~/.conda/environments.txt);
 *  3. Python installations: Homebrew, python.org, the system one, the Windows "py" launcher.
 * A packaged macOS app starts with a bare PATH, so nothing here depends on it.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const IS_WIN = process.platform === 'win32';
const HOME = os.homedir();

const VENV_NAMES = ['.venv', 'venv', '.virtualenv', 'virtualenv', 'env', '.env', '.conda', 'conda'];
const SKIP_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', '__pycache__', 'site-packages', 'dist', 'build', '.idea', '.vscode', '.cache', '.tox', '.mypy_cache', '.pytest_cache', 'target', 'Library', 'Applications', '.Trash']);
const MAX_SCAN_DIRS = 3000;
const SCAN_DEPTH = 4;

const exists = (p) => { try { fs.accessSync(p, fs.constants.F_OK); return true; } catch { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isExecutable = (p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } };

function pythonBinInEnv(envRoot) {
  const candidates = IS_WIN
    ? [path.join(envRoot, 'Scripts', 'python.exe'), path.join(envRoot, 'python.exe')]
    : [path.join(envRoot, 'bin', 'python3'), path.join(envRoot, 'bin', 'python')];
  return candidates.find((p) => exists(p) && (IS_WIN || isExecutable(p))) || null;
}

function shortPath(p, base) {
  if (!p) return '';
  if (base && (p === base || p.startsWith(base + path.sep))) { const rel = path.relative(base, p); return rel ? `./${rel}` : '.'; }
  return p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p;
}

// A bare PATH is common for GUI apps: give the interpreters the usual places to find their tools.
function toolEnv() {
  const extra = IS_WIN ? [] : ['/opt/homebrew/bin', '/usr/local/bin', path.join(HOME, '.local', 'bin')];
  return { ...process.env, PATH: [...extra, process.env.PATH || ''].filter(Boolean).join(path.delimiter) };
}

const probeCache = new Map();
async function probePython(pythonPath) {
  if (probeCache.has(pythonPath)) return probeCache.get(pythonPath);
  const job = execFileAsync(pythonPath, ['-c', 'import sys; print(sys.version.split()[0]); print(sys.prefix)'], { timeout: 4000, env: toolEnv() })
    .then(({ stdout }) => {
      const lines = String(stdout || '').trim().split(/\r?\n/);
      return { version: lines[0] || '', prefix: lines[1] || '' };
    })
    .catch(() => ({ version: '', prefix: '' }));
  probeCache.set(pythonPath, job);
  const result = await job;
  if (!result.version) probeCache.delete(pythonPath); // do not remember a failure
  return result;
}

function kindOfEnv(envRoot) {
  return exists(path.join(envRoot, 'conda-meta')) ? 'conda-env' : 'venv';
}

function makeEntry({ pythonPath, kind, envName, base, version, preferred }) {
  const v = version ? `Python ${version}` : 'Python';
  const label = kind === 'system' ? `${v} (system)` : kind === 'conda-env' ? `${v} ('${envName}': conda)` : `${v} ('${envName}': venv)`;
  return {
    id: pythonPath, name: envName, display_name: label, detail: shortPath(pythonPath, base), pythonPath,
    language: 'python', kind, version: version || '', preferred: !!preferred, workspace: !!preferred,
  };
}

// ───────────────────────── project environments ─────────────────────────

/** The folders to look in: the file's folder, every parent up to the project / a git repo / home, and the project itself. */
function projectRoots(workspace, project) {
  const roots = new Set();
  const stop = project ? path.resolve(project) : null;
  for (const start of [workspace, project].filter(Boolean)) {
    let dir = path.resolve(start);
    for (let i = 0; i < 8 && dir; i++) {
      roots.add(dir);
      if (dir === HOME || dir === path.dirname(dir) || (stop && dir === stop && start === project)) break;
      if (exists(path.join(dir, '.git')) || (stop && dir === stop)) break;
      dir = path.dirname(dir);
    }
  }
  return [...roots];
}

/** Folders below `root` that look like a virtual environment (they contain pyvenv.cfg or are named like one). */
async function scanForEnvs(root, found, budget) {
  const queue = [[root, 0]];
  while (queue.length && budget.left > 0) {
    const [dir, depth] = queue.shift();
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    budget.left--;
    for (const ent of entries) {
      if (!ent.isDirectory() && !ent.isSymbolicLink()) continue;
      const full = path.join(dir, ent.name);
      const named = VENV_NAMES.includes(ent.name);
      if (SKIP_DIRS.has(ent.name) || (ent.name.startsWith('.') && !named)) continue;
      if (exists(path.join(full, 'pyvenv.cfg')) || (named && isDir(full) && pythonBinInEnv(full))) {
        const py = pythonBinInEnv(full);
        if (py) found.set(full, py);
        continue; // never descend into an environment
      }
      if (depth + 1 < SCAN_DEPTH && isDir(full)) queue.push([full, depth + 1]);
    }
  }
}

async function findProjectEnvs(workspace, project) {
  const roots = projectRoots(workspace, project);
  const found = new Map(); // env root -> python
  const budget = { left: MAX_SCAN_DIRS };
  // usual names right in each folder (cheap, also for folders above the project)
  for (const root of roots) {
    for (const name of VENV_NAMES) {
      const envRoot = path.join(root, name);
      if (isDir(envRoot)) { const py = pythonBinInEnv(envRoot); if (py) found.set(envRoot, py); }
    }
  }
  // and any environment below the project (monorepos, "api/venv", "services/x/.venv", custom names)
  const below = [project, workspace].filter(Boolean).map((p) => path.resolve(p));
  for (const root of new Set(below)) await scanForEnvs(root, found, budget);

  const base = project || workspace;
  return Promise.all([...found].map(async ([envRoot, py]) => {
    const probe = await probePython(py);
    const rel = path.relative(base || envRoot, envRoot);
    return makeEntry({ pythonPath: py, kind: kindOfEnv(envRoot), envName: rel && !rel.startsWith('..') ? rel : path.basename(envRoot), base, version: probe.version, preferred: true });
  }));
}

// ───────────────────────── environments in well-known places ─────────────────────────

function childDirs(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() || e.isSymbolicLink()).map((e) => path.join(dir, e.name)); } catch { return []; }
}

function condaRoots() {
  const roots = ['miniconda3', 'anaconda3', 'miniforge3', 'mambaforge', 'micromamba', 'opt/miniconda3', 'opt/anaconda3'].map((n) => path.join(HOME, n));
  roots.push('/opt/homebrew/Caskroom/miniconda/base', '/opt/homebrew/Caskroom/miniforge/base', '/opt/miniconda3', '/opt/anaconda3', '/usr/local/anaconda3', '/usr/local/miniconda3');
  if (IS_WIN) roots.push('C:\\ProgramData\\miniconda3', 'C:\\ProgramData\\anaconda3', path.join(process.env.LOCALAPPDATA || '', 'miniconda3'));
  return roots.filter((r) => r && isDir(r));
}

async function findKnownEnvs() {
  const dirs = new Map(); // env root -> env name
  const add = (root, name) => { if (root && isDir(root) && !dirs.has(root)) dirs.set(root, name || path.basename(root)); };

  for (const d of childDirs(path.join(HOME, '.virtualenvs'))) add(d);
  for (const d of childDirs(path.join(HOME, '.local', 'share', 'virtualenvs'))) add(d); // pipenv
  for (const d of childDirs(path.join(HOME, '.pyenv', 'versions'))) { add(d, `pyenv ${path.basename(d)}`); for (const e of childDirs(path.join(d, 'envs'))) add(e); }
  for (const d of childDirs(path.join(HOME, '.pyenv-win', 'versions'))) add(d, `pyenv ${path.basename(d)}`);
  const poetry = [path.join(HOME, 'Library', 'Caches', 'pypoetry', 'virtualenvs'), path.join(HOME, '.cache', 'pypoetry', 'virtualenvs'), path.join(process.env.LOCALAPPDATA || '', 'pypoetry', 'Cache', 'virtualenvs')];
  for (const p of poetry) for (const d of childDirs(p)) add(d);
  for (const root of condaRoots()) { add(root, 'base'); for (const d of childDirs(path.join(root, 'envs'))) add(d); }
  try { // conda lists every environment it created here
    for (const line of fs.readFileSync(path.join(HOME, '.conda', 'environments.txt'), 'utf8').split(/\r?\n/)) if (line.trim()) add(line.trim());
  } catch { /* no conda */ }

  return Promise.all([...dirs].map(async ([envRoot, name]) => {
    const py = pythonBinInEnv(envRoot);
    if (!py) return null;
    const probe = await probePython(py);
    return probe.version ? makeEntry({ pythonPath: py, kind: kindOfEnv(envRoot), envName: name, base: null, version: probe.version, preferred: false }) : null;
  }));
}

// ───────────────────────── interpreters ─────────────────────────

async function findSystemPythons() {
  const candidates = new Set();
  const addBins = (dir) => { try { for (const f of fs.readdirSync(dir)) if (/^python3?(\.\d+)?(\.exe)?$/.test(f)) candidates.add(path.join(dir, f)); } catch { /* no such folder */ } };
  if (IS_WIN) {
    for (const base of [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Python'), process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) {
      for (const d of childDirs(base)) if (/^Python\d+/i.test(path.basename(d))) addBins(d);
    }
    try { // the py launcher knows where every installed Python is
      const { stdout } = await execFileAsync('py', ['-0p'], { timeout: 4000 });
      for (const line of String(stdout).split(/\r?\n/)) { const m = /([A-Za-z]:\\.*python[^\\]*\.exe)\s*$/i.exec(line); if (m) candidates.add(m[1]); }
    } catch { /* no launcher */ }
  } else {
    ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', path.join(HOME, '.local', 'bin')].forEach(addBins);
    try { for (const v of fs.readdirSync('/Library/Frameworks/Python.framework/Versions')) addBins(path.join('/Library/Frameworks/Python.framework/Versions', v, 'bin')); } catch { /* none */ }
  }
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) if (dir) addBins(dir);

  // several names usually lead to one interpreter (python3 -> python3.11): list it once
  const byReal = new Map();
  for (const c of [...candidates].sort((a, b) => a.length - b.length)) {
    let real = c;
    try { real = fs.realpathSync(c); } catch { continue; }
    if (!byReal.has(real)) byReal.set(real, c);
  }
  const found = await Promise.all([...byReal.values()].map(async (p) => {
    const probe = await probePython(p);
    return probe.version ? makeEntry({ pythonPath: p, kind: 'system', envName: path.basename(p), base: null, version: probe.version, preferred: false }) : null;
  }));
  return found.filter(Boolean);
}

/**
 * @param {string|{workspace?:string, project?:string, extra?:string[]}} arg  a folder, or the file's folder + the project + interpreters to include as they are
 */
async function listPythonEnvironments(arg) {
  const opts = typeof arg === 'object' && arg ? arg : { workspace: arg, project: arg };
  const [project, known, system] = await Promise.all([findProjectEnvs(opts.workspace, opts.project), findKnownEnvs(), findSystemPythons()]);
  const extra = await Promise.all((opts.extra || []).filter((p) => p && exists(p)).map(async (p) => {
    const probe = await probePython(p);
    if (!probe.version) return null;
    const root = path.dirname(path.dirname(p));
    return makeEntry({ pythonPath: p, kind: exists(path.join(root, 'pyvenv.cfg')) ? kindOfEnv(root) : 'system', envName: path.basename(root), base: opts.project || opts.workspace, version: probe.version, preferred: false });
  }));

  const byPath = new Map();
  for (const env of [...project, ...known.filter(Boolean), ...system, ...extra.filter(Boolean)]) {
    if (!env.pythonPath) continue;
    const key = path.normalize(env.pythonPath);
    const prev = byPath.get(key);
    if (!prev || (env.preferred && !prev.preferred)) byPath.set(key, { ...env, pythonPath: key, id: key });
  }
  const rank = (e) => (e.preferred ? 0 : e.kind === 'venv' ? 1 : e.kind === 'conda-env' ? 2 : 3);
  return [...byPath.values()].sort((a, b) => rank(a) - rank(b) || String(a.display_name).localeCompare(String(b.display_name)));
}

module.exports = { listPythonEnvironments, pythonBinInEnv, probePython };
