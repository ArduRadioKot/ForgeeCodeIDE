/**
 * Precise syntax checks that need a real parser: JavaScript (V8), Python (ast), Shell (bash -n).
 * Everything else is covered by the renderer's own checks. Each result: { line, col, endCol, severity, message, source }.
 */
const { ipcMain } = require('electron');
const { spawn } = require('child_process');
const vm = require('vm');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_CODE = 400000;

const JS_RU = [
  [/Unexpected end of input/, 'Неожиданный конец кода: не закрыта скобка, блок или строка'],
  [/missing \) after argument list/, 'Пропущена «)» после списка аргументов'],
  [/Unexpected identifier(?: '(.+)')?/, (m) => `Неожиданный идентификатор${m[1] ? ` «${m[1]}»` : ''}: пропущена запятая, оператор или точка с запятой?`],
  [/Unexpected token '(.+)'/, (m) => `Неожиданный символ «${m[1]}»`],
  [/Unexpected string/, 'Неожиданная строка: пропущена запятая или оператор?'],
  [/Unexpected number/, 'Неожиданное число: пропущена запятая или оператор?'],
  [/Invalid or unexpected token/, 'Недопустимый символ или незакрытая строка'],
  [/Unexpected strict mode reserved word/, 'Зарезервированное слово в строгом режиме'],
  [/Identifier '(.+)' has already been declared/, (m) => `Переменная «${m[1]}» уже объявлена`],
  [/Unterminated template literal/, 'Не закрыта шаблонная строка (`)'],
  [/Missing initializer in const declaration/, 'У const нет значения: добавьте «= …»'],
  [/Illegal return statement/, '«return» вне функции'],
  [/Unexpected reserved word/, 'Неожиданное зарезервированное слово'],
];

const PY_RU = [
  [/expected ':'/, 'Ожидается «:» в конце строки'],
  [/invalid syntax/, 'Синтаксическая ошибка'],
  [/unterminated string literal/, 'Не закрыта строка'],
  [/unexpected indent/, 'Лишний отступ'],
  [/expected an indented block/, 'Ожидается блок с отступом'],
  [/unindent does not match/, 'Отступ не совпадает с предыдущими уровнями'],
  [/'(.)' was never closed/, (m) => `Не закрыта скобка «${m[1]}»`],
  [/unmatched '(.)'/, (m) => `Лишняя закрывающая скобка «${m[1]}»`],
  [/EOF while scanning/, 'Неожиданный конец файла'],
  [/unexpected EOF/, 'Неожиданный конец файла'],
  [/Missing parentheses in call to 'print'/, 'Для print нужны скобки'],
  [/cannot assign to (.+) here/, 'Нельзя присваивать это выражение'],
  [/leading zeros/, 'Ведущие нули в числе запрещены'],
];

function translate(table, message) {
  for (const [re, out] of table) {
    const m = re.exec(message);
    if (m) return typeof out === 'function' ? out(m) : `${out}`;
  }
  return message;
}

/** Blank out ES-module syntax (keeping every line and column) so vm.Script can parse module code. */
function neutralizeModules(code) {
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  return code
    .replace(/^[ \t]*import\b[\s\S]*?\bfrom\s*['"][^'"\n]+['"][ \t]*;?/gm, blank)
    .replace(/^[ \t]*import\s*['"][^'"\n]+['"][ \t]*;?/gm, blank)
    .replace(/^[ \t]*export\s*\{[\s\S]*?\}(?:\s*from\s*['"][^'"\n]+['"])?[ \t]*;?/gm, blank)
    .replace(/^[ \t]*export\s*\*[^\n;]*;?/gm, blank)
    .replace(/^([ \t]*)export\s+default\s+/gm, (m, ind) => `${ind}${' '.repeat(m.length - ind.length)}`)
    .replace(/^([ \t]*)export\s+(?=(?:async\s+)?(?:const|let|var|function|class)\b)/gm, (m, ind) => `${ind}${' '.repeat(m.length - ind.length)}`);
}

