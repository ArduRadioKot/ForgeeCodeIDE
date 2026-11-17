import { state } from './state.js';
import { getLang, onLangChange } from './i18n.js';
import { icon } from './glyphs.js';
import { addContextFiles, toggleChat } from './chat.js';
import { createTab, setFocusedPane, switchToTab } from './tabs.js';
import { goToEditorLine, loadFolderContents, refreshExplorerTree } from './explorer.js';
import { isEditorTab } from './tab-model.js';

const tr = (en, ru) => getLang() === 'en' ? en : ru;
const call = (name, input) => window.electronAPI.workbench(name, input);
const basename = (file) => file.split(/[\\/]/).pop();
const object = (text) => {
  const value = JSON.parse(text || '{}');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(tr('Enter a JSON object.', 'Введите объект JSON.'));
  return value;
};
const bytes = (value) => JSON.stringify(value, null, 2);
const lines = (text) => text.split('\n');
const breakpoints = new Map();
const sections = new Map();
let dock;
let current;
let trigger;
let returnFocus;
let fitDock;
let debugStatus;
let debugConnected = false;
let debugGeneration = 0;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(text, fn, className = 'settings-btn ghost') {
  const node = element('button', text, className);
  node.type = 'button';
  node.addEventListener('click', fn);
  return node;
}
function field(host, label, { value = '', options, type = 'text', rows, placeholder } = {}) {
  const wrapper = element('label', null, 'wb-field');
  wrapper.append(element('span', label));
  const input = element(options ? 'select' : rows ? 'textarea' : 'input', null, options ? 'settings-select' : 'settings-input');
  if (options) {
    for (const [key, title] of options) input.add(new Option(title, key));
  } else if (rows) input.rows = rows;
  else input.type = type;
  if (placeholder) input.placeholder = placeholder;
  if (!options || value) input.value = value;
  input.spellcheck = false;
  wrapper.append(input);
  host.append(wrapper);
  return input;
}
function group(host, className = 'wb-actions') {
  const row = element('div', null, className);
  host.append(row);
  return row;
}
function output(host) {
  const area = element('pre', '', 'wb-output');
  area.hidden = true;
  host.append(area);
  return (text) => { area.textContent = text || ''; area.hidden = !text; };
}
function task(host, label, fn, primary = false) {
  const node = button(label, async () => {
    const section = host.closest('.wb-section');
    if (section.dataset.busy) return;
    section.dataset.busy = 'true';
    const status = section.querySelector('.wb-status');
    status.classList.remove('wb-error');
    status.textContent = tr('Working…', 'Выполняется…');
    node.disabled = true;
    try {
      status.textContent = await fn() || '';
      status.classList.remove('wb-error');
    } catch (error) {
      status.textContent = error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
      status.classList.add('wb-error');
    } finally { node.disabled = false; delete section.dataset.busy; }
  }, primary ? 'settings-btn' : undefined);
  host.append(node);
  return node;
}

async function jump(file, line, column) {
  const existing = state.currentTabs.findIndex((tab) => tab.filePath === file);
  setFocusedPane('left');
  if (existing >= 0) switchToTab(existing);
  else {
    const result = await window.electronAPI.getFileContent(file);
    if (!result.success || typeof result.content !== 'string') throw new Error(result.error || tr('Cannot open the file.', 'Не удалось открыть файл.'));
    createTab(basename(file), result.content, file);
  }
  if (!line) return;
  goToEditorLine(line, 'left');
  if (column) {
    const editor = document.getElementById('editor');
    const offset = editor.selectionStart + column - 1;
    editor.setSelectionRange(Math.min(offset, editor.selectionEnd), Math.min(offset, editor.selectionEnd));
  }
}

function activeSource() {
  const secondary = document.getElementById('editor-right');
  const right = state.splitView && (state.focusedPane === 'right' || document.activeElement === secondary);
  const tab = state.currentTabs[right ? state.rightTabIndex : state.activeTabIndex];
  const area = right ? secondary : document.getElementById('editor');
  if (!isEditorTab(tab) || !tab.filePath || area.offsetParent === null) throw new Error(tr('Open a saved source file.', 'Откройте сохранённый файл с кодом.'));
  const before = lines(area.value.slice(0, area.selectionStart));
  return { area, file: tab.filePath, root: state.currentFolder, text: area.value, position: { line: before.length - 1, character: before.at(-1).length } };
}

