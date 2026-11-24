import { state } from './state.js';
import { isEditorTab } from './tab-model.js';
import { openPluginTab } from './tabs-api.js';
import { toast } from './image-view.js';
import { getLang } from './i18n.js';

let plugins = [];
const tools = new Map();
const tr = (ru, en) => getLang() === 'en' ? en : ru;
const toolKey = (id, view) => id + ':' + view;

export function syncOpenIdeaPlugins(installed) {
  plugins = installed.filter((extension) => extension.openidea && extension.codeEnabled);
  for (const tool of tools.values()) {
    const plugin = plugins.find((candidate) => candidate.id === tool.id);
    if (!plugin || plugin.installedAt !== tool.installedAt) tool.tab.close();
  }
}

function editorSnapshot() {
  const right = state.splitView && state.focusedPane === 'right';
  const tab = state.currentTabs[right ? state.rightTabIndex : state.activeTabIndex];
  const area = document.getElementById(right ? 'editor-right' : 'editor');
  if (!isEditorTab(tab) || !area || !area.getClientRects().length) return null;
  const language = window.SyntaxHighlight?.detectLanguage?.(tab.name) || 'text';
  const snapshot = { path: tab.filePath || '', language, text: area.value, from: area.selectionStart, to: area.selectionEnd };
  return { tab, area, right, snapshot };
}

function applyEditorResult(source, result) {
  if (!source || (result.text === undefined && !result.selection)) return;
  const { tab, area, right, snapshot } = source;
  const current = state.currentTabs[right ? state.rightTabIndex : state.activeTabIndex];
  if (current !== tab || area.value !== snapshot.text || !area.getClientRects().length) {
    throw new Error(tr('Файл изменился во время работы плагина.', 'The file changed while the plugin was running.'));
  }
  if (result.text !== undefined && result.text !== snapshot.text) {
    area.focus();
    area.select();
    if (!document.execCommand('insertText', false, result.text)) {
      area.setRangeText(result.text, 0, area.value.length, 'preserve');
      area.dispatchEvent(new Event('input', { bubbles: true }));
    }
    area.setSelectionRange(snapshot.from, snapshot.to);
  }
  if (result.selection) area.setSelectionRange(result.selection.from, result.selection.to);
}

async function invoke(plugin, operation, name, value, source) {
  const response = await window.electronAPI.openIdeaPluginRun({ id: plugin.id, operation, name, value, snapshot: source?.snapshot });
  if (response?.error || !response) throw new Error(response?.error || 'OpenIDEA: empty response');
  applyEditorResult(source, response);
  for (const notice of [...response.notices, response.notice].filter(Boolean)) toast(notice);
  for (const message of response.messages) tools.get(toolKey(plugin.id, message.view))?.deliver(message.text);
  return response;
}

const frameColors = {
  bg: 'editor-bg', 'bg-elevated': 'card-bg', 'bg-input': 'code-bg', 'bg-hover': 'hover-color',
  'bg-selected': 'active-bg', fg: 'text-color', 'fg-strong': 'text-color', 'fg-muted': 'text-muted',
  'fg-on-accent': 'accent-text', border: 'border-color', accent: 'accent-color',
  'focus-ring': 'accent-color', danger: 'danger-color', info: 'link-color',
  'font-ui': 'ui-font', 'font-mono': 'mono-font',
};

function frameStyles() {
  const computed = getComputedStyle(document.body);
  return Object.entries(frameColors).map(([key, color]) => {
    const value = computed.getPropertyValue('--' + color).replace(/[<>{};]/g, '').trim();
    return '--openidea-' + key + ':' + value;
  }).join(';') + ';color-scheme:' + (document.body.classList.contains('light-theme') ? 'light' : 'dark') + ';';
}

function viewFrame(html, host, title, send) {
  const frame = document.createElement('webview');
  frame.setAttribute('partition', 'frogee-openidea-views');
  frame.setAttribute('title', title);
  const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'";
  const documentHtml = '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + policy +
    '"><style>:root{' + frameStyles() +
    '}body{margin:0;background:var(--openidea-bg);color:var(--openidea-fg);font-family:var(--openidea-font-ui)}</style>' + html;
  const utf8 = new TextEncoder().encode(documentHtml);
  let binary = '';
  for (let i = 0; i < utf8.length; i += 8192) binary += String.fromCharCode(...utf8.subarray(i, i + 8192));
  frame.src = 'data:text/html;charset=utf-8;base64,' + btoa(binary);

  let ready = false;
  const waiting = [];
  const theme = new MutationObserver(() => {
    if (ready) frame.send('openidea-view-theme', frameStyles());
  });
  theme.observe(document.body, { attributeFilter: ['class', 'style'] });
  theme.observe(document.documentElement, { attributeFilter: ['class', 'style'] });
  frame.addEventListener('ipc-message', (event) => {
    const [text] = event.args;
    if (event.channel === 'openidea-view-message' && typeof text === 'string' && text.length <= 2_000_000) send(text);
  });
  const deliver = (text) => {
    if (ready) frame.send('openidea-view-result', text);
    else if (waiting.length < 20) waiting.push(text);
  };
  frame.addEventListener('dom-ready', () => {
    ready = true;
    waiting.splice(0).forEach(deliver);
  });
  host.replaceChildren(frame);
  return { deliver, dispose: () => theme.disconnect() };
}

