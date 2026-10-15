/**
 * Markdown: live preview next to the editor, formatting shortcuts, list continuation, tables, outline and HTML export.
 */
import { state } from './state.js';
import { isEditorTab, isPreviewTab } from './tab-model.js';
import { escapeHtml, sanitizeHtml } from './utils.js';
import { openTabInSplit, closeTab, updateTabsList } from './tabs-api.js';
import { autoIndentEnabled } from './smart-edit.js';

const DELAY = 120;
let timer = 0;
let syncing = false;

const ed = () => document.getElementById('editor');
const body = () => document.getElementById('md-preview-body');

export function isMarkdownTab(tab = state.currentTabs[state.activeTabIndex]) {
  return !!tab && isEditorTab(tab) && /\.(md|markdown|mdx)$/i.test(tab.name || tab.filePath || '');
}

function dirUrl(filePath) {
  if (!filePath) return '';
  const dir = filePath.replace(/[\\/][^\\/]*$/, '');
  return 'file://' + (dir.startsWith('/') ? '' : '/') + dir.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/') + '/';
}

export function renderMarkdownHtml(text, filePath) {
  if (!window.marked) return `<pre>${escapeHtml(text)}</pre>`;
  const parse = window.marked.parse || window.marked;
  let html = sanitizeHtml(parse(text || '', { gfm: true, breaks: false }));
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const base = dirUrl(filePath);
  doc.body.querySelectorAll('img[src]').forEach((img) => {
    const src = img.getAttribute('src');
    if (base && !/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(src)) img.setAttribute('src', new URL(src, base).href);
  });
  doc.body.querySelectorAll('pre > code').forEach((code) => {
    const lang = (/language-([\w+#-]+)/.exec(code.className) || [])[1];
    if (lang && window.SyntaxHighlight) code.innerHTML = window.SyntaxHighlight.highlightByName(code.textContent, lang);
  });
  let n = 0;
  doc.body.querySelectorAll('input[type="checkbox"]').forEach((box) => { box.removeAttribute('disabled'); box.dataset.task = String(n++); });
  doc.body.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h) => { h.id = 'md-' + h.textContent.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, ''); });
  return doc.body.innerHTML;
}

function stats(text) {
  const words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
  return { words, minutes: Math.max(1, Math.round(words / 200)) };
}

function updateStats() {
  const el = document.getElementById('status-words');
  const btn = document.getElementById('md-preview-btn');
  const on = isMarkdownTab();
  if (btn) { btn.hidden = !on; btn.classList.toggle('active', !!rightPreview()); }
  if (!el) return;
  el.hidden = !on;
  if (!on) return;
  const text = ed().value;
  const sel = ed().selectionEnd > ed().selectionStart ? ed().value.slice(ed().selectionStart, ed().selectionEnd) : null;
  const s = stats(sel ?? text);
  el.textContent = `${s.words} сл.${sel ? ' (выд.)' : ` · ~${s.minutes} мин`}`;
}

function rightPreview() {
  const tab = state.splitView ? state.currentTabs[state.rightTabIndex] : null;
  return isPreviewTab(tab) ? tab : null;
}

/** Called by the right pane when it shows a preview tab. */
export function renderPreview() {
  const preview = rightPreview();
  const el = body();
  if (!preview || !el) return;
  const source = state.currentTabs.find((t) => t.id === preview.sourceId);
  const active = state.currentTabs[state.activeTabIndex];
  const text = source && source === active ? ed().value : (source?.content || '');
  const top = el.scrollTop;
  el.innerHTML = renderMarkdownHtml(text, source?.filePath);
  el.scrollTop = top;
  window.dispatchEvent(new CustomEvent('frogee:preview', { detail: el })); // plugins decorate the preview here
}

export function isPreviewOpen() { return !!rightPreview(); }

