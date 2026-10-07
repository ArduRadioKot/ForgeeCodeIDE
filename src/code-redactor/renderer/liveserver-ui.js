/** Live Server UI: status-bar chip, start/stop, "open this page" with hot reload in the built-in browser. */
import { state } from './state.js';
import { isEditorTab } from './tab-model.js';
import { openBrowserTab } from './browser.js';

const dirname = (p) => p.replace(/[\\/][^\\/]*$/, '') || '/';
const chip = () => document.getElementById('status-live-btn');

function paintChip(flash = false) {
  const el = chip();
  if (!el) return;
  const live = state.live;
  el.classList.toggle('active', !!live);
  el.classList.toggle('flash', flash);
  el.textContent = live ? `● :${live.port}${live.clients ? ` · ${live.clients}` : ''}` : 'Go Live';
  el.title = live ? `Live Server: ${live.url}\nКлик — остановить` : 'Запустить Live Server для проекта';
  if (flash) setTimeout(() => el.classList.remove('flash'), 400);
}

function rootFor(filePath) {
  const folder = state.currentFolder;
  if (filePath && folder && filePath.startsWith(folder)) return folder;
  if (filePath) return dirname(filePath);
  return folder || null;
}

function urlFor(live, filePath) {
  if (!filePath || !filePath.startsWith(live.root)) return live.url + '/';
  const rel = filePath.slice(live.root.length).replace(/\\/g, '/').replace(/^\//, '');
  return `${live.url}/${rel.split('/').map(encodeURIComponent).join('/')}`;
}

export async function startLive(root) {
  if (!root) {
    alert('Откройте папку проекта или HTML-файл, чтобы запустить Live Server');
    return null;
  }
  if (state.live && state.live.root !== root) await window.electronAPI.liveStop({ root: state.live.root });
  const res = await window.electronAPI.liveStart({ root, port: 5500 });
  if (!res?.success) {
    alert(res?.error || 'Не удалось запустить Live Server');
    return null;
  }
  state.live = { root, port: res.port, url: res.url, clients: 0 };
  paintChip();
  return state.live;
}

export async function stopLive() {
  if (!state.live) return;
  await window.electronAPI.liveStop({ root: state.live.root });
  state.live = null;
  paintChip();
}

/** Serve the project (or the active file's folder) and open it in the built-in browser. */
export async function toggleLive() {
  if (state.live) { await stopLive(); return; }
  const tab = state.currentTabs[state.activeTabIndex];
  const root = rootFor(isEditorTab(tab) ? tab.filePath : null) || state.currentFolder;
  const live = await startLive(root);
  if (live) openBrowserTab(urlFor(live, isEditorTab(tab) && /\.html?$/i.test(tab?.name || '') ? tab.filePath : null), { reuseOrigin: true, side: true });
}

export async function liveOpenPath(filePath) {
  const live = await startLive(rootFor(filePath));
  if (live) openBrowserTab(urlFor(live, filePath), { reuseOrigin: true, side: true });
}

export async function liveOpenCurrent(saveFn) {
  const tab = state.currentTabs[state.activeTabIndex];
  if (!isEditorTab(tab)) return false;
  if (!tab.filePath || tab.modified) await saveFn?.();
  if (!tab.filePath) return false;
  await liveOpenPath(tab.filePath);
  return true;
}

export async function setupLiveServer() {
  chip()?.addEventListener('click', toggleLive);
  window.electronAPI?.onLiveEvent?.((e) => {
    if (!state.live || e.root !== state.live.root) return;
    if (typeof e.clients === 'number') state.live.clients = e.clients;
    paintChip(e.type === 'reload' || e.type === 'css');
  });
  try {
    const running = await window.electronAPI.liveList?.();
    if (running && running[0]) {
      const r = running[0];
      state.live = { root: r.root, port: r.port, url: `http://127.0.0.1:${r.port}`, clients: r.clients };
    }
  } catch {}
  paintChip();
}
