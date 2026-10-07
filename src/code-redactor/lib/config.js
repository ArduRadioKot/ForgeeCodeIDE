const path = require('path');
const fs = require('fs').promises;
const os = require('os');

const documentsPath = path.join(os.homedir(), 'Documents');
const configDir = path.join(documentsPath, 'FrogeeCodeIDE', 'config');
const configFile = path.join(configDir, 'settings.json');
const alternativeConfigFile = path.join(configDir, 'config.json');

let openRouterApiKey = '';

function getOpenRouterApiKey() {
  return openRouterApiKey;
}

function setOpenRouterApiKey(key) {
  openRouterApiKey = key ?? '';
}

async function ensureConfigDir() {
  try {
    const frogeeCodeIDEPath = path.join(documentsPath, 'FrogeeCodeIDE');
    try {
      await fs.access(frogeeCodeIDEPath);
    } catch {
      await fs.mkdir(frogeeCodeIDEPath, { recursive: true });
    }

    try {
      await fs.access(configDir);
    } catch {
      await fs.mkdir(configDir, { recursive: true });
    }
  } catch (error) {
    console.error('Ошибка создания папок конфигурации:', error);
  }
}

function getDefaultConfig() {
  return {
    fontSize: '14',
    theme: 'dark',
    tabSize: '4',
    defaultAiProvider: 'ollama',
    currentAiProvider: 'ollama',
    currentAiModel: 'llama3',
    showWelcomePage: true,
    editorTabs: [],
    chatHistory: [],
    openRouterApiKey: '',
    opencodeBaseUrl: 'http://127.0.0.1:4096',
    opencodeSessionId: '',
    glassOpacity: 0.78,
    glassBlur: 16,
    glassBlurEnabled: true,
    editorZoom: 1,
    autoScaleEnabled: true,
    wordWrapEnabled: false,
    lineNumbersEnabled: true,
    accentColor: '#21aabe',
    uiRadius: 12,
    uiGap: 4,
    autoSave: false,
    agentAccess: 'read',
    agentPaths: { claude: '', codex: '', opencode: '' },
    ambientBgEnabled: false,
    compactUi: false,
    glassRim: 10,
    glassShadow: 12,
    editorDim: 0.88,
    terminalHeight: 220,
    terminalVisible: false,
    // Фон и прозрачность
    appBg: '#16181d',
    sidebarBg: '#1c1f26',
    editorBg: '#1a1d23',
    panelBg: '#1e2229',
    appOpacity: 1,
    sidebarOpacity: 0.92,
    activityOpacity: 0.88,
    editorSurfaceOpacity: 0.88,
    terminalOpacity: 0.92,
    bgImageUrl: '',
    bgImageOpacity: 0.35
  };
}

function sanitizeConfig(config) {
  const sanitized = { ...getDefaultConfig(), ...(config || {}) };

  if (!Array.isArray(sanitized.editorTabs)) {
    sanitized.editorTabs = [];
  } else if (sanitized.editorTabs.length > 40) {
    console.warn('sanitizeConfig: сброс повреждённых editorTabs =', sanitized.editorTabs.length);
    sanitized.editorTabs = [];
  }

  if (!Array.isArray(sanitized.chatHistory)) {
    sanitized.chatHistory = [];
  } else if (sanitized.chatHistory.length > 200) {
    sanitized.chatHistory = sanitized.chatHistory.slice(-100);
  }

  return sanitized;
}

async function persistConfig(config) {
  const sanitized = sanitizeConfig(config);
  await fs.writeFile(configFile, JSON.stringify(sanitized, null, 2), 'utf8');
  try {
    await fs.writeFile(alternativeConfigFile, JSON.stringify(sanitized, null, 2), 'utf8');
  } catch (mirrorErr) {
    console.warn('Не удалось записать альтернативный конфиг config.json:', mirrorErr?.message || mirrorErr);
  }
  return sanitized;
}

async function loadConfig() {
  const defaults = getDefaultConfig();
  try {
    await ensureConfigDir();

    let parsed = null;
    try {
      const data = await fs.readFile(configFile, 'utf8');
      parsed = JSON.parse(data);
    } catch {
      try {
        const altData = await fs.readFile(alternativeConfigFile, 'utf8');
        parsed = JSON.parse(altData);
      } catch {
        parsed = null;
      }
    }

    if (!parsed) {
      await persistConfig(defaults);
      return defaults;
    }

    const sanitized = sanitizeConfig(parsed);
    const wasCorrupt = Array.isArray(parsed.editorTabs) && parsed.editorTabs.length > 40;
    if (wasCorrupt) {
      await persistConfig(sanitized);
    }
    return sanitized;
  } catch (error) {
    console.error('Ошибка загрузки конфигурации:', error);
    return defaults;
  }
}

async function saveConfig(config) {
  try {
    await ensureConfigDir();
    let current = {};
    try {
      current = await loadConfig();
    } catch {}
    const merged = sanitizeConfig({ ...current, ...config });
    await persistConfig(merged);
    return { success: true };
  } catch (error) {
    console.error('Ошибка сохранения конфигурации:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  documentsPath,
  configDir,
  configFile,
  alternativeConfigFile,
  getDefaultConfig,
  sanitizeConfig,
  loadConfig,
  saveConfig,
  getOpenRouterApiKey,
  setOpenRouterApiKey
};
