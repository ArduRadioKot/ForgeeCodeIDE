import { state } from './state.js';
import { getDom } from './dom.js';
import { saveAllConfig } from './save-hook.js';
import { escapeHtml, sanitizeHtml } from './utils.js';

const AGENT_BY_PROVIDER = { 'claude-code': 'claude', codex: 'codex' };
const AGENT_MODELS = {
  'claude-code': [['', 'По умолчанию'], ['sonnet', 'Sonnet'], ['opus', 'Opus'], ['haiku', 'Haiku']],
  codex: [['', 'По умолчанию']],
};
let streamEl = null;

function renderMd(text) {
  try {
    const html = window.marked?.parse ? window.marked.parse(text || '') : escapeHtml(text || '').replace(/\n/g, '<br>');
    return sanitizeHtml(html);
  } catch {
    return escapeHtml(text || '').replace(/\n/g, '<br>');
  }
}

/** Active file path + selection, so Claude Code / Codex know what the user is looking at. */
function editorContext() {
  const tab = state.currentTabs[state.activeTabIndex];
  if (!tab || tab.kind === 'terminal' || tab.kind === 'browser' || !tab.filePath) return '';
  let ctx = `\n\n[Контекст IDE] Открытый файл: ${tab.filePath}`;
  const ed = dom.editor;
  if (ed && tab.kind !== 'notebook' && ed.selectionEnd > ed.selectionStart) {
    ctx += `\nВыделенный фрагмент:\n\`\`\`\n${ed.value.slice(ed.selectionStart, ed.selectionEnd).slice(0, 6000)}\n\`\`\``;
  }
  return ctx;
}

const dom = getDom();

export function handleAiProviderChange() {
  if (!dom.aiProviderSelect) return;
  state.currentAiProvider = dom.aiProviderSelect.value;

  if (dom.openRouterSection) {
    dom.openRouterSection.style.display = state.currentAiProvider === 'openrouter' ? 'block' : 'none';
  }
  if (dom.ollamaSection) {
    dom.ollamaSection.style.display = state.currentAiProvider === 'ollama' ? 'block' : 'none';
  }

  refreshModelSelectForProvider().catch((err) => console.error(err));

  if (state.currentAiProvider === 'ollama') {
    state.currentAiModel = 'llama3';
  } else if (state.currentAiProvider === 'openrouter') {
    state.currentAiModel = 'deepseek/deepseek-r1-0528:free';
  } else if (AGENT_BY_PROVIDER[state.currentAiProvider]) {
    state.currentAiModel = '';
  }

  saveAllConfig();
}

export async function refreshModelSelectForProvider() {
  if (!dom.aiModelSelect) return;
  dom.aiModelSelect.innerHTML = '';

  if (state.currentAiProvider === 'ollama') {
    dom.aiModelSelect.innerHTML = `
      <option value="llama3">Llama 3</option>
      <option value="llama3.2">Llama 3.2</option>
      <option value="mistral">Mistral</option>
      <option value="codellama">Code Llama</option>
    `;
    if (state.currentAiModel) dom.aiModelSelect.value = state.currentAiModel;
    return;
  }

  if (state.currentAiProvider === 'openrouter') {
    updateOpenRouterModelSelect();
    return;
  }

  if (AGENT_BY_PROVIDER[state.currentAiProvider]) {
    for (const [value, label] of AGENT_MODELS[state.currentAiProvider]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      dom.aiModelSelect.appendChild(option);
    }
    const known = [...dom.aiModelSelect.options].some((o) => o.value === state.currentAiModel);
    if (!known) state.currentAiModel = '';
    dom.aiModelSelect.value = state.currentAiModel;
    return;
  }

  if (state.currentAiProvider === 'opencode') {
    const baseUrl = document.getElementById('opencode-url')?.value || state.opencodeBaseUrl || 'http://127.0.0.1:4096';
    state.opencodeBaseUrl = baseUrl;
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Загрузка моделей OpenCode…';
    dom.aiModelSelect.appendChild(placeholder);

    const res = await window.electronAPI.opencodeModels({
      baseUrl,
      directory: state.currentFolder || null
    });
    dom.aiModelSelect.innerHTML = '';
    if (!res.success || !res.models?.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = res.error ? `OpenCode: ${res.error}` : 'Нет моделей (запустите opencode serve)';
      dom.aiModelSelect.appendChild(opt);
      updateOpenCodeStatus(res.success ? 'empty' : 'error');
      return;
    }
    updateOpenCodeStatus('connected');
    state.openCodeModels = res.models;
    for (const m of res.models) {
      if (m.enabled === false) continue;
      const option = document.createElement('option');
      option.value = m.id;
      option.textContent = m.name && m.name !== m.modelID ? `${m.name} (${m.id})` : m.id;
      dom.aiModelSelect.appendChild(option);
    }
    if (state.currentAiModel && [...dom.aiModelSelect.options].some((o) => o.value === state.currentAiModel)) {
      dom.aiModelSelect.value = state.currentAiModel;
    } else if (dom.aiModelSelect.options.length) {
      state.currentAiModel = dom.aiModelSelect.options[0].value;
      dom.aiModelSelect.value = state.currentAiModel;
    }
  }
}

