import { state } from './state.js';
import { escapeHtml, sanitizeHtml } from './utils.js';
import { saveAllConfig } from './save-hook.js';
import { isNotebookTab, isNotebookPath } from './tab-model.js';
import { updateTabsList, updateTabTitle } from './tabs-api.js';
import { createSmartKeydown } from './smart-edit.js';

let cachedEnvsByWorkspace = new Map();

export function getNotebookHost() {
  return document.getElementById('notebook-host');
}

export function emptyNotebook() {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: {
        display_name: 'Python 3',
        language: 'python',
        name: 'python3'
      },
      language_info: { name: 'python' }
    },
    cells: [
      {
        cell_type: 'markdown',
        metadata: {},
        source: ['# Notebook\n', '\n', 'Новый Jupyter Notebook.']
      },
      {
        cell_type: 'code',
        execution_count: null,
        metadata: {},
        outputs: [],
        source: ['print("Hello from FrogeeCodeIDE")']
      }
    ]
  };
}

export const uid = () => 'c' + Math.random().toString(36).slice(2, 10);

export function newCell(type = 'code', text = '') {
  const cell = { _id: uid(), cell_type: type, metadata: {}, source: stringToSource(text) };
  if (type === 'code') { cell.execution_count = null; cell.outputs = []; }
  return cell;
}

function sourceToString(source) {
  if (Array.isArray(source)) return source.join('');
  return source == null ? '' : String(source);
}

function stringToSource(text) {
  if (!text) return [];
  const parts = String(text).split(/(?<=\n)/);
  return parts.length ? parts : [String(text)];
}

export function parseNotebook(raw) {
  try {
    const data = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw;
    if (!data || typeof data !== 'object') return emptyNotebook();
    if (!Array.isArray(data.cells)) data.cells = [];
    if (!data.nbformat) data.nbformat = 4;
    if (data.nbformat_minor == null) data.nbformat_minor = 5;
    if (!data.metadata) data.metadata = {};
    if (!data.metadata.kernelspec) {
      data.metadata.kernelspec = {
        display_name: 'Python 3',
        language: 'python',
        name: 'python3'
      };
    }
    data.cells = data.cells.map((cell) => normalizeCell(cell));
    return data;
  } catch (err) {
    console.warn('[notebook] parse failed:', err);
    const nb = emptyNotebook();
    nb.cells = [{
      cell_type: 'markdown',
      metadata: {},
      source: ['# Ошибка разбора .ipynb\n', `\n\`\`\`\n${err.message}\n\`\`\`\n`]
    }];
    return nb;
  }
}

function normalizeCell(cell) {
  const type = cell?.cell_type === 'markdown' || cell?.cell_type === 'raw'
    ? cell.cell_type
    : 'code';
  const out = {
    _id: uid(),
    cell_type: type,
    metadata: cell?.metadata && typeof cell.metadata === 'object' ? cell.metadata : {},
    source: Array.isArray(cell?.source) ? cell.source : stringToSource(cell?.source || '')
  };
  if (type === 'code') {
    out.execution_count = cell?.execution_count ?? null;
    out.outputs = Array.isArray(cell?.outputs) ? cell.outputs : [];
  }
  return out;
}

export function serializeNotebook(nb) {
  const model = nb || emptyNotebook();
  return JSON.stringify({
    nbformat: model.nbformat || 4,
    nbformat_minor: model.nbformat_minor ?? 5,
    metadata: model.metadata || {},
    cells: (model.cells || []).map((cell) => {
      const base = {
        cell_type: cell.cell_type,
        metadata: cell.metadata || {},
        source: Array.isArray(cell.source) ? cell.source : stringToSource(cell.source || '')
      };
      if (cell.cell_type === 'code') {
        base.execution_count = cell.execution_count ?? null;
        base.outputs = Array.isArray(cell.outputs) ? cell.outputs : [];
      }
      return base;
    })
  }, null, 1);
}

export function ensureNotebookModel(tab) {
  if (!tab) return null;
  if (!tab.notebook) {
    tab.notebook = parseNotebook(tab.content || '');
  }
  return tab.notebook;
}

export function syncNotebookContent(tab) {
  if (!tab || !isNotebookTab(tab)) return;
  const nb = ensureNotebookModel(tab);
  tab.content = serializeNotebook(nb);
}

export function applyNotebookSurface(show) {
  const host = getNotebookHost();
  const left = document.getElementById('editor-container');
  const right = document.getElementById('editor-container-right');
  const splitResizer = document.getElementById('split-resizer');
  const termHost = document.getElementById('terminal-editor-host');

  if (show) {
    if (host) {
      host.style.display = 'flex';
      host.style.flex = '1 1 auto';
      host.style.minHeight = '0';
      host.style.minWidth = '0';
      host.style.width = '100%';
    }
    if (left) left.style.display = 'none';
    if (right) right.style.display = 'none';
    if (splitResizer) splitResizer.style.display = 'none';
    if (termHost) termHost.style.display = 'none';
  } else if (host) {
    host.style.display = 'none';
    host.innerHTML = '';
  }
}

function getSelectedKernel(nb) {
  const meta = nb?.metadata || {};
  const frogee = meta.frogee || {};
  const ks = meta.kernelspec || {};
  return {
    name: frogee.pythonPath || ks.name || '',
    display_name: frogee.display_name || ks.display_name || 'Select Kernel',
    language: (ks.language || frogee.language || 'python').toLowerCase(),
    pythonPath: frogee.pythonPath || ks.pythonPath || null,
    detail: frogee.detail || '',
    kind: frogee.kind || ''
  };
}

function setSelectedKernel(nb, env) {
  if (!nb.metadata) nb.metadata = {};
  const display = env.display_name || env.name || 'Python';
  const pyPath = env.pythonPath || env.id || env.name;
  nb.metadata.kernelspec = {
    name: env.kind === 'venv' ? 'python3' : (env.name || 'python3'),
    display_name: display,
    language: 'python',
    pythonPath: pyPath
  };
  nb.metadata.language_info = {
    name: 'python',
    version: env.version || ''
  };
  nb.metadata.frogee = {
    pythonPath: pyPath,
    display_name: display,
    detail: env.detail || '',
    kind: env.kind || 'python',
    version: env.version || ''
  };
}

function workspaceForTab(tab) {
  if (tab?.filePath) {
    return tab.filePath.replace(/[/\\][^/\\]+$/, '') || state.currentFolder;
  }
  return state.currentFolder || null;
}