function projectUi(host) {
  const name = field(host, tr('Project name', 'Имя проекта'), { placeholder: 'my-project' });
  const template = field(host, tr('Template', 'Шаблон'), { options: [
    ['html', 'HTML / CSS / JavaScript'], ['node', 'Node.js'], ['express', 'Express'],
    ['react', 'React / TypeScript / Vite'], ['python', 'Python'], ['fastapi', 'FastAPI'],
    ['go', 'Go'], ['rust', 'Rust'],
  ] });
  const hints = { express: 'npm install && npm start', react: 'npm install && npm run dev', fastapi: 'python -m pip install -r requirements.txt && python -m uvicorn main:app --reload', node: 'npm start', python: 'python main.py', go: 'go run .', rust: 'cargo run' };
  const hint = element('p', '', 'settings-hint');
  host.append(hint);
  const refresh = () => { hint.textContent = hints[template.value] || tr('Open index.html with Live Server.', 'Откройте index.html через Live Server.'); };
  template.addEventListener('change', refresh);
  refresh();
  task(group(host), tr('Choose folder and create', 'Выбрать папку и создать'), async () => {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(name.value.trim())) return tr('Use a name such as my-app.', 'Используйте имя в формате my-app.');
    const root = await call('project', { name: name.value.trim(), template: template.value });
    if (!root) return;
    await loadFolderContents(root);
    return tr('Project created.', 'Проект создан.');
  }, true);
}

function httpUi(host) {
  const address = group(host, 'wb-row');
  const method = field(address, tr('Method', 'Метод'), { options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((m) => [m, m]) });
  const url = field(address, 'URL', { placeholder: '{{baseUrl}}/api' });
  const authRow = group(host, 'wb-row');
  const auth = field(authRow, tr('Authorization', 'Авторизация'), { options: [['none', tr('None', 'Нет')], ['bearer', 'Bearer'], ['basic', 'Basic']] });
  const secret = field(authRow, tr('Token or username:password', 'Токен или имя:пароль'), { type: 'password', placeholder: '{{token}}' });
  const headers = field(host, tr('Headers (JSON)', 'Заголовки (JSON)'), { rows: 2, value: '{}' });
  const body = field(host, tr('Request body', 'Тело запроса'), { rows: 4 });
  const environments = new Map([['Local', '{}'], ['Staging', '{}'], ['Production', '{}']]);
  const envSelect = field(host, tr('Environment', 'Окружение'), { options: [...environments.keys()].map((name) => [name, name]) });
  const env = field(host, tr('Environment variables (JSON)', 'Переменные окружения (JSON)'), { rows: 2, value: '{}' });
  env.addEventListener('input', () => environments.set(envSelect.value, env.value));
  envSelect.addEventListener('change', () => { env.value = environments.get(envSelect.value); });
  const actions = group(host);
  const show = output(host);
  const historyNode = field(host, tr('Request history', 'История запросов'), { options: [['', tr('Select a request', 'Выберите запрос')]] });
  const history = [];
  historyNode.addEventListener('change', () => {
    const entry = history[Number(historyNode.value) - 1];
    if (!entry) return;
    method.value = entry.method;
    url.value = entry.url;
    headers.value = entry.headers;
    body.value = entry.body;
    auth.value = entry.auth;
    secret.value = '';
    envSelect.value = entry.environment;
    env.value = environments.get(entry.environment);
    const status = host.querySelector('.wb-status');
    status.textContent = entry.status;
    status.classList.remove('wb-error');
    show(entry.result);
  });
  task(actions, tr('Send request', 'Отправить запрос'), async () => {
    const request = { method: method.value, url: url.value.trim(), headers: object(headers.value), body: body.value, auth: auth.value, secret: secret.value, env: object(env.value) };
    const entry = { method: request.method, url: request.url, headers: headers.value, body: request.body, auth: request.auth, environment: envSelect.value };
    show('');
    const response = await call('http', request);
    let content = response.body;
    try { content = bytes(JSON.parse(content)); } catch {}
    const result = [response.headers.map(([key, value]) => `${key}: ${value}`).join('\n'), content, response.truncated ? tr('Response truncated.', 'Ответ обрезан.') : ''].filter(Boolean).join('\n\n');
    show(result);
    const status = `HTTP ${response.status} ${response.statusText} · ${response.ms} ms`;
    history.unshift({ ...entry, result, status });
    history.splice(12);
    historyNode.replaceChildren(new Option(tr('Select a request', 'Выберите запрос'), ''), ...history.map((entry, index) => new Option(`${entry.method} ${entry.url} · ${entry.status}`, String(index + 1))));
    return status;
  }, true);
  task(actions, tr('Clear history', 'Очистить историю'), () => {
    history.length = 0;
    historyNode.length = 1;
    show('');
  });
}

function replaceRanges(value, edits) {
  const source = lines(value);
  const offsets = [];
  let offset = 0;
  for (const line of source) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  const toOffset = (pos) => {
    if (!Number.isSafeInteger(pos.line) || !Number.isSafeInteger(pos.character) || pos.line < 0 || pos.character < 0 || pos.character > (source[pos.line]?.length ?? -1)) {
      throw new Error(tr('The fix contains an invalid range.', 'Исправление содержит недопустимый диапазон.'));
    }
    return offsets[pos.line] + pos.character;
  };
  const ranges = edits.map(({ range, newText }) => ({ start: toOffset(range.start), end: toOffset(range.end), newText })).sort((a, b) => b.start - a.start || b.end - a.end);
  let boundary = value.length;
  for (const { start, end, newText } of ranges) {
    if (end > boundary || end < start || typeof newText !== 'string') throw new Error(tr('The fix contains overlapping edits.', 'Исправление содержит пересекающиеся правки.'));
    value = value.slice(0, start) + newText + value.slice(end);
    boundary = start;
  }
  return value;
}

