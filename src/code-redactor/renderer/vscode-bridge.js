/**
 * Renderer side of the VS Code extension host: answers vscode.window / editor UI
 * requests from the main process and keeps the host's editor snapshot fresh.
 */
import { state } from './state.js';
import { getDom } from './dom.js';
import { toast } from './image-view.js';
import { isEditorTab } from './tab-model.js';
import { saveFile, saveFileAs } from './editor.js';

const dom = getDom();
const statusNodes = new Map();

function activeEditorArea() {
  const tab = state.currentTabs[state.activeTabIndex];
  if (!isEditorTab(tab)) return null;
  if (state.splitView && state.focusedPane === 'right') {
    return document.getElementById('editor-right') || dom.editor;
  }
  return dom.editor;
}

function editorSnapshot() {
  const tab = state.currentTabs[state.activeTabIndex];
  const area = activeEditorArea();
  const text = area?.value ?? (isEditorTab(tab) ? tab.content : '') ?? '';
  return {
    path: tab?.filePath || null,
    name: tab?.name || null,
    text,
    selectionStart: area?.selectionStart ?? 0,
    selectionEnd: area?.selectionEnd ?? 0,
    folder: state.currentFolder || null,
    languageId: window.SyntaxHighlight?.detectLanguage?.(tab?.name || '') || 'plaintext',
    dirty: !!tab?.modified,
    tabSize: parseInt(dom.tabSizeSelect?.value || '4', 10),
    config: {},
  };
}

function pushEditorState() {
  window.electronAPI.vscodeHostSetEditor?.(editorSnapshot())?.catch?.(() => {});
}

function reply(id, value, error) {
  window.electronAPI.vscodeUiReply?.({ id, value, error: error || null });
}

function ensureStatusHost() {
  let host = document.getElementById('vscode-status-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'vscode-status-host';
    host.className = 'vscode-status-host';
    document.getElementById('status-bar')?.appendChild(host) || document.body.appendChild(host);
  }
  return host;
}

