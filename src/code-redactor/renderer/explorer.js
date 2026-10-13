import { state } from './state.js';
import { getDom, invalidateDomCache } from './dom.js';
import { pathUtils, escapeHtml } from './utils.js';
import { hideWelcomePage, createTab, closeTab } from './tabs.js';
import { updateLineNumbers, updateSyntaxHighlight } from './editor-api.js';
import { showGitPanel, refreshGitPanel } from './git-panel.js';
import { invalidatePythonEnvCache } from './notebook.js';
import { liveOpenPath, toggleLive } from './liveserver-ui.js';
import { openBrowserTab } from './browser.js';
import { runInTerminal, onFolderChanged } from './terminal.js';
import { runCurrentFile } from './palette.js';
import { showSearchPanel } from './search-panel.js';
import { refreshGitignoreBox, isIgnoredHidden, toggleHideIgnored } from './gitignore-ui.js';
import { icon, hydrateIcons } from './glyphs.js';
import { setupRunConfigPanel } from './run-configs.js';

const dom = getDom();

const ACTIVITIES = {
  explorer: { btn: 'explorerBtn', show: () => showExplorerPanel() },
  search: { btn: 'searchBtn', show: () => showSearchPanel() },
  git: { btn: 'gitBtn', show: () => showGitPanel() },
  debug: { btn: 'debugBtn', show: () => showRunPanel() },
};

function paintActivityButtons() {
  for (const [name, def] of Object.entries(ACTIVITIES)) {
    dom[def.btn]?.classList.toggle('active', state.activityVisible !== false && state.currentActivity === name);
  }
}

export function setActivityVisible(visible) {
  state.activityVisible = visible;
  if (dom.activityPanel) dom.activityPanel.style.display = visible ? '' : 'none';
  document.getElementById('activity-resizer')?.classList.toggle('hidden', !visible);
  paintActivityButtons();
}

/** Show a side panel. With { toggle: true } a second click on the active button collapses the panel. */
export function switchActivity(activity, { toggle = false } = {}) {
  const def = ACTIVITIES[activity];
  if (!def) return;
  if (toggle && state.currentActivity === activity && state.activityVisible !== false) {
    setActivityVisible(false);
    return;
  }
  state.currentActivity = activity;
  setActivityVisible(true);
  try {
    def.show();
  } catch (err) {
    console.error('[sidebar]', err);
    dom.activityPanel.innerHTML = `<div class="activity-header"><h3>Ошибка</h3></div><div class="git-placeholder error"><p>${escapeHtml(err?.message || String(err))}</p></div>`;
  }
}

export function showExplorerPanel() {
  dom.activityPanel.innerHTML = `
    <div class="activity-header">
      <h3>Проводник</h3>
      <div class="activity-buttons">
        <button class="activity-btn" title="Открыть папку" id="open-folder-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>
          </svg>
        </button>
        <button class="activity-btn" title="Новый файл" id="new-file-in-folder-btn" ${!state.currentFolder ? 'disabled' : ''}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
            <polyline points="14,2 14,8 20,8"/>
            <line x1="12" y1="18" x2="12" y2="12"/>
            <line x1="9" y1="15" x2="15" y2="15"/>
          </svg>
        </button>
        <button class="activity-btn" title="Скрыть файлы из .gitignore" id="toggle-ignored-btn" ${!state.currentFolder ? 'disabled' : ''}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
        </button>
        <button class="activity-btn" title="Новая папка" id="new-folder-btn" ${!state.currentFolder ? 'disabled' : ''}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>
            <line x1="12" y1="11" x2="12" y2="17"/>
            <line x1="9" y1="14" x2="15" y2="14"/>
          </svg>
        </button>
      </div>
    </div>
    <div id="file-explorer" class="file-explorer">
      <div class="file-explorer-placeholder">Откройте папку для просмотра файлов</div>
    </div>
    <div id="gitignore-box" class="gitignore-box"></div>
  `;
  
  // Переподключаем обработчики для новых кнопок
  document.getElementById('open-folder-btn').addEventListener('click', openFolder);
  document.getElementById('new-file-in-folder-btn').addEventListener('click', createNewFileInFolder);
  document.getElementById('new-folder-btn').addEventListener('click', createNewFolderInFolder);
  document.getElementById('toggle-ignored-btn').addEventListener('click', () => toggleHideIgnored(updateFileExplorer));
  
  // Обновляем explorer если папка уже открыта
  if (state.currentFolder) {
    updateFileExplorer();
  }
}