function lspUi(host) {
  const preset = field(host, tr('Language server', 'Языковой сервер'), { options: [['typescript', 'TypeScript / JavaScript'], ['python', 'Python / Pyright'], ['go', 'Go / gopls'], ['rust', 'Rust Analyzer'], ['custom', tr('Custom', 'Свой')]] });
  const commands = { typescript: ['typescript-language-server', '--stdio'], python: ['pyright-langserver', '--stdio'], go: ['gopls'], rust: ['rust-analyzer'] };
  const cmd = field(host, tr('Server command (JSON array)', 'Команда сервера (массив JSON)'), { value: JSON.stringify(commands.typescript) });
  preset.addEventListener('change', () => { cmd.value = JSON.stringify(commands[preset.value] || []); });
  const toolbar = group(host);
  task(toolbar, tr('Connect', 'Подключить'), async () => {
    await call('lsp:start', { command: JSON.parse(cmd.value), root: state.currentFolder });
    return tr('Language server connected.', 'Языковой сервер подключён.');
  }, true);
  task(toolbar, tr('Disconnect', 'Отключить'), () => call('disconnect', { key: 'lsp' }).then(() => ''));
  const actions = group(host);
  const results = group(host, 'wb-results');
  async function query(action) {
    const { area, ...source } = activeSource();
    results.replaceChildren();
    const items = await call('lsp:query', { ...source, action });
    for (const item of items) {
      if (action !== 'fixes') {
        task(results, `${basename(item.file)}:${item.line}:${item.column}`, () => jump(item.file, item.line, item.column));
        results.lastChild.title = item.file;
        continue;
      }
      const changes = item.edit;
      const supported = changes?.length && changes.every(({ file, text }) => file === source.file && text === source.text);
      const control = task(results, item.title, () => {
        const latest = activeSource();
        if (latest.file !== source.file || latest.text !== source.text) throw new Error(tr('The document changed. Request the fixes again.', 'Файл изменился. Запросите исправления снова.'));
        const updated = replaceRanges(source.text, changes.flatMap(({ edits }) => edits));
        area.value = updated;
        area.dispatchEvent(new Event('input', { bubbles: true }));
        results.replaceChildren();
        return tr('Fix applied to the editor.', 'Исправление применено в редакторе.');
      });
      if (item.disabled || !supported) {
        control.disabled = true;
        control.title = item.disabled || tr('This fix needs a command or changes to another file.', 'Для исправления нужна команда или правка другого файла.');
      }
    }
    if (!items.length) return tr('Nothing found at the cursor.', 'У курсора ничего не найдено.');
    if (action === 'definition' && items.length === 1) await jump(items[0].file, items[0].line, items[0].column);
  }
  for (const [action, label] of [['definition', tr('Definition', 'Определение')], ['references', tr('Find usages', 'Найти использования')], ['fixes', tr('Quick fixes', 'Быстрые исправления')]]) {
    task(actions, label, () => query(action)).dataset.query = action;
  }
}

function paintBreakpoints() {
  for (const [id, index] of [['line-numbers', state.activeTabIndex], ['line-numbers-right', state.rightTabIndex]]) {
    const gutter = document.getElementById(id);
    if (!gutter) continue;
    const file = state.currentTabs[index]?.filePath;
    for (const old of gutter.querySelectorAll('.wb-breakpoint')) old.classList.remove('wb-breakpoint');
    for (const line of breakpoints.get(file) || []) gutter.children[line - 1]?.classList.add('wb-breakpoint');
  }
}