async function handleUi(msg) {
  const { id, channel, payload } = msg || {};
  try {
    switch (channel) {
      case 'toast':
        toast(payload?.text || '');
        return reply(id, undefined);
      case 'message': {
        const type = payload?.type || 'info';
        const items = payload?.items || [];
        if (!items.length) {
          toast(payload?.message || '');
          return reply(id, undefined);
        }
        // Prefer native confirm for yes/no; first item = OK
        const ok = window.confirm(`${payload.message}\n\n${items.map((x, i) => `${i + 1}. ${x}`).join('\n')}`);
        return reply(id, ok ? items[0] : undefined);
      }
      case 'input-box': {
        const value = window.prompt(
          [payload?.prompt, payload?.placeHolder].filter(Boolean).join('\n') || 'Ввод',
          payload?.value || '',
        );
        return reply(id, value === null ? undefined : value);
      }
      case 'quick-pick': {
        const items = payload?.items || [];
        if (!items.length) return reply(id, undefined);
        const labels = items.map((i) => i.label || String(i));
        const choice = window.prompt(
          `${payload?.placeholder || 'Выберите:'}\n${labels.map((l, i) => `${i + 1}. ${l}`).join('\n')}`,
          '1',
        );
        if (choice == null) return reply(id, undefined);
        const idx = Math.max(0, (parseInt(choice, 10) || 1) - 1);
        const picked = items[idx];
        if (payload?.canPickMany) return reply(id, picked ? [picked] : []);
        return reply(id, picked);
      }
      case 'save-active':
        await saveFile();
        return reply(id, true);
      case 'save-as':
        await saveFileAs();
        return reply(id, true);
      case 'insert-text': {
        const area = activeEditorArea();
        if (!area) return reply(id, false);
        area.focus();
        area.setRangeText(String(payload?.text || ''), area.selectionStart, area.selectionEnd, 'end');
        area.dispatchEvent(new Event('input', { bubbles: true }));
        pushEditorState();
        return reply(id, true);
      }
      case 'apply-edits': {
        const area = activeEditorArea();
        if (!area) return reply(id, false);
        const edits = [...(payload?.edits || [])].sort((a, b) => b.start - a.start);
        let { value } = area;
        for (const e of edits) {
          value = value.slice(0, e.start) + e.text + value.slice(e.end);
        }
        area.focus();
        area.value = value;
        area.dispatchEvent(new Event('input', { bubbles: true }));
        pushEditorState();
        return reply(id, true);
      }
      case 'open-file': {
        if (payload?.path) {
          const res = await window.electronAPI.getFileContent?.(payload.path);
          if (res?.success || typeof res === 'string' || res?.content != null) {
            const { createTab } = await import('./tabs.js');
            const { pathUtils } = await import('./utils.js');
            const content = res.content ?? res;
            createTab(pathUtils.basename(payload.path), content, payload.path);
          }
        }
        return reply(id, true);
      }
      case 'command': {
        const { openCommandPalette, openQuickOpen, formatDocument } = await import('./palette.js');
        if (payload?.id === 'palette') openCommandPalette();
        else if (payload?.id === 'quick-open') openQuickOpen();
        else if (payload?.id === 'format') formatDocument();
        return reply(id, true);
      }
      case 'output':
        console.info(`[ext:${payload?.name || 'output'}]`, payload?.text || '');
        toast(`Вывод «${payload?.name || 'output'}» — см. DevTools`);
        return reply(id, true);
      case 'status-bar': {
        const host = ensureStatusHost();
        if (!payload?.show) {
          statusNodes.get(payload?.id)?.remove();
          statusNodes.delete(payload?.id);
          return reply(id, true);
        }
        let el = statusNodes.get(payload.id);
        if (!el) {
          el = document.createElement('span');
          el.className = 'vscode-status-item';
          host.appendChild(el);
          statusNodes.set(payload.id, el);
        }
        el.textContent = payload.text || '';
        el.title = payload.tooltip || '';
        return reply(id, true);
      }
      case 'clipboard-read':
        return reply(id, await navigator.clipboard.readText());
      case 'clipboard-write':
        await navigator.clipboard.writeText(String(payload?.text || ''));
        return reply(id, true);
      case 'workspace-edit': {
        if (payload?.path) {
          const tab = state.currentTabs.find((t) => t.filePath === payload.path);
          const active = state.currentTabs[state.activeTabIndex];
          if (tab && isEditorTab(tab) && tab === active) {
            await handleUi({ id: -1, channel: 'apply-edits', payload });
          } else if (payload.edits?.length) {
            const res = await window.electronAPI.getFileContent?.(payload.path);
            if (res?.success) {
              let text = res.content;
              const edits = [...payload.edits].sort((a, b) => b.start - a.start);
              for (const e of edits) text = text.slice(0, e.start) + e.text + text.slice(e.end);
              await window.electronAPI.writeFile?.(payload.path, text);
              if (tab) tab.content = text;
            }
          }
        }
        return reply(id, true);
      }
      case 'diagnostics': {
        extDiagnostics.set(payload?.collection || 'ext', Array.isArray(payload?.items) ? payload.items : []);
        window.dispatchEvent(new CustomEvent('frogee:ext-diagnostics'));
        return reply(id, true);
      }
      case 'reveal-line': {
        const area = activeEditorArea();
        if (area && payload?.line) {
          const { goToEditorLine } = await import('./explorer.js');
          goToEditorLine?.(payload.line);
        }
        return reply(id, true);
      }
      case 'decorations':
      case 'decoration-type':
      case 'tree-register':
        return reply(id, true);
      case 'terminal-show': {
        const { toggleTerminal, setTerminalVisible } = await import('./terminal.js');
        setTerminalVisible?.(true) || toggleTerminal?.();
        return reply(id, true);
      }
      case 'terminal-write': {
        const { ensureTerminalStarted } = await import('./terminal.js');
        await ensureTerminalStarted?.();
        if (payload?.text) window.electronAPI.terminalWrite?.(payload.text);
        return reply(id, true);
      }
      case 'webview-open': {
        openWebviewPanel(payload);
        return reply(id, true);
      }
      case 'webview-html': {
        const frame = document.querySelector(`#vscode-webview-${CSS.escape(payload?.id || '')} iframe`);
        if (frame) frame.srcdoc = payload?.html || '';
        return reply(id, true);
      }
      case 'webview-close': {
        document.getElementById(`vscode-webview-${payload?.id}`)?.remove();
        return reply(id, true);
      }
      case 'webview-post':
        return reply(id, true);
      case 'set-language':
        return reply(id, true);
      default:
        return reply(id, undefined, `Неизвестный vscode UI канал: ${channel}`);
    }
  } catch (err) {
    reply(id, undefined, err.message || String(err));
  }
}

/** @type {Map<string, any[]>} */
const extDiagnostics = new Map();
export function extensionDiagnostics() {
  const out = [];
  for (const items of extDiagnostics.values()) out.push(...items);
  return out;
}