export async function showRunPanel() {
  dom.activityPanel.innerHTML = `
    <div class="activity-header"><h3>Запуск</h3></div>
    <div class="run-panel">
      <div class="run-section">
        <div class="run-title run-title-row"><span>Конфигурации</span><button type="button" class="activity-btn" id="run-config-add" title="Новая конфигурация запуска"><span class="ico-wrap" data-icon="plus" data-size="14"></span></button></div>
        <div class="run-list" id="run-configs"></div>
      </div>
      <div class="run-section">
        <div class="run-title">Текущий файл</div>
        <button class="run-item" id="run-current-btn"><span class="run-play">${icon('play', 11)}</span><span class="run-name" id="run-current-name">—</span><kbd>F5</kbd></button>
      </div>
      <div class="run-section" id="run-scripts" hidden>
        <div class="run-title">Скрипты package.json</div>
        <div class="run-list" id="run-scripts-list"></div>
      </div>
      <div class="run-section">
        <div class="run-title">Сайт</div>
        <button class="run-item" id="run-live-btn"><span class="run-play">${icon('live', 13)}</span><span class="run-name">Live Server для проекта</span></button>
        <button class="run-item" id="run-browser-btn"><span class="run-play">${icon('window', 13)}</span><span class="run-name">Открыть браузер</span></button>
      </div>
    </div>`;
  const tab = state.currentTabs[state.activeTabIndex];
  const nameEl = document.getElementById('run-current-name');
  if (nameEl) nameEl.textContent = tab && tab.kind !== 'terminal' && tab.kind !== 'browser' ? tab.name : 'Откройте файл';
  document.getElementById('run-current-btn')?.addEventListener('click', () => runCurrentFile({ ignoreConfig: true }));
  hydrateIcons(dom.activityPanel);
  setupRunConfigPanel();
  document.getElementById('run-live-btn')?.addEventListener('click', () => toggleLive());
  document.getElementById('run-browser-btn')?.addEventListener('click', () => openBrowserTab('about:blank'));

  if (!state.currentFolder) return;
  const pkg = await window.electronAPI.getFileContent(pathUtils.join(state.currentFolder, 'package.json'));
  if (!pkg?.success) return;
  try {
    const scripts = JSON.parse(pkg.content).scripts || {};
    const names = Object.keys(scripts);
    if (!names.length) return;
    document.getElementById('run-scripts').hidden = false;
    const list = document.getElementById('run-scripts-list');
    list.innerHTML = names.map((n) => `<button class="run-item" data-script="${escapeHtml(n)}" title="${escapeHtml(scripts[n])}"><span class="run-play">${icon('play', 11)}</span><span class="run-name">${escapeHtml(n)}</span><span class="run-cmd">${escapeHtml(scripts[n]).slice(0, 40)}</span></button>`).join('');
    list.querySelectorAll('[data-script]').forEach((btn) => btn.addEventListener('click', () => {
      const n = btn.dataset.script;
      runInTerminal(n === 'start' || n === 'test' ? `npm ${n}` : `npm run ${n}`, state.currentFolder);
    }));
  } catch {}
}

export function goToEditorLine(lineNumber) {
  if (!dom.editor) return;
  const lines = dom.editor.value.split('\n');
  const targetLine = Math.max(0, lineNumber - 1);
  const lineHeight = parseFloat(getComputedStyle(dom.editor).lineHeight) || 24;
  const start = lines.slice(0, targetLine).join('\n').length + (targetLine > 0 ? 1 : 0);
  const end = start + (lines[targetLine]?.length || 0);
  dom.editor.focus();
  dom.editor.setSelectionRange(start, end);
  dom.editor.scrollTop = Math.max(0, targetLine * lineHeight - dom.editor.clientHeight / 3);
  updateLineNumbers();
  updateSyntaxHighlight();
}