function checkJs(code) {
  try {
    // eslint-disable-next-line no-new
    new vm.Script(neutralizeModules(code), { filename: 'file.js' });
    return [];
  } catch (err) {
    if (!(err instanceof SyntaxError)) return [];
    const message = String(err.message || '');
    // Top-level await / import.meta are valid in modules, which vm.Script cannot represent.
    if (/await is only valid|import\.meta|Cannot use import/.test(message)) return [];
    const stack = String(err.stack || '').split('\n');
    const at = /^file\.js:(\d+)$/.exec(stack[0] || '');
    const caret = stack.find((l) => /^\s*\^+\s*$/.test(l)) || '';
    const lines = code.split('\n');
    const line = at ? Number(at[1]) : Math.max(1, lines.length);
    const col = caret ? caret.indexOf('^') : 0;
    const len = caret ? Math.max(1, caret.trim().length) : 1;
    return [{ line, col, endCol: col + len, severity: 'error', message: translate(JS_RU, message), source: 'JavaScript' }];
  }
}

const PY_SCRIPT = `
import ast, json, sys
code = sys.stdin.read()
try:
    ast.parse(code)
    print('[]')
except SyntaxError as e:
    line = e.lineno or 1
    col = max((e.offset or 1) - 1, 0)
    end = getattr(e, 'end_offset', None)
    end_line = getattr(e, 'end_lineno', None) or line
    end_col = (end - 1) if (end and end_line == line) else col + 1
    print(json.dumps([{'line': line, 'col': col, 'endCol': max(end_col, col + 1), 'message': e.msg}]))
`;

function run(cmd, args, input, timeout = 4000) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] }); } catch (err) { resolve({ ok: false, error: err }); return; }
    let out = '';
    let err = '';
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} resolve({ ok: false, timeout: true }); }, timeout);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: e }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: true, code, out, err }); });
    if (input != null) child.stdin.end(input); else child.stdin.end();
  });
}

let pythonCmd = null;
async function checkPython(code) {
  const candidates = pythonCmd ? [pythonCmd] : (process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python']);
  for (const cmd of candidates) {
    const res = await run(cmd, ['-c', PY_SCRIPT], code);
    if (!res.ok || res.error) continue;
    pythonCmd = cmd;
    try {
      return JSON.parse(res.out.trim() || '[]').map((d) => ({ ...d, severity: 'error', message: translate(PY_RU, d.message), source: 'Python' }));
    } catch {
      return [];
    }
  }
  return []; // no interpreter: the generic checks still run in the renderer
}

async function checkShell(code) {
  const file = path.join(os.tmpdir(), `frogee-${process.pid}-${Date.now()}.sh`);
  try {
    fs.writeFileSync(file, code);
    const res = await run('bash', ['-n', file], null);
    if (!res.ok || res.code === 0) return [];
    const m = /line (\d+): (.*)/.exec(res.err);
    if (!m) return [];
    const line = Number(m[1]);
    const text = (code.split('\n')[line - 1] || '').length;
    return [{ line, col: 0, endCol: Math.max(1, text), severity: 'error', message: m[2].replace(/^`|'$/g, ''), source: 'bash' }];
  } finally {
    try { fs.unlinkSync(file); } catch {}
  }
}

async function diagnose(lang, code) {
  if (typeof code !== 'string' || code.length > MAX_CODE) return { success: true, diagnostics: [], precise: false };
  if (lang === 'js') return { success: true, diagnostics: checkJs(code), precise: true };
  if (lang === 'py') return { success: true, diagnostics: await checkPython(code), precise: true };
  if (lang === 'sh') return { success: true, diagnostics: await checkShell(code), precise: true };
  return { success: true, diagnostics: [], precise: false };
}

function registerDiagnosticsIpc() {
  try { ipcMain.removeHandler('diagnose'); } catch {}
  ipcMain.handle('diagnose', (event, { lang, code } = {}) => diagnose(lang, code).catch((err) => ({ success: false, error: err.message, diagnostics: [] })));
}

module.exports = { registerDiagnosticsIpc, diagnose };
