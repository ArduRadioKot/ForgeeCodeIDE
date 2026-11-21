/**
 * Everyday editor pieces that were missing: breadcrumbs, recent projects,
 * jump to the matching bracket, extend selection, and Ctrl/Cmd-click to open a path or URL.
 */
import { state } from './state.js';
import { isEditorTab } from './tab-model.js';
import { getLang, onLangChange } from './i18n.js';
import { pathUtils } from './utils.js';
import { hydrateIcons } from './glyphs.js';

const RECENT = 'frogee.recentFolders';
const MAX = 8;
const OPEN = '([{';
const CLOSE = ')]}';

const readRecent = () => { try { const v = JSON.parse(localStorage.getItem(RECENT)); return Array.isArray(v) ? v.filter((p) => typeof p === 'string') : []; } catch { return []; } };
const writeRecent = (list) => { try { localStorage.setItem(RECENT, JSON.stringify(list.slice(0, MAX))); } catch { /* storage full */ } };

export function rememberFolder(folder) {
  if (!folder) return;
  writeRecent([folder, ...readRecent().filter((p) => p !== folder)]);
  renderRecent();
}

function normPath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
}

function insideFolder(dir, root) {
  const d = normPath(dir);
  const r = normPath(root);
  return !!r && (d === r || d.startsWith(r + '/'));
}

function editorOf(prefer) {
  const right = document.getElementById('editor-right');
  if (prefer === 'right' && right) return right;
  if (prefer === 'left') return document.getElementById('editor');
  if (state.splitView && state.focusedPane === 'right' && right) return right;
  return document.getElementById('editor');
}

function activeEditorTab() {
  if (state.splitView && state.focusedPane === 'right') {
    const tab = state.currentTabs[state.rightTabIndex];
    if (isEditorTab(tab)) return { tab, area: editorOf('right') };
  }
  const tab = state.currentTabs[state.activeTabIndex];
  return isEditorTab(tab) ? { tab, area: editorOf('left') } : { tab: null, area: null };
}

function contextFor(editor) {
  if (editor) {
    const right = editor.id === 'editor-right';
    const tab = state.currentTabs[right ? state.rightTabIndex : state.activeTabIndex];
    return { tab: isEditorTab(tab) ? tab : null, area: editor };
  }
  return activeEditorTab();
}

/* ── recent projects ── */

async function openRecentFolder(folder) {
  const st = await window.electronAPI?.fileStat?.(folder).catch(() => null);
  if (st && (!st.exists || st.isDirectory === false)) {
    writeRecent(readRecent().filter((p) => p !== folder));
    renderRecent();
    return;
  }
  const { loadFolderContents, switchActivity } = await import('./explorer.js');
  const { hideWelcomePage } = await import('./tabs.js');
  switchActivity('explorer');
  hideWelcomePage();
  await loadFolderContents(folder);
}

function renderRecent() {
  const section = document.getElementById('recent-section');
  const list = document.getElementById('recent-list');
  if (!section || !list) return;
  const items = readRecent();
  section.hidden = !items.length;
  const en = getLang() === 'en';
  list.replaceChildren();
  for (const folder of items) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'action-item recent-item';
    const name = pathUtils.basename(folder) || folder;
    row.innerHTML = '<div class="action-icon"><span class="ico-wrap" data-icon="folder" data-size="24"></span></div><div class="action-text"><div class="action-title"></div><div class="action-description"></div></div>';
    row.querySelector('.action-title').textContent = name;
    row.querySelector('.action-description').textContent = folder;
    row.title = en ? `Open ${folder}` : `Открыть ${folder}`;
    row.addEventListener('click', () => openRecentFolder(folder));
    list.append(row);
  }
  hydrateIcons(list);
}

async function pruneRecent() {
  const items = readRecent();
  if (!items.length || !window.electronAPI?.fileStat) return;
  const keep = [];
  for (const folder of items) {
    try {
      const st = await window.electronAPI.fileStat(folder);
      if (st?.exists && st.isDirectory !== false) keep.push(folder);
    } catch { keep.push(folder); }
  }
  if (keep.length !== items.length) writeRecent(keep);
  renderRecent();
}

