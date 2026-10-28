/**
 * AI suggestions in the editor: after a pause the model proposes what comes next, shown as grey text after the caret
 * (the first line inline, the rest of a block in a small card). Tab accepts it all, Cmd/Ctrl+Right one word, Esc dismisses.
 */
import { state } from './state.js';
import { isEditorTab } from './tab-model.js';
import { escapeHtml } from './utils.js';

const KEY = 'frogee.complete';
const DELAY = 600;
const MAX_FILE = 300000;
const OFF_LANGS = new Set(['plain', 'md', 'json', 'yaml', 'ini', 'toml']);
const LOCAL = new Set(['ollama', 'bionic']);

let cfg = { enabled: false, provider: 'ollama', model: '' };
try { Object.assign(cfg, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* defaults */ }
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ } };

let timer = 0;
let seq = 0;
let version = 0;
let ghost = null; // { text, at }
let card = null;

const ta = () => document.getElementById('editor');
const layer = () => document.getElementById('ghost-layer');
const $ = (id) => document.getElementById(id);
const acOpen = () => !!document.querySelector('.ac-popup:not([hidden])');

function setBusy(on) {
  const el = $('status-complete');
  if (el) el.hidden = !on;
}

// ───────────────────────── drawing ─────────────────────────

function caretXY(el) {
  const cs = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  const zoom = rect.width / (el.offsetWidth || rect.width) || 1;
  const lh = parseFloat(cs.lineHeight) || 22;
  const before = el.value.slice(0, el.selectionStart);
  const line = before.split('\n').length - 1;
  const lineText = before.slice(before.lastIndexOf('\n') + 1);
  const tab = parseInt(cs.tabSize, 10) || 4;
  let col = 0;
  for (const ch of lineText) col += ch === '\t' ? tab - (col % tab) : 1;
  const ctx = (caretXY.ctx ||= document.createElement('canvas').getContext('2d'));
  ctx.font = `${cs.fontSize} ${cs.fontFamily}`;
  return {
    x: rect.left + (parseFloat(cs.paddingLeft) + col * ctx.measureText('M').width - el.scrollLeft) * zoom,
    y: rect.top + (parseFloat(cs.paddingTop) + (line + 1) * lh - el.scrollTop) * zoom,
  };
}

function ensureCard() {
  if (card) return card;
  card = document.createElement('div');
  card.className = 'ghost-card';
  card.hidden = true;
  document.body.appendChild(card);
  return card;
}

function clear() {
  ghost = null;
  const l = layer();
  if (l) l.innerHTML = '';
  if (card) card.hidden = true;
}

function render() {
  const el = ta();
  const l = layer();
  if (!ghost || !el || !l) return clear();
  const eol = el.value.indexOf('\n', ghost.at);
  const inline = !el.value.slice(ghost.at, eol < 0 ? undefined : eol).trim();
  const nl = ghost.text.indexOf('\n');
  // Inline: the first line is drawn after the caret. Otherwise (brackets follow the caret) everything goes into the card.
  const first = !inline ? '' : nl < 0 ? ghost.text : ghost.text.slice(0, nl);
  const rest = !inline ? ghost.text : nl < 0 ? '' : ghost.text.slice(nl + 1);
  l.innerHTML = first ? `${escapeHtml(el.value.slice(0, ghost.at))}<span class="ghost-text">${escapeHtml(first)}</span>` : '';
  l.scrollTop = el.scrollTop;
  l.scrollLeft = el.scrollLeft;
  const c = ensureCard();
  if (!rest.trim()) { c.hidden = true; return; }
  const tab = state.currentTabs[state.activeTabIndex];
  const code = window.SyntaxHighlight ? window.SyntaxHighlight.highlight(rest, tab?.name || '') : escapeHtml(rest);
  const hint = (typeof window !== 'undefined' && window.__frogeeT)
    ? window.__frogeeT('complete.hint')
    : 'Tab - accept · Cmd/Ctrl+→ - word · Esc - dismiss';
  c.innerHTML = `<pre>${code}</pre><div class="ghost-hint">${hint}</div>`;
  c.hidden = false;
  if (el.classList.contains('word-wrap')) {
    const r = el.getBoundingClientRect();
    c.style.left = `${r.left + 24}px`;
    c.style.top = `${r.bottom - c.offsetHeight - 16}px`;
  } else {
    const { x, y } = caretXY(el);
    const h = c.offsetHeight;
    c.style.left = `${Math.max(8, Math.min(x - 8, window.innerWidth - c.offsetWidth - 12))}px`;
    c.style.top = `${y + h + 8 > window.innerHeight ? Math.max(8, y - h - 28) : y + 4}px`;
  }
}