window.goToEditorLine = goToEditorLine;

export function openSearchFile(filePath) {
  // Открываем файл в редакторе
  window.electronAPI.getFileContent(filePath).then(result => {
    if (result.success) {
      hideWelcomePage();
      const fileName = pathUtils.basename(filePath);
      createTab(fileName, result.content, filePath);
    }
  });
}

export function openSearchFileAtLine(filePath, lineNumber) {
  // Открываем файл и переходим к строке
  window.electronAPI.getFileContent(filePath).then(result => {
    if (result.success) {
      hideWelcomePage();
      const fileName = pathUtils.basename(filePath);
      createTab(fileName, result.content, filePath);
      // Прокручиваем к нужной строке после небольшой задержки
      setTimeout(() => {
        goToEditorLine(lineNumber);
      }, 100);
    }
  });
}

// Делаем функции глобальными для использования в onclick
window.openSearchFile = openSearchFile;
window.openSearchFileAtLine = openSearchFileAtLine;

// Функции для работы с вкладками

export async function openFolder() {
  try {
    const result = await window.electronAPI.openFolder();
    if (result.success) {
      state.currentFolder = result.folderPath;
      invalidatePythonEnvCache();
      await loadFolderContents(state.currentFolder);
      // Обновляем состояние кнопок
      const newFileInFolderBtn = document.getElementById('new-file-in-folder-btn');
      const newFolderBtn = document.getElementById('new-folder-btn');
      if (newFileInFolderBtn) newFileInFolderBtn.disabled = false;
      if (newFolderBtn) newFolderBtn.disabled = false;
    }
  } catch (error) {
    console.error('Ошибка открытия папки:', error);
  }
}

export async function loadFolderContents(folderPath) {
  try {
    state.currentFolder = folderPath;
    // Callers often set state.currentFolder before calling this, so "did it change" is judged by each terminal's own folder.
    onFolderChanged(folderPath).catch((err) => console.warn('[terminal] restart in folder:', err));
    invalidatePythonEnvCache();
    window.electronAPI.watchFolder?.(folderPath).catch(() => {});
    state.expandedFolders = new Set([folderPath]);
    state.folderChildrenCache = new Map();
    const result = await window.electronAPI.listFiles(folderPath);
    if (result.success) {
      const sorted = sortExplorerItems(result.files || []);
      state.fileExplorerItems = sorted;
      state.folderChildrenCache.set(folderPath, sorted);
      updateFileExplorer();
      window.dispatchEvent(new Event('frogee:title'));
    }
  } catch (error) {
    console.error('Ошибка загрузки содержимого папки:', error);
  }
}

