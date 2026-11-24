const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { packageFile, MAX_WASM } = require('./openidea-package');

const workers = new Map();

function validate(plugin, request) {
  const { operation, name, value, snapshot } = request;
  const list = operation === 'command' ? plugin.openidea.commands : plugin.openidea.views;
  if (!['command', 'event', 'render'].includes(operation) || !list.some((entry) => entry.id === name)) {
    throw new Error('Unknown OpenIDEA command or tool view');
  }
  if (operation === 'event' && (!['button', 'message'].includes(value?.tag) || typeof value.val !== 'string' || value.val.length > 2_000_000)) {
    throw new Error('Invalid OpenIDEA tool view event');
  }
  if (operation === 'command' && value !== undefined && (typeof value !== 'string' || value.length > 65536)) {
    throw new Error('Invalid OpenIDEA command argument');
  }
  if (snapshot && (
    typeof snapshot.text !== 'string' || snapshot.text.length > 2_000_000 ||
    typeof snapshot.path !== 'string' || typeof snapshot.language !== 'string' ||
    !Number.isInteger(snapshot.from) || !Number.isInteger(snapshot.to) ||
    snapshot.from < 0 || snapshot.to < snapshot.from || snapshot.to > snapshot.text.length
  )) throw new Error('Invalid or oversized editor snapshot');
}

function startWorker(key, sender, plugin, binary) {
  const worker = new Worker(path.join(__dirname, 'openidea-worker.mjs'), {
    workerData: { binary, plugin: plugin.id, version: plugin.version, runtime: plugin.openidea },
    resourceLimits: { maxOldGenerationSizeMb: 192 },
  });
  let pending;
  let timer;
  const record = { tail: Promise.resolve(), waiting: 0, plugin: plugin.id };
  function settle(error, value) {
    const current = pending;
    pending = undefined;
    clearTimeout(timer);
    if (error) current?.reject(error);
    else current?.resolve(value);
  }
  function close(error) {
    if (workers.get(key) !== record) return;
    workers.delete(key);
    sender.removeListener('destroyed', shutdown);
    settle(error || new Error('OpenIDEA plugin stopped'));
    void worker.terminate();
  }
  const shutdown = () => close();
  worker.on('message', (value) => settle(value?.error ? new Error(value.error) : null, value));
  worker.on('error', close);
  worker.on('exit', () => close(new Error('OpenIDEA plugin process exited')));
  sender.once('destroyed', shutdown);
  const wait = (ms) => new Promise((resolve, reject) => {
    pending = { resolve, reject };
    timer = setTimeout(() => close(new Error('OpenIDEA plugin timed out')), ms);
  });
  workers.set(key, record);
  record.ready = wait(20000).catch((error) => { close(error); throw error; });
  record.close = close;
  record.run = (request) => {
    if (record.waiting >= 16) throw new Error('OpenIDEA plugin is busy');
    record.waiting++;
    const next = record.tail.then(async () => {
      await record.ready;
      if (workers.get(key) !== record) throw new Error('OpenIDEA plugin stopped');
      const reply = wait(4500);
      worker.postMessage(request);
      return reply;
    });
    record.tail = next.catch(() => {});
    return next.finally(() => { record.waiting--; });
  };
  return record;
}

async function runOpenIdea(sender, plugin, directory, request) {
  validate(plugin, request);
  if (sender.isDestroyed()) throw new Error('Editor window closed');
  const key = sender.id + ':' + plugin.id;
  let record = workers.get(key);
  if (!record) {
    const binary = await packageFile(directory, plugin.openidea.wasm, MAX_WASM);
    if (sender.isDestroyed()) throw new Error('Editor window closed');
    record = workers.get(key) || startWorker(key, sender, plugin, binary);
  }
  return record.run(request);
}

function stopOpenIdea(id) {
  for (const record of workers.values()) if (record.plugin === id) record.close();
}

module.exports = { runOpenIdea, stopOpenIdea };
