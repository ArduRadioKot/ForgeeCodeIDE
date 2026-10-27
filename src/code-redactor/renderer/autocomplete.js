/** Code suggestions: keywords of the language and words from the open files, shown under the caret. */
import { state } from './state.js';
import { isEditorTab } from './tab-model.js';
import { escapeHtml } from './utils.js';
import { snippetsFor, expandSnippet } from './extensions.js';

const WORDS = {
  js: 'async await break case catch class const continue default delete do else export extends false finally for function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while with yield console document window require module exports Promise setTimeout setInterval JSON Object Array Map Set Math String Number Boolean',
  py: 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield print len range self isinstance enumerate zip dict list set tuple str int float open',
  java: 'abstract boolean break byte case catch char class continue default do double else enum extends final finally float for if implements import instanceof int interface long new null package private protected public return short static super switch this throw throws try void volatile while String System Override',
  pde: 'setup draw settings size fullScreen background fill noFill stroke noStroke strokeWeight ellipse circle rect square line point triangle quad arc bezier vertex beginShape endShape translate rotate scale pushMatrix popMatrix pushStyle popStyle image loadImage text textSize textFont textAlign random noise map constrain dist lerp color colorMode frameRate frameCount millis noLoop loop redraw mouseX mouseY pmouseX pmouseY mousePressed mouseReleased mouseMoved mouseDragged keyPressed keyReleased key keyCode width height PVector PImage PFont PGraphics ArrayList HashMap println print createGraphics loadPixels updatePixels pixels PI TWO_PI HALF_PI radians degrees sin cos tan atan2 sqrt abs floor ceil round min max pow void int float boolean String class new return if else for while',
  c: 'auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while include define printf scanf malloc free NULL',
  go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var fmt nil true false string int error',
  rs: 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while Option Result Some None String Vec println',
  sh: 'if then else elif fi for while do done case esac function in echo export local return exit cd ls grep sed awk cat mkdir rm cp mv chmod source',
  css: 'align-items background background-color border border-radius bottom box-shadow color content cursor display flex flex-direction font-size font-weight gap grid grid-template-columns height justify-content left line-height margin max-width min-height opacity overflow padding position right text-align top transform transition width z-index',
  html: 'div span section article header footer nav main aside a img ul ol li table thead tbody tr td th form input button select option textarea label script style link meta title body head html h1 h2 h3 p br class id href src alt type value',
};
const FAMILY = { js: 'js', jsx: 'js', ts: 'js', tsx: 'js', py: 'py', java: 'java', pde: 'pde', kt: 'java', cs: 'java', c: 'c', cpp: 'c', go: 'go', rs: 'rs', sh: 'sh', css: 'css', scss: 'css', html: 'html' };
const OFF = new Set(['md', 'plain', 'json', 'yaml', 'txt']);
const MAX_SCAN = 200000;
const ID = /[A-Za-z_$][\w$]*/g;

let popup = null;
let items = [];
let index = 0;
let wordStart = 0;

const ta = () => document.getElementById('editor');

function languageOf() {
  const tab = state.currentTabs[state.activeTabIndex];
  return window.SyntaxHighlight?.detectLanguage(tab?.name || '') || 'plain';
}

function collectWords(prefix, text, lang) {
  const set = new Map();
  const add = (w) => { if (w.length > 2 && w !== prefix) set.set(w, (set.get(w) || 0) + 1); };
  (WORDS[FAMILY[lang]] || '').split(' ').forEach(add);
  const scan = (s) => { for (const m of s.slice(0, MAX_SCAN).matchAll(ID)) add(m[0]); };
  scan(text);
  for (const t of state.currentTabs) if (isEditorTab(t) && t !== state.currentTabs[state.activeTabIndex] && t.content) scan(t.content);
  return set;
}

function rank(prefix, set) {
  const p = prefix.toLowerCase();
  const out = [];
  for (const [word, count] of set) {
    const w = word.toLowerCase();
    let score;
    if (w === p) continue;
    if (word.startsWith(prefix)) score = 0;
    else if (w.startsWith(p)) score = 1;
    else {
      // subsequence match: "gtEl" finds getElementById
      let i = 0;
      for (const ch of w) if (ch === p[i]) i++;
      if (i !== p.length) continue;
      score = 2;
    }
    out.push({ word, score, count });
  }
  return out.sort((a, b) => a.score - b.score || b.count - a.count || a.word.length - b.word.length).slice(0, 8).map((x) => x.word);
}

function caretXY(el) {
  const cs = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  const zoom = rect.width / (el.offsetWidth || rect.width) || 1;
  const lh = parseFloat(cs.lineHeight) || 22;
  const before = el.value.slice(0, el.selectionStart);
  const line = before.split('\n').length - 1;
  const lineText = before.slice(before.lastIndexOf('\n') + 1);
  const tab = parseInt(cs.tabSize, 10) || 4;
  let col = 0;
  for (const ch of lineText) col += ch === '\t' ? tab - (col % tab) : 1;
  const ctx = (caretXY.ctx ||= document.createElement('canvas').getContext('2d'));
  ctx.font = `${cs.fontSize} ${cs.fontFamily}`;
  const cw = ctx.measureText('M').width;
  return {
    x: rect.left + (parseFloat(cs.paddingLeft) + col * cw - el.scrollLeft) * zoom,
    y: rect.top + (parseFloat(cs.paddingTop) + (line + 1) * lh - el.scrollTop) * zoom,
  };
}

