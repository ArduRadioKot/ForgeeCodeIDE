import { state } from './state.js';
import { isEditorTab } from './tab-model.js';
import { openSearchFileAtLine } from './explorer.js';
import { getLang } from './i18n.js';
import { toast } from './image-view.js';
import { pathUtils } from './utils.js';

const KEY = 'frogee.bookmarks.v1';
const text = (ru, en) => getLang() === 'en' ? en : ru;
const workspace = () => state.currentFolder || '';

function readBookmarks() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (Array.isArray(saved)) return saved;
  } catch { /* Use the last in-memory list. */ }
  return bookmarks;
}

let bookmarks = [];

function saveBookmarks(next) {
  bookmarks = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* Keep this window usable. */ }
  window.dispatchEvent(new Event('frogee:bookmarks'));
}

const tabFor = (right) => state.currentTabs[right ? state.rightTabIndex : state.activeTabIndex];

function editorLocation() {
  const right = state.splitView && state.focusedPane === 'right';
  const tab = tabFor(right);
  const area = document.getElementById(right ? 'editor-right' : 'editor');
  if (!isEditorTab(tab) || !tab.filePath || !area) return null;
  return { folder: workspace(), path: tab.filePath, line: area.value.slice(0, area.selectionStart).split('\n').length };
}

function sameLocation(a, b) {
  return a.folder === b.folder && a.path === b.path && a.line === b.line;
}

function paintGutters() {
  const items = readBookmarks().filter((item) => item.folder === workspace());
  for (const right of [false, true]) {
    const gutter = document.getElementById(right ? 'line-numbers-right' : 'line-numbers');
    if (!gutter) continue;
    for (const marker of gutter.querySelectorAll('.bookmarked')) marker.classList.remove('bookmarked');
    const path = tabFor(right)?.filePath;
    if (!path) continue;
    for (const { line } of items.filter((item) => item.path === path)) {
      gutter.children[line - 1]?.classList.add('bookmarked');
    }
  }
}

export function toggleBookmark(onlyAdd = false) {
  const location = editorLocation();
  if (!location) {
    toast(text('Откройте сохранённый текстовый файл.', 'Open a saved text file.'));
    return;
  }
  const items = readBookmarks();
  const exists = items.some((item) => sameLocation(item, location));
  if (exists && onlyAdd) {
    toast(text('На этой строке уже есть закладка.', 'This line already has a bookmark.'));
    return;
  }
  saveBookmarks(exists ? items.filter((item) => !sameLocation(item, location)) : [location, ...items]);
  paintGutters();
  toast(exists ? text('Закладка снята', 'Bookmark removed') : text('Закладка добавлена', 'Bookmark added'));
}

export function bookmarkItems() {
  return readBookmarks().filter((item) => item.folder === workspace()).map((item) => {
    const label = pathUtils.basename(item.path) + ':' + item.line;
    const remove = () => {
      saveBookmarks(readBookmarks().filter((candidate) => !sameLocation(candidate, item)));
      paintGutters();
    };
    const run = async () => {
      const info = await window.electronAPI.fileStat(item.path).catch(() => null);
      if (info?.exists === false) {
        remove();
        toast(text('Файл закладки больше не существует.', 'The bookmarked file no longer exists.'));
        return;
      }
      openSearchFileAtLine(item.path, item.line);
    };
    return { label, detail: item.path, search: label + ' ' + item.path, run, remove };
  });
}

export function setupBookmarks() {
  let frame = 0;
  const paint = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; paintGutters(); });
  };
  window.addEventListener('frogee:content', paint);
  window.addEventListener('frogee:workspace', paint);
  window.addEventListener('storage', (event) => {
    if (event.key !== KEY) return;
    paint();
    window.dispatchEvent(new Event('frogee:bookmarks'));
  });
  document.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key !== 'F2') return;
    if (!event.target.matches('#editor, #editor-right')) return;
    event.preventDefault();
    toggleBookmark();
  });
}
