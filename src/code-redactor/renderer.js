// Глобальные переменные
let currentTabs = [];
let activeTabIndex = -1;
let chatVisible = false;
let currentActivity = 'explorer'; // explorer, search, git, debug, extensions
let openRouterModels = [];
let currentAiProvider = 'ollama'; // ollama, openrouter
let currentAiModel = 'llama3';
let defaultAiProvider = 'ollama';
let isTyping = false;
let currentFolder = null; // Текущая открытая папка
let fileExplorerItems = []; // Элементы в file explorer
let copiedFilePath = null; // Путь к скопированному файлу/папке

// Утилиты для работы с путями
const pathUtils = {
  basename: (filePath) => {
    return filePath.split(/[\\/]/).pop();
  },
  dirname: (filePath) => {
    const parts = filePath.split(/[\\/]/);
    parts.pop();
    return parts.join('/') || '/';
  },
  extname: (filePath) => {
    const basename = pathUtils.basename(filePath);
    const dotIndex = basename.lastIndexOf('.');
    return dotIndex > 0 ? basename.substring(dotIndex) : '';
  },
  join: (...parts) => {
    return parts.filter(p => p).join('/').replace(/\/+/g, '/');
  }
};

// Элементы DOM
const editor = document.getElementById('editor')
const tabsList = document.getElementById('tabs-list');
const newTabBtn = document.getElementById('new-tab-btn');
const newFileBtn = document.getElementById('new-file-btn');
const chatBtn = document.getElementById('chat-btn');
const closeChatBtn = document.getElementById('close-chat-btn');
const clearChatBtn = document.getElementById('clear-chat-btn');
const chatPanel = document.getElementById('chat-panel');
const chatMessages = document.getElementById('chat-messages');
const chatStatus = document.getElementById('chat-status');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const stopBtn = document.getElementById('stop-btn');
const settingsBtn = document.getElementById('open-settings-btn');
const settingsModal = document.getElementById('modal-settings');
const closeSettingsBtn = document.getElementById('close-settings');
const closeSettingsBtn2 = document.getElementById('close-settings-btn');
const fontSizeSelect = document.getElementById('font-size-select');
const themeSelect = document.getElementById('theme-select');
const tabSizeSelect = document.getElementById('tab-size-select');
const lineNumbers = document.getElementById('line-numbers');

// Элементы настроек прозрачности
const glassOpacityRange = document.getElementById('glass-opacity-range');
const glassOpacityValue = document.getElementById('glass-opacity-value');
const glassBlurRange = document.getElementById('glass-blur-range');
const glassBlurValue = document.getElementById('glass-blur-value');
const glassBlurCheckbox = document.getElementById('glass-blur-checkbox');

// Элементы стартовой страницы
const welcomePage = document.getElementById('welcome-page');
const editorTabs = document.getElementById('editor-tabs');
const editorContainer = document.getElementById('editor-container');
const showWelcomeCheckbox = document.getElementById('show-welcome-checkbox');

// Элементы действий стартовой страницы
const newFileAction = document.getElementById('new-file-action');
const openFileAction = document.getElementById('open-file-action');
const aiChatAction = document.getElementById('ai-chat-action');

// Элементы чата
const aiProviderSelect = document.getElementById('ai-provider-select');
const aiModelSelect = document.getElementById('ai-model-select');

// Элементы настроек OpenRouter
const openRouterKeyInput = document.getElementById('openrouter-key');
const saveOpenRouterKeyBtn = document.getElementById('save-openrouter-key');
const openRouterStatus = document.getElementById('openrouter-status');
const defaultAiProviderSelect = document.getElementById('default-ai-provider');
const openRouterSection = document.getElementById('openrouter-section');
const ollamaSection = document.getElementById('ollama-section');

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
  try {
    initializeApp();
    setupEventListeners();
    initializeOpenRouter();
  } catch (error) {
    console.error('Ошибка инициализации приложения:', error);
  }
});

async function initializeApp() {
  try {
    // Убеждаемся, что модальное окно скрыто
    if (settingsModal) {
      settingsModal.style.display = 'none';
      settingsModal.style.pointerEvents = 'none';
      settingsModal.style.visibility = 'hidden';
      settingsModal.style.opacity = '0';
    }
    
    // Убеждаемся, что панель чата скрыта
    if (chatPanel) {
      chatPanel.style.display = 'none';
      chatPanel.style.pointerEvents = 'none';
      chatPanel.style.visibility = 'hidden';
      chatPanel.style.opacity = '0';
    }
    
    // Загружаем конфигурацию
    const config = await window.electronAPI.loadConfig();
    
    // Применяем настройки
    fontSizeSelect.value = config.fontSize || '16';
    themeSelect.value = config.theme || 'dark';
    tabSizeSelect.value = config.tabSize || '4';
    
    // Применяем настройки прозрачности
    const glassOpacity = config.glassOpacity !== undefined ? config.glassOpacity : 0.85;
    const glassBlur = config.glassBlur !== undefined ? config.glassBlur : 10;
    const glassBlurEnabled = config.glassBlurEnabled !== undefined ? config.glassBlurEnabled : true;
    
    if (glassOpacityRange) {
      glassOpacityRange.value = glassOpacity;
      updateGlassOpacityValue(glassOpacity);
    }
    if (glassBlurRange) {
      glassBlurRange.value = glassBlur;
      updateGlassBlurValue(glassBlur);
    }
    if (glassBlurCheckbox) {
      glassBlurCheckbox.checked = glassBlurEnabled;
    }
    
    applyGlassmorphismSettings(glassOpacity, glassBlur, glassBlurEnabled);
    
    // Применяем тему
    updateTheme();
    
    // Загружаем сохраненные вкладки
    if (config.editorTabs && config.editorTabs.length > 0) {
      currentTabs = config.editorTabs;
      activeTabIndex = 0;
      
      // Создаем вкладки
      for (const tab of currentTabs) {
        createTab(tab.name, tab.content, tab.filePath);
      }
      
      // Переключаемся на первую вкладку
      if (currentTabs.length > 0) {
        switchToTab(0);
      }
    }
    
    // Настройки AI
    defaultAiProvider = config.defaultAiProvider || 'ollama';
    currentAiProvider = config.currentAiProvider || defaultAiProvider;
    currentAiModel = config.currentAiModel || (currentAiProvider === 'openrouter' ? 'deepseek/deepseek-r1-0528:free' : 'llama3');

    // Устанавливаем значения селектов
    if (defaultAiProviderSelect) defaultAiProviderSelect.value = defaultAiProvider;
    if (aiProviderSelect) aiProviderSelect.value = currentAiProvider;
    updateOpenRouterModelSelect();
    if (aiModelSelect) aiModelSelect.value = currentAiModel;
    
    // Настройки стартовой страницы
    const showWelcome = config.showWelcomePage !== false;
    
    // Показываем стартовую страницу если нет вкладок
    if (currentTabs.length === 0) {
      showWelcomePage();
    }
    
    // Инициализируем OpenRouter
    await initializeOpenRouter();
    
    // Загружаем историю чата
    if (config.chatHistory && config.chatHistory.length > 0) {
      chatHistory = config.chatHistory;
      loadChatHistory();
    }
    
  } catch (error) {
    console.error('Ошибка загрузки конфигурации:', error);
    // Показываем стартовую страницу по умолчанию
    showWelcomePage();
  }
}