function debugUi(host) {
  const cmd = field(host, tr('Debug adapter command (JSON array)', 'Команда адаптера отладки (массив JSON)'), { value: '["python3","-m","debugpy.adapter"]' });
  if (window.electronAPI.platform === 'win32') cmd.value = '["python","-m","debugpy.adapter"]';
  const cfg = field(host, tr('Launch configuration (JSON)', 'Конфигурация запуска (JSON)'), { rows: 5, value: bytes({ type: 'debugpy', request: 'launch', program: '${file}', cwd: '${workspaceFolder}', console: 'internalConsole' }) });
  const toolbar = group(host);
  const pointList = group(host, 'wb-results');
  const stack = group(host, 'wb-results');
  const variables = group(host, 'wb-results');
  const status = element('p', '', 'settings-hint');
  host.append(status);
  const show = output(host);
  let pointStatus = 0;
  let activePause;

  function renderPoints() {
    pointList.replaceChildren();
    for (const [file, points] of breakpoints) {
      for (const line of points) {
        const row = group(pointList);
        task(row, `${basename(file)}:${line}`, () => jump(file, line));
        task(row, tr('Remove', 'Убрать'), () => togglePoint(file, line));
      }
    }
    paintBreakpoints();
  }

  async function togglePoint(file, line) {
    const list = new Set(breakpoints.get(file) || []);
    if (list.has(line)) list.delete(line); else list.add(line);
    const sorted = [...list].sort((a, b) => a - b);
    if (sorted.length) breakpoints.set(file, sorted); else breakpoints.delete(file);
    renderPoints();
    if (debugConnected) {
      const id = ++pointStatus;
      const result = await call('dap:action', { action: 'breakpoints', file, lines: sorted });
      if (id === pointStatus && result?.some(({ verified }) => !verified)) return tr('The adapter has not verified some breakpoints.', 'Адаптер пока не подтвердил некоторые точки останова.');
    }
  }

  task(toolbar, tr('Start debugging', 'Начать отладку'), async () => {
    const { file, root } = activeSource();
    const command = JSON.parse(cmd.value);
    const config = object(cfg.value);
    const folder = root || file.replace(/[\\/][^\\/]+$/, '') || undefined;
    const substitute = (value) => {
      if (typeof value === 'string') return value.replace(/\$\{(file|workspaceFolder)\}/g, (_, key) => key === 'file' ? file : folder || '');
      if (Array.isArray(value)) return value.map(substitute);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item)]));
      return value;
    };
    debugConnected = false;
    activePause = undefined;
    debugStatus = null;
    await call('dap:start', { command, root: folder, config: substitute(config), breakpoints: Object.fromEntries(breakpoints) });
    debugConnected = debugStatus?.state !== 'ended';
    if (debugStatus?.state === 'paused') renderStack();
  }, true);
  task(toolbar, tr('Stop', 'Остановить'), async () => {
    await call('disconnect', { key: 'dap' });
    debugConnected = false;
  });
  task(toolbar, tr('Toggle breakpoint (F9)', 'Точка останова (F9)'), () => {
    const { file, position } = activeSource();
    return togglePoint(file, position.line + 1);
  }).dataset.breakpointToggle = 'true';
  const steps = group(host);
  for (const [action, label] of [
    ['continue', tr('Continue', 'Продолжить')], ['pause', tr('Pause', 'Пауза')],
    ['next', tr('Step over', 'Шаг через')], ['stepIn', tr('Step in', 'Шаг внутрь')], ['stepOut', tr('Step out', 'Шаг наружу')],
  ]) task(steps, label, async () => { await call('dap:action', { action }); });
  host.append(pointList, stack, variables, status);
  // Keep the debug log below the current stack and variables.
  host.append(host.querySelector('.wb-output'));

  async function renderVariables(reference, node, generation) {
    const list = await call('dap:action', { action: 'variables', reference });
    if (generation !== debugGeneration) return;
    node.replaceChildren();
    for (const item of list) {
      const caption = `${item.name} = ${item.value}`;
      if (item.variablesReference) {
        const detail = element('div', null, 'wb-results wb-nested');
        task(node, caption, () => renderVariables(item.variablesReference, detail, generation));
        node.append(detail);
      } else node.append(element('code', caption));
    }
  }

  async function renderStack() {
    const generation = ++debugGeneration;
    const frames = await call('dap:action', { action: 'stack' }).catch((error) => {
      if (generation === debugGeneration) status.textContent = error.message;
      return [];
    });
    if (generation !== debugGeneration) return;
    stack.replaceChildren(element('strong', tr('Call stack', 'Стек вызовов')));
    for (const frame of frames) {
      task(stack, `${frame.name} · ${frame.source?.name || ''}:${frame.line}`, async () => {
        if (frame.source?.path) await jump(frame.source.path, frame.line, frame.column);
        const scopes = await call('dap:action', { action: 'scopes', frame: frame.id });
        if (generation !== debugGeneration) return;
        variables.replaceChildren(element('strong', tr('Variables', 'Переменные')));
        for (const scope of scopes) {
          const detail = element('div', null, 'wb-results wb-nested');
          task(variables, scope.name, () => renderVariables(scope.variablesReference, detail, generation));
          variables.append(detail);
          if (!scope.expensive) await renderVariables(scope.variablesReference, detail, generation);
        }
      });
    }
  }
  renderPoints();
  return {
    togglePoint,
    update(snapshot) {
      const labels = { starting: tr('Starting…', 'Запуск…'), running: tr('Running', 'Выполняется'), paused: tr('Paused', 'Приостановлено'), ended: tr('Ended', 'Завершено') };
      status.textContent = [labels[snapshot.state], snapshot.reason].filter(Boolean).join(' · ');
      show(snapshot.output);
      if (snapshot.state === 'paused') {
        if (activePause !== snapshot.thread) {
          activePause = snapshot.thread;
          if (debugConnected) renderStack();
        }
      } else {
        activePause = undefined;
        debugGeneration++;
        stack.replaceChildren();
        variables.replaceChildren();
      }
    },
  };
}

