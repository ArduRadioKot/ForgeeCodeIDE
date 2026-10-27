/**
 * Converts a Processing sketch into JavaScript for the emulator.
 *
 * Two dialects are supported:
 *   • Java (the classic .pde): `void setup()`, `float x = 1.0;`, `PVector p = new PVector();`
 *   • JavaScript (p5.js style): `function setup() {}`
 *
 * The transformation is line-preserving: a line in the sketch keeps its number, so an error
 * reported by the runtime points at the original file.
 */

const JAVA_TYPES = [
  'int', 'float', 'double', 'boolean', 'char', 'byte', 'short', 'long',
  'String', 'Boolean', 'Integer', 'Float', 'Double', 'Long', 'Character',
  'PVector', 'PFont', 'PImage',
];

/** Events whose name in Processing is also a boolean — handlers and flags get separate names. */
const EVENT_HANDLERS = [
  'keyPressed', 'keyReleased', 'keyTyped',
  'mousePressed', 'mouseReleased', 'mouseClicked', 'mouseDragged', 'mouseMoved', 'mouseWheel',
  'touchStarted', 'touchMoved', 'touchEnded',
  'shake',
  'onPermissionGranted', 'onLocationChanged',
];

const GENERIC_TYPE = '(?:[A-Za-z_]\\w*)(?:\\s*<[^<>]*>)?(?:\\s*\\[\\s*\\])*';
const MODIFIERS = '(?:public|private|protected|static|final|abstract|native|synchronized)';

/** Splits a line into code / string / comment parts so that replacements never touch text. */
function splitParts(line) {
  const parts = [];
  let buf = '';
  let i = 0;
  const flush = () => { if (buf) { parts.push({ type: 'code', text: buf }); buf = ''; } };
  while (i < line.length) {
    const ch = line[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < line.length) {
        if (line[j] === '\\') { j += 2; continue; }
        if (line[j] === ch) { j++; break; }
        j++;
      }
      flush();
      parts.push({ type: 'str', text: line.slice(i, j) });
      i = j;
      continue;
    }
    if (ch === '/' && line[i + 1] === '/') {
      flush();
      parts.push({ type: 'comment', text: line.slice(i) });
      break;
    }
    if (ch === '/' && line[i + 1] === '*') {
      const end = line.indexOf('*/', i + 2);
      const stop = end < 0 ? line.length : end + 2;
      flush();
      parts.push({ type: 'comment', text: line.slice(i, stop) });
      i = stop;
      continue;
    }
    buf += ch;
    i++;
  }
  flush();
  return parts;
}

/** Applies a replacement to the code parts of a line, keeping strings and comments intact. */
function mapCode(line, fn) {
  const parts = splitParts(line);
  let out = '';
  for (const part of parts) {
    out += part.type === 'code' ? fn(part.text) : part.text;
  }
  return out;
}

/** Removes the types from a parameter list: `int x, float y` → `x, y`. */
function stripParamTypes(params) {
  return params
    .replace(/@\w+(\([^)]*\))?\s*/g, '')
    .replace(new RegExp(`(?:final\\s+)?${GENERIC_TYPE}\\s+([A-Za-z_]\\w*)\\s*(?=,|$)`, 'g'), '$1');
}