/** Opens the preview of the current Markdown file as its own tab beside the editor; again — closes it. */
export function toggleMarkdownPreview(force) {
  const source = state.currentTabs[state.activeTabIndex];
  if (!isMarkdownTab(source)) return;
  const index = state.currentTabs.findIndex((t) => isPreviewTab(t) && t.sourceId === source.id);
  const shown = index >= 0 && state.splitView && state.rightTabIndex === index;
  if (shown && force !== true) { closeTab(index); setTimeout(updateStats, 0); return; }
  if (force === false) return;
  if (index >= 0) { openTabInSplit(index); return; }
  state.currentTabs.push({ id: Date.now() + Math.random(), kind: 'preview', name: `Просмотр ${source.name}`, content: '', sourceId: source.id, modified: false });
  openTabInSplit(state.currentTabs.length - 1);
  setTimeout(updateStats, 0);
}

function schedule() {
  updateStats();
  const preview = rightPreview();
  if (!preview) return;
  const active = state.currentTabs[state.activeTabIndex];
  // The preview follows whichever Markdown file is in front.
  if (isMarkdownTab(active) && active.id !== preview.sourceId && !state.currentTabs.some((t) => isPreviewTab(t) && t.sourceId === active.id)) {
    preview.sourceId = active.id;
    preview.name = `Просмотр ${active.name}`;
    updateTabsList();
  }
  clearTimeout(timer);
  timer = setTimeout(renderPreview, DELAY);
}

/* ── editing helpers ── */

function replaceRange(t, start, end, text, selStart, selEnd) {
  t.focus();
  t.setSelectionRange(start, end);
  if (!document.execCommand('insertText', false, text)) t.setRangeText(text, start, end, 'end');
  t.setSelectionRange(selStart ?? start + text.length, selEnd ?? selStart ?? start + text.length);
  t.dispatchEvent(new Event('input', { bubbles: true }));
}

function wrapSelection(mark, placeholder = '') {
  const t = ed();
  const { selectionStart: a, selectionEnd: b, value } = t;
  const picked = value.slice(a, b);
  const m = mark.length;
  if (picked && value.slice(a - m, a) === mark && value.slice(b, b + m) === mark) {
    replaceRange(t, a - m, b + m, picked, a - m, a - m + picked.length);
    return;
  }
  const inner = picked || placeholder;
  replaceRange(t, a, b, mark + inner + mark, a + m, a + m + inner.length);
}

function insertLink() {
  const t = ed();
  const { selectionStart: a, selectionEnd: b, value } = t;
  const picked = value.slice(a, b) || 'текст';
  const url = /^(https?:\/\/|www\.)/i.test(picked) ? picked : 'https://';
  const text = url === picked ? 'текст' : picked;
  const out = `[${text}](${url})`;
  const urlStart = a + text.length + 3;
  replaceRange(t, a, b, out, urlStart, urlStart + url.length);
}

function lineBounds(t) {
  const { value, selectionStart: a, selectionEnd: b } = t;
  const start = value.lastIndexOf('\n', a - 1) + 1;
  let end = value.indexOf('\n', b);
  if (end < 0) end = value.length;
  return { start, end };
}

function mapLines(fn) {
  const t = ed();
  const { start, end } = lineBounds(t);
  const lines = t.value.slice(start, end).split('\n');
  const next = fn(lines).join('\n');
  replaceRange(t, start, end, next, start, start + next.length);
}

