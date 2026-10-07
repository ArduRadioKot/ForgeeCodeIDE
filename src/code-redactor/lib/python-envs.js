const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const WORKSPACE_VENV_NAMES = [
  '.venv',
  'venv',
  '.virtualenv',
  'virtualenv',
  'env',
  '.env',
  '.conda',
  'conda'
];

function isExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function exists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function pythonBinInEnv(envRoot) {
  if (process.platform === 'win32') {
    const candidates = [
      path.join(envRoot, 'Scripts', 'python.exe'),
      path.join(envRoot, 'python.exe')
    ];
    return candidates.find((p) => exists(p)) || null;
  }
  const candidates = [
    path.join(envRoot, 'bin', 'python3'),
    path.join(envRoot, 'bin', 'python')
  ];
  return candidates.find((p) => exists(p) && isExecutable(p)) || null;
}

function shortPath(p, workspace) {
  if (!p) return '';
  if (workspace && p.startsWith(workspace)) {
    const rel = path.relative(workspace, p);
    return rel ? `./${rel}` : '.';
  }
  const home = os.homedir();
  if (p.startsWith(home)) return `~${p.slice(home.length)}`;
  return p;
}

async function probePython(pythonPath) {
  try {
    const { stdout } = await execFileAsync(pythonPath, ['-c', 'import sys; print(sys.version.split()[0]); print(sys.prefix)'], {
      timeout: 4000,
      env: process.env
    });
    const lines = String(stdout || '').trim().split(/\r?\n/);
    return {
      version: lines[0] || '',
      prefix: lines[1] || path.dirname(path.dirname(pythonPath))
    };
  } catch {
    return { version: '', prefix: '' };
  }
}

function makeEnvEntry({ pythonPath, kind, envName, workspace, version, preferred }) {
  const displayVersion = version ? `Python ${version}` : 'Python';
  let label;
  if (kind === 'venv' || kind === 'virtualenv' || kind === 'conda-env') {
    label = `${displayVersion} ('${envName}': ${kind === 'conda-env' ? 'conda' : 'venv'})`;
  } else if (kind === 'system') {
    label = `${displayVersion} (system)`;
  } else {
    label = `${displayVersion}`;
  }
  return {
    id: pythonPath,
    name: envName || path.basename(path.dirname(path.dirname(pythonPath))),
    display_name: label,
    detail: shortPath(pythonPath, workspace),
    pythonPath,
    language: 'python',
    kind,
    version: version || '',
    preferred: !!preferred,
    workspace: !!preferred
  };
}

async function findWorkspaceVenvs(workspace) {
  if (!workspace) return [];
  const found = [];
  for (const name of WORKSPACE_VENV_NAMES) {
    const envRoot = path.join(workspace, name);
    if (!exists(envRoot)) continue;
    try {
      const st = fs.statSync(envRoot);
      if (!st.isDirectory()) continue;
    } catch {
      continue;
    }
    const py = pythonBinInEnv(envRoot);
    if (!py) continue;
    const probe = await probePython(py);
    found.push(makeEnvEntry({
      pythonPath: py,
      kind: name.includes('conda') ? 'conda-env' : 'venv',
      envName: name,
      workspace,
      version: probe.version,
      preferred: true
    }));
  }

  // Also scan one level of subdirs for .venv (common monorepo)
  try {
    const entries = await fsp.readdir(workspace, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (ent.name.startsWith('.') && !WORKSPACE_VENV_NAMES.includes(ent.name)) continue;
      if (WORKSPACE_VENV_NAMES.includes(ent.name)) continue;
      for (const name of ['.venv', 'venv']) {
        const envRoot = path.join(workspace, ent.name, name);
        const py = pythonBinInEnv(envRoot);
        if (!py) continue;
        const probe = await probePython(py);
        found.push(makeEnvEntry({
          pythonPath: py,
          kind: 'venv',
          envName: `${ent.name}/${name}`,
          workspace,
          version: probe.version,
          preferred: true
        }));
      }
    }
  } catch {}

  return found;
}

async function findCondaEnvs() {
  const found = [];
  const tryConda = async (condaCmd) => {
    try {
      const { stdout } = await execFileAsync(condaCmd, ['env', 'list', '--json'], {
        timeout: 6000,
        env: process.env
      });
      const data = JSON.parse(stdout);
      const envs = Array.isArray(data.envs) ? data.envs : [];
      for (const envRoot of envs) {
        const py = pythonBinInEnv(envRoot);
        if (!py) continue;
        const probe = await probePython(py);
        found.push(makeEnvEntry({
          pythonPath: py,
          kind: 'conda-env',
          envName: path.basename(envRoot),
          workspace: null,
          version: probe.version,
          preferred: false
        }));
      }
    } catch {}
  };
  await tryConda('conda');
  await tryConda('mamba');
  return found;
}

async function findSystemPythons() {
  const candidates = [];
  if (process.platform === 'win32') {
    candidates.push('python', 'python3', 'py');
  } else {
    candidates.push(
      '/usr/bin/python3',
      '/usr/local/bin/python3',
      '/opt/homebrew/bin/python3',
      'python3',
      'python'
    );
  }

  const found = [];
  const seen = new Set();
  for (const c of candidates) {
    let resolved = c;
    if (!c.includes('/') && !c.includes('\\')) {
      try {
        const whichCmd = process.platform === 'win32' ? 'where' : 'which';
        const { stdout } = await execFileAsync(whichCmd, [c], { timeout: 3000 });
        resolved = String(stdout).trim().split(/\r?\n/)[0];
      } catch {
        continue;
      }
    }
    if (!resolved || !exists(resolved) || seen.has(resolved)) continue;
    seen.add(resolved);
    const probe = await probePython(resolved);
    if (!probe.version && c !== 'py') continue;
    found.push(makeEnvEntry({
      pythonPath: resolved,
      kind: 'system',
      envName: path.basename(resolved),
      workspace: null,
      version: probe.version,
      preferred: false
    }));
  }
  return found;
}

/**
 * Discover Python interpreters like VS Code:
 * 1) workspace venvs (.venv, venv, …) first
 * 2) conda envs
 * 3) system / PATH pythons
 */
async function listPythonEnvironments(workspace) {
  const workspaceEnvs = await findWorkspaceVenvs(workspace);
  const condaEnvs = await findCondaEnvs();
  const systemEnvs = await findSystemPythons();

  const byPath = new Map();
  for (const env of [...workspaceEnvs, ...condaEnvs, ...systemEnvs]) {
    if (!env.pythonPath) continue;
    const key = path.normalize(env.pythonPath);
    const prev = byPath.get(key);
    if (!prev || (env.preferred && !prev.preferred)) {
      byPath.set(key, { ...env, pythonPath: key });
    }
  }

  const list = [...byPath.values()];
  list.sort((a, b) => {
    if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
    if (a.kind === 'venv' && b.kind !== 'venv') return -1;
    if (b.kind === 'venv' && a.kind !== 'venv') return 1;
    return String(a.display_name).localeCompare(String(b.display_name));
  });

  return list;
}

module.exports = {
  listPythonEnvironments,
  pythonBinInEnv,
  probePython
};
