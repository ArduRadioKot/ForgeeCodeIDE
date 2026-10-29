/**
 * Run configurations: named launch settings per project (command, folder, environment variables, own terminal tab).
 * F5 and the run button start the selected configuration; without one they run the current file as before.
 */
import { state } from './state.js';
import { saveAllConfig } from './save-hook.js';
import { escapeHtml, pathUtils } from './utils.js';
import { icon } from './glyphs.js';
import { runInNamedTerminal } from './terminal.js';
import { getLang, onLangChange } from './i18n.js';

const keyOf = () => state.currentFolder || '';
const isWin = () => /^Win/i.test(navigator.platform);
const uid = () => `rc${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function listConfigs() {
  return (state.runConfigs ||= {})[keyOf()] || [];
}

export function selectedConfig() {
  const id = (state.runSelected ||= {})[keyOf()];
  return listConfigs().find((c) => c.id === id) || null;
}

function setConfigs(list) {
  (state.runConfigs ||= {})[keyOf()] = list;
  saveAllConfig();
}

function select(id) {
  (state.runSelected ||= {})[keyOf()] = id;
  saveAllConfig();
  refreshRunButton();
}

// ───────────────────────── running ─────────────────────────

function resolveVariables(text) {
  const tab = state.currentTabs[state.activeTabIndex];
  const file = tab?.filePath || '';
  const dir = file ? file.replace(/[\\/][^\\/]*$/, '') : '';
  const name = file ? pathUtils.basename(file) : (tab?.name || '');
  const project = state.currentFolder || '';
  const map = {
    file, fileDir: dir, fileName: name, fileBase: name.replace(/\.[^.]*$/, ''),
    project, projectName: project ? pathUtils.basename(project) : '',
  };
  return String(text || '').replace(/\$\{(\w+)\}/g, (m, k) => (k in map ? map[k] : m));
}

const posixQuote = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;

function envPrefix(envText) {
  const pairs = String(envText || '').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && l.includes('=')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i).trim(), resolveVariables(l.slice(i + 1).trim())];
  }).filter(([k]) => /^[A-Za-z_]\w*$/.test(k));
  if (!pairs.length) return '';
  return isWin() ? pairs.map(([k, v]) => `set "${k}=${v}"`).join(' && ') + ' && ' : pairs.map(([k, v]) => `export ${k}=${posixQuote(v)}`).join(' && ') + ' && ';
}

export async function runConfig(cfg) {
  if (!cfg || !String(cfg.command || '').trim()) { openRunConfigDialog(cfg); return false; }
  const tab = state.currentTabs[state.activeTabIndex];
  if (/\$\{file/.test(cfg.command) && tab?.modified && tab.filePath) { const { saveFile } = await import('./editor.js'); await saveFile(); }
  if (/\$\{file\}/.test(cfg.command) && !tab?.filePath) { alert(getLang() === 'en' ? 'This configuration needs a saved file. Open a file or save the current one.' : 'Для этой конфигурации нужен сохранённый файл: откройте файл или сохраните текущий.'); return false; }
  let cwd = resolveVariables(cfg.cwd || '').trim();
  const base = state.currentFolder || (tab?.filePath ? tab.filePath.replace(/[\\/][^\\/]*$/, '') : '');
  if (cwd && !/^([a-zA-Z]:)?[\\/]/.test(cwd) && base) cwd = `${base}${/[\\/]$/.test(base) ? '' : '/'}${cwd}`;
  if (!cwd) cwd = base;
  const command = envPrefix(cfg.env) + resolveVariables(cfg.command);
  await runInNamedTerminal(cfg.separate === false ? '' : cfg.id, cfg.name || 'Запуск', command, cwd);
  return true;
}

/** F5 / run button: the selected configuration if there is one. Returns false when the caller should run the file. */
export async function runSelectedConfig() {
  const cfg = selectedConfig();
  if (!cfg) return false;
  return runConfig(cfg);
}

export function refreshRunButton() {
  const btn = document.getElementById('run-file-btn');
  if (!btn) return;
  const cfg = selectedConfig();
  btn.title = cfg ? (getLang() === 'en' ? `Run “${cfg.name}” (F5)` : `Запустить «${cfg.name}» (F5)`) : (getLang() === 'en' ? 'Run file (F5)' : 'Запустить файл (F5)');
}

// ───────────────────────── dialog ─────────────────────────

const PRESETS = [
  ['npm start', 'npm start'], ['npm run dev', 'npm run dev'], ['Python', 'python3 "${file}"'], ['Node', 'node "${file}"'],
  ['Go', 'go run .'], ['Cargo', 'cargo run'], ['Make', 'make'],
];

let dialog = null;

function closeDialog() { dialog?.remove(); dialog = null; }

export function openRunConfigDialog(existing) {
  closeDialog();
  const cfg = existing ? { ...existing } : { id: uid(), name: '', command: '', cwd: '', env: '', separate: true };
  const isNew = !listConfigs().some((c) => c.id === cfg.id);
  dialog = document.createElement('div');
  dialog.className = 'modal-overlay rc-overlay';
  dialog.style.display = 'flex';
  dialog.innerHTML = `
    <div class="modal-window rc-dialog" role="dialog" aria-label="Конфигурация запуска">
      <div class="rc-head"><h2>${isNew ? 'Новая конфигурация запуска' : 'Конфигурация запуска'}</h2><button type="button" class="icon-btn" data-rc="close" title="Закрыть">${icon('close', 14)}</button></div>
      <div class="rc-body">
        <label class="rc-field"><span>Название</span><input type="text" data-f="name" placeholder="Например, Сервер разработки" spellcheck="false"></label>
        <label class="rc-field"><span>Команда</span><input type="text" data-f="command" placeholder="Что выполнить в терминале" spellcheck="false">
          <small>Можно использовать: <code>\${file}</code> текущий файл, <code>\${fileDir}</code> его папка, <code>\${fileName}</code>, <code>\${fileBase}</code> имя без расширения, <code>\${project}</code> папка проекта</small></label>
        <div class="rc-presets">${PRESETS.map(([l, c], i) => `<button type="button" data-preset="${i}" title="${escapeHtml(c)}">${escapeHtml(l)}</button>`).join('')}</div>
        <label class="rc-field"><span>Рабочая папка</span><input type="text" data-f="cwd" placeholder="Пусто - папка проекта; можно относительный путь" spellcheck="false"></label>
        <label class="rc-field"><span>Переменные окружения</span><textarea data-f="env" rows="3" placeholder="PORT=3000&#10;NODE_ENV=development" spellcheck="false"></textarea></label>
        <label class="rc-check"><input type="checkbox" data-f="separate"><span>Запускать в отдельной вкладке терминала (повторный запуск использует её же)</span></label>
      </div>
      <div class="rc-foot">
        ${isNew ? '' : '<button type="button" class="rc-danger" data-rc="delete">Удалить</button>'}
        <span class="rc-grow"></span>
        <button type="button" data-rc="close">Отмена</button>
        <button type="button" data-rc="save-run">Сохранить и запустить</button>
        <button type="button" class="primary" data-rc="save">Сохранить</button>
      </div>
    </div>`;
  document.body.appendChild(dialog);
  const field = (n) => dialog.querySelector(`[data-f="${n}"]`);
  field('name').value = cfg.name || '';
  field('command').value = cfg.command || '';
  field('cwd').value = cfg.cwd || '';
  field('env').value = cfg.env || '';
  field('separate').checked = cfg.separate !== false;
  const read = () => ({ ...cfg, name: field('name').value.trim() || field('command').value.trim().split(/\s+/)[0] || 'Конфигурация', command: field('command').value.trim(), cwd: field('cwd').value.trim(), env: field('env').value, separate: field('separate').checked });
  const save = () => {
    const next = read();
    if (!next.command) { field('command').focus(); return null; }
    const list = listConfigs().slice();
    const at = list.findIndex((c) => c.id === next.id);
    if (at >= 0) list[at] = next; else list.push(next);
    setConfigs(list);
    select(next.id);
    closeDialog();
    renderPanel();
    return next;
  };
  dialog.addEventListener('mousedown', (e) => { if (e.target === dialog) closeDialog(); });
  dialog.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeDialog(); } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(); });
  dialog.addEventListener('click', (e) => {
    const preset = e.target.closest('[data-preset]');
    if (preset) { field('command').value = PRESETS[Number(preset.dataset.preset)][1]; if (!field('name').value) field('name').value = PRESETS[Number(preset.dataset.preset)][0]; field('command').focus(); return; }
    const act = e.target.closest('[data-rc]')?.dataset.rc;
    if (act === 'close') closeDialog();
    else if (act === 'save') save();
    else if (act === 'save-run') { const next = save(); if (next) runConfig(next); }
    else if (act === 'delete') {
      if (!confirm(getLang() === 'en' ? `Delete configuration “${cfg.name}”?` : `Удалить конфигурацию «${cfg.name}»?`)) return;
      setConfigs(listConfigs().filter((c) => c.id !== cfg.id));
      if (selectedConfig() === null) select('');
      closeDialog();
      renderPanel();
    }
  });
  field('name').focus();
}

// ───────────────────────── run panel ─────────────────────────

function renderPanel() {
  const box = document.getElementById('run-configs');
  if (!box) return;
  const list = listConfigs();
  const current = selectedConfig();
  box.innerHTML = list.length
    ? list.map((c) => `<div class="run-item run-cfg${current && c.id === current.id ? ' selected' : ''}" data-cfg="${c.id}" tabindex="0">
        <button type="button" class="run-play" data-act="run" title="Запустить">${icon('play', 11)}</button>
        <span class="run-name" title="${escapeHtml(c.command)}">${escapeHtml(c.name)}</span>
        <span class="run-cmd">${escapeHtml(c.command).slice(0, 28)}</span>
        <span class="run-cfg-tools"><button type="button" data-act="edit" title="Настроить">${icon('edit', 12)}</button></span>
      </div>`).join('')
    : '<div class="run-empty">Конфигураций нет. Добавьте команду, которую часто запускаете, и запускайте её по F5.</div>';
  refreshRunButton();
}

/** Called by the "Запуск" side panel after it has drawn its markup. */
export function setupRunConfigPanel() {
  const box = document.getElementById('run-configs');
  if (!box) return;
  renderPanel();
  document.getElementById('run-config-add')?.addEventListener('click', () => openRunConfigDialog());
  box.addEventListener('click', (e) => {
    const row = e.target.closest('[data-cfg]');
    if (!row) return;
    const cfg = listConfigs().find((c) => c.id === row.dataset.cfg);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'edit') { openRunConfigDialog(cfg); return; }
    select(cfg.id);
    renderPanel();
    if (act === 'run') runConfig(cfg);
  });
  box.addEventListener('dblclick', (e) => { const row = e.target.closest('[data-cfg]'); if (row && !e.target.closest('[data-act]')) runConfig(listConfigs().find((c) => c.id === row.dataset.cfg)); });
}

/** Entries for the command palette. */
export function configCommands() {
  const en = getLang() === 'en';
  return [
    ...listConfigs().map((c) => ({ label: `${en ? 'Run' : 'Запуск'}: ${c.name}`, detail: c.command, key: '', run: () => { select(c.id); runConfig(c); } })),
    { label: en ? 'Run: new configuration…' : 'Запуск: новая конфигурация…', detail: '', key: '', run: () => openRunConfigDialog() },
    ...(selectedConfig() ? [{ label: en ? 'Run: configure selected…' : 'Запуск: настроить выбранную конфигурацию…', detail: selectedConfig().name, key: '', run: () => openRunConfigDialog(selectedConfig()) }] : []),
  ];
}

onLangChange(renderPanel);