// ───────────────────────── asking ─────────────────────────

function eligible() {
  const el = ta();
  const tab = state.currentTabs[state.activeTabIndex];
  if (!cfg.enabled || !cfg.model || !el || !isEditorTab(tab)) return false;
  if (el.selectionStart !== el.selectionEnd || el.value.length > MAX_FILE) return false;
  const lang = window.SyntaxHighlight?.detectLanguage(tab.name || '') || 'plain';
  if (OFF_LANGS.has(lang)) return false;
  const caret = el.selectionStart;
  const eol = el.value.indexOf('\n', caret);
  // After the caret there may be only closing brackets (an auto-paired "}"): then the suggestion goes into the card.
  if (!/^[\s)\]}>"'`;,]*$/.test(el.value.slice(caret, eol < 0 ? undefined : eol))) return false;
  if (!el.value.slice(0, caret).trim()) return false;
  return !acOpen();
}

async function ask() {
  if (!eligible()) return;
  const el = ta();
  const tab = state.currentTabs[state.activeTabIndex];
  const caret = el.selectionStart;
  const v = version;
  const id = `c${++seq}`;
  const job = {
    id, provider: cfg.provider, model: cfg.model,
    prefix: el.value.slice(Math.max(0, caret - 6000), caret), suffix: el.value.slice(caret, caret + 1500),
    fileName: tab.name, lang: window.SyntaxHighlight?.detectLanguage(tab.name || '') || '',
  };
  const custom = String(cfg.provider).startsWith('custom:') ? (state.customProviders || []).find((p) => `custom:${p.id}` === cfg.provider) : null;
  if (custom) job.custom = { baseUrl: custom.baseUrl, apiKey: custom.apiKey };
  setBusy(true);
  const res = await window.electronAPI.aiComplete(job).catch(() => null);
  setBusy(false);
  if (v !== version || ta().selectionStart !== caret || ta().selectionEnd !== caret) return; // the user moved on
  if (res?.success && res.text) { ghost = { text: res.text, at: caret }; render(); }
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(ask, DELAY);
}

function cancelPending() {
  clearTimeout(timer);
  window.electronAPI?.aiCompleteCancel?.(`c${seq}`);
  setBusy(false);
}

// ───────────────────────── accepting ─────────────────────────

function insert(text) {
  const el = ta();
  el.focus();
  if (!document.execCommand('insertText', false, text)) { el.setRangeText(text, el.selectionStart, el.selectionEnd, 'end'); el.dispatchEvent(new Event('input', { bubbles: true })); }
}

function acceptAll() {
  if (!ghost) return;
  const text = ghost.text;
  clear();
  insert(text);
}

function acceptWord() {
  if (!ghost) return;
  const nl = ghost.text.indexOf('\n');
  const line = nl < 0 ? ghost.text : ghost.text.slice(0, nl);
  const m = /^\s*[\w$]+|^\s*[^\w\s]+/.exec(line);
  const piece = m ? m[0] : line;
  if (!piece) return acceptAll();
  const remaining = ghost.text.slice(piece.length);
  clear();
  insert(piece);
  if (remaining.trim()) { ghost = { text: remaining, at: ta().selectionStart }; render(); }
}

// ───────────────────────── wiring ─────────────────────────

function onInput(e) {
  version++;
  const el = ta();
  // Typing what the model suggested keeps the rest of the suggestion on screen.
  if (ghost && e.inputType === 'insertText' && e.data && e.data.length === 1 && ghost.text.startsWith(e.data) && el.selectionStart === ghost.at + 1) {
    ghost = { text: ghost.text.slice(1), at: ghost.at + 1 };
    if (ghost.text.trim()) { render(); return; }
  }
  clear();
  cancelPending();
  if (!cfg.enabled) return;
  if (e.inputType && !/^(insert|delete)/.test(e.inputType)) return;
  schedule();
}

