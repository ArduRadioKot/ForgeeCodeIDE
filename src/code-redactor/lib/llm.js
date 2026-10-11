/**
 * Streaming chat adapters. Every provider reports the same events:
 *   onDelta(text)      — a piece of the visible answer
 *   onThinking(text)   — a piece of the model's reasoning (kept apart from the answer)
 * Network chunks do not respect line boundaries, so lines are re-assembled in a buffer before parsing.
 */
const axios = require('axios');

function lineStream(onLine) {
  let buffer = '';
  return {
    push(chunk) {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);
        if (line.trim()) onLine(line);
      }
    },
    end() {
      if (buffer.trim()) onLine(buffer.trim());
      buffer = '';
    },
  };
}

/** Splits <think>…</think> that some models put inside the normal content stream. */
function thinkSplitter(onDelta, onThinking) {
  let mode = 'detect';
  let pending = '';
  const emit = (text) => { if (text) (mode === 'think' ? onThinking : onDelta)(text); };
  const push = (text) => {
    pending += text;
    for (;;) {
      if (mode === 'detect') {
        const trimmed = pending.replace(/^\s+/, '');
        if (trimmed.length < 7 && '<think>'.startsWith(trimmed) && trimmed) return; // maybe the start of a tag
        if (trimmed.startsWith('<think>')) {
          pending = trimmed.slice(7);
          mode = 'think';
          continue;
        }
        mode = 'answer';
        continue;
      }
      if (mode === 'think') {
        const end = pending.indexOf('</think>');
        if (end >= 0) {
          emit(pending.slice(0, end));
          pending = pending.slice(end + 8).replace(/^\s+/, '');
          mode = 'answer';
          continue;
        }
        const keep = Math.min(pending.length, 7); // a closing tag may be split across chunks
        emit(pending.slice(0, pending.length - keep));
        pending = pending.slice(pending.length - keep);
        return;
      }
      emit(pending);
      pending = '';
      return;
    }
  };
  push.flush = () => {
    if (pending) emit(pending);
    pending = '';
  };
  return push;
}

async function errorMessage(error) {
  if (error?.response) {
    let body = error.response.data;
    if (body && typeof body.on === 'function') {
      body = await new Promise((resolve) => {
        let text = '';
        body.on('data', (d) => { text += d; });
        body.on('end', () => resolve(text));
        body.on('error', () => resolve(text));
      });
    }
    try {
      const parsed = typeof body === 'string' ? JSON.parse(body) : body;
      const msg = parsed?.error?.message || parsed?.error || parsed?.message;
      if (msg) return `HTTP ${error.response.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`;
    } catch {}
    return `HTTP ${error.response.status}${body ? `: ${String(body).slice(0, 300)}` : ''}`;
  }
  return error?.message || String(error);
}

function runStream(response, handleLine, signal) {
  return new Promise((resolve, reject) => {
    const lines = lineStream(handleLine);
    const stream = response.data;
    const onAbort = () => { try { stream.destroy(); } catch {} resolve({ aborted: true }); };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => { try { lines.push(chunk); } catch (err) { reject(err); } });
    stream.on('end', () => { lines.end(); resolve({}); });
    stream.on('error', (err) => { if (signal?.aborted) resolve({ aborted: true }); else reject(err); });
  });
}


// Some Ollama models (MLX builds, bare GGUF imports) ship a template that is just "{{ .Prompt }}": system and earlier
// turns are silently dropped. For those, the instructions and the history go into the single prompt text.
const templateCache = new Map();
async function supportsChatRoles(base, model) {
  const key = `${base}|${model}`;
  if (templateCache.has(key)) return templateCache.get(key);
  let ok = true;
  try {
    const res = await axios.post(`${base}/api/show`, { model }, { timeout: 5000 });
    const template = String(res.data?.template || '');
    ok = /\.System|\.Messages|\.Role/.test(template) || !template.trim();
  } catch { /* unknown: assume the normal chat template */ }
  templateCache.set(key, ok);
  return ok;
}

function flattenForPlainTemplate(messages) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const turns = messages.filter((m) => m.role !== 'system');
  const last = turns.length ? turns[turns.length - 1] : { content: '' };
  const earlier = turns.slice(0, -1).map((m) => `${m.role === 'assistant' ? 'Ассистент' : 'Пользователь'}: ${m.content}`).join('\n\n');
  const parts = [];
  if (system) parts.push(`Инструкции:\n${system}`);
  if (earlier) parts.push(`Предыдущий диалог:\n${earlier}`);
  parts.push(`${earlier || system ? 'Текущий вопрос пользователя' : 'Вопрос'}:\n${last.content}`);
  return [{ role: 'user', content: parts.join('\n\n') }];
}

async function streamOllama({ baseUrl, model, messages, signal, onDelta, onThinking, think = false }) {
  if (!model) throw new Error('Модель не выбрана. Выберите установленную модель в списке под полем ввода.');
  const base = String(baseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '').replace('//localhost', '//127.0.0.1');
  const split = thinkSplitter(onDelta, onThinking);
  let stats = null;
  try {
    const payload = (await supportsChatRoles(base, model)) ? messages : flattenForPlainTemplate(messages);
    const response = await axios.post(`${base}/api/chat`, { model, messages: payload, stream: true, think: !!think, options: { temperature: 0.4 } }, { responseType: 'stream', signal, timeout: 0 });
    const result = await runStream(response, (line) => {
      let data;
      try { data = JSON.parse(line); } catch { return; }
      if (data.error) throw new Error(data.error);
      if (data.message?.thinking) onThinking(data.message.thinking);
      if (data.message?.content) split(data.message.content);
      if (data.done) stats = { tokens: data.eval_count, ms: data.eval_duration ? Math.round(data.eval_duration / 1e6) : 0 };
    }, signal);
    split.flush();
    return { ...result, stats };
  } catch (error) {
    if (signal?.aborted) return { aborted: true, stats };
    if (/ECONNREFUSED|ENOTFOUND|ECONNRESET/.test(error?.code || error?.message || '')) throw new Error('Ollama не запущена. Запустите её в настройках AI или командой: ollama serve');
    throw new Error(await errorMessage(error));
  }
}

async function streamOpenAI({ baseUrl, apiKey, model, messages, signal, onDelta, onThinking, headers = {} }) {
  const base = String(baseUrl).replace(/\/+$/, '');
  const split = thinkSplitter(onDelta, onThinking);
  try {
    const response = await axios.post(`${base}/chat/completions`, { model, messages, stream: true }, {
      responseType: 'stream', signal, timeout: 0,
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), ...headers },
    });
    const result = await runStream(response, (line) => {
      if (!line.startsWith('data:')) return;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') return;
      let data;
      try { data = JSON.parse(payload); } catch { return; }
      if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
      const delta = data.choices?.[0]?.delta;
      if (!delta) return;
      const reasoning = delta.reasoning_content || delta.reasoning;
      if (reasoning) onThinking(reasoning);
      if (delta.content) split(delta.content);
    }, signal);
    split.flush();
    return result;
  } catch (error) {
    if (signal?.aborted) return { aborted: true };
    throw error instanceof Error && !error.response ? error : new Error(await errorMessage(error));
  }
}

module.exports = { streamOllama, streamOpenAI, errorMessage, thinkSplitter };