function mcpUi(host) {
  const cmd = field(host, tr('MCP server command (JSON array, stdio)', 'Команда MCP-сервера (массив JSON, stdio)'), { placeholder: '["node","/path/to/server.js"]' });
  const actions = group(host);
  const tool = field(host, tr('Tool', 'Инструмент'), { options: [] });
  const describe = output(host);
  const args = field(host, tr('Arguments (JSON)', 'Аргументы (JSON)'), { rows: 4, value: '{}' });
  const result = output(host);
  let last;
  let tools = [];
  const toolChanged = () => {
    const info = tools.find(({ name }) => name === tool.value);
    describe(info ? [info.description, bytes(info.inputSchema)].filter(Boolean).join('\n\n') : '');
  };
  tool.addEventListener('change', toolChanged);
  async function list() {
    tools = await call('mcp:list');
    tool.replaceChildren(...tools.map((entry) => new Option(entry.title || entry.name, entry.name)));
    toolChanged();
    return tr(`Tools available: ${tools.length}`, `Доступно инструментов: ${tools.length}`);
  }
  task(actions, tr('Connect', 'Подключить'), async () => {
    await call('mcp:start', { command: JSON.parse(cmd.value), root: state.currentFolder });
    return list();
  }, true);
  task(actions, tr('Refresh', 'Обновить'), list);
  task(actions, tr('Disconnect', 'Отключить'), async () => {
    await call('disconnect', { key: 'mcp' });
    tools = [];
    tool.replaceChildren();
    toolChanged();
  });
  const invoke = group(host);
  task(invoke, tr('Run selected tool', 'Выполнить выбранный инструмент'), async () => {
    if (!tool.value) throw new Error(tr('Select a tool first.', 'Сначала выберите инструмент.'));
    const input = object(args.value);
    last = null;
    result('');
    const name = tool.value;
    const value = await call('mcp:call', { tool: name, args: input });
    const content = (value?.content || []).filter((entry) => entry.type === 'text').map((entry) => entry.text).join('\n');
    const text = content || (value?.structuredContent != null ? bytes(value.structuredContent) : '');
    result(text || tr('The tool returned no text.', 'Инструмент не вернул текст.'));
    if (text && !value?.isError) last = { name: `MCP · ${name}`, content: text.slice(0, 16000), truncated: text.length > 16000 };
    return value?.isError ? tr('The tool returned an error.', 'Инструмент вернул ошибку.') : tr('Tool finished.', 'Инструмент завершил работу.');
  }, true);
  task(invoke, tr('Attach result to AI chat', 'Прикрепить результат к AI-чату'), () => {
    if (!last) return tr('Run a tool that returns text first.', 'Сначала выполните инструмент, который возвращает текст.');
    addContextFiles([last]);
    if (!state.chatVisible) toggleChat();
    hideWorkbench({ restoreFocus: false });
    document.getElementById('user-input')?.focus();
  });
}

function databaseUi(host) {
  const kind = field(host, tr('Database engine', 'СУБД'), { options: [['sqlite', 'SQLite'], ['postgres', 'PostgreSQL']] });
  const sqlite = element('div', null, 'wb-db-connection');
  const postgres = element('div', null, 'wb-db-connection');
  host.append(sqlite, postgres);
  postgres.hidden = true;
  const pgHost = field(postgres, tr('Host', 'Хост'), { value: 'localhost' });
  const port = field(postgres, tr('Port', 'Порт'), { value: '5432' });
  const database = field(postgres, tr('Database', 'База'), { placeholder: 'postgres' });
  const user = field(postgres, tr('User', 'Пользователь'));
  const password = field(postgres, tr('Password', 'Пароль'), { type: 'password' });
  const picked = element('p', tr('No SQLite file selected.', 'Файл SQLite не выбран.'), 'settings-hint');
  let file;
  task(group(sqlite), tr('Open SQLite database', 'Открыть базу SQLite'), async () => {
    const next = await call('db:file');
    if (next) { file = next; picked.textContent = file; }
  });
  sqlite.append(picked);
  const sql = field(host, 'SQL', { rows: 6, value: "SELECT name, type FROM sqlite_schema WHERE type IN ('table','view') ORDER BY name;" });
  const actions = group(host);
  const show = output(host);
  const results = group(host, 'wb-results');
  kind.addEventListener('change', () => {
    sqlite.hidden = kind.value !== 'sqlite';
    postgres.hidden = kind.value !== 'postgres';
    sql.value = kind.value === 'sqlite'
      ? "SELECT name, type FROM sqlite_schema WHERE type IN ('table','view') ORDER BY name;"
      : "SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema = 'public';";
    results.replaceChildren();
    show('');
  });
  function draw(raw) {
    results.replaceChildren();
    show('');
    let data;
    try { data = JSON.parse(raw); } catch { show(raw || tr('Query completed.', 'Запрос выполнен.')); return; }
    if (!Array.isArray(data) || !data.length) { show(raw || '[]'); return; }
    const table = element('table', null, 'wb-table');
    const heading = table.createTHead().insertRow();
    const columns = Object.keys(data[0]);
    for (const name of columns) heading.append(element('th', name));
    const rows = table.createTBody();
    for (const item of data.slice(0, 200)) {
      const row = rows.insertRow();
      for (const column of columns) row.insertCell().textContent = item[column] == null ? 'NULL' : String(item[column]);
    }
    results.append(table);
    if (data.length > 200) show(tr(`Showing 200 of ${data.length} rows.`, `Показано 200 из ${data.length} строк.`));
  }
  async function execute(write) {
    if (kind.value === 'sqlite' && !file) throw new Error(tr('Choose a database file.', 'Выберите файл базы данных.'));
    if (write && !window.confirm(tr('Allow this query to modify the database?', 'Разрешить запросу изменить базу данных?'))) return;
    if (kind.value === 'sqlite') draw(await call('db:query', { file, sql: sql.value, write }));
    else {
      const connection = { host: pgHost.value.trim(), port: port.value.trim(), database: database.value.trim(), user: user.value.trim(), password: password.value };
      results.replaceChildren();
      show(await call('db:postgres', { connection, sql: sql.value, write }));
    }
  }
  const read = task(actions, tr('Run read-only', 'Выполнить только чтение'), () => execute(false), true);
  kind.addEventListener('change', () => {
    read.textContent = kind.value === 'sqlite' ? tr('Run read-only', 'Выполнить только чтение') : tr('Run with read-only default', 'Запрос в режиме чтения');
  });
  task(actions, tr('Run with writes', 'Выполнить с записью'), () => execute(true));
}

