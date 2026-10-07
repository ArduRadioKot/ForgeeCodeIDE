import { state } from './state.js';
import { getDom } from './dom.js';
import { pathUtils, escapeHtml } from './utils.js';
import { hideWelcomePage, createTab } from './tabs.js';

const dom = getDom();
function ago(unixSeconds) {
  const sec = Math.max(0, Date.now() / 1000 - Number(unixSeconds));
  const units = [[31536000, ['год', 'года', 'лет']], [2592000, ['месяц', 'месяца', 'месяцев']], [86400, ['день', 'дня', 'дней']], [3600, ['час', 'часа', 'часов']], [60, ['минуту', 'минуты', 'минут']]];
  for (const [size, forms] of units) {
    if (sec >= size) {
      const n = Math.floor(sec / size);
      const mod10 = n % 10;
      const mod100 = n % 100;
      const form = mod10 === 1 && mod100 !== 11 ? forms[0] : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? forms[1] : forms[2];
      return `${n} ${form} назад`;
    }
  }
  return 'только что';
}

const STATUS_LABEL = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', untracked: 'U', conflict: '!' };
const STATUS_TITLE = { modified: 'Изменён', added: 'Добавлен', deleted: 'Удалён', renamed: 'Переименован', untracked: 'Новый', conflict: 'Конфликт' };

export function showGitPanel() {
  dom.activityPanel.innerHTML = `
    <div class="activity-header">
      <h3>Git</h3>
      <div class="activity-buttons">
        <button class="activity-btn" id="git-fetch-btn" title="Fetch">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5v8M4.8 7.5 8 10.7l3.2-3.2M3 13h10"/></svg>
        </button>
        <button class="activity-btn" id="git-refresh-btn" title="Обновить">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.8v2.6h-2.6"/></svg>
        </button>
      </div>
    </div>
    <div class="git-panel" id="git-panel-root">
      <div class="git-placeholder">Загрузка…</div>
    </div>
  `;
  document.getElementById('git-refresh-btn')?.addEventListener('click', () => refreshGitPanel());
  document.getElementById('git-fetch-btn')?.addEventListener('click', async () => {
    if (!state.currentFolder) return;
    await window.electronAPI.gitFetch(state.currentFolder);
    refreshGitPanel();
  });
  refreshGitPanel();
}

function message(root, html, error = false) {
  root.innerHTML = `<div class="git-placeholder${error ? ' error' : ''}">${html}</div>`;
}

async function openDiff(cwd, file, staged) {
  const untracked = file.status === 'untracked';
  const res = await window.electronAPI.gitDiff(cwd, file.path, staged, untracked);
  const text = res?.diff?.trim() ? res.diff : 'Нет изменений для показа (бинарный файл или только права доступа).';
  hideWelcomePage();
  createTab(`${pathUtils.basename(file.path)} · ${staged ? 'staged' : 'diff'}.diff`, text, null);
}

async function openFile(cwd, file) {
  const full = pathUtils.join(cwd, file.path);
  const content = await window.electronAPI.getFileContent(full);
  if (content?.success) {
    hideWelcomePage();
    createTab(pathUtils.basename(file.path), content.content, full);
  }
}

export async function refreshGitPanel() {
  const root = document.getElementById('git-panel-root');
  if (!root) return;
  if (!state.currentFolder) {
    message(root, '<p>Откройте папку проекта</p><p class="git-hint">Панель Git работает с любой открытой папкой.</p>');
    return;
  }
  if (!window.electronAPI?.gitStatus) {
    message(root, '<p>Git API недоступен. Полностью перезапустите приложение.</p>', true);
    return;
  }
  try {
    const status = await window.electronAPI.gitStatus(state.currentFolder);
    if (!status || status.success === false) {
      message(root, `<p>${escapeHtml(status?.error || 'Ошибка git')}</p>`, true);
      return;
    }
    if (!status.isRepo) {
      message(root, `<p><strong>${escapeHtml(pathUtils.basename(state.currentFolder))}</strong> — не репозиторий git</p>
        <p class="git-hint">Можно инициализировать репозиторий здесь или работать без git.</p>
        <button class="git-btn primary" id="git-init-btn">Создать репозиторий</button>`);
      document.getElementById('git-init-btn')?.addEventListener('click', async () => {
        const res = await window.electronAPI.gitInit(state.currentFolder);
        if (!res.success) alert(res.error || 'Не удалось выполнить git init');
        refreshGitPanel();
      });
      return;
    }
    renderRepo(root, status);
  } catch (err) {
    message(root, `<p>${escapeHtml(err?.message || String(err))}</p>`, true);
  }
}