function toolButton(spec, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ext-btn ghost';
  button.textContent = spec.label;
  if (spec.tooltip) button.title = spec.tooltip;
  button.disabled = spec.enabled === false;
  button.addEventListener('click', onClick);
  return button;
}

export async function openOpenIdeaTool(plugin, view, source = editorSnapshot()) {
  const key = toolKey(plugin.id, view.id);
  const previous = tools.get(key);
  if (previous) {
    if (source) previous.source = source;
    previous.tab.focus();
    return;
  }
  const panel = { id: plugin.id, installedAt: plugin.installedAt, source, deliver() {} };
  panel.tab = openPluginTab({
    key: 'openidea:' + key,
    title: view.title,
    onClose() {
      panel.frame?.dispose();
      tools.delete(key);
    },
  });
  if (!panel.tab) return;
  tools.set(key, panel);
  const host = panel.tab.element;
  host.classList.add('openidea-tool');
  host.innerHTML = '<header class="openidea-tool-head"></header><div class="openidea-tool-content"></div><footer class="openidea-tool-status" role="status"></footer>';
  const body = host.querySelector('.openidea-tool-content');
  const status = host.querySelector('footer');
  status.textContent = tr('Открываю инструмент…', 'Opening tool…');
  const send = (tag, val) => invoke(plugin, 'event', view.id, { tag, val }, panel.source).catch((error) => {
    status.textContent = error.message;
  });
  let pending;
  let sending = false;
  async function sendFrameMessage(text) {
    pending = text;
    if (sending) return;
    sending = true;
    while (pending !== undefined && tools.get(key) === panel) {
      const next = pending;
      pending = undefined;
      await send('message', next);
    }
    sending = false;
  }
  try {
    const result = await invoke(plugin, 'render', view.id, undefined, source);
    if (tools.get(key) !== panel) return;
    const data = result.view;
    host.querySelector('header').replaceChildren(...data.toolbar.map((button) => toolButton(button, () => send('button', button.id))));
    status.textContent = data.status || '';
    if (data.body.tag === 'html') {
      panel.frame = viewFrame(data.body.val, body, view.title, sendFrameMessage);
      panel.deliver = panel.frame.deliver;
    } else {
      body.classList.add('openidea-tool-message');
      body.textContent = data.body.tag === 'message' ? data.body.val : tr('Этот вид инструмента пока недоступен.', 'This tool view type is unavailable.');
    }
  } catch (error) {
    status.textContent = error.message;
  }
}

async function runCommand(plugin, command) {
  const source = editorSnapshot();
  const firstView = plugin.openidea.views[0];
  try {
    if (firstView && !plugin.openidea.capabilities.includes('editor.write')) await openOpenIdeaTool(plugin, firstView, source);
    await invoke(plugin, 'command', command.id, undefined, source);
  } catch (error) { toast(error.message); }
}

export function openIdeaPaletteCommands() {
  return plugins.flatMap((plugin) => [
    ...plugin.openidea.commands.map((command) => ({ label: command.title, detail: 'OpenIDEA', run: () => runCommand(plugin, command) })),
    ...plugin.openidea.views.map((view) => ({ label: view.title, detail: 'OpenIDEA', run: () => openOpenIdeaTool(plugin, view) })),
  ]);
}

export function setupOpenIdeaEditorMenu() {
  document.addEventListener('contextmenu', (event) => {
    if (!event.target.matches('#editor, #editor-right')) return;
    const actions = plugins.flatMap((plugin) => plugin.openidea.commands
      .filter((command) => plugin.openidea.menuCommands.includes(command.id))
      .map((command) => ({ title: command.title, run: () => runCommand(plugin, command) })));
    if (!actions.length) return;
    event.preventDefault();
    state.contextMenu?.remove();
    const menu = document.createElement('div');
    menu.className = 'context-menu tab-menu';
    menu.style.position = 'fixed';
    menu.style.zIndex = '10000';
    const cleanup = new AbortController();
    const close = () => {
      cleanup.abort();
      menu.remove();
      if (state.contextMenu === menu) state.contextMenu = null;
    };
    const area = event.target;
    for (const { title, run } of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'context-menu-item';
      button.textContent = title;
      button.addEventListener('click', () => { close(); area.focus(); void run(); });
      menu.append(button);
    }
    document.body.append(menu);
    state.contextMenu = menu;
    menu.style.left = Math.max(4, Math.min(event.clientX, innerWidth - menu.offsetWidth - 4)) + 'px';
    menu.style.top = Math.max(4, Math.min(event.clientY, innerHeight - menu.offsetHeight - 4)) + 'px';
    document.addEventListener('pointerdown', (e) => { if (!menu.contains(e.target)) close(); }, { signal: cleanup.signal });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { close(); area.focus(); } }, { signal: cleanup.signal });
    menu.querySelector('button')?.focus({ preventScroll: true });
  });
}
