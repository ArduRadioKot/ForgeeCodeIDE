const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const path = require('node:path');

const exec = promisify(execFile);
const LIMIT = 2 * 1024 * 1024;

async function run(program, args, options = {}) {
  return exec(program, args, { timeout: 120000, maxBuffer: LIMIT, windowsHide: true, ...options });
}

function interpolate(value, env) {
  return String(value ?? '').replace(/{{\s*([\w.-]+)\s*}}/g, (_, key) => {
    if (!Object.hasOwn(env, key)) throw new Error(`Missing environment variable: ${key}`);
    return String(env[key]);
  });
}

async function requestHttp(input) {
  const env = input.env || {};
  const url = new URL(interpolate(input.url, env));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Enter an HTTP(S) URL without embedded credentials.');
  const method = String(input.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(method)) throw new Error('Unsupported HTTP method.');
  const headers = new Headers(Object.entries(input.headers || {}).map(([key, value]) => [key, interpolate(value, env)]));
  const body = ['GET', 'HEAD'].includes(method) ? undefined : interpolate(input.body, env);
  if (body?.length > LIMIT) throw new Error('Request body is too large.');
  if (input.auth === 'bearer') headers.set('Authorization', `Bearer ${interpolate(input.secret, env)}`);
  if (input.auth === 'basic') headers.set('Authorization', 'Basic ' + Buffer.from(interpolate(input.secret, env)).toString('base64'));

  const started = Date.now();
  const response = await fetch(url, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(30000) });
  const reader = response.body?.getReader();
  const chunks = [];
  let size = 0;
  let truncated = false;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    const bytes = Buffer.from(value);
    chunks.push(bytes.subarray(0, LIMIT - size));
    size += bytes.length;
    if (size > LIMIT) {
      truncated = true;
      await reader.cancel();
      break;
    }
  }
  return {
    status: response.status, statusText: response.statusText,
    ms: Date.now() - started, headers: [...response.headers],
    body: Buffer.concat(chunks).toString('utf8'), truncated,
  };
}

async function querySqlite(file, sql, write) {
  if (!path.isAbsolute(file) || !sql?.trim()) throw new Error('Choose a SQLite file and enter a SQL statement.');
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw new Error('Choose an existing SQLite database file.');
  const empty = process.platform === 'win32' ? 'NUL' : '/dev/null';
  const flags = ['-batch', '-safe', '-init', empty, '-json', '-bail'];
  if (!write) flags.push('-readonly');
  const { stdout } = await run('sqlite3', [...flags, file, sql], { timeout: 15000 });
  return stdout.trim();
}

async function queryPostgres(connection, sql, write) {
  const { host, port, database, user, password } = connection;
  if (!/^[\w.:-]+$/.test(host) || !/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535 ||
      !/^[\w.-]+$/.test(database) || !user || !sql?.trim() || /^\s*\\/.test(sql)) {
    throw new Error('Enter a PostgreSQL host, database, user and SQL statement.');
  }
  const env = {
    ...process.env,
    PGHOST: host, PGPORT: port, PGDATABASE: database, PGUSER: user, PGPASSWORD: password,
    PGCONNECT_TIMEOUT: '5',
    PGOPTIONS: write ? '' : '-c default_transaction_read_only=on',
  };
  const { stdout } = await run('psql', ['-X', '--no-password', '--csv', '-v', 'ON_ERROR_STOP=1', '--command', sql], { env, timeout: 15000 });
  return stdout.trim();
}

function remoteTarget({ kind, host, remotePath }) {
  const clean = String(remotePath || '').replace(/\/$/, '');
  if (!/^\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(clean) || clean.split('/').some((p) => p === '.' || p === '..')) {
    throw new Error('Use an absolute remote path with letters, numbers, dots, dashes or underscores.');
  }
  if (kind === 'ssh' && typeof host === 'string' && /^[\w.-]+(?:@[\w.-]+)?$/.test(host) && !host.startsWith('-') && !host.split('@').at(-1).startsWith('-')) {
    return `${host}:${clean}/`;
  }
  if (kind === 'docker' && /^[a-z0-9][\w.-]*$/i.test(host)) return `${host}:${clean}/.`;
  throw new Error('Enter an SSH host (or SSH config alias) or a Docker container name.');
}

const copies = new Set();
async function syncProject(input, local, push) {
  if (!path.isAbsolute(local)) throw new Error('Open a local project folder.');
  const target = remoteTarget(input);
  if (copies.has(local)) throw new Error('A transfer is already running for this folder.');
  copies.add(local);
  try {
    if (input.kind === 'ssh') {
      const args = ['-atz', '--safe-links', '-e', 'ssh -o BatchMode=yes -o StrictHostKeyChecking=yes', '--'];
      await run('rsync', [...args, ...(push ? [local + path.sep, target] : [target, local + path.sep])]);
    } else {
      await run('docker', ['cp', ...(push ? [local + path.sep + '.', target.slice(0, -2)] : [target, local])]);
    }
  } finally { copies.delete(local); }
}

module.exports = { requestHttp, querySqlite, queryPostgres, syncProject };