export function sortExplorerItems(items) {
  return [...items].sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

export async function refreshExplorerTree() {
  if (!state.currentFolder) {
    updateFileExplorer();
    return;
  }
  const pathsToReload = [state.currentFolder, ...state.expandedFolders];
  for (const folderPath of pathsToReload) {
    try {
      const result = await window.electronAPI.listFiles(folderPath);
      if (result.success) {
        state.folderChildrenCache.set(folderPath, sortExplorerItems(result.files || []));
        if (folderPath === state.currentFolder) {
          state.fileExplorerItems = state.folderChildrenCache.get(folderPath);
        }
      }
    } catch (err) {
      console.warn('refreshExplorerTree:', folderPath, err);
    }
  }
  updateFileExplorer();
}

export function updateFileExplorer() {
  const fileExplorer = document.getElementById('file-explorer');
  if (!fileExplorer) return;

  fileExplorer.innerHTML = '';

  const newFileInFolderBtn = document.getElementById('new-file-in-folder-btn');
  const newFolderBtn = document.getElementById('new-folder-btn');

  if (!state.currentFolder) {
    fileExplorer.innerHTML = '<div class="file-explorer-placeholder">Откройте папку для просмотра файлов</div>';
    if (newFileInFolderBtn) newFileInFolderBtn.disabled = true;
    if (newFolderBtn) newFolderBtn.disabled = true;
    return;
  }

  if (newFileInFolderBtn) newFileInFolderBtn.disabled = false;
  if (newFolderBtn) newFolderBtn.disabled = false;

  refreshGitignoreBox();
  const rootName = pathUtils.basename(state.currentFolder) || state.currentFolder;
  const rootHeader = document.createElement('div');
  rootHeader.className = 'explorer-root';
  rootHeader.innerHTML = `
    <span class="tree-twistie open" aria-hidden="true"></span>
    <span class="file-icon folder" aria-hidden="true"></span>
    <span class="file-name explorer-root-name">${escapeHtml(rootName)}</span>
  `;
  rootHeader.title = state.currentFolder;
  rootHeader.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenuForFolder(e, state.currentFolder);
  });
  fileExplorer.appendChild(rootHeader);

  const children = state.folderChildrenCache.get(state.currentFolder) || state.fileExplorerItems || [];
  renderExplorerChildren(fileExplorer, children, 1);

  // Dropping on the project name or on the empty part of the tree moves into the project's top folder.
  const toRoot = (ev) => { if (!canDropOn(state.currentFolder)) return false; ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; return true; };
  rootHeader.addEventListener('dragover', (ev) => { if (toRoot(ev)) markDrop(rootHeader); });
  rootHeader.addEventListener('dragleave', (ev) => { if (!rootHeader.contains(ev.relatedTarget)) rootHeader.classList.remove('drop-target'); });
  rootHeader.addEventListener('drop', (ev) => { ev.preventDefault(); finishDrop(state.currentFolder); });
  fileExplorer.ondragover = (ev) => { if (!ev.target.closest('.file-item') && !ev.target.closest('.explorer-root') && toRoot(ev)) markDrop(fileExplorer); };
  fileExplorer.ondragleave = (ev) => { if (!fileExplorer.contains(ev.relatedTarget)) fileExplorer.classList.remove('drop-target'); };
  fileExplorer.ondrop = (ev) => { if (ev.target.closest('.file-item') || ev.target.closest('.explorer-root')) return; ev.preventDefault(); finishDrop(state.currentFolder); };

  fileExplorer.onclick = null;
  fileExplorer.oncontextmenu = (e) => {
    if (!e.target.closest('.file-item') && !e.target.closest('.explorer-root') && state.currentFolder) {
      e.preventDefault();
      showContextMenuForFolder(e, state.currentFolder);
    }
  };
}

// ───────── drag and drop (move into a folder) ─────────

let dragged = null; // { path, isDirectory } of what is being dragged
let dropRow = null;
let springTimer = 0;
const sameOrInside = (child, parent) => { const c = child.replace(/\\/g, '/'); const p = parent.replace(/\\/g, '/'); return c === p || c.startsWith(p.endsWith('/') ? p : p + '/'); };

function canDropOn(destDir) {
  if (!dragged) return false;
  if (sameOrInside(destDir, dragged.path)) return false; // into itself or its own subfolder
  return pathUtils.dirname(dragged.path).replace(/\\/g, '/') !== destDir.replace(/\\/g, '/'); // already there
}

function markDrop(el) {
  if (dropRow && dropRow !== el) dropRow.classList.remove('drop-target');
  dropRow = el;
  el.classList.add('drop-target');
}

function clearDropMarks() {
  clearTimeout(springTimer);
  springTimer = 0;
  dropRow = null;
  document.querySelectorAll('.drop-target').forEach((el) => el.classList.remove('drop-target'));
}

async function finishDrop(destDir) {
  const item = dragged;
  clearDropMarks();
  dragged = null;
  if (item) await moveItem(item.path, destDir);
}