function remoteUi(host) {
  const kind = field(host, tr('Connection', 'Подключение'), { options: [['ssh', 'SSH / rsync'], ['docker', 'Docker']] });
  const server = field(host, tr('SSH host or container', 'Хост SSH или контейнер'), { placeholder: 'dev-server' });
  const remotePath = field(host, tr('Remote project path', 'Путь к удалённому проекту'), { placeholder: '/workspace/my-project' });
  const name = field(host, tr('Local folder name', 'Имя локальной папки'), { placeholder: 'my-project' });
  const actions = group(host);
  const hint = element('p', tr('Uses SSH keys and known hosts, or a running Docker container.', 'Использует SSH-ключи и известные хосты либо запущенный контейнер Docker.'), 'settings-hint');
  host.append(hint);
  const storageKey = 'frogee.workbench.remote';
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
  } catch {}
  function showSaved() {
    if (saved) hint.textContent = `${saved.host}:${saved.remotePath} ↔ ${saved.local}`;
  }
  if (saved) {
    kind.value = saved.kind;
    server.value = saved.host;
    remotePath.value = saved.remotePath;
    name.value = saved.name;
    showSaved();
  }
  task(actions, tr('Open local copy', 'Открыть локальную копию'), async () => {
    const target = { kind: kind.value, host: server.value.trim(), remotePath: remotePath.value.trim(), name: name.value.trim() };
    const local = await call('remote:clone', target);
    if (!local) return;
    saved = { ...target, local };
    try { localStorage.setItem(storageKey, JSON.stringify(saved)); } catch {}
    showSaved();
    await loadFolderContents(local);
  }, true);
  for (const [push, label] of [[false, tr('Pull changes', 'Получить файлы')], [true, tr('Push changes', 'Отправить файлы')]]) {
    task(actions, label, async () => {
      const local = saved?.local;
      if (!local || state.currentFolder !== local) throw new Error(tr('Open the local copy first.', 'Сначала откройте локальную копию.'));
      if (state.currentTabs.some((tab) => tab.modified && tab.filePath && tab.filePath.replaceAll('\\', '/').startsWith(local.replaceAll('\\', '/') + '/'))) {
        throw new Error(tr('Save changes in this project before syncing.', 'Сохраните изменения в проекте перед синхронизацией.'));
      }
      if (!window.confirm(push ? tr('Overwrite matching files in the remote project?', 'Перезаписать совпадающие файлы удалённого проекта?') : tr('Overwrite matching local files with remote copies?', 'Перезаписать совпадающие локальные файлы удалёнными копиями?'))) return;
      await call('remote:sync', { ...saved, push });
      if (!push) await refreshExplorerTree();
      return tr('Transfer complete.', 'Передача завершена.');
    });
  }
}

const tools = [
  ['project', 'New project', 'Новый проект', projectUi],
  ['http', 'HTTP client', 'HTTP-клиент', httpUi],
  ['lsp', 'Code navigation', 'Навигация по коду', lspUi],
  ['dap', 'Debugger', 'Отладчик', debugUi],
  ['mcp', 'MCP tools', 'Инструменты MCP', mcpUi],
  ['database', 'Databases', 'Базы данных', databaseUi],
  ['remote', 'Remote projects', 'Удалённые проекты', remoteUi],
];
let debugUiApi;

export function workbenchCommands() {
  return tools.map(([key, en, ru]) => ({ label: tr(en, ru), run: () => openWorkbench(key) }));
}

function hideWorkbench({ restoreFocus = true } = {}) {
  if (!dock || dock.hidden) return;
  dock.hidden = true;
  trigger.classList.remove('active');
  trigger.setAttribute('aria-expanded', 'false');
  if (restoreFocus) {
    const origin = returnFocus?.isConnected && returnFocus.getClientRects().length ? returnFocus : trigger;
    origin.focus({ preventScroll: true });
  }
  returnFocus = null;
}

