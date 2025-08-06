// Глобальные переменные
let currentTabs = [];
let activeTabIndex = -1;
let chatVisible = false;
let currentActivity = 'explorer'; // explorer, search, git, debug, extensions
let openRouterModels = [];
let currentAiProvider = 'ollama'; // ollama, openrouter
let currentAiModel = 'llama3';

// Элементы DOM
const editor = document.getElementById('editor');
const tabsList = document.getElementById('tabs-list');
const newTabBtn = document.getElementById('new-tab-btn');
const newFileBtn = document.getElementById('new-file-btn');
const chatBtn = document.getElementById('chat-btn');
const closeChatBtn = document.getElementById('close-chat-btn');
const chatPanel = document.getElementById('chat-panel');
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const userInput = document.getElementById('user-input');
const stopBtn = document.getElementById('stop-btn');
const settingsBtn = document.getElementById('open-settings-btn');
const settingsModal = document.getElementById('modal-settings');
const closeSettingsBtn = document.getElementById('close-settings');
const closeSettingsBtn2 = document.getElementById('close-settings-btn');
const fontSizeSelect = document.getElementById('font-size-select');
const themeSelect = document.getElementById('theme-select');
const tabSizeSelect = document.getElementById('tab-size-select');

// Элементы чата
const aiProviderSelect = document.getElementById('ai-provider-select');
const aiModelSelect = document.getElementById('ai-model-select');

// Элементы настроек OpenRouter
const openRouterKeyInput = document.getElementById('openrouter-key');
const saveOpenRouterKeyBtn = document.getElementById('save-openrouter-key');
const openRouterStatus = document.getElementById('openrouter-status');
const defaultAiProviderSelect = document.getElementById('default-ai-provider');

// Кнопки боковой панели
const explorerBtn = document.getElementById('explorer-btn');
const searchBtn = document.getElementById('search-btn');
const gitBtn = document.getElementById('git-btn');
const debugBtn = document.getElementById('debug-btn');
const extensionsBtn = document.getElementById('extensions-btn');

// Панель активности
const activityPanel = document.getElementById('activity-panel');

// Инициализация приложения
document.addEventListener('DOMContentLoaded', () => {
  initializeApp();
  setupEventListeners();
  loadSettings();
  createWelcomeTab();
  initializeOpenRouter();
});

function initializeApp() {
  // Загружаем сохраненные вкладки из localStorage
  const savedTabs = localStorage.getItem('editorTabs');
  if (savedTabs) {
    try {
      currentTabs = JSON.parse(savedTabs);
      currentTabs.forEach(tab => {
        if (tab.content) {
          createTab(tab.name, tab.content, tab.filePath);
        }
      });
    } catch (e) {
      console.error('Ошибка загрузки вкладок:', e);
    }
  }
}

async function initializeOpenRouter() {
  try {
    // Загружаем API ключ
    const keyResult = await window.electronAPI.getOpenRouterKey();
    if (keyResult.success && keyResult.apiKey) {
      openRouterKeyInput.value = keyResult.apiKey;
      updateOpenRouterStatus('connected');
      
      // Загружаем модели OpenRouter
      const modelsResult = await window.electronAPI.getOpenRouterModels();
      if (modelsResult.success) {
        openRouterModels = modelsResult.models;
        updateOpenRouterModelSelect();
      }
    } else {
      updateOpenRouterStatus('not-configured');
    }
  } catch (error) {
    console.error('Ошибка инициализации OpenRouter:', error);
    updateOpenRouterStatus('disconnected');
  }
}

function updateOpenRouterStatus(status) {
  openRouterStatus.textContent = {
    'connected': 'Подключен',
    'disconnected': 'Ошибка подключения',
    'not-configured': 'Не настроен'
  }[status];
  
  openRouterStatus.className = `status-indicator ${status}`;
}

function updateOpenRouterModelSelect() {
  // Очищаем текущие опции
  aiModelSelect.innerHTML = '';
  
  if (currentAiProvider === 'ollama') {
    // Добавляем модели Ollama
    aiModelSelect.innerHTML = '<option value="llama3">llama3</option>';
  } else if (currentAiProvider === 'openrouter') {
    // Добавляем популярные модели OpenRouter
    const popularModels = [
      'openai/gpt-3.5-turbo',
      'openai/gpt-4',
      'anthropic/claude-3-haiku',
      'anthropic/claude-3-sonnet',
      'google/gemini-pro',
      'meta-llama/llama-3.1-8b-instruct',
      'meta-llama/llama-3.1-70b-instruct'
    ];
    
    popularModels.forEach(model => {
      const option = document.createElement('option');
      option.value = model;
      option.textContent = model.split('/')[1] || model;
      aiModelSelect.appendChild(option);
    });
  }
}