function openWebviewPanel(payload) {
  const id = payload?.id || 'wv';
  let panel = document.getElementById(`vscode-webview-${id}`);
  if (!panel) {
    panel = document.createElement('div');
    panel.id = `vscode-webview-${id}`;
    panel.className = 'vscode-webview-panel';
    panel.innerHTML = `<div class="vscode-webview-bar"><span></span><button type="button" aria-label="Закрыть">×</button></div><iframe sandbox="allow-scripts allow-same-origin"></iframe>`;
    panel.querySelector('button').addEventListener('click', () => panel.remove());
    document.body.appendChild(panel);
  }
  panel.querySelector('.vscode-webview-bar span').textContent = payload?.title || payload?.viewType || 'Webview';
  if (payload?.html) panel.querySelector('iframe').srcdoc = payload.html;
}

/** Commands registered by running extensions (for the palette). */
let runtimeCommands = [];

export async function refreshRuntimeCommands() {
  try {
    const detailed = await window.electronAPI.vscodeHostCommands?.();
    if (Array.isArray(detailed) && detailed.length) {
      runtimeCommands = detailed.map((c) => ({
        command: c.command,
        title: c.category ? `${c.category}: ${c.title}` : (c.title || c.command),
        extension: c.extension || c.extensionId || '',
        extensionId: c.extensionId || '',
      }));
      return runtimeCommands;
    }
    const list = await window.electronAPI.vscodeHostList?.();
    runtimeCommands = [];
    for (const ext of Array.isArray(list) ? list : []) {
      const details = ext.commandDetails || (ext.commands || []).map((command) => ({ command, title: command }));
      for (const c of details) {
        runtimeCommands.push({
          command: c.command,
          title: c.category ? `${c.category}: ${c.title}` : (c.title || c.command),
          extension: ext.displayName || ext.id,
          extensionId: ext.id,
        });
      }
    }
  } catch {
    runtimeCommands = [];
  }
  return runtimeCommands;
}

export function runtimePaletteCommands() {
  return runtimeCommands.map((c) => ({
    label: c.title,
    detail: c.extension ? `расширение · ${c.extension}` : 'расширение',
    run: () => window.electronAPI.vscodeHostExecute?.({ command: c.command }),
  }));
}

export async function extensionCompletions(prefix) {
  try {
    const res = await window.electronAPI.vscodeHostProviders?.({ kind: 'completion', payload: {} });
    if (!Array.isArray(res)) return [];
    const low = String(prefix || '').toLowerCase();
    return res
      .filter((c) => !low || c.label.toLowerCase().startsWith(low) || c.insertText?.toLowerCase?.().startsWith(low))
      .slice(0, 8)
      .map((c) => ({ label: c.insertText || c.label, detail: c.detail || c.documentation || 'расширение' }));
  } catch {
    return [];
  }
}

export async function extensionFormatDocument() {
  const res = await window.electronAPI.vscodeHostProviders?.({ kind: 'formatting', payload: {} });
  if (!Array.isArray(res) || !res.length) return false;
  const area = activeEditorArea();
  if (!area) return false;
  const edits = [...res].sort((a, b) => b.start - a.start);
  let { value } = area;
  for (const e of edits) value = value.slice(0, e.start) + e.text + value.slice(e.end);
  area.focus();
  area.value = value;
  area.dispatchEvent(new Event('input', { bubbles: true }));
  pushEditorState();
  return true;
}

export async function startVscodeHost() {
  if (!window.electronAPI?.onVscodeUi) return;
  window.electronAPI.onVscodeUi((msg) => handleUi(msg));
  pushEditorState();
  const push = () => pushEditorState();
  dom.editor?.addEventListener('input', push);
  dom.editor?.addEventListener('keyup', push);
  dom.editor?.addEventListener('click', push);
  document.getElementById('editor-right')?.addEventListener('input', push);
  window.addEventListener('focus', push);
  const res = await window.electronAPI.vscodeHostActivateAll?.();
  await refreshRuntimeCommands();
  if (Array.isArray(res)) {
    for (const r of res) {
      if (r.ok === false) console.warn('[vscode-host]', r.id, r.error);
      else if (r.ok && !r.already) console.info('[vscode-host] activated', r.id, r.commands || []);
    }
  }
}

export async function activateExtensionRuntime(id) {
  const res = await window.electronAPI.vscodeHostActivate?.(id);
  await refreshRuntimeCommands();
  return res;
}

export async function deactivateExtensionRuntime(id) {
  const res = await window.electronAPI.vscodeHostDeactivate?.(id);
  await refreshRuntimeCommands();
  return res;
}