export function openWorkbench(key = current || 'project', preserveFocus = false) {
  const selected = sections.get(key);
  if (!dock || !selected) return;
  if (dock.hidden && !dock.contains(document.activeElement)) returnFocus = document.activeElement;
  current = key;
  dock.hidden = false;
  fitDock();
  trigger.classList.add('active');
  trigger.setAttribute('aria-expanded', 'true');
  for (const [name, { panel, tab }] of sections) {
    const active = name === key;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    tab.classList.toggle('active', active);
    panel.hidden = !active;
  }
  if (!preserveFocus) selected.tab.focus({ preventScroll: true });
}

function configureDock(dock, grip, placement, workspace, toolbar, localize) {
  const layoutKey = 'frogee.workbench.layout.v1';
  let preference;
  try { preference = JSON.parse(localStorage.getItem(layoutKey) || '{}'); } catch {}
  const sizing = {
    preferred: preference?.preferred === 'bottom' ? 'bottom' : 'right',
    right: Number.isFinite(preference?.right) ? preference.right : 380,
    bottom: Number.isFinite(preference?.bottom) ? preference.bottom : 285,
  };
  const remember = () => {
    try { localStorage.setItem(layoutKey, JSON.stringify(sizing)); } catch {}
  };
  const siblings = ['activity-panel', 'activity-resizer', 'chat-panel', 'chat-resizer']
    .map((id) => document.getElementById(id)).filter(Boolean);
  let direction;
  let limit;
  function fit() {
    if (dock.hidden) return;
    const occupied = siblings.reduce((sum, item) => sum + item.offsetWidth, 0);
    const spare = toolbar.clientWidth - occupied - 36;
    direction = sizing.preferred === 'bottom' || spare < 650 ? 'bottom' : 'right';
    const anchor = direction === 'right' ? toolbar : workspace;
    if (dock.parentElement !== anchor) {
      const focused = dock.contains(document.activeElement) ? document.activeElement : null;
      if (direction === 'right') anchor.append(dock);
      else toolbar.after(dock);
      focused?.focus({ preventScroll: true });
    }
    limit = direction === 'right' ? Math.min(600, spare - 340) : Math.max(150, Math.floor(workspace.clientHeight * 0.52));
    const min = direction === 'right' ? 300 : 150;
    const value = Math.min(limit, Math.max(min, sizing[direction]));
    dock.dataset.placement = direction;
    dock.style.setProperty('--wb-size', `${value}px`);
    placement.setAttribute('aria-pressed', String(sizing.preferred === 'bottom'));
    grip.setAttribute('aria-orientation', direction === 'right' ? 'vertical' : 'horizontal');
    grip.setAttribute('aria-valuemin', min);
    grip.setAttribute('aria-valuemax', limit);
    grip.setAttribute('aria-valuenow', value);
    localize(sizing.preferred);
  }
  placement.addEventListener('click', () => {
    sizing.preferred = sizing.preferred === 'right' ? 'bottom' : 'right';
    fit();
    remember();
  });
  grip.addEventListener('keydown', (event) => {
    const larger = direction === 'right' ? 'ArrowLeft' : 'ArrowUp';
    const smaller = direction === 'right' ? 'ArrowRight' : 'ArrowDown';
    if (![larger, smaller].includes(event.key)) return;
    event.preventDefault();
    sizing[direction] = Number(grip.getAttribute('aria-valuenow')) + (event.key === larger ? 24 : -24);
    fit();
    sizing[direction] = Number(grip.getAttribute('aria-valuenow'));
    remember();
  });
  let drag;
  grip.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const axis = direction === 'right' ? 'clientX' : 'clientY';
    drag = { axis, direction, from: event[axis], size: Number(grip.getAttribute('aria-valuenow')) };
    grip.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  grip.addEventListener('pointermove', (event) => {
    if (!drag || drag.direction !== direction) return;
    sizing[direction] = drag.size + drag.from - event[drag.axis];
    fit();
  });
  grip.addEventListener('lostpointercapture', () => {
    if (!drag) return;
    sizing[direction] = Number(grip.getAttribute('aria-valuenow'));
    drag = null;
    remember();
  });
  const observer = new ResizeObserver(fit);
  observer.observe(workspace);
  siblings.forEach((item) => observer.observe(item));
  return fit;
}