function setupEventListeners() {
  // Кнопки вкладок
  newTabBtn.addEventListener('click', createNewTab);
  
  // Кнопки файлов
  newFileBtn.addEventListener('click', createNewFile);
  
  // Кнопки боковой панели
  explorerBtn.addEventListener('click', () => switchActivity('explorer'));
  searchBtn.addEventListener('click', () => switchActivity('search'));
  gitBtn.addEventListener('click', () => switchActivity('git'));
  debugBtn.addEventListener('click', () => switchActivity('debug'));
  extensionsBtn.addEventListener('click', () => switchActivity('extensions'));
  
  // Кнопки чата
  chatBtn.addEventListener('click', toggleChat);
  closeChatBtn.addEventListener('click', toggleChat);
  
  // Форма чата
  chatForm.addEventListener('submit', handleChatSubmit);
  stopBtn.addEventListener('click', stopChatResponse);
  
  // Селекторы AI
  aiProviderSelect.addEventListener('change', handleAiProviderChange);
  aiModelSelect.addEventListener('change', handleAiModelChange);
  
  // Настройки
  settingsBtn.addEventListener('click', () => settingsModal.style.display = 'flex');
  closeSettingsBtn.addEventListener('click', () => settingsModal.style.display = 'none');
  closeSettingsBtn2.addEventListener('click', () => settingsModal.style.display = 'none');
  
  // OpenRouter настройки
  saveOpenRouterKeyBtn.addEventListener('click', saveOpenRouterKey);
  
  // Закрытие модального окна по клику вне его
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      settingsModal.style.display = 'none';
    }
  });
  
  // Настройки редактора
  fontSizeSelect.addEventListener('change', updateFontSize);
  themeSelect.addEventListener('change', updateTheme);
  tabSizeSelect.addEventListener('change', updateTabSize);
  defaultAiProviderSelect.addEventListener('change', updateDefaultAiProvider);
  
  // Редактор
  editor.addEventListener('input', handleEditorInput);
  editor.addEventListener('keydown', handleEditorKeydown);
  
  // Горячие клавиши
  document.addEventListener('keydown', handleGlobalKeydown);
}

function handleAiProviderChange() {
  currentAiProvider = aiProviderSelect.value;
  updateOpenRouterModelSelect();
  
  // Устанавливаем модель по умолчанию для выбранного провайдера
  if (currentAiProvider === 'ollama') {
    aiModelSelect.value = 'llama3';
    currentAiModel = 'llama3';
  } else if (currentAiProvider === 'openrouter') {
    aiModelSelect.value = 'openai/gpt-3.5-turbo';
    currentAiModel = 'openai/gpt-3.5-turbo';
  }
  
  localStorage.setItem('currentAiProvider', currentAiProvider);
  localStorage.setItem('currentAiModel', currentAiModel);
}

function handleAiModelChange() {
  currentAiModel = aiModelSelect.value;
  localStorage.setItem('currentAiModel', currentAiModel);
}

async function saveOpenRouterKey() {
  const apiKey = openRouterKeyInput.value.trim();
  if (!apiKey) {
    alert('Введите API ключ OpenRouter');
    return;
  }
  
  try {
    const result = await window.electronAPI.setOpenRouterKey(apiKey);
    if (result.success) {
      updateOpenRouterStatus('connected');
      
      // Загружаем модели OpenRouter
      const modelsResult = await window.electronAPI.getOpenRouterModels();
      if (modelsResult.success) {
        openRouterModels = modelsResult.models;
        updateOpenRouterModelSelect();
      }
      
      alert('API ключ OpenRouter успешно сохранен!');
    } else {
      alert('Ошибка сохранения API ключа: ' + result.error);
    }
  } catch (error) {
    alert('Ошибка сохранения API ключа: ' + error.message);
  }
}