function renderRepo(root, status) {
  const cwd = status.cwd;
  const staged = status.files.filter((f) => f.staged);
  const changes = status.files.filter((f) => f.unstaged || f.status === 'untracked');
  const sync = [status.ahead ? `↑${status.ahead}` : '', status.behind ? `↓${status.behind}` : ''].filter(Boolean).join(' ');

  root.innerHTML = `
    <button class="git-branch-row" id="git-branch-btn" title="Сменить ветку">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="6" r="1.5"/><path d="M4.5 5v6M11.5 7.5c0 2.5-2.4 3-7 3.4"/></svg>
      <span class="git-branch">${escapeHtml(status.branch || 'HEAD')}</span>
      ${sync ? `<span class="git-sync">${sync}</span>` : ''}
      <svg class="git-chevron" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m4.5 6.5 3.5 3.5 3.5-3.5"/></svg>
    </button>
    <div class="git-section">
      <textarea id="git-commit-msg" class="git-commit-input" rows="3" placeholder="Сообщение коммита (Ctrl+Enter — закоммитить)"></textarea>
      <div class="git-actions">
        <button class="git-btn primary" id="git-commit-btn" ${staged.length ? '' : 'disabled'}>Закоммитить${staged.length ? ` (${staged.length})` : ''}</button>
        <button class="git-btn" id="git-pull-btn" title="git pull --ff-only">Pull${status.behind ? ` ↓${status.behind}` : ''}</button>
        <button class="git-btn" id="git-push-btn">Push${status.ahead ? ` ↑${status.ahead}` : ''}</button>
      </div>
    </div>
    <div class="git-section">
      <div class="git-section-title"><span>Подготовлено (${staged.length})</span><button class="git-link" id="git-unstage-all" ${staged.length ? '' : 'hidden'}>Убрать все</button></div>
      <div class="git-file-list" id="git-staged-list"></div>
    </div>
    <div class="git-section">
      <div class="git-section-title"><span>Изменения (${changes.length})</span><button class="git-link" id="git-stage-all" ${changes.length ? '' : 'hidden'}>Добавить все</button></div>
      <div class="git-file-list" id="git-changes-list"></div>
    </div>
    <div class="git-section">
      <div class="git-section-title"><span>Последние коммиты</span></div>
      <div class="git-log" id="git-log"></div>
    </div>
    <pre class="git-output" id="git-output" hidden></pre>`;

  const out = document.getElementById('git-output');
  const show = (text, ok = true) => {
    if (!out) return;
    out.hidden = !text;
    out.textContent = text || '';
    out.classList.toggle('error', !ok);
  };
  const act = async (fn, successText) => {
    const res = await fn();
    show(res.success ? (res.output || successText || '').trim() : (res.error || 'Ошибка'), res.success);
    return res;
  };

  const renderFile = (file, isStaged) => {
    const el = document.createElement('div');
    el.className = 'git-file-item';
    const dir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';
    el.innerHTML = `
      <span class="git-file-status ${file.status}" title="${STATUS_TITLE[file.status] || ''}">${STATUS_LABEL[file.status] || '?'}</span>
      <span class="git-file-path" title="${escapeHtml(file.path)}"><span class="git-file-name">${escapeHtml(pathUtils.basename(file.path))}</span>${dir ? `<span class="git-file-dir">${escapeHtml(dir)}</span>` : ''}</span>
      <span class="git-file-actions">
        <button class="git-file-action" data-act="open" title="Открыть файл">↗</button>
        ${isStaged ? '' : '<button class="git-file-action" data-act="discard" title="Отменить изменения">↺</button>'}
        <button class="git-file-action" data-act="toggle" title="${isStaged ? 'Убрать из коммита' : 'Добавить в коммит'}">${isStaged ? '−' : '+'}</button>
      </span>`;
    el.querySelector('.git-file-path').addEventListener('click', () => openDiff(cwd, file, isStaged));
    el.querySelector('[data-act="open"]').addEventListener('click', (e) => { e.stopPropagation(); openFile(cwd, file); });
    el.querySelector('[data-act="toggle"]').addEventListener('click', async (e) => {
      e.stopPropagation();
      const res = isStaged ? await window.electronAPI.gitUnstage(cwd, file.path) : await window.electronAPI.gitStage(cwd, file.path);
      if (!res.success) show(res.error, false);
      refreshGitPanel();
    });
    el.querySelector('[data-act="discard"]')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const untracked = file.status === 'untracked';
      if (!confirm(`${untracked ? 'Удалить новый файл' : 'Отменить изменения в'} «${file.path}»? Это нельзя отменить.`)) return;
      const res = await window.electronAPI.gitDiscard(cwd, file.path, untracked);
      if (!res.success) show(res.error, false);
      refreshGitPanel();
    });
    return el;
  };
  const stagedList = document.getElementById('git-staged-list');
  const changesList = document.getElementById('git-changes-list');
  staged.forEach((f) => stagedList.appendChild(renderFile(f, true)));
  changes.forEach((f) => changesList.appendChild(renderFile(f, false)));
  if (!staged.length) stagedList.innerHTML = '<div class="git-empty">Ничего не подготовлено</div>';
  if (!changes.length) changesList.innerHTML = '<div class="git-empty">Нет изменений</div>';

  document.getElementById('git-stage-all')?.addEventListener('click', async () => { await window.electronAPI.gitStage(cwd, '.'); refreshGitPanel(); });
  document.getElementById('git-unstage-all')?.addEventListener('click', async () => { await window.electronAPI.gitUnstage(cwd, '.'); refreshGitPanel(); });

  const commit = async () => {
    const msg = document.getElementById('git-commit-msg')?.value || '';
    if (!msg.trim()) { show('Введите сообщение коммита', false); return; }
    const res = await act(() => window.electronAPI.gitCommit(cwd, msg), 'Коммит создан');
    if (res.success) refreshGitPanel();
  };
  document.getElementById('git-commit-btn')?.addEventListener('click', commit);
  document.getElementById('git-commit-msg')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); }
  });
  document.getElementById('git-pull-btn')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    await act(() => window.electronAPI.gitPull(cwd), 'Готово');
    refreshGitPanel();
  });
  document.getElementById('git-push-btn')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    await act(() => window.electronAPI.gitPush(cwd), 'Отправлено');
    refreshGitPanel();
  });
  document.getElementById('git-branch-btn')?.addEventListener('click', (e) => openBranchMenu(e.currentTarget, cwd));

  window.electronAPI.gitLog(cwd, 6).then((res) => {
    const box = document.getElementById('git-log');
    if (!box) return;
    box.innerHTML = res?.commits?.length
      ? res.commits.map((c) => `<div class="git-commit" title="${escapeHtml(c.author)} · ${escapeHtml(ago(c.when))}"><span class="git-hash">${escapeHtml(c.hash)}</span><span class="git-subject">${escapeHtml(c.subject)}</span><span class="git-when">${escapeHtml(ago(c.when))}</span></div>`).join('')
      : '<div class="git-empty">Коммитов пока нет</div>';
  });
}