export function setupCompletion() {
  const el = ta();
  if (!el) return;
  el.addEventListener('input', onInput);
  el.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return; // the word list took this key
    if (!ghost) {
      // Ctrl+Space already belongs to the word list; Alt+\ asks the model right now.
      if (e.altKey && e.key === '\\' && cfg.enabled) { e.preventDefault(); clearTimeout(timer); ask(); }
      return;
    }
    if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !acOpen()) { e.preventDefault(); e.stopPropagation(); acceptAll(); }
    else if (e.key === 'ArrowRight' && (e.metaKey || e.ctrlKey) && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); acceptWord(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); clear(); version++; }
    else if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key) && !(e.key.length === 1 && !e.metaKey && !e.ctrlKey)) { clear(); }
  }, true);
  ['mousedown', 'blur', 'scroll'].forEach((evt) => el.addEventListener(evt, () => { if (evt === 'scroll') { render(); return; } clear(); cancelPending(); version++; }));
  setupSettings();
}

// ───────────────────────── settings ─────────────────────────

async function modelsFor(provider) {
  const api = window.electronAPI;
  if (provider === 'ollama') return ((await api.ollamaStatus().catch(() => null))?.models || []).map((m) => m.name);
  if (provider === 'bionic') return ((await api.bionicStatus().catch(() => null))?.models || []).map((m) => m.id);
  if (provider === 'openrouter') {
    if (!state.openRouterModels?.length) { const r = await api.getOpenRouterModels().catch(() => null); if (r?.success) state.openRouterModels = r.models; }
    return (state.openRouterModels || []).map((m) => m.id).sort();
  }
  const custom = (state.customProviders || []).find((p) => `custom:${p.id}` === provider);
  if (custom?.baseUrl) { const r = await api.customModels({ baseUrl: custom.baseUrl, apiKey: custom.apiKey }).catch(() => null); return r?.success ? r.models : []; }
  return [];
}

function fillProviders() {
  const select = $('ai-complete-provider');
  if (!select) return;
  const options = [['ollama', 'Ollama (локально)'], ['bionic', 'Bionic / LM Studio (локально)'], ['openrouter', 'OpenRouter (облако)'], ...(state.customProviders || []).map((p) => [`custom:${p.id}`, `${p.name || 'Свой провайдер'} (свой сервер)`])];
  select.innerHTML = options.map(([v, l]) => `<option value="${escapeHtml(v)}">${escapeHtml(l)}</option>`).join('') + '<option value="__add">Добавить своего провайдера…</option>';
  if (options.some(([v]) => v === cfg.provider)) select.value = cfg.provider; else { cfg.provider = 'ollama'; select.value = 'ollama'; }
  const note = $('ai-complete-note');
  if (note) note.textContent = LOCAL.has(cfg.provider) ? 'Модель работает на этом компьютере.' : 'Код вокруг курсора отправляется выбранному провайдеру.';
}

/** Fills the suggestions of the model field. Local providers pick an installed model when none is set; for the cloud the name is the user's. */
async function fillModels() {
  const input = $('ai-complete-model');
  const list = $('ai-complete-models');
  if (!input || !list) return;
  const names = await modelsFor(cfg.provider);
  list.innerHTML = names.map((m) => `<option value="${escapeHtml(m)}"></option>`).join('');
  if (!cfg.model && LOCAL.has(cfg.provider) && names.length) { cfg.model = names[0]; persist(); }
  input.value = cfg.model || '';
}

function setupSettings() {
  const enabled = $('ai-complete-enabled');
  if (!enabled) return;
  enabled.checked = !!cfg.enabled;
  enabled.addEventListener('change', () => { cfg.enabled = enabled.checked; persist(); if (!cfg.enabled) { clear(); cancelPending(); } });
  const refresh = async () => { fillProviders(); await fillModels(); };
  $('ai-complete-provider')?.addEventListener('change', async (e) => {
    if (e.target.value === '__add') {
      // A new provider is described in the AI settings (address, key); come back here afterwards.
      e.target.value = cfg.provider;
      document.querySelector('[data-settings-tab="ai"]')?.click();
      document.getElementById('ai-add-custom')?.click();
      return;
    }
    cfg.provider = e.target.value; cfg.model = ''; persist(); fillProviders(); await fillModels();
  });
  $('ai-complete-model')?.addEventListener('input', (e) => { cfg.model = e.target.value.trim(); persist(); });
  document.querySelector('[data-settings-tab="editor"]')?.addEventListener('click', refresh);
  document.getElementById('settings-btn')?.addEventListener('click', refresh);
  refresh();
}
