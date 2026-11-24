import { paintAgentThread } from './agent-thread.js';
import { state } from './state.js';
import { getDom } from './dom.js';
import { saveAllConfig } from './save-hook.js';
import { escapeHtml, sanitizeHtml } from './utils.js';
import { isEditorTab } from './tab-model.js';
import { icon } from './glyphs.js';
import { getLang, onLangChange } from './i18n.js';

const dom = getDom();

const AGENT_BY_PROVIDER = { 'claude-code': 'claude', codex: 'codex' };
const isProjectAgent = (provider) => provider === 'opencode' || Object.hasOwn(AGENT_BY_PROVIDER, provider);
const tr = (ru, en) => getLang() === 'en' ? en : ru;
const PROVIDER_NAMES = { ollama: 'Ollama', bionic: 'Bionic', openrouter: 'OpenRouter', opencode: 'OpenCode', 'claude-code': 'Claude Code', codex: 'Codex' };
const customOf = (key) => (String(key).startsWith('custom:') ? (state.customProviders || []).find((p) => `custom:${p.id}` === key) : null);
const providerLabel = (key) => PROVIDER_NAMES[key] || customOf(key)?.name || 'AI';
const HISTORY_LIMIT = 16;
const HISTORY_CHARS = 24000;
const FILE_CONTEXT_CHARS = 14000;

let stream = null; // live state of the answer being written
let renderFrame = 0;

// ───────────────────────── markdown rendering ─────────────────────────

/** Answers are shown without emoji (the interface does not use them). */
const stripEmoji = (text) => String(text || '').replace(/[\p{Emoji_Presentation}\u{FE0F}\u{200D}]/gu, '').replace(/[ \t]+\n/g, '\n');

function renderMd(text) {
  text = stripEmoji(text);
  try {
    const html = window.marked?.parse ? window.marked.parse(text || '', { breaks: true, gfm: true }) : escapeHtml(text || '').replace(/\n/g, '<br>');
    return sanitizeHtml(html);
  } catch {
    return escapeHtml(text || '').replace(/\n/g, '<br>');
  }
}

const COPY_ICON = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><rect x="5.5" y="5.5" width="7" height="7" rx="1.5"/><path d="M3.5 10V4.5a1 1 0 0 1 1-1H10"/></svg>';