function hide() { if (popup) popup.hidden = true; items = []; }

function show() {
  if (!popup) {
    popup = document.createElement('div');
    popup.className = 'ac-popup';
    popup.addEventListener('mousedown', (e) => { const row = e.target.closest('[data-i]'); if (row) { e.preventDefault(); accept(Number(row.dataset.i)); } });
    document.body.appendChild(popup);
  }
  popup.innerHTML = items.map((it, i) => `<div class="ac-row${i === index ? ' active' : ''}${it.snippet ? ' ac-snippet' : ''}" data-i="${i}" title="${escapeHtml(it.detail || '')}">${escapeHtml(it.label)}${it.snippet ? '<span class="ac-kind">сниппет</span>' : ''}</div>`).join('');
  popup.hidden = false;
  const { x, y } = caretXY(ta());
  const h = popup.offsetHeight;
  popup.style.left = `${Math.min(x, window.innerWidth - popup.offsetWidth - 8)}px`;
  popup.style.top = `${y + h + 6 > window.innerHeight ? y - h - 22 : y + 2}px`;
}

function accept(i = index) {
  const item = items[i];
  const el = ta();
  if (!item || !el) return;
  el.focus();
  let text = item.label;
  let caret = null;
  let selected = 0;
  if (item.snippet) {
    // a VS Code snippet: placeholders become their text, lines after the first get this line's indentation
    const lineStart = el.value.lastIndexOf('\n', wordStart - 1) + 1;
    const indent = /^[ \t]*/.exec(el.value.slice(lineStart, wordStart))[0];
    const tabSize = parseInt(document.getElementById('tab-size-select')?.value || '4', 10) || 4;
    const tab = state.currentTabs[state.activeTabIndex];
    const out = expandSnippet(item.snippet.body, { indent, fileName: tab?.name || '', tabUnit: ' '.repeat(tabSize) });
    text = out.text;
    caret = wordStart + out.caret;
    selected = out.selected;
  }
  el.setSelectionRange(wordStart, el.selectionStart);
  if (!document.execCommand('insertText', false, text)) { el.setRangeText(text, wordStart, el.selectionStart, 'end'); el.dispatchEvent(new Event('input', { bubbles: true })); }
  if (caret != null) el.setSelectionRange(caret, caret + selected);
  hide();
}

function update(manual = false) {
  const el = ta();
  const tab = state.currentTabs[state.activeTabIndex];
  if (!el || !isEditorTab(tab) || el.selectionStart !== el.selectionEnd || el.classList.contains('word-wrap')) return hide();
  const lang = languageOf();
  const snippets = snippetsFor(lang);
  if (OFF.has(lang) && !snippets.length) return hide();
  const caret = el.selectionStart;
  const m = /[A-Za-z_$][\w$-]*$/.exec(el.value.slice(Math.max(0, caret - 60), caret));
  if (!m || (!manual && m[0].length < 2)) return hide();
  const next = el.value[caret];
  if (next && /[\w$]/.test(next)) return hide(); // in the middle of a word
  const typed = m[0];
  wordStart = caret - typed.length;
  // snippets from installed VS Code extensions whose prefix starts with what was typed
  const low = typed.toLowerCase();
  const snipItems = snippets.filter((sn) => sn.prefix.toLowerCase().startsWith(low))
    .sort((a, b) => a.prefix.length - b.prefix.length).slice(0, 6)
    .map((sn) => ({ label: sn.prefix, detail: `${sn.description}${sn.extension ? ` (${sn.extension})` : ''}`, snippet: sn }));
  const wordItems = OFF.has(lang) || typed.includes('-') ? [] : rank(typed, collectWords(typed, el.value, lang)).map((w) => ({ label: w }));
  items = [...snipItems, ...wordItems.filter((w) => !snipItems.some((sn) => sn.label === w.label))].slice(0, 10);
  index = 0;
  if (!items.length) return hide();
  show();
  // Merge completion items from running VS Code extensions (async, non-blocking)
  import('./vscode-bridge.js').then(async ({ extensionCompletions }) => {
    const extra = await extensionCompletions(typed);
    if (!extra.length || ta()?.selectionStart !== caret) return;
    const known = new Set(items.map((i) => i.label));
    const add = extra.filter((x) => !known.has(x.label));
    if (!add.length) return;
    items = [...items.slice(0, 6), ...add].slice(0, 12);
    if (popup && !popup.hidden) show();
  }).catch(() => {});
}

export function setupAutocomplete() {
  const el = ta();
  if (!el) return;
  let timer = 0;
  el.addEventListener('input', (e) => {
    if (e.inputType && !e.inputType.startsWith('insert')) return hide();
    clearTimeout(timer);
    timer = setTimeout(() => update(false), 90);
  });
  // Capture phase: the suggestions take Tab / arrows / Esc before the smart-edit handlers see them.
  el.addEventListener('keydown', (e) => {
    if (e.key === ' ' && e.ctrlKey && !e.metaKey) { e.preventDefault(); update(true); return; }
    if (!popup || popup.hidden || !items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation();
      index = (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      show();
    } else if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Only Tab takes a suggestion: Enter always means a new line.
      e.preventDefault(); e.stopPropagation();
      accept();
    } else if (e.key === 'Enter') {
      hide();
    } else if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      hide();
    }
  }, true);
  ['blur', 'scroll', 'mousedown'].forEach((evt) => el.addEventListener(evt, hide));
}
