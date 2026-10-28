/** AI settings: provider list with a detail card per provider; Ollama installer with live progress, Bionic (LM Studio runtime). */
import { state } from './state.js';
import { saveAllConfig } from './save-hook.js';
import { escapeHtml } from './utils.js';
import { refreshModelSelectForProvider } from './chat.js';

const $ = (id) => document.getElementById(id);
const gb = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} ГБ` : `${Math.max(1, Math.round(bytes / 1e6))} МБ`);
const downloads = new Map(); // name -> row element
let progressBound = false;

function setPill(el, text, kind) {
  if (!el) return;
  el.textContent = text;
  el.className = `status-indicator ${kind || ''}`;
}

/** Switch the chat to a model: provider select, model select and saved config stay in step. */
async function useModel(provider, model) {
  state.currentAiProvider = provider;
  state.modelByProvider = { ...(state.modelByProvider || {}), [provider]: model };
  state.currentAiModel = model;
  const select = document.getElementById('ai-provider-select');
  if (select) select.value = provider;
  await refreshModelSelectForProvider();
  saveAllConfig();
  await Promise.all([refreshOllama(), refreshBionic()]);
}

// ───────────────────────── Ollama ─────────────────────────

const CAP_LABEL = { thinking: 'рассуждения', vision: 'зрение', tools: 'инструменты', embedding: 'эмбеддинги' };

function renderModels(info) {
  const box = $('ollama-models');
  if (!box) return;
  if (!info.running) {
    box.innerHTML = `<div class="ai-empty">${info.installed ? 'Ollama не запущена - нажмите «Запустить».' : 'Ollama не найдена. Скачайте её на ollama.com/download и вернитесь сюда.'}</div>`;
    return;
  }
  if (!info.models.length) {
    box.innerHTML = '<div class="ai-empty">Пока нет моделей. Введите имя модели ниже, чтобы установить.</div>';
    return;
  }
  box.innerHTML = info.models.map((m) => {
    const caps = (m.capabilities || []).filter((c) => CAP_LABEL[c] && c !== 'completion').map((c) => `<span class="model-badge">${CAP_LABEL[c]}</span>`).join('');
    const hot = info.loaded.includes(m.name) ? '<span class="model-badge hot">в памяти</span>' : '';
    const current = state.currentAiProvider === 'ollama' && state.currentAiModel === m.name;
    return `<div class="model-row${current ? ' current' : ''}" data-model="${escapeHtml(m.name)}">
      <span class="model-name" title="${escapeHtml(m.name)}">${escapeHtml(m.name)}</span>
      <span class="model-actions"><button type="button" data-act="use">${current ? 'Используется' : 'Использовать'}</button><button type="button" class="danger" data-act="delete" title="Удалить модель с диска">Удалить</button></span>
      <span class="model-sub"><span class="model-meta">${[m.params, m.quant, gb(m.size)].filter(Boolean).join(' · ')}</span>${hot}${caps}</span></div>`;
  }).join('');
}

export async function refreshOllama() {
  const pill = $('ollama-status');
  if (!pill || !window.electronAPI?.ollamaStatus) return null;
  const info = await window.electronAPI.ollamaStatus().catch(() => null);
  if (!info) { setPill(pill, 'Ошибка', 'error'); return null; }
  state.ollamaStatus = info;
  if (info.running) {
    setPill(pill, `Работает · ${info.version}`, 'connected');
    $('ollama-sub').textContent = `${info.models.length} ${info.models.length === 1 ? 'модель' : 'моделей'} установлено`;
  } else {
    setPill(pill, info.installed ? 'Остановлена' : 'Не установлена', 'not-configured');
    $('ollama-sub').textContent = 'Локальные модели на этом компьютере';
  }
  $('ollama-start-btn').hidden = info.running || !info.installed;
  const canInstall = info.running;
  $('ollama-pull-input').disabled = !canInstall;
  $('ollama-pull-btn').disabled = !canInstall;
  renderModels(info);
  return info;
}

function ensureProgressListener() {
  if (progressBound || !window.electronAPI?.onOllamaPullProgress) return;
  progressBound = true;
  window.electronAPI.onOllamaPullProgress((p) => {
    const row = downloads.get(p.name);
    if (!row) return;
    const bar = row.querySelector('.dl-bar > i');
    const stateEl = row.querySelector('.dl-state');
    const cancel = row.querySelector('.dl-cancel');
    if (p.error) {
      stateEl.textContent = p.error; stateEl.className = 'dl-state error'; cancel.remove();
    } else if (p.cancelled) {
      stateEl.textContent = 'Отменено'; cancel.remove();
    } else if (p.done) {
      bar.style.width = '100%'; stateEl.textContent = 'Установлено'; stateEl.className = 'dl-state done'; cancel.remove();
    } else {
      bar.style.width = `${p.percent.toFixed(1)}%`;
      stateEl.textContent = p.total ? `${p.percent.toFixed(0)}% · ${gb(p.completed)} из ${gb(p.total)}` : (p.status || '…');
    }
  });
}

async function startPull(rawName) {
  const name = String(rawName || '').trim();
  if (!name) return;
  ensureProgressListener();
  if (downloads.has(name)) return;
  const row = document.createElement('div');
  row.className = 'dl-row';
  row.innerHTML = `<div class="dl-head"><b></b><span class="dl-state">Подготовка…</span><button type="button" class="dl-cancel">Отмена</button></div><div class="dl-bar"><i></i></div>`;
  row.querySelector('b').textContent = name;
  row.querySelector('.dl-cancel').addEventListener('click', () => window.electronAPI.ollamaPullCancel(name));
  $('ollama-downloads').prepend(row);
  downloads.set(name, row);
  const res = await window.electronAPI.ollamaPull(name);
  downloads.delete(name);
  if (res?.success) {
    await refreshOllama();
    // The very first model becomes the chat's model right away.
    if (state.currentAiProvider === 'ollama' && !state.currentAiModel) await useModel('ollama', name);
    else refreshModelSelectForProvider().catch(() => {});
  }
  setTimeout(() => { if (!row.querySelector('.dl-cancel')) row.remove(); }, 6000);
}

// ───────────────────────── Bionic ─────────────────────────

function renderBionic(info) {
  const box = $('bionic-models');
  if (!info.models.length) {
    box.innerHTML = `<div class="ai-empty">${info.lmsPath ? 'Моделей не найдено. Скачайте модель в Bionic или LM Studio.' : 'Установите Bionic или LM Studio и запустите их один раз, чтобы появился CLI lms.'}</div>`;
    return;
  }
  box.innerHTML = info.models.map((m) => {
    const current = state.currentAiProvider === 'bionic' && state.currentAiModel === m.id;
    const badges = [m.vision ? 'зрение' : '', m.tools ? 'инструменты' : ''].filter(Boolean).map((b) => `<span class="model-badge">${b}</span>`).join('');
    return `<div class="model-row${current ? ' current' : ''}" data-model="${escapeHtml(m.id)}">
      <span class="model-name" title="${escapeHtml(m.id)}">${escapeHtml(m.name || m.id)}</span>
      <span class="model-actions"><button type="button" data-act="use">${current ? 'Используется' : 'Использовать'}</button></span>
      <span class="model-sub"><span class="model-meta">${[m.params, m.size ? gb(m.size) : ''].filter(Boolean).join(' · ')}</span>${badges}</span></div>`;
  }).join('');
}

export async function refreshBionic() {
  const pill = $('bionic-status');
  if (!pill || !window.electronAPI?.bionicStatus) return null;
  const info = await window.electronAPI.bionicStatus().catch(() => null);
  if (!info) { setPill(pill, 'Ошибка', 'error'); return null; }
  state.bionicStatus = info;
  if (!info.appInstalled && !info.lmsPath) setPill(pill, 'Не установлен', 'not-configured');
  else setPill(pill, info.running ? 'Сервер работает' : 'Сервер выключен', info.running ? 'connected' : 'not-configured');
  const btn = $('bionic-server-btn');
  btn.textContent = info.running ? 'Остановить сервер' : 'Запустить сервер';
  btn.disabled = !info.lmsPath;
  $('bionic-open-btn').disabled = !info.appInstalled;
  $('bionic-open-project-btn').disabled = !info.appInstalled;
  renderBionic(info);
  return info;
}


// ───────────────────────── provider list ─────────────────────────

const CARD_OF = { ollama: 'card-ollama', bionic: 'card-bionic', openrouter: 'card-openrouter', opencode: 'card-opencode', claude: 'card-claude', codex: 'card-codex' };
const customTests = new Map(); // provider id -> 'ok' | 'error'
const isCustom = (key) => String(key).startsWith('custom:');
const customById = (key) => (state.customProviders || []).find((p) => `custom:${p.id}` === key);
let shown = 'ollama';

function cardFor(key) {
  return isCustom(key) ? $('card-custom') : $(CARD_OF[key]);
}

function setStatus(el, text, kind) {
  if (el) { el.textContent = text; el.className = `status-indicator ${kind || ''}`; }
}

function fillCustomCard(key) {
  const p = customById(key);
  if (!p) return;
  $('custom-title').textContent = p.name || 'Свой провайдер';
  $('custom-name').value = p.name || '';
  $('custom-url').value = p.baseUrl || '';
  $('custom-key').value = p.apiKey || '';
  $('custom-models').innerHTML = '';
  const t = customTests.get(p.id);
  setStatus($('custom-status'), t === 'ok' ? 'Подключено' : t === 'error' ? 'Ошибка' : 'Не проверен', t === 'ok' ? 'connected' : t === 'error' ? 'error' : '');
}

function showCard(key) {
  if (isCustom(key) && !customById(key)) key = 'ollama';
  shown = key;
  document.querySelectorAll('#ai-nav [data-ai]').forEach((b) => b.classList.toggle('active', b.dataset.ai === key));
  document.querySelectorAll('.ai-detail .ai-card').forEach((c) => c.classList.remove('active'));
  cardFor(key)?.classList.add('active');
  if (isCustom(key)) fillCustomCard(key);
  try { localStorage.setItem('frogee.aiCard', key); } catch { /* ignore */ }
}

/** A dot next to each provider shows whether its first status pill says "ready". */
function syncNavDots() {
  document.querySelectorAll('#ai-nav [data-ai]').forEach((btn) => {
    const dot = btn.querySelector('.ai-dot');
    if (!dot) return;
    if (isCustom(btn.dataset.ai)) {
      const id = btn.dataset.ai.slice(7);
      dot.classList.toggle('on', customTests.get(id) === 'ok');
      dot.classList.toggle('err', customTests.get(id) === 'error');
      return;
    }
    const pill = cardFor(btn.dataset.ai)?.querySelector('.status-indicator');
    if (!pill) return;
    dot.classList.toggle('on', /connected|ok|ready|installed/.test(pill.className));
    dot.classList.toggle('err', /error|failed/.test(pill.className));
  });
}

/** Custom providers appear in the list on the left and in both provider selects (chat and default). */
export function syncProviderSelects() {
  for (const id of ['ai-provider-select', 'default-ai-provider']) {
    const select = $(id);
    if (!select) continue;
    const value = select.value;
    select.querySelectorAll('option[data-custom]').forEach((o) => o.remove());
    for (const p of state.customProviders || []) {
      const option = document.createElement('option');
      option.value = `custom:${p.id}`;
      option.textContent = p.name || 'Свой провайдер';
      option.dataset.custom = '1';
      select.appendChild(option);
    }
    if ([...select.options].some((o) => o.value === value)) select.value = value;
  }
  const nav = $('ai-nav');
  if (!nav) return;
  nav.querySelectorAll('[data-custom]').forEach((b) => b.remove());
  const add = $('ai-add-custom');
  for (const p of state.customProviders || []) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.ai = `custom:${p.id}`;
    btn.dataset.custom = '1';
    btn.innerHTML = '<i class="ai-dot"></i><span></span>';
    btn.lastChild.textContent = p.name || 'Свой провайдер';
    nav.insertBefore(btn, add);
  }
  nav.querySelectorAll('[data-ai]').forEach((b) => b.classList.toggle('active', b.dataset.ai === shown));
  syncNavDots();
}

function readCustomForm() {
  const p = customById(shown);
  if (!p) return null;
  p.name = $('custom-name').value.trim() || 'Свой провайдер';
  p.baseUrl = $('custom-url').value.trim().replace(/\/+$/, '');
  p.apiKey = $('custom-key').value.trim();
  return p;
}

async function saveCustom() {
  const p = readCustomForm();
  if (!p) return;
  customTests.delete(p.id);
  syncProviderSelects();
  showCard(`custom:${p.id}`);
  saveAllConfig();
  if (state.currentAiProvider === `custom:${p.id}`) await refreshModelSelectForProvider().catch(() => {});
}

async function testCustom() {
  const p = readCustomForm();
  if (!p) return;
  setStatus($('custom-status'), 'Проверка…', '');
  const res = await window.electronAPI.customModels({ baseUrl: p.baseUrl, apiKey: p.apiKey });
  customTests.set(p.id, res.success ? 'ok' : 'error');
  syncProviderSelects();
  saveAllConfig();
  if (res.success) {
    setStatus($('custom-status'), `Подключено · моделей: ${res.models.length}`, 'connected');
    $('custom-models').innerHTML = res.models.length
      ? res.models.map((m) => `<div class="model-row"><span class="model-name">${escapeHtml(m)}</span><span class="model-actions"><button type="button" data-use="${escapeHtml(m)}">Использовать</button></span></div>`).join('')
      : '<div class="ai-empty">Сервер не вернул список моделей.</div>';
  } else {
    setStatus($('custom-status'), 'Ошибка', 'error');
    $('custom-models').innerHTML = `<div class="ai-empty">${escapeHtml(res.error || 'Не удалось подключиться')}</div>`;
  }
}

function addCustom() {
  const id = Date.now().toString(36);
  state.customProviders = [...(state.customProviders || []), { id, name: 'Новый провайдер', baseUrl: '', apiKey: '' }];
  syncProviderSelects();
  showCard(`custom:${id}`);
  saveAllConfig();
  $('custom-name').focus();
  $('custom-name').select();
}

async function deleteCustom() {
  const p = customById(shown);
  if (!p || !confirm(`Удалить провайдера «${p.name}»?`)) return;
  state.customProviders = state.customProviders.filter((x) => x.id !== p.id);
  if (state.currentAiProvider === shown) { state.currentAiProvider = 'ollama'; state.currentAiModel = state.modelByProvider?.ollama || ''; }
  if (state.defaultAiProvider === shown) state.defaultAiProvider = 'ollama';
  syncProviderSelects();
  const sel = $('ai-provider-select'); if (sel) sel.value = state.currentAiProvider;
  const def = $('default-ai-provider'); if (def) def.value = state.defaultAiProvider;
  showCard('ollama');
  saveAllConfig();
  refreshModelSelectForProvider().catch(() => {});
}

function setupNav() {
  const nav = $('ai-nav');
  if (!nav) return;
  nav.addEventListener('click', (e) => {
    if (e.target.closest('#ai-add-custom')) { addCustom(); return; }
    const b = e.target.closest('[data-ai]');
    if (b) showCard(b.dataset.ai);
  });
  $('custom-save')?.addEventListener('click', saveCustom);
  $('custom-test')?.addEventListener('click', testCustom);
  $('custom-delete')?.addEventListener('click', deleteCustom);
  $('custom-models')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-use]');
    if (btn) await useModel(shown, btn.dataset.use);
  });
  let saved = 'ollama';
  try { saved = localStorage.getItem('frogee.aiCard') || saved; } catch { /* ignore */ }
  syncProviderSelects();
  showCard(CARD_OF[saved] || customById(saved) ? saved : 'ollama');
  const detail = document.querySelector('.ai-detail');
  if (detail) new MutationObserver(syncNavDots).observe(detail, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  syncNavDots();
}

// ───────────────────────── wiring ─────────────────────────

export async function refreshAiSettings() {
  await Promise.all([refreshOllama(), refreshBionic()]);
}

export function setupAiSettings() {
  setupNav();
  document.querySelector('[data-settings-tab="ai"]')?.addEventListener('click', refreshAiSettings);
  $('ollama-refresh-btn')?.addEventListener('click', refreshOllama);
  $('bionic-refresh-btn')?.addEventListener('click', refreshBionic);

  $('ollama-start-btn')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = 'Запуск…';
    const res = await window.electronAPI.ollamaStart();
    e.currentTarget.disabled = false;
    e.currentTarget.textContent = 'Запустить';
    if (!res.success) alert(res.error || 'Не удалось запустить Ollama');
    await refreshOllama();
    refreshModelSelectForProvider().catch(() => {});
  });

  $('ollama-pull-btn')?.addEventListener('click', () => { const input = $('ollama-pull-input'); startPull(input.value); input.value = ''; });
  $('ollama-pull-input')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { startPull(e.target.value); e.target.value = ''; } });
  $('ollama-models')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    const row = e.target.closest('.model-row');
    if (!btn || !row) return;
    const name = row.dataset.model;
    if (btn.dataset.act === 'use') await useModel('ollama', name);
    else if (btn.dataset.act === 'delete' && confirm(`Удалить модель «${name}» с диска?`)) {
      const res = await window.electronAPI.ollamaDelete(name);
      if (!res.success) alert(res.error || 'Не удалось удалить модель');
      if (state.currentAiProvider === 'ollama' && state.currentAiModel === name) state.currentAiModel = '';
      await refreshOllama();
      refreshModelSelectForProvider().catch(() => {});
    }
  });

  $('bionic-server-btn')?.addEventListener('click', async (e) => {
    const running = state.bionicStatus?.running;
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = running ? 'Остановка…' : 'Запуск…';
    const res = await window.electronAPI.bionicServer({ action: running ? 'stop' : 'start' });
    if (!res.success) alert(res.error || 'Не удалось выполнить команду');
    await refreshBionic();
    refreshModelSelectForProvider().catch(() => {});
  });
  $('bionic-open-btn')?.addEventListener('click', async () => { const r = await window.electronAPI.bionicOpen(); if (!r.success) alert(r.error); });
  $('bionic-open-project-btn')?.addEventListener('click', async () => {
    const r = await window.electronAPI.bionicOpen(state.currentFolder || undefined);
    if (!r.success) alert(r.error);
  });
  $('bionic-models')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act="use"]');
    const row = e.target.closest('.model-row');
    if (btn && row) await useModel('bionic', row.dataset.model);
  });

  document.addEventListener('click', (e) => {
    const link = e.target.closest('[data-external]');
    if (link) { e.preventDefault(); window.electronAPI.openExternal(link.dataset.external); }
  });
}