async function loadPythonEnvs(workspace) {
  const key = workspace || '__global__';
  if (cachedEnvsByWorkspace.has(key)) {
    return cachedEnvsByWorkspace.get(key);
  }
  let envs = [];
  try {
    const api = window.electronAPI.listPythonEnvs || window.electronAPI.listKernels;
    const res = await api(workspace || null);
    if (res?.success) {
      envs = res.environments || res.kernels || [];
    }
  } catch (err) {
    console.warn('[notebook] listPythonEnvs:', err);
  }
  // Normalize shape
  envs = (envs || []).map((e) => ({
    id: e.id || e.pythonPath || e.name,
    name: e.name || e.id,
    display_name: e.display_name || e.name,
    detail: e.detail || e.pythonPath || '',
    pythonPath: e.pythonPath || e.id || e.name,
    language: 'python',
    kind: e.kind || 'python',
    version: e.version || '',
    preferred: !!e.preferred
  }));
  cachedEnvsByWorkspace.set(key, envs);
  return envs;
}

export function invalidatePythonEnvCache() {
  cachedEnvsByWorkspace.clear();
}


// ───────────────────────── Rendering helpers ─────────────────────────

function renderMarkdown(text) {
  try {
    if (window.marked?.parse) return sanitizeHtml(window.marked.parse(text || ''));
    if (typeof window.marked === 'function') return sanitizeHtml(window.marked(text || ''));
  } catch {}
  return `<pre class="nb-md-fallback">${escapeHtml(text || '')}</pre>`;
}

const stripAnsi = (s) => String(s).replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');

function outputToHtml(outputs) {
  if (!outputs || !outputs.length) return '';
  const chunks = [];
  for (const out of outputs) {
    if (!out) continue;
    if (out.output_type === 'stream') {
      const cls = out.name === 'stderr' ? 'nb-stream nb-stderr' : 'nb-stream';
      chunks.push(`<pre class="${cls}">${escapeHtml(stripAnsi(sourceToString(out.text)))}</pre>`);
    } else if (out.output_type === 'error') {
      const tb = Array.isArray(out.traceback) && out.traceback.length ? out.traceback.join('\n') : `${out.ename || 'Error'}: ${out.evalue || ''}`;
      chunks.push(`<pre class="nb-error">${escapeHtml(stripAnsi(tb))}</pre>`);
    } else if (out.output_type === 'execute_result' || out.output_type === 'display_data') {
      const data = out.data || {};
      if (data['image/png']) {
        chunks.push(`<img class="nb-img" alt="output" src="data:image/png;base64,${sourceToString(data['image/png']).replace(/\s/g, '')}" />`);
      } else if (data['image/jpeg']) {
        chunks.push(`<img class="nb-img" alt="output" src="data:image/jpeg;base64,${sourceToString(data['image/jpeg']).replace(/\s/g, '')}" />`);
      } else if (data['image/svg+xml']) {
        chunks.push(`<div class="nb-html">${sanitizeHtml(sourceToString(data['image/svg+xml']))}</div>`);
      } else if (data['text/html']) {
        chunks.push(`<div class="nb-html">${sanitizeHtml(sourceToString(data['text/html']))}</div>`);
      } else if (data['text/markdown']) {
        chunks.push(`<div class="nb-html nb-md-preview">${renderMarkdown(sourceToString(data['text/markdown']))}</div>`);
      } else if (data['text/plain']) {
        chunks.push(`<pre class="nb-stream">${escapeHtml(stripAnsi(sourceToString(data['text/plain'])))}</pre>`);
      }
    }
  }
  return chunks.join('');
}

const ICONS = {
  run: '<svg viewBox="0 0 16 16"><path d="M5 3.2v9.6L12.6 8z" fill="currentColor"/></svg>',
  stop: '<svg viewBox="0 0 16 16"><rect x="4.5" y="4.5" width="7" height="7" rx="1.5" fill="currentColor"/></svg>',
  clock: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="8" cy="8" r="5.2"/><path d="M8 5v3.2l2 1.2"/></svg>',
  up: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 12.5v-9M4.5 7 8 3.5 11.5 7"/></svg>',
  down: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3.5v9M4.5 9 8 12.5 11.5 9"/></svg>',
  copy: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><rect x="5.5" y="5.5" width="7" height="7" rx="1.5"/><path d="M3.5 10V4.5a1 1 0 0 1 1-1H10"/></svg>',
  trash: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8h5.8l.6-8"/></svg>',
  swap: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5.5h9l-2-2M13 10.5H4l2 2"/></svg>',
  eraser: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"><path d="m6 12.5-3-3 6.5-6.5 4 4-4.5 5.5zM6 12.5h7"/></svg>',
  plus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 3.5v9M3.5 8h9"/></svg>',
  restart: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.8v2.6h-2.6"/></svg>',
  list: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M5.5 4h7M5.5 8h7M5.5 12h7M3 4h.01M3 8h.01M3 12h.01"/></svg>',
  chevron: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m4.5 6.5 3.5 3.5 3.5-3.5"/></svg>',
};

// ───────────────────────── Session state ─────────────────────────

const kernelTabs = new Map(); // kernelId -> tab
let kernelListenerOn = false;

function session(tab) {
  if (!tab._nb) {
    const nb = ensureNotebookModel(tab);
    const maxCount = Math.max(0, ...nb.cells.map((c) => c.execution_count || 0));
    tab._nb = {
      selectedId: null,
      clipboard: null,
      undo: [],
      redo: [],
      counter: maxCount,
      queue: [],
      active: null,
      pending: new Map(),
      kernel: { status: 'none', python: '' },
      side: null, // 'toc' | 'vars' | null
      lastKey: '',
      lastKeyAt: 0,
      saveTimer: null,
    };
  }
  return tab._nb;
}

function ensureIds(nb) {
  nb.cells.forEach((c) => { if (!c._id) c._id = uid(); });
}

function kernelIdOf(tab) {
  return String(tab.id);
}

function activeNotebookTab() {
  return state.currentTabs[state.activeTabIndex];
}

function cellEl(id) {
  return getNotebookHost()?.querySelector(`.nb-cell[data-cell-id="${id}"]`);
}

function findCell(nb, id) {
  const index = nb.cells.findIndex((c) => c._id === id);
  return { index, cell: index >= 0 ? nb.cells[index] : null };
}

function markModified(tab, immediate = false) {
  tab.modified = true;
  const sess = session(tab);
  const flush = () => {
    syncNotebookContent(tab);
    updateTabsList();
    updateTabTitle();
    saveAllConfig();
  };
  if (immediate) { clearTimeout(sess.saveTimer); flush(); return; }
  clearTimeout(sess.saveTimer);
  sess.saveTimer = setTimeout(flush, 500);
}

function snapshot(tab) {
  const sess = session(tab);
  const nb = ensureNotebookModel(tab);
  sess.undo.push(nb.cells.map((c) => ({ ...c, source: Array.isArray(c.source) ? c.source.slice() : c.source })));
  if (sess.undo.length > 60) sess.undo.shift();
  sess.redo = [];
}

