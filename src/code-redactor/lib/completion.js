/**
 * Inline code completion: the text to insert at the caret, from a local model (Ollama, LM Studio / Bionic)
 * or a cloud one (OpenRouter, a custom OpenAI-compatible server). Models with a fill-in-the-middle template
 * get prefix and suffix natively; the others are asked through chat with a strict "return only the insertion" prompt.
 */
const axios = require('axios');
const { ipcMain } = require('electron');
const { loadConfig, getOpenRouterApiKey } = require('./config');
const { track } = require('./abort');
const bionic = require('./bionic');

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1';
const MAX_LINES = 14;
const MAX_CHARS = 1400;
const running = new Map(); // request id -> AbortController
const fimCache = new Map(); // "base|model" -> boolean

const SYSTEM = 'Ты движок автодополнения кода. Тебе дают файл, в котором место курсора отмечено меткой <|курсор|>. '
  + 'Верни только текст, который нужно вставить на место метки: без пояснений, без markdown и без повтора кода вокруг метки. '
  + 'Продолжи в стиле файла и закончи начатую конструкцию; уместен законченный блок из нескольких строк. '
  + 'Если продолжать нечего, верни пустую строку.';

function normalize(raw, prefix) {
  let text = String(raw || '').replace(/\r/g, '');
  text = text.replace(/^```[\w+-]*\n?/, '').replace(/\n?```\s*$/, '');
  text = text.replace(/<\|?курсор\|?>/g, '');
  // models sometimes repeat the line that is already typed
  const lineBefore = prefix.slice(prefix.lastIndexOf('\n') + 1);
  if (lineBefore.trim() && text.startsWith(lineBefore)) text = text.slice(lineBefore.length);
  if (!text.trim()) return '';
  const lines = text.split('\n');
  if (lines.length > MAX_LINES) text = lines.slice(0, MAX_LINES).join('\n');
  return text.slice(0, MAX_CHARS).replace(/\s+$/, '');
}

async function supportsFim(base, model) {
  const key = `${base}|${model}`;
  if (fimCache.has(key)) return fimCache.get(key);
  let ok = false;
  try {
    const res = await axios.post(`${base}/api/show`, { model }, { timeout: 5000 });
    ok = /\.Suffix/.test(String(res.data?.template || '')) || (res.data?.capabilities || []).includes('insert');
  } catch { /* unknown: use chat */ }
  fimCache.set(key, ok);
  return ok;
}

const userPrompt = ({ fileName, lang, prefix, suffix }) => `Файл: ${fileName || 'без имени'}${lang ? ` (${lang})` : ''}\n\n${prefix}<|курсор|>${suffix}`;

async function ollamaComplete(job, signal) {
  const config = await loadConfig().catch(() => ({}));
  const base = String(config.ollamaBaseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '').replace('//localhost', '//127.0.0.1');
  if (await supportsFim(base, job.model)) {
    const res = await axios.post(`${base}/api/generate`, {
      model: job.model, prompt: job.prefix, suffix: job.suffix, stream: false,
      options: { temperature: 0.2, num_predict: 160 },
    }, { signal, timeout: 30000 });
    return res.data?.response;
  }
  const res = await axios.post(`${base}/api/chat`, {
    model: job.model, stream: false, think: false, options: { temperature: 0.2, num_predict: 160 },
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userPrompt(job) }],
  }, { signal, timeout: 30000 });
  return res.data?.message?.content;
}

async function openAiComplete(base, apiKey, job, signal, headers = {}) {
  const res = await axios.post(`${String(base).replace(/\/+$/, '')}/chat/completions`, {
    model: job.model, stream: false, temperature: 0.2, max_tokens: 200,
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userPrompt(job) }],
  }, { signal, timeout: 30000, headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), ...headers } });
  return res.data?.choices?.[0]?.message?.content;
}

async function complete(job) {
  if (!job.model) return { success: false, error: 'Модель для подсказок не выбрана' };
  const controller = new AbortController();
  const untrack = track(controller);
  if (job.id) { running.get(job.id)?.abort(); running.set(job.id, controller); }
  try {
    let raw;
    const p = job.provider;
    if (p === 'ollama') raw = await ollamaComplete(job, controller.signal);
    else if (p === 'bionic') raw = await openAiComplete(`${await bionic.baseUrl()}/v1`, '', job, controller.signal);
    else if (p === 'openrouter') {
      const key = getOpenRouterApiKey();
      if (!key) return { success: false, error: 'Не указан ключ OpenRouter' };
      raw = await openAiComplete(OPENROUTER_API_URL, key, job, controller.signal, { 'HTTP-Referer': 'https://github.com/frogee-code-ide', 'X-Title': 'FrogeeCodeIDE' });
    } else if (String(p).startsWith('custom:')) {
      if (!job.custom?.baseUrl) return { success: false, error: 'У провайдера не указан адрес API' };
      raw = await openAiComplete(job.custom.baseUrl, job.custom.apiKey, job, controller.signal);
    } else return { success: false, error: 'Этот провайдер не поддерживает подсказки в редакторе' };
    return { success: true, text: normalize(raw, job.prefix) };
  } catch (error) {
    if (controller.signal.aborted || axios.isCancel(error)) return { success: true, text: '', cancelled: true };
    return { success: false, error: error.response?.status ? `сервер ответил ${error.response.status}` : (error.code || error.message) };
  } finally {
    untrack();
    if (job.id && running.get(job.id) === controller) running.delete(job.id);
  }
}

function registerCompletionIpc() {
  for (const ch of ['ai-complete', 'ai-complete-cancel']) { try { ipcMain.removeHandler(ch); } catch {} }
  ipcMain.handle('ai-complete', (_e, job) => complete({
    id: job?.id, provider: job?.provider, model: String(job?.model || ''), custom: job?.custom,
    fileName: String(job?.fileName || ''), lang: String(job?.lang || ''),
    prefix: String(job?.prefix || '').slice(-6000), suffix: String(job?.suffix || '').slice(0, 1500),
  }));
  ipcMain.handle('ai-complete-cancel', (_e, id) => { running.get(id)?.abort(); running.delete(id); return true; });
  console.log('[completion] IPC handlers registered');
}

module.exports = { registerCompletionIpc, complete, normalize };
