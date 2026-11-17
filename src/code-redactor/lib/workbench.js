const { ipcMain, dialog, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createProject } = require('./project-templates');
const { requestHttp, querySqlite, queryPostgres, syncProject } = require('./workbench-io');
const { ToolProtocol } = require('./tool-protocol');
const { connectLanguage, languageQuery } = require('./workbench-languages');
const debug = require('./workbench-debug');

function registerWorkbench() {
  const sessions = new Map();

  function workspace(sender) {
    if (!sessions.has(sender.id)) {
      const current = { connecting: new Set() };
      sessions.set(sender.id, current);
      sender.once('destroyed', () => {
        sessions.delete(sender.id);
        for (const key of ['lsp', 'dap', 'mcp']) current[key]?.tool.close();
      });
    }
    return sessions.get(sender.id);
  }

  const pick = async (win, directory) => {
    const chosen = await dialog.showOpenDialog(win, {
      properties: [directory ? 'openDirectory' : 'openFile'],
      ...(directory ? {} : { filters: [{ name: 'SQLite', extensions: ['sqlite', 'sqlite3', 'db', 'db3'] }, { name: 'All files', extensions: ['*'] }] }),
    });
    return chosen.canceled ? null : chosen.filePaths[0];
  };

  async function connect(sender, current, key, start) {
    if (current.connecting.has(key)) throw new Error('A connection is already starting.');
    current.connecting.add(key);
    current[key]?.tool.close();
    delete current[key];
    try {
      const session = await start();
      if (sender.isDestroyed()) { session.tool.close(); return; }
      current[key] = session;
    } finally { current.connecting.delete(key); }
    return true;
  }

  function connected(current, key) {
    const session = current[key];
    if (!session || session.tool.closed) throw new Error(session?.tool.closed?.message || 'Start the tool first.');
    return session;
  }

  ipcMain.handle('workbench:action', async ({ sender }, name, input = {}) => {
    const win = BrowserWindow.fromWebContents(sender);
    const current = workspace(sender);
    switch (name) {
      case 'project': {
        const parent = await pick(win, true);
        return parent && createProject(parent, input.name, input.template);
      }
      case 'http': return requestHttp(input);
      case 'db:file': return pick(win, false);
      case 'db:query': return querySqlite(input.file, input.sql, input.write === true);
      case 'db:postgres': return queryPostgres(input.connection, input.sql, input.write === true);
      case 'remote:clone': {
        const parent = await pick(win, true);
        if (!parent) return null;
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(input.name)) throw new Error('Enter a local folder name.');
        const local = path.join(parent, input.name);
        await fs.mkdir(local);
        try { await syncProject(input, local, false); }
        catch (error) {
          await fs.rm(local, { recursive: true, force: true });
          throw error;
        }
        return local;
      }
      case 'remote:sync': {
        if (!path.isAbsolute(input.local) || !(await fs.stat(input.local)).isDirectory()) throw new Error('Open the local copy of the project.');
        await syncProject(input, input.local, input.push === true);
        return input.local;
      }
      case 'lsp:start': return connect(sender, current, 'lsp', () => connectLanguage(input.command, input.root));
      case 'lsp:query': {
        const session = connected(current, 'lsp');
        if (input.root !== session.root) throw new Error('Restart the language server for the current project.');
        return languageQuery(session, input);
      }
      case 'dap:start': return connect(sender, current, 'dap', () => debug.connectDebugger(input.command, input.root, input.config, input.breakpoints, (status) => {
        if (!sender.isDestroyed()) sender.send('workbench:debug', status);
      }));
      case 'dap:action': return debug.action(connected(current, 'dap'), input);
      case 'mcp:start': return connect(sender, current, 'mcp', async () => {
        const tool = new ToolProtocol(input.command, input.root, 'mcp');
        tool.on('request', ({ id, method }) => {
          if (method === 'ping') tool.send({ id, result: {} });
          else tool.send({ id, error: { code: -32601, message: 'Method not supported' } });
        });
        try {
          const init = await tool.request('initialize', {
            protocolVersion: '2025-06-18', capabilities: {},
            clientInfo: { name: 'FrogeeCodeIDE', version: '1.0.0' },
          });
          if (!init?.capabilities?.tools) throw new Error('This MCP server does not expose tools.');
          tool.send({ method: 'notifications/initialized' });
          return { tool, names: new Set() };
        } catch (error) { tool.close(); throw error; }
      });
      case 'mcp:list': {
        const session = connected(current, 'mcp');
        const list = [];
        let cursor;
        const cursors = new Set();
        do {
          const page = await session.tool.request('tools/list', cursor ? { cursor } : {});
          list.push(...(page?.tools || []));
          cursor = page?.nextCursor;
          if (!cursor || cursors.has(cursor)) break;
          cursors.add(cursor);
        } while (cursors.size < 20 && list.length < 200);
        const tools = list.slice(0, 200);
        session.names = new Set(tools.map(({ name }) => name));
        return tools;
      }
      case 'mcp:call': {
        const session = connected(current, 'mcp');
        if (!session.names.has(input.tool)) throw new Error('Select a tool from the server list.');
        return session.tool.request('tools/call', { name: input.tool, arguments: input.args }, 45000);
      }
      case 'disconnect': {
        if (!['lsp', 'dap', 'mcp'].includes(input.key) || !current[input.key]) return false;
        const { tool } = current[input.key];
        delete current[input.key];
        try {
          if (tool.closed) return true;
          if (input.key === 'dap') await tool.request('disconnect', { restart: false }, 2500);
          if (input.key === 'lsp') {
            await tool.request('shutdown', null, 2500);
            tool.send({ method: 'exit' });
          }
        } finally { tool.close(); }
        return true;
      }
      default: throw new Error('Unknown workbench action.');
    }
  });
}

module.exports = { registerWorkbench };