export function recentPaletteItems() {
  const en = getLang() === 'en';
  return readRecent().map((folder) => {
    const name = pathUtils.basename(folder) || folder;
    const label = `${en ? 'Recent' : 'Недавний'}: ${name}`;
    return { label, detail: folder, search: `${label} ${folder}`, run: () => openRecentFolder(folder) };
  });
}

/* ── breadcrumbs ── */

function symbolOf(line) {
  const head = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
  if (head) return { indent: head[1].length, name: head[2].trim() };
  const decl = /^( *)(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|class|def|fn|func|interface|struct|enum|trait|impl|module|namespace|type)\s+([A-Za-z_\u0400-\u04FF$][\w$]*)/.exec(line);
  if (decl) return { indent: decl[1].length + 8, name: decl[2] };
  const arrow = /^( *)(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(|function)/.exec(line);
  if (arrow) return { indent: arrow[1].length + 8, name: arrow[2] };
  return null;
}

function scopeChain(text, cursor) {
  const lines = text.split('\n');
  const upto = text.slice(0, cursor).split('\n').length - 1;
  const stack = [];
  for (let i = 0; i <= upto && i < lines.length; i++) {
    const sym = symbolOf(lines[i]);
    if (!sym) continue;
    while (stack.length && stack[stack.length - 1].indent >= sym.indent) stack.pop();
    stack.push({ ...sym, line: i + 1 });
  }
  return stack;
}

function crumbSep() {
  const s = document.createElement('span');
  s.className = 'bc-sep';
  s.textContent = '›';
  return s;
}

async function revealFolder(dir) {
  const { switchActivity, sortExplorerItems, updateFileExplorer } = await import('./explorer.js');
  switchActivity('explorer');
  const root = state.currentFolder;
  if (!insideFolder(dir, root) || normPath(dir) === normPath(root)) return;
  const sepCh = root.includes('\\') ? '\\' : '/';
  const rel = normPath(dir).slice(normPath(root).length).split('/').filter(Boolean);
  let cur = root;
  for (const part of rel) {
    cur = cur.replace(/[\\/]$/, '') + sepCh + part;
    state.expandedFolders.add(cur);
    if (!state.folderChildrenCache.has(cur)) {
      const result = await window.electronAPI.listFiles(cur);
      state.folderChildrenCache.set(cur, result?.success ? sortExplorerItems(result.files || []) : []);
    }
  }
  updateFileExplorer();
  requestAnimationFrame(() => document.querySelector(`[data-path="${CSS.escape(cur)}"]`)?.scrollIntoView({ block: 'nearest' }));
}

function renderBreadcrumbs() {
  const bar = document.getElementById('breadcrumbs');
  if (!bar) return;
  const row = document.getElementById('editors-row');
  if (!row || row.style.display === 'none') { bar.hidden = true; return; }
  const { tab, area } = activeEditorTab();
  if (!tab || !area || state.terminalInEditor) { bar.hidden = true; return; }
  bar.hidden = false;
  const parts = [];
  const file = tab.filePath || '';
  const root = state.currentFolder || '';
  if (file && root && insideFolder(file, root)) {
    const rel = normPath(file).slice(normPath(root).length).split('/').filter(Boolean);
    const sepCh = root.includes('\\') ? '\\' : '/';
    let acc = root;
    rel.forEach((name, i) => {
      acc = acc.replace(/[\\/]$/, '') + sepCh + name;
      parts.push({ name, path: acc, file: i === rel.length - 1 });
    });
  } else {
    parts.push({ name: tab.name || 'Untitled', path: file, file: true });
  }
  const chain = scopeChain(area.value || '', area.selectionStart || 0);
  const key = parts.map((p) => p.path).join('|') + '>' + chain.map((s) => s.line + s.name).join('|');
  if (bar.dataset.key === key) return;
  bar.dataset.key = key;
  bar.replaceChildren();
  const pane = state.splitView && state.focusedPane === 'right' ? 'right' : 'left';
  parts.forEach((part, i) => {
    if (i) bar.append(crumbSep());
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = part.name;
    b.title = part.path || part.name;
    if (part.file) b.className = 'bc-current';
    else if (part.path) b.addEventListener('click', () => revealFolder(part.path));
    bar.append(b);
  });
  for (const sym of chain) {
    bar.append(crumbSep());
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'bc-sym';
    b.textContent = sym.name;
    b.title = getLang() === 'en' ? `Line ${sym.line}` : `Строка ${sym.line}`;
    b.addEventListener('click', async () => {
      const { goToEditorLine } = await import('./explorer.js');
      goToEditorLine(sym.line, pane);
    });
    bar.append(b);
  }
}

/* ── matching brackets ── */

let pairText = '';
let pairHash = false;
let pairMap = null;
let quoteSpans = [];

function scanPairs(text, hashComments) {
  if (text === pairText && pairHash === !!hashComments && pairMap) return { map: pairMap, quotes: quoteSpans };
  const map = new Map();
  const quotes = [];
  const stack = [];
  let quote = '';
  let quoteAt = -1;
  let escape = false;
  let lineComment = false;
  let block = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\n') { lineComment = false; escape = false; }
    if (lineComment || block) {
      if (block && c === '*' && text[i + 1] === '/') { block = false; i++; }
      continue;
    }
    if (quote) {
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === quote) { quotes.push([quoteAt, i]); quote = ''; }
      continue;
    }
    if (c === '/' && text[i + 1] === '/') { lineComment = true; continue; }
    if (c === '/' && text[i + 1] === '*') { block = true; i++; continue; }
    if (hashComments && c === '#') { lineComment = true; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; quoteAt = i; continue; }
    const o = OPEN.indexOf(c);
    if (o >= 0) { stack.push(i); continue; }
    const cl = CLOSE.indexOf(c);
    if (cl >= 0) {
      const openAt = stack.pop();
      if (openAt != null && text[openAt] === OPEN[cl]) { map.set(openAt, i); map.set(i, openAt); }
    }
  }
  pairText = text;
  pairHash = !!hashComments;
  pairMap = map;
  quoteSpans = quotes;
  return { map, quotes };
}