export function updateOpenCodeStatus(status) {
  const el = document.getElementById('opencode-status');
  if (!el) return;
  const map = {
    connected: 'Подключен',
    disconnected: 'Недоступен',
    error: 'Ошибка',
    empty: 'Нет моделей',
    'not-checked': 'Не проверен'
  };
  el.textContent = map[status] || status;
  el.className = `status-indicator ${status}`;
}

export function updateOpenRouterModelSelect() {
  if (!dom.aiModelSelect) return;
  if (state.currentAiProvider !== 'openrouter') return;
  dom.aiModelSelect.innerHTML = '';

  const freeModels = [
    'deepseek/deepseek-r1-0528:free',
    'qwen/qwen3-235b-a22b:free',
    'google/gemini-2.0-flash-exp:free',
    'meta-llama/llama-3.1-405b-instruct:free',
    'openrouter/horizon-beta'
  ];

  freeModels.forEach(model => {
    const option = document.createElement('option');
    option.value = model;
    const displayName = model.split('/')[1]?.split(':')[0] || model.split('/')[0];
    option.textContent = displayName;
    dom.aiModelSelect.appendChild(option);
  });
  if (state.currentAiModel) {
    try { dom.aiModelSelect.value = state.currentAiModel; } catch {}
  }
}

export function handleAiModelChange() {
  state.currentAiModel = dom.aiModelSelect.value;
  saveAllConfig();
}

export async function saveOpenRouterKey() {
  const apiKey = dom.openRouterKeyInput.value.trim();
  if (!apiKey) {
    alert('Введите API ключ OpenRouter');
    return;
  }
  
  try {
    const result = await window.electronAPI.setOpenRouterKey(apiKey);
    if (result.success) {
      updateOpenRouterStatus('connected');
      // Clear the input field but keep the key in memory
      dom.openRouterKeyInput.value = '';
      alert('API ключ OpenRouter сохранен!');
      
      // Загружаем модели OpenRouter
      try {
        const modelsResult = await window.electronAPI.getOpenRouterModels();
        if (modelsResult.success) {
          state.openRouterModels = modelsResult.models;
          updateOpenRouterModelSelect();
        }
      } catch (error) {
        console.error('Ошибка загрузки моделей OpenRouter:', error);
      }
      
      saveAllConfig();
    } else {
      alert('Ошибка сохранения API ключа: ' + result.error);
    }
  } catch (error) {
    alert('Ошибка: ' + error.message);
  }
}

export function updateDefaultAiProvider() {
  state.defaultAiProvider = dom.defaultAiProviderSelect.value;
  
  // Обновляем модели по умолчанию
  updateOpenRouterModelSelect();
  
  // Устанавливаем текущую модель
  if (state.currentAiProvider === state.defaultAiProvider) {
    state.currentAiModel = dom.aiModelSelect.value;
  }
  
  saveAllConfig();
}

// Функция для сохранения всей конфигурации

