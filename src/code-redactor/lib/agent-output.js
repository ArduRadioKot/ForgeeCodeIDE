const { createTimeline } = require('./agent-timeline');

function blockText(value) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map((part) => typeof part === 'string' ? part : part?.text || '').filter(Boolean).join('\n');
}

function agentOutput(agent, emit) {
  const work = createTimeline();
  const codexText = new Map();
  const claudeBlocks = new Map();
  let sessionId = '';
  let error = '';
  let messageId = 'claude:0';
  let messageCount = 0;
  let deltaCount = 0;

  function claudeBlock(block, index, status) {
    const prefix = `${messageId}:${index}`;
    if (block.type === 'text' || block.type === 'thinking') {
      const type = block.type === 'text' ? 'message' : 'thought';
      claudeBlocks.set(index, { id: prefix, type });
      work.text(prefix, type, block.text || block.thinking, { status });
      return;
    }
    if (block.type !== 'tool_use' || !block.id) return;
    const input = block.input || {};
    const target = input.file_path || input.path || input.command || input.pattern || input.query || input.description;
    const kind = block.name || 'tool';
    work.tool(block.id, { kind, label: [kind, target].filter(Boolean).join(' '), status });
  }

  function claude(message) {
    if (message.session_id) sessionId = message.session_id;
    const event = message.event;
    if (message.type === 'stream_event' && event) {
      const { type, index = 0, delta } = event;
      if (type === 'message_start') {
        messageId = event.message?.id || `claude:${++messageCount}`;
        claudeBlocks.clear();
      } else if (type === 'content_block_start') {
        claudeBlock(event.content_block || {}, index, 'running');
      } else if (delta?.type === 'text_delta' || delta?.type === 'thinking_delta') {
        const type = delta.type === 'text_delta' ? 'message' : 'thought';
        const id = claudeBlocks.get(index)?.id || `${messageId}:${index}`;
        claudeBlocks.set(index, { id, type });
        work.text(id, type, delta.text || delta.thinking, { append: true, status: 'running' });
      } else if (type === 'content_block_stop') {
        const block = claudeBlocks.get(index);
        if (block) work.text(block.id, block.type, '', { status: 'done' });
      }
    } else if (message.type === 'assistant') {
      if (message.message?.id) messageId = message.message.id;
      (message.message?.content || []).forEach((block, index) => {
        claudeBlock(block, index, block.type === 'tool_use' ? 'running' : 'done');
      });
    } else if (message.type === 'user') {
      for (const block of message.message?.content || []) {
        if (block.type !== 'tool_result' || !work.has(block.tool_use_id)) continue;
        work.tool(block.tool_use_id, { status: block.is_error ? 'failed' : 'done', output: blockText(block.content || block.output) });
      }
    } else if (message.type === 'system' && message.task_id && ['task_started', 'task_progress', 'task_notification'].includes(message.subtype)) {
      const status = message.subtype !== 'task_notification' ? 'running' : message.status === 'failed' ? 'failed'
        : message.status === 'stopped' ? 'stopped' : 'done';
      const label = message.description || message.summary;
      work.tool('task:' + message.task_id, { kind: 'subagent', ...(label ? { label } : {}), status, output: message.summary });
    } else if (message.type === 'result') {
      if (message.is_error) error = message.errors?.join('\n') || message.result || 'Claude Code exited with an error';
      else if (!work.snapshot().answer) work.text('final', 'message', message.result);
      work.finish(error ? 'stopped' : 'done');
    }
  }

  function codex(event) {
    if (event.type === 'thread.started') sessionId = event.thread_id;
    if (event.type === 'turn.failed') error = event.error?.message || 'Codex turn failed';
    if (event.type === 'turn.completed' || event.type === 'turn.failed') work.finish(error ? 'stopped' : 'done');
    if (event.type === 'error' && event.message) work.text(`notice:${event.message}`, 'notice', event.message);

    const item = event.item;
    if (typeof event.delta === 'string' && event.delta) {
      const type = /reasoning/i.test(event.type) ? 'thought' : /agent_message|output_text/i.test(event.type) ? 'message' : null;
      if (type) {
        const id = event.item_id || codexText.get(type) || 'delta:' + ++deltaCount;
        codexText.set(type, id);
        work.text(id, type, event.delta, { append: true, status: 'running' });
      }
    }
    if (!item?.id) return;
    const complete = event.type === 'item.completed';
    if (item.type === 'reasoning' || item.type === 'agent_message') {
      const type = item.type === 'reasoning' ? 'thought' : 'message';
      const pending = codexText.get(type);
      const id = pending?.startsWith('delta:') ? pending : item.id;
      const summary = Array.isArray(item.summary) ? item.summary.map((part) => part?.text || part).filter(Boolean).join('\n') : '';
      work.text(id, type, item.text || summary, { status: complete ? 'done' : 'running' });
      if (complete) codexText.delete(type);
      else codexText.set(type, id);
    } else if (item.type === 'todo_list' && Array.isArray(item.items)) {
      work.update(item.id, 'plan', { items: item.items.map(({ text, completed }) => ({ text, completed: !!completed })) });
    } else if (['command_execution', 'file_change', 'mcp_tool_call', 'web_search'].includes(item.type)) {
      const label = item.command || item.changes?.map((change) => change.path).join(', ')
        || item.query || [item.server, item.tool].filter(Boolean).join('/');
      const status = item.status === 'failed' || (Number.isInteger(item.exit_code) && item.exit_code !== 0)
        ? 'failed' : complete ? 'done' : 'running';
      work.tool(item.id, {
        kind: item.type, ...(label ? { label } : {}), status,
        ...((item.aggregated_output || item.output) ? { output: item.aggregated_output || item.output } : {}),
        ...(Number.isInteger(item.exit_code) ? { exitCode: item.exit_code } : {}),
      });
    }
  }

  return {
    line(line) {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (!message || typeof message !== 'object') return;
      if (agent === 'claude') claude(message);
      else codex(message);
      const { answer, ...extra } = work.snapshot();
      emit({ fullMessage: answer, ...extra });
    },
    result: (stopped = false) => {
      work.finish(stopped || error ? 'stopped' : 'done');
      return { ...work.snapshot(), sessionId, error };
    },
  };
}

module.exports = { agentOutput };
