/** Late-bound config saver — breaks appearance/editor/tabs ↔ config-io cycles */
let _saveAllConfig = async () => {};

export function setConfigSaver(fn) {
  _saveAllConfig = typeof fn === 'function' ? fn : async () => {};
}

export function saveAllConfig(...args) {
  return _saveAllConfig(...args);
}
