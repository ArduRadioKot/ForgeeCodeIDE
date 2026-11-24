/** Registry of cancellable requests, so one "Stop" button can cancel whatever the chat is waiting for. */
const active = new Map();

function track(controller, owner) {
  active.set(controller, owner);
  return () => active.delete(controller);
}

function abortAll(owner) {
  for (const [controller, requestOwner] of active) {
    if (owner !== undefined && owner !== requestOwner) continue;
    active.delete(controller);
    try { controller.abort(); } catch {}
  }
}

module.exports = { track, abortAll };
