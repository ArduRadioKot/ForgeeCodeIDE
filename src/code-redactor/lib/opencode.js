const axios = require('axios');
const { openCodeTurn, subscribeOpenCode } = require('./opencode-events');

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

async function request(base, method, path, { directory, data, signal, timeout = 60000 } = {}) {
  const url = withDirectory(`${normalizeBase(base)}${path}`, directory);
  const res = await axios({
    method,
    url,
    data,
    timeout,
    signal,
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

const unknownEndpoint = (err) => err.status === 404 || err.status === 405;

async function createSession(base, directory, signal) {
  const options = { directory, signal, data: { title: 'FrogeeCodeIDE Chat' }, timeout: 10000 };
  let session;
  try {
    session = await request(base, 'post', '/session', options);
  } catch (err) {
    if (!unknownEndpoint(err)) throw err;
    session = await request(base, 'post', '/api/session', options);
  }
  return session?.id || session?.sessionID || session?.data?.id;
}

async function sendMessage(baseUrl, directory, { model, text, sessionId, onChunk, signal }) {
  if (!text || !String(text).trim()) throw new Error('Пустое сообщение');
  const base = normalizeBase(baseUrl);
  const modelRef = parseModelRef(model);
  let sid = sessionId;
  let abortTurn;
  let stopping;
  let unsubscribe;
  let turn;
  try {
    sid ||= await createSession(base, directory, signal);
    if (!sid) throw new Error('Не удалось создать OpenCode session');
    if (signal?.aborted) return { sessionId: sid, aborted: true };
    const sessionPath = '/session/' + encodeURIComponent(sid);
    turn = openCodeTurn(sid, onChunk);
    if (onChunk) unsubscribe = await subscribeOpenCode(withDirectory(base + '/event', directory), turn, signal);
    if (signal?.aborted) return { sessionId: sid, aborted: true };

    abortTurn = () => {
      stopping = request(base, 'post', sessionPath + '/abort', { directory, timeout: 3000 }).catch(() => {});
    };
    signal?.addEventListener('abort', abortTurn, { once: true });

    const options = { directory, signal, timeout: 300000 };
    const selected = modelRef ? { model: modelRef } : {};
    let data;
    try {
      data = await request(base, 'post', sessionPath + '/message', {
        ...options, data: { parts: [{ type: 'text', text: String(text) }], ...selected },
      });
    } catch (err) {
      if (!unknownEndpoint(err)) throw err;
      data = await request(base, 'post', '/api' + sessionPath + '/prompt', {
        ...options, data: { text: String(text), ...selected },
      });
      if (!data || (typeof data === 'object' && !data.parts && !data.data?.parts && !data.answer)) {
        const messages = await request(base, 'get', sessionPath + '/message', { ...options, timeout: 15000 });
        const list = Array.isArray(messages) ? messages : messages?.data || [];
        data = list.at(-1);
      }
    }
    const { answer: textAnswer, thinking, activity, timeline } = turn.finish(data);
    const answer = textAnswer || (timeline.length ? '' : 'Запрос отправлен в OpenCode (пустой ответ).');
    const result = { answer, sessionId: sid, ...(thinking ? { thinking } : {}),
      ...(activity.length ? { activity } : {}), ...(timeline.length ? { timeline } : {}) };
    onChunk?.(answer, answer, result);
    return result;
  } catch (err) {
    if (signal?.aborted) return { sessionId: sid, aborted: true, ...(onChunk && turn ? turn.finish(null, true) : {}) };
    throw err;
  } finally {
    unsubscribe?.();
    if (abortTurn) signal?.removeEventListener('abort', abortTurn);
    if (stopping) await stopping;
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
