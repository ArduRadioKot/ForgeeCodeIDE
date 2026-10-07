/**
 * Claude Code / Codex / OpenCode wiring: install detection, settings panel, launch in the terminal.
 * Chat streaming itself lives in chat.js; the CLI processes live in lib/agents.js.
 */
import { state } from './state.js';
import { getDom } from './dom.js';
import { saveAllConfig } from './save-hook.js';
import { setTerminalVisible, ensureTerminalStarted } from './terminal.js';
import { updateOpenCodeStatus, refreshModelSelectForProvider } from './chat.js';

const dom = getDom();
const NAMES = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode' };
let detected = null;

const shellQuote = (s) => (navigator.platform.startsWith('Win') ? `"${s}"` : `'${String(s).replace(/'/g, `'\\''`)}'`);

export async function detectAgents() {
  if (!window.electronAPI?.agentsDetect) return null;
  detected = await window.electronAPI.agentsDetect(state.agentPaths || {});
  for (const agent of Object.keys(NAMES)) {
    const info = detected[agent] || {};
    const badge = document.getElementById(`agent-status-${agent}`);
    const meta = document.getElementById(`agent-meta-${agent}`);
    if (badge) {
      badge.textContent = info.found ? 'Найден' : 'Не установлен';
      badge.className = `status-indicator ${info.found ? 'connected' : 'not-configured'}`;
    }
    if (meta) meta.textContent = info.found ? `${info.version || ''} · ${info.path}` : `Установка: ${info.install}`;
  }
  const serveBtn = document.getElementById('opencode-serve-btn');
  if (serveBtn) serveBtn.textContent = detected.opencodeServe?.running ? 'Остановить serve' : 'Запустить serve';
  return detected;
}

export async function openAgentInTerminal(agent) {
  const info = detected?.[agent] || (await detectAgents())?.[agent];
  if (!info?.found) {
    alert(`${NAMES[agent]} не найден.\nУстановка: ${info?.install || ''}\nМожно указать путь к бинарнику в Настройках → AI.`);
    return;
  }
  await setTerminalVisible(true, false);
  await ensureTerminalStarted();
  const cd = state.currentFolder ? `cd ${shellQuote(state.currentFolder)} && ` : '';
  await window.electronAPI.terminalWrite(`${cd}${shellQuote(info.path)}\r`);
}

export async function toggleOpenCodeServe() {
  const btn = document.getElementById('opencode-serve-btn');
  if (detected?.opencodeServe?.running) {
    await window.electronAPI.opencodeServeStop();
    await detectAgents();
    updateOpenCodeStatus('disconnected');
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Запуск…'; }
  const res = await window.electronAPI.opencodeServeStart({ bin: state.agentPaths?.opencode || undefined, cwd: state.currentFolder || undefined, port: 4096 });
  if (btn) btn.disabled = false;
  if (!res.success) {
    alert(res.error || 'Не удалось запустить opencode serve');
  } else {
    state.opencodeBaseUrl = res.baseUrl;
    const input = document.getElementById('opencode-url');
    if (input) input.value = res.baseUrl;
    updateOpenCodeStatus('connected');
    if (state.currentAiProvider === 'opencode') await refreshModelSelectForProvider();
    saveAllConfig();
  }
  await detectAgents();
}

/** Put a prepared prompt into the chat input, open the chat and focus it. */
export function askAgent(prompt, { provider } = {}) {
  if (!state.chatVisible) dom.chatBtn?.click();
  if (provider && dom.aiProviderSelect && dom.aiProviderSelect.value !== provider) {
    dom.aiProviderSelect.value = provider;
    dom.aiProviderSelect.dispatchEvent(new Event('change'));
  }
  if (dom.userInput) {
    dom.userInput.value = prompt;
    dom.userInput.dispatchEvent(new Event('input'));
    dom.userInput.focus();
  }
}

export function setupAgents() {
  const access = document.getElementById('agent-access');
  if (access) {
    access.value = state.agentAccess;
    access.addEventListener('change', () => { state.agentAccess = access.value; saveAllConfig(); });
  }
  for (const agent of Object.keys(NAMES)) {
    const input = document.getElementById(`agent-path-${agent}`);
    if (input) {
      input.value = state.agentPaths?.[agent] || '';
      input.addEventListener('change', () => {
        state.agentPaths = { ...state.agentPaths, [agent]: input.value.trim() };
        saveAllConfig();
        detectAgents();
      });
    }
  }
  document.querySelectorAll('[data-agent-terminal]').forEach((btn) => {
    btn.addEventListener('click', () => openAgentInTerminal(btn.dataset.agentTerminal));
  });
  document.getElementById('agents-refresh-btn')?.addEventListener('click', detectAgents);
  document.getElementById('opencode-serve-btn')?.addEventListener('click', toggleOpenCodeServe);
  document.querySelector('[data-settings-tab="ai"]')?.addEventListener('click', detectAgents);
  detectAgents();
}

/** Called after the config is loaded so the fields reflect saved values. */
export function syncAgentSettings() {
  const access = document.getElementById('agent-access');
  if (access) access.value = state.agentAccess;
  for (const agent of Object.keys(NAMES)) {
    const input = document.getElementById(`agent-path-${agent}`);
    if (input) input.value = state.agentPaths?.[agent] || '';
  }
}