/** Move a file or folder into `destDir` and bring the open tabs, the tree and the selection along. */
export async function moveItem(srcPath, destDir) {
  const res = await window.electronAPI.movePath(srcPath, destDir);
  if (!res?.success) {
    if (!res?.noop) alert(`Не удалось переместить: ${res?.error || 'неизвестная ошибка'}`);
    return false;
  }
  const rebase = (p) => (p && sameOrInside(p, srcPath) ? res.newPath + p.slice(srcPath.length) : p);
  for (const tab of state.currentTabs) if (tab.filePath) tab.filePath = rebase(tab.filePath);
  state.expandedFolders = new Set([...state.expandedFolders].map(rebase));
  if (state.selectedExplorerPath) state.selectedExplorerPath = rebase(state.selectedExplorerPath);
  state.expandedFolders.add(destDir);
  for (const key of [...state.folderChildrenCache.keys()]) if (sameOrInside(key, srcPath)) state.folderChildrenCache.delete(key);
  await refreshExplorerTree();
  updateTabsList();
  updateTabTitle();
  return true;
}

export function renderExplorerChildren(container, items, depth) {
  const sorted = sortExplorerItems(items || []);
  sorted.forEach((item) => {
    const row = document.createElement('div');
    const isDir = !!item.isDirectory;
    const isExpanded = isDir && state.expandedFolders.has(item.path);
    if (item.ignored && isIgnoredHidden()) return;
    row.className = 'file-item' + (state.selectedExplorerPath === item.path ? ' selected' : '') + (item.ignored ? ' ignored' : '');
    if (item.ignored) row.title = 'Игнорируется Git (.gitignore)';
    row.dataset.path = item.path;
    // Files and folders can be dragged onto a folder to move them; a file dropped on the chat becomes its context.
    row.draggable = true;
    row.addEventListener('dragstart', (ev) => {
      dragged = { path: item.path, isDirectory: isDir };
      ev.dataTransfer.setData('application/x-frogee-move', item.path);
      if (!isDir) { ev.dataTransfer.setData('application/x-frogee-path', item.path); ev.dataTransfer.setData('text/plain', item.path); }
      ev.dataTransfer.effectAllowed = 'copyMove';
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => { dragged = null; clearDropMarks(); row.classList.remove('dragging'); });
    if (isDir) {
      row.addEventListener('dragover', (ev) => {
        if (!canDropOn(item.path)) return;
        ev.preventDefault();
        ev.stopPropagation();
        ev.dataTransfer.dropEffect = 'move';
        markDrop(row);
        // a closed folder opens when the drag rests on it
        if (!state.expandedFolders.has(item.path) && !springTimer) springTimer = setTimeout(() => { springTimer = 0; if (dropRow === row) toggleFolderExpand(item.path); }, 700);
      });
      row.addEventListener('dragleave', (ev) => { if (!row.contains(ev.relatedTarget)) { row.classList.remove('drop-target'); if (dropRow === row) dropRow = null; clearTimeout(springTimer); springTimer = 0; } });
      row.addEventListener('drop', (ev) => { ev.preventDefault(); ev.stopPropagation(); finishDrop(item.path); });
    }
    row.dataset.isDirectory = String(isDir);
    row.style.setProperty('--tree-depth', String(depth));

    const twistie = isDir
      ? `<span class="tree-twistie ${isExpanded ? 'open' : ''}" aria-hidden="true"></span>`
      : `<span class="tree-twistie spacer" aria-hidden="true"></span>`;
    const icon = isDir
      ? '<span class="file-icon folder" aria-hidden="true"></span>'
      : getFileIcon(item.name);

    row.innerHTML = `
      ${twistie}
      ${icon}
      <span class="file-name">${escapeHtml(item.name)}</span>
    `;

    row.addEventListener('click', (e) => {
      if (state.contextMenu && state.contextMenu.contains(e.target)) return;
      e.stopPropagation();
      state.selectedExplorerPath = item.path;
      handleFileItemClick(item);
    });

    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      state.selectedExplorerPath = item.path;
      showContextMenu(e, item);
    });

    container.appendChild(row);

    if (isDir && isExpanded) {
      const kids = state.folderChildrenCache.get(item.path) || [];
      renderExplorerChildren(container, kids, depth + 1);
    }
  });
}

