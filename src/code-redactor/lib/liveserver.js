/**
 * Live Server: static HTTP server bound to 127.0.0.1 that injects a tiny client into HTML pages
 * and pushes reload / CSS-hot-swap events over SSE when files in the root change.
 */
const { ipcMain } = require('electron');
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.wasm': 'application/wasm', '.map': 'application/json',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.xml': 'application/xml; charset=utf-8',
};
const IGNORED = /(^|[\\/])(node_modules|\.git|\.venv|__pycache__|\.idea|\.vscode|\.DS_Store)([\\/]|$)/;
const CLIENT = `<script>(function(){var down=false,es=new EventSource('/__live/events');es.onmessage=function(e){var m=JSON.parse(e.data);if(m.type==='reload'){location.reload();}else if(m.type==='css'){document.querySelectorAll('link[rel~=stylesheet]').forEach(function(l){try{var u=new URL(l.href);if(u.origin===location.origin){u.searchParams.set('_live',Date.now());l.href=u.toString();}}catch(_){}});}};es.onerror=function(){down=true;};es.onopen=function(){if(down)location.reload();};})();</script>`;

const servers = new Map(); // root -> instance

/**
 * listen() alone is not enough: on macOS another app bound to *:PORT (VS Code Live Server, a dev server) does not
 * make binding 127.0.0.1:PORT fail, and requests would reach the wrong server. Probe with a real connection.
 */