function restoreSnapshot(tab, from, to) {
  const sess = session(tab);
  const nb = ensureNotebookModel(tab);
  if (!sess[from].length) return;
  sess[to].push(nb.cells.slice());
  nb.cells = sess[from].pop();
  markModified(tab, true);
  rerenderCells(tab, { select: sess.selectedId });
}

// ───────────────────────── Kernel ─────────────────────────

function ensureKernelListener() {
  if (kernelListenerOn || !window.electronAPI?.onKernelEvent) return;
  kernelListenerOn = true;
  window.electronAPI.onKernelEvent(handleKernelEvent);
}

function setKernelStatus(tab, status) {
  const sess = session(tab);
  sess.kernel.status = status;
  const badge = getNotebookHost()?.querySelector('.nb-kernel-badge');
  if (badge && activeNotebookTab() === tab) {
    const labels = { none: 'Ядро не запущено', starting: 'Запуск ядра…', idle: 'Ядро готово', busy: 'Выполняется', dead: 'Ядро остановлено' };
    badge.dataset.status = status;
    badge.querySelector('.nb-kernel-text').textContent = labels[status] || status;
  }
  const host = getNotebookHost();
  host?.querySelectorAll('[data-nb-action="interrupt"]').forEach((b) => { b.disabled = status !== 'busy'; });
}

async function ensureKernel(tab) {
  ensureKernelListener();
  const sess = session(tab);
  if (sess.kernel.status === 'idle' || sess.kernel.status === 'busy') return { success: true };
  const nb = ensureNotebookModel(tab);
  const kernel = getSelectedKernel(nb);
  if (!kernel.pythonPath) return { success: false, error: 'Выберите Python / venv в списке ядер' };
  if (!window.electronAPI?.kernelStart) return { success: false, error: 'Ядро недоступно в этой сборке' };
  setKernelStatus(tab, 'starting');
  kernelTabs.set(kernelIdOf(tab), tab);
  const res = await window.electronAPI.kernelStart({ id: kernelIdOf(tab), pythonPath: kernel.pythonPath, cwd: workspaceForTab(tab) || undefined });
  if (!res?.success) {
    setKernelStatus(tab, 'dead');
    return { success: false, error: res?.error || 'Не удалось запустить ядро' };
  }
  sess.kernel.python = res.python || '';
  setKernelStatus(tab, 'idle');
  return { success: true };
}

function failPending(tab, message) {
  const sess = session(tab);
  for (const [, p] of sess.pending) {
    if (p.kind === 'exec') {
      p.cell.outputs.push({ output_type: 'error', ename: 'KernelError', evalue: message, traceback: [message] });
      p.failed = true;
    }
    p.resolve(false);
  }
  sess.pending.clear();
}

function handleKernelEvent(msg) {
  const tab = kernelTabs.get(msg.kernelId);
  if (!tab) return;
  const sess = session(tab);
  if (msg.type === 'dead') {
    setKernelStatus(tab, 'dead');
    failPending(tab, 'Ядро завершилось неожиданно. Запустите ячейку снова, чтобы перезапустить его.');
    sess.queue.forEach((c) => { c._state = null; paintCellState(tab, c); });
    sess.queue = [];
    return;
  }
  const p = sess.pending.get(msg.id);
  if (!p) return;

  if (p.kind === 'vars') {
    if (msg.type === 'vars') { sess.pending.delete(msg.id); p.resolve(msg.items || []); }
    return;
  }
  const cell = p.cell;
  switch (msg.type) {
    case 'stream': pushStream(cell, msg.name === 'stderr' ? 'stderr' : 'stdout', msg.text || ''); break;
    case 'display':
      cell.outputs.push({ output_type: 'display_data', data: msg.data || {}, metadata: {} });
      break;
    case 'result':
      cell.outputs.push({ output_type: 'execute_result', data: msg.data || {}, metadata: {}, execution_count: cell._pendingCount });
      break;
    case 'error':
      cell.outputs.push({ output_type: 'error', ename: msg.ename, evalue: msg.evalue, traceback: msg.traceback || [] });
      p.failed = true;
      break;
    case 'clear': cell.outputs = []; break;
    case 'done':
      p.duration = msg.duration;
      sess.pending.delete(msg.id);
      p.resolve(true);
      return;
    default: return;
  }
  scheduleOutputRender(tab, cell);
}

function pushStream(cell, name, text) {
  const last = cell.outputs[cell.outputs.length - 1];
  let target = last && last.output_type === 'stream' && last.name === name ? last : null;
  if (!target) {
    target = { output_type: 'stream', name, text: '' };
    cell.outputs.push(target);
  }
  let merged = sourceToString(target.text) + text;
  if (merged.includes('\r')) {
    merged = merged.split('\n').map((line) => {
      const parts = line.split('\r');
      return parts.length > 1 && parts[parts.length - 1] === '' ? parts[parts.length - 2] : parts[parts.length - 1];
    }).join('\n');
  }
  if (merged.length > 200000) merged = '… (вывод обрезан)\n' + merged.slice(-150000);
  target.text = merged;
}

const renderQueue = new Set();
function scheduleOutputRender(tab, cell) {
  if (renderQueue.has(cell)) return;
  renderQueue.add(cell);
  requestAnimationFrame(() => {
    renderQueue.delete(cell);
    paintOutputs(cell);
  });
}

function paintOutputs(cell) {
  const el = cellEl(cell._id);
  if (!el) return;
  const wrap = el.querySelector('.nb-output-wrap');
  const has = cell.outputs && cell.outputs.length;
  wrap.classList.toggle('nb-empty', !has);
  wrap.innerHTML = has ? `<div class="nb-output">${outputToHtml(cell.outputs)}</div>` : '';
  el.querySelector('.nb-clear-out')?.toggleAttribute('hidden', !has);
}

function paintCellState(tab, cell) {
  const el = cellEl(cell._id);
  if (!el) return;
  el.classList.toggle('running', cell._state === 'running');
  el.classList.toggle('queued', cell._state === 'queued');
  el.classList.toggle('failed', cell._status === 'error' && !cell._state);
  const btn = el.querySelector('.nb-run');
  if (btn) {
    btn.innerHTML = cell._state === 'running' ? `<span class="nb-spin"></span>${ICONS.stop}` : cell._state === 'queued' ? ICONS.clock : ICONS.run;
    btn.title = cell._state === 'running' ? 'Остановить (I, I)' : cell._state === 'queued' ? 'В очереди' : 'Выполнить (Ctrl+Enter)';
  }
  const count = el.querySelector('.nb-count');
  if (count) count.textContent = cell._state === 'running' ? '[*]' : cell.execution_count != null ? `[${cell.execution_count}]` : '';
  const status = el.querySelector('.nb-run-status');
  if (status) {
    if (cell._state === 'running') status.textContent = 'Выполняется…';
    else if (cell._state === 'queued') status.textContent = 'В очереди';
    else if (cell._lastDuration != null) {
      const sec = cell._lastDuration < 10 ? cell._lastDuration.toFixed(2) : cell._lastDuration.toFixed(1);
      status.textContent = `${cell._status === 'error' ? '✕' : '✓'} ${sec} с`;
    } else status.textContent = '';
    status.dataset.kind = cell._status === 'error' && !cell._state ? 'error' : '';
  }
}