export async function toggleFolderExpand(folderPath) {
  if (state.expandedFolders.has(folderPath)) {
    state.expandedFolders.delete(folderPath);
    updateFileExplorer();
    return;
  }

  state.expandedFolders.add(folderPath);
  if (!state.folderChildrenCache.has(folderPath)) {
    try {
      const result = await window.electronAPI.listFiles(folderPath);
      if (result.success) {
        state.folderChildrenCache.set(folderPath, sortExplorerItems(result.files || []));
      } else {
        state.folderChildrenCache.set(folderPath, []);
      }
    } catch (err) {
      console.error('toggleFolderExpand:', err);
      state.folderChildrenCache.set(folderPath, []);
    }
  }
  updateFileExplorer();
}

export function getFileIcon(fileName) {
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  const labelMap = {
    js: 'JS', mjs: 'JS', cjs: 'JS', jsx: 'JX',
    ts: 'TS', tsx: 'TX',
    py: 'PY',
    ipynb: 'NB',
    html: 'HT', htm: 'HT',
    css: 'CS', scss: 'SC', less: 'LS',
    json: 'JN',
    md: 'MD', markdown: 'MD',
    go: 'GO',
    rs: 'RS',
    java: 'JA',
    xml: 'XM',
    yml: 'YM', yaml: 'YM',
    sh: 'SH', bash: 'SH',
    txt: 'TX',
    vue: 'VU',
    php: 'PH',
    sql: 'SQ'
  };
  const label = labelMap[ext] || (ext ? ext.slice(0, 2).toUpperCase() : 'F');
  const safeExt = (ext || 'file').replace(/[^a-z0-9]/gi, '');
  return `<span class="file-icon ext-${safeExt}" aria-hidden="true">${label}</span>`;
}

// Функции для создания файлов и папок в текущей папке

export async function createNewFileInFolder() {
  if (!state.currentFolder) return;
  
  const fileName = prompt('Введите имя файла:');
  if (!fileName || !fileName.trim()) return;
  
  try {
    const result = await window.electronAPI.createFileInFolder(state.currentFolder, fileName.trim());
    if (result.success) {
      await refreshExplorerTree();
      // Открываем новый файл в редакторе
      const content = await window.electronAPI.getFileContent(result.filePath);
      if (content.success) {
        hideWelcomePage();
        createTab(fileName.trim(), content.content, result.filePath);
      }
    } else {
      alert('Ошибка: ' + result.error);
    }
  } catch (error) {
    console.error('Ошибка создания файла:', error);
    alert('Ошибка создания файла: ' + error.message);
  }
}

export async function createNewFolderInFolder() {
  if (!state.currentFolder) return;
  
  const folderName = prompt('Введите имя папки:');
  if (!folderName || !folderName.trim()) return;
  
  try {
    const result = await window.electronAPI.createFolderInFolder(state.currentFolder, folderName.trim());
    if (result.success) {
      await refreshExplorerTree();
    } else {
      alert('Ошибка: ' + result.error);
    }
  } catch (error) {
    console.error('Ошибка создания папки:', error);
    alert('Ошибка создания папки: ' + error.message);
  }
}

// Контекстное меню для файлов и папок
// state.contextMenu живёт в state.js