async function openBranchMenu(anchor, cwd) {
  document.querySelectorAll('.git-menu').forEach((m) => m.remove());
  const res = await window.electronAPI.gitBranches(cwd);
  const menu = document.createElement('div');
  menu.className = 'git-menu context-menu';
  const r = anchor.getBoundingClientRect();
  menu.style.cssText = `position:fixed;left:${r.left}px;top:${r.bottom + 4}px;min-width:${r.width}px;max-height:300px;overflow:auto;z-index:10000`;
  const items = (res?.branches || []).map((b) => `<div class="context-menu-item${b.current ? ' current' : ''}" data-branch="${escapeHtml(b.name)}">${b.current ? '✓ ' : ''}${escapeHtml(b.name)}</div>`);
  menu.innerHTML = items.join('') + '<div class="git-menu-sep"></div><div class="context-menu-item" data-new="1">Новая ветка…</div>';
  document.body.appendChild(menu);
  const close = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', close, true); } };
  setTimeout(() => document.addEventListener('mousedown', close, true), 0);
  menu.addEventListener('click', async (e) => {
    const item = e.target.closest('.context-menu-item');
    if (!item) return;
    menu.remove();
    let result;
    if (item.dataset.new) {
      const name = await askBranchName();
      if (!name) return;
      result = await window.electronAPI.gitCheckout(cwd, name, true);
    } else if (!item.classList.contains('current')) {
      result = await window.electronAPI.gitCheckout(cwd, item.dataset.branch, false);
    }
    if (result && !result.success) alert(result.error || 'Не удалось переключить ветку');
    refreshGitPanel();
  });
}

function askBranchName() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'palette-overlay';
    overlay.innerHTML = '<div class="palette"><input class="palette-input" type="text" placeholder="Имя новой ветки" spellcheck="false"><div class="palette-foot">Enter — создать · Esc — отмена</div></div>';
    document.body.appendChild(overlay);
    const input = overlay.querySelector('input');
    const done = (value) => { overlay.remove(); resolve(value); };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done(input.value.trim());
      else if (e.key === 'Escape') done('');
    });
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) done(''); });
    input.focus();
  });
}