async function initializeOpenRouter() {
  try {
    const apiKeyResult = await window.electronAPI.getOpenRouterKey();
    if (apiKeyResult) {
      openRouterKeyInput.value = apiKeyResult;
      updateOpenRouterStatus('connected');
      
      // Загружаем модели OpenRouter
      try {
        const modelsResult = await window.electronAPI.getOpenRouterModels();
        if (modelsResult.success) {
          openRouterModels = modelsResult.models;
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

function updateOpenRouterModelSelect() {
  // Очищаем текущие опции
  aiModelSelect.innerHTML = '';
  
  if (currentAiProvider === 'ollama') {
    // Добавляем модели Ollama
    aiModelSelect.innerHTML = `
      <option value="llama3">Llama 3</option>
      <option value="llama3.2">Llama 3.2</option>
      <option value="mistral">Mistral</option>
      <option value="codellama">Code Llama</option>
    `;
  } else if (currentAiProvider === 'openrouter') {
    // Добавляем бесплатные модели OpenRouter
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
      // Красиво отображаем название модели
      const displayName = model.split('/')[1]?.split(':')[0] || model.split('/')[0];
      option.textContent = displayName;
      aiModelSelect.appendChild(option);
    });
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

function setupEventListeners() {
  // Кнопки вкладок
  if (newTabBtn) {
    newTabBtn.addEventListener('click', createNewTab);
  }
  
  // Кнопки файлов
  if (newFileBtn) {
    newFileBtn.addEventListener('click', createNewFile);
  }
  
  // Кнопки explorer
  const openFolderBtn = document.getElementById('open-folder-btn');
  if (openFolderBtn) {
    openFolderBtn.addEventListener('click', openFolder);
  }
  
  // Действия стартовой страницы
  if (newFileAction) {
    newFileAction.addEventListener('click', handleNewFileAction);
  }
  if (openFileAction) {
    openFileAction.addEventListener('click', handleOpenFileAction);
  }
  if (aiChatAction) {
    aiChatAction.addEventListener('click', handleAiChatAction);
  }
  
  // Чекбокс стартовой страницы
  if (showWelcomeCheckbox) {
    showWelcomeCheckbox.addEventListener('change', handleWelcomeCheckboxChange);
  }
  
  // Кнопки боковой панели
  if (explorerBtn) {
    explorerBtn.addEventListener('click', () => switchActivity('explorer'));
  }
  if (searchBtn) {
    searchBtn.addEventListener('click', () => switchActivity('search'));
  }
  if (gitBtn) {
    gitBtn.addEventListener('click', () => switchActivity('git'));
  }
  if (debugBtn) {
    debugBtn.addEventListener('click', () => switchActivity('debug'));
  }
  if (extensionsBtn) {
    extensionsBtn.addEventListener('click', () => switchActivity('extensions'));
  }
  
  // Кнопки чата
  if (chatBtn) {
    chatBtn.addEventListener('click', toggleChat);
  }
  if (closeChatBtn) {
    closeChatBtn.addEventListener('click', toggleChat);
  }
  if (clearChatBtn) {
    clearChatBtn.addEventListener('click', clearChatHistory);
  }
  
  // Форма чата
  if (sendBtn) {
    sendBtn.addEventListener('click', handleChatSubmit);
  }
  if (stopBtn) {
    stopBtn.addEventListener('click', stopChatResponse);
  }
  
  // Обработка ввода в чате
  if (userInput) {
    userInput.addEventListener('keydown', handleChatKeydown);
    userInput.addEventListener('input', handleTextareaResize);
  }
  
  // Селекторы AI
  if (aiProviderSelect) {
    aiProviderSelect.addEventListener('change', handleAiProviderChange);
  }
  if (aiModelSelect) {
    aiModelSelect.addEventListener('change', handleAiModelChange);
  }
  
  // Настройки
  if (settingsBtn && settingsModal) {
    settingsBtn.addEventListener('click', () => {
      settingsModal.style.display = 'flex';
      settingsModal.style.pointerEvents = 'auto';
      settingsModal.style.visibility = 'visible';
      settingsModal.style.opacity = '1';
    });
  }
  if (closeSettingsBtn && settingsModal) {
    closeSettingsBtn.addEventListener('click', () => {
      settingsModal.style.display = 'none';
      settingsModal.style.pointerEvents = 'none';
      settingsModal.style.visibility = 'hidden';
      settingsModal.style.opacity = '0';
    });
  }
  if (closeSettingsBtn2 && settingsModal) {
    closeSettingsBtn2.addEventListener('click', () => {
      settingsModal.style.display = 'none';
      settingsModal.style.pointerEvents = 'none';
      settingsModal.style.visibility = 'hidden';
      settingsModal.style.opacity = '0';
    });
  }
  
  // OpenRouter настройки
  if (saveOpenRouterKeyBtn) {
    saveOpenRouterKeyBtn.addEventListener('click', saveOpenRouterKey);
  }
  
  // Закрытие модального окна по клику вне его
  if (settingsModal) {
    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) {
        settingsModal.style.display = 'none';
        settingsModal.style.pointerEvents = 'none';
        settingsModal.style.visibility = 'hidden';
        settingsModal.style.opacity = '0';
      }
    });
  }
  
  // Настройки редактора
  if (fontSizeSelect) {
    fontSizeSelect.addEventListener('change', updateFontSize);
  }
  if (themeSelect) {
    themeSelect.addEventListener('change', updateTheme);
  }
  if (tabSizeSelect) {
    tabSizeSelect.addEventListener('change', updateTabSize);
  }
  if (defaultAiProviderSelect) {
    defaultAiProviderSelect.addEventListener('change', updateDefaultAiProvider);
  }
  
  // Настройки прозрачности
  if (glassOpacityRange && glassOpacityValue) {
    glassOpacityRange.addEventListener('input', handleGlassOpacityChange);
  }
  if (glassBlurRange && glassBlurValue) {
    glassBlurRange.addEventListener('input', handleGlassBlurChange);
  }
  if (glassBlurCheckbox) {
    glassBlurCheckbox.addEventListener('change', handleGlassBlurCheckboxChange);
  }
  
  // Редактор
  if (editor) {
    editor.addEventListener('input', handleEditorInput);
    editor.addEventListener('keydown', handleEditorKeydown);
    editor.addEventListener('scroll', handleEditorScroll);
    editor.addEventListener('click', updateCurrentLine);
    editor.addEventListener('keyup', updateCurrentLine);
  }
  
  // Горячие клавиши
  document.addEventListener('keydown', handleGlobalKeydown);
}

function handleAiProviderChange() {
  currentAiProvider = aiProviderSelect.value;
  
  // Обновляем UI
  if (currentAiProvider === 'openrouter') {
    openRouterSection.style.display = 'block';
    ollamaSection.style.display = 'none';
    updateOpenRouterModelSelect();
  } else {
    openRouterSection.style.display = 'none';
    ollamaSection.style.display = 'block';
    updateOpenRouterModelSelect();
  }
  
  // Устанавливаем модель по умолчанию для выбранного провайдера
  if (currentAiProvider === 'ollama') {
    aiModelSelect.value = 'llama3';
    currentAiModel = 'llama3';
  } else if (currentAiProvider === 'openrouter') {
    aiModelSelect.value = 'deepseek/deepseek-r1-0528:free';
    currentAiModel = 'deepseek/deepseek-r1-0528:free';
  }
  
  saveAllConfig();
}

function handleAiModelChange() {
  currentAiModel = aiModelSelect.value;
  saveAllConfig();
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
      // Clear the input field but keep the key in memory
      openRouterKeyInput.value = '';
      alert('API ключ OpenRouter сохранен!');
      
      // Загружаем модели OpenRouter
      try {
        const modelsResult = await window.electronAPI.getOpenRouterModels();
        if (modelsResult.success) {
          openRouterModels = modelsResult.models;
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

function updateDefaultAiProvider() {
  defaultAiProvider = defaultAiProviderSelect.value;
  
  // Обновляем модели по умолчанию
  updateOpenRouterModelSelect();
  
  // Устанавливаем текущую модель
  if (currentAiProvider === defaultAiProvider) {
    currentAiModel = aiModelSelect.value;
  }
  
  saveAllConfig();
}

// Функция для сохранения всей конфигурации
async function saveAllConfig() {
  try {
    const config = {
      fontSize: fontSizeSelect ? fontSizeSelect.value : '16',
      theme: themeSelect ? themeSelect.value : 'dark',
      tabSize: tabSizeSelect ? tabSizeSelect.value : '4',
      defaultAiProvider,
      currentAiProvider,
      currentAiModel,
      showWelcomePage: showWelcomeCheckbox ? showWelcomeCheckbox.checked : true,
      editorTabs: currentTabs,
      chatHistory: chatHistory,
      glassOpacity: glassOpacityRange ? parseFloat(glassOpacityRange.value) : 0.85,
      glassBlur: glassBlurRange ? parseInt(glassBlurRange.value) : 10,
      glassBlurEnabled: glassBlurCheckbox ? glassBlurCheckbox.checked : true
    };
    
    await window.electronAPI.saveConfig(config);
  } catch (error) {
    console.error('Ошибка сохранения конфигурации:', error);
  }
}

// Функции для работы со стартовой страницей
function showWelcomePage() {
  welcomePage.style.display = 'flex';
  editorTabs.style.display = 'none';
  editorContainer.style.display = 'none';
}

function hideWelcomePage() {
  welcomePage.style.display = 'none';
  editorTabs.style.display = 'flex';
  editorContainer.style.display = 'flex';
}

function handleNewFileAction() {
  hideWelcomePage();
  createNewFile();
}

function handleOpenFileAction() {
  hideWelcomePage();
  openFileOrFolder();
}

function handleAiChatAction() {
  // Открываем чат с AI
  if (!chatVisible) {
    toggleChat();
  }
}

function handleWelcomeCheckboxChange() {
  saveAllConfig();
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
      <div class="activity-buttons">
        <button class="activity-btn" title="Открыть папку" id="open-folder-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>
          </svg>
        </button>
        <button class="activity-btn" title="Новый файл" id="new-file-in-folder-btn" ${!currentFolder ? 'disabled' : ''}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
            <polyline points="14,2 14,8 20,8"/>
            <line x1="12" y1="18" x2="12" y2="12"/>
            <line x1="9" y1="15" x2="15" y2="15"/>
          </svg>
        </button>
        <button class="activity-btn" title="Новая папка" id="new-folder-btn" ${!currentFolder ? 'disabled' : ''}>
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
  `;
  
  // Переподключаем обработчики для новых кнопок
  document.getElementById('open-folder-btn').addEventListener('click', openFolder);
  document.getElementById('new-file-in-folder-btn').addEventListener('click', createNewFileInFolder);
  document.getElementById('new-folder-btn').addEventListener('click', createNewFolderInFolder);
  
  // Обновляем explorer если папка уже открыта
  if (currentFolder) {
    updateFileExplorer();
  }
}

function showSearchPanel() {
  activityPanel.innerHTML = `
    <div class="activity-header">
      <h3>SEARCH</h3>
    </div>
    <div class="search-panel">
      <div class="search-input-container">
        <input type="text" id="search-input" class="search-input" placeholder="Поиск в файлах..." />
        <div class="search-options">
          <button class="search-option-btn" id="search-case-sensitive" title="Учитывать регистр">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 18L18 6M6 6l12 12"/>
            </svg>
            Aa
          </button>
          <button class="search-option-btn" id="search-regex" title="Регулярные выражения">
            .*
          </button>
        </div>
        <button id="search-btn" class="search-btn">Найти</button>
      </div>
      <div class="search-filters">
        <input type="text" id="search-file-filter" class="search-filter-input" placeholder="Фильтр файлов (например: js,ts,py)" />
      </div>
      <div id="search-results" class="search-results">
        <div class="search-placeholder">Откройте папку для поиска по файлам</div>
      </div>
    </div>
  `;
  
  // Добавляем обработчики поиска
  const searchInput = document.getElementById('search-input');
  const searchBtn = document.getElementById('search-btn');
  const caseSensitiveBtn = document.getElementById('search-case-sensitive');
  const regexBtn = document.getElementById('search-regex');
  const fileFilterInput = document.getElementById('search-file-filter');
  
  let searchOptions = {
    caseSensitive: false,
    useRegex: false,
    fileFilter: ''
  };
  
  caseSensitiveBtn.addEventListener('click', () => {
    searchOptions.caseSensitive = !searchOptions.caseSensitive;
    caseSensitiveBtn.classList.toggle('active', searchOptions.caseSensitive);
    if (searchInput.value.trim()) {
      performSearch();
    }
  });
  
  regexBtn.addEventListener('click', () => {
    searchOptions.useRegex = !searchOptions.useRegex;
    regexBtn.classList.toggle('active', searchOptions.useRegex);
    if (searchInput.value.trim()) {
      performSearch();
    }
  });
  
  fileFilterInput.addEventListener('input', () => {
    searchOptions.fileFilter = fileFilterInput.value.trim();
    if (searchInput.value.trim()) {
      performSearch();
    }
  });
  
  searchBtn.addEventListener('click', performSearch);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') performSearch();
  });
  
  // Сохраняем опции поиска для использования в performSearch
  window.currentSearchOptions = searchOptions;
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
          <div class="git-placeholder">
            <p>No changes detected</p>
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

async function performSearch() {
  const searchInput = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');
  const query = searchInput.value.trim();
  
  if (!query) {
    searchResults.innerHTML = '<div class="search-placeholder">Введите текст для поиска</div>';
    return;
  }
  
  if (!currentFolder) {
    searchResults.innerHTML = '<div class="search-placeholder">Откройте папку для поиска по файлам</div>';
    return;
  }
  
  // Показываем индикатор загрузки
  searchResults.innerHTML = '<div class="search-placeholder">Поиск...</div>';
  
  try {
    const options = window.currentSearchOptions || {
      caseSensitive: false,
      useRegex: false,
      fileFilter: ''
    };
    
    const result = await window.electronAPI.searchInFiles(currentFolder, query, options);
    
    if (!result.success) {
      searchResults.innerHTML = `<div class="search-placeholder error">Ошибка: ${result.error}</div>`;
      return;
    }
    
    if (result.results.length === 0) {
      searchResults.innerHTML = '<div class="search-placeholder">Ничего не найдено</div>';
      return;
    }
    
    // Формируем HTML с результатами
    let html = `<div class="search-summary">Найдено ${result.totalMatches} совпадений в ${result.results.length} файлах</div>`;
    
    result.results.forEach(fileResult => {
      // Экранируем путь для использования в onclick
      const escapedPath = fileResult.fullPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      
      html += `
        <div class="search-file-group">
          <div class="search-file-header" onclick="openSearchFile('${escapedPath}')">
            <span class="search-file-name">${escapeHtml(fileResult.file)}</span>
            <span class="search-file-matches">${fileResult.matchCount} совпадений</span>
          </div>
          <div class="search-file-matches-list">
            ${fileResult.matches.map(match => {
              // Обрезаем длинные строки (показываем максимум 150 символов вокруг совпадения)
              const maxContext = 75;
              let beforeMatch = match.text.substring(0, match.matchIndex);
              const matchText = match.matchText;
              let afterMatch = match.text.substring(match.matchIndex + matchText.length);
              
              // Обрезаем контекст, если строка слишком длинная
              if (beforeMatch.length > maxContext) {
                beforeMatch = '...' + beforeMatch.substring(beforeMatch.length - maxContext);
              }
              if (afterMatch.length > maxContext) {
                afterMatch = afterMatch.substring(0, maxContext) + '...';
              }
              
              // Экранируем путь для использования в onclick
              const escapedPath = fileResult.fullPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
              
              return `
                <div class="search-match-line" onclick="openSearchFileAtLine('${escapedPath}', ${match.line})">
                  <span class="search-line-number">${match.line}</span>
                  <span class="search-line-text">
                    ${escapeHtml(beforeMatch)}<mark class="search-match">${escapeHtml(matchText)}</mark>${escapeHtml(afterMatch)}
                  </span>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    });
    
    searchResults.innerHTML = html;
  } catch (error) {
    console.error('Ошибка поиска:', error);
    searchResults.innerHTML = `<div class="search-placeholder error">Ошибка поиска: ${error.message}</div>`;
  }
}

// Вспомогательные функции для поиска
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function openSearchFile(filePath) {
  // Открываем файл в редакторе
  window.electronAPI.getFileContent(filePath).then(result => {
    if (result.success) {
      hideWelcomePage();
      const fileName = pathUtils.basename(filePath);
      createTab(fileName, result.content, filePath);
    }
  });
}

function openSearchFileAtLine(filePath, lineNumber) {
  // Открываем файл и переходим к строке
  window.electronAPI.getFileContent(filePath).then(result => {
    if (result.success) {
      hideWelcomePage();
      const fileName = pathUtils.basename(filePath);
      createTab(fileName, result.content, filePath);
      // Прокручиваем к нужной строке после небольшой задержки
      setTimeout(() => {
        const editor = document.getElementById('editor');
        const lines = editor.value.split('\n');
        const lineHeight = parseInt(getComputedStyle(editor).lineHeight);
        const targetLine = Math.max(0, lineNumber - 1);
        editor.focus();
        editor.setSelectionRange(
          lines.slice(0, targetLine).join('\n').length + (targetLine > 0 ? 1 : 0),
          lines.slice(0, targetLine).join('\n').length + (targetLine > 0 ? 1 : 0)
        );
        editor.scrollTop = targetLine * lineHeight;
      }, 100);
    }
  });
}

// Делаем функции глобальными для использования в onclick
window.openSearchFile = openSearchFile;
window.openSearchFileAtLine = openSearchFileAtLine;

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
  
  // Закрываем стартовую страницу при создании вкладки
  hideWelcomePage();
  
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
    updateLineNumbers();
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
      // Если нет вкладок, показываем стартовую страницу
      showWelcomePage();
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

// Функции для работы с файлами
async function openFile() {
  try {
    const result = await window.electronAPI.openFile();
      if (result.success) {
        // Закрываем стартовую страницу при открытии файла
        hideWelcomePage();
        createTab(pathUtils.basename(result.filePath), result.content, result.filePath);
      }
  } catch (error) {
    console.error('Ошибка открытия файла:', error);
  }
}

async function openFileOrFolder() {
  try {
    const result = await window.electronAPI.openFileOrFolder();
    if (result.success) {
      if (result.isDirectory) {
        // Открываем папку в explorer
        currentFolder = result.path;
        await loadFolderContents(currentFolder);
        // Переключаемся на explorer если он не активен
        if (currentActivity !== 'explorer') {
          switchActivity('explorer');
        }
      } else {
        // Открываем файл в редакторе
        hideWelcomePage();
        createTab(pathUtils.basename(result.filePath), result.content, result.filePath);
      }
    }
  } catch (error) {
    console.error('Ошибка открытия файла или папки:', error);
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
        tab.name = pathUtils.basename(result.filePath);
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
      saveAllConfig();
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

function handleEditorScroll() {
  // Обновляем нумерацию строк при прокрутке
  updateLineNumbers();
}

function updateCurrentLine() {
  // Обновляем нумерацию строк при клике или нажатии клавиши
  updateLineNumbers();
}

function updateLineNumbers() {
  const lines = editor.value.split('\n');
  const scrollTop = editor.scrollTop;
  const lineHeight = parseInt(getComputedStyle(editor).lineHeight);
  const visibleLines = Math.ceil(editor.clientHeight / lineHeight);
  const startLine = Math.floor(scrollTop / lineHeight);
  const endLine = Math.min(startLine + visibleLines + 1, lines.length);
  
  // Получаем текущую позицию курсора
  const cursorPosition = editor.selectionStart;
  const textBeforeCursor = editor.value.substring(0, cursorPosition);
  const currentLineNumber = textBeforeCursor.split('\n').length;
  
  let lineNumberHtml = '';
  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const isCurrentLine = lineNum === currentLineNumber;
    const lineClass = isCurrentLine ? 'line-number current' : 'line-number';
    lineNumberHtml += `<span class="${lineClass}">${lineNum}</span>`;
  }
  
  lineNumbers.innerHTML = lineNumberHtml;
  
  // Синхронизируем прокрутку нумерации строк с редактором
  lineNumbers.scrollTop = scrollTop;
}

function handleGlobalKeydown(e) {
  // Ctrl+N / Cmd+N - новый файл
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
    e.preventDefault();
    createNewFile();
  }
  
  // Ctrl+O / Cmd+O - открыть файл или папку
  if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
    e.preventDefault();
    openFileOrFolder();
  }
  
  // Ctrl+S / Cmd+S - сохранить файл
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    saveFile();
  }
  
  // Ctrl+Shift+S / Cmd+Shift+S - сохранить как
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S') {
    e.preventDefault();
    saveFileAs();
  }
  
  // Ctrl+W / Cmd+W - закрыть вкладку
  if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
    e.preventDefault();
    if (activeTabIndex >= 0) {
      closeTab(activeTabIndex);
    }
  }
  
  // Ctrl+Tab / Cmd+Tab - следующая вкладка
  if ((e.ctrlKey || e.metaKey) && e.key === 'Tab') {
    e.preventDefault();
    if (currentTabs.length > 1) {
      const nextIndex = (activeTabIndex + 1) % currentTabs.length;
      switchToTab(nextIndex);
    }
  }
  
  // Ctrl+Shift+F / Cmd+Shift+F - поиск
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
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
        tab.name = pathUtils.basename(result.filePath);
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
  if (chatVisible) {
    chatPanel.style.display = 'flex';
    chatPanel.style.pointerEvents = 'auto';
    chatPanel.style.visibility = 'visible';
    chatPanel.style.opacity = '1';
    chatBtn.classList.add('active');
    loadChatHistory();
    userInput.focus();
  } else {
    chatPanel.style.display = 'none';
    chatPanel.style.pointerEvents = 'none';
    chatPanel.style.visibility = 'hidden';
    chatPanel.style.opacity = '0';
    chatBtn.classList.remove('active');
  }
}

function handleChatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleChatSubmit();
  }
}

function handleTextareaResize() {
  // Автоматическое изменение высоты textarea
  userInput.style.height = 'auto';
  userInput.style.height = Math.min(userInput.scrollHeight, 120) + 'px';
}

async function handleChatSubmit() {
  const message = userInput.value.trim();
  if (!message || isTyping) return;
  
  // Добавляем сообщение пользователя
  addChatMessage(message, 'user');
  userInput.value = '';
  userInput.style.height = 'auto';
  
  // Показываем статус печатания
  setChatStatus('typing', 'Печатает...');
  showTypingIndicator();
  
  // Показываем кнопку остановки
  stopBtn.style.display = 'flex';
  sendBtn.disabled = true;
  
  try {
    isTyping = true;
    
    // Определяем, какой провайдер использовать
    const useOpenRouter = currentAiProvider === 'openrouter';
    
    // Отправляем сообщение в AI
    const response = await window.electronAPI.sendMessage(message, currentAiModel, useOpenRouter);
    
    if (response && response.answer) {
      addChatMessage(response.answer, 'ai');
    }
    
  } catch (error) {
    console.error('Ошибка AI:', error);
    let errorMsg = `Ошибка: ${error.message}`;
    if (error.message.includes('OpenRouter API')) {
      errorMsg += '\n\nПроверьте:\n1. Правильность API ключа OpenRouter\n2. Доступность https://openrouter.ai\n3. Баланс на счету OpenRouter';
    }
    addChatMessage(errorMsg, 'ai');
    setChatStatus('error', 'Ошибка');
  } finally {
    isTyping = false;
    stopBtn.style.display = 'none';
    sendBtn.disabled = false;
    hideTypingIndicator();
    setChatStatus('ready', 'Готов');
  }
}

function addChatMessage(content, sender) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${sender}`;
  
  if (sender === 'ai') {
    // Парсим Markdown для сообщений AI
    try {
      // Используем встроенный парсер Markdown или обычный текст
      messageDiv.innerHTML = content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                                   .replace(/\*(.*?)\*/g, '<em>$1</em>')
                                   .replace(/`(.*?)`/g, '<code>$1</code>')
                                   .replace(/\n/g, '<br>');
    } catch (error) {
      // Если парсинг не удался, используем обычный текст
      messageDiv.textContent = content;
    }
  } else {
    messageDiv.textContent = content;
  }
  
  chatMessages.appendChild(messageDiv);
  
  // Плавная прокрутка к новому сообщению
  setTimeout(() => {
    chatMessages.scrollTo({
      top: chatMessages.scrollHeight,
      behavior: 'smooth'
    });
  }, 10);
  
  // Сохраняем историю чата
  saveChatHistory();
}

function showTypingIndicator() {
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
  chatMessages.appendChild(typingDiv);
  
  setTimeout(() => {
    chatMessages.scrollTo({
      top: chatMessages.scrollHeight,
      behavior: 'smooth'
    });
  }, 10);
}

function hideTypingIndicator() {
  const typingIndicator = chatMessages.querySelector('.typing-indicator');
  if (typingIndicator) {
    typingIndicator.remove();
  }
}

function setChatStatus(type, text) {
  chatStatus.textContent = text;
  chatStatus.className = `chat-status ${type}`;
}

function stopChatResponse() {
  window.electronAPI.abortRequest();
  stopBtn.style.display = 'none';
  sendBtn.disabled = false;
  isTyping = false;
  hideTypingIndicator();
  setChatStatus('ready', 'Готов');
}

function loadChatHistory() {
  chatMessages.innerHTML = '';
  if (chatHistory && chatHistory.length > 0) {
    chatHistory.forEach(msg => {
      addChatMessage(msg.content, msg.sender);
    });
  }
}

function saveChatHistory() {
  const messages = Array.from(chatMessages.querySelectorAll('.message')).map(msg => ({
    content: msg.textContent || msg.innerHTML,
    sender: msg.classList.contains('user') ? 'user' : 'ai'
  }));
  
  chatHistory = messages;
  saveAllConfig();
}

function clearChatHistory() {
  chatMessages.innerHTML = '';
  chatHistory = [];
  saveAllConfig();
}

// Функции для работы с настройками
function updateFontSize() {
  const size = fontSizeSelect.value;
  editor.style.fontSize = size + 'px';
  lineNumbers.style.fontSize = size + 'px';
  updateLineNumbers();
  saveAllConfig();
}

function updateTheme() {
  const theme = themeSelect.value;
  document.body.className = theme === 'light' ? 'light-theme' : '';
  saveAllConfig();
}

function updateTabSize() {
  const size = tabSizeSelect.value;
  editor.style.tabSize = size;
  saveAllConfig();
}

// Функции для работы с настройками прозрачности
function handleGlassOpacityChange() {
  if (!glassOpacityRange || !glassBlurRange) return;
  const opacity = parseFloat(glassOpacityRange.value);
  updateGlassOpacityValue(opacity);
  const blurEnabled = glassBlurCheckbox ? glassBlurCheckbox.checked : true;
  applyGlassmorphismSettings(opacity, parseInt(glassBlurRange.value), blurEnabled);
  saveAllConfig();
}

function handleGlassBlurChange() {
  if (!glassOpacityRange || !glassBlurRange) return;
  const blur = parseInt(glassBlurRange.value);
  updateGlassBlurValue(blur);
  const blurEnabled = glassBlurCheckbox ? glassBlurCheckbox.checked : true;
  applyGlassmorphismSettings(parseFloat(glassOpacityRange.value), blur, blurEnabled);
  saveAllConfig();
}

function handleGlassBlurCheckboxChange() {
  if (!glassOpacityRange || !glassBlurRange || !glassBlurCheckbox) return;
  const blurEnabled = glassBlurCheckbox.checked;
  applyGlassmorphismSettings(parseFloat(glassOpacityRange.value), parseInt(glassBlurRange.value), blurEnabled);
  saveAllConfig();
}

function updateGlassOpacityValue(opacity) {
  if (glassOpacityValue) {
    glassOpacityValue.textContent = Math.round(opacity * 100) + '%';
  }
}

function updateGlassBlurValue(blur) {
  if (glassBlurValue) {
    glassBlurValue.textContent = blur + 'px';
  }
}

function applyGlassmorphismSettings(opacity, blur, blurEnabled = true) {
  const root = document.documentElement;
  root.style.setProperty('--glass-opacity', opacity);
  root.style.setProperty('--glass-blur', blur + 'px');
  root.style.setProperty('--glass-blur-enabled', blurEnabled ? '1' : '0');
  root.style.setProperty('--glass-border-opacity', Math.min(opacity * 0.5, 0.5));
  root.style.setProperty('--glass-shadow-opacity', Math.min(opacity * 0.3, 0.3));
}

function saveTabs() {
  saveAllConfig();
}

// Для обратной совместимости
function path() {
  return pathUtils;
}

// Обработчик потоковых обновлений от AI
window.electronAPI.onStreamUpdate((event, data) => {
  // Находим последнее сообщение AI и обновляем его
  const aiMessages = chatMessages.querySelectorAll('.message.ai');
  if (aiMessages.length > 0) {
    const lastMessage = aiMessages[aiMessages.length - 1];
    
    try {
      // Парсим Markdown для обновленного контента
      lastMessage.innerHTML = data.fullMessage.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                                             .replace(/\*(.*?)\*/g, '<em>$1</em>')
                                             .replace(/`(.*?)`/g, '<code>$1</code>')
                                             .replace(/\n/g, '<br>');
    } catch (error) {
      // Если парсинг не удался, используем обычный текст
      lastMessage.textContent = data.fullMessage;
    }
    
    // Плавная прокрутка к обновленному сообщению
    setTimeout(() => {
      chatMessages.scrollTo({
        top: chatMessages.scrollHeight,
        behavior: 'smooth'
      });
    }, 10);
  }
}); 

// Функции для работы с папками и файлами
async function openFolder() {
  try {
    const result = await window.electronAPI.openFolder();
    if (result.success) {
      currentFolder = result.folderPath;
      await loadFolderContents(currentFolder);
      // Обновляем состояние кнопок
      const newFileBtn = document.getElementById('new-file-in-folder-btn');
      const newFolderBtn = document.getElementById('new-folder-btn');
      if (newFileBtn) newFileBtn.disabled = false;
      if (newFolderBtn) newFolderBtn.disabled = false;
    }
  } catch (error) {
    console.error('Ошибка открытия папки:', error);
  }
}

async function loadFolderContents(folderPath) {
  try {
    const result = await window.electronAPI.listFiles(folderPath);
    if (result.success) {
      fileExplorerItems = result.files;
      updateFileExplorer();
    }
  } catch (error) {
    console.error('Ошибка загрузки содержимого папки:', error);
  }
}

function updateFileExplorer() {
  const fileExplorer = document.getElementById('file-explorer');
  if (!fileExplorer) return;
  
  fileExplorer.innerHTML = '';
  
  if (!currentFolder) {
    fileExplorer.innerHTML = '<div class="file-explorer-placeholder">Откройте папку для просмотра файлов</div>';
    // Обновляем состояние кнопок
    const newFileBtn = document.getElementById('new-file-in-folder-btn');
    const newFolderBtn = document.getElementById('new-folder-btn');
    if (newFileBtn) newFileBtn.disabled = true;
    if (newFolderBtn) newFolderBtn.disabled = true;
    return;
  }
  
  // Обновляем состояние кнопок
  const newFileBtn = document.getElementById('new-file-in-folder-btn');
  const newFolderBtn = document.getElementById('new-folder-btn');
  if (newFileBtn) newFileBtn.disabled = false;
  if (newFolderBtn) newFolderBtn.disabled = false;
  
  // Сортируем: сначала папки, потом файлы
  const sortedItems = fileExplorerItems.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });
  
  sortedItems.forEach(item => {
    const fileItem = document.createElement('div');
    fileItem.className = 'file-item';
    fileItem.dataset.path = item.path;
    fileItem.dataset.isDirectory = item.isDirectory;
    
    const icon = item.isDirectory ? '📁' : getFileIcon(item.name);
    const name = item.name;
    
    fileItem.innerHTML = `
      <span class="file-icon">${icon}</span>
      <span class="file-name">${name}</span>
    `;
    
    // Обработчик клика для открытия файла/папки
    fileItem.addEventListener('click', (e) => {
      // Не открываем если меню открыто
      if (contextMenu && contextMenu.contains(e.target)) return;
      handleFileItemClick(item);
    });
    
    // Обработчик правого клика для контекстного меню
    fileItem.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e, item);
    });
    
    fileExplorer.appendChild(fileItem);
  });
  
  // Добавляем обработчик правого клика на пустое место для вставки
  fileExplorer.addEventListener('contextmenu', (e) => {
    // Если кликнули не по файлу
    if (!e.target.closest('.file-item') && currentFolder && copiedFilePath) {
      e.preventDefault();
      // Показываем меню только с опцией "Вставить"
      showContextMenuForFolder(e, currentFolder);
    }
  });
}

function getFileIcon(fileName) {
  const ext = fileName.split('.').pop()?.toLowerCase();
  const iconMap = {
    'js': '📄',
    'py': '🐍',
    'html': '🌐',
    'css': '🎨',
    'json': '📋',
    'md': '📝',
    'txt': '📄',
    'xml': '📄',
    'csv': '📊',
    'jsx': '⚛️',
    'ts': '📄',
    'tsx': '⚛️',
    'vue': '💚',
    'php': '🐘',
    'java': '☕',
    'cpp': '⚙️',
    'c': '⚙️',
    'h': '⚙️',
    'go': '🐹',
    'rs': '🦀',
    'rb': '💎',
    'swift': '🍎',
    'kt': '☕',
    'scala': '☕',
    'r': '📊',
    'sql': '🗄️',
    'sh': '🐚',
    'bat': '🪟',
    'ps1': '🪟',
    'yml': '⚙️',
    'yaml': '⚙️',
    'toml': '⚙️',
    'ini': '⚙️',
    'conf': '⚙️',
    'log': '📋',
    'lock': '🔒',
    'gitignore': '🚫',
    'dockerfile': '🐳',
    'docker-compose': '🐳',
    'package': '📦',
    'requirements': '📦',
    'pom': '📦',
    'gradle': '📦',
    'makefile': '⚙️',
    'cmake': '⚙️',
    'readme': '📖',
    'license': '⚖️',
    'changelog': '📝',
    'contributing': '🤝',
    'codeowners': '👥',
    'gitattributes': '🔧',
    'gitmodules': '🔧',
    'gitkeep': '📁',
    'git': '📁'
  };
  
  return iconMap[ext] || '📄';
}

// Функции для создания файлов и папок в текущей папке
async function createNewFileInFolder() {
  if (!currentFolder) return;
  
  const fileName = prompt('Введите имя файла:');
  if (!fileName || !fileName.trim()) return;
  
  try {
    const result = await window.electronAPI.createFileInFolder(currentFolder, fileName.trim());
    if (result.success) {
      await loadFolderContents(currentFolder);
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

async function createNewFolderInFolder() {
  if (!currentFolder) return;
  
  const folderName = prompt('Введите имя папки:');
  if (!folderName || !folderName.trim()) return;
  
  try {
    const result = await window.electronAPI.createFolderInFolder(currentFolder, folderName.trim());
    if (result.success) {
      await loadFolderContents(currentFolder);
    } else {
      alert('Ошибка: ' + result.error);
    }
  } catch (error) {
    console.error('Ошибка создания папки:', error);
    alert('Ошибка создания папки: ' + error.message);
  }
}

// Контекстное меню для файлов и папок
let contextMenu = null;

function showContextMenu(event, item) {
  // Удаляем предыдущее меню, если есть
  if (contextMenu) {
    contextMenu.remove();
  }
  
  // Создаем контекстное меню
  contextMenu = document.createElement('div');
  contextMenu.className = 'context-menu';
  contextMenu.style.position = 'fixed';
  contextMenu.style.left = event.pageX + 'px';
  contextMenu.style.top = event.pageY + 'px';
  contextMenu.style.zIndex = '10000';
  
  const menuItems = [
    { label: 'Переименовать', action: () => renameFileItem(item) },
    { label: 'Копировать', action: () => copyFileItem(item) },
  ];
  
  // Добавляем "Вставить" только если есть скопированный файл
  if (copiedFilePath) {
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
      contextMenu.remove();
      contextMenu = null;
    });
    contextMenu.appendChild(menuItemEl);
  });
  
  document.body.appendChild(contextMenu);
  
  // Закрываем меню при клике вне его
  const closeMenu = (e) => {
    if (!contextMenu || !contextMenu.contains(e.target)) {
      if (contextMenu) {
        contextMenu.remove();
        contextMenu = null;
      }
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

function showContextMenuForFolder(event, folderPath) {
  // Удаляем предыдущее меню, если есть
  if (contextMenu) {
    contextMenu.remove();
  }
  
  // Создаем контекстное меню только с опцией "Вставить"
  contextMenu = document.createElement('div');
  contextMenu.className = 'context-menu';
  contextMenu.style.position = 'fixed';
  contextMenu.style.left = event.pageX + 'px';
  contextMenu.style.top = event.pageY + 'px';
  contextMenu.style.zIndex = '10000';
  
  const menuItemEl = document.createElement('div');
  menuItemEl.className = 'context-menu-item';
  menuItemEl.textContent = 'Вставить';
  menuItemEl.addEventListener('click', async () => {
    if (copiedFilePath) {
      const item = { path: folderPath, isDirectory: true };
      await pasteFileItem(item);
    }
    contextMenu.remove();
    contextMenu = null;
  });
  contextMenu.appendChild(menuItemEl);
  
  document.body.appendChild(contextMenu);
  
  // Закрываем меню при клике вне его
  const closeMenu = (e) => {
    if (!contextMenu || !contextMenu.contains(e.target)) {
      if (contextMenu) {
        contextMenu.remove();
        contextMenu = null;
      }
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

async function renameFileItem(item) {
  const newName = prompt('Введите новое имя:', item.name);
  if (!newName || !newName.trim()) {
    return; // Пользователь отменил или оставил пустым
  }
  
  const trimmedName = newName.trim();
  
  // Проверяем, что имя изменилось
  if (trimmedName === item.name) {
    return; // Имя не изменилось
  }
  
  try {
    console.log('Переименование:', item.path, '->', trimmedName);
    const result = await window.electronAPI.renameFile(item.path, trimmedName);
    
    if (result.success) {
      console.log('Переименование успешно:', result.newPath);
      await loadFolderContents(currentFolder);
      
      // Обновляем вкладку если файл был открыт
      const tab = currentTabs.find(t => t.filePath === item.path);
      if (tab) {
        tab.filePath = result.newPath;
        tab.name = trimmedName;
        updateTabsList();
        updateTabTitle();
      }
    } else {
      console.error('Ошибка переименования:', result.error);
      alert('Ошибка переименования: ' + result.error);
    }
  } catch (error) {
    console.error('Ошибка переименования:', error);
    alert('Ошибка переименования: ' + (error.message || 'Неизвестная ошибка'));
  }
}

function copyFileItem(item) {
  copiedFilePath = item.path;
  // Можно добавить визуальную индикацию
  console.log('Файл скопирован:', item.name);
}

async function pasteFileItem(item) {
  if (!copiedFilePath) return;
  
  // Определяем целевую папку: если кликнули по папке - вставляем в неё, иначе в текущую открытую папку
  const targetPath = item.isDirectory ? item.path : (currentFolder || pathUtils.dirname(item.path));
  const sourceName = pathUtils.basename(copiedFilePath);
  
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
    const result = await window.electronAPI.copyFile(copiedFilePath, destinationPath);
    if (result.success) {
      // Обновляем explorer - если мы в текущей папке, обновляем её, иначе обновляем папку куда вставили
      if (targetPath === currentFolder) {
        await loadFolderContents(currentFolder);
      } else {
        // Если вставили в другую папку, обновляем текущую для отображения изменений
        await loadFolderContents(currentFolder);
      }
      copiedFilePath = null; // Очищаем после вставки
    } else {
      alert('Ошибка: ' + result.error);
    }
  } catch (error) {
    console.error('Ошибка вставки:', error);
    alert('Ошибка вставки: ' + error.message);
  }
}

async function deleteFileItem(item) {
  const confirmMessage = `Вы уверены, что хотите удалить "${item.name}"?`;
  if (!confirm(confirmMessage)) return;
  
  try {
    const result = await window.electronAPI.deleteFile(item.path);
    if (result.success) {
      // Закрываем вкладку если файл был открыт
      const tabIndex = currentTabs.findIndex(t => t.filePath === item.path);
      if (tabIndex >= 0) {
        closeTab(tabIndex);
      }
      await loadFolderContents(currentFolder);
    } else {
      alert('Ошибка: ' + result.error);
    }
  } catch (error) {
    console.error('Ошибка удаления:', error);
    alert('Ошибка удаления: ' + error.message);
  }
}

async function handleFileItemClick(item) {
  if (item.isDirectory) {
    // Открываем папку
    currentFolder = item.path;
    await loadFolderContents(currentFolder);
  } else {
    // Открываем файл в новой вкладке
    try {
      const result = await window.electronAPI.getFileContent(item.path);
      if (result.success) {
        // Закрываем стартовую страницу при открытии файла
        hideWelcomePage();
        createTab(item.name, result.content, item.path);
      }
    } catch (error) {
      console.error('Ошибка открытия файла:', error);
    }
  }
}

// Функции для работы с активностью 