async function execCell(tab, cell) {
  const sess = session(tab);
  const ready = await ensureKernel(tab);
  cell._state = 'running';
  cell.outputs = [];
  cell._status = null;
  cell._lastDuration = null;
  sess.counter += 1;
  cell._pendingCount = sess.counter;
  paintOutputs(cell);
  paintCellState(tab, cell);

  if (!ready.success) {
    cell.outputs.push({ output_type: 'error', ename: 'KernelError', evalue: ready.error, traceback: [ready.error] });
    cell._state = null;
    cell._status = 'error';
    sess.counter -= 1;
    paintOutputs(cell);
    paintCellState(tab, cell);
    return false;
  }

  const msgId = uid();
  const started = Date.now();
  setKernelStatus(tab, 'busy');
  const done = new Promise((resolve) => {
    sess.pending.set(msgId, { kind: 'exec', cell, resolve, failed: false });
  });
  const sent = await window.electronAPI.kernelExecute({ id: kernelIdOf(tab), msgId, code: sourceToString(cell.source) });
  let ok = false;
  const entry = sess.pending.get(msgId);
  if (!sent?.success) {
    sess.pending.delete(msgId);
    cell.outputs.push({ output_type: 'error', ename: 'KernelError', evalue: sent?.error, traceback: [sent?.error || 'Ошибка'] });
    if (entry) entry.failed = true;
  } else {
    ok = await done;
  }
  const failed = !ok || !!entry?.failed;
  cell.execution_count = cell._pendingCount;
  cell._state = null;
  cell._status = failed ? 'error' : 'ok';
  cell._lastDuration = entry?.duration ?? (Date.now() - started) / 1000;
  if (sess.kernel.status === 'busy') setKernelStatus(tab, 'idle');
  paintOutputs(cell);
  paintCellState(tab, cell);
  markModified(tab);
  if (sess.side === 'vars') refreshVariables(tab);
  return !failed;
}

async function pumpQueue(tab) {
  const sess = session(tab);
  if (sess.active) return;
  sess.active = true;
  try {
    while (sess.queue.length) {
      const cell = sess.queue.shift();
      if (!cell || cell._state !== 'queued') continue;
      const ok = await execCell(tab, cell);
      if (!ok) {
        sess.queue.forEach((c) => { c._state = null; paintCellState(tab, c); });
        sess.queue = [];
      }
    }
  } finally {
    sess.active = false;
  }
}

export function enqueueCells(tab, cells) {
  const sess = session(tab);
  for (const cell of cells) {
    if (cell.cell_type !== 'code' || cell._state) continue;
    cell._state = 'queued';
    sess.queue.push(cell);
    paintCellState(tab, cell);
  }
  return pumpQueue(tab);
}

export async function runCell(tab, index) {
  const nb = ensureNotebookModel(tab);
  const cell = nb.cells[index];
  if (cell) await enqueueCells(tab, [cell]);
}

async function interruptKernel(tab) {
  const sess = session(tab);
  sess.queue.forEach((c) => { c._state = null; paintCellState(tab, c); });
  sess.queue = [];
  const res = await window.electronAPI.kernelInterrupt({ id: kernelIdOf(tab) });
  if (!res?.success && res?.error) alert(res.error);
}

async function restartKernel(tab, { runAll = false } = {}) {
  const sess = session(tab);
  const nb = ensureNotebookModel(tab);
  sess.queue.forEach((c) => { c._state = null; paintCellState(tab, c); });
  sess.queue = [];
  failPending(tab, 'Ядро перезапущено');
  nb.cells.forEach((c) => { c._state = null; paintCellState(tab, c); });
  sess.counter = 0;
  const kernel = getSelectedKernel(nb);
  if (!kernel.pythonPath) { await ensureKernel(tab); return; }
  setKernelStatus(tab, 'starting');
  kernelTabs.set(kernelIdOf(tab), tab);
  const res = await window.electronAPI.kernelRestart({ id: kernelIdOf(tab), pythonPath: kernel.pythonPath, cwd: workspaceForTab(tab) || undefined });
  if (!res?.success) { setKernelStatus(tab, 'dead'); alert(res?.error || 'Не удалось перезапустить ядро'); return; }
  setKernelStatus(tab, 'idle');
  if (sess.side === 'vars') refreshVariables(tab);
  if (runAll) enqueueCells(tab, nb.cells);
}

export function shutdownNotebookKernel(tab) {
  if (!tab || !tab._nb) return;
  window.electronAPI?.kernelShutdown?.({ id: kernelIdOf(tab) });
  kernelTabs.delete(kernelIdOf(tab));
}

// ───────────────────────── Cell operations ─────────────────────────

function selectedIndex(tab) {
  const nb = ensureNotebookModel(tab);
  const { index } = findCell(nb, session(tab).selectedId);
  return index;
}

function selectCell(tab, id, { edit = false, scroll = true } = {}) {
  const sess = session(tab);
  sess.selectedId = id;
  const host = getNotebookHost();
  if (!host) return;
  host.querySelectorAll('.nb-cell.selected').forEach((el) => el.classList.remove('selected'));
  const el = cellEl(id);
  if (!el) return;
  el.classList.add('selected');
  if (scroll) el.scrollIntoView({ block: 'nearest' });
  if (edit) {
    const ta = el.querySelector('textarea');
    if (el.classList.contains('nb-cell-markdown')) el.classList.add('nb-editing');
    ta?.focus();
  } else if (document.activeElement && el.contains(document.activeElement) === false) {
    el.focus({ preventScroll: true });
  }
}

function rerenderCells(tab, { select = null, edit = false } = {}) {
  const host = getNotebookHost();
  const list = host?.querySelector('.nb-cells');
  if (!list) return;
  const nb = ensureNotebookModel(tab);
  const sess = session(tab);
  ensureIds(nb);
  const scroll = list.scrollTop;
  list.innerHTML = '';
  list.appendChild(buildInsertStrip(tab, 0));
  if (!nb.cells.length) {
    const hint = document.createElement('div');
    hint.className = 'nb-empty-hint';
    hint.innerHTML = 'В ноутбуке пока нет ячеек. Добавьте блок кнопками выше или нажмите <kbd>B</kbd>.';
    list.appendChild(hint);
  }
  nb.cells.forEach((cell, i) => {
    list.appendChild(buildCell(tab, cell, i));
    list.appendChild(buildInsertStrip(tab, i + 1));
  });
  list.scrollTop = scroll;
  const id = select && findCell(nb, select).cell ? select : (nb.cells[0]?._id ?? null);
  sess.selectedId = id;
  if (id) selectCell(tab, id, { edit, scroll: !!select });
  nb.cells.forEach((c) => paintCellState(tab, c));
  if (sess.side) renderSidePanel(tab);
}

