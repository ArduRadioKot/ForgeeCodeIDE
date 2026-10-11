/**
 * The interface's own small icon set (16px grid, angular joins, some filled shapes) for places that used text symbols.
 * Static markup uses <span data-icon="name"></span>; dynamic strings call icon("name").
 */
const STROKE = 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter"';
const FILL = 'fill="currentColor" stroke="none"';

const SHAPES = {
  close: `<g ${STROKE}><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></g>`,
  plus: `<g ${STROKE}><path d="M8 3v10M3 8h10"/></g>`,
  check: `<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter"><path d="M3 8.5l3.2 3.2L13 5"/></g>`,
  up: `<path ${FILL} d="M8 3l5.5 8h-11z"/>`,
  down: `<path ${FILL} d="M8 13L2.5 5h11z"/>`,
  left: `<path ${FILL} d="M3 8l8-5.5v11z"/>`,
  right: `<path ${FILL} d="M13 8L5 2.5v11z"/>`,
  refresh: `<path ${STROKE} d="M13 8.2A5 5 0 1 1 11.3 4.4"/><path ${FILL} d="M14 1.8v5H9z"/>`,
  undo: `<path ${STROKE} d="M4 7h5.2a3.3 3.3 0 0 1 0 6.6H6"/><path ${FILL} d="M2 7l4-4v8z"/>`,
  external: `<path ${STROKE} d="M6.5 3.5h-3v9h9v-3"/><path ${FILL} d="M13.5 2.5h-5l5 5z"/>`,
  play: `<path ${FILL} d="M4.5 2.5v11l9-5.5z"/>`,
  dot: `<circle ${FILL} cx="8" cy="8" r="3.4"/>`,
  live: `<circle ${FILL} cx="8" cy="8" r="1.9"/><path ${STROKE} d="M4.6 4.6a4.8 4.8 0 0 0 0 6.8M11.4 4.6a4.8 4.8 0 0 1 0 6.8"/>`,
  window: `<g ${STROKE}><rect x="2" y="3" width="12" height="10"/><path d="M2 6.5h12"/></g>`,
  split: `<g ${STROKE}><rect x="2" y="3" width="12" height="10"/><path d="M8 3v10"/></g>`,
  unsplit: `<g ${STROKE}><rect x="2" y="3" width="12" height="10"/><path d="M5 8h6"/></g>`,
  totab: `<g ${STROKE}><path d="M2 13V3.5h4.5L8 5.5h6V13z"/></g>`,
  grip: `<g ${FILL}><circle cx="6" cy="4" r="1.1"/><circle cx="10" cy="4" r="1.1"/><circle cx="6" cy="8" r="1.1"/><circle cx="10" cy="8" r="1.1"/><circle cx="6" cy="12" r="1.1"/><circle cx="10" cy="12" r="1.1"/></g>`,
};

export function icon(name, size = 14) {
  const body = SHAPES[name];
  if (!body) return '';
  return `<svg class="ico ico-${name}" width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true">${body}</svg>`;
}

/** Fill every <span data-icon="…" data-size="…"> under `root`. */
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    if (el.dataset.done) return;
    el.innerHTML = icon(el.dataset.icon, Number(el.dataset.size) || 14);
    el.dataset.done = '1';
  });
}