function bracketAt(text, index) {
  if (OPEN.includes(text[index]) || CLOSE.includes(text[index])) return index;
  if (index > 0 && (OPEN.includes(text[index - 1]) || CLOSE.includes(text[index - 1]))) return index - 1;
  return -1;
}

function hashLang(name) {
  return /\.(py|r|rb|sh|yml|yaml|toml|pl)$/i.test(name || '');
}

const marks = new WeakMap();

function metrics(editor) {
  const cs = getComputedStyle(editor);
  const lh = parseFloat(cs.lineHeight) || 22;
  const canvas = metrics.ctx || (metrics.ctx = document.createElement('canvas').getContext('2d'));
  canvas.font = cs.font;
  return { lh, cw: canvas.measureText('0').width || 8, padL: parseFloat(cs.paddingLeft) || 0, padT: parseFloat(cs.paddingTop) || 0, tab: parseInt(cs.tabSize, 10) || 4 };
}

function boxAt(editor, text, index) {
  const lines = text.slice(0, index).split('\n');
  const row = lines.length - 1;
  const m = metrics(editor);
  let col = 0;
  for (const ch of lines[row]) col += ch === '\t' ? m.tab - (col % m.tab) : 1;
  return {
    left: m.padL + col * m.cw - editor.scrollLeft,
    top: m.padT + row * m.lh - editor.scrollTop,
    width: Math.max(2, m.cw),
    height: m.lh,
  };
}

