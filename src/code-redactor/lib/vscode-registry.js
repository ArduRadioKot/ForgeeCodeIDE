/**
 * Shared registries for all activated VS Code extensions (providers, diagnostics, command titles).
 */
const { EventEmitter: NodeEE } = require('events');

/** @type {Map<string, { title: string, category: string, extensionId: string }>} */
const commandMeta = new Map();

/** @type {Array<{ kind: string, selector: any, provider: any, extensionId: string }>} */
const providers = [];

/** @type {Map<string, Map<string, any[]>>} collectionName -> uriString -> Diagnostic[] */
const diagnostics = new Map();
const onDiagnostics = new NodeEE();

function selectorMatches(selector, doc) {
  if (!selector || !doc) return false;
  const list = Array.isArray(selector) ? selector : [selector];
  return list.some((s) => {
    if (typeof s === 'string') return s === '*' || s === doc.languageId;
    if (!s || typeof s !== 'object') return false;
    if (s.scheme && s.scheme !== '*' && s.scheme !== doc.uri?.scheme) return false;
    if (s.language && s.language !== '*' && s.language !== doc.languageId) return false;
    if (s.pattern) {
      const pat = String(s.pattern).replace(/\\/g, '/');
      const file = String(doc.fileName || doc.uri?.fsPath || '').replace(/\\/g, '/');
      const re = new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$');
      if (!re.test(file) && !re.test(file.split('/').pop() || '')) return false;
    }
    return true;
  });
}

function registerProvider(kind, selector, provider, extensionId) {
  const entry = { kind, selector, provider, extensionId };
  providers.push(entry);
  return () => {
    const i = providers.indexOf(entry);
    if (i >= 0) providers.splice(i, 1);
  };
}

function providersFor(kind, doc) {
  return providers.filter((p) => p.kind === kind && selectorMatches(p.selector, doc)).map((p) => p.provider);
}

function setCommandMeta(id, meta) {
  commandMeta.set(id, meta);
}

function getCommandMeta(id) {
  return commandMeta.get(id);
}

function allCommandMeta() {
  return [...commandMeta.entries()].map(([command, m]) => ({ command, ...m }));
}

function setDiagnostics(collection, uriKey, items) {
  if (!diagnostics.has(collection)) diagnostics.set(collection, new Map());
  const map = diagnostics.get(collection);
  if (!items || !items.length) map.delete(uriKey);
  else map.set(uriKey, items);
  onDiagnostics.emit('change', { collection, uriKey });
}

function clearDiagnostics(collection, uriKey) {
  if (!diagnostics.has(collection)) return;
  if (uriKey) diagnostics.get(collection).delete(uriKey);
  else diagnostics.get(collection).clear();
  onDiagnostics.emit('change', { collection, uriKey: uriKey || '*' });
}

function allDiagnostics() {
  const out = [];
  for (const [collection, map] of diagnostics) {
    for (const [uri, items] of map) {
      for (const d of items) out.push({ collection, uri, ...d });
    }
  }
  return out;
}

function removeExtension(extensionId) {
  for (let i = providers.length - 1; i >= 0; i--) {
    if (providers[i].extensionId === extensionId) providers.splice(i, 1);
  }
  for (const [cmd, meta] of commandMeta) {
    if (meta.extensionId === extensionId) commandMeta.delete(cmd);
  }
}

module.exports = {
  registerProvider,
  providersFor,
  setCommandMeta,
  getCommandMeta,
  allCommandMeta,
  setDiagnostics,
  clearDiagnostics,
  allDiagnostics,
  onDiagnostics,
  removeExtension,
  selectorMatches,
};
