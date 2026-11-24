const axios = require('axios');
const { createInterface } = require('node:readline');
const { createTimeline } = require('./agent-timeline');

function openCodeTurn(sessionId, onChunk) {
  const work = createTimeline();
  const roles = new Map();
  const parts = new Map();

  function paint(part, finished = false) {
    const id = part.id;
    if (part.type === 'text' || part.type === 'reasoning' || part.type === 'thinking') {
      const type = part.type === 'text' ? 'message' : 'thought';
      const done = finished || part.time?.end;
      work.text(id, type, part.text || part.thinking || part.content, { status: done ? 'done' : 'running' });
    } else if (['tool', 'tool-invocation', 'tool_use'].includes(part.type)) {
      const state = part.state || {};
      const kind = part.tool || part.toolName || part.name || 'tool';
      const target = state.input?.filePath || state.input?.path || state.input?.command || state.input?.pattern;
      const status = state.status || part.status;
      work.tool(id, {
        kind,
        label: [kind, state.title || target].filter(Boolean).join(' · '),
        status: /error|fail/.test(status || '') ? 'failed' : status === 'completed' ? 'done'
          : finished ? (status ? 'stopped' : 'done') : status === 'pending' ? 'pending' : 'running',
        output: state.output || state.error || part.output,
      });
    }
  }

  function publish() {
    const result = work.snapshot();
    onChunk?.(result.answer, result.answer, result);
  }

  function receive(event) {
    const data = event?.properties;
    if (!data) return;
    if (event.type === 'message.updated' && data.info?.sessionID === sessionId) {
      const info = data.info;
      roles.set(info.id, info.role);
      if (info.role === 'assistant') {
        for (const part of parts.values()) if (part.messageID === info.id) paint(part);
        publish();
      }
    } else if (event.type === 'message.part.updated' && data.part?.sessionID === sessionId) {
      const part = { ...data.part };
      if (!part.id || roles.get(part.messageID) === 'user') return;
      parts.set(part.id, part);
      if (roles.get(part.messageID) === 'assistant') { paint(part); publish(); }
    } else if (event.type === 'message.part.delta' && data.sessionID === sessionId && data.field === 'text') {
      const part = parts.get(data.partID);
      if (!part || typeof data.delta !== 'string') return;
      part.text = (part.text || '') + data.delta;
      if (roles.get(part.messageID) === 'assistant') { paint(part); publish(); }
    }
  }

  function finish(payload, aborted = false) {
    const finalParts = payload?.parts || payload?.data?.parts || [];
    if (Array.isArray(finalParts)) finalParts.forEach((part, index) => {
      if (!part) return;
      if (typeof part === 'string') part = { type: 'text', text: part };
      paint({ ...part, id: part.id || 'final:' + index }, true);
    });
    if (finalParts.length === 0) {
      const fallback = typeof payload === 'string' ? payload : payload?.answer;
      if (fallback && !work.snapshot().answer) work.text('final', 'message', fallback);
    }
    work.finish(aborted ? 'stopped' : 'done');
    return work.snapshot();
  }

  return { receive, finish };
}

/** The prompt still uses the existing HTTP response. SSE supplies live events when available. */
async function subscribeOpenCode(url, turn, signal) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  if (signal?.aborted) return () => {};
  signal?.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(stop, 850);
  const close = () => {
    clearTimeout(timer);
    stop();
    signal?.removeEventListener('abort', stop);
  };
  try {
    const response = await axios.get(url, { responseType: 'stream', signal: controller.signal, headers: { Accept: 'text/event-stream' } });
    clearTimeout(timer);
    if (!response.headers['content-type']?.includes('text/event-stream') || !response.data?.on) {
      close();
      return () => {};
    }
    const lines = createInterface({ input: response.data, crlfDelay: Infinity });
    // Aborting Axios destroys the stream. Consume the error because the prompt promise owns task failures.
    lines.on('error', () => lines.close());
    lines.on('line', (line) => {
      if (!line.startsWith('data:')) return;
      let event;
      try { event = JSON.parse(line.slice(5)); } catch { return; }
      turn.receive(event.payload || event);
    });
    return () => { lines.close(); close(); };
  } catch {
    close();
    return () => {};
  }
}

module.exports = { openCodeTurn, subscribeOpenCode };
