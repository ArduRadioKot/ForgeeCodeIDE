const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { PassThrough } = require('node:stream');
const { agentOutput } = require('../lib/agent-output');
const { track, abortAll } = require('../lib/abort');
const opencode = require('../lib/opencode');

test('Codex keeps activity separate from the reply and returns its session ID', () => {
  const updates = [];
  const output = agentOutput('codex', (event) => updates.push(event));
  const feed = (...events) => events.forEach((event) => output.line(JSON.stringify(event)));
  feed(
    { type: 'thread.started', thread_id: 'session-id' },
    { type: 'item.started', item: { id: '1', type: 'file_change', changes: [{ path: 'hello.js' }] } },
    { type: 'item.completed', item: { id: '1', type: 'file_change', status: 'completed' } },
    { type: 'item.completed', item: { id: '2', type: 'agent_message', text: 'Done.' } },
  );
  assert.equal(updates[1].activity[0].status, 'running');
  assert.deepEqual(output.result(), {
    answer: 'Done.', thinking: '', sessionId: 'session-id', error: '',
    activity: [{ kind: 'file_change', label: 'hello.js', status: 'done' }],
    timeline: [
      { id: '1', type: 'tool', kind: 'file_change', label: 'hello.js', status: 'done' },
      { id: '2', type: 'message', text: 'Done.', status: 'done' },
    ],
  });
});

test('reasoning stays on the timeline ahead of the tool call and out of the answer', () => {
  const output = agentOutput('codex', () => {});
  const feed = (...events) => events.forEach((event) => output.line(JSON.stringify(event)));
  feed(
    { type: 'item.started', item: { id: 'r', type: 'reasoning' } },
    { type: 'response.reasoning_summary_text.delta', delta: 'Look at the file. ' },
    { type: 'item.completed', item: { id: 'r', type: 'reasoning', text: 'Look at the file. Then edit it.' } },
    { type: 'item.completed', item: { id: 'c', type: 'command_execution', command: 'ls', status: 'completed', aggregated_output: 'src\n' } },
    { type: 'item.completed', item: { id: 'a', type: 'agent_message', text: 'Done.' } },
  );
  const result = output.result();
  assert.equal(result.answer, 'Done.');
  assert.equal(result.thinking, 'Look at the file. Then edit it.');
  assert.deepEqual(result.timeline.map((row) => row.type), ['thought', 'tool', 'message']);
  assert.equal(result.timeline[1].output, 'src\n');
});

test('Claude combines streamed text with tool status without repeating the final result', () => {
  const output = agentOutput('claude', () => {});
  const feed = (...events) => events.forEach((event) => output.line(JSON.stringify(event)));
  feed(
    { type: 'stream_event', event: { delta: { type: 'text_delta', text: 'Hello.' } }, session_id: 'session-id' },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'one', name: 'Read', input: { file_path: 'hello.js' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'one', is_error: true }] } },
    { type: 'result', result: 'Hello.' },
  );
  assert.equal(output.result().answer, 'Hello.');
  assert.deepEqual(output.result().activity, [{ kind: 'Read', label: 'Read hello.js', status: 'failed' }]);
  assert.deepEqual(output.result().timeline, [
    { id: 'claude:0:0', type: 'message', text: 'Hello.', status: 'done' },
    { id: 'one', type: 'tool', kind: 'Read', label: 'Read hello.js', status: 'failed', output: '' },
  ]);
});

test('Codex keeps an intermediate message in place and finalizes only its matching stream', () => {
  const output = agentOutput('codex', () => {});
  const events = [
    { type: 'item.started', item: { id: 'preview', type: 'agent_message' } },
    { type: 'response.output_text.delta', item_id: 'preview', delta: 'I will check' },
    { type: 'item.completed', item: { id: 'preview', type: 'agent_message', text: 'I will check.' } },
    { type: 'item.started', item: { id: 'command', type: 'command_execution', command: 'ls' } },
    { type: 'item.completed', item: { id: 'answer', type: 'agent_message', text: 'Done.' } },
    { type: 'item.completed', item: { id: 'command', type: 'command_execution', command: 'ls', exit_code: 1, aggregated_output: 'error' } },
  ];
  for (const event of events) output.line(JSON.stringify(event));
  const result = output.result();
  assert.equal(result.answer, 'I will check.\n\nDone.');
  assert.deepEqual(result.timeline.map((row) => row.id), ['preview', 'command', 'answer']);
  assert.equal(result.timeline[1].status, 'failed');
  assert.equal(result.timeline[1].exitCode, 1);
});