/** Wrap every <pre><code> in a card with the language, Copy, Insert and New file actions. */
function enhanceCode(container) {
  container.querySelectorAll('pre').forEach((pre) => {
    if (pre.parentElement?.classList.contains('code-card')) return;
    const code = pre.querySelector('code');
    if (!code) return;
    const lang = (/language-([\w+#-]+)/.exec(code.className) || [])[1] || '';
    const text = code.textContent.replace(/\n$/, '');
    if (window.SyntaxHighlight && lang) code.innerHTML = window.SyntaxHighlight.highlightByName(text, lang);
    const card = document.createElement('div');
    card.className = 'code-card';
    card.innerHTML = `<div class="code-head"><span class="code-lang">${escapeHtml(lang || 'код')}</span><span class="code-actions">
      <button type="button" data-code="copy" title="Скопировать">${COPY_ICON}Копировать</button>
      <button type="button" class="code-apply" data-code="apply" title="Применить к открытому файлу: правки подсветятся, их нужно подтвердить">Применить</button>
      <button type="button" data-code="insert" title="Вставить в редактор на место курсора">Вставить</button>
      <button type="button" data-code="newfile" title="Открыть в новой вкладке">В файл</button></span></div>`;
    pre.replaceWith(card);
    card.appendChild(pre);
    card.dataset.text = text;
    card.dataset.lang = lang;
  });
}

async function onCodeAction(btn) {
  const card = btn.closest('.code-card');
  if (!card) return;
  const text = card.dataset.text || '';
  const action = btn.dataset.code;
  if (action === 'copy') {
    try { await navigator.clipboard.writeText(text); btn.lastChild.textContent = 'Скопировано'; } catch { btn.lastChild.textContent = 'Не удалось'; }
    setTimeout(() => { btn.lastChild.textContent = 'Копировать'; }, 1400);
  } else if (action === 'apply') {
    const { applyCode } = await import('./ai-review.js');
    if (!applyCode(text, card.dataset.lang)) await openAsNewFile(text, card.dataset.lang);
  } else if (action === 'insert') {
    const tab = state.currentTabs[state.activeTabIndex];
    if (isEditorTab(tab) && dom.editor) {
      dom.editor.focus();
      document.execCommand('insertText', false, text);
    } else {
      await openAsNewFile(text, card.dataset.lang);
    }
  } else if (action === 'newfile') {
    await openAsNewFile(text, card.dataset.lang);
  }
}

async function openAsNewFile(text, lang) {
  const { createTab, hideWelcomePage } = await import('./tabs.js');
  const ext = { javascript: 'js', typescript: 'ts', python: 'py', bash: 'sh', shell: 'sh', markdown: 'md' }[lang] || lang || 'txt';
  hideWelcomePage();
  createTab(`snippet.${ext}`, text, null);
}

// ───────────────────────── providers and models ─────────────────────────

export function handleAiProviderChange() {
  if (!dom.aiProviderSelect) return;
  if (state.isTyping) {
    dom.aiProviderSelect.value = state.currentAiProvider;
    return;
  }
  state.currentAiProvider = dom.aiProviderSelect.value;
  if (dom.openRouterSection) dom.openRouterSection.style.display = state.currentAiProvider === 'openrouter' ? 'block' : 'none';
  state.currentAiModel = state.modelByProvider?.[state.currentAiProvider] || '';
  updateAgentControls();
  refreshModelSelectForProvider().catch((err) => console.error(err));
  saveAllConfig();
}

function fillSelect(options, selected) {
  dom.aiModelSelect.innerHTML = '';
  for (const [value, label, disabled] of options) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    if (disabled) option.disabled = true;
    dom.aiModelSelect.appendChild(option);
  }
  const values = options.filter((o) => !o[2] && !String(o[0]).startsWith('__')).map((o) => o[0]);
  if (selected && values.includes(selected)) dom.aiModelSelect.value = selected;
  else if (values.length) dom.aiModelSelect.value = values[0];
  state.currentAiModel = dom.aiModelSelect.value || '';
  rememberModel();
}

function rememberModel() {
  state.modelByProvider = { ...(state.modelByProvider || {}), [state.currentAiProvider]: state.currentAiModel };
}

const formatSize = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} ${getLang() === 'en' ? 'GB' : 'ГБ'}` : `${Math.round(bytes / 1e6)} ${getLang() === 'en' ? 'MB' : 'МБ'}`);

export async function refreshModelSelectForProvider() {
  if (!dom.aiModelSelect) return;
  const provider = state.currentAiProvider;
  if (dom.aiProviderSelect && dom.aiProviderSelect.value !== provider) dom.aiProviderSelect.value = provider;
  const keep = state.currentAiModel || state.modelByProvider?.[provider] || '';

  if (provider === 'ollama') {
    fillSelect([['', 'Загрузка моделей…', true]], '');
    const info = await window.electronAPI.ollamaStatus().catch(() => null);
    state.ollamaStatus = info;
    if (provider !== state.currentAiProvider) return;
    if (!info?.running) {
      fillSelect([['', info?.installed ? 'Ollama не запущена' : 'Ollama не установлена', true], ['__settings', 'Открыть настройки…']], '');
      return;
    }
    const models = info.models.map((m) => [m.name, `${m.name}${m.params ? ` · ${m.params}` : ''}`]);
    fillSelect(models.length ? [...models, ['__install', 'Установить модель…']] : [['', 'Нет установленных моделей', true], ['__install', 'Установить модель…']], keep);
    return;
  }

  if (provider === 'bionic') {
    fillSelect([['', 'Загрузка моделей…', true]], '');
    const info = await window.electronAPI.bionicStatus().catch(() => null);
    state.bionicStatus = info;
    if (provider !== state.currentAiProvider) return;
    const models = (info?.models || []).map((m) => [m.id, `${m.name || m.id}${m.params ? ` · ${m.params}` : ''}`]);
    fillSelect(models.length ? [...models, ...(info.running ? [] : [['__settings', 'Сервер выключен - настройки…']])] : [['', info?.lmsPath ? 'Нет моделей' : 'Bionic / LM Studio не найден', true], ['__settings', 'Открыть настройки…']], keep);
    return;
  }

  if (provider === 'openrouter') {
    if (!state.openRouterModels?.length) {
      const res = await window.electronAPI.getOpenRouterModels().catch(() => null);
      if (res?.success) state.openRouterModels = res.models;
    }
    updateOpenRouterModelSelect();
    return;
  }

  if (AGENT_BY_PROVIDER[provider]) {
    updateAgentControls();
    return;
  }

  const custom = customOf(provider);
  if (provider.startsWith('custom:')) {
    if (!custom?.baseUrl) { fillSelect([['', 'Адрес API не указан', true], ['__settings', 'Открыть настройки…']], ''); return; }
    fillSelect([['', 'Загрузка моделей…', true]], '');
    const res = await window.electronAPI.customModels({ baseUrl: custom.baseUrl, apiKey: custom.apiKey });
    if (provider !== state.currentAiProvider) return;
    if (!res.success || !res.models.length) {
      fillSelect([['', res.success ? 'Сервер не вернул моделей' : `Ошибка: ${res.error}`, true], ['__settings', 'Открыть настройки…']], '');
      return;
    }
    fillSelect(res.models.map((id) => [id, id]), keep);
    return;
  }

  if (provider === 'opencode') {
    const directory = state.currentFolder;
    const baseUrl = document.getElementById('opencode-url')?.value || state.opencodeBaseUrl || 'http://127.0.0.1:4096';
    state.opencodeBaseUrl = baseUrl;
    fillSelect([['', 'Загрузка моделей OpenCode…', true]], '');
    const res = await window.electronAPI.opencodeModels({ baseUrl, directory: directory || null });
    if (provider !== state.currentAiProvider || directory !== state.currentFolder || baseUrl !== state.opencodeBaseUrl) return;
    if (!res.success || !res.models?.length) {
      fillSelect([['', res.error ? `OpenCode: ${res.error}` : 'Нет моделей (запустите opencode serve)', true], ['__settings', 'Открыть настройки…']], '');
      updateOpenCodeStatus(res.success ? 'empty' : 'error');
      return;
    }
    updateOpenCodeStatus('connected');
    state.openCodeModels = res.models;
    fillSelect(res.models.filter((m) => m.enabled !== false).map((m) => [m.id, m.name && m.name !== m.modelID ? `${m.name} (${m.id})` : m.id]), keep);
  }
}

export function updateOpenCodeStatus(status) {
  const el = document.getElementById('opencode-status');
  if (!el) return;
  const map = { connected: 'Подключён', disconnected: 'Недоступен', error: 'Ошибка', empty: 'Нет моделей', 'not-checked': 'Не проверен' };
  el.textContent = map[status] || status;
  el.className = `status-indicator ${status}`;
}

export function updateOpenRouterModelSelect() {
  if (!dom.aiModelSelect || state.currentAiProvider !== 'openrouter') return;
  const models = (state.openRouterModels || []).map((m) => [m.id, m.name || m.id]).sort((x, y) => x[1].localeCompare(y[1]));
  if (!models.length) { fillSelect([['', 'Нет списка моделей - сохраните ключ в настройках', true], ['__settings', 'Открыть настройки…']], ''); return; }
  fillSelect(models, state.currentAiModel || state.modelByProvider?.openrouter);
}

export function handleAiModelChange() {
  const value = dom.aiModelSelect.value;
  if (value === '__install' || value === '__settings') {
    dom.aiModelSelect.value = state.currentAiModel || '';
    openAiSettings(value === '__install' ? 'ollama' : state.currentAiProvider);
    return;
  }
  state.currentAiModel = value;
  rememberModel();
  saveAllConfig();
}

function openAiSettings(card) {
  const modal = document.getElementById('modal-settings');
  if (modal) modal.style.display = 'flex';
  document.querySelector('[data-settings-tab="ai"]')?.click();
  setTimeout(() => document.getElementById(`card-${card}`)?.scrollIntoView({ block: 'start' }), 80);
}

export async function saveOpenRouterKey() {
  const apiKey = dom.openRouterKeyInput.value.trim();
  if (!apiKey) { alert('Введите API-ключ OpenRouter'); return; }
  try {
    const result = await window.electronAPI.setOpenRouterKey(apiKey);
    if (result.success) {
      updateOpenRouterStatus('connected');
      dom.openRouterKeyInput.value = '';
      try {
        const models = await window.electronAPI.getOpenRouterModels();
        if (models.success) { state.openRouterModels = models.models; updateOpenRouterModelSelect(); }
      } catch (error) { console.error('Ошибка загрузки моделей OpenRouter:', error); }
      saveAllConfig();
    } else {
      alert('Ошибка сохранения ключа: ' + result.error);
    }
  } catch (error) {
    alert('Ошибка: ' + error.message);
  }
}

export function updateDefaultAiProvider() {
  state.defaultAiProvider = dom.defaultAiProviderSelect.value;
  saveAllConfig();
}

export async function initializeOpenRouter() {
  try {
    const key = await window.electronAPI.getOpenRouterKey();
    if (key) {
      if (dom.openRouterKeyInput) dom.openRouterKeyInput.value = key;
      updateOpenRouterStatus('connected');
    } else {
      updateOpenRouterStatus('not-configured');
    }
  } catch (error) {
    console.error('Ошибка инициализации OpenRouter:', error);
    updateOpenRouterStatus('error');
  }
}

export function updateOpenRouterStatus(status) {
  if (!dom.openRouterStatus) return;
  dom.openRouterStatus.textContent = { connected: 'Ключ сохранён', disconnected: 'Ошибка подключения', 'not-configured': 'Не настроен', error: 'Ошибка' }[status] || status;
  dom.openRouterStatus.className = `status-indicator ${status === 'connected' ? 'connected' : status}`;
}

// ───────────────────────── chats (history) ─────────────────────────

const STORE = 'frogee.chats.v1';
const WIDTH_KEY = 'frogee.chat.width';
const DEFAULT_WIDTH = 380;
const MIN_WIDTH = 250;
const WIDE = 640;
let chats = [];
let chat = null;
let workspace = null;
let editingIndex = -1;

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const snippet = (text, n = 40) => { const flat = String(text).replace(/\s+/g, ' ').trim(); return flat.length > n ? flat.slice(0, n) + '…' : flat; };

function readChats() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE));
    return Array.isArray(saved) ? saved : null;
  } catch { return null; }
}

function loadChats() {
  chats = readChats() || [];
  // A conversation from before the history existed becomes the first saved chat.
  if (!chats.length && Array.isArray(state.chatHistory) && state.chatHistory.length) {
    chats.push({
      id: uid(), title: snippet(state.chatHistory.find((m) => m.sender === 'user')?.content || 'Диалог'), updated: Date.now(),
      messages: state.chatHistory.filter((m) => m.content).map((m) => ({ role: m.sender === 'user' ? 'user' : 'assistant', content: m.content, thinking: m.thinking || '', stats: m.stats || '', who: m.who || '' })),
    });
    saveChats();
  }
}

function saveChats(removedId) {
  chats = (readChats() || chats).filter((item) => item.messages?.length && item.id !== removedId && item.id !== chat?.id);
  if (chat && chat.messages.length && chat.id !== removedId) chats.push(chat);
  chats.sort((a, b) => b.updated - a.updated);
  chats = chats.slice(0, 30);
  let json = JSON.stringify(chats);
  while (json.length > 2e6 && chats.length > 1) { chats.pop(); json = JSON.stringify(chats); }
  try { localStorage.setItem(STORE, json); } catch { /* storage full: the chat keeps working until the app is closed */ }
}

function newChat() {
  chat = { id: uid(), workspace, title: 'Новый чат', updated: Date.now(), messages: [] };
  editingIndex = -1;
}

function ensureChat() {
  if (chat) return;
  loadChats();
  workspace = state.currentFolder || '';
  chat = chats.find((item) => item.workspace === workspace) || null;
  if (!chat) newChat();
  restoreProvider();
}

function resetComposer() {
  dom.userInput.value = '';
  dom.userInput.style.height = 'auto';
  state.contextFiles = [];
  renderAttachments();
}

function restoreProvider() {
  const provider = chat.provider;
  if (provider && Array.from(dom.aiProviderSelect.options).some((option) => option.value === provider)) {
    state.currentAiProvider = provider;
    state.currentAiModel = chat.model ?? state.modelByProvider?.[provider] ?? '';
  }
  updateAgentControls();
  if (state.chatVisible) refreshModelSelectForProvider().catch(() => {});
}

function syncWorkspace() {
  const next = state.currentFolder || '';
  if (!chat || next === workspace) return;
  if (state.isTyping) {
    stopChatResponse();
    return;
  }
  workspace = next;
  chats = readChats() || chats;
  newChat();
  chat = chats.find((item) => item.workspace === workspace) || chat;
  resetComposer();
  showHistory(false);
  restoreProvider();
  renderChat();
}

function updateAgentControls() {
  const cli = Object.hasOwn(AGENT_BY_PROVIDER, state.currentAiProvider);
  const projectAgent = isProjectAgent(state.currentAiProvider);
  const modelField = document.getElementById('chat-agent-model');
  modelField.hidden = !cli;
  dom.aiModelSelect.hidden = cli;
  modelField.placeholder = tr('Модель', 'Model');
  modelField.title = tr('Оставьте поле пустым для модели по умолчанию', 'Leave empty to use the CLI default model');
  modelField.setAttribute('aria-label', modelField.placeholder);
  if (cli && document.activeElement !== modelField) modelField.value = state.currentAiModel;
  const access = document.getElementById('chat-agent-access');
  access.hidden = !cli;
  access.value = chat?.access || state.agentAccess;
  access.title = tr('Доступ агента', 'Agent access');
  access.querySelector('[value="read"]').textContent = tr('Чтение', 'Read only');
  access.querySelector('[value="edit"]').textContent = tr('Правки проекта', 'Edit project');
  document.getElementById('chat-think-btn').hidden = projectAgent;
  const project = document.getElementById('chat-project');
  project.hidden = !projectAgent;
  const folder = state.currentFolder || '';
  project.textContent = folder.split(/[\\/]/).filter(Boolean).at(-1) || folder || tr('Откройте папку проекта', 'Open a project folder');
  project.title = folder;
  if (dom.chatMessages?.querySelector('.chat-empty')) {
    dom.chatMessages.querySelector('.chat-empty').remove();
    renderEmptyState();
  }
}

// ───────────────────────── panel ─────────────────────────

export function toggleChat() {
  state.chatVisible = !state.chatVisible;
  document.getElementById('workspace-main').classList.toggle('chat-open', state.chatVisible);
  dom.chatBtn.setAttribute('aria-pressed', String(state.chatVisible));
  if (state.chatVisible) {
    dom.chatPanel.style.display = 'flex';
    document.getElementById('chat-resizer')?.style.setProperty('display', 'block');
    dom.chatBtn.classList.add('active');
    applyChatWidth(chatWidth(), false);
    loadChatHistory();
    updateContextChip();
    renderAttachments();
    updateAgentControls();
    if (!state.isTyping) refreshModelSelectForProvider().catch(() => {});
    dom.userInput.focus();
  } else {
    dom.chatPanel.style.display = 'none';
    document.getElementById('chat-resizer')?.style.setProperty('display', 'none');
    dom.chatBtn.classList.remove('active');
  }
}

export function handleChatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    handleChatSubmit();
  }
}

export function handleTextareaResize() {
  dom.userInput.style.height = 'auto';
  dom.userInput.style.height = Math.min(dom.userInput.scrollHeight, 160) + 'px';
}

export function setChatStatus(type, text) {
  dom.chatStatus.textContent = type === 'ready' ? '' : text;
  dom.chatStatus.title = dom.chatStatus.textContent;
  dom.chatStatus.className = `chat-status ${type}`;
}

function chatWidth() {
  try { return Number(localStorage.getItem(WIDTH_KEY)) || DEFAULT_WIDTH; } catch { return DEFAULT_WIDTH; }
}

function chatWidthBounds() {
  const stage = document.getElementById('workspace-main');
  const projectPanel = document.getElementById('activity-panel');
  const dividerSpace = 2 * (parseFloat(getComputedStyle(stage).columnGap) || 0);
  const free = stage.clientWidth - (projectPanel.offsetWidth || 0) - dividerSpace;
  const max = Math.max(150, Math.floor(Math.min(free * 0.75, free - 260)));
  return { min: Math.min(MIN_WIDTH, max), max };
}

function applyChatWidth(value, persist) {
  const { min, max } = chatWidthBounds();
  const width = Math.round(Math.min(max, Math.max(min, value)));
  dom.chatPanel.style.width = `${width}px`;
  const handle = document.getElementById('chat-resizer');
  handle.setAttribute('aria-valuemin', min);
  handle.setAttribute('aria-valuemax', max);
  handle.setAttribute('aria-valuenow', width);
  const wide = document.getElementById('chat-wide-btn');
  if (wide) {
    const isWide = value > DEFAULT_WIDTH && width >= Math.min(max, WIDE) - 8;
    wide.title = isWide ? tr('Свернуть', 'Restore width') : tr('Развернуть', 'Expand');
    wide.classList.toggle('active', isWide);
    wide.setAttribute('aria-pressed', String(isWide));
    wide.disabled = max <= DEFAULT_WIDTH;
  }
  if (persist) { try { localStorage.setItem(WIDTH_KEY, String(value)); } catch { /* ignore */ } }
  return width;
}

function setupChatResizer() {
  const handle = document.getElementById('chat-resizer');
  if (!handle) return;
  let dragging = null;
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;
    dragging = { x: e.clientX, width: dom.chatPanel.offsetWidth, scale };
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    document.body.classList.add('resizing');
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    applyChatWidth(dragging.width + (dragging.x - e.clientX) / dragging.scale, false);
  });
  const stop = () => {
    if (!dragging) return;
    dragging = null;
    handle.classList.remove('dragging');
    document.body.classList.remove('resizing');
    applyChatWidth(dom.chatPanel.offsetWidth, true);
  };
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
  handle.addEventListener('lostpointercapture', stop);
  handle.addEventListener('keydown', (event) => {
    const { min, max } = chatWidthBounds();
    const width = dom.chatPanel.offsetWidth;
    const next = { ArrowLeft: width + 24, ArrowRight: width - 24, Home: min, End: max }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    applyChatWidth(Math.max(min, Math.min(max, next)), true);
  });
  handle.addEventListener('dblclick', () => applyChatWidth(DEFAULT_WIDTH, true));
  document.getElementById('chat-wide-btn')?.addEventListener('click', () => {
    const wide = document.getElementById('chat-wide-btn').classList.contains('active');
    applyChatWidth(wide ? DEFAULT_WIDTH : WIDE, true);
  });
  const observer = new ResizeObserver(() => {
    if (state.chatVisible && !dragging) applyChatWidth(chatWidth(), false);
  });
  observer.observe(document.getElementById('workspace-main'));
  observer.observe(document.getElementById('activity-panel'));
}

function updateContextChip() {
  const btn = document.getElementById('chat-context-btn');
  const label = document.getElementById('chat-context-label');
  if (!btn || !label) return;
  const tab = state.currentTabs[state.activeTabIndex];
  const hasFile = isEditorTab(tab) && tab.name;
  btn.classList.toggle('active', !!state.attachContext);
  btn.classList.toggle('muted', !hasFile);
  label.textContent = hasFile ? tab.name : 'Файл';
  btn.title = state.attachContext ? 'Открытый файл прикрепляется к запросам. Нажмите, чтобы отключить.' : 'Файл не прикрепляется. Нажмите, чтобы включить.';
}

// ───────────────────────── attached files ─────────────────────────

/** Add files (already read) to what the next message carries. */
export function addContextFiles(files) {
  const list = state.contextFiles || (state.contextFiles = []);
  for (const f of files) {
    if (!f || !f.name) continue;
    const at = list.findIndex((x) => x.path && x.path === f.path);
    if (at >= 0) list[at] = f; else list.push(f);
  }
  renderAttachments();
}

export async function addContextFileByPath(filePath) {
  const res = await window.electronAPI.readContextFile(filePath);
  if (!res?.success) { alert(res?.error || 'Не удалось прочитать файл'); return false; }
  addContextFiles([res.file]);
  if (!state.chatVisible) toggleChat();
  return true;
}

function renderAttachments() {
  const holder = document.getElementById('chat-attach');
  if (!holder) return;
  const files = state.contextFiles || [];
  holder.hidden = !files.length;
  holder.innerHTML = files.map((f, i) => `<span class="attach-chip" title="${escapeHtml(f.path || f.name)}"><span class="attach-name">${escapeHtml(f.name)}</span>${f.truncated ? '<span class="attach-note">часть</span>' : ''}<button type="button" data-rm="${i}" aria-label="Убрать">${icon('close', 10)}</button></span>`).join('');
}

async function pickFiles() {
  const res = await window.electronAPI.pickContextFiles();
  if (!res?.success) { alert(res?.error || 'Не удалось выбрать файлы'); return; }
  if (res.errors?.length) alert(res.errors.join('\n'));
  if (res.files?.length) addContextFiles(res.files);
}

// ───────────────────────── messages (rendering) ─────────────────────────

function scrollToBottom(force = false) {
  if (!dom.chatMessages) return;
  if (force || state.chatStick !== false) dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
}

function renderEmptyState() {
  if (!dom.chatMessages || dom.chatMessages.querySelector('.message')) return;
  if (dom.chatMessages.querySelector('.chat-empty')) return;
  const box = document.createElement('div');
  box.className = 'chat-empty';
  const prompt = isProjectAgent(state.currentAiProvider) && !state.currentFolder
    ? tr('Откройте папку проекта, чтобы запустить агента.', 'Open a project folder to run the agent.')
    : tr('Задайте вопрос или опишите задачу для агента.', 'Ask a question or describe a task for the agent.');
  const text = document.createElement('p');
  text.textContent = prompt;
  box.append(text);
  dom.chatMessages.appendChild(box);
}

function modelLabel() {
  const provider = providerLabel(state.currentAiProvider);
  return state.currentAiModel ? `${provider} · ${state.currentAiModel}` : provider;
}

const EDIT_ICON = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 3.5l2 2L6 12l-2.8.8L4 10z"/></svg>';
const RETRY_ICON = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M13 8a5 5 0 1 1-1.6-3.7"/><path d="M13 2.5v3h-3"/></svg>';

function paintReply(el, source, live = false) {
  const thread = el.querySelector('.agent-thread');
  paintAgentThread(thread, source, {
    live,
    renderAnswer(body, text) {
      body.innerHTML = renderMd(text);
      enhanceCode(body);
    },
  });
  el.querySelector('.msg-foot').textContent = source.stats || '';
}

/** One message of the open chat as a DOM element. `index` is its place in chat.messages. */
function buildMessage(message, index) {
  const el = document.createElement('div');
  el.dataset.index = String(index);
  if (message.role === 'user') {
    el.className = 'message user';
    el.dataset.raw = message.content;
    const files = (message.files || []).map((f) => `<span class="attach-chip static" title="${escapeHtml(f.path || f.name)}">${escapeHtml(f.name)}</span>`).join('');
    el.innerHTML = `<div class="msg-text"></div>${files ? `<div class="msg-files">${files}</div>` : ''}
      <div class="msg-tools"><button type="button" data-msg="edit" title="Изменить запрос">${EDIT_ICON}</button><button type="button" data-msg="copy" title="Скопировать">${COPY_ICON}</button></div>`;
    el.querySelector('.msg-text').textContent = message.content;
    return el;
  }
  el.className = 'message ai';
  el.dataset.raw = message.content || '';
  el.dataset.thinking = message.thinking || '';
  el.innerHTML = `<div class="msg-meta"><span class="msg-who"></span><span class="msg-actions">
      <button type="button" data-msg="copy" title="Скопировать ответ">${COPY_ICON}</button>
      <button type="button" data-msg="retry" title="Ответить заново на этот вопрос">${RETRY_ICON}</button></span></div>
    <div class="agent-thread"></div><div class="msg-foot"></div>`;
  el.querySelector('.msg-who').textContent = message.who || modelLabel();
  paintReply(el, { ...message, answer: message.content });
  if (message.error) el.classList.add('is-error');
  return el;
}

function renderChat() {
  ensureChat();
  updateAgentControls();
  dom.chatMessages.innerHTML = '';
  chat.messages.forEach((m, i) => dom.chatMessages.appendChild(buildMessage(m, i)));
  renderEmptyState();
  scrollToBottom(true);
}

export function addChatMessage(content, sender, opts = {}) {
  ensureChat();
  dom.chatMessages.querySelector('.chat-empty')?.remove();
  const message = { role: sender === 'user' ? 'user' : 'assistant', content, thinking: opts.thinking || '', stats: opts.stats || '', who: opts.who || '', files: opts.files };
  chat.messages.push(message);
  const el = buildMessage(message, chat.messages.length - 1);
  dom.chatMessages.appendChild(el);
  scrollToBottom(true);
  if (!opts.silent) persistChat();
  return el;
}

function persistChat() {
  ensureChat();
  chat.updated = Date.now();
  if (chat.title === 'Новый чат') {
    const first = chat.messages.find((m) => m.role === 'user');
    if (first) chat.title = snippet(first.content);
  }
  saveChats();
}

export function saveChatHistory() { persistChat(); }

export function loadChatHistory() {
  ensureChat();
  if (!state.isTyping) renderChat();
}

export function clearChatHistory() {
  if (state.isTyping) return;
  ensureChat();
  newChat();
  resetComposer();
  showHistory(false);
  renderChat();
  dom.userInput?.focus();
}

// ───────────────────────── history view ─────────────────────────

function showHistory(show) {
  const box = document.getElementById('chat-history');
  if (!box) return;
  box.hidden = !show;
  document.getElementById('chat-messages').hidden = show;
  document.querySelector('.chat-composer').hidden = show;
  const button = document.getElementById('chat-history-btn');
  button.classList.toggle('active', show);
  button.setAttribute('aria-pressed', String(show));
  const filter = document.getElementById('chat-history-filter');
  document.getElementById('chat-heading').textContent = show ? tr('История чатов', 'Chat history') : tr('AI-чат', 'AI chat');
  if (show) {
    filter.value = '';
    renderHistoryList();
    filter.focus();
  }
}

function renderHistoryList() {
  const box = document.getElementById('chat-history-list');
  const filter = document.getElementById('chat-history-filter');
  filter.placeholder = tr('Поиск по чатам…', 'Search chats…');
  filter.setAttribute('aria-label', filter.placeholder);
  const query = filter.value.trim().toLocaleLowerCase();
  chats = readChats() || chats;
  const list = chats.filter((x) => x.messages.length && (x.workspace === workspace || x.workspace === undefined)
    && (!query || [x.title, providerLabel(x.provider), ...x.messages.map((message) => message.content)]
      .some((value) => String(value || '').toLocaleLowerCase().includes(query))));
  const ago = (time) => { const m = Math.round((Date.now() - time) / 60000); return getLang() === 'en' ? (m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} hr ago` : new Date(time).toLocaleDateString('en-US')) : (m < 1 ? 'только что' : m < 60 ? `${m} мин назад` : m < 1440 ? `${Math.round(m / 60)} ч назад` : new Date(time).toLocaleDateString('ru-RU')); };
  box.innerHTML = list.length ? list.map((x) => `
    <div class="history-row${chat && x.id === chat.id ? ' current' : ''}">
      <button type="button" class="history-open" data-open="${escapeHtml(x.id)}"><strong>${escapeHtml(getLang() === 'en' && x.title === 'Новый чат' ? 'New chat' : x.title)}</strong><small>${ago(x.updated)} · ${escapeHtml(x.workspace === undefined ? tr('Без проекта', 'Legacy chat') : (x.provider ? providerLabel(x.provider) : tr('Сообщений', 'Messages') + ' ' + x.messages.length))}</small></button>
      <button type="button" class="chat-header-btn" data-delete="${escapeHtml(x.id)}" title="${tr('Удалить чат', 'Delete chat')}">${icon('close', 12)}</button>
    </div>`).join('') : `<p class="history-empty">${query ? tr('Чаты не найдены.', 'No matching chats.') : tr('В этом проекте ещё нет чатов.', 'No chats in this project yet.')}</p>`;
}