function paintBrackets(editor, name) {
  const wrap = editor?.closest('.code-editor-wrap');
  if (!wrap) return;
  let nodes = marks.get(wrap);
  if (!nodes) {
    nodes = [document.createElement('span'), document.createElement('span')];
    nodes.forEach((n) => { n.className = 'bracket-mark'; n.hidden = true; wrap.append(n); });
    marks.set(wrap, nodes);
  }
  const text = editor.value || '';
  const collapsed = editor.selectionStart === editor.selectionEnd;
  const at = collapsed ? bracketAt(text, editor.selectionStart || 0) : -1;
  const wrapped = editor.classList.contains('word-wrap');
  if (at < 0 || wrapped || document.activeElement !== editor) {
    nodes.forEach((n) => { n.hidden = true; });
    return;
  }
  const other = scanPairs(text, hashLang(name)).map.get(at);
  const spots = other == null ? [at] : [at, other];
  nodes.forEach((n, i) => {
    const spot = spots[i];
    if (spot == null) { n.hidden = true; return; }
    const box = boxAt(editor, text, spot);
    n.hidden = false;
    n.classList.toggle('unmatched', other == null);
    n.style.left = `${box.left}px`;
    n.style.top = `${box.top}px`;
    n.style.width = `${box.width}px`;
    n.style.height = `${box.height}px`;
  });
}

export function jumpToBracket(editor) {
  const { tab, area } = contextFor(editor);
  if (!area) return;
  const text = area.value || '';
  const at = bracketAt(text, area.selectionStart || 0);
  if (at < 0) return;
  const other = scanPairs(text, hashLang(tab?.name)).map.get(at);
  if (other == null) return;
  const target = other + (CLOSE.includes(text[other]) ? 1 : 0);
  area.focus();
  area.setSelectionRange(target, target);
  const row = text.slice(0, other).split('\n').length - 1;
  const lh = metrics(area).lh;
  const top = row * lh;
  if (top < area.scrollTop || top > area.scrollTop + area.clientHeight - lh * 2) area.scrollTop = Math.max(0, top - area.clientHeight / 3);
  paintBrackets(area, tab?.name);
}

/* ── extend / shrink selection ── */

const selStack = new WeakMap();

function tightest(ranges, start, end) {
  let best = null;
  const last = end > start ? end - 1 : end;
  for (const [a, b] of ranges) {
    if (a <= start && b >= last && (a < start || b >= end)) {
      if (!best || (b - a) < (best[1] - best[0])) best = [a, b];
    }
  }
  return best;
}

function lineSpan(text, start, end) {
  const from = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  let to = text.indexOf('\n', Math.max(start, end));
  if (to < 0) to = text.length;
  return [from, to];
}

function nextSelection(text, start, end, hash) {
  if (start === end) {
    const left = (text.slice(0, start).match(/[\w$]*$/) || [''])[0].length;
    const right = (text.slice(start).match(/^[\w$]*/) || [''])[0].length;
    if (left + right > 0) return [start - left, start + right];
  }
  const scanned = scanPairs(text, hash);
  const contains = (range) => range && range[0] <= start && range[1] >= end && (range[0] < start || range[1] > end) && range[0] >= 0 && range[1] <= text.length;
  const candidates = [];
  for (const span of [tightest(scanned.quotes, start, end), tightest(scanned.map, start, end)]) {
    if (!span) continue;
    candidates.push([span[0] + 1, span[1]], [span[0], span[1] + 1]);
  }
  candidates.push(lineSpan(text, start, end));
  if (start !== 0 || end !== text.length) candidates.push([0, text.length]);
  let best = null;
  for (const range of candidates) {
    if (!contains(range)) continue;
    if (!best || range[1] - range[0] < best[1] - best[0]) best = range;
  }
  return best || [start, end];
}

export function expandSelection(editor) {
  const { tab, area } = contextFor(editor);
  if (!area) return;
  const next = nextSelection(area.value || '', area.selectionStart, area.selectionEnd, hashLang(tab?.name));
  if (next[0] === area.selectionStart && next[1] === area.selectionEnd) return;
  const stack = selStack.get(area) || [];
  stack.push([area.selectionStart, area.selectionEnd]);
  if (stack.length > 40) stack.shift();
  selStack.set(area, stack);
  area.setSelectionRange(next[0], next[1]);
}