export function showContextMenu(event, item) {
  // Удаляем предыдущее меню, если есть
  if (state.contextMenu) {
    state.contextMenu.remove();
  }
  
  // Создаем контекстное меню
  state.contextMenu = document.createElement('div');
  state.contextMenu.className = 'context-menu';
  state.contextMenu.style.position = 'fixed';
  state.contextMenu.style.left = event.pageX + 'px';
  state.contextMenu.style.top = event.pageY + 'px';
  state.contextMenu.style.zIndex = '10000';
  
  const menuItems = [];
  if (!item.isDirectory && /\.html?$/i.test(item.path)) {
    menuItems.push({ label: 'Открыть в Live Server', action: () => liveOpenPath(item.path) });
  }
  menuItems.push(
    { label: 'Переименовать', action: () => renameFileItem(item) },
    { label: 'Копировать', action: () => copyFileItem(item) },
    { label: 'Скопировать путь', action: () => navigator.clipboard?.writeText(item.path) },
  );
  if (!item.isDirectory) menuItems.push({ label: 'Добавить в контекст чата', action: () => import('./chat.js').then((m) => m.addContextFileByPath(item.path)) });
  
  // Добавляем "Вставить" только если есть скопированный файл
  if (state.copiedFilePath) {
    menuItems.push({ label: 'Вставить', action: () => pasteFileItem(item) });
  }
  
  menuItems.push({ label: 'Удалить', action: () => deleteFileItem(item), isDanger: true });
  
  menuItems.forEach(menuItem => {
    const menuItemEl = document.createElement('div');
    menuItemEl.className = 'context-menu-item' + (menuItem.isDanger ? ' danger' : '');
    menuItemEl.textContent = menuItem.label;
    menuItemEl.addEventListener('click', (e) => {
      e.stopPropagation();
      menuItem.action();
      state.contextMenu.remove();
      state.contextMenu = null;
    });
    state.contextMenu.appendChild(menuItemEl);
  });
  
  document.body.appendChild(state.contextMenu);
  
  // Закрываем меню при клике вне его
  const closeMenu = (e) => {
    if (!state.contextMenu || !state.contextMenu.contains(e.target)) {
      if (state.contextMenu) {
        state.contextMenu.remove();
        state.contextMenu = null;
      }
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

export function showContextMenuForFolder(event, folderPath) {
  // Удаляем предыдущее меню, если есть
  if (state.contextMenu) {
    state.contextMenu.remove();
  }
  
  // Создаем контекстное меню только с опцией "Вставить"
  state.contextMenu = document.createElement('div');
  state.contextMenu.className = 'context-menu';
  state.contextMenu.style.position = 'fixed';
  state.contextMenu.style.left = event.pageX + 'px';
  state.contextMenu.style.top = event.pageY + 'px';
  state.contextMenu.style.zIndex = '10000';
  
  const menuItemEl = document.createElement('div');
  menuItemEl.className = 'context-menu-item';
  menuItemEl.textContent = 'Вставить';
  menuItemEl.addEventListener('click', async () => {
    if (state.copiedFilePath) {
      const item = { path: folderPath, isDirectory: true };
      await pasteFileItem(item);
    }
    state.contextMenu.remove();
    state.contextMenu = null;
  });
  state.contextMenu.appendChild(menuItemEl);
  
  document.body.appendChild(state.contextMenu);
  
  // Закрываем меню при клике вне его
  const closeMenu = (e) => {
    if (!state.contextMenu || !state.contextMenu.contains(e.target)) {
      if (state.contextMenu) {
        state.contextMenu.remove();
        state.contextMenu = null;
      }
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

export async function renameFileItem(item) {
  // Inline rename like VS Code
  const fileExplorer = document.getElementById('file-explorer');
  if (!fileExplorer) return;

  const fileItem = Array.from(fileExplorer.querySelectorAll('.file-item'))
    .find(el => el.dataset.path === item.path);
  if (!fileItem) {
    // Fallback to prompt
    const newName = prompt('Введите новое имя:', item.name);
    if (!newName || !newName.trim() || newName.trim() === item.name) return;
    await applyRename(item, newName.trim());
    return;
  }

  const nameSpan = fileItem.querySelector('.file-name');
  if (!nameSpan) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'rename-input';
  input.value = item.name;
  fileItem.draggable = false; // otherwise selecting text with the mouse drags the file (and its path) instead
  nameSpan.replaceWith(input);
  input.focus();
  const dot = item.isDirectory ? -1 : item.name.lastIndexOf('.');
  input.setSelectionRange(0, dot > 0 ? dot : item.name.length);
  ['mousedown', 'dragstart', 'dblclick'].forEach((evt) => input.addEventListener(evt, (e) => e.stopPropagation()));
  input.draggable = false;

  let finished = false;
  const finish = async (commit) => {
    if (finished) return;
    finished = true;
    const trimmed = input.value.trim();
    if (commit && trimmed && trimmed !== item.name) {
      await applyRename(item, trimmed);
    } else {
      await refreshExplorerTree();
    }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (e) => e.stopPropagation());
}

export async function applyRename(item, trimmedName) {
  try {
    const result = await window.electronAPI.renameFile(item.path, trimmedName);
    if (result.success) {
      await refreshExplorerTree();
      const tab = state.currentTabs.find(t => t.filePath === item.path);
      if (tab) {
        tab.filePath = result.newPath;
        tab.name = trimmedName;
        updateTabsList();
        updateTabTitle();
        updateSyntaxHighlight();
      }
    } else {
      alert('Ошибка переименования: ' + result.error);
      await refreshExplorerTree();
    }
  } catch (error) {
    console.error('Ошибка переименования:', error);
    alert('Ошибка переименования: ' + (error.message || 'Неизвестная ошибка'));
    await refreshExplorerTree();
  }
}

export function copyFileItem(item) {
  state.copiedFilePath = item.path;
  // Можно добавить визуальную индикацию
  console.log('Файл скопирован:', item.name);
}

export async function pasteFileItem(item) {
  if (!state.copiedFilePath) return;
  
  // Определяем целевую папку: если кликнули по папке - вставляем в неё, иначе в текущую открытую папку
  const targetPath = item.isDirectory ? item.path : (state.currentFolder || pathUtils.dirname(item.path));
  const sourceName = pathUtils.basename(state.copiedFilePath);
  
  // Определяем имя для вставки
  let destinationName = sourceName;
  let counter = 1;
  while (true) {
    const destinationPath = pathUtils.join(targetPath, destinationName);
    try {
      // Проверяем, существует ли файл с таким именем
      const exists = await window.electronAPI.getFileContent(destinationPath).catch(() => null);
      if (!exists) break;
      // Если существует, добавляем номер
      const ext = pathUtils.extname(sourceName);
      const base = sourceName.substring(0, sourceName.length - ext.length);
      destinationName = `${base} (${counter})${ext}`;
      counter++;
    } catch {
      break;
    }
  }
  
  const destinationPath = pathUtils.join(targetPath, destinationName);
  
  try {
    const result = await window.electronAPI.copyFile(state.copiedFilePath, destinationPath);
    if (result.success) {
      // Обновляем explorer - если мы в текущей папке, обновляем её, иначе обновляем папку куда вставили
      if (targetPath === state.currentFolder) {
        await refreshExplorerTree();
      } else {
        // Если вставили в другую папку, обновляем текущую для отображения изменений
        await refreshExplorerTree();
      }
      state.copiedFilePath = null; // Очищаем после вставки
    } else {
      alert('Ошибка: ' + result.error);
    }
  } catch (error) {
    console.error('Ошибка вставки:', error);
    alert('Ошибка вставки: ' + error.message);
  }
}

export async function deleteFileItem(item) {
  const confirmMessage = `Вы уверены, что хотите удалить "${item.name}"?`;
  if (!confirm(confirmMessage)) return;
  
  try {
    const result = await window.electronAPI.deleteFile(item.path);
    if (result.success) {
      // Закрываем вкладку если файл был открыт
      const tabIndex = state.currentTabs.findIndex(t => t.filePath === item.path);
      if (tabIndex >= 0) {
        closeTab(tabIndex);
      }
      await refreshExplorerTree();
    } else {
      alert('Ошибка: ' + result.error);
    }
  } catch (error) {
    console.error('Ошибка удаления:', error);
    alert('Ошибка удаления: ' + error.message);
  }
}

export async function handleFileItemClick(item) {
  if (item.isDirectory) {
    await toggleFolderExpand(item.path);
    return;
  }
  try {
    const result = await window.electronAPI.getFileContent(item.path);
    if (result.success) {
      hideWelcomePage();
      createTab(item.name, result.content, item.path);
      updateFileExplorer();
    } else {
      refreshExplorerTree(); // the entry is stale (file removed outside the editor)
    }
  } catch (error) {
    console.error('Ошибка открытия файла:', error);
  }
}

export function registerSearchGlobals() {
  window.openSearchFile = openSearchFile;
  window.openSearchFileAtLine = openSearchFileAtLine;
  window.goToEditorLine = goToEditorLine;
}