onLangChange(() => {
  updateAgentControls();
  const historyOpen = document.getElementById('chat-history')?.hidden === false;
  document.getElementById('chat-heading').textContent = historyOpen ? tr('История чатов', 'Chat history') : tr('AI-чат', 'AI chat');
  if (historyOpen) renderHistoryList();
});

// ───────────────────────── sending ─────────────────────────

/** Open file + selection as a system prompt for providers that have no file access of their own. */
function buildSystemPrompt() {
  const english = getLang() === 'en';
  let prompt = english
    ? 'You are a programming assistant in FrogeeCodeIDE. Reply in English unless the user asks for another language. Be concise and practical. Put code in Markdown blocks with a language tag. User files are enclosed in <file> tags; do not invent file contents when no file is supplied. Do not use emoji. Answer only the latest question; files attached to earlier messages do not apply unless asked about.'
    : 'Ты - ассистент программиста в редакторе кода FrogeeCodeIDE. Отвечай на русском, кратко и по делу. Код пиши в блоках markdown с указанием языка. Файлы пользователя передаются между тегами <файл>; если файла нет в запросе, не выдумывай его содержимое. Не используй эмодзи. Отвечай только на последний вопрос; прикреплённые ранее файлы к нему не относятся, если о них не спрашивают.';
  const tab = state.currentTabs[state.activeTabIndex];
  if (!state.attachContext || !isEditorTab(tab) || !dom.editor) return prompt;
  const text = dom.editor.value || '';
  const lang = (/\.([a-z0-9]+)$/i.exec(tab.name || '') || [])[1] || '';
  prompt += english
    ? `\n\nOpen file “${tab.name}”${tab.filePath ? ` (${tab.filePath})` : ''}. Contents:\n\`\`\`${lang}\n${text.slice(0, FILE_CONTEXT_CHARS)}${text.length > FILE_CONTEXT_CHARS ? '\n… (file truncated)' : ''}\n\`\`\``
    : `\n\nОткрыт файл «${tab.name}»${tab.filePath ? ` (${tab.filePath})` : ''}. Его содержимое:\n\`\`\`${lang}\n${text.slice(0, FILE_CONTEXT_CHARS)}${text.length > FILE_CONTEXT_CHARS ? '\n… (файл обрезан)' : ''}\n\`\`\``;
  if (dom.editor.selectionEnd > dom.editor.selectionStart) {
    prompt += `\n\n${english ? 'The user selected this text:' : 'Пользователь выделил фрагмент:'}\n\`\`\`${lang}\n${dom.editor.value.slice(dom.editor.selectionStart, dom.editor.selectionEnd).slice(0, 6000)}\n\`\`\``;
  }
  return prompt;
}

