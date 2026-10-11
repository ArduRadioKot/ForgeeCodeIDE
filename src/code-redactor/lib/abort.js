/** Registry of cancellable requests, so one "Stop" button can cancel whatever the chat is waiting for. */
const active = new Set();

function track(controller) {
  active.add(controller);
  return () => active.delete(controller);
}

function abortAll() {
  for (const controller of [...active]) {
    try { controller.abort(); } catch {}
  }
  active.clear();
}

module.exports = { track, abortAll };
