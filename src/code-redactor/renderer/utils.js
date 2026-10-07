export const pathUtils = {
  basename: (filePath) => filePath.split(/[\\/]/).pop(),
  dirname: (filePath) => {
    const parts = filePath.split(/[\\/]/);
    parts.pop();
    return parts.join('/') || '/';
  },
  extname: (filePath) => {
    const basename = pathUtils.basename(filePath);
    const dotIndex = basename.lastIndexOf('.');
    return dotIndex > 0 ? basename.substring(dotIndex) : '';
  },
  join: (...parts) => parts.filter((p) => p).join('/').replace(/\/+/g, '/'),
};

export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

const BLOCKED_TAGS = 'script,iframe,object,embed,link,meta,base,form,style,frame,frameset,applet';

/**
 * Untrusted HTML (notebook outputs, AI replies) must never reach the DOM raw: the renderer exposes
 * electronAPI, so a single onerror= handler would be a file-write primitive.
 */
export function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(String(html ?? ''), 'text/html');
  doc.body.querySelectorAll(BLOCKED_TAGS).forEach((el) => el.remove());
  doc.body.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction') el.removeAttribute(attr.name);
      else if ((name === 'href' || name === 'src' || name === 'xlink:href' || name === 'action') && /^(javascript|vbscript|data:text\/html)/.test(value.replace(/\s/g, ''))) el.removeAttribute(attr.name);
    }
    if (el.tagName === 'A') { el.setAttribute('rel', 'noopener noreferrer'); el.setAttribute('target', '_blank'); }
  });
  return doc.body.innerHTML;
}
