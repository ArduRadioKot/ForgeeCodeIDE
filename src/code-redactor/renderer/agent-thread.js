import { getLang } from './i18n.js';

const tr = (ru, en) => getLang() === 'en' ? en : ru;
const active = (row) => row.status === 'running' || row.status === 'pending';
const isWork = (row) => row.type === 'thought' || row.type === 'tool';
const viewState = new WeakMap();

function node(tag, name, text) {
  const element = document.createElement(tag);
  element.className = name;
  if (text) element.textContent = text;
  return element;
}

function kindOf(row) {
  const kind = String(row.kind || 'tool').toLowerCase();
  const name = kind === 'tool' ? String(row.label || '').split(/\s/)[0].toLowerCase() : kind;
  if (/file_change|edit|write|delete|patch|strreplace|multiedit/.test(name)) return 'edit';
  if (/command|execute|bash|shell|powershell|terminal/.test(name)) return 'run';
  if (/search|grep|glob|find/.test(name)) return 'search';
  if (/^read|^view/.test(name)) return 'read';
  if (name === 'subagent') return 'subagent';
  return 'tool';
}

function summary(rows) {
  const en = getLang() === 'en';
  const categories = [];
  if (rows.some((row) => row.type === 'thought')) categories.push(en ? 'Reasoning' : 'Рассуждения');
  const tools = rows.filter((row) => row.type === 'tool');
  const names = en ? { read: 'Read', edit: 'Edits', run: 'Commands', search: 'Search', subagent: 'Subagents', tool: 'Other actions' }
    : { read: 'Чтение', edit: 'Правки', run: 'Команды', search: 'Поиск', subagent: 'Субагенты', tool: 'Другие действия' };
  for (const [kind, title] of Object.entries(names)) {
    const count = tools.filter((row) => kindOf(row) === kind).length;
    if (count) categories.push(count === 1 ? title : title + ' ×' + count);
  }
  return categories.join(' · ');
}

function label(row) {
  if (row.type === 'thought') return active(row) ? tr('Рассуждает…', 'Reasoning…') : tr('Рассуждения', 'Reasoning');
  return row.label || {
    edit: tr('Изменение файлов', 'File changes'), run: tr('Команда', 'Command'),
    read: tr('Чтение файла', 'Read file'), search: tr('Поиск', 'Search'),
    subagent: tr('Субагент', 'Subagent'),
  }[kindOf(row)] || tr('Инструмент', 'Tool');
}

function statusText(status) {
  return {
    done: tr('Готово', 'Done'), failed: tr('Ошибка', 'Failed'), running: tr('В процессе', 'Running'),
    pending: tr('Ожидает', 'Waiting'), stopped: tr('Прервано', 'Stopped'),
  }[status] || '';
}

function rowsFrom(source, live) {
  const rows = source.timeline?.length ? source.timeline.slice() : [];
  if (!rows.length) {
    if (source.thinking) rows.push({ type: 'thought', text: source.thinking, status: live && !source.answer ? 'running' : 'done' });
    for (const step of source.activity || []) rows.push({ ...step, type: 'tool' });
  }
  if (source.answer && !rows.some((row) => row.type === 'message')) rows.push({ id: 'answer', type: 'message', text: source.answer });
  if (source.error) rows.push({ id: 'error', type: 'notice', text: source.error, status: 'failed' });
  return rows;
}

function sections(rows) {
  const result = [];
  let group = null;
  for (const [index, row] of rows.entries()) {
    const id = String(row.id ?? index);
    if (isWork(row)) {
      if (!group) { group = { key: 'work:' + id, type: 'work', rows: [] }; result.push(group); }
      group.rows.push({ ...row, key: id });
    } else {
      group = null;
      result.push({ ...row, key: row.type + ':' + id });
    }
  }
  return result;
}

function place(container, elements) {
  elements.forEach((element, index) => {
    if (container.children[index] !== element) container.insertBefore(element, container.children[index] || null);
  });
  while (container.children.length > elements.length) container.lastElementChild.remove();
}

