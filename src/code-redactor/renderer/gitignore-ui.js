/** Explorer side of .gitignore: dimmed entries, "hide ignored" switch and a box listing the rules. */
import { state } from './state.js';
import { escapeHtml } from './utils.js';
import { openSearchFile } from './explorer.js';

const KEY = 'frogee.hideIgnored';
let open = false;
const plural = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'правило' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'правила' : 'правил');

export function isIgnoredHidden() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function toggleHideIgnored(onChange) {
  try { localStorage.setItem(KEY, isIgnoredHidden() ? '0' : '1'); } catch { /* ignore */ }
  paintToggle();
  onChange?.();
}

function paintToggle() {
  const btn = document.getElementById('toggle-ignored-btn');
  if (!btn) return;
  const hidden = isIgnoredHidden();
  btn.classList.toggle('active', hidden);
  btn.title = hidden ? 'Показать файлы из .gitignore' : 'Скрыть файлы из .gitignore';
}

export async function refreshGitignoreBox() {
  paintToggle();
  const box = document.getElementById('gitignore-box');
  if (!box) return;
  if (!state.currentFolder) { box.innerHTML = ''; return; }
  const info = await window.electronAPI.gitignoreInfo(state.currentFolder);
  if (!info?.success || !info.isRepo || !info.file) { box.innerHTML = ''; return; }
  const rows = info.rules.map((r) => {
    const comment = r.text.trim().startsWith('#');
    const neg = r.text.trim().startsWith('!');
    return `<div class="gi-rule${comment ? ' comment' : neg ? ' neg' : ''}"><span class="gi-line">${r.line}</span><code>${escapeHtml(r.text)}</code></div>`;
  }).join('');
  box.innerHTML = `
    <button type="button" class="gi-head${open ? ' open' : ''}" id="gi-toggle"><span class="tree-twistie ${open ? 'open' : ''}" aria-hidden="true"></span>.gitignore<span class="gi-count">${info.active} ${plural(info.active)}</span></button>
    ${open ? `<div class="gi-body">${rows}<button type="button" class="gi-open" id="gi-open">Открыть .gitignore</button></div>` : ''}`;
  document.getElementById('gi-toggle').addEventListener('click', () => { open = !open; refreshGitignoreBox(); });
  document.getElementById('gi-open')?.addEventListener('click', () => openSearchFile(info.file));
}