function insertCell(tab, index, type = 'code', { edit = true } = {}) {
  const nb = ensureNotebookModel(tab);
  snapshot(tab);
  const cell = newCell(type, '');
  nb.cells.splice(Math.max(0, Math.min(index, nb.cells.length)), 0, cell);
  markModified(tab, true);
  rerenderCells(tab, { select: cell._id, edit });
  return cell;
}

function deleteCell(tab, id) {
  const nb = ensureNotebookModel(tab);
  const { index } = findCell(nb, id);
  if (index < 0) return;
  snapshot(tab);
  nb.cells.splice(index, 1);
  markModified(tab, true);
  const next = nb.cells[Math.min(index, nb.cells.length - 1)];
  rerenderCells(tab, { select: next?._id });
}

function moveCell(tab, id, dir) {
  const nb = ensureNotebookModel(tab);
  const { index } = findCell(nb, id);
  const to = index + dir;
  if (index < 0 || to < 0 || to >= nb.cells.length) return;
  snapshot(tab);
  [nb.cells[index], nb.cells[to]] = [nb.cells[to], nb.cells[index]];
  markModified(tab, true);
  rerenderCells(tab, { select: id });
}

function duplicateCell(tab, id) {
  const nb = ensureNotebookModel(tab);
  const { index, cell } = findCell(nb, id);
  if (!cell) return;
  snapshot(tab);
  const copy = newCell(cell.cell_type, sourceToString(cell.source));
  nb.cells.splice(index + 1, 0, copy);
  markModified(tab, true);
  rerenderCells(tab, { select: copy._id });
}

function convertCell(tab, id, type) {
  const nb = ensureNotebookModel(tab);
  const { index, cell } = findCell(nb, id);
  if (!cell || cell.cell_type === type) return;
  snapshot(tab);
  const converted = newCell(type, sourceToString(cell.source));
  converted._id = cell._id;
  nb.cells[index] = converted;
  markModified(tab, true);
  rerenderCells(tab, { select: id });
}

function clearOutputs(tab, cells) {
  snapshot(tab);
  for (const c of cells) {
    if (c.cell_type !== 'code') continue;
    c.outputs = [];
    c.execution_count = null;
    c._status = null;
    c._lastDuration = null;
    paintOutputs(c);
    paintCellState(tab, c);
  }
  markModified(tab, true);
}

function copyCell(tab, id, cut = false) {
  const nb = ensureNotebookModel(tab);
  const { cell } = findCell(nb, id);
  if (!cell) return;
  session(tab).clipboard = { type: cell.cell_type, text: sourceToString(cell.source) };
  if (cut) deleteCell(tab, id);
}

function pasteCell(tab, below = true) {
  const sess = session(tab);
  if (!sess.clipboard) return;
  const nb = ensureNotebookModel(tab);
  const idx = selectedIndex(tab);
  snapshot(tab);
  const cell = newCell(sess.clipboard.type, sess.clipboard.text);
  nb.cells.splice(below ? idx + 1 : Math.max(0, idx), 0, cell);
  markModified(tab, true);
  rerenderCells(tab, { select: cell._id });
}

function runAndAdvance(tab, id, { insertBelow = false } = {}) {
  const nb = ensureNotebookModel(tab);
  const { index, cell } = findCell(nb, id);
  if (!cell) return;
  if (cell.cell_type === 'code') enqueueCells(tab, [cell]);
  else {
    const el = cellEl(id);
    el?.classList.remove('nb-editing');
    const ta = el?.querySelector('textarea');
    ta?.blur();
    const prev = el?.querySelector('.nb-md-preview');
    if (prev) prev.innerHTML = renderMarkdown(sourceToString(cell.source) || EMPTY_MD);
  }
  const next = nb.cells[index + 1];
  if (insertBelow || !next) {
    insertCell(tab, index + 1, 'code');
  } else {
    selectCell(tab, next._id, { edit: next.cell_type === 'code' && false });
  }
}

const EMPTY_MD = '*Двойной щелчок — редактировать текст*';

// ───────────────────────── DOM builders ─────────────────────────

function iconBtn(act, icon, title, extra = '') {
  return `<button type="button" class="nb-icon-btn ${extra}" data-act="${act}" title="${title}">${icon}</button>`;
}

function buildInsertStrip(tab, index) {
  const strip = document.createElement('div');
  strip.className = 'nb-insert';
  strip.innerHTML = `
    <span class="nb-insert-line"></span>
    <button type="button" class="nb-insert-btn" data-type="code">${ICONS.plus}Код</button>
    <button type="button" class="nb-insert-btn" data-type="markdown">${ICONS.plus}Текст</button>
    <span class="nb-insert-line"></span>`;
  strip.addEventListener('click', (e) => {
    const btn = e.target.closest('.nb-insert-btn');
    if (!btn) return;
    insertCell(tab, index, btn.dataset.type);
  });
  return strip;
}

function autoSize(ta) {
  ta.style.height = '0px';
  ta.style.height = Math.max(ta.dataset.min ? Number(ta.dataset.min) : 40, ta.scrollHeight) + 'px';
}

function paintHighlight(ta, pre) {
  if (!pre) return;
  pre.innerHTML = window.SyntaxHighlight ? window.SyntaxHighlight.highlight(ta.value, 'cell.py') : escapeHtml(ta.value) + '\n';
}