test('stopping a chat affects only requests owned by its window', () => {
  const current = new AbortController();
  const other = new AbortController();
  const completion = new AbortController();
  const releaseCurrent = track(current, 1);
  const releaseOther = track(other, 2);
  const releaseCompletion = track(completion);
  try {
    abortAll(1);
    assert.equal(current.signal.aborted, true);
    assert.equal(other.signal.aborted, false);
    assert.equal(completion.signal.aborted, false);
  } finally {
    releaseCurrent();
    releaseOther();
    releaseCompletion();
  }
});

test('OpenCode resumes only the explicit session and sends stop to that session', async (t) => {
  const originalAdapter = axios.defaults.adapter;
  t.after(() => { axios.defaults.adapter = originalAdapter; });

  const requests = [];
  const controller = new AbortController();
  let unblock;
  const enteredPrompt = new Promise((resolve) => { unblock = resolve; });
  axios.defaults.adapter = (config) => {
    const url = new URL(config.url);
    requests.push([url.pathname, url.searchParams.get('directory')]);
    const response = (data) => Promise.resolve({ status: 200, data, config, headers: {} });
    if (url.pathname === '/session') return response({ id: 'new-session' });
    if (url.pathname === '/session/new-session/message') return response({ parts: [{ type: 'text', text: 'Reply' }] });
    if (url.pathname === '/session/current/abort') return response(true);
    assert.equal(url.pathname, '/session/current/message');
    unblock();
    return new Promise((_, reject) => config.signal.addEventListener('abort', () => reject(new axios.CanceledError()), { once: true }));
  };

  const fresh = await opencode.sendMessage('http://localhost:4096', '/project/a', { text: 'First prompt' });
  assert.equal(fresh.sessionId, 'new-session');
  assert.equal(fresh.answer, 'Reply');
  const continuing = opencode.sendMessage('http://localhost:4096', '/project/b', {
    text: 'Next prompt', sessionId: 'current', signal: controller.signal,
  });
  await enteredPrompt;
  controller.abort();
  assert.deepEqual(await continuing, { sessionId: 'current', aborted: true });
  assert.deepEqual(requests, [
    ['/session', '/project/a'],
    ['/session/new-session/message', '/project/a'],
    ['/session/current/message', '/project/b'],
    ['/session/current/abort', '/project/b'],
  ]);
});

test('OpenCode paints live assistant events before the final HTTP response and ignores other sessions', async (t) => {
  const originalAdapter = axios.defaults.adapter;
  t.after(() => { axios.defaults.adapter = originalAdapter; });
  const events = new PassThrough();
  const snapshots = [];
  let finishPrompt;
  const started = new Promise((resolve) => {
    axios.defaults.adapter = (config) => {
      if (new URL(config.url).pathname === '/event') {
        return Promise.resolve({ status: 200, data: events, config, headers: { 'content-type': 'text/event-stream' } });
      }
      return new Promise((finish) => {
        finishPrompt = (data) => finish({ status: 200, data, config, headers: {} });
        resolve();
      });
    };
  });
  const turn = opencode.sendMessage('http://localhost:4096', '/project', {
    text: 'Start', sessionId: 'active', onChunk: (_content, _answer, state) => snapshots.push(state),
  });
  await started;
  const event = (type, properties) => events.write('data: ' + JSON.stringify({ type, properties }) + '\n\n');
  const assistant = { sessionID: 'active', id: 'assistant', role: 'assistant' };
  event('message.updated', { info: assistant });
  event('message.part.updated', { part: { id: 'other', type: 'text', sessionID: 'other', messageID: 'assistant', text: 'Wrong project' } });
  const part = { id: 'reasoning', type: 'reasoning', sessionID: 'active', messageID: 'assistant', text: 'Checking' };
  event('message.part.updated', { part });
  event('message.part.delta', { sessionID: 'active', partID: 'reasoning', field: 'text', delta: ' dependencies' });
  const tool = { id: 'tool', type: 'tool', sessionID: 'active', messageID: 'assistant', tool: 'read', state: { status: 'running', title: 'README' } };
  event('message.part.updated', { part: tool });
  assert.equal(snapshots.at(-1).thinking, 'Checking dependencies');
  assert.equal(snapshots.at(-1).activity[0].status, 'running');
  assert.equal(snapshots.at(-1).answer, '');
  finishPrompt({ parts: [{ ...part, text: 'Checking dependencies' }, { ...tool, state: { ...tool.state, status: 'completed', output: 'contents' } },
    { id: 'answer', type: 'text', text: 'Ready' }] });
  const result = await turn;
  events.end();
  assert.deepEqual(result.timeline.map((item) => item.id), ['reasoning', 'tool', 'answer']);
  assert.equal(result.timeline[1].output, 'contents');
  assert.equal(result.answer, 'Ready');
});