function filesBlock(files) {
  const english = getLang() === 'en';
  return (files || []).map((f) => english
    ? `\n\n<file name="${f.name}"${f.path ? ` path="${f.path}"` : ''}>\n${f.content}${f.truncated ? '\n… (file truncated)' : ''}\n</file>`
    : `\n\n<файл имя="${f.name}"${f.path ? ` путь="${f.path}"` : ''}>\n${f.content}${f.truncated ? '\n… (файл обрезан)' : ''}\n</файл>`).join('');
}

function agentContext(files) {
  const right = state.splitView && state.focusedPane === 'right';
  const tab = state.currentTabs[right ? state.rightTabIndex : state.activeTabIndex];
  const english = getLang() === 'en';
  let ctx = '';
  const root = workspace.replace(/\\/g, '/').replace(/\/+$/, '');
  const current = tab?.filePath?.replace(/\\/g, '/');
  if (state.attachContext && isEditorTab(tab) && current?.startsWith(root + '/')) {
    ctx += `\n\n${english ? '[FrogeeCodeIDE context] Open file:' : '[Контекст FrogeeCodeIDE] Открытый файл:'} ${tab.filePath}`;
    const ed = right ? document.getElementById('editor-right') : dom.editor;
    if (ed && ed.selectionEnd > ed.selectionStart) ctx += `\n${english ? 'Selected text:' : 'Выделенный фрагмент:'}\n\`\`\`\n${ed.value.slice(ed.selectionStart, ed.selectionEnd).slice(0, 6000)}\n\`\`\``;
  }
  const paths = (files || []).filter((f) => f.path).map((f) => f.path);
  if (paths.length) ctx += `\n\n${english ? 'Attached files:' : 'Прикреплённые файлы:'}\n${paths.join('\n')}`;
  const inline = (files || []).filter((file) => !file.path && file.content);
  if (inline.length) ctx += filesBlock(inline);
  return ctx;
}