function buildCell(tab, cell, index) {
  const nb = ensureNotebookModel(tab);
  const wrap = document.createElement('div');
  wrap.className = `nb-cell nb-cell-${cell.cell_type}`;
  wrap.dataset.cellId = cell._id;
  wrap.tabIndex = -1;
  const isCode = cell.cell_type === 'code';
  // nbformat stores the last line with a trailing newline in many files; the editor must not show an empty extra line.
  const source = sourceToString(cell.source).replace(/\n$/, '');

  const gutter = document.createElement('div');
  gutter.className = 'nb-gutter';
  gutter.innerHTML = isCode
    ? `<button type="button" class="nb-run" title="Выполнить (Ctrl+Enter)">${ICONS.run}</button><div class="nb-count"></div>`
    : '';
  wrap.appendChild(gutter);

  const main = document.createElement('div');
  main.className = 'nb-cell-main';
  const toolbar = document.createElement('div');
  toolbar.className = 'nb-cell-toolbar';
  toolbar.innerHTML = [
    iconBtn('up', ICONS.up, 'Вверх (Alt+↑)'),
    iconBtn('down', ICONS.down, 'Вниз (Alt+↓)'),
    iconBtn('dup', ICONS.copy, 'Дублировать'),
    iconBtn('type', ICONS.swap, isCode ? 'Сделать текстом (M)' : 'Сделать кодом (Y)'),
    isCode ? iconBtn('clear', ICONS.eraser, 'Очистить вывод', 'nb-clear-out') : '',
    iconBtn('del', ICONS.trash, 'Удалить (D, D)', 'danger'),
  ].join('');
  main.appendChild(toolbar);

  const smart = createSmartKeydown(() => ({ tabSize: 4, lang: isCode ? 'py' : 'md', autoPair: isCode }));

  const commonKeys = (ta, e) => {
    if (smart(e)) { cell.source = stringToSource(ta.value); queueMicrotask(() => { afterInput(); }); return true; }
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); runAndAdvance(tab, cell._id); return true; }
    if (e.key === 'Enter' && mod) { e.preventDefault(); if (isCode) enqueueCells(tab, [cell]); else { wrap.classList.remove('nb-editing'); ta.blur(); wrap.focus(); } return true; }
    if (e.key === 'Enter' && e.altKey) { e.preventDefault(); runAndAdvance(tab, cell._id, { insertBelow: true }); return true; }
    if (e.key === 'Escape') { e.preventDefault(); ta.blur(); if (!isCode) wrap.classList.remove('nb-editing'); wrap.focus(); return true; }
    if (!mod && !e.shiftKey && !e.altKey && e.key === 'ArrowUp' && ta.selectionStart === ta.selectionEnd && ta.value.lastIndexOf('\n', ta.selectionStart - 1) === -1) {
      const prev = nb.cells[findCell(nb, cell._id).index - 1];
      if (prev) { e.preventDefault(); selectCell(tab, prev._id, { edit: true }); return true; }
    }
    if (!mod && !e.shiftKey && !e.altKey && e.key === 'ArrowDown' && ta.selectionStart === ta.selectionEnd && ta.value.indexOf('\n', ta.selectionEnd) === -1) {
      const next = nb.cells[findCell(nb, cell._id).index + 1];
      if (next) { e.preventDefault(); selectCell(tab, next._id, { edit: true }); return true; }
    }
    return false;
  };

  let afterInput = () => {};

  if (cell.cell_type === 'markdown') {
    const preview = document.createElement('div');
    preview.className = 'nb-md-preview';
    preview.innerHTML = renderMarkdown(source || EMPTY_MD);
    const editorWrap = document.createElement('div');
    editorWrap.className = 'nb-editor-wrap nb-md-editor-wrap';
    const ta = document.createElement('textarea');
    ta.className = 'nb-md-editor';
    ta.value = source;
    ta.spellcheck = false;
    ta.dataset.min = '64';
    editorWrap.appendChild(ta);
    afterInput = () => autoSize(ta);

    preview.addEventListener('dblclick', () => { wrap.classList.add('nb-editing'); ta.focus(); autoSize(ta); });
    ta.addEventListener('focus', () => { selectCell(tab, cell._id, { scroll: false }); wrap.classList.add('nb-editing'); autoSize(ta); });
    ta.addEventListener('blur', () => {
      cell.source = stringToSource(ta.value);
      preview.innerHTML = renderMarkdown(ta.value || EMPTY_MD);
      wrap.classList.remove('nb-editing');
      markModified(tab);
      if (session(tab).side === 'toc') renderSidePanel(tab);
    });
    ta.addEventListener('input', () => { cell.source = stringToSource(ta.value); tab.modified = true; autoSize(ta); });
    ta.addEventListener('keydown', (e) => commonKeys(ta, e));
    main.appendChild(preview);
    main.appendChild(editorWrap);
  } else {
    const editorWrap = document.createElement('div');
    editorWrap.className = 'nb-editor-wrap';
    const pre = document.createElement('pre');
    pre.className = 'nb-highlight';
    pre.setAttribute('aria-hidden', 'true');
    const ta = document.createElement('textarea');
    ta.className = 'nb-code-editor';
    ta.value = source;
    ta.spellcheck = false;
    ta.rows = 1;
    ta.setAttribute('aria-label', `Ячейка ${index + 1}`);
    if (cell.cell_type === 'raw') pre.style.display = 'none';
    editorWrap.appendChild(pre);
    editorWrap.appendChild(ta);
    const refresh = () => { paintHighlight(ta, pre); autoSize(ta); };
    afterInput = refresh;
    ta.addEventListener('input', () => { cell.source = stringToSource(ta.value); tab.modified = true; refresh(); });
    ta.addEventListener('focus', () => selectCell(tab, cell._id, { scroll: false }));
    ta.addEventListener('blur', () => markModified(tab));
    ta.addEventListener('keydown', (e) => commonKeys(ta, e));
    main.appendChild(editorWrap);
    requestAnimationFrame(refresh);
  }
  wrap.appendChild(main);

  const outWrap = document.createElement('div');
  outWrap.className = 'nb-output-wrap nb-empty';
  const status = document.createElement('div');
  status.className = 'nb-run-status';
  if (isCode) wrap.appendChild(status);
  wrap.appendChild(outWrap);
  if (isCode && cell.outputs?.length) {
    outWrap.classList.remove('nb-empty');
    outWrap.innerHTML = `<div class="nb-output">${outputToHtml(cell.outputs)}</div>`;
  }

  gutter.querySelector('.nb-run')?.addEventListener('click', () => {
    if (cell._state === 'running') interruptKernel(tab);
    else enqueueCells(tab, [cell]);
  });
  wrap.addEventListener('mousedown', (e) => {
    if (session(tab).selectedId !== cell._id) selectCell(tab, cell._id, { scroll: false });
    if (!e.target.closest('textarea, button, a, input, select, .nb-output')) wrap.focus({ preventScroll: true });
  });
  toolbar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const act = btn.dataset.act;
    if (act === 'up') moveCell(tab, cell._id, -1);
    else if (act === 'down') moveCell(tab, cell._id, 1);
    else if (act === 'dup') duplicateCell(tab, cell._id);
    else if (act === 'del') deleteCell(tab, cell._id);
    else if (act === 'type') convertCell(tab, cell._id, isCode ? 'markdown' : 'code');
    else if (act === 'clear') clearOutputs(tab, [cell]);
  });
  return wrap;
}

// ───────────────────────── Command-mode keyboard ─────────────────────────