function findClosing(text, open, close) {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** The text starts right after the opening bracket — finds its pair. */
function findClosingInside(text, close) {
  let depth = 1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

const STATEMENT_START = /^\s*(?:return|if|else|for|while|do|switch|case|default|break|continue|try|catch|finally|throw|new|assert|yield|print|println)\b/;

/** Rewrites a method declaration: `void setup()` → `function setup()`. */
function transformDeclaration(code, javaMode, inClass) {
  if (STATEMENT_START.test(code)) return code;
  const re = new RegExp(`^(\\s*)((?:${MODIFIERS}\\s+)*)([A-Za-z_][\\w<>\\[\\],.]*)\\s+([A-Za-z_]\\w*)\\s*\\(`);
  const m = code.match(re);
  if (!m) return code;
  const indent = m[1];
  const returnType = m[3].trim();
  const name = m[4];
  const rest = code.slice(m[0].length);
  const close = findClosingInside(rest, ')');
  if (close < 0) return code;
  const params = rest.slice(0, close);
  // Java: `void f() throws Exception {` — в JS конструкции throws нет.
  const tail = rest.slice(close + 1).replace(/^(\s*)throws\s+[A-Za-z_][\w.]*(\s*,\s*[A-Za-z_][\w.]*)*\s*/, '$1');
  const newName = javaMode && EVENT_HANDLERS.includes(name)
    ? (name.startsWith('on') ? `__${name}` : '__on' + name.charAt(0).toUpperCase() + name.slice(1))
    : name;
  const head = inClass ? `${indent}${newName}` : `${indent}function ${newName}`;
  return `${head}(${stripParamTypes(params)})${tail}`;
}

/** Rewrites a constructor inside a class body: `Ball(float x) {` → `Ball(x) {`. */
function transformConstructor(code, inClass) {
  if (!inClass) return code;
  const re = /^(\s*)((?:public|private|protected)\s+)?([A-Z]\w*)\s*\(/;
  const m = code.match(re);
  if (!m) return code;
  const rest = code.slice(m[0].length);
  const close = findClosingInside(rest, ')');
  if (close < 0) return code;
  return `${m[1]}${m[3]}(${stripParamTypes(rest.slice(0, close))})${rest.slice(close + 1)}`;
}

/** Rewrites a variable declaration: `float x = 1.0;` → `let x = 1.0;`. */
function transformDeclarationTypes(code, javaMode, inClass) {
  if (!javaMode) return code;
  // Примитивные типы, коллекции и любые имена классов (SensorManager manager;).
  const typePattern = `(?:${JAVA_TYPES.join('|')}|ArrayList\\s*<[^<>]*>|HashMap\\s*<[^<>]*>|[A-Z][A-Za-z0-9_]*(?:\\s*<[^<>]*>)?)(?:\\s*\\[\\s*\\])*`;
  const mods = `(?:${MODIFIERS}|volatile|transient)`;
  if (inClass) {
    // Внутри класса поле остаётся полем: `float x, y;` → `x; y;`
    const re = new RegExp(`(^|[^\\w$.])((?:${mods}\\s+)*)(${typePattern})\\s+([A-Za-z_]\\w*(?:\\s*=\\s*[^;,]+)?(?:\\s*,\\s*[A-Za-z_]\\w*(?:\\s*=\\s*[^;,]+)?)*)\\s*;`, 'g');
    return code.replace(re, (_all, pre, _mods, _type, names) => {
      const parts = names.split(',').map((part) => part.trim()).filter(Boolean);
      return pre + parts.map((part) => `${part};`).join(' ');
    });
  }
  // volatile/transient — просто модификаторы, поле остаётся изменяемым.
  const re = new RegExp(`(^|[^\\w$.])((?:(?:final|volatile|transient)\\s+)*)(${typePattern})\\s+([A-Za-z_]\\w*)`, 'g');
  return code.replace(re, (_all, pre, mods, _type, name) => `${pre}${/\bfinal\b/.test(mods) ? 'const ' : 'let '}${name}`);
}

/** `for (PVector p : list)` → `for (const p of list)`. */
function transformForEach(code) {
  const re = /for\s*\(\s*(?:final\s+)?(?:[A-Za-z_]\w*)(?:\s*<[^<>]*>)?(?:\s*\[\s*\])*\s+([A-Za-z_]\w*)\s*:\s*([^)]*)\)/g;
  return code.replace(re, (_all, name, expr) => `for (const ${name} of ${expr.trim()})`);
}

function transformCasts(code) {
  return code
    .replace(/(?<![\w$.])\((?:float|double)\)\s*/g, '1*')
    .replace(/(?<![\w$.])\((?:int|long|short|byte|char)\)\s*/g, '~~')
    // Приведение к классу: (SensorManager) expr — убираем, если дальше идёт выражение.
    .replace(/(?<![\w$.])\(([A-Z][A-Za-z0-9_]*(?:\s*<[^<>]*>)?)\)\s*(?=[A-Za-z_!~+\-(])/g, '')
    .replace(/\bnew\s+(ArrayList|HashMap)\s*<[^<>]*>/g, 'new $1')
    .replace(/\bMath\.random\s*\(\s*\)/g, 'random')
    .replace(/\bString\.format\s*\(/g, 'format');
}

function stripNumericSuffixes(code) {
  return code.replace(/(?<![\w.$])(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)[fFdDlL]\b/g, '$1');
}

/** In Java mode `keyPressed` is both a handler and a boolean — the boolean gets its own name. */
function renameBooleans(code) {
  return code
    .replace(/\bkeyPressed\b(?!\s*\()/g, '__keyDown')
    .replace(/\bmousePressed\b(?!\s*\()/g, '__mouseDown');
}

/** Привычки Java, которых нет в JS. */
function transformJavaIdioms(code) {
  return code
    // new float[60] → new Array(60).fill(0)
    .replace(/\bnew\s+[A-Za-z_]\w*(?:\s*<[^<>]*>)?\s*\[\s*([^\]]+?)\s*\]/g, 'new Array($1).fill(0)')
    // synchronized (values) { … } → { … }: в JS блокировки нет
    .replace(/\bsynchronized\s*\([^)]*\)\s*\{/g, '{')
    .replace(/\.length\s*\(\s*\)/g, '.length')                       // s.length() → s.length
    .replace(/\bInteger\.parseInt\s*\(/g, 'parseInt(')
    .replace(/\bLong\.parseLong\s*\(/g, 'parseInt(')
    .replace(/\b(?:Float|Double)\.parse(?:Float|Double)\s*\(/g, 'parseFloat(')
    .replace(/\bBoolean\.parseBoolean\s*\(/g, 'parseBool(')
    .replace(/\bString\.valueOf\s*\(/g, 'String(')
    .replace(/\bArrays\.sort\s*\(\s*([A-Za-z_]\w*)\s*\)/g, '$1.sort()');
}

/** Ищет парную фигурную скобку, пропуская строки и комментарии. */
function matchBrace(code, open) {
  let depth = 0;
  let i = open;
  while (i < code.length) {
    const ch = code[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < code.length) {
        if (code[i] === '\\') { i += 2; continue; }
        if (code[i] === quote) break;
        i++;
      }
    } else if (ch === '/' && code[i + 1] === '/') {
      while (i < code.length && code[i] !== '\n') i++;
      continue;
    } else if (ch === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      i = end < 0 ? code.length : end + 2;
      continue;
    } else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/**
 * Java разрешает несколько catch подряд, JS — только один.
 * Второй и следующие блоки комментируем: их тела выполняются внутри первого catch.
 * Номера строк при этом сохраняются.
 */
function mergeJavaCatches(code) {
  const re = /catch\s*\(/g;
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(code))) {
    const open = code.indexOf('{', m.index);
    if (open < 0) break;
    const end = matchBrace(code, open);
    if (end < 0) break;
    const rest = code.slice(end + 1);
    const next = /^\s*catch\s*\(/.exec(rest);
    if (!next) continue;
    // Следующий catch идёт сразу за текущим: объединяем.
    const nextHeader = end + 1 + rest.indexOf('catch');
    const nextOpen = code.indexOf('{', nextHeader);
    const nextEnd = matchBrace(code, nextOpen);
    if (nextEnd < 0) break;
    // Закрывающая скобка первого catch и заголовок второго уходят в комментарий:
    // тело второго catch остаётся внутри первого (номера строк сохраняются).
    const before = code.slice(last, nextHeader).replace(/\s+$/, '');
    const closeIdx = last + before.length - 1;
    out += code.slice(last, closeIdx);
    out += '/* ' + code.slice(closeIdx, nextOpen + 1) + ' */';
    // Скобка второго catch закрывает первый — лишней она не остаётся.
    out += code.slice(nextOpen + 1, nextEnd + 1);
    last = nextEnd + 1;
    re.lastIndex = last;
  }
  out += code.slice(last);
  return out;
}

/**
 * В Java поле класса доступно без this., в JS — только через this.
 * Квалифицируем обращения к полям внутри методов (параметры и локальные переменные
 * перекрывают поле — их не трогаем).
 */
function qualifyClassFields(code) {
  const classRe = /^(?:[ \t]*)(?:(?:public|private|protected|static|final|abstract)\s+)*class\s+[A-Za-z_]\w*/gm;
  let out = '';
  let last = 0;
  let m;
  while ((m = classRe.exec(code))) {
    const bodyStart = code.indexOf('{', m.index);
    if (bodyStart < 0) break;
    const bodyEnd = matchBrace(code, bodyStart);
    if (bodyEnd < 0) break;
    out += code.slice(last, bodyStart + 1);
    out += processClassBody(code.slice(bodyStart + 1, bodyEnd), m[0].match(/class\s+([A-Za-z_]\w*)/)?.[1] || '');
    out += '}';
    last = bodyEnd + 1;
    classRe.lastIndex = bodyEnd;
  }
  out += code.slice(last);
  return out;
}

const FIELD_DECL_RE = /^[ \t]*(?:(?:public|private|protected|static|final|volatile|transient)\s+)*[A-Za-z_][\w.]*(?:\s*<[^<>]*>)?(?:\s*\[\s*\])*\s+([A-Za-z_]\w*(?:\s*=\s*[^;,]+)?(?:\s*,\s*[A-Za-z_]\w*(?:\s*=\s*[^;,]+)?)*)\s*;/;

function collectFieldNames(body) {
  const fields = new Set();
  for (const line of body.split('\n')) {
    const m = line.match(FIELD_DECL_RE);
    if (!m) continue;
    for (const part of m[1].split(',')) {
      const name = part.split('=')[0].trim();
      if (name) fields.add(name);
    }
  }
  return fields;
}

function processClassBody(body, className = '') {
  const fields = collectFieldNames(body);
  const methods = collectMethodNames(body, className);
  if (!fields.size && !methods.size) return body;
  const methodRe = /(?:^|\n)([ \t]*)(?:(?:public|private|protected|static|final|abstract|synchronized)\s+)*(?:([A-Za-z_][\w.]*(?:\s*<[^<>]*>)?(?:\s*\[\s*\])*)\s+)?([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:throws\s+[\w.,\s]+)?\s*\{/g;
  let out = '';
  let last = 0;
  let m;
  while ((m = methodRe.exec(body))) {
    const open = body.indexOf('{', m.index + m[0].length - 1);
    if (open < 0) break;
    const end = matchBrace(body, open);
    if (end < 0) break;
    let header = body.slice(m.index, open + 1);
    // Конструктор в Java называется как класс, в JS — всегда constructor.
    if (className && m[3] === className) {
      header = header.replace(new RegExp(`\\b${className}\\s*\\(`), 'constructor(');
    }
    // Типы параметров в JS не нужны.
    header = header.replace(/\(([^)]*)\)/, (_all, params) => `(${stripParamTypes(params)})`);
    const methodBody = body.slice(open + 1, end);
    // Параметры перекрывают поля.
    const shadow = new Set();
    for (const part of (m[4] || '').split(',')) {
      const name = part.trim().split(/\s+/).pop();
      if (name && /^[A-Za-z_]\w*$/.test(name)) shadow.add(name);
    }
    // Локальные переменные тоже перекрывают поля.
    for (const lm of methodBody.matchAll(/(?:^|[;{]\s*)(?:(?:final\s+)?[A-Za-z_][\w.]*(?:\s*<[^<>]*>)?(?:\s*\[\s*\])*\s+)([A-Za-z_]\w*)/g)) shadow.add(lm[1]);
    for (const fm of methodBody.matchAll(/for\s*\(\s*(?:final\s+)?[A-Za-z_][\w.]*\s+([A-Za-z_]\w*)/g)) shadow.add(fm[1]);
    for (const cm of methodBody.matchAll(/catch\s*\(\s*[A-Za-z_][\w.]*\s+([A-Za-z_]\w*)/g)) shadow.add(cm[1]);
    out += body.slice(last, m.index) + header;
    out += qualifyIdentifiers(methodBody, fields, shadow, methods);
    out += '}';
    last = end + 1;
    methodRe.lastIndex = end;
  }
  out += body.slice(last);
  return out;
}

function qualifyIdentifiers(text, fields, shadow, methods = new Set()) {
  const parts = splitParts(text);
  return parts.map((part) => {
    if (part.type !== 'code') return part.text;
    let out = part.text;
    for (const field of fields) {
      if (shadow.has(field)) continue;
      const re = new RegExp(`(^|[^\\w$.])${field}\\b`, 'gm');
      out = out.replace(re, (_all, pre) => `${pre}this.${field}`);
    }
    // Вызов метода своего класса тоже требует this.
    for (const method of methods) {
      const re = new RegExp(`(^|[^\\w$.])${method}\\s*\\(`, 'gm');
      out = out.replace(re, (_all, pre) => `${pre}this.${method}(`);
    }
    return out;
  }).join('');
}

/** Имена методов, объявленных в классе (конструктор исключается). */
function collectMethodNames(body, className) {
  const names = new Set();
  const re = /^[ \t]*(?:(?:public|private|protected|static|final|abstract|synchronized)\s+)*(?:[A-Za-z_][\w.]*(?:\s*<[^<>]*>)?(?:\s*\[\s*\])*\s+)?([A-Za-z_]\w*)\s*\([^)]*\)\s*(?:throws\s+[\w.,\s]+)?\s*\{/gm;
  let m;
  while ((m = re.exec(body))) {
    const name = m[1];
    if (!name || name === className) continue;
    if (/^(if|for|while|switch|catch|return|new|typeof|function)$/.test(name)) continue;
    names.add(name);
  }
  return names;
}

/** `catch (Exception e)` → `catch (e)`: тип исключения в JS не нужен. */
function transformCatch(code) {
  return code.replace(/catch\s*\(\s*(?:final\s+)?[A-Za-z_][\w.]*(?:\s*<[^<>]*>)?\s+([A-Za-z_]\w*)\s*\)/g, 'catch ($1)');
}

/** Внутренние классы sketch не наследуют ничего: extends/implements убираем. */
function stripClassInheritance(code) {
  return code.replace(/\b(class\s+[A-Za-z_]\w*)\s+(extends\s+[A-Za-z_][\w.]*)?\s*(implements\s+[A-Za-z_][\w.]*(\s*,\s*[A-Za-z_][\w.]*)*)?/g, '$1');
}

/** `super.onPause()` в Java-скетче — вызов базовой реализации, в эмуляторе он не нужен. */
function stripSuperCalls(code) {
  return code.replace(/\bsuper\.(onPause|onResume|onStop|onDestroy|onRestart)\s*\(\s*\)\s*;/g, 'void 0;')
    .replace(/\bsuper\.([A-Za-z_]\w*)\s*\(/g, '$1(');
}

/** `key` in Processing is a char: `key == 'a'` and `key == 97` both work. In JS the key is a string, so a comparison with a code goes to the char code. */
function fixCharComparisons(code) {
  return code.replace(/\bkey\s*([=!]=)\s*(\d{1,3})\b/g, 'key.charCodeAt(0) $1 $2');
}

/** Detects the dialect of the sketch. */
export function detectProcessingMode(source) {
  const src = String(source || '');
  if (/^\s*(?:from\s+processing|import\s+processing\b)/m.test(src) && /\bdef\s+\w+\s*\(/.test(src)) return 'python';
  if (/^\s*(?:public\s+|private\s+|protected\s+|static\s+)*void\s+\w+\s*\(/m.test(src)) return 'java';
  if (/\b(?:int|float|double|boolean|PVector|String)\s+[A-Za-z_]\w*\s*=/.test(src)) return 'java';
  if (/\bfunction\s+(?:setup|draw)\s*\(/.test(src)) return 'js';
  if (/\b(?:setup|draw)\s*\(\s*\)\s*\{/.test(src)) return 'js';
  return 'java';
}

/**
 * @returns {{ code: string, mode: string, warnings: string[] }}
 */
export function transpileProcessing(source) {
  const src = String(source || '');
  const mode = detectProcessingMode(src);
  const warnings = [];
  if (mode === 'python') {
    return { code: '', mode, warnings: ['Python-режим Processing не поддерживается эмулятором — перепишите скетч на Java или JS.'] };
  }
  const javaMode = mode === 'java';

  // Brace context: we need to know whether a line sits directly in a class body —
  // there the declarations become class fields, not variables.
  const stack = [];
  let pending = null;

  const lines = qualifyClassFields(mergeJavaCatches(src)).split('\n');
  const out = lines.map((raw) => {
    const inClass = stack.length > 0 && stack[stack.length - 1] === 'class';

    let line = mapCode(raw, (code) => code
      .replace(/^\s*import\s+[\w.]+(?:\.\*)?\s*;?\s*$/, '')
      .replace(/^\s*package\s+[\w.]+\s*;?\s*$/, '')
      .replace(/^\s*@\w+(\([^)]*\))?\s*$/, ''));
    if (!line.trim()) return line;

    line = mapCode(line, (code) => transformForEach(code));
    line = mapCode(line, (code) => transformConstructor(code, inClass));
    line = mapCode(line, (code) => transformDeclaration(code, javaMode, inClass));
    const isClassDecl = /^\s*(?:(?:public|private|protected|static|final|abstract)\s+)*class\b/.test(line);
    const isCatch = /\bcatch\s*\(/.test(line);
    if (!isClassDecl && !isCatch) {
      line = mapCode(line, (code) => transformDeclarationTypes(code, javaMode, inClass));
    }
    if (isCatch) line = mapCode(line, (code) => transformCatch(code));
    if (javaMode) line = mapCode(line, (code) => transformJavaIdioms(code));
    line = mapCode(line, (code) => transformCasts(code));
    line = mapCode(line, (code) => stripNumericSuffixes(code));
    if (javaMode) line = mapCode(line, (code) => renameBooleans(code));
    if (javaMode) line = mapCode(line, (code) => fixCharComparisons(code));
    if (javaMode) line = mapCode(line, (code) => stripClassInheritance(code));
    if (javaMode) line = mapCode(line, (code) => stripSuperCalls(code));

    // Track the brace context for the next lines.
    const isClass = /^\s*(?:public\s+|private\s+|protected\s+|static\s+|final\s+|abstract\s+)*class\s+\w+/.test(line);
    const isMethod = /^\s*(?:function\s+)?[A-Za-z_]\w*\s*\([^)]*\)\s*\{?\s*$/.test(line)
      || /^\s*(?:function\s+)?[A-Za-z_]\w*\s*\([^)]*\)\s*\{/.test(line);
    if (isClass) pending = 'class';
    else if (isMethod) pending = 'method';
    for (const part of splitParts(line)) {
      if (part.type !== 'code') continue;
      for (const ch of part.text) {
        if (ch === '{') {
          stack.push(pending || 'block');
          pending = null;
        } else if (ch === '}') {
          stack.pop();
        }
      }
    }
    return line;
  });

  const code = out.join('\n');
  if (!/\b(?:setup|draw)\s*\(/.test(code)) {
    warnings.push('В скетче нет setup()/draw() — экран останется пустым.');
  }
  return { code, mode, warnings };
}