export function shrinkSelection(editor) {
  const { area } = contextFor(editor);
  if (!area) return;
  const prev = selStack.get(area)?.pop();
  if (!prev) return;
  area.setSelectionRange(prev[0], prev[1]);
}

/* ── Ctrl/Cmd-click opens a path or a link ── */

function pointerOpens(e) {
  if (e.shiftKey || e.altKey) return false;
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  return mac ? (e.metaKey && !e.ctrlKey) : (e.ctrlKey && !e.metaKey);
}

function tokenAt(text, index) {
  const before = text.slice(0, index);
  const quoted = /(?:^|[\s(=[{,:])(['"`])([^'"`\n]*)$/.exec(before);
  if (quoted) {
    const rest = (text.slice(index).match(/^[^'"`\n]*/) || [''])[0];
    return { raw: quoted[2] + rest, quoted: true };
  }
  const left = (before.match(/[^\s'"`()[\]{},;]*$/) || [''])[0];
  const right = (text.slice(index).match(/^[^\s'"`()[\]{},;]*/) || [''])[0];
  return { raw: left + right, quoted: false };
}

function parseTarget(raw) {
  let spec = String(raw || '').trim().replace(/[),.;]+$/, '');
  let line = 0;
  if (!/^https?:/i.test(spec)) {
    const mark = /:(\d+)(?::\d+)?$/.exec(spec);
    if (mark) { line = Number(mark[1]); spec = spec.slice(0, mark.index); }
  }
  return { spec, line };
}

function looksOpenable(spec, quoted) {
  if (!spec || spec.length < 2 || /\s/.test(spec)) return false;
  if (/^https?:\/\//i.test(spec)) return true;
  if (spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/') || /^[A-Za-z]:[\\/]/.test(spec) || /[\\/]/.test(spec)) return true;
  return !!quoted && /\.[a-z0-9]{1,8}$/i.test(spec);
}

function joinSpec(base, spec) {
  const sep = (base || '').includes('\\') ? '\\' : '/';
  const root = base === '/' || base === '\\';
  const combined = root ? sep + spec.replace(/^[\\/]/, '') : (base ? base.replace(/[\\/]$/, '') + sep : '') + spec;
  const bits = combined.split(/[\\/]/);
  const out = [];
  for (const bit of bits) {
    if (!bit || bit === '.') continue;
    if (bit === '..') out.pop();
    else out.push(bit);
  }
  return (combined.startsWith('/') || combined.startsWith('\\') ? sep : '') + out.join(sep);
}

function candidateFiles(spec, filePath) {
  if (/^https?:\/\//i.test(spec)) return [{ url: spec }];
  if (spec.startsWith('/') || /^[A-Za-z]:[\\/]/.test(spec)) return [{ file: spec }];
  const near = filePath ? pathUtils.dirname(filePath) : '';
  const root = state.currentFolder || '';
  const bases = spec.startsWith('./') || spec.startsWith('../')
    ? [near || root]
    : [near, root].filter(Boolean);
  const files = [];
  for (const base of bases) {
    const file = joinSpec(base, spec);
    if (!files.includes(file)) files.push(file);
  }
  return files.map((file) => ({ file }));
}

function indexFromPoint(editor, clientX, clientY) {
  if (!editor || editor.classList.contains('word-wrap')) return null;
  const rect = editor.getBoundingClientRect();
  const m = metrics(editor);
  const x = clientX - rect.left - m.padL + editor.scrollLeft;
  const y = clientY - rect.top - m.padT + editor.scrollTop;
  const lines = (editor.value || '').split('\n');
  if (!lines.length) return 0;
  const row = Math.max(0, Math.min(lines.length - 1, Math.floor(y / m.lh)));
  const target = Math.max(0, x / (m.cw || 8));
  const line = lines[row];
  let cells = 0;
  let i = 0;
  for (; i < line.length; i++) {
    const w = line[i] === '\t' ? m.tab - (cells % m.tab) : 1;
    if (cells + w / 2 >= target) break;
    cells += w;
  }
  let index = 0;
  for (let r = 0; r < row; r++) index += lines[r].length + 1;
  return index + i;
}

async function followToken(area, filePath, index) {
  const tok = tokenAt(area.value || '', index);
  const { spec, line } = parseTarget(tok.raw);
  if (!looksOpenable(spec, tok.quoted)) return false;
  const candidates = candidateFiles(spec, filePath);
  if (candidates[0]?.url) {
    await window.electronAPI?.openExternal?.(candidates[0].url);
    return true;
  }
  for (const target of candidates) {
    const st = await window.electronAPI?.fileStat?.(target.file);
    if (!st?.exists) continue;
    if (st.isDirectory) {
      if (state.currentFolder && insideFolder(target.file, state.currentFolder)) await revealFolder(target.file);
      else await openRecentFolder(target.file);
      return true;
    }
    const { openSearchFileAtLine, openSearchFile } = await import('./explorer.js');
    if (line) openSearchFileAtLine(target.file, line);
    else openSearchFile(target.file);
    return true;
  }
  return false;
}

function armEditor(editor, getFile) {
  if (!editor || editor.dataset.navExtras) return;
  editor.dataset.navExtras = '1';
  const nameOf = () => (editor.id === 'editor-right' ? state.currentTabs[state.rightTabIndex]?.name : state.currentTabs[state.activeTabIndex]?.name) || '';
  const refresh = () => {
    paintBrackets(editor, nameOf());
    renderBreadcrumbs();
  };
  editor.addEventListener('keyup', refresh);
  editor.addEventListener('mouseup', refresh);
  editor.addEventListener('click', refresh);
  editor.addEventListener('focus', refresh);
  editor.addEventListener('scroll', () => paintBrackets(editor, nameOf()));
  editor.addEventListener('click', (e) => {
    if (!pointerOpens(e)) return;
    const index = indexFromPoint(editor, e.clientX, e.clientY);
    setTimeout(() => followToken(editor, getFile(), index ?? editor.selectionStart ?? 0), 0);
  });
  editor.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.shiftKey && !e.altKey && (e.key === '\\' || e.code === 'Backslash')) {
      e.preventDefault();
      e.stopPropagation();
      jumpToBracket(editor);
      return;
    }
    if (e.altKey && e.shiftKey && !mod && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'ArrowRight') expandSelection(editor);
      else shrinkSelection(editor);
    }
  });
  editor.addEventListener('mousemove', (e) => {
    if (!pointerOpens(e)) { editor.classList.remove('link-cursor'); return; }
    const index = indexFromPoint(editor, e.clientX, e.clientY);
    if (index == null) { editor.classList.remove('link-cursor'); return; }
    const tok = tokenAt(editor.value || '', index);
    editor.classList.toggle('link-cursor', looksOpenable(parseTarget(tok.raw).spec, tok.quoted));
  });
  editor.addEventListener('keyup', (e) => { if (!e.metaKey && !e.ctrlKey) editor.classList.remove('link-cursor'); });
  editor.addEventListener('blur', () => { editor.classList.remove('link-cursor'); paintBrackets(editor, nameOf()); });
}

export function setupNavExtras() {
  onLangChange(() => { renderRecent(); const bar = document.getElementById('breadcrumbs'); if (bar) bar.dataset.key = ''; renderBreadcrumbs(); });
  renderRecent();
  let seenFolder = state.currentFolder;
  if (seenFolder) rememberFolder(seenFolder);
  pruneRecent();
  window.addEventListener('frogee:title', () => {
    if (state.currentFolder && state.currentFolder !== seenFolder) {
      seenFolder = state.currentFolder;
      rememberFolder(seenFolder);
    }
    renderBreadcrumbs();
  });
  window.addEventListener('frogee:content', () => {
    const { tab, area } = activeEditorTab();
    if (area) paintBrackets(area, tab?.name);
    renderBreadcrumbs();
  });
  armEditor(document.getElementById('editor'), () => state.currentTabs[state.activeTabIndex]?.filePath || '');
  armEditor(document.getElementById('editor-right'), () => state.currentTabs[state.rightTabIndex]?.filePath || '');
}