const prefixes = {
  h: (lines, level) => lines.map((l) => { const bare = l.replace(/^#{1,6}\s+/, ''); return (new RegExp(`^#{${level}}\\s`).test(l) ? '' : '#'.repeat(level) + ' ') + bare; }),
  quote: (lines) => (lines.every((l) => /^>\s?/.test(l)) ? lines.map((l) => l.replace(/^>\s?/, '')) : lines.map((l) => '> ' + l)),
  ul: (lines) => (lines.every((l) => /^\s*[-*+]\s/.test(l)) ? lines.map((l) => l.replace(/^(\s*)[-*+]\s/, '$1')) : lines.map((l) => (l.trim() ? '- ' + l.replace(/^\s*(?:[-*+]|\d+\.)\s+/, '') : l))),
  ol: (lines) => (lines.every((l) => /^\s*\d+\.\s/.test(l)) ? lines.map((l) => l.replace(/^(\s*)\d+\.\s/, '$1')) : lines.map((l, i) => `${i + 1}. ` + l.replace(/^\s*(?:[-*+]|\d+\.)\s+/, ''))),
  task: (lines) => (lines.every((l) => /^\s*[-*+]\s\[[ xX]\]\s/.test(l)) ? lines.map((l) => l.replace(/^(\s*)[-*+]\s\[[ xX]\]\s/, '$1')) : lines.map((l) => '- [ ] ' + l.replace(/^\s*[-*+]\s(?:\[[ xX]\]\s)?/, ''))),
};

function insertBlock(text, selectFrom = 0, selectLen = 0) {
  const t = ed();
  const { selectionStart: a, selectionEnd: b, value } = t;
  const lead = a > 0 && value[a - 1] !== '\n' ? '\n\n' : a > 1 && value[a - 2] !== '\n' ? '\n' : '';
  replaceRange(t, a, b, lead + text, a + lead.length + selectFrom, a + lead.length + selectFrom + selectLen);
}

export function insertTable() {
  const head = '| Колонка 1 | Колонка 2 | Колонка 3 |\n| --- | --- | --- |\n|  |  |  |\n';
  insertBlock(head, 2, 9);
}

const cells = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());

export function formatTable() {
  const t = ed();
  const lines = t.value.split('\n');
  const upTo = t.value.slice(0, t.selectionStart).split('\n').length - 1;
  const isRow = (l) => /^\s*\|.*\|\s*$/.test(l);
  if (!isRow(lines[upTo] || '')) return false;
  let from = upTo;
  let to = upTo;
  while (from > 0 && isRow(lines[from - 1])) from--;
  while (to < lines.length - 1 && isRow(lines[to + 1])) to++;
  const rows = lines.slice(from, to + 1).map(cells);
  const cols = Math.max(...rows.map((r) => r.length));
  const widths = Array.from({ length: cols }, (_, c) => Math.max(3, ...rows.map((r, i) => (/^:?-{2,}:?$/.test(r[c] || '') && i === 1 ? 3 : (r[c] || '').length))));
  const out = rows.map((r, i) => '| ' + widths.map((w, c) => {
    const v = r[c] || '';
    if (i === 1 && /^:?-+:?$/.test(v)) return (v.startsWith(':') ? ':' : '-') + '-'.repeat(w - 2) + (v.endsWith(':') ? ':' : '-');
    return v.padEnd(w);
  }).join(' | ') + ' |');
  let start = 0;
  for (let i = 0; i < from; i++) start += lines[i].length + 1;
  const end = start + lines.slice(from, to + 1).join('\n').length;
  replaceRange(t, start, end, out.join('\n'), start, start + out.join('\n').length);
  return true;
}

export const mdActions = {
  bold: () => wrapSelection('**', 'жирный'),
  italic: () => wrapSelection('*', 'курсив'),
  strike: () => wrapSelection('~~', 'зачёркнутый'),
  code: () => wrapSelection('`', 'код'),
  link: insertLink,
  h1: () => mapLines((l) => prefixes.h(l, 1)),
  h2: () => mapLines((l) => prefixes.h(l, 2)),
  h3: () => mapLines((l) => prefixes.h(l, 3)),
  quote: () => mapLines(prefixes.quote),
  ul: () => mapLines(prefixes.ul),
  ol: () => mapLines(prefixes.ol),
  task: () => mapLines(prefixes.task),
  codeblock: () => { const t = ed(); const picked = t.value.slice(t.selectionStart, t.selectionEnd); insertBlock('```\n' + picked + '\n```\n', 4, picked.length); },
  table: insertTable,
  hr: () => insertBlock('---\n'),
  image: () => { const t = ed(); const out = '![описание](путь/к/картинке.png)'; replaceRange(t, t.selectionStart, t.selectionEnd, out, t.selectionStart + 2, t.selectionStart + 10); },
};

/** Enter continues the current list item, or ends the list when the item is empty. */
function continueList(e) {
  const t = ed();
  if (t.selectionStart !== t.selectionEnd) return false;
  const pos = t.selectionStart;
  const start = t.value.lastIndexOf('\n', pos - 1) + 1;
  const line = t.value.slice(start, pos);
  const m = /^(\s*)([-*+]|\d+\.)(\s+)(\[[ xX]\]\s+)?(.*)$/.exec(line);
  if (!m || t.value.slice(pos).split('\n')[0].length) return false;
  e.preventDefault();
  if (!m[5]) { replaceRange(t, start, pos, ''); return true; }
  const marker = /\d/.test(m[2]) ? `${parseInt(m[2], 10) + 1}.` : m[2];
  replaceRange(t, pos, pos, `\n${m[1]}${marker}${m[3]}${m[4] ? '[ ] ' : ''}`);
  return true;
}

function onKeydown(e) {
  if (!isMarkdownTab()) return;
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  const act = (fn) => { e.preventDefault(); e.stopPropagation(); fn(); };
  if (mod && !e.shiftKey && !e.altKey) {
    if (k === 'b') return act(mdActions.bold);
    if (k === 'i') return act(mdActions.italic);
    if (k === 'k') return act(mdActions.link);
  }
  if (mod && e.shiftKey && k === 'v') return act(() => toggleMarkdownPreview());
  if (mod && e.altKey && k === 't') return act(() => (formatTable() || insertTable()));
  if (e.key === 'Enter' && !e.shiftKey && !mod && !e.altKey && autoIndentEnabled()) { if (continueList(e)) e.stopPropagation(); }
  if (e.key === 'Tab' && !e.shiftKey && !mod) {
    const t = ed();
    const start = t.value.lastIndexOf('\n', t.selectionStart - 1) + 1;
    if (/^\s*\|/.test(t.value.slice(start, t.value.indexOf('\n', start) < 0 ? undefined : t.value.indexOf('\n', start))) && formatTable()) {
      e.preventDefault(); e.stopPropagation();
      const v = ed().value;
      const next = v.indexOf('| ', ed().selectionStart + 1);
      if (next >= 0) ed().setSelectionRange(next + 2, next + 2);
    }
  }
}

/* ── setup ── */

function syncScroll(from) {
  if (syncing || !isPreviewOpen()) return;
  const a = from === 'editor' ? ed() : body();
  const b = from === 'editor' ? body() : ed();
  const range = a.scrollHeight - a.clientHeight;
  syncing = true;
  b.scrollTop = range > 0 ? (a.scrollTop / range) * (b.scrollHeight - b.clientHeight) : 0;
  requestAnimationFrame(() => { syncing = false; });
}

export function setupMarkdown() {
  const t = ed();
  const el = body();
  if (!t || !el) return;
  t.addEventListener('keydown', onKeydown);
  t.addEventListener('scroll', () => syncScroll('editor'));
  t.addEventListener('keyup', updateStats);
  t.addEventListener('mouseup', updateStats);
  el.addEventListener('scroll', () => syncScroll('preview'));
  window.addEventListener('frogee:content', schedule);
  document.getElementById('md-preview-btn')?.addEventListener('click', () => toggleMarkdownPreview());
  // Task checkboxes in the preview write back to the source.
  el.addEventListener('change', (e) => {
    const box = e.target.closest('input[type="checkbox"][data-task]');
    if (!box) return;
    const idx = Number(box.dataset.task);
    let n = -1;
    const next = ed().value.replace(/^(\s*(?:[-*+]|\d+\.)\s+)\[([ xX])\]/gm, (m, pre) => (++n === idx ? `${pre}[${box.checked ? 'x' : ' '}]` : m));
    const top = ed().scrollTop;
    ed().value = next;
    ed().scrollTop = top;
    ed().dispatchEvent(new Event('input', { bubbles: true }));
  });
  el.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (href.startsWith('#')) {
      e.preventDefault();
      el.querySelector(`[id="${CSS.escape(href.slice(1))}"]`)?.scrollIntoView({ block: 'start' });
    } else if (window.electronAPI?.openExternal && /^https?:/i.test(href)) {
      e.preventDefault();
      window.electronAPI.openExternal(href);
    }
  });
  updateStats();
}
