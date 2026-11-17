const { ToolProtocol } = require('./tool-protocol');
const path = require('node:path');

async function setBreakpoints(session, file, lines) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || !Array.isArray(lines) || lines.some((line) => !Number.isSafeInteger(line) || line < 1)) {
    throw new Error('Open a saved file to set a breakpoint.');
  }
  const body = await session.tool.request('setBreakpoints', {
    source: { path: file, name: path.basename(file) },
    breakpoints: lines.map((line) => ({ line })),
  });
  return body?.breakpoints || [];
}

async function connectDebugger(argv, root, input, points, publish) {
  const tool = new ToolProtocol(argv, root, 'dap');
  const session = { tool, state: 'starting', thread: null, output: '', reason: '', revision: 0 };
  const update = () => { session.revision++; publish(status(session)); };
  session.update = update;
  let initialized;
  const ready = new Promise((resolve) => { initialized = resolve; });
  tool.on('notification', (event, body) => {
    if (event === 'initialized') { initialized(); return; }
    if (event === 'stopped') {
      session.state = 'paused';
      session.thread = body?.threadId ?? null;
      session.reason = body?.description || body?.reason || '';
    } else if (event === 'continued') {
      session.state = 'running';
      session.reason = '';
    } else if (event === 'terminated' || event === 'exited') {
      session.state = 'ended';
    } else if (event === 'output') {
      session.output = (session.output + (body?.output || '')).slice(-24000);
    } else return;
    update();
  });
  tool.on('closed', (error) => {
    initialized();
    session.state = 'ended';
    session.reason = error.message;
    update();
  });
  tool.on('request', ({ seq, command }) => {
    tool.send({ type: 'response', request_seq: seq, command, success: false, message: 'Use the internal console for this configuration.' });
  });
  let timer;
  try {
    const capabilities = await tool.request('initialize', {
      clientID: 'frogeecodeide', adapterID: input.adapterID || 'debugpy',
      linesStartAt1: true, columnsStartAt1: true, pathFormat: 'path',
    });
    const mode = input.request === 'attach' ? 'attach' : 'launch';
    const launch = tool.request(mode, input, 30000);
    await Promise.race([ready, launch.then(() => ready), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('The debugger did not initialize.')), 15000);
    })]);
    if (tool.closed) throw tool.closed;
    for (const [file, lines] of Object.entries(points || {})) await setBreakpoints(session, file, lines);
    if (capabilities?.supportsConfigurationDoneRequest) await tool.request('configurationDone', {});
    await launch;
    if (session.state === 'starting') session.state = 'running';
    update();
    return session;
  } catch (error) { tool.close(); throw error; }
  finally { clearTimeout(timer); }
}

function status(session) {
  const { state, thread, output, reason, revision } = session;
  return { state, thread, output, reason, revision };
}

async function action(session, input) {
  const { tool, thread } = session;
  switch (input.action) {
    case 'breakpoints': return setBreakpoints(session, input.file, input.lines);
    case 'stack': {
      const id = thread ?? (await tool.request('threads', {}))?.threads?.[0]?.id;
      if (id == null) return [];
      session.thread = id;
      return (await tool.request('stackTrace', { threadId: id, startFrame: 0, levels: 40 }))?.stackFrames || [];
    }
    case 'scopes': return (await tool.request('scopes', { frameId: input.frame }))?.scopes || [];
    case 'variables': return (await tool.request('variables', { variablesReference: input.reference }))?.variables?.slice(0, 200) || [];
    case 'continue':
    case 'next':
    case 'stepIn':
    case 'stepOut':
    case 'pause': {
      const id = thread ?? (await tool.request('threads', {}))?.threads?.[0]?.id;
      if (id == null) throw new Error('No debug thread.');
      if (input.action === 'pause') return tool.request('pause', { threadId: id });
      const wasPaused = session.state === 'paused';
      const reason = session.reason;
      session.state = 'running';
      session.reason = '';
      session.update();
      const revision = session.revision;
      try { return await tool.request(input.action, { threadId: id }); }
      catch (error) {
        if (wasPaused && session.revision === revision) {
          session.state = 'paused';
          session.reason = reason;
          session.update();
        }
        throw error;
      }
    }
    default: throw new Error('Unsupported debug action.');
  }
}

module.exports = { connectDebugger, action };