export async function initializeOpenRouter() {
  try {
    const apiKeyResult = await window.electronAPI.getOpenRouterKey();
    if (apiKeyResult) {
      if (dom.openRouterKeyInput) dom.openRouterKeyInput.value = apiKeyResult;
      updateOpenRouterStatus('connected');
      
      try {
        const modelsResult = await window.electronAPI.getOpenRouterModels();
        if (modelsResult.success) {
          state.openRouterModels = modelsResult.models;
          updateOpenRouterModelSelect();
        }
      } catch (error) {
        console.error('Ошибка загрузки моделей OpenRouter:', error);
      }
    } else {
      updateOpenRouterStatus('disconnected');
    }
  } catch (error) {
    console.error('Ошибка инициализации OpenRouter:', error);
    updateOpenRouterStatus('error');
  }
}

export function updateOpenRouterStatus(status) {
  if (!dom.openRouterStatus) return;
  dom.openRouterStatus.textContent = {
    'connected': 'Подключен',
    'disconnected': 'Ошибка подключения',
    'not-configured': 'Не настроен',
    'error': 'Ошибка'
  }[status] || status;
  
  dom.openRouterStatus.className = `status-indicator ${status}`;
}

export function toggleChat() {
  state.chatVisible = !state.chatVisible;
  if (state.chatVisible) {
    dom.chatPanel.style.display = 'flex';
    dom.chatBtn.classList.add('active');
    loadChatHistory();
    refreshModelSelectForProvider().catch(() => {});
    dom.userInput.focus();
  } else {
    dom.chatPanel.style.display = 'none';
    dom.chatBtn.classList.remove('active');
  }
}

export function handleChatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleChatSubmit();
  }
}

export function handleTextareaResize() {
  // Автоматическое изменение высоты textarea
  dom.userInput.style.height = 'auto';
  dom.userInput.style.height = Math.min(dom.userInput.scrollHeight, 120) + 'px';
}

export async function handleChatSubmit() {
  const message = dom.userInput.value.trim();
  if (!message || state.isTyping) return;
  
  // Добавляем сообщение пользователя
  addChatMessage(message, 'user');
  dom.userInput.value = '';
  dom.userInput.style.height = 'auto';
  
  // Показываем статус печатания
  setChatStatus('typing', 'Печатает...');
  showTypingIndicator();
  
  // Показываем кнопку остановки
  dom.stopBtn.style.display = 'flex';
  dom.sendBtn.disabled = true;
  
  try {
    state.isTyping = true;

    const provider = state.currentAiProvider || 'ollama';
    if (provider === 'opencode' && !state.currentFolder) {
      throw new Error('Откройте папку проекта — OpenCode работает в контексте workspace');
    }
    if (provider === 'opencode' && !state.currentAiModel) {
      throw new Error('Выберите модель OpenCode');
    }

    streamEl = null;
    let response;
    const agent = AGENT_BY_PROVIDER[provider];
    if (agent) {
      if (!state.currentFolder) throw new Error('Откройте папку проекта — агент работает в её контексте');
      response = await window.electronAPI.agentSend({
        agent,
        prompt: message + editorContext(),
        cwd: state.currentFolder,
        model: state.currentAiModel || '',
        mode: state.agentAccess,
        sessionId: state.agentSessions[agent] || undefined,
        bin: state.agentPaths?.[agent] || undefined,
      });
      if (response?.sessionId) state.agentSessions[agent] = response.sessionId;
    } else {
      response = await window.electronAPI.sendMessage(message, state.currentAiModel, {
        provider,
        directory: state.currentFolder || null,
        baseUrl: state.opencodeBaseUrl || document.getElementById('opencode-url')?.value || 'http://127.0.0.1:4096'
      });
    }

    if (response && response.success === false) {
      throw new Error(response.error || 'Ошибка AI');
    }

    if (response && response.answer) {
      if (streamEl) {
        streamEl.dataset.raw = response.answer;
        streamEl.innerHTML = renderMd(response.answer);
        saveChatHistory();
      } else {
        addChatMessage(response.answer, 'ai');
      }
    }

  } catch (error) {
    console.error('Ошибка AI:', error);
    let errorMsg = `Ошибка: ${error.message}`;
    if (error.message.includes('OpenRouter API')) {
      errorMsg += '\n\nПроверьте:\n1. Правильность API ключа OpenRouter\n2. Доступность https://openrouter.ai\n3. Баланс на счету OpenRouter';
    }
    if ((state.currentAiProvider === 'opencode') || /opencode/i.test(error.message || '')) {
      errorMsg += '\n\nOpenCode:\n1. Запустите `opencode serve` (порт 4096)\n2. Откройте папку проекта в IDE\n3. Выберите модель из списка OpenCode';
    }
    addChatMessage(errorMsg, 'ai');
    setChatStatus('error', 'Ошибка');
  } finally {
    streamEl = null;
    state.isTyping = false;
    dom.stopBtn.style.display = 'none';
    dom.sendBtn.disabled = false;
    hideTypingIndicator();
    setChatStatus('ready', 'Готов');
  }
}