/** Turns the chat (up to the last question) into role/content pairs for the model. */
function modelMessages() {
  const english = getLang() === 'en';
  const turns = chat.messages
    .filter((m) => (m.role === 'user' || m.content) && !m.error)
    .map((m, i, all) => ({ role: m.role, content: m.role === 'user' ? m.content + (i === all.length - 1 ? filesBlock(m.files) : (m.files?.length ? `\n[${english ? 'Files attached to this message' : 'К этому сообщению были прикреплены файлы'}: ${m.files.map((f) => f.name).join(', ')}]` : '')) : m.content }));
  const picked = [];
  let size = 0;
  for (let i = turns.length - 1; i >= 0 && picked.length < HISTORY_LIMIT; i--) {
    size += turns[i].content.length;
    if (size > HISTORY_CHARS && picked.length) break;
    picked.unshift(turns[i]);
  }
  return picked;
}

function setBusy(busy) {
  state.isTyping = busy;
  dom.stopBtn.style.display = busy ? 'flex' : 'none';
  dom.sendBtn.style.display = busy ? 'none' : 'flex';
  dom.sendBtn.disabled = busy;
  dom.aiProviderSelect.disabled = busy;
  dom.aiModelSelect.disabled = busy;
  for (const id of ['chat-agent-model', 'chat-agent-access', 'clear-chat-btn', 'chat-history-btn']) document.getElementById(id).disabled = busy;
  dom.stopBtn.disabled = false;
}

