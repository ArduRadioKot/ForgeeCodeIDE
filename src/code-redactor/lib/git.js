const { ipcMain } = require('electron');
const { spawn } = require('child_process');

function safeRemoveHandler(channel) {
  try {
    ipcMain.removeHandler(channel);
  } catch {}
}

const EXTRA_PATH = process.platform === 'win32'
  ? []
  : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/local/git/bin'];

function gitEnv() {
  const sep = process.platform === 'win32' ? ';' : ':';
  const parts = (process.env.PATH || '').split(sep).filter(Boolean);
  return { ...process.env, PATH: [...new Set([...parts, ...EXTRA_PATH])].join(sep), GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };
}

function runGit(cwd, args) {
  return new Promise((resolve) => {
    const workDir = cwd || process.cwd();
    const child = spawn('git', ['-c', 'core.quotepath=false', ...args], {
      cwd: workDir,
      env: gitEnv()
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => resolve({ ok: false, code: -1, stdout, stderr: err.message }));
    child.on('close', (code) => resolve({ ok: code === 0, code, stdout, stderr }));
  });
}

async function resolveGitCwd(folderPath) {
  if (!folderPath) return null;
  try {
    const check = await runGit(folderPath, ['rev-parse', '--is-inside-work-tree']);
    if (!check.ok || String(check.stdout).trim() !== 'true') return null;
    const top = await runGit(folderPath, ['rev-parse', '--show-toplevel']);
    if (top.ok) return top.stdout.trim();
    return null;
  } catch {
    return null;
  }
}

function registerGitIpc() {
  const channels = ['git-status', 'git-stage', 'git-unstage', 'git-commit', 'git-push', 'git-pull', 'git-init', 'git-diff', 'git-branches', 'git-checkout', 'git-discard', 'git-log', 'git-fetch'];
  for (const ch of channels) safeRemoveHandler(ch);

  ipcMain.handle('git-status', async (event, folderPath) => {
    try {
      if (!folderPath) {
        return { success: true, isRepo: false, cwd: null, reason: 'no-folder' };
      }
      const cwd = await resolveGitCwd(folderPath);
      if (!cwd) {
        return { success: true, isRepo: false, cwd: folderPath, reason: 'not-a-repo' };
      }
      const branchRes = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
      const statusRes = await runGit(cwd, ['status', '--porcelain=v1', '-z', '-uall']);
      const files = [];
      const entries = (statusRes.stdout || '').split('\0');
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (entry.length < 4) continue;
        const code = entry.slice(0, 2);
        const pathPart = entry.slice(3);
        const x = code[0];
        const y = code[1];
        if (x === 'R' || x === 'C') i += 1; // rename: the next field is the old path
        let status = 'modified';
        if (x === '?' || y === '?') status = 'untracked';
        else if (x === 'A' || y === 'A') status = 'added';
        else if (x === 'D' || y === 'D') status = 'deleted';
        else if (x === 'R' || y === 'R') status = 'renamed';
        else if (x === 'U' || y === 'U') status = 'conflict';
        const staged = x !== ' ' && x !== '?';
        const unstaged = y !== ' ' && y !== '?';
        files.push({ path: pathPart, code, status, staged, unstaged });
      }
      let ahead = 0;
      let behind = 0;
      const counts = await runGit(cwd, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']);
      if (counts.ok) {
        const [b, a] = counts.stdout.trim().split(/\s+/).map(Number);
        behind = b || 0;
        ahead = a || 0;
      }
      const hasUpstream = counts.ok;
      return {
        success: true,
        isRepo: true,
        cwd,
        branch: branchRes.ok ? branchRes.stdout.trim() : 'HEAD',
        ahead,
        behind,
        hasUpstream,
        files
      };
    } catch (err) {
      return { success: false, isRepo: false, error: err.message };
    }
  });

  ipcMain.handle('git-stage', async (event, folderPath, filePath) => {
    const cwd = await resolveGitCwd(folderPath);
    if (!cwd) return { success: false, error: 'Not a git repository' };
    const res = await runGit(cwd, ['add', '--', filePath || '.']);
    return { success: res.ok, error: res.ok ? null : (res.stderr || res.stdout) };
  });

  ipcMain.handle('git-unstage', async (event, folderPath, filePath) => {
    const cwd = await resolveGitCwd(folderPath);
    if (!cwd) return { success: false, error: 'Not a git repository' };
    const res = await runGit(cwd, ['restore', '--staged', '--', filePath || '.']);
    return { success: res.ok, error: res.ok ? null : (res.stderr || res.stdout) };
  });

  ipcMain.handle('git-commit', async (event, folderPath, message) => {
    const cwd = await resolveGitCwd(folderPath);
    if (!cwd) return { success: false, error: 'Not a git repository' };
    if (!message || !String(message).trim()) return { success: false, error: 'Empty commit message' };
    const res = await runGit(cwd, ['commit', '-m', String(message).trim()]);
    return { success: res.ok, output: res.stdout, error: res.ok ? null : (res.stderr || res.stdout) };
  });

  ipcMain.handle('git-push', async (event, folderPath) => {
    const cwd = await resolveGitCwd(folderPath);
    if (!cwd) return { success: false, error: 'Not a git repository' };
    let res = await runGit(cwd, ['push']);
    if (!res.ok && /no upstream branch|set-upstream/i.test(res.stderr)) res = await runGit(cwd, ['push', '--set-upstream', 'origin', 'HEAD']);
    return { success: res.ok, output: res.stdout || res.stderr, error: res.ok ? null : (res.stderr || res.stdout) };
  });

  ipcMain.handle('git-pull', async (event, folderPath) => {
    const cwd = await resolveGitCwd(folderPath);
    if (!cwd) return { success: false, error: 'Not a git repository' };
    const res = await runGit(cwd, ['pull', '--ff-only']);
    return { success: res.ok, output: res.stdout || res.stderr, error: res.ok ? null : (res.stderr || res.stdout) };
  });

  ipcMain.handle('git-init', async (event, folderPath) => {
    if (!folderPath) return { success: false, error: 'No folder' };
    const res = await runGit(folderPath, ['init']);
    return { success: res.ok, error: res.ok ? null : (res.stderr || res.stdout) };
  });

  ipcMain.handle('git-diff', async (event, folderPath, filePath, staged = false, untracked = false) => {
    const cwd = await resolveGitCwd(folderPath);
    if (!cwd) return { success: false, error: 'Not a git repository' };
    let args;
    if (untracked) args = ['diff', '--no-index', '--', process.platform === 'win32' ? 'NUL' : '/dev/null', filePath];
    else args = staged ? ['diff', '--cached', '--', filePath] : ['diff', '--', filePath];
    const res = await runGit(cwd, args);
    return { success: true, diff: res.stdout || res.stderr || '' };
  });

  ipcMain.handle('git-branches', async (event, folderPath) => {
    const cwd = await resolveGitCwd(folderPath);
    if (!cwd) return { success: false, error: 'Not a git repository' };
    const res = await runGit(cwd, ['branch', '--format=%(HEAD)|%(refname:short)', '--sort=-committerdate']);
    const branches = (res.stdout || '').split('\n').filter(Boolean).map((line) => {
      const [head, name] = line.split('|');
      return { name, current: head === '*' };
    }).filter((b) => b.name && !b.name.startsWith('('));
    return { success: res.ok, branches, error: res.ok ? null : res.stderr };
  });

  ipcMain.handle('git-checkout', async (event, folderPath, branch, create = false) => {
    const cwd = await resolveGitCwd(folderPath);
    if (!cwd) return { success: false, error: 'Not a git repository' };
    if (!branch || /[\s~^:?*\[\\]/.test(branch)) return { success: false, error: 'Некорректное имя ветки' };
    const res = await runGit(cwd, create ? ['checkout', '-b', branch] : ['checkout', branch]);
    return { success: res.ok, output: res.stdout || res.stderr, error: res.ok ? null : (res.stderr || res.stdout) };
  });

  ipcMain.handle('git-discard', async (event, folderPath, filePath, untracked = false) => {
    const cwd = await resolveGitCwd(folderPath);
    if (!cwd || !filePath) return { success: false, error: 'Not a git repository' };
    const res = untracked ? await runGit(cwd, ['clean', '-f', '--', filePath]) : await runGit(cwd, ['restore', '--', filePath]);
    return { success: res.ok, error: res.ok ? null : (res.stderr || res.stdout) };
  });

  ipcMain.handle('git-log', async (event, folderPath, limit = 8) => {
    const cwd = await resolveGitCwd(folderPath);
    if (!cwd) return { success: false, error: 'Not a git repository' };
    const res = await runGit(cwd, ['log', `-${Math.min(30, Number(limit) || 8)}`, '--pretty=format:%h%x1f%s%x1f%an%x1f%ct']);
    const commits = (res.stdout || '').split('\n').filter(Boolean).map((l) => {
      const [hash, subject, author, when] = l.split('\x1f');
      return { hash, subject, author, when };
    });
    return { success: true, commits };
  });

  ipcMain.handle('git-fetch', async (event, folderPath) => {
    const cwd = await resolveGitCwd(folderPath);
    if (!cwd) return { success: false, error: 'Not a git repository' };
    const res = await runGit(cwd, ['fetch', '--prune']);
    return { success: res.ok, error: res.ok ? null : (res.stderr || res.stdout) };
  });

  console.log('[git] IPC handlers registered');
}

module.exports = {
  runGit,
  resolveGitCwd,
  registerGitIpc
};