function updateDefaultAiProvider() {
  const defaultProvider = defaultAiProviderSelect.value;
  localStorage.setItem('defaultAiProvider', defaultProvider);
  
  // Обновляем текущий провайдер в чате
  aiProviderSelect.value = defaultProvider;
  handleAiProviderChange();
}

// Функции для работы с активностью
function switchActivity(activity) {
  // Убираем активный класс со всех кнопок
  [explorerBtn, searchBtn, gitBtn, debugBtn, extensionsBtn].forEach(btn => {
    btn.classList.remove('active');
  });
  
  // Добавляем активный класс к выбранной кнопке
  switch(activity) {
    case 'explorer':
      explorerBtn.classList.add('active');
      showExplorerPanel();
      break;
    case 'search':
      searchBtn.classList.add('active');
      showSearchPanel();
      break;
    case 'git':
      gitBtn.classList.add('active');
      showGitPanel();
      break;
    case 'debug':
      debugBtn.classList.add('active');
      showDebugPanel();
      break;
    case 'extensions':
      extensionsBtn.classList.add('active');
      showExtensionsPanel();
      break;
  }
  
  currentActivity = activity;
}

function showExplorerPanel() {
  activityPanel.innerHTML = `
    <div class="activity-header">
      <h3>EXPLORER</h3>
      <button class="activity-btn" title="Новый файл" id="new-file-btn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M12 5v14m-7-7h14" stroke="#d4d4d4" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
    <div id="file-explorer" class="file-explorer">
      <div class="file-item" data-path="welcome.txt">
        <span class="file-icon">📄</span>
        <span class="file-name">welcome.txt</span>
      </div>
    </div>
  `;
  
  // Переподключаем обработчик для новой кнопки
  document.getElementById('new-file-btn').addEventListener('click', createNewFile);
}

function showSearchPanel() {
  activityPanel.innerHTML = `
    <div class="activity-header">
      <h3>SEARCH</h3>
    </div>
    <div class="search-panel">
      <div class="search-input-container">
        <input type="text" id="search-input" placeholder="Поиск в файлах..." />
        <button id="search-btn" class="search-btn">Найти</button>
      </div>
      <div id="search-results" class="search-results">
        <div class="search-placeholder">Введите текст для поиска</div>
      </div>
    </div>
  `;
  
  // Добавляем обработчики поиска
  const searchInput = document.getElementById('search-input');
  const searchBtn = document.getElementById('search-btn');
  
  searchBtn.addEventListener('click', performSearch);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') performSearch();
  });
}

function showGitPanel() {
  activityPanel.innerHTML = `
    <div class="activity-header">
      <h3>SOURCE CONTROL</h3>
    </div>
    <div class="git-panel">
      <div class="git-status">
        <div class="git-branch">main</div>
        <div class="git-changes">
          <div class="git-change-item">
            <span class="change-icon">📝</span>
            <span class="change-name">welcome.txt</span>
            <span class="change-status">modified</span>
          </div>
        </div>
      </div>
      <div class="git-actions">
        <button class="git-btn">Commit</button>
        <button class="git-btn">Push</button>
      </div>
    </div>
  `;
}

function showDebugPanel() {
  activityPanel.innerHTML = `
    <div class="activity-header">
      <h3>RUN AND DEBUG</h3>
    </div>
    <div class="debug-panel">
      <div class="debug-config">
        <select id="debug-config-select">
          <option value="">Выберите конфигурацию</option>
          <option value="node">Node.js</option>
          <option value="python">Python</option>
        </select>
      </div>
      <div class="debug-actions">
        <button class="debug-btn" id="start-debug-btn">▶️ Запустить</button>
        <button class="debug-btn" id="stop-debug-btn">⏹️ Остановить</button>
      </div>
      <div class="debug-output">
        <div class="debug-placeholder">Выберите конфигурацию для отладки</div>
      </div>
    </div>
  `;
}