function resumePrompt(history) {
  const prior = history.slice(0, -1);
  if (!prior.length) return '';
  return `Previous conversation (for context):\n${JSON.stringify(prior)}\n\nLatest user request:\n`;
}

function beginStream(index) {
  const el = dom.chatMessages.querySelector(`.message.ai[data-index="${index}"]`) || buildMessage(chat.messages[index], index);
  el.classList.add('streaming');
  if (!el.parentElement) dom.chatMessages.appendChild(el);
  stream = { el, raw: '', thinking: '', activity: [], timeline: [] };
  return stream;
}

function paintStream() {
  renderFrame = 0;
  if (!stream) return;
  paintReply(stream.el, { ...stream, answer: stream.raw }, true);
  scrollToBottom();
}

/** Ask the model about the last user message of the open chat and write the answer below it. */
async function runChat() {
  ensureChat();
  const provider = state.currentAiProvider || 'ollama';
  const question = chat.messages[chat.messages.length - 1];
  const history = modelMessages();
  const reply = { role: 'assistant', content: '', thinking: '', stats: '', who: modelLabel() };
  chat.messages.push(reply);
  const index = chat.messages.length - 1;
  dom.chatMessages.querySelector('.chat-empty')?.remove();
  dom.chatMessages.appendChild(buildMessage(reply, index));
  state.chatStick = true;
  setChatStatus('typing', tr('Отвечает…', 'Working…'));
  setBusy(true);
  beginStream(index);
  scrollToBottom(true);

  try {
    let response;
    const agent = AGENT_BY_PROVIDER[provider];
    const cwd = workspace;
    const access = chat.access || state.agentAccess;
    const baseUrl = String(state.opencodeBaseUrl || 'http://127.0.0.1:4096').trim().replace(/\/$/, '');
    const bin = state.agentPaths?.[agent] || '';
    const sessionKey = agent ? JSON.stringify([provider, bin, access]) : JSON.stringify([provider, baseUrl]);
    const sessionId = chat.session?.key === sessionKey ? chat.session.id : undefined;
    const context = sessionId ? '' : resumePrompt(history);
    chat.provider = provider;
    if (!sessionId) delete chat.session;
    if (agent) {
      if (!cwd) throw new Error(tr('Откройте папку проекта для запуска агента.', 'Open a project folder to run the agent.'));
      chat.access = access;
      response = await window.electronAPI.agentSend({
        agent, prompt: context + question.content + agentContext(question.files), cwd, model: state.currentAiModel || '',
        mode: access, sessionId, bin,
      });
    } else if (provider === 'opencode') {
      if (!cwd) throw new Error(tr('Откройте папку проекта для запуска OpenCode.', 'Open a project folder to run OpenCode.'));
      if (!state.currentAiModel) throw new Error('Выберите модель OpenCode');
      response = await window.electronAPI.sendMessage(context + question.content + filesBlock(question.files), state.currentAiModel, {
        provider, directory: cwd, baseUrl, sessionId,
      });
    } else {
      if (!state.currentAiModel) await refreshModelSelectForProvider().catch(() => {}); // the list may still be loading
      if (!state.currentAiModel) throw new Error(provider === 'ollama' ? 'Выберите модель Ollama или установите её в настройках AI' : 'Выберите модель');
      const custom = customOf(provider);
      response = await window.electronAPI.sendMessage(question.content, state.currentAiModel, {
        provider, system: buildSystemPrompt(), messages: history, think: !!state.aiThinking,
        ...(custom ? { custom: { baseUrl: custom.baseUrl, apiKey: custom.apiKey } } : {}),
      });
    }

    chat.model = state.currentAiModel;
    if (response?.sessionId) chat.session = { key: sessionKey, id: response.sessionId };
    reply.activity = (response?.activity || stream.activity)
      .map((step) => ['running', 'pending'].includes(step.status) ? { ...step, status: 'stopped' } : step);
    reply.timeline = (response?.timeline || stream.timeline || []).map((row) => ['running', 'pending'].includes(row.status) ? { ...row, status: row.type === 'tool' || response?.aborted ? 'stopped' : 'done' } : row);
    if (response && response.success === false) throw new Error(response.error || 'Ошибка AI');
    reply.content = response?.answer ?? stream.raw;
    reply.thinking = response?.thinking ?? stream.thinking;
    reply.stats = response?.aborted ? tr('Остановлено', 'Stopped') : response?.stats
      ? `${response.stats.tokens} ${tr('токенов', 'tokens')} · ${(response.stats.ms / 1000).toFixed(1)} ${tr('с', 's')}` : '';
    reply.who = modelLabel();
    cancelAnimationFrame(renderFrame);
    renderFrame = 0;
    if (stream) {
      stream.el.classList.remove('streaming');
      stream.el.dataset.raw = reply.content;
      stream.el.dataset.thinking = reply.thinking;
      paintReply(stream.el, { ...reply, answer: reply.content });
      stream.el.querySelector('.msg-who').textContent = reply.who;
    }
  } catch (error) {
    console.error('Ошибка AI:', error);
    let errorMsg = error.message;
    if (/OpenRouter/i.test(error.message)) errorMsg += '\n\nПроверьте ключ OpenRouter, доступ к openrouter.ai и баланс.';
    if (provider === 'opencode' || /opencode/i.test(error.message || '')) errorMsg += '\n\nOpenCode: запустите `opencode serve` (кнопка в настройках AI), откройте папку проекта и выберите модель.';
    reply.content = stream?.raw || reply.content;
    reply.thinking = stream?.thinking || reply.thinking;
    reply.activity ||= (stream?.activity || []).map((step) => ['running', 'pending'].includes(step.status) ? { ...step, status: 'stopped' } : step);
    reply.timeline ||= (stream?.timeline || []).map((row) => ['running', 'pending'].includes(row.status) ? { ...row, status: 'stopped' } : row);
    reply.error = errorMsg;
    reply.who = tr('Ошибка', 'Error');
    cancelAnimationFrame(renderFrame);
    renderFrame = 0;
    if (stream) {
      stream.el.classList.remove('streaming');
      stream.el.classList.add('is-error');
      stream.el.querySelector('.msg-who').textContent = reply.who;
      paintReply(stream.el, { ...reply, answer: reply.content });
    }
    setChatStatus('error', tr('Ошибка', 'Error'));
  } finally {
    stream = null;
    setBusy(false);
    persistChat();
    const ready = () => setChatStatus('ready', tr('Готов', 'Ready'));
    if (dom.chatStatus.classList.contains('typing')) ready();
    else setTimeout(() => { if (!state.isTyping) ready(); }, 2500);
    syncWorkspace();
  }
}

