/**
 * Error highlighting with hints. A transparent layer over the editor underlines problems with a wavy line;
 * hovering shows the message, the gutter marks the line, the status bar counts them, F8 jumps between them.
 * Precise parsers (JS, Python, Shell) run in the main process; bracket / tag / JSON checks run here.
 */
import { state } from './state.js';
import { isEditorTab } from './tab-model.js';
import { isBrowserSplit } from './tabs-api.js';
import { getLang, onLangChange } from './i18n.js';

const DELAY = 450;
const MAX_SIZE = 250000;
const C_LIKE = new Set(['js', 'jsx', 'ts', 'tsx', 'java', 'pde', 'c', 'cpp', 'cs', 'go', 'rs', 'kt', 'swift', 'dart', 'scala', 'php', 'css', 'scss']);
const LENIENT_STRINGS = new Set(['jsx', 'tsx', 'rs', 'php', 'kt', 'scala']);
const PAIRS = { '(': ')', '[': ']', '{': '}' };
const CLOSERS = new Set([')', ']', '}']);
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const OPTIONAL_END = new Set(['p', 'li', 'td', 'tr', 'th', 'option', 'dt', 'dd', 'thead', 'tbody', 'tfoot', 'head', 'body', 'html', 'colgroup']);

function localizeDiagnostic(message) {
  if (getLang() !== 'en') return message;
  const fixed = {
    'Не закрыт комментарий «/* … */»': 'Unclosed /* … */ comment',
    'Не закрыта многострочная строка': 'Unclosed multiline string',
    'Не закрыта шаблонная строка': 'Unclosed template string',
    'Не закрыта строка': 'Unclosed string',
    'В YAML нельзя отступать табуляцией: используйте пробелы': 'YAML indentation cannot use tabs; use spaces',
    'Блок кода не закрыт: добавьте закрывающие ```': 'Unclosed code block: add closing ```',
  };
  if (fixed[message]) return fixed[message];
  let match = /^Лишняя закрывающая скобка «(.+)»$/.exec(message);
  if (match) return `Unexpected closing bracket “${match[1]}”`;
  match = /^Скобка «(.+)» не соответствует «(.+)» со строки (\d+): ожидалась «(.+)»$/.exec(message);
  if (match) return `Bracket “${match[1]}” does not match “${match[2]}” on line ${match[3]}; expected “${match[4]}”`;
  match = /^Здесь открыта «(.+)», но закрыта не так$/.exec(message);
  if (match) return `“${match[1]}” opens here but is closed incorrectly`;
  match = /^Не закрыта скобка «(.+)»: добавьте «(.+)»$/.exec(message);
  if (match) return `Unclosed bracket “${match[1]}”; add “${match[2]}”`;
  match = /^Лишний закрывающий тег <\/(.+)>$/.exec(message);
  if (match) return `Unexpected closing tag </${match[1]}>`;
  match = /^Тег <(.+)> не закрыт до <\/(.+)>$/.exec(message);
  if (match) return `Tag <${match[1]}> is not closed before </${match[2]}>`;
  match = /^Тег <(.+)> не закрыт$/.exec(message);
  if (match) return `Unclosed tag <${match[1]}>`;
  return message;
}

const sides = {
  left: { textarea: () => document.getElementById('editor'), layer: () => document.getElementById('diag-layer'), gutter: () => document.getElementById('line-numbers') },
  right: { textarea: () => document.getElementById('editor-right'), layer: () => document.getElementById('diag-layer-right'), gutter: () => document.getElementById('line-numbers-right') },
};
const results = { left: [], right: [] };
const tokens = { left: 0, right: 0 };
let timer = 0;
let tip = null;

const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function languageOf(name) {
  return window.SyntaxHighlight?.detectLanguage(name || '') || 'plain';
}

function tabFor(side) {
  if (side === 'left') return state.currentTabs[state.activeTabIndex];
  return state.splitView && !isBrowserSplit() ? state.currentTabs[state.rightTabIndex] : null;
}

// ───────────────────────── generic checks ─────────────────────────