function showExtensionsPanel() {
  activityPanel.innerHTML = `
    <div class="activity-header">
      <h3>EXTENSIONS</h3>
    </div>
    <div class="extensions-panel">
      <div class="extensions-search">
        <input type="text" placeholder="Поиск расширений..." />
      </div>
      <div class="extensions-list">
        <div class="extension-item">
          <div class="extension-icon">🔧</div>
          <div class="extension-info">
            <div class="extension-name">Code Formatter</div>
            <div class="extension-desc">Автоматическое форматирование кода</div>
          </div>
          <button class="extension-btn">Установить</button>
        </div>
        <div class="extension-item">
          <div class="extension-icon">🎨</div>
          <div class="extension-info">
            <div class="extension-name">Theme Pack</div>
            <div class="extension-desc">Дополнительные темы оформления</div>
          </div>
          <button class="extension-btn">Установить</button>
        </div>
      </div>
    </div>
  `;
}

function performSearch() {
  const searchInput = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');
  const query = searchInput.value.trim();
  
  if (!query) {
    searchResults.innerHTML = '<div class="search-placeholder">Введите текст для поиска</div>';
    return;
  }
  
  // Простой поиск в текущих вкладках
  const results = [];
  currentTabs.forEach((tab, index) => {
    if (tab.content && tab.content.toLowerCase().includes(query.toLowerCase())) {
      results.push({
        file: tab.name,
        tabIndex: index,
        matches: tab.content.toLowerCase().split(query.toLowerCase()).length - 1
      });
    }
  });
  
  if (results.length === 0) {
    searchResults.innerHTML = '<div class="search-placeholder">Ничего не найдено</div>';
  } else {
    searchResults.innerHTML = results.map(result => `
      <div class="search-result-item" onclick="switchToTab(${result.tabIndex})">
        <span class="result-file">${result.file}</span>
        <span class="result-matches">${result.matches} совпадений</span>
      </div>
    `).join('');
  }
}

// Функции для работы с вкладками
function createTab(name, content = '', filePath = null) {
  const tab = {
    id: Date.now() + Math.random(),
    name: name,
    content: content,
    filePath: filePath,
    modified: false
  };
  
  currentTabs.push(tab);
  updateTabsList();
  switchToTab(currentTabs.length - 1);
  saveTabs();
}

function createNewTab() {
  createTab('Новый файл');
}

function createNewFile() {
  createTab('Новый файл');
}

function switchToTab(index) {
  if (index >= 0 && index < currentTabs.length) {
    // Сохраняем содержимое текущей вкладки
    if (activeTabIndex >= 0 && activeTabIndex < currentTabs.length) {
      currentTabs[activeTabIndex].content = editor.value;
    }
    
    activeTabIndex = index;
    const tab = currentTabs[index];
    
    // Обновляем редактор
    editor.value = tab.content || '';
    editor.focus();
    
    // Обновляем UI
    updateTabsList();
    updateTabTitle();
  }
}

function closeTab(index) {
  if (index >= 0 && index < currentTabs.length) {
    const tab = currentTabs[index];
    
    // Проверяем, есть ли несохраненные изменения
    if (tab.modified) {
      if (!confirm(`Файл "${tab.name}" не сохранен. Закрыть?`)) {
        return;
      }
    }
    
    currentTabs.splice(index, 1);
    
    if (currentTabs.length === 0) {
      createWelcomeTab();
    } else if (activeTabIndex >= currentTabs.length) {
      switchToTab(currentTabs.length - 1);
    } else {
      switchToTab(activeTabIndex);
    }
    
    saveTabs();
  }
}

function updateTabsList() {
  tabsList.innerHTML = '';
  
  currentTabs.forEach((tab, index) => {
    const tabElement = document.createElement('div');
    tabElement.className = `tab-item ${index === activeTabIndex ? 'active' : ''}`;
    tabElement.innerHTML = `
      <span class="tab-name">${tab.name}${tab.modified ? ' *' : ''}</span>
      <button class="tab-close" onclick="closeTab(${index})">&times;</button>
    `;
    tabElement.addEventListener('click', () => switchToTab(index));
    tabsList.appendChild(tabElement);
  });
}

function updateTabTitle() {
  if (activeTabIndex >= 0 && activeTabIndex < currentTabs.length) {
    const tab = currentTabs[activeTabIndex];
    document.title = `${tab.name}${tab.modified ? ' *' : ''} - FrogeeCodeIDE`;
  }
}

