/**
 * "Flow" animations: one highlight pill glides (with a springy overshoot) between the items of a group
 * instead of the highlight snapping. Used only by the left toolbar and the top tab strip.
 */
const REDUCED = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function attachFlow(host, { items, active, container = host }) {
  if (!host) return null;
  const pill = document.createElement('span');
  pill.className = 'flow-pill no-anim hidden';
  pill.setAttribute('aria-hidden', 'true');
  host.insertBefore(pill, host.firstChild);
  host.classList.add('flow-on');
  let frame = 0;
  let placed = false;

  const place = () => {
    frame = 0;
    const el = host.querySelector(active);
    if (!el || el.offsetParent === null) {
      pill.classList.add('hidden');
      return;
    }
    const h = host.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    // Rects are in zoomed (visual) pixels while left/top/width are layout pixels.
    const zoom = host.offsetWidth ? h.width / host.offsetWidth : 1;
    const x = (r.left - h.left) / zoom - host.clientLeft;
    const y = (r.top - h.top) / zoom - host.clientTop;
    const animate = placed && !REDUCED();
    pill.classList.toggle('no-anim', !animate);
    pill.style.width = `${r.width / zoom}px`;
    pill.style.height = `${r.height / zoom}px`;
    pill.style.transform = `translate(${x}px, ${y}px)`;
    pill.style.borderRadius = getComputedStyle(el).borderRadius;
    pill.classList.remove('hidden');
    placed = true;
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(place); };

  new MutationObserver(schedule).observe(container, { attributes: true, attributeFilter: ['class'], subtree: true, childList: true });
  new ResizeObserver(schedule).observe(host);
  container.addEventListener('scroll', schedule, { passive: true, capture: true });
  window.addEventListener('resize', schedule);
  schedule();
  return { update: schedule };
}

export function setupFlow() {
  const activity = '#explorer-btn.active, #search-btn.active, #git-btn.active, #debug-btn.active';
  attachFlow(document.getElementById('sidebar'), { items: '.sidebar-btn', active: activity });
  attachFlow(document.getElementById('editor-tabs'), { items: '.tab-item', active: '.tab-item.active', container: document.getElementById('editor-tabs') });
}