function lineStarts(code) {
  const starts = [0];
  for (let i = 0; i < code.length; i++) if (code[i] === '\n') starts.push(i + 1);
  return starts;
}

function position(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
  }
  return { line: lo + 1, col: offset - starts[lo] };
}

/** Brackets and strings for C-like languages and Python, skipping comments, strings and regex literals. */
function scanBrackets(code, lang) {
  const out = [];
  const starts = lineStarts(code);
  const py = lang === 'py';
  const css = lang === 'css' || lang === 'scss';
  const lenient = LENIENT_STRINGS.has(lang);
  const rust = lang === 'rs';
  const stack = [];
  const push = (offset, len, message, severity = 'error') => {
    const p = position(starts, offset);
    out.push({ line: p.line, col: p.col, endCol: p.col + Math.max(1, len), severity, message, source: 'Проверка' });
  };
  let prevSignificant = '';
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    const next = code[i + 1];
    if (ch === '\n') continue;
    // comments
    if (py ? ch === '#' : (!css || false) && ch === '/' && next === '/') {
      while (i < code.length && code[i] !== '\n') i++;
      continue;
    }
    if (!py && ch === '/' && next === '*') {
      const end = code.indexOf('*/', i + 2);
      if (end < 0) { push(i, 2, 'Не закрыт комментарий «/* … */»'); break; }
      i = end + 1;
      continue;
    }
    if (lang === 'php' && ch === '#') { while (i < code.length && code[i] !== '\n') i++; continue; }
    // python triple-quoted strings
    if (py && (ch === '"' || ch === "'") && code.startsWith(ch.repeat(3), i)) {
      const end = code.indexOf(ch.repeat(3), i + 3);
      if (end < 0) { push(i, 3, 'Не закрыта многострочная строка'); break; }
      i = end + 2;
      continue;
    }
    // strings
    if (ch === '"' || (ch === "'" && !rust) || (ch === '`' && !py && !css)) {
      const quote = ch;
      let j = i + 1;
      let closed = false;
      while (j < code.length) {
        if (code[j] === '\\') { j += 2; continue; }
        if (code[j] === quote) { closed = true; break; }
        if (code[j] === '\n' && quote !== '`') break;
        j++;
      }
      if (!closed && !lenient) push(i, Math.min(j - i, code.length - i), quote === '`' ? 'Не закрыта шаблонная строка' : 'Не закрыта строка');
      i = closed ? j : Math.max(i, j - 1);
      prevSignificant = quote;
      continue;
    }
    if (rust && ch === "'") {
      const m = /^'(?:\\.|[^'\\])'/.exec(code.slice(i, i + 6));
      if (m) { i += m[0].length - 1; continue; }
    }
    // regex literals (JS family)
    if (ch === '/' && !py && !css && ['js', 'jsx', 'ts', 'tsx'].includes(lang) && (prevSignificant === '' || '=(:,;!&|?{}[+-*%<>~^'.includes(prevSignificant))) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < code.length && code[j] !== '\n') {
        if (code[j] === '\\') { j += 2; continue; }
        if (code[j] === '[') inClass = true;
        else if (code[j] === ']') inClass = false;
        else if (code[j] === '/' && !inClass) { closed = true; break; }
        j++;
      }
      if (closed) { i = j; prevSignificant = '/'; continue; }
    }
    if (PAIRS[ch]) stack.push({ ch, offset: i });
    else if (CLOSERS.has(ch)) {
      const top = stack.pop();
      if (!top) push(i, 1, `Лишняя закрывающая скобка «${ch}»`);
      else if (PAIRS[top.ch] !== ch) {
        const at = position(starts, top.offset);
        push(i, 1, `Скобка «${ch}» не соответствует «${top.ch}» со строки ${at.line}: ожидалась «${PAIRS[top.ch]}»`);
        push(top.offset, 1, `Здесь открыта «${top.ch}», но закрыта не так`);
      }
    }
    if (!/\s/.test(ch)) prevSignificant = ch;
  }
  for (const open of stack) push(open.offset, 1, `Не закрыта скобка «${open.ch}»: добавьте «${PAIRS[open.ch]}»`);
  return out;
}