function createWelcomeTab() {
  const welcomeContent = `Добро пожаловать в FrogeeCodeIDE!

Это современный редактор кода с поддержкой:
• Множественных вкладок
• Различных языков программирования
• Темной и светлой темы
• Чат с AI (Ollama и OpenRouter)
• Боковая панель в стиле VS Code

Начните писать код или откройте файл!

Пример кода на JavaScript:
function hello() {
    console.log("Hello, World!");
}

Пример кода на Python:
def hello():
    print("Hello, World!")

Пример HTML:
<!DOCTYPE html>
<html>
<head>
    <title>Hello</title>
</head>
<body>
    <h1>Hello, World!</h1>
</body>
</html>`;

  createTab('welcome.txt', welcomeContent);
}

// Функции для работы с файлами
async function openFile() {
  try {
    const result = await window.electronAPI.openFile();
    if (result.success) {
      createTab(path.basename(result.filePath), result.content, result.filePath);
    }
  } catch (error) {
    console.error('Ошибка открытия файла:', error);
  }
}

async function saveFile() {
  if (activeTabIndex >= 0 && activeTabIndex < currentTabs.length) {
    const tab = currentTabs[activeTabIndex];
    const content = editor.value;
    
    try {
      let result;
      if (tab.filePath) {
        result = await window.electronAPI.saveFile(content);
      } else {
        result = await window.electronAPI.saveFileAs(content);
      }
      
      if (result.success) {
        tab.filePath = result.filePath;
        tab.name = path.basename(result.filePath);
        tab.modified = false;
        updateTabsList();
        updateTabTitle();
        saveTabs();
      }
    } catch (error) {
      console.error('Ошибка сохранения файла:', error);
    }
  }
}

// Функции для работы с редактором
function handleEditorInput() {
  if (activeTabIndex >= 0 && activeTabIndex < currentTabs.length) {
    const tab = currentTabs[activeTabIndex];
    const currentContent = editor.value;
    
    if (tab.content !== currentContent) {
      tab.modified = true;
      tab.content = currentContent;
      updateTabsList();
      updateTabTitle();
      saveTabs();
    }
  }
}

function handleEditorKeydown(e) {
  // Обработка табуляции
  if (e.key === 'Tab') {
    e.preventDefault();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const tabSize = parseInt(tabSizeSelect.value);
    const spaces = ' '.repeat(tabSize);
    
    editor.value = editor.value.substring(0, start) + spaces + editor.value.substring(end);
    editor.selectionStart = editor.selectionEnd = start + tabSize;
  }
}

function handleGlobalKeydown(e) {
  // Ctrl+N - новый файл
  if (e.ctrlKey && e.key === 'n') {
    e.preventDefault();
    createNewFile();
  }
  
  // Ctrl+O - открыть файл
  if (e.ctrlKey && e.key === 'o') {
    e.preventDefault();
    openFile();
  }
  
  // Ctrl+S - сохранить файл
  if (e.ctrlKey && e.key === 's') {
    e.preventDefault();
    saveFile();
  }
  
  // Ctrl+Shift+S - сохранить как
  if (e.ctrlKey && e.shiftKey && e.key === 'S') {
    e.preventDefault();
    saveFileAs();
  }
  
  // Ctrl+W - закрыть вкладку
  if (e.ctrlKey && e.key === 'w') {
    e.preventDefault();
    if (activeTabIndex >= 0) {
      closeTab(activeTabIndex);
    }
  }
  
  // Ctrl+Tab - следующая вкладка
  if (e.ctrlKey && e.key === 'Tab') {
    e.preventDefault();
    if (currentTabs.length > 1) {
      const nextIndex = (activeTabIndex + 1) % currentTabs.length;
      switchToTab(nextIndex);
    }
  }
  
  // Ctrl+Shift+F - поиск
  if (e.ctrlKey && e.shiftKey && e.key === 'F') {
    e.preventDefault();
    switchActivity('search');
  }
}

async function saveFileAs() {
  if (activeTabIndex >= 0 && activeTabIndex < currentTabs.length) {
    const content = editor.value;
    
    try {
      const result = await window.electronAPI.saveFileAs(content);
      if (result.success) {
        const tab = currentTabs[activeTabIndex];
        tab.filePath = result.filePath;
        tab.name = path.basename(result.filePath);
        tab.modified = false;
        updateTabsList();
        updateTabTitle();
        saveTabs();
      }
    } catch (error) {
      console.error('Ошибка сохранения файла:', error);
    }
  }
}