/** Add a user question (with the files waiting in the composer) and get the answer. */
async function sendQuestion(text, files) {
  ensureChat();
  chat.workspace = workspace;
  const message = { role: 'user', content: text, files: files && files.length ? files.map((f) => ({ name: f.name, path: f.path, content: f.content, truncated: f.truncated })) : undefined };
  chat.messages.push(message);
  dom.chatMessages.querySelector('.chat-empty')?.remove();
  dom.chatMessages.appendChild(buildMessage(message, chat.messages.length - 1));
  persistChat();
  await runChat();
}

export async function handleChatSubmit() {
  syncWorkspace();
  const message = dom.userInput.value.trim();
  if (!message || state.isTyping) return;
  const files = state.contextFiles || [];
  state.contextFiles = [];
  renderAttachments();
  dom.userInput.value = '';
  dom.userInput.style.height = 'auto';
  showHistory(false);
  await sendQuestion(message, files);
}

/** Drop everything from message `index` on, then ask again (edited question or a fresh answer). */
async function resendFrom(index, text) {
  if (state.isTyping) return;
  const original = chat.messages[index];
  const files = original?.role === 'user' ? original.files : chat.messages[index - 1]?.files;
  chat.messages = chat.messages.slice(0, original?.role === 'user' ? index : index - 1);
  delete chat.session;
  editingIndex = -1;
  renderChat();
  await sendQuestion(text, files);
}