function checkJson(code, name) {
  let text = code;
  // *.jsonc-style files (tsconfig, VS Code settings) allow comments and trailing commas.
  if (/^\s*\/\/|\/\*/m.test(code) || /\.jsonc$/i.test(name || '')) {
    text = code.replace(/\/\*[\s\S]*?\*\/|(^|[^:"'\\])\/\/[^\n]*/g, (m, pre) => (pre || '') + m.slice((pre || '').length).replace(/[^\n]/g, ' ')).replace(/,(\s*[}\]])/g, ' $1');
  }
  if (!text.trim()) return [];
  try {
    JSON.parse(text);
    return [];
  } catch (err) {
    const message = String(err.message || '');
    const starts = lineStarts(code);
    let offset = code.length;
    const at = /position (\d+)/.exec(message);
    const lc = /line (\d+) column (\d+)/.exec(message);
    if (at) offset = Number(at[1]);
    else if (lc) offset = (starts[Number(lc[1]) - 1] ?? 0) + Number(lc[2]) - 1;
    offset = Math.min(offset, Math.max(0, code.length - 1));
    const p = position(starts, offset);
    let ru = message.replace(/ in JSON at position \d+.*/, '').replace(/\(line .*\)/, '').trim();
    ru = ru.replace(/^Unexpected token (.)/, (m, t) => `Неожиданный символ «${t}»`).replace(/Unexpected end of JSON input/, 'Неожиданный конец JSON: не закрыта скобка или строка')
      .replace(/Expected property name or '}'/, 'Ожидалось имя свойства в кавычках или «}»').replace(/Expected ',' or '}'/, 'Ожидалась «,» или «}»').replace(/Expected ',' or '\]'/, 'Ожидалась «,» или «]»');
    return [{ line: p.line, col: p.col, endCol: p.col + 1, severity: 'error', message: getLang() === 'en' ? (message || 'Invalid JSON') : (ru || 'Некорректный JSON'), source: 'JSON' }];
  }
}

function checkHtml(code) {
  const out = [];
  const starts = lineStarts(code);
  const re = /<!--[\s\S]*?(?:-->|$)|<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)|<(\/?)([A-Za-z][\w:-]*)((?:[^<>"']|"[^"]*"|'[^']*')*)>/gi;
  const stack = [];
  let m;
  const mark = (offset, len, message, severity) => {
    const p = position(starts, offset);
    out.push({ line: p.line, col: p.col, endCol: p.col + len, severity, message, source: 'HTML' });
  };
  while ((m = re.exec(code)) !== null) {
    if (!m[3]) continue;
    const name = m[3].toLowerCase();
    if (m[2]) {
      const at = stack.map((s) => s.name).lastIndexOf(name);
      if (at < 0) { mark(m.index, m[0].length, `Лишний закрывающий тег </${m[3]}>`, 'error'); continue; }
      for (const skipped of stack.splice(at + 1)) {
        if (!OPTIONAL_END.has(skipped.name)) mark(skipped.offset, skipped.len, `Тег <${skipped.name}> не закрыт до </${m[3]}>`, 'warning');
      }
      stack.pop();
    } else if (!VOID_TAGS.has(name) && !/\/\s*$/.test(m[4])) {
      stack.push({ name, offset: m.index, len: m[3].length + 1 });
    }
  }
  for (const open of stack) if (!OPTIONAL_END.has(open.name)) mark(open.offset, open.len, `Тег <${open.name}> не закрыт`, 'warning');
  return out;
}

function checkYaml(code) {
  const out = [];
  code.split('\n').forEach((line, i) => {
    const m = /^( *)\t/.exec(line);
    if (m) out.push({ line: i + 1, col: m[1].length, endCol: m[1].length + 1, severity: 'error', message: 'В YAML нельзя отступать табуляцией: используйте пробелы', source: 'YAML' });
  });
  return out;
}

function checkMarkdown(code) {
  const out = [];
  const starts = lineStarts(code);
  let open = null;
  code.split('\n').forEach((line, i) => {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (!m) return;
    if (!open) open = { fence: m[1], line: i };
    else if (m[1][0] === open.fence[0] && m[1].length >= open.fence.length) open = null;
  });
  if (open) {
    out.push({ line: open.line + 1, col: 0, endCol: open.fence.length, severity: 'warning', message: 'Блок кода не закрыт: добавьте закрывающие ```', source: 'Markdown' });
  }
  return out;
}

function genericDiagnostics(lang, code, name) {
  if (lang === 'json') return checkJson(code, name);
  if (lang === 'html') return checkHtml(code);
  if (lang === 'yaml') return checkYaml(code);
  if (lang === 'md') return checkMarkdown(code);
  if (lang === 'py' || C_LIKE.has(lang)) return scanBrackets(code, lang);
  return [];
}

// ───────────────────────── running ─────────────────────────

async function analyze(side) {
  const pane = sides[side];
  const ta = pane.textarea();
  const tab = tabFor(side);
  const token = ++tokens[side];
  if (!ta || !tab || !isEditorTab(tab) || ta.value.length > MAX_SIZE) { results[side] = []; render(side); return; }
  const lang = languageOf(tab.name);
  const code = ta.value;
  let list = genericDiagnostics(lang, code, tab.name);
  if (['js', 'py', 'sh'].includes(lang) && window.electronAPI?.diagnose) {
    const res = await window.electronAPI.diagnose({ lang, code }).catch(() => null);
    if (token !== tokens[side]) return;
    if (res?.precise) list = res.diagnostics;
  }
  if (token !== tokens[side]) return;
  try {
    const { extensionDiagnostics } = await import('./vscode-bridge.js');
    const path = tab.filePath || '';
    const fromExt = extensionDiagnostics().filter((d) => !d.uri || !path || d.uri.includes(path) || d.uri.endsWith(tab.name));
    for (const d of fromExt) {
      list.push({
        line: d.line || 1,
        col: d.col || 1,
        endCol: d.endCol || (d.col || 1) + 1,
        severity: d.severity === 'error' ? 'error' : d.severity === 'warning' ? 'warning' : 'info',
        message: d.message || '',
        source: d.source || 'расширение',
      });
    }
  } catch { /* ignore */ }
  if (token !== tokens[side]) return;
  results[side] = list.sort((a, b) => a.line - b.line || a.col - b.col);
  render(side);
}

export function scheduleDiagnostics() {
  clearTimeout(timer);
  timer = setTimeout(() => { analyze('left'); if (state.splitView) analyze('right'); else { results.right = []; render('right'); } }, DELAY);
}

// ───────────────────────── rendering ─────────────────────────

function render(side) {
  const pane = sides[side];
  const layer = pane.layer();
  const ta = pane.textarea();
  if (!layer || !ta) return;
  const list = results[side];
  if (!list.length) {
    layer.innerHTML = '';
  } else {
    const code = ta.value;
    const starts = lineStarts(code);
    const ranges = list.map((d, i) => {
      const lineStart = starts[d.line - 1] ?? 0;
      const lineEnd = (starts[d.line] ?? code.length + 1) - 1;
      let start = Math.min(lineStart + d.col, lineEnd);
      let end = Math.min(lineStart + Math.max(d.endCol, d.col + 1), lineEnd);
      if (end <= start) { start = Math.max(lineStart, lineEnd - 1); end = lineEnd; }
      return { start, end, i, severity: d.severity };
    }).filter((r) => r.end > r.start).sort((a, b) => a.start - b.start);
    let html = '';
    let cursor = 0;
    for (const r of ranges) {
      if (r.start < cursor) continue; // overlapping ranges: the first one wins
      html += esc(code.slice(cursor, r.start)) + `<span class="diag-${r.severity === 'warning' ? 'w' : 'e'}" data-i="${r.i}">${esc(code.slice(r.start, r.end))}</span>`;
      cursor = r.end;
    }
    layer.innerHTML = html + esc(code.slice(cursor)) + '\n';
  }
  layer.scrollTop = ta.scrollTop;
  layer.scrollLeft = ta.scrollLeft;
  markGutter(side);
  if (side === 'left') updateStatus();
}

const markedRows = { left: [], right: [] }; // gutter rows marked last time, so only they are cleared

function markGutter(side) {
  const gutter = sides[side].gutter();
  if (!gutter) return;
  markedRows[side].forEach((el) => el.classList.remove('has-error', 'has-warning'));
  markedRows[side] = [];
  const worst = new Map();
  results[side].forEach((d) => { if (worst.get(d.line) !== 'error') worst.set(d.line, d.severity); });
  worst.forEach((severity, line) => {
    const el = gutter.children[line - 1];
    if (!el || (severity !== 'error' && severity !== 'warning')) return;
    el.classList.add(severity === 'error' ? 'has-error' : 'has-warning');
    markedRows[side].push(el);
  });
}

function updateStatus() {
  const chip = document.getElementById('status-problems');
  if (!chip) return;
  const tab = tabFor('left');
  const lang = tab ? languageOf(tab.name) : 'plain';
  const checked = isEditorTab(tab) && (['js', 'py', 'sh', 'json', 'html', 'yaml', 'md'].includes(lang) || C_LIKE.has(lang));
  const errors = results.left.filter((d) => d.severity === 'error').length;
  const warnings = results.left.length - errors;
  chip.hidden = !checked || (!errors && !warnings);
  if (chip.hidden) return;
  chip.className = `status-chip problems${errors ? ' has-errors' : warnings ? ' has-warnings' : ''}`;
  const en = getLang() === 'en';
  chip.textContent = `${errors ? `${en ? 'errors' : 'ошибок'}: ${errors}` : ''}${errors && warnings ? ' · ' : ''}${warnings ? `${en ? 'warnings' : 'предупреждений'}: ${warnings}` : ''}`;
  chip.title = (typeof window !== 'undefined' && window.__frogeeT)
    ? window.__frogeeT('diag.problemsTitle')
    : 'Problems in file. Click or press F8 for the next one';
}

// ───────────────────────── hover hints ─────────────────────────

function ensureTip() {
  if (tip) return tip;
  tip = document.createElement('div');
  tip.className = 'diag-tip';
  tip.hidden = true;
  document.body.appendChild(tip);
  return tip;
}

function hideTip() {
  if (tip) tip.hidden = true;
}

let charWidth = 0;
let charFont = '';
function measureChar(ta) {
  const cs = getComputedStyle(ta);
  const font = `${cs.fontSize} ${cs.fontFamily}`;
  if (font !== charFont) {
    const ctx = (measureChar.ctx ||= document.createElement('canvas').getContext('2d'));
    ctx.font = font;
    charWidth = ctx.measureText('M').width;
    charFont = font;
  }
  return charWidth;
}

function diagnosticAt(side, e) {
  const ta = sides[side].textarea();
  const list = results[side];
  if (!list.length || ta.classList.contains('word-wrap')) return null;
  const rect = ta.getBoundingClientRect();
  const zoom = rect.width / (ta.offsetWidth || rect.width) || 1;
  const cs = getComputedStyle(ta);
  const lh = parseFloat(cs.lineHeight) || 22;
  const x = (e.clientX - rect.left) / zoom - parseFloat(cs.paddingLeft) + ta.scrollLeft;
  const y = (e.clientY - rect.top) / zoom - parseFloat(cs.paddingTop) + ta.scrollTop;
  if (x < 0 || y < 0) return null;
  const line = Math.floor(y / lh) + 1;
  const col = Math.floor(x / measureChar(ta));
  return list.find((d) => d.line === line && col >= d.col && col < Math.max(d.endCol, d.col + 1)) || null;
}

function showTip(diag, e) {
  const el = ensureTip();
  el.className = `diag-tip ${diag.severity}`;
  el.innerHTML = `<div class="diag-tip-msg">${esc(localizeDiagnostic(diag.message))}</div><div class="diag-tip-src">${esc(diag.source === 'Проверка' && getLang() === 'en' ? 'Check' : (diag.source || ''))} · ${getLang() === 'en' ? 'line' : 'строка'} ${diag.line}</div>`;
  el.hidden = false;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  el.style.left = `${Math.min(e.clientX + 12, window.innerWidth - w - 8)}px`;
  el.style.top = `${e.clientY + 18 + h > window.innerHeight ? e.clientY - h - 10 : e.clientY + 18}px`;
}

function bindHover(side) {
  const ta = sides[side].textarea();
  if (!ta || ta.dataset.diagBound) return;
  ta.dataset.diagBound = '1';
  let frame = 0;
  ta.addEventListener('mousemove', (e) => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const hit = diagnosticAt(side, e);
      if (hit) showTip(hit, e); else hideTip();
    });
  });
  ['mouseleave', 'scroll', 'keydown', 'mousedown'].forEach((evt) => ta.addEventListener(evt, hideTip));
  ta.addEventListener('scroll', () => {
    const layer = sides[side].layer();
    if (layer) { layer.scrollTop = ta.scrollTop; layer.scrollLeft = ta.scrollLeft; }
  });
  const gutter = sides[side].gutter();
  gutter?.addEventListener('mousemove', (e) => {
    const el = e.target.closest('.line-number');
    const index = el ? [...gutter.children].indexOf(el) + 1 : 0;
    const hit = index ? results[side].find((d) => d.line === index) : null;
    if (hit) showTip(hit, e); else hideTip();
  });
  gutter?.addEventListener('mouseleave', hideTip);
  if (gutter) new MutationObserver(() => markGutter(side)).observe(gutter, { childList: true });
}

// ───────────────────────── navigation ─────────────────────────

function selectDiagnostic(d) {
  const ta = sides.left.textarea();
  if (!ta || !d) return;
  const starts = lineStarts(ta.value);
  const start = (starts[d.line - 1] ?? 0) + d.col;
  const end = Math.min(start + Math.max(1, d.endCol - d.col), (starts[d.line] ?? ta.value.length + 1) - 1);
  ta.focus();
  ta.setSelectionRange(start, Math.max(start, end));
  const lh = parseFloat(getComputedStyle(ta).lineHeight) || 22;
  ta.scrollTop = Math.max(0, (d.line - 1) * lh - ta.clientHeight / 3);
  ta.dispatchEvent(new Event('scroll'));
}

export function goToProblem(direction = 1) {
  const list = results.left;
  if (!list.length) return false;
  const ta = sides.left.textarea();
  const starts = lineStarts(ta.value);
  const caret = ta.selectionStart;
  const offsetOf = (d) => (starts[d.line - 1] ?? 0) + d.col;
  const ordered = list.map((d) => ({ d, o: offsetOf(d) })).sort((a, b) => a.o - b.o);
  const target = direction > 0
    ? (ordered.find((x) => x.o > caret) || ordered[0])
    : ([...ordered].reverse().find((x) => x.o < caret) || ordered[ordered.length - 1]);
  selectDiagnostic(target.d);
  return true;
}

export function problemItems() {
  return results.left.map((d, i) => ({
    label: localizeDiagnostic(d.message),
    detail: `${getLang() === 'en' ? 'line' : 'строка'} ${d.line} · ${getLang() === 'en' ? (d.severity === 'error' ? 'error' : 'warning') : (d.severity === 'error' ? 'ошибка' : 'предупреждение')}`,
    search: `${localizeDiagnostic(d.message)} ${d.line}`,
    order: i,
    run: () => selectDiagnostic(d),
  }));
}

export function setupDiagnostics() {
  bindHover('left');
  bindHover('right');
  window.addEventListener('frogee:content', scheduleDiagnostics);
  window.addEventListener('frogee:ext-diagnostics', scheduleDiagnostics);
  document.getElementById('status-problems')?.addEventListener('click', () => goToProblem(1));
  scheduleDiagnostics();
}

onLangChange(() => { updateStatus(); hideTip(); });
