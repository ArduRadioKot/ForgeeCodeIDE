const { ipcMain, shell } = require('electron');
const { spawn } = require('child_process');
const axios = require('axios');
const {
  loadConfig,
  saveConfig,
  getOpenRouterApiKey,
  setOpenRouterApiKey
} = require('./config');

const opencode = require('./opencode');
const { streamOllama, streamOpenAI } = require('./llm');
const { track } = require('./abort');
const bionic = require('./bionic');

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1';

function safeRemoveHandler(channel) {
  try {
    ipcMain.removeHandler(channel);
  } catch {}
}

const ROLES = new Set(['system', 'user', 'assistant']);

/** Conversation sent to the model: optional system prompt + history + the new user message. */
function buildMessages(opts, message) {
  const history = Array.isArray(opts.messages) ? opts.messages : [{ role: 'user', content: message }];
  const clean = history
    .filter((m) => m && ROLES.has(m.role) && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, 60000) }));
  if (opts.system && String(opts.system).trim()) clean.unshift({ role: 'system', content: String(opts.system).slice(0, 30000) });
  return clean;
}

const AI_CHANNELS = [
  'load-config',
  'save-config',
  'set-openrouter-key',
  'get-openrouter-key',
  'get-openrouter-models',
  'send-message',
  'get-models',
  'download-model',
  'delete-model',
  'open-external',
  'opencode-health',
  'opencode-models',
  'opencode-send'
];

