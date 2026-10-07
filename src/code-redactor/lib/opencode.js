const axios = require('axios');

const DEFAULT_BASE = 'http://127.0.0.1:4096';

function normalizeBase(url) {
  const raw = String(url || DEFAULT_BASE).trim().replace(/\/$/, '');
  return raw || DEFAULT_BASE;
}

function withDirectory(url, directory) {
  if (!directory) return url;
  try {
    const u = new URL(url);
    u.searchParams.set('directory', directory);
    return u.toString();
  } catch {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}directory=${encodeURIComponent(directory)}`;
  }
}

async function request(base, method, path, { directory, data, timeout = 60000 } = {}) {
  const url = withDirectory(`${normalizeBase(base)}${path}`, directory);
  const res = await axios({
    method,
    url,
    data,
    timeout,
    validateStatus: () => true,
    headers: { 'Content-Type': 'application/json' }
  });
  if (res.status >= 400) {
    const msg = res.data?.error?.message || res.data?.message || res.data?.name || JSON.stringify(res.data) || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = res.data;
    throw err;
  }
  return res.data;
}

async function checkHealth(baseUrl) {
  const base = normalizeBase(baseUrl);
  try {
    const data = await request(base, 'get', '/global/health', { timeout: 2500 });
    return { success: true, healthy: !!(data && (data.healthy !== false)), version: data?.version || null, base };
  } catch (err) {
    // fallback older health
    try {
      await request(base, 'get', '/doc', { timeout: 2500 });
      return { success: true, healthy: true, version: null, base };
    } catch {
      return { success: false, healthy: false, error: err.message || String(err), base };
    }
  }
}

function flattenModelsFromProviders(payload) {
  const models = [];
  const providers = payload?.providers || payload?.all || [];
  for (const provider of providers) {
    const providerID = provider.id || provider.providerID || provider.name;
    const list = provider.models || provider.model || [];
    if (Array.isArray(list)) {
      for (const m of list) {
        const modelID = typeof m === 'string' ? m : (m.id || m.modelID || m.name);
        if (!providerID || !modelID) continue;
        models.push({
          id: `${providerID}/${modelID}`,
          providerID,
          modelID,
          name: (typeof m === 'object' && (m.name || m.displayName)) || modelID,
          enabled: typeof m === 'object' ? m.enabled !== false : true
        });
      }
    }
  }
  // defaults map
  const defaults = payload?.default || {};
  return { models, defaults };
}

async function listModels(baseUrl, directory) {
  const base = normalizeBase(baseUrl);
  // Prefer config/providers (classic server docs)
  try {
    const data = await request(base, 'get', '/config/providers', { directory, timeout: 8000 });
    const flat = flattenModelsFromProviders(data);
    if (flat.models.length) return { success: true, ...flat, base };
  } catch {}

  try {
    const data = await request(base, 'get', '/provider', { directory, timeout: 8000 });
    const flat = flattenModelsFromProviders(data);
    if (flat.models.length) return { success: true, ...flat, base };
  } catch {}

  // v2 API
  try {
    const data = await request(base, 'get', '/api/model', { directory, timeout: 8000 });
    const list = data?.data || data || [];
    const models = (Array.isArray(list) ? list : []).map((m) => {
      const providerID = m.providerID || m.provider || 'opencode';
      const modelID = m.modelID || m.id || m.name;
      return {
        id: `${providerID}/${modelID}`,
        providerID,
        modelID,
        name: m.name || modelID,
        enabled: m.enabled !== false
      };
    }).filter((m) => m.modelID);
    return { success: true, models, defaults: {}, base };
  } catch (err) {
    return { success: false, models: [], error: err.message || String(err), base };
  }
}

function parseModelRef(model) {
  if (!model || typeof model !== 'string') return null;
  if (model.includes('/')) {
    const idx = model.indexOf('/');
    return { providerID: model.slice(0, idx), modelID: model.slice(idx + 1) };
  }
  return { providerID: 'opencode', modelID: model };
}

async function ensureSession(baseUrl, directory, existingId) {
  const base = normalizeBase(baseUrl);
  if (existingId) {
    try {
      await request(base, 'get', `/session/${existingId}`, { directory, timeout: 5000 });
      return existingId;
    } catch {
      // recreate
    }
  }
  // classic create
  try {
    const session = await request(base, 'post', '/session', {
      directory,
      data: { title: 'FrogeeCodeIDE Chat' },
      timeout: 10000
    });
    return session?.id || session?.sessionID || session?.data?.id;
  } catch {
    // v2
    const session = await request(base, 'post', '/api/session', {
      directory,
      data: { title: 'FrogeeCodeIDE Chat' },
      timeout: 10000
    });
    return session?.id || session?.data?.id;
  }
}

function extractTextFromMessagePayload(payload) {
  if (!payload) return '';
  if (typeof payload === 'string') return payload;
  if (payload.answer) return payload.answer;
  const parts = payload.parts || payload.data?.parts || [];
  if (Array.isArray(parts)) {
    return parts
      .map((p) => {
        if (!p) return '';
        if (typeof p === 'string') return p;
        if (p.type === 'text') return p.text || p.content || '';
        if (p.text) return p.text;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (payload.info && payload.parts) return extractTextFromMessagePayload(payload);
  return JSON.stringify(payload);
}

async function sendMessage(baseUrl, directory, { model, text, sessionId, onChunk }) {
  const base = normalizeBase(baseUrl);
  if (!text || !String(text).trim()) {
    throw new Error('Пустое сообщение');
  }
  const modelRef = parseModelRef(model);
  const sid = await ensureSession(base, directory, sessionId);
  if (!sid) throw new Error('Не удалось создать OpenCode session');

  // Prefer classic /session/:id/message (waits for response)
  try {
    const body = {
      parts: [{ type: 'text', text: String(text) }],
    };
    if (modelRef) {
      body.model = { providerID: modelRef.providerID, modelID: modelRef.modelID };
    }
    const data = await request(base, 'post', `/session/${sid}/message`, {
      directory,
      data: body,
      timeout: 300000
    });
    const answer = extractTextFromMessagePayload(data) || 'OK';
    if (onChunk) onChunk(answer, answer);
    return { answer, sessionId: sid, think: '' };
  } catch (err) {
    // v2 prompt API
    try {
      const body = { text: String(text) };
      if (modelRef) {
        body.model = { providerID: modelRef.providerID, modelID: modelRef.modelID };
      }
      const data = await request(base, 'post', `/api/session/${sid}/prompt`, {
        directory,
        data: body,
        timeout: 300000
      });
      // may need to poll messages
      let answer = extractTextFromMessagePayload(data);
      if (!answer) {
        try {
          const msgs = await request(base, 'get', `/session/${sid}/message`, {
            directory,
            timeout: 15000
          });
          const arr = Array.isArray(msgs) ? msgs : (msgs?.data || []);
          const last = arr[arr.length - 1];
          answer = extractTextFromMessagePayload(last) || '';
        } catch {}
      }
      if (!answer) answer = 'Запрос отправлен в OpenCode (пустой ответ).';
      if (onChunk) onChunk(answer, answer);
      return { answer, sessionId: sid, think: '' };
    } catch (err2) {
      throw new Error(err2.message || err.message || 'OpenCode request failed');
    }
  }
}

module.exports = {
  DEFAULT_BASE,
  normalizeBase,
  checkHealth,
  listModels,
  sendMessage,
  parseModelRef
};
