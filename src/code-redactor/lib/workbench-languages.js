const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { ToolProtocol } = require('./tool-protocol');

const languageIds = { js: 'javascript', jsx: 'javascriptreact', ts: 'typescript', tsx: 'typescriptreact', py: 'python', rs: 'rust', go: 'go', json: 'json', html: 'html', css: 'css', java: 'java', c: 'c', cpp: 'cpp' };
const lspMethods = { definition: 'textDocument/definition', references: 'textDocument/references', fixes: 'textDocument/codeAction' };

async function connectLanguage(argv, root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('Open a project folder before starting the language server.');
  const tool = new ToolProtocol(argv, root, 'lsp');
  const session = { tool, root, documents: new Map(), diagnostics: new Map() };
  tool.on('notification', (event, body) => {
    if (event === 'textDocument/publishDiagnostics' && body?.uri) session.diagnostics.set(body.uri, body.diagnostics || []);
  });
  tool.on('request', ({ id, method, params }) => {
    if (method === 'workspace/configuration') tool.send({ id, result: (params?.items || []).map(() => null) });
    else if (['client/registerCapability', 'client/unregisterCapability', 'window/workDoneProgress/create'].includes(method)) tool.send({ id, result: null });
    else if (method === 'workspace/workspaceFolders') tool.send({ id, result: [{ uri: pathToFileURL(root).href, name: path.basename(root) }] });
    else if (method === 'workspace/applyEdit') tool.send({ id, result: { applied: false, failureReason: 'Use Quick Fix to review edits.' } });
    else tool.send({ id, error: { code: -32601, message: 'Method not supported' } });
  });
  try {
    const result = await tool.request('initialize', {
      processId: process.pid,
      rootUri: pathToFileURL(root).href,
      capabilities: {
        general: { positionEncodings: ['utf-16'] },
        textDocument: { codeAction: { codeActionLiteralSupport: { codeActionKind: { valueSet: ['quickfix'] } }, resolveSupport: { properties: ['edit'] } } },
      },
    });
    const capabilities = result?.capabilities || {};
    session.syncKind = typeof capabilities.textDocumentSync === 'number' ? capabilities.textDocumentSync : capabilities.textDocumentSync?.change;
    session.resolvesFixes = capabilities.codeActionProvider?.resolveProvider;
    tool.send({ method: 'initialized', params: {} });
    return session;
  } catch (error) { tool.close(); throw error; }
}

async function languageQuery(session, input) {
  const { tool, documents, diagnostics } = session;
  const method = lspMethods[input.action];
  if (!Object.hasOwn(lspMethods, input.action) || !method || typeof input.file !== 'string' || !path.isAbsolute(input.file) || typeof input.text !== 'string' || input.text.length > 2000000) {
    throw new Error('Open a saved source file smaller than 2 MB.');
  }
  const uri = pathToFileURL(input.file).href;
  const prev = documents.get(uri);
  const textDocument = { uri };
  if (!prev) {
    const extension = path.extname(input.file).slice(1).toLowerCase();
    tool.send({ method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: languageIds[extension] || extension, version: 1, text: input.text } } });
    documents.set(uri, { version: 1, text: input.text });
  } else if (prev.text !== input.text) {
    const change = { text: input.text };
    if (session.syncKind === 2) {
      const previousLines = prev.text.split('\n');
      change.range = { start: { line: 0, character: 0 }, end: { line: previousLines.length - 1, character: previousLines.at(-1).length } };
    }
    tool.send({ method: 'textDocument/didChange', params: { textDocument: { uri, version: ++prev.version }, contentChanges: [change] } });
    prev.text = input.text;
  }
  const position = input.position;
  const params = { textDocument, position };
  if (input.action === 'references') params.context = { includeDeclaration: true };
  if (input.action === 'fixes') {
    delete params.position;
    params.range = { start: position, end: position };
    if (!diagnostics.has(uri)) {
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    const context = (diagnostics.get(uri) || []).filter(({ range }) => range.start.line <= position.line && range.end.line >= position.line);
    params.context = { diagnostics: context, only: ['quickfix'], triggerKind: 1 };
  }
  const reply = await tool.request(method, params);
  if (input.action === 'fixes') {
    return Promise.all((reply || []).slice(0, 40).map(async (fix) => {
      const resolved = !fix.edit && fix.data && session.resolvesFixes
        ? await tool.request('codeAction/resolve', fix).catch(() => fix)
        : fix;
      return { title: fix.title, edit: toTextEdits(resolved.edit, documents), disabled: resolved.disabled?.reason };
    }));
  }
  return (Array.isArray(reply) ? reply : reply ? [reply] : []).slice(0, 300).flatMap((location) => {
    try {
      const start = (location.targetSelectionRange || location.range).start;
      return [{ file: fileURLToPath(location.targetUri || location.uri), line: start.line + 1, column: start.character + 1 }];
    } catch { return []; }
  });
}

function toTextEdits(edit, documents) {
  if (!edit) return null;
  const items = Object.entries(edit.changes || {}).map(([uri, edits]) => ({ textDocument: { uri }, edits }));
  items.push(...(edit.documentChanges || []));
  if (items.some((item) => !item.textDocument || !item.edits || item.edits.some((change) => !change.range))) return null;
  try {
    return items.map(({ textDocument, edits }) => {
      const document = documents.get(textDocument.uri);
      if (textDocument.version != null && textDocument.version !== document?.version) throw new Error('Stale edit');
      return { file: fileURLToPath(textDocument.uri), text: document?.text ?? null, edits };
    });
  } catch { return null; }
}

module.exports = { connectLanguage, languageQuery };
