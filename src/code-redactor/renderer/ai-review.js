/**
 * Review of code written by the AI, the way Cursor does it: "Apply" puts the change into the file right away,
 * added lines stay highlighted, and nothing is final until the user presses Keep file / Keep all (or Undo).
 * Highlights are the line diff between the text before the AI touched the file and the text now, so they follow edits.
 */
import { state } from './state.js';
import { isEditorTab } from './tab-model.js';
import { escapeHtml } from './utils.js';
import { icon } from './glyphs.js';

const pending = new Map(); // tab.id -> { original, name }
const MAX_DP = 4_000_000;
let bar = null;
let frame = 0;

const ed = () => document.getElementById('editor');
const layer = () => document.getElementById('diff-layer');
const gutter = () => document.getElementById('line-numbers');
const activeTab = () => state.currentTabs[state.activeTabIndex];

// ───────────────────────── line diff ─────────────────────────

/** Added lines of `b` (1-based) and the lines of `a` that are gone, keyed by the line of `b` they sat before. */
export function diffLines(a, b) {
  const A = a.split('\n');
  const B = b.split('\n');
  let start = 0;
  while (start < A.length && start < B.length && A[start] === B[start]) start++;
  let endA = A.length;
  let endB = B.length;
  while (endA > start && endB > start && A[endA - 1] === B[endB - 1]) { endA--; endB--; }
  const midA = A.slice(start, endA);
  const midB = B.slice(start, endB);
  const added = new Set();
  const removed = new Map(); // index in B (0-based) -> removed lines
  const markRemoved = (at, line) => { if (!removed.has(at)) removed.set(at, []); removed.get(at).push(line); };

  if (midA.length * midB.length > MAX_DP) {
    midB.forEach((_, i) => added.add(start + i + 1));
    midA.forEach((l) => markRemoved(start, l));
  } else {
    // longest common subsequence of the changed middle
    const n = midA.length;
    const m = midB.length;
    const w = m + 1;
    const dp = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] = midA[i] === midB[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) { i++; j++; }
      else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) { markRemoved(start + j, midA[i]); i++; }
      else { added.add(start + j + 1); j++; }
    }
    while (i < n) { markRemoved(start + j, midA[i]); i++; }
    while (j < m) { added.add(start + j + 1); j++; }
  }
  const removedCount = [...removed.values()].reduce((s, l) => s + l.length, 0);
  return { added, removed, addedCount: added.size, removedCount };
}

// ───────────────────────── applying ─────────────────────────

function currentText(tab) {
  return tab === activeTab() && isEditorTab(tab) && ed() ? ed().value : (tab.content || '');
}

function setText(tab, text) {
  tab.content = text;
  if (tab === activeTab() && ed()) {
    ed().value = text;
    ed().dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    tab.modified = true;
  }
}

/** Put `proposed` into the tab and remember what was there before. */
export function proposeEdit(tab, proposed) {
  if (!pending.has(tab.id)) pending.set(tab.id, { original: currentText(tab), name: tab.name });
  setText(tab, proposed);
  scheduleRender();
}

const looksLikeWholeFile = (current, code) => {
  const have = new Set(current.split('\n').map((l) => l.trim()).filter(Boolean));
  const lines = code.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return false;
  return lines.filter((l) => have.has(l)).length / lines.length >= 0.35;
};

/** "Apply" on a code block of the chat. Returns false when there is no text file to apply it to. */
export function applyCode(code, lang) {
  const tab = activeTab();
  if (!isEditorTab(tab) || !ed()) return false;
  const cur = ed().value;
  const s = ed().selectionStart;
  const e = ed().selectionEnd;
  let text = code.replace(/\n$/, '');
  let proposed;
  if (e > s) proposed = cur.slice(0, s) + text + cur.slice(e);
  else if (!cur.trim() || looksLikeWholeFile(cur, text)) proposed = cur.endsWith('\n') ? text + '\n' : text;
  else proposed = cur.slice(0, s) + text + (cur.slice(s).startsWith('\n') || !cur.slice(s) ? '' : '\n') + cur.slice(s);
  if (proposed === cur) return true;
  proposeEdit(tab, proposed);
  return true;
}

// ───────────────────────── decisions ─────────────────────────

function keepTab(id) { pending.delete(id); }

