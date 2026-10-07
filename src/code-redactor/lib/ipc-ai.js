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

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1';

function safeRemoveHandler(channel) {
  try {
    ipcMain.removeHandler(channel);
  } catch {}
}

async function sendMessageOpenRouter(message, model, event) {
  const openRouterApiKey = getOpenRouterApiKey();
  if (!openRouterApiKey) {
    throw new Error('OpenRouter API ключ не настроен');
  }

  try {
    const response = await axios.post(`${OPENROUTER_API_URL}/chat/completions`, {
      model: model || 'openai/gpt-3.5-turbo',
      messages: [
        { role: 'user', content: message }
      ],
      stream: true
    }, {
      headers: {
        Authorization: `Bearer ${openRouterApiKey}`,
        'Content-Type': 'application/json'
      },
      responseType: 'stream'
    });

    let aiMsg = '';

    return new Promise((resolve, reject) => {
      response.data.on('data', (chunk) => {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          if (line.trim() === '' || !line.startsWith('data: ')) continue;

          try {
            const data = JSON.parse(line.slice(6));
            if (data.choices && data.choices[0] && data.choices[0].delta && data.choices[0].delta.content) {
              const content = data.choices[0].delta.content;
              aiMsg += content;

              event.sender.send('stream-update', {
                content,
                fullMessage: aiMsg
              });
            }
          } catch {}
        }
      });

      response.data.on('end', () => {
        resolve({ answer: aiMsg, think: '' });
      });

      response.data.on('error', (err) => {
        reject(err);
      });
    });
  } catch (error) {
    console.error('OpenRouter API error:', error);
    let errorMessage = error.message;
    if (error.response) {
      errorMessage = `HTTP status ${error.response.status}: ${error.response.data?.error?.message || error.response.data}`;
    }
    throw new Error(`OpenRouter API ошибка: ${errorMessage}`);
  }
}

async function sendMessageOllama(message, model, event) {
  try {
    const response = await axios.post('http://localhost:11434/api/chat', {
      model: model || 'llama3',
      messages: [
        { role: 'user', content: message }
      ],
      stream: true
    }, {
      responseType: 'stream'
    });

    let aiMsg = '';

    return new Promise((resolve, reject) => {
      response.data.on('data', (chunk) => {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          if (line.trim() === '') continue;
          try {
            const data = JSON.parse(line);
            if (data.message?.content) {
              aiMsg += data.message.content;
              event.sender.send('stream-update', {
                content: data.message.content,
                fullMessage: aiMsg
              });
            }
          } catch {}
        }
      });

      response.data.on('end', () => {
        resolve({ answer: aiMsg, think: '' });
      });

      response.data.on('error', (err) => {
        reject(err);
      });
    });
  } catch (error) {
    console.error('Ollama API error:', error);
    throw new Error(`Ollama API ошибка: ${error.message}`);
  }
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
      if (provider === 'openrouter') {
        return await sendMessageOpenRouter(message, model, event);
      }
      return await sendMessageOllama(message, model, event);
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

  ipcMain.handle('get-models', async () => {
    try {
      const response = await axios.get('http://localhost:11434/api/tags');
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