// Функции для работы с чатом
function toggleChat() {
  chatVisible = !chatVisible;
  chatPanel.style.display = chatVisible ? 'flex' : 'none';
  
  if (chatVisible) {
    chatBtn.classList.add('active');
    loadChatHistory();
  } else {
    chatBtn.classList.remove('active');
  }
}

async function handleChatSubmit(e) {
  e.preventDefault();
  const message = userInput.value.trim();
  if (!message) return;
  
  // Добавляем сообщение пользователя
  addChatMessage(message, 'user');
  userInput.value = '';
  
  // Показываем кнопку остановки
  stopBtn.style.display = 'inline-block';
  
  try {
    // Определяем, какой провайдер использовать
    const useOpenRouter = currentAiProvider === 'openrouter';
    
    // Отправляем сообщение в AI
    const response = await window.electronAPI.sendMessage(message, currentAiModel, true, useOpenRouter);
    
    if (response && response.answer) {
      addChatMessage(response.answer, 'ai');
    } else {
      addChatMessage('Ошибка получения ответа от AI', 'ai');
    }
  } catch (error) {
    addChatMessage(`Ошибка: ${error.message}`, 'ai');
  } finally {
    stopBtn.style.display = 'none';
  }
}

function addChatMessage(content, sender) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${sender}`;
  messageDiv.textContent = content;
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  
  // Сохраняем историю чата
  saveChatHistory();
}

function stopChatResponse() {
  window.electronAPI.abortRequest();
  stopBtn.style.display = 'none';
}

function loadChatHistory() {
  const history = localStorage.getItem('chatHistory');
  if (history) {
    try {
      const messages = JSON.parse(history);
      chatMessages.innerHTML = '';
      messages.forEach(msg => {
        addChatMessage(msg.content, msg.sender);
      });
    } catch (e) {
      console.error('Ошибка загрузки истории чата:', e);
    }
  }
}

function saveChatHistory() {
  const messages = Array.from(chatMessages.children).map(msg => ({
    content: msg.textContent,
    sender: msg.classList.contains('user') ? 'user' : 'ai'
  }));
  localStorage.setItem('chatHistory', JSON.stringify(messages));
}

// Функции для работы с настройками
function loadSettings() {
  const fontSize = localStorage.getItem('fontSize') || '16';
  const theme = localStorage.getItem('theme') || 'dark';
  const tabSize = localStorage.getItem('tabSize') || '4';
  const defaultProvider = localStorage.getItem('defaultAiProvider') || 'ollama';
  const savedProvider = localStorage.getItem('currentAiProvider') || defaultProvider;
  const savedModel = localStorage.getItem('currentAiModel') || 'llama3';
  
  fontSizeSelect.value = fontSize;
  themeSelect.value = theme;
  tabSizeSelect.value = tabSize;
  defaultAiProviderSelect.value = defaultProvider;
  
  // Устанавливаем текущие значения AI
  currentAiProvider = savedProvider;
  currentAiModel = savedModel;
  aiProviderSelect.value = currentAiProvider;
  aiModelSelect.value = currentAiModel;
  
  updateFontSize();
  updateTheme();
  updateTabSize();
  updateOpenRouterModelSelect();
}

function updateFontSize() {
  const size = fontSizeSelect.value;
  editor.style.fontSize = size + 'px';
  localStorage.setItem('fontSize', size);
}

function updateTheme() {
  const theme = themeSelect.value;
  document.body.className = theme === 'light' ? 'light-theme' : '';
  localStorage.setItem('theme', theme);
}

function updateTabSize() {
  const size = tabSizeSelect.value;
  editor.style.tabSize = size;
  localStorage.setItem('tabSize', size);
}

// Функции для сохранения состояния
function saveTabs() {
  localStorage.setItem('editorTabs', JSON.stringify(currentTabs));
}

// Утилиты
function path() {
  return {
    basename: (filePath) => {
      return filePath.split(/[\\/]/).pop();
    }
  };
}

// Обработчик потоковых обновлений от AI
window.electronAPI.onStreamUpdate((event, data) => {
  // Находим последнее сообщение AI и обновляем его
  const aiMessages = chatMessages.querySelectorAll('.message.ai');
  if (aiMessages.length > 0) {
    const lastMessage = aiMessages[aiMessages.length - 1];
    lastMessage.textContent = data.fullMessage;
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}); 