function undoTab(id) {
  const p = pending.get(id);
  const tab = state.currentTabs.find((t) => t.id === id);
  pending.delete(id);
  if (p && tab) setText(tab, p.original);
}

export const keepFile = () => { const t = activeTab(); if (t) keepTab(t.id); scheduleRender(); };
export const undoFile = () => { const t = activeTab(); if (t) undoTab(t.id); scheduleRender(); };
export const keepAll = () => { pending.clear(); scheduleRender(); };
export const undoAll = () => { for (const id of [...pending.keys()]) undoTab(id); scheduleRender(); };
export const hasPendingEdits = () => pending.size > 0;

// ───────────────────────── drawing ─────────────────────────

function scheduleRender() {
  if (frame) return;
  frame = requestAnimationFrame(() => { frame = 0; render(); });
}

function clean() {
  // closed tabs take their pending review with them
  for (const id of [...pending.keys()]) if (!state.currentTabs.some((t) => t.id === id)) pending.delete(id);
}

function render() {
  clean();
  const tab = activeTab();
  const p = tab && isEditorTab(tab) ? pending.get(tab.id) : null;
  const l = layer();
  const g = gutter();
  let stat = null;
  if (g) [...g.children].forEach((el) => { el.classList.remove('has-add', 'has-del'); el.removeAttribute('data-del'); });
  if (!p || !l || !ed()) {
    if (l) l.innerHTML = '';
  } else {
    const text = ed().value;
    const d = diffLines(p.original, text);
    stat = d;
    const lines = text.split('\n');
    l.innerHTML = lines.map((line, i) => `<span class="dl${d.added.has(i + 1) ? ' add' : ''}${d.removed.has(i) ? ' del' : ''}">${escapeHtml(line) || '​'}</span>`).join('') + '<span class="dl">​</span>';
    l.scrollTop = ed().scrollTop;
    l.scrollLeft = ed().scrollLeft;
    if (g) {
      d.added.forEach((n) => g.children[n - 1]?.classList.add('has-add'));
      d.removed.forEach((rows, at) => {
        const el = g.children[Math.min(at, g.children.length - 1)];
        if (el) { el.classList.add('has-del'); el.dataset.del = rows.slice(0, 6).join('\n') + (rows.length > 6 ? '\n…' : ''); el.title = `Удалено строк: ${rows.length}\n${el.dataset.del}`; }
      });
    }
  }
  renderBar(tab, p, stat);
}

function ensureBar() {
  if (bar) return bar;
  const host = document.getElementById('editor-container');
  if (!host) return null;
  bar = document.createElement('div');
  bar.className = 'review-bar';
  bar.hidden = true;
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rb]');
    if (!b) return;
    ({ 'keep-file': keepFile, 'undo-file': undoFile, 'keep-all': keepAll, 'undo-all': undoAll })[b.dataset.rb]?.();
  });
  host.appendChild(bar);
  return bar;
}

function renderBar(tab, p, stat) {
  const el = ensureBar();
  if (!el) return;
  if (!pending.size) { el.hidden = true; return; }
  const others = pending.size - (p ? 1 : 0);
  const file = p
    ? `<span class="rb-name">${escapeHtml(tab.name)}</span><span class="rb-stat"><b class="rb-add">+${stat.addedCount}</b> <b class="rb-del">−${stat.removedCount}</b></span>
       <button type="button" data-rb="undo-file">Отменить файл</button><button type="button" class="primary" data-rb="keep-file">Оставить файл</button>`
    : `<span class="rb-name">Правки ИИ в других файлах: ${pending.size}</span>`;
  const all = pending.size > 1 || !p
    ? `<span class="rb-sep"></span><button type="button" data-rb="undo-all">Отменить всё</button><button type="button" class="primary" data-rb="keep-all">Оставить всё</button>`
    : '';
  el.innerHTML = `<span class="rb-icon">${icon('dot', 10)}</span>${file}${all}`;
  el.hidden = false;
}

export function setupAiReview() {
  window.addEventListener('frogee:content', scheduleRender);
  const t = ed();
  t?.addEventListener('scroll', () => { const l = layer(); if (l) { l.scrollTop = t.scrollTop; l.scrollLeft = t.scrollLeft; } });
}