function onHostKeydown(tab, e) {
  if (e.target.closest('textarea, input, select')) return;
  if (e.target.closest('.nb-menu')) return;
  const nb = ensureNotebookModel(tab);
  const sess = session(tab);
  const idx = selectedIndex(tab);
  const cell = nb.cells[idx];
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key;
  const double = (k) => {
    const hit = sess.lastKey === k && Date.now() - sess.lastKeyAt < 600;
    sess.lastKey = hit ? '' : k;
    sess.lastKeyAt = Date.now();
    return hit;
  };
  const go = (to) => {
    const t = nb.cells[Math.max(0, Math.min(nb.cells.length - 1, to))];
    if (t) selectCell(tab, t._id);
  };

  if (!cell && !(key === 'a' || key === 'b')) return;
  let handled = true;
  if (mod && key === 'Enter') { if (cell.cell_type === 'code') enqueueCells(tab, [cell]); }
  else if (e.shiftKey && key === 'Enter') runAndAdvance(tab, cell._id);
  else if (e.altKey && key === 'Enter') runAndAdvance(tab, cell._id, { insertBelow: true });
  else if (e.altKey && key === 'ArrowUp') moveCell(tab, cell._id, -1);
  else if (e.altKey && key === 'ArrowDown') moveCell(tab, cell._id, 1);
  else if (mod && key.toLowerCase() === 'z') { if (e.shiftKey) restoreSnapshot(tab, 'redo', 'undo'); else restoreSnapshot(tab, 'undo', 'redo'); }
  else if (mod && key.toLowerCase() === 'y') restoreSnapshot(tab, 'redo', 'undo');
  else if (mod || e.altKey) handled = false;
  else if (key === 'Enter') selectCell(tab, cell._id, { edit: true });
  else if (key === 'ArrowUp' || key === 'k') go(idx - 1);
  else if (key === 'ArrowDown' || key === 'j') go(idx + 1);
  else if (key === 'a') insertCell(tab, Math.max(0, idx), 'code');
  else if (key === 'b') insertCell(tab, idx + 1, 'code');
  else if (key === 'd') { if (double('d')) deleteCell(tab, cell._id); }
  else if (key === 'i') { if (double('i')) interruptKernel(tab); }
  else if (key === 'm') convertCell(tab, cell._id, 'markdown');
  else if (key === 'y') convertCell(tab, cell._id, 'code');
  else if (key === 'c') copyCell(tab, cell._id);
  else if (key === 'x') copyCell(tab, cell._id, true);
  else if (key === 'v') pasteCell(tab, !e.shiftKey);
  else if (key === 'z') restoreSnapshot(tab, 'undo', 'redo');
  else if (key === 'o') { cellEl(cell._id)?.classList.toggle('nb-out-collapsed'); }
  else handled = false;
  if (handled) { e.preventDefault(); e.stopPropagation(); }
}

// ───────────────────────── Side panel (outline / variables) ─────────────────────────

function renderSidePanel(tab) {
  const host = getNotebookHost();
  const side = host?.querySelector('.nb-side');
  const sess = session(tab);
  if (!side) return;
  host.querySelector('.nb-body')?.classList.toggle('with-side', !!sess.side);
  side.hidden = !sess.side;
  host.querySelectorAll('[data-nb-action="side-toc"], [data-nb-action="side-vars"]').forEach((b) => {
    b.classList.toggle('active', b.dataset.nbAction === `side-${sess.side}`);
  });
  if (!sess.side) return;
  const nb = ensureNotebookModel(tab);
  if (sess.side === 'toc') {
    const items = [];
    nb.cells.forEach((c) => {
      if (c.cell_type !== 'markdown') return;
      sourceToString(c.source).split('\n').forEach((line) => {
        const m = /^(#{1,4})\s+(.+?)\s*#*$/.exec(line);
        if (m) items.push({ level: m[1].length, text: m[2], id: c._id });
      });
    });
    side.innerHTML = `<div class="nb-side-title">Оглавление</div>` + (items.length
      ? items.map((it) => `<button type="button" class="nb-toc-item" style="padding-left:${8 + (it.level - 1) * 14}px" data-id="${it.id}">${escapeHtml(it.text)}</button>`).join('')
      : '<div class="nb-side-empty">Заголовки появятся здесь. Добавьте текстовый блок с «# Заголовок».</div>');
    side.querySelectorAll('.nb-toc-item').forEach((b) => b.addEventListener('click', () => selectCell(tab, b.dataset.id)));
  } else {
    side.innerHTML = `<div class="nb-side-title">Переменные<button type="button" class="nb-icon-btn" data-act="refresh-vars" title="Обновить">${ICONS.restart}</button></div><div class="nb-vars"></div>`;
    side.querySelector('[data-act="refresh-vars"]').addEventListener('click', () => refreshVariables(tab));
    refreshVariables(tab);
  }
}

async function refreshVariables(tab) {
  const host = getNotebookHost();
  const box = host?.querySelector('.nb-vars');
  if (!box) return;
  const sess = session(tab);
  if (sess.kernel.status !== 'idle' && sess.kernel.status !== 'busy') {
    box.innerHTML = '<div class="nb-side-empty">Запустите ячейку, чтобы увидеть переменные.</div>';
    return;
  }
  const msgId = uid();
  const items = await new Promise((resolve) => {
    sess.pending.set(msgId, { kind: 'vars', resolve });
    window.electronAPI.kernelVars({ id: kernelIdOf(tab), msgId }).then((r) => { if (!r?.success) { sess.pending.delete(msgId); resolve([]); } });
    setTimeout(() => { if (sess.pending.delete(msgId)) resolve([]); }, 4000);
  });
  if (!host.contains(box)) return;
  box.innerHTML = items.length
    ? `<table><thead><tr><th>Имя</th><th>Тип</th><th>Значение</th></tr></thead><tbody>${items.map((v) => `<tr><td>${escapeHtml(v.name)}</td><td>${escapeHtml(v.type)}${v.size ? ` <span class="nb-dim">${escapeHtml(v.size)}</span>` : ''}</td><td class="nb-var-val" title="${escapeHtml(v.value)}">${escapeHtml(v.value)}</td></tr>`).join('')}</tbody></table>`
    : '<div class="nb-side-empty">Пока нет переменных.</div>';
}

// ───────────────────────── Toolbar + main render ─────────────────────────

function openMenu(anchor, entries) {
  document.querySelectorAll('.nb-menu').forEach((m) => m.remove());
  const menu = document.createElement('div');
  menu.className = 'nb-menu';
  menu.innerHTML = entries.map((e, i) => (e === '-' ? '<div class="nb-menu-sep"></div>' : `<button type="button" data-i="${i}">${e.label}</button>`)).join('');
  const r = anchor.getBoundingClientRect();
  menu.style.left = `${r.left}px`;
  menu.style.top = `${r.bottom + 4}px`;
  document.body.appendChild(menu);
  const close = () => { menu.remove(); document.removeEventListener('mousedown', onDoc, true); };
  const onDoc = (ev) => { if (!menu.contains(ev.target)) close(); };
  menu.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-i]');
    if (!b) return;
    close();
    entries[Number(b.dataset.i)].run();
  });
  setTimeout(() => document.addEventListener('mousedown', onDoc, true), 0);
}

