/**
 * Editing helpers shared by the main editor and notebook cells: auto-pairs, auto-indent,
 * block indent, comment toggle, line move/duplicate/delete. Every change goes through
 * execCommand('insertText') so the browser's native undo stack keeps working.
 */

const PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
const CLOSERS = new Set([')', ']', '}', '"', "'", '`']);
const LINE_COMMENT = {
  py: '#', sh: '#', yaml: '#', yml: '#', rb: '#', toml: '#', r: '#',
  js: '//', ts: '//', jsx: '//', tsx: '//', java: '//', go: '//', rs: '//', c: '//', cpp: '//', cs: '//', swift: '//', kt: '//', php: '//',
  sql: '--', lua: '--',
};

export function langFromName(name = '') {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : 'py';
}

function insertText(ta, text) {
  ta.focus();
  if (document.execCommand && document.execCommand('insertText', false, text)) return;
  ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

function replaceRange(ta, start, end, text, selStart = null, selEnd = null) {
  ta.setSelectionRange(start, end);
  insertText(ta, text);
  if (selStart != null) ta.setSelectionRange(selStart, selEnd ?? selStart);
}

function lineBounds(value, start, end) {
  const from = value.lastIndexOf('\n', start - 1) + 1;
  let to = value.indexOf('\n', end > start && value[end - 1] === '\n' ? end - 1 : end);
  if (to < 0) to = value.length;
  return [from, to];
}

function indentUnit(opts) {
  return ' '.repeat(Math.max(1, opts.tabSize || 4));
}

function indentLines(ta, opts, outdent) {
  const { value, selectionStart: s, selectionEnd: e } = ta;
  const unit = indentUnit(opts);
  const [from, to] = lineBounds(value, s, e);
  const lines = value.slice(from, to).split('\n');
  let firstDelta = 0;
  let total = 0;
  const next = lines.map((line, i) => {
    if (!outdent) {
      if (i === 0) firstDelta = unit.length;
      total += unit.length;
      return unit + line;
    }
    const m = /^( {1,4}|\t)/.exec(line);
    const cut = m ? Math.min(m[0].length, unit.length) : 0;
    if (i === 0) firstDelta = -cut;
    total -= cut;
    return line.slice(cut);
  });
  replaceRange(ta, from, to, next.join('\n'), Math.max(from, s + firstDelta), e + total);
}

function toggleComment(ta, opts) {
  const { value, selectionStart: s, selectionEnd: e } = ta;
  const token = opts.comment || LINE_COMMENT[opts.lang] || '//';
  const [from, to] = lineBounds(value, s, e);
  const lines = value.slice(from, to).split('\n');
  const body = lines.filter((l) => l.trim());
  const allCommented = body.length > 0 && body.every((l) => l.trim().startsWith(token));
  const minIndent = Math.min(...body.map((l) => l.match(/^\s*/)[0].length), 1e9);
  const next = lines.map((line) => {
    if (!line.trim()) return line;
    if (allCommented) {
      const i = line.indexOf(token);
      const after = line.slice(i + token.length);
      return line.slice(0, i) + (after.startsWith(' ') ? after.slice(1) : after);
    }
    return line.slice(0, minIndent) + token + ' ' + line.slice(minIndent);
  });
  const out = next.join('\n');
  replaceRange(ta, from, to, out, from, from + out.length);
}

function moveLines(ta, dir) {
  const { value, selectionStart: s, selectionEnd: e } = ta;
  const [from, to] = lineBounds(value, s, e);
  if (dir < 0) {
    if (from === 0) return;
    const prevFrom = value.lastIndexOf('\n', from - 2) + 1;
    const prev = value.slice(prevFrom, from - 1);
    const block = value.slice(from, to);
    replaceRange(ta, prevFrom, to, block + '\n' + prev, s - prev.length - 1, e - prev.length - 1);
  } else {
    if (to >= value.length) return;
    let nextTo = value.indexOf('\n', to + 1);
    if (nextTo < 0) nextTo = value.length;
    const next = value.slice(to + 1, nextTo);
    const block = value.slice(from, to);
    replaceRange(ta, from, nextTo, next + '\n' + block, s + next.length + 1, e + next.length + 1);
  }
}

function duplicateLines(ta, dir) {
  const { value, selectionStart: s, selectionEnd: e } = ta;
  const [from, to] = lineBounds(value, s, e);
  const block = value.slice(from, to);
  replaceRange(ta, to, to, '\n' + block);
  const shift = dir > 0 ? block.length + 1 : 0;
  ta.setSelectionRange(s + shift, e + shift);
}

function deleteLines(ta) {
  const { value, selectionStart: s, selectionEnd: e } = ta;
  const [from, to] = lineBounds(value, s, e);
  const end = to < value.length ? to + 1 : to;
  const start = end === to && from > 0 ? from - 1 : from;
  replaceRange(ta, start, end, '', start);
}

function handleEnter(ta, opts) {
  const { value, selectionStart: s, selectionEnd: e } = ta;
  const lineStart = value.lastIndexOf('\n', s - 1) + 1;
  const before = value.slice(lineStart, s);
  const indent = before.match(/^[ \t]*/)[0];
  const trimmed = before.trimEnd();
  const lastCh = trimmed.slice(-1);
  const unit = indentUnit(opts);
  const pyBlock = (opts.lang === 'py') && lastCh === ':';
  const opensBlock = pyBlock || '{[('.includes(lastCh);
  const nextCh = value[e];
  const closes = opensBlock && nextCh && '}])'.includes(nextCh) && PAIRS[lastCh] === nextCh;
  if (closes) {
    const text = '\n' + indent + unit + '\n' + indent;
    replaceRange(ta, s, e, text, s + 1 + indent.length + unit.length);
    return true;
  }
  if (!indent && !opensBlock) return false;
  insertText(ta, '\n' + indent + (opensBlock ? unit : ''));
  return true;
}

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const TAG_LANGS = new Set(['html', 'htm', 'xml', 'svg', 'vue', 'svelte', 'php']);

/** Typing ">" after "<div class=\"x\"" inserts the closing tag and keeps the caret between. */
function handleTagClose(ta) {
  const { value, selectionStart: s, selectionEnd: e } = ta;
  if (s !== e) return false;
  const before = value.slice(0, s);
  const lt = before.lastIndexOf('<');
  if (lt < 0 || before.slice(lt).includes('>')) return false;
  const m = /^<([A-Za-z][\w:-]*)(\s[^<>]*)?$/.exec(before.slice(lt));
  if (!m || VOID_TAGS.has(m[1].toLowerCase()) || /\/\s*$/.test(before)) return false;
  const after = value.slice(s);
  if (new RegExp('^\\s*</' + m[1] + '>').test(after)) return false;
  replaceRange(ta, s, e, `></${m[1]}>`, s + 1);
  return true;
}

function handleOpen(ta, key) {
  const { value, selectionStart: s, selectionEnd: e } = ta;
  const close = PAIRS[key];
  if (s !== e) {
    replaceRange(ta, s, e, key + value.slice(s, e) + close, s + 1, e + 1);
    return true;
  }
  const prev = value[s - 1] || '';
  const next = value[s] || '';
  const isQuote = key === '"' || key === "'" || key === '`';
  if (isQuote && (/\w/.test(prev) || next === key)) return false;
  if (next && !/\s/.test(next) && !CLOSERS.has(next)) return false;
  replaceRange(ta, s, e, key + close, s + 1);
  return true;
}

/** Returns a keydown handler; returns true when it consumed the event. */
export function createSmartKeydown(getOptions) {
  return function smartKeydown(e) {
    const ta = e.currentTarget || e.target;
    if (!ta || e.isComposing) return false;
    const opts = getOptions() || {};
    const mod = e.metaKey || e.ctrlKey;
    const { value, selectionStart: s, selectionEnd: end } = ta;
    let handled = false;

    if (e.key === 'Tab' && !mod && !e.altKey) {
      if (e.shiftKey || s !== end) {
        indentLines(ta, opts, e.shiftKey);
      } else {
        const lineStart = value.lastIndexOf('\n', s - 1) + 1;
        const size = Math.max(1, opts.tabSize || 4);
        insertText(ta, ' '.repeat(size - ((s - lineStart) % size)));
      }
      handled = true;
    } else if (mod && (e.key === ']' || e.key === '[')) {
      indentLines(ta, opts, e.key === '[');
      handled = true;
    } else if (mod && e.key === '/') {
      toggleComment(ta, opts);
      handled = true;
    } else if (e.altKey && !mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      if (e.shiftKey) duplicateLines(ta, e.key === 'ArrowDown' ? 1 : -1);
      else moveLines(ta, e.key === 'ArrowUp' ? -1 : 1);
      handled = true;
    } else if (mod && e.shiftKey && (e.key === 'K' || e.key === 'k')) {
      deleteLines(ta);
      handled = true;
    } else if (e.key === 'Enter' && !mod && !e.shiftKey && !e.altKey) {
      handled = handleEnter(ta, opts);
    } else if (e.key === '>' && !mod && !e.altKey && TAG_LANGS.has(opts.lang) && opts.autoPair !== false) {
      handled = handleTagClose(ta);
    } else if (!mod && !e.altKey && CLOSERS.has(e.key) && s === end && value[s] === e.key) {
      ta.setSelectionRange(s + 1, s + 1);
      handled = true;
    } else if (!mod && !e.altKey && PAIRS[e.key] && opts.autoPair !== false) {
      handled = handleOpen(ta, e.key);
    } else if (e.key === 'Backspace' && s === end && s > 0 && !mod && !e.altKey) {
      const a = value[s - 1];
      if (PAIRS[a] && PAIRS[a] === value[s]) {
        replaceRange(ta, s - 1, s + 1, '', s - 1);
        handled = true;
      }
    }

    if (handled) e.preventDefault();
    return handled;
  };
}