function registerAiIpc() {
  for (const ch of AI_CHANNELS) safeRemoveHandler(ch);

  ipcMain.handle('load-config', async () => {
    return await loadConfig();
  });

  ipcMain.handle('save-config', async (event, config) => {
    return await saveConfig(config);
  });

  ipcMain.handle('set-openrouter-key', async (event, apiKey) => {
    try {
      const config = await loadConfig();
      config.openRouterApiKey = apiKey;
      await saveConfig(config);
      setOpenRouterApiKey(apiKey);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-openrouter-key', async () => {
    try {
      const config = await loadConfig();
      return config.openRouterApiKey || '';
    } catch {
      return '';
    }
  });

  ipcMain.handle('get-openrouter-models', async () => {
    try {
      const response = await axios.get(`${OPENROUTER_API_URL}/models`);
      return { success: true, models: response.data.data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('opencode-health', async (event, baseUrl) => {
    const config = await loadConfig().catch(() => ({}));
    return opencode.checkHealth(baseUrl || config.opencodeBaseUrl);
  });

  ipcMain.handle('opencode-models', async (event, { baseUrl, directory } = {}) => {
    const config = await loadConfig().catch(() => ({}));
    return opencode.listModels(baseUrl || config.opencodeBaseUrl, directory || null);
  });

  ipcMain.handle('opencode-send', async (event, payload = {}) => {
    const config = await loadConfig().catch(() => ({}));
    const baseUrl = payload.baseUrl || config.opencodeBaseUrl;
    const directory = payload.directory || null;
    const result = await opencode.sendMessage(baseUrl, directory, {
      model: payload.model,
      text: payload.message || payload.text,
      sessionId: payload.sessionId || config.opencodeSessionId || null,
      onChunk: (content, fullMessage) => {
        try {
          event.sender.send('stream-update', { content, fullMessage });
        } catch {}
      }
    });
    if (result.sessionId) {
      try {
        await saveConfig({ opencodeSessionId: result.sessionId });
      } catch {}
    }
    return result;
  });

  ipcMain.handle('send-message', async (event, message, model, options = false) => {
    try {
      // backward compat: boolean useOpenRouter OR options object
      const opts = typeof options === 'object' && options ? options : { provider: options ? 'openrouter' : 'ollama' };
      const provider = opts.provider || (opts.useOpenRouter ? 'openrouter' : 'ollama');

      if (provider === 'opencode') {
        const config = await loadConfig().catch(() => ({}));
        const result = await opencode.sendMessage(opts.baseUrl || config.opencodeBaseUrl, opts.directory || null, {
          model,
          text: message,
          sessionId: opts.sessionId || config.opencodeSessionId || null,
          onChunk: (content, fullMessage) => {
            try {
              event.sender.send('stream-update', { content, fullMessage });
            } catch {}
          }
        });
        if (result.sessionId) {
          try { await saveConfig({ opencodeSessionId: result.sessionId }); } catch {}
        }
        return result;
      }
      const config = await loadConfig().catch(() => ({}));
      const controller = new AbortController();
      const untrack = track(controller);
      let answer = '';
      let thinking = '';
      const push = (extra) => { try { event.sender.send('stream-update', { fullMessage: answer, thinking, ...extra }); } catch {} };
      const handlers = {
        signal: controller.signal,
        messages: buildMessages(opts, message),
        model,
        onDelta: (text) => { answer += text; push({ content: text }); },
        onThinking: (text) => { thinking += text; push({ thinkingDelta: text }); },
      };
      try {
        let result;
        if (provider === 'openrouter') {
          const key = getOpenRouterApiKey();
          if (!key) throw new Error('OpenRouter API ключ не настроен');
          result = await streamOpenAI({ ...handlers, baseUrl: OPENROUTER_API_URL, apiKey: key, headers: { 'HTTP-Referer': 'https://github.com/frogee-code-ide', 'X-Title': 'FrogeeCodeIDE' } });
        } else if (String(provider).startsWith('custom:')) {
          const custom = opts.custom || {};
          if (!custom.baseUrl) throw new Error('У провайдера не указан адрес API');
          result = await streamOpenAI({ ...handlers, baseUrl: custom.baseUrl, apiKey: custom.apiKey });
        } else if (provider === 'bionic') {
          const base = `${await bionic.baseUrl()}/v1`;
          try {
            result = await streamOpenAI({ ...handlers, baseUrl: base });
          } catch (err) {
            if (!/ECONNREFUSED|connect|socket hang up/i.test(String(err?.code || err?.message))) throw err;
            push({ notice: 'Запускаю сервер Bionic…' });
            const started = await bionic.startServer();
            if (!started.success) throw new Error(`Сервер Bionic не запущен: ${started.error}`);
            result = await streamOpenAI({ ...handlers, baseUrl: base });
          }
        } else {
          result = await streamOllama({ ...handlers, baseUrl: config.ollamaBaseUrl, think: !!opts.think });
        }
        return { success: true, answer, thinking, aborted: !!result.aborted, stats: result.stats || null };
      } finally {
        untrack();
      }
    } catch (err) {
      const msg = err?.message || String(err);
      console.error('AI Error:', msg);
      // Не бросаем — иначе Electron пишет "Error occurred in handler"
      return {
        success: false,
        error: /ECONNREFUSED|4096/.test(msg)
          ? 'OpenCode не запущен. Выполните: opencode serve'
          : msg
      };
    }
  });

  ipcMain.handle('custom-models', async (_event, { baseUrl, apiKey } = {}) => {
    try {
      const base = String(baseUrl || '').replace(/\/+$/, '');
      if (!/^https?:\/\//i.test(base)) return { success: false, error: 'Адрес должен начинаться с http:// или https://' };
      const res = await axios.get(`${base}/models`, { timeout: 10000, headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {} });
      const list = Array.isArray(res.data?.data) ? res.data.data : Array.isArray(res.data?.models) ? res.data.models : Array.isArray(res.data) ? res.data : [];
      const models = list.map((m) => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean).sort((a, b) => a.localeCompare(b));
      return { success: true, models };
    } catch (err) {
      return { success: false, error: err.response?.status ? `сервер ответил ${err.response.status}` : (err.code || err.message) };
    }
  });

  ipcMain.handle('get-models', async () => {
    try {
      const response = await axios.get('http://127.0.0.1:11434/api/tags');
      return response.data.models.map(m => m.name);
    } catch {
      return [];
    }
  });

  ipcMain.handle('download-model', async (event, model) => {
    return new Promise((resolve) => {
      const proc = spawn('ollama', ['pull', model]);
      let output = '';
      let error = '';
      proc.stdout.on('data', d => { output += d.toString(); });
      proc.stderr.on('data', d => { error += d.toString(); });
      proc.on('close', code => {
        if (code === 0) resolve({ success: true, output });
        else resolve({ success: false, error: error || output });
      });
    });
  });

  ipcMain.handle('delete-model', async (event, model) => {
    return new Promise((resolve) => {
      const proc = spawn('ollama', ['rm', model]);
      let output = '';
      let error = '';
      proc.stdout.on('data', d => { output += d.toString(); });
      proc.stderr.on('data', d => { error += d.toString(); });
      proc.on('close', code => {
        if (code === 0) resolve({ success: true, output });
        else resolve({ success: false, error: error || output });
      });
    });
  });

  ipcMain.handle('open-external', async (event, url) => {
    try {
      if (!/^(https?:|mailto:)/i.test(String(url || ''))) return { success: false, error: 'Разрешены только http(s) и mailto' };
      await shell.openExternal(url);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  console.log('[ai] IPC handlers registered');
}

module.exports = {
  registerAiIpc
};
