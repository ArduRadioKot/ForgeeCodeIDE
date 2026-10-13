/**
 * Selection drawn by the editor itself. The browser's own highlight of a textarea is ragged (every line ends where its text ends,
 * line breaks are invisible, lines are separated by gaps), so it is hidden and the selected text is painted in a layer under the
 * coloured text: continuous rows, a visible line break at the end of every selected line, accent colour while the editor has the
 * keyboard and a quiet grey when it has not.
 */
import { state } from './state.js';
import { isEditorTab } from './tab-model.js';
import { escapeHtml } from './utils.js';

const MAX_CHARS = 400000;
let frame = 0;

const ta = () => document.getElementById('editor');
const layer = () => document.getElementById('sel-layer');

function render() {
  frame = 0;
  const el = ta();
  const l = layer();
  const wrap = el?.closest('.code-editor-wrap');
  if (!el || !l || !wrap) return;
  const tab = state.currentTabs[state.activeTabIndex];
  const s = el.selectionStart;
  const e = el.selectionEnd;
  if (s === e || el.value.length > MAX_CHARS || !isEditorTab(tab)) {
    l.innerHTML = '';
    wrap.classList.remove('custom-sel');
    return;
  }
  wrap.classList.add('custom-sel');
  const focused = document.activeElement === el && document.hasFocus();
  l.classList.toggle('inactive', !focused);

  // gap between rows: the inline background only covers the text's own height, the rest of the line height is filled by a shadow
  const cs = getComputedStyle(el);
  const lh = parseFloat(cs.lineHeight) || 22;
  const fs = parseFloat(cs.fontSize) || 14;
  l.style.setProperty('--sel-gap', `${Math.max(0, (lh - fs * 1.2) / 2).toFixed(2)}px`);

  const text = el.value;
  const rows = text.slice(s, e).split('\n');
  let html = escapeHtml(text.slice(0, s));
  rows.forEach((row, i) => {
    const last = i === rows.length - 1;
    html += `<span class="sl">${escapeHtml(row)}${last ? '' : '<i> </i>'}</span>${last ? '' : '\n'}`;
  });
  l.innerHTML = `${html}${escapeHtml(text.slice(e))}\n`;
  l.scrollTop = el.scrollTop;
  l.scrollLeft = el.scrollLeft;
}

const schedule = () => { if (!frame) frame = requestAnimationFrame(render); };

export function syncSelectionScroll() {
  const el = ta();
  const l = layer();
  if (el && l && l.firstChild) { l.scrollTop = el.scrollTop; l.scrollLeft = el.scrollLeft; }
}

export function setupSelectionLayer() {
  const el = ta();
  if (!el || !layer()) return;
  document.addEventListener('selectionchange', () => { if (document.activeElement === el) schedule(); });
  ['input', 'focus', 'blur', 'mouseup', 'keyup'].forEach((evt) => el.addEventListener(evt, schedule));
  el.addEventListener('scroll', syncSelectionScroll);
  window.addEventListener('focus', schedule);
  window.addEventListener('blur', schedule);
  window.addEventListener('frogee:content', schedule);
}