export function setupWorkbench() {
  if (dock) return;
  const workspace = document.getElementById('workspace');
  const toolbar = document.getElementById('workspace-main');
  if (!workspace || !toolbar) return;
  dock = element('aside', null, 'workbench panel-bubble');
  dock.id = 'developer-workbench';
  dock.hidden = true;
  const grip = element('div', null, 'wb-grip');
  grip.setAttribute('role', 'separator');
  grip.tabIndex = 0;
  dock.append(grip);
  const header = group(dock, 'wb-header');
  const title = element('strong', tr('Developer tools', 'Инструменты разработки'));
  const headerActions = group(header);
  const placement = button('', () => {}, 'settings-btn ghost wb-placement');
  const close = button('', () => hideWorkbench(), 'activity-btn');
  close.innerHTML = icon('close', 16);
  header.prepend(title);
  headerActions.append(placement, close);
  const tabs = group(dock, 'wb-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.addEventListener('keydown', (event) => {
    const keys = [...sections.keys()];
    const index = keys.indexOf(current);
    const next = { Home: 0, End: keys.length - 1, ArrowLeft: (index + keys.length - 1) % keys.length, ArrowRight: (index + 1) % keys.length }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    openWorkbench(keys[next]);
  });
  for (const [key, en, ru, setup] of tools) {
    const tab = button(tr(en, ru), () => openWorkbench(key), 'settings-nav-btn');
    tab.id = `wb-tab-${key}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', 'false');
    tab.setAttribute('aria-controls', `wb-panel-${key}`);
    tab.tabIndex = -1;
    tabs.append(tab);
    const panel = element('section', null, 'wb-section');
    panel.id = `wb-panel-${key}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
    panel.hidden = true;
    const status = element('p', '', 'wb-status');
    status.setAttribute('role', 'status');
    const api = setup(panel);
    if (key === 'dap') debugUiApi = api;
    panel.append(status);
    dock.append(panel);
    sections.set(key, { panel, tab, en, ru });
  }
  trigger = button('', () => dock.hidden ? openWorkbench() : hideWorkbench(), 'sidebar-btn');
  trigger.setAttribute('aria-controls', dock.id);
  trigger.setAttribute('aria-expanded', 'false');
  trigger.innerHTML = icon('window', 20);
  const chatButton = button('MCP', () => openWorkbench('mcp'), 'chat-header-btn wb-mcp');
  const localizeChrome = () => {
    title.textContent = tr('Developer tools', 'Инструменты разработки');
    dock.setAttribute('aria-label', title.textContent);
    tabs.setAttribute('aria-label', title.textContent);
    trigger.title = title.textContent;
    trigger.setAttribute('aria-label', title.textContent);
    close.setAttribute('aria-label', tr('Close developer tools', 'Закрыть инструменты'));
    close.title = close.getAttribute('aria-label');
    grip.setAttribute('aria-label', tr('Resize developer tools', 'Изменить размер панели инструментов'));
    chatButton.title = tr('MCP tools', 'Инструменты MCP');
    for (const { tab, en, ru } of sections.values()) tab.textContent = tr(en, ru);
  };
  const localizePlacement = (preference) => {
    placement.textContent = preference === 'bottom' ? tr('Bottom', 'Снизу') : tr('Right', 'Справа');
    placement.title = preference === 'bottom' ? tr('Prefer docking on the right', 'Закреплять справа') : tr('Dock at the bottom', 'Закрепить снизу');
  };
  toolbar.append(dock);
  fitDock = configureDock(dock, grip, placement, workspace, toolbar, localizePlacement);
  localizeChrome();
  onLangChange(() => { localizeChrome(); fitDock(); });
  document.getElementById('extensions-btn')?.after(trigger);
  document.querySelector('.chat-header-right')?.prepend(chatButton);
  const welcome = button('', () => openWorkbench('project'), 'action-item wb-welcome-action');
  const welcomeIcon = element('span', null, 'action-icon');
  welcomeIcon.innerHTML = icon('folder', 18);
  const welcomeLabel = element('span', null, 'action-title');
  const setWelcomeLabel = () => { welcomeLabel.textContent = tr('New project from a template', 'Новый проект из шаблона'); };
  setWelcomeLabel();
  welcome.append(welcomeIcon, welcomeLabel);
  document.getElementById('new-file-action')?.after(welcome);
  onLangChange(setWelcomeLabel);
  dock.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close.click();
  });
  window.electronAPI.onWorkbenchDebug((snapshot) => {
    debugStatus = snapshot;
    if (snapshot.state === 'ended') debugConnected = false;
    debugUiApi.update(snapshot);
  });
  document.addEventListener('keydown', (event) => {
    if (!['editor', 'editor-right'].includes(event.target?.id)) return;
    if (event.key === 'F9') {
      event.preventDefault();
      openWorkbench('dap', true);
      sections.get('dap').panel.querySelector('[data-breakpoint-toggle]').click();
    }
    if (event.key === 'F12') {
      event.preventDefault();
      openWorkbench('lsp', true);
      sections.get('lsp').panel.querySelector('[data-query=definition]').click();
    }
  });
  let gutterFrame;
  window.addEventListener('frogee:content', () => {
    if (gutterFrame) return;
    gutterFrame = requestAnimationFrame(() => { gutterFrame = null; paintBreakpoints(); });
  });
  for (const id of ['line-numbers', 'line-numbers-right']) {
    document.getElementById(id)?.addEventListener('dblclick', (event) => {
      const line = Number(event.target.closest('.line-number')?.textContent);
      const index = id === 'line-numbers' ? state.activeTabIndex : state.rightTabIndex;
      const tab = state.currentTabs[index];
      if (!line || !isEditorTab(tab) || !tab.filePath) return;
      openWorkbench('dap', true);
      debugUiApi.togglePoint(tab.filePath, line).catch((error) => {
        sections.get('dap').panel.querySelector('.wb-status').textContent = error.message;
      });
    });
  }
}