export function addChatMessage(content, sender) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${sender}`;
  
  if (sender === 'ai') {
    messageDiv.dataset.raw = content;
    messageDiv.innerHTML = renderMd(content);
  } else {
    messageDiv.textContent = content;
  }
  
  dom.chatMessages.appendChild(messageDiv);
  
  // Плавная прокрутка к новому сообщению
  setTimeout(() => {
    dom.chatMessages.scrollTo({
      top: dom.chatMessages.scrollHeight,
      behavior: 'auto'
    });
  }, 10);
  
  // Сохраняем историю чата
  saveChatHistory();
  return messageDiv;
}

export function showTypingIndicator() {
  const typingDiv = document.createElement('div');
  typingDiv.className = 'typing-indicator';
  typingDiv.innerHTML = `
    <span>AI печатает</span>
    <div class="typing-dots">
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
    </div>
  `;
  dom.chatMessages.appendChild(typingDiv);
  
  setTimeout(() => {
    dom.chatMessages.scrollTo({
      top: dom.chatMessages.scrollHeight,
      behavior: 'auto'
    });
  }, 10);
}

export function hideTypingIndicator() {
  const typingIndicator = dom.chatMessages.querySelector('.typing-indicator');
  if (typingIndicator) {
    typingIndicator.remove();
  }
}

export function setChatStatus(type, text) {
  dom.chatStatus.textContent = text;
  dom.chatStatus.className = `chat-status ${type}`;
}

export function stopChatResponse() {
  window.electronAPI.abortRequest();
  dom.stopBtn.style.display = 'none';
  dom.sendBtn.disabled = false;
  state.isTyping = false;
  hideTypingIndicator();
  setChatStatus('ready', 'Готов');
}

export function loadChatHistory() {
  dom.chatMessages.innerHTML = '';
  if (state.chatHistory && state.chatHistory.length > 0) {
    state.chatHistory.forEach(msg => {
      addChatMessage(msg.content, msg.sender);
    });
  }
}

export function saveChatHistory() {
  const messages = Array.from(dom.chatMessages.querySelectorAll('.message')).map(msg => ({
    content: msg.dataset.raw ?? (msg.textContent || msg.innerHTML),
    sender: msg.classList.contains('user') ? 'user' : 'ai'
  }));
  
  state.chatHistory = messages;
  saveAllConfig();
}

export function clearChatHistory() {
  dom.chatMessages.innerHTML = '';
  state.agentSessions = {};
  state.chatHistory = [];
  saveAllConfig();
}

// Функции для работы с настройками

export function setupChatStreamListener() {
  if (window.electronAPI && typeof window.electronAPI.onStreamUpdate === 'function') {
    window.electronAPI.onStreamUpdate((event, data) => {
      if (!dom.chatMessages || !state.isTyping) return;
      if (!streamEl) {
        hideTypingIndicator();
        streamEl = addChatMessage('', 'ai');
      }
      streamEl.dataset.raw = data.fullMessage;
      streamEl.innerHTML = renderMd(data.fullMessage);
      dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
    });
  }
}