export async function renderNotebook(tab) {
  const host = getNotebookHost();
  if (!host || !tab) return;
  const nb = ensureNotebookModel(tab);
  ensureIds(nb);
  const sess = session(tab);
  ensureKernelListener();
  const workspace = workspaceForTab(tab);
  const envs = await loadPythonEnvs(workspace);
  const current = getSelectedKernel(nb);

  const matchCurrent = envs.find((e) => e.pythonPath === current.pythonPath || e.id === current.name || e.pythonPath === current.name);
  if (!matchCurrent && envs.length) setSelectedKernel(nb, envs.find((e) => e.preferred) || envs[0]);
  const selected = getSelectedKernel(nb);
  host.innerHTML = '';

  const toolbar = document.createElement('div');
  toolbar.className = 'nb-toolbar';
  const kernelOptions = !envs.length
    ? `<option value="">${workspace ? 'Python не найден — создайте .venv в проекте' : 'Откройте папку проекта, чтобы выбрать venv'}</option>`
    : envs.map((e) => `<option value="${escapeHtml(e.pythonPath)}" title="${escapeHtml(e.pythonPath)}"${e.pythonPath === selected.pythonPath || e.id === selected.name ? ' selected' : ''}>${escapeHtml(e.detail ? `${e.display_name} — ${e.detail}` : e.display_name)}</option>`).join('');

  toolbar.innerHTML = `
    <div class="nb-toolbar-group">
      <button type="button" class="nb-btn" data-nb-action="add-code">${ICONS.plus}Код</button>
      <button type="button" class="nb-btn" data-nb-action="add-md">${ICONS.plus}Текст</button>
    </div>
    <div class="nb-toolbar-group">
      <button type="button" class="nb-btn nb-btn-primary" data-nb-action="run-all" title="Выполнить все ячейки">${ICONS.run}Выполнить всё</button>
      <button type="button" class="nb-btn nb-btn-icon" data-nb-action="run-menu" title="Выполнить…">${ICONS.chevron}</button>
      <button type="button" class="nb-btn nb-btn-icon" data-nb-action="interrupt" title="Прервать (I, I)" disabled>${ICONS.stop}</button>
      <button type="button" class="nb-btn nb-btn-icon" data-nb-action="restart" title="Перезапустить ядро">${ICONS.restart}</button>
    </div>
    <div class="nb-toolbar-group">
      <button type="button" class="nb-btn nb-btn-icon" data-nb-action="clear-all" title="Очистить все выводы">${ICONS.eraser}</button>
      <button type="button" class="nb-btn nb-btn-icon" data-nb-action="side-toc" title="Оглавление">${ICONS.list}</button>
      <button type="button" class="nb-btn" data-nb-action="side-vars" title="Переменные">{x}</button>
    </div>
    <div class="nb-toolbar-spacer"></div>
    <div class="nb-kernel-badge" data-status="${sess.kernel.status}"><span class="nb-dot"></span><span class="nb-kernel-text"></span></div>
    <div class="nb-kernel-wrap">
      <select class="nb-kernel-select" title="Python / venv"${envs.length ? '' : ' disabled'}>${kernelOptions}</select>
      <button type="button" class="nb-btn nb-btn-icon" data-nb-action="refresh-envs" title="Обновить список интерпретаторов">${ICONS.restart}</button>
    </div>`;
  host.appendChild(toolbar);

  const body = document.createElement('div');
  body.className = 'nb-body';
  const list = document.createElement('div');
  list.className = 'nb-cells';
  const side = document.createElement('aside');
  side.className = 'nb-side';
  side.hidden = true;
  body.appendChild(list);
  body.appendChild(side);
  host.appendChild(body);

  setKernelStatus(tab, sess.kernel.status);
  rerenderCells(tab, { select: sess.selectedId });
  renderSidePanel(tab);

  toolbar.querySelector('.nb-kernel-select').addEventListener('change', (ev) => {
    const env = envs.find((x) => x.pythonPath === ev.target.value);
    if (!env) return;
    setSelectedKernel(nb, env);
    shutdownNotebookKernel(tab);
    setKernelStatus(tab, 'none');
    markModified(tab, true);
  });

  toolbar.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-nb-action]');
    if (!btn || btn.disabled) return;
    const action = btn.dataset.nbAction;
    const idx = Math.max(0, selectedIndex(tab));
    if (action === 'add-code') insertCell(tab, idx + 1, 'code');
    else if (action === 'add-md') insertCell(tab, idx + 1, 'markdown');
    else if (action === 'run-all') enqueueCells(tab, nb.cells);
    else if (action === 'interrupt') interruptKernel(tab);
    else if (action === 'restart') restartKernel(tab);
    else if (action === 'clear-all') clearOutputs(tab, nb.cells);
    else if (action === 'side-toc' || action === 'side-vars') {
      const want = action === 'side-toc' ? 'toc' : 'vars';
      sess.side = sess.side === want ? null : want;
      renderSidePanel(tab);
    } else if (action === 'refresh-envs') {
      invalidatePythonEnvCache();
      await renderNotebook(tab);
    } else if (action === 'run-menu') {
      openMenu(btn, [
        { label: 'Выполнить выбранную', run: () => enqueueCells(tab, [nb.cells[idx]].filter(Boolean)) },
        { label: 'Выполнить все выше', run: () => enqueueCells(tab, nb.cells.slice(0, idx)) },
        { label: 'Выполнить выбранную и ниже', run: () => enqueueCells(tab, nb.cells.slice(idx)) },
        '-',
        { label: 'Перезапустить и выполнить всё', run: () => restartKernel(tab, { runAll: true }) },
      ]);
    }
  });

  host.onkeydown = (ev) => onHostKeydown(tab, ev);
}

export function createNotebookTab(name = 'Untitled.ipynb', filePath = null) {
  const nb = emptyNotebook();
  ensureIds(nb);
  return {
    id: Date.now() + Math.random(),
    kind: 'notebook',
    name: name || 'Untitled.ipynb',
    content: serializeNotebook(nb),
    notebook: nb,
    filePath: filePath || null,
    modified: !filePath
  };
}

export { isNotebookTab, isNotebookPath };

/** Entry point for palette / shortcuts so other modules never touch notebook internals. */
export function runNotebookCommand(tab, cmd) {
  if (!tab || !isNotebookTab(tab)) return;
  const nb = ensureNotebookModel(tab);
  const idx = Math.max(0, selectedIndex(tab));
  switch (cmd) {
    case 'run-all': enqueueCells(tab, nb.cells); break;
    case 'restart': restartKernel(tab); break;
    case 'restart-run': restartKernel(tab, { runAll: true }); break;
    case 'interrupt': interruptKernel(tab); break;
    case 'clear': clearOutputs(tab, nb.cells); break;
    case 'add-code': insertCell(tab, idx + 1, 'code'); break;
    case 'add-md': insertCell(tab, idx + 1, 'markdown'); break;
    default: break;
  }
}