function startEdit(index) {
  if (state.isTyping) return;
  const el = dom.chatMessages.querySelector(`.message.user[data-index="${index}"]`);
  if (!el || el.classList.contains('editing')) return;
  editingIndex = index;
  el.classList.add('editing');
  const original = chat.messages[index].content;
  el.innerHTML = `<textarea class="edit-area" rows="1" spellcheck="false"></textarea>
    <div class="edit-bar"><button type="button" class="edit-cancel">Отмена</button><button type="button" class="edit-save">Отправить заново</button></div>`;
  const area = el.querySelector('.edit-area');
  area.value = original;
  const fit = () => { area.style.height = 'auto'; area.style.height = Math.min(area.scrollHeight, 220) + 'px'; };
  area.addEventListener('input', fit);
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); el.querySelector('.edit-save').click(); }
    if (e.key === 'Escape') { e.preventDefault(); el.querySelector('.edit-cancel').click(); }
  });
  el.querySelector('.edit-cancel').addEventListener('click', () => { editingIndex = -1; renderChat(); });
  el.querySelector('.edit-save').addEventListener('click', () => { const text = area.value.trim(); if (text) resendFrom(index, text); });
  fit();
  area.focus();
  area.setSelectionRange(area.value.length, area.value.length);
}

export function setupChatStreamListener() {
  setupChatResizer();
  updateAgentControls();
  const modelField = document.getElementById('chat-agent-model');
  modelField.addEventListener('change', () => {
    state.currentAiModel = modelField.value.trim();
    modelField.value = state.currentAiModel;
    rememberModel();
    saveAllConfig();
  });
  document.getElementById('chat-agent-access').addEventListener('change', (event) => {
    ensureChat();
    chat.access = event.target.value;
    if (chat.messages.length) saveChats();
  });
  window.addEventListener('frogee:agent-access', updateAgentControls);
  window.addEventListener('frogee:workspace', () => {
    syncWorkspace();
    updateAgentControls();
  });
  dom.chatMessages?.addEventListener('scroll', () => {
    const nearBottom = dom.chatMessages.scrollHeight - dom.chatMessages.scrollTop - dom.chatMessages.clientHeight < 60;
    state.chatStick = nearBottom;
    document.getElementById('chat-scroll-btn').hidden = nearBottom;
  });
  document.getElementById('chat-scroll-btn')?.addEventListener('click', () => { state.chatStick = true; scrollToBottom(true); });
  dom.chatMessages?.addEventListener('click', (e) => {
    const code = e.target.closest('[data-code]');
    if (code) { onCodeAction(code); return; }
    const action = e.target.closest('[data-msg]');
    if (!action) return;
    const msg = action.closest('.message');
    const index = Number(msg.dataset.index);
    if (action.dataset.msg === 'copy') navigator.clipboard?.writeText(msg.dataset.raw || '');
    else if (action.dataset.msg === 'edit') startEdit(index);
    else if (action.dataset.msg === 'retry') {
      const question = chat.messages[index - 1];
      if (question?.role === 'user') resendFrom(index, question.content);
    }
  });
  document.getElementById('chat-context-btn')?.addEventListener('click', () => {
    state.attachContext = !state.attachContext;
    updateContextChip();
    saveAllConfig();
  });
  document.getElementById('chat-attach-btn')?.addEventListener('click', pickFiles);
  const thinkBtn = document.getElementById('chat-think-btn');
  try { state.aiThinking = localStorage.getItem('frogee.think') === '1'; } catch { state.aiThinking = false; }
  thinkBtn?.classList.toggle('active', !!state.aiThinking);
  thinkBtn?.addEventListener('click', () => {
    state.aiThinking = !state.aiThinking;
    thinkBtn.classList.toggle('active', state.aiThinking);
    try { localStorage.setItem('frogee.think', state.aiThinking ? '1' : '0'); } catch { /* ignore */ }
  });
  document.getElementById('chat-attach')?.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (!rm) return;
    state.contextFiles.splice(Number(rm.dataset.rm), 1);
    renderAttachments();
  });
  document.getElementById('chat-history-btn')?.addEventListener('click', () => showHistory(document.getElementById('chat-history').hidden));
  document.getElementById('chat-history-filter')?.addEventListener('input', renderHistoryList);
  document.getElementById('chat-history')?.addEventListener('click', (e) => {
    if (state.isTyping) return;
    const del = e.target.closest('[data-delete]');
    if (del) {
      if (chat?.id === del.dataset.delete) {
        newChat();
        resetComposer();
      }
      saveChats(del.dataset.delete);
      renderHistoryList();
      renderChat();
      return;
    }
    const open = e.target.closest('[data-open]');
    if (open) {
      const selected = chats.find((x) => x.id === open.dataset.open);
      if (!selected) return;
      if (selected.id !== chat?.id) resetComposer();
      chat = selected;
      restoreProvider();
      showHistory(false);
      renderChat();
      dom.userInput?.focus();
    }
  });
  // Files dropped on the chat become context
  const panel = dom.chatPanel;
  panel?.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('application/x-frogee-path')) { e.preventDefault(); panel.classList.add('drop-hover'); } });
  panel?.addEventListener('dragleave', () => panel.classList.remove('drop-hover'));
  panel?.addEventListener('drop', (e) => {
    const p = e.dataTransfer?.getData('application/x-frogee-path');
    panel.classList.remove('drop-hover');
    if (p) { e.preventDefault(); addContextFileByPath(p); }
  });
  window.addEventListener('frogee:title', updateContextChip);

  if (window.electronAPI && typeof window.electronAPI.onStreamUpdate === 'function') {
    window.electronAPI.onStreamUpdate((event, data) => {
      if (!dom.chatMessages || !state.isTyping) return;
      if (data.notice) { setChatStatus('typing', data.notice); return; }
      if (!stream) return;
      stream.raw = data.fullMessage ?? stream.raw;
      if (typeof data.thinking === 'string') stream.thinking = data.thinking;
      if (Array.isArray(data.activity)) stream.activity = data.activity;
      if (Array.isArray(data.timeline)) stream.timeline = data.timeline;
      if (!renderFrame) renderFrame = requestAnimationFrame(paintStream);
    });
  }
}

export function stopChatResponse() {
  if (!state.isTyping || dom.stopBtn.disabled) return;
  dom.stopBtn.disabled = true;
  setChatStatus('typing', tr('Останавливается…', 'Stopping…'));
  window.electronAPI.abortRequest().catch(() => { dom.stopBtn.disabled = false; });
}