function workRow(entry, row) {
  const content = row.type === 'thought' ? row.text : row.output;
  const expandable = Boolean(content);
  if (!entry || entry.expandable !== expandable) {
    const element = node(expandable ? 'details' : 'div', 'agent-step');
    const heading = expandable ? node('summary', 'agent-step-heading') : node('div', 'agent-step-heading');
    const text = node('span', 'agent-step-title');
    const status = node('span', 'agent-step-state');
    heading.append(node('span', 'agent-step-mark'), text, status);
    element.append(heading);
    const output = expandable ? node(row.type === 'thought' ? 'div' : 'pre', 'agent-step-output') : null;
    if (output) element.append(output);
    if (expandable) element.open = entry ? !!entry.element.open : row.type === 'thought' && active(row);
    entry = { element, text, status, output, expandable, content: undefined };
  }
  const { element, text, status, output } = entry;
  element.dataset.type = row.type;
  element.dataset.status = row.status || 'done';
  text.textContent = label(row);
  text.title = text.textContent;
  status.textContent = Number.isInteger(row.exitCode) && row.exitCode !== 0
    ? tr('Код ' + row.exitCode, 'Exit ' + row.exitCode) : statusText(row.status);
  if (output && entry.content !== content) {
    output.textContent = content;
    entry.content = content;
  }
  return entry;
}

function paintWork(entry, rows, following) {
  if (!entry) {
    const details = node('details', 'agent-run');
    const header = node('summary', 'agent-run-summary');
    const title = node('span', 'agent-run-parts');
    const current = node('span', 'agent-run-now');
    header.append(node('span', 'agent-run-chevron'), title, current);
    const body = node('div', 'agent-run-body');
    details.append(header, body);
    entry = { element: details, title, current, body, children: new Map(), manual: false };
    header.addEventListener('click', () => { entry.manual = true; });
  }
  const running = following ? rows.findLast(active) : null;
  entry.title.textContent = summary(rows);
  entry.current.textContent = running ? label(running) : '';
  entry.current.title = entry.current.textContent;
  entry.current.hidden = !running;
  if (!entry.manual) entry.element.open = following;

  const next = new Map();
  for (const row of rows) next.set(row.key, workRow(entry.children.get(row.key), row));
  place(entry.body, Array.from(next.values(), (item) => item.element));
  entry.children = next;
  return entry;
}

function paintMessage(entry, row, renderAnswer) {
  const element = entry?.element || node('div', row.type === 'message' ? 'msg-body agent-message-body' : 'agent-' + row.type);
  const data = row.type === 'plan' ? JSON.stringify(row.items) : row.text;
  if (entry && entry.data === data) return entry;
  if (row.type === 'message') renderAnswer(element, row.text);
  else if (row.type === 'plan') {
    const heading = node('strong', 'agent-plan-label', tr('План', 'Plan'));
    const items = node('ol', 'agent-plan-items');
    for (const item of row.items) {
      const li = node('li', item.completed ? 'complete' : '', item.text);
      li.setAttribute('aria-label', item.text + (item.completed ? tr(' — выполнено', ' — complete') : ''));
      items.append(li);
    }
    element.replaceChildren(heading, items);
  } else element.textContent = row.text;
  return { element, data };
}

export function paintAgentThread(container, source, { live = false, renderAnswer } = {}) {
  const list = sections(rowsFrom(source, live));
  const previous = viewState.get(container) || new Map();
  const next = new Map();
  list.forEach((section, index) => {
    const entry = previous.get(section.key);
    next.set(section.key, section.type === 'work'
      ? paintWork(entry, section.rows, live && (index === list.length - 1 || section.rows.some(active)))
      : paintMessage(entry, section, renderAnswer));
  });
  place(container, Array.from(next.values(), (item) => item.element));
  viewState.set(container, next);
}