function answers(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(300, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

async function portBusy(port) {
  return (await answers('127.0.0.1', port)) || (await answers('::1', port));
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function listing(dir, urlPath) {
  let rows = '';
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => !IGNORED.test(e.name)).sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
    rows = entries.map((e) => `<li><a href="${esc(path.posix.join(urlPath, encodeURIComponent(e.name)))}${e.isDirectory() ? '/' : ''}">${esc(e.name)}${e.isDirectory() ? '/' : ''}</a></li>`).join('');
  } catch {}
  return `<!doctype html><meta charset="utf-8"><title>Index of ${esc(urlPath)}</title><style>body{font:14px system-ui;margin:32px auto;max-width:720px;padding:0 16px}a{text-decoration:none}li{padding:2px 0;list-style:none}h1{font-size:18px}</style><h1>${esc(urlPath)}</h1><ul>${urlPath !== '/' ? '<li><a href="../">../</a></li>' : ''}${rows}</ul>`;
}

function createInstance(root, emit) {
  const inst = { root, port: 0, clients: new Set(), server: null, watchers: [], timer: null, pending: new Set() };

  const broadcast = (payload) => {
    for (const res of inst.clients) res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const flush = () => {
    const files = [...inst.pending];
    inst.pending.clear();
    inst.timer = null;
    if (!files.length) return;
    const cssOnly = files.every((f) => /\.css$/i.test(f));
    broadcast({ type: cssOnly ? 'css' : 'reload' });
    emit({ root, type: cssOnly ? 'css' : 'reload', file: files[0], clients: inst.clients.size });
  };

  const onChange = (rel) => {
    if (!rel || IGNORED.test(rel)) return;
    inst.pending.add(rel);
    clearTimeout(inst.timer);
    inst.timer = setTimeout(flush, 90);
  };

  inst.server = http.createServer((req, res) => {
    let urlPath;
    try { urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); res.end('Bad request'); return; }

    if (urlPath === '/__live/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(': ok\n\n');
      inst.clients.add(res);
      emit({ root, type: 'clients', clients: inst.clients.size });
      req.on('close', () => { inst.clients.delete(res); emit({ root, type: 'clients', clients: inst.clients.size }); });
      return;
    }

    let file = path.normalize(path.join(root, urlPath));
    if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    let stat;
    try { stat = fs.statSync(file); } catch { stat = null; }
    if (stat && stat.isDirectory()) {
      if (!urlPath.endsWith('/')) { res.writeHead(301, { Location: urlPath + '/' }); res.end(); return; }
      const index = ['index.html', 'index.htm'].map((n) => path.join(file, n)).find((p) => fs.existsSync(p));
      if (!index) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(listing(file, urlPath)); return; }
      file = index;
    } else if (!stat) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><title>404</title><body style="font:14px system-ui;padding:32px"><h1>404</h1><p>${esc(urlPath)} не найден</p>${CLIENT}`);
      return;
    }

    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Cache-Control': 'no-store' };
    if (ext === '.html' || ext === '.htm') {
      fs.readFile(file, 'utf8', (err, html) => {
        if (err) { res.writeHead(500); res.end(String(err.message)); return; }
        const out = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${CLIENT}</body>`) : html + CLIENT;
        res.writeHead(200, headers);
        res.end(out);
      });
      return;
    }
    res.writeHead(200, headers);
    fs.createReadStream(file).on('error', () => res.end()).pipe(res);
  });

  const watchTree = () => {
    try {
      const w = fs.watch(root, { recursive: true }, (evt, name) => onChange(name && String(name)));
      w.on('error', () => {});
      inst.watchers.push(w);
      return;
    } catch { /* recursive watch unsupported (Linux, Node < 20): fall back to per-directory watchers */ }
    const dirs = [root];
    for (let i = 0; i < dirs.length && inst.watchers.length < 400; i++) {
      const dir = dirs[i];
      try {
        const w = fs.watch(dir, (evt, name) => onChange(path.relative(root, path.join(dir, String(name || '')))));
        w.on('error', () => {});
        inst.watchers.push(w);
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (e.isDirectory() && !IGNORED.test(e.name)) dirs.push(path.join(dir, e.name));
        }
      } catch {}
    }
  };

  inst.start = async (preferred) => {
    let port = preferred;
    for (let i = 0; i < 25 && (await portBusy(port)); i++) port += 1;
    return new Promise((resolve, reject) => {
      let attempt = 0;
      const tryListen = (p) => {
        inst.server.once('error', (err) => {
          if (err.code === 'EADDRINUSE' && attempt < 25) { attempt += 1; tryListen(p + 1); } else reject(err);
        });
        inst.server.listen(p, '127.0.0.1', () => { inst.port = p; watchTree(); resolve(p); });
      };
      tryListen(port);
    });
  };

  inst.stop = () => {
    clearTimeout(inst.timer);
    inst.watchers.forEach((w) => { try { w.close(); } catch {} });
    for (const res of inst.clients) { try { res.end(); } catch {} }
    try { inst.server.close(); } catch {}
  };
  return inst;
}

function stopAllLiveServers() {
  for (const inst of servers.values()) inst.stop();
  servers.clear();
}

function registerLiveServerIpc(getMainWindow) {
  const emit = (payload) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send('live-event', payload);
  };
  for (const ch of ['live-start', 'live-stop', 'live-list']) { try { ipcMain.removeHandler(ch); } catch {} }

  ipcMain.handle('live-start', async (e, { root, port } = {}) => {
    if (!root) return { success: false, error: 'Не указана папка' };
    const normalized = path.resolve(root);
    const existing = servers.get(normalized);
    if (existing) return { success: true, port: existing.port, url: `http://127.0.0.1:${existing.port}`, reused: true };
    const inst = createInstance(normalized, emit);
    try {
      const p = await inst.start(port || 5500);
      servers.set(normalized, inst);
      return { success: true, port: p, url: `http://127.0.0.1:${p}` };
    } catch (err) {
      inst.stop();
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('live-stop', (e, { root } = {}) => {
    const inst = servers.get(path.resolve(root || ''));
    if (inst) { inst.stop(); servers.delete(inst.root); }
    return { success: true };
  });

  ipcMain.handle('live-list', () => [...servers.values()].map((s) => ({ root: s.root, port: s.port, clients: s.clients.size })));
}

module.exports = { registerLiveServerIpc, stopAllLiveServers };
