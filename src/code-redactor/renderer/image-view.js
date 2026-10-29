/** Images open in a viewer tab of their own: fit to the window, zoom, 100 %, drag to pan. */
import { state } from './state.js';
import { escapeHtml } from './utils.js';
import { icon } from './glyphs.js';
import { getLang } from './i18n.js';

export const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif']);
const BINARY_EXT = new Set('whl egg pyc pyo pyd so dylib dll exe bin o a lib obj class jar war wasm zip tar gz tgz bz2 xz zst 7z rar dmg pkg iso img deb rpm apk ipa db sqlite sqlite3 npy npz pkl pickle parquet h5 hdf5 feather pdf doc docx xls xlsx xlsm ppt pptx odt ods psd ai sketch tif tiff heic icns mp3 mp4 m4a mov avi mkv wav flac ogg webm woff woff2 ttf otf eot'.split(' '));

const extOf = (name) => (/\.([A-Za-z0-9]+)$/.exec(String(name || '')) || [])[1]?.toLowerCase() || '';
export const isImagePath = (name) => IMAGE_EXT.has(extOf(name));
export const isBinaryPath = (name) => BINARY_EXT.has(extOf(name));

const MIN = 0.05;
const MAX = 16;

export function createImageTab(name, filePath) {
  return { id: Date.now() + Math.random(), kind: 'image', name, filePath, content: '', modified: false, view: { mode: 'fit', zoom: 1 } };
}

export function fileUrl(filePath) {
  const parts = String(filePath).replace(/\\/g, '/').split('/');
  const encoded = parts.map((p, i) => (i === 0 && /^[A-Za-z]:$/.test(p) ? p : encodeURIComponent(p))).join('/');
  return `file://${encoded.startsWith('/') ? '' : '/'}${encoded}`;
}

const host = () => document.getElementById('image-host');

/** Show / hide the viewer. Showing it hides every other editor surface. */
export function applyImageSurface(show) {
  const h = host();
  if (!h) return;
  if (show) {
    h.style.display = 'flex';
    ['editor-container', 'editor-container-right', 'split-resizer', 'terminal-editor-host', 'notebook-host', 'browser-host'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  } else if (h.style.display !== 'none') {
    h.style.display = 'none';
    h.innerHTML = '';
  }
}

export function renderImage(tab) {
  const h = host();
  if (!h || !tab) return;
  const view = tab.view || (tab.view = { mode: 'fit', zoom: 1 });
  h.innerHTML = `
    <div class="img-toolbar">
      <button type="button" class="nb-btn nb-btn-icon" data-img="out" title="Уменьшить">${icon('minus', 14)}</button>
      <span class="img-zoom" data-img="zoomtext">100%</span>
      <button type="button" class="nb-btn nb-btn-icon" data-img="in" title="Увеличить">${icon('plus', 14)}</button>
      <button type="button" class="nb-btn" data-img="fit" title="Вписать в окно">По размеру</button>
      <button type="button" class="nb-btn" data-img="actual" title="Реальный размер">100%</button>
      <span class="img-info" data-img="info">${escapeHtml(tab.name)}</span>
    </div>
    <div class="img-stage"><img class="img-pic" alt="${escapeHtml(tab.name)}" draggable="false"></div>`;
  const stage = h.querySelector('.img-stage');
  const img = h.querySelector('.img-pic');
  const zoomText = h.querySelector('[data-img="zoomtext"]');
  const info = h.querySelector('[data-img="info"]');

  const apply = () => {
    if (view.mode === 'fit') {
      img.style.width = '';
      img.style.maxWidth = '100%';
      img.style.maxHeight = '100%';
      stage.classList.remove('zoomed');
      const shown = img.naturalWidth ? Math.round((img.clientWidth / img.naturalWidth) * 100) : 100;
      zoomText.textContent = `${shown}%`;
    } else {
      img.style.maxWidth = 'none';
      img.style.maxHeight = 'none';
      img.style.width = `${img.naturalWidth * view.zoom}px`;
      stage.classList.add('zoomed');
      zoomText.textContent = `${Math.round(view.zoom * 100)}%`;
    }
  };
  const currentZoom = () => (view.mode === 'fit' && img.naturalWidth ? img.clientWidth / img.naturalWidth : view.zoom);
  const zoomBy = (factor) => { view.zoom = Math.min(MAX, Math.max(MIN, currentZoom() * factor)); view.mode = 'zoom'; apply(); };

  img.addEventListener('load', () => {
    info.textContent = `${tab.name} · ${img.naturalWidth}×${img.naturalHeight}`;
    apply();
  });
  img.addEventListener('error', () => { info.textContent = `${tab.name} · ${getLang() === 'en' ? 'could not load image' : 'не удалось загрузить изображение'}`; });
  img.src = `${fileUrl(tab.filePath)}?v=${Date.now()}`;

  h.querySelector('.img-toolbar').addEventListener('click', (e) => {
    const act = e.target.closest('[data-img]')?.dataset.img;
    if (act === 'in') zoomBy(1.25);
    else if (act === 'out') zoomBy(0.8);
    else if (act === 'fit') { view.mode = 'fit'; apply(); }
    else if (act === 'actual') { view.mode = 'zoom'; view.zoom = 1; apply(); }
  });
  // Ctrl / Cmd + wheel (and a trackpad pinch) zooms; the plain wheel scrolls
  stage.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.1 : 0.9);
  }, { passive: false });
  // drag to pan a zoomed picture
  let pan = null;
  stage.addEventListener('mousedown', (e) => { if (stage.classList.contains('zoomed')) { pan = { x: e.clientX, y: e.clientY, l: stage.scrollLeft, t: stage.scrollTop }; stage.classList.add('panning'); e.preventDefault(); } });
  window.addEventListener('mousemove', (e) => { if (pan) { stage.scrollLeft = pan.l - (e.clientX - pan.x); stage.scrollTop = pan.t - (e.clientY - pan.y); } });
  window.addEventListener('mouseup', () => { pan = null; stage.classList.remove('panning'); });
  stage.addEventListener('dblclick', () => { view.mode = view.mode === 'fit' ? 'zoom' : 'fit'; view.zoom = 1; apply(); });
  window.addEventListener('resize', () => { if (view.mode === 'fit' && h.contains(img)) apply(); });
}

/** A short message at the bottom of the window. */
export function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('out'), 3600);
  setTimeout(() => el.remove(), 4000);
}
