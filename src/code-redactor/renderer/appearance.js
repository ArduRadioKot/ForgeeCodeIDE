import { state } from './state.js';
import { getDom } from './dom.js';
import { saveAllConfig } from './save-hook.js';
import { updateLineNumbers, updateSyntaxHighlight } from './editor-api.js';
import { fitTerminal, applyTerminalTheme } from './terminal.js';
import { updateSecondaryChrome } from './tabs.js';
import { findCustomTheme, applyThemeVars } from './themes.js';
import { applyGlass } from './glass.js';

const dom = getDom();

function pctLabel(el, value) {
  if (el) el.textContent = Math.round(Number(value) * 100) + '%';
}

export function applyEditorAppearance(shouldSave = true) {
  // One CSS variable drives every editor pane, so left, right and gutters can never drift apart.
  const root = document.documentElement;
  if (dom.fontSizeSelect) {
    const size = parseInt(dom.fontSizeSelect.value, 10) || 14;
    root.style.setProperty('--editor-font-size', size + 'px');
    // Whole-pixel line height: fractional rows leave hairline seams in the selection and drift the gutter.
    root.style.setProperty('--editor-line-height', Math.round(size * 1.6) + 'px');
  }
  if (dom.tabSizeSelect) root.style.setProperty('--editor-tab-size', dom.tabSizeSelect.value);
  updateLineNumbers();
  updateSyntaxHighlight();
  const stateRight = document.getElementById('editor-right');
  if (stateRight && state.splitView) updateSecondaryChrome();
  if (shouldSave) saveAllConfig();
}

export function updateFontSize() {
  applyEditorAppearance(true);
}

export function updateTheme() {
  if (!dom.themeSelect) return;
  applyThemeClass(dom.themeSelect.value);
  saveAllConfig();
}

export function applyThemeClass(theme) {
  const custom = findCustomTheme(theme);
  const base = custom ? custom.type : (theme === 'light' ? 'light' : 'dark');
  state.themeApplied = true;
  const keep = [];
  if (document.body.classList.contains('glass-off')) keep.push('glass-off');
  if (document.body.classList.contains('compact-ui')) keep.push('compact-ui');
  if (document.body.classList.contains('glass-editor-on')) keep.push('glass-editor-on');
  document.body.className = base === 'light' ? 'light-theme' : '';
  keep.forEach((cls) => document.body.classList.add(cls));
  applyThemeVars(custom);
  // Liquid Glass and the native blur read the theme from <html>.
  document.documentElement.dataset.theme = base;
  window.electronAPI?.setNativeTheme?.(base);
  applyTerminalTheme();
  applyGlass();
}

export function applyAppearanceLayout(shouldSave = true) {
  const root = document.documentElement;
  if (!state.activeTheme?.colors?.['accent-color']) root.style.setProperty('--accent-color', state.accentColor);
  // Compact UI also tightens the gaps and corners, not just the row heights.
  const radius = state.compactUi ? Math.min(state.uiRadius, 8) : state.uiRadius;
  const gap = state.compactUi ? Math.min(state.uiGap, 2) : state.uiGap;
  root.style.setProperty('--radius-lg', radius + 'px');
  root.style.setProperty('--radius-xl', radius + 4 + 'px');
  root.style.setProperty('--gap', gap + 'px');
  document.body.classList.remove('ambient-on');
  document.body.classList.toggle('compact-ui', state.compactUi);
  applyBackgroundCustomization();
  applyTerminalHeight();
  if (shouldSave) saveAllConfig();
}

export function updateTabSize() {
  applyEditorAppearance(true);
}

export function handleGlassOpacityChange() {
  applyExtendedGlassControls(true);
}

export function handleGlassBlurChange() {
  applyExtendedGlassControls(true);
}

export function handleGlassBlurCheckboxChange() {
  applyExtendedGlassControls(true);
}

export function updateGlassOpacityValue(opacity) {
  pctLabel(dom.glassOpacityValue, opacity);
}

export function updateGlassBlurValue(blur) {
  if (dom.glassBlurValue) dom.glassBlurValue.textContent = blur + 'px';
}

export function applyGlassmorphismSettings(opacity, blur, blurEnabled = true) {
  const root = document.documentElement;
  const safeOpacity = Math.max(0.2, Math.min(1, opacity));
  const safeBlur = Math.max(0, Math.min(40, blur | 0));
  const safeEditor = Math.max(0.2, Math.min(1, state.editorDim));
  const rim = Math.max(0, Math.min(0.3, state.glassRim / 100));
  const shadow = Math.max(0, Math.min(0.45, state.glassShadow / 100));

  root.style.setProperty('--glass-opacity', String(safeOpacity));
  root.style.setProperty('--editor-glass-opacity', String(safeEditor));
  root.style.setProperty('--glass-blur', (blurEnabled ? safeBlur : 0) + 'px');
  root.style.setProperty('--glass-blur-enabled', blurEnabled && safeBlur > 0 ? '1' : '0');
  root.style.setProperty('--glass-border-opacity', String(rim));
  root.style.setProperty('--glass-shadow-opacity', String(shadow));
  document.body.classList.toggle('glass-off', !blurEnabled);
  document.body.classList.toggle('glass-editor-on', true);
  applyBackgroundCustomization();
}

export function applyExtendedGlassControls(shouldSave = true) {
  if (dom.glassRimRange) {
    state.glassRim = parseInt(dom.glassRimRange.value, 10);
    if (dom.glassRimValue) dom.glassRimValue.textContent = state.glassRim + '%';
  }
  if (dom.glassShadowRange) {
    state.glassShadow = parseInt(dom.glassShadowRange.value, 10);
    if (dom.glassShadowValue) dom.glassShadowValue.textContent = state.glassShadow + '%';
  }
  if (dom.editorDimRange) {
    state.editorDim = parseFloat(dom.editorDimRange.value);
    if (dom.editorDimValue) dom.editorDimValue.textContent = Math.round(state.editorDim * 100) + '%';
  }
  if (dom.glassOpacityRange && dom.glassOpacityValue) {
    updateGlassOpacityValue(parseFloat(dom.glassOpacityRange.value));
  }
  applyGlassmorphismSettings(
    dom.glassOpacityRange ? parseFloat(dom.glassOpacityRange.value) : 0.78,
    dom.glassBlurRange ? parseInt(dom.glassBlurRange.value, 10) : 16,
    dom.glassEnabledCheckbox ? dom.glassEnabledCheckbox.checked : true
  );
  if (shouldSave) saveAllConfig();
}

export function applyTerminalHeight() {
  document.documentElement.style.setProperty('--terminal-height', state.terminalHeight + 'px');
  if (dom.terminalPanel && state.terminalVisible && !state.terminalInEditor) {
    dom.terminalPanel.style.height = state.terminalHeight + 'px';
  }
  requestAnimationFrame(() => fitTerminal());
}

function normalizeBgImage(value) {
  const v = String(value || '').trim();
  if (!v) return 'none';
  if (v === 'none') return 'none';
  if (/^url\(/i.test(v)) return v;
  return `url("${v.replace(/"/g, '\\"')}")`;
}

/** Применить цвета фона и поэлементную прозрачность */
export function applyBackgroundCustomization() {
  const root = document.documentElement;
  root.style.setProperty('--app-bg', state.appBg || '#16181d');
  root.style.setProperty('--bg-app', state.appBg || '#16181d');
  root.style.setProperty('--bg-sidebar', state.sidebarBg || '#1c1f26');
  root.style.setProperty('--bg-editor', state.editorBg || '#1a1d23');
  root.style.setProperty('--bg-panel', state.panelBg || '#1e2229');
  root.style.setProperty('--app-opacity', String(state.appOpacity ?? 1));
  root.style.setProperty('--bg-sidebar-opacity', String(state.sidebarOpacity ?? 0.78));
  root.style.setProperty('--bg-activity-opacity', String(state.activityOpacity ?? 0.78));
  root.style.setProperty('--bg-editor-opacity', String(state.editorSurfaceOpacity ?? 0.78));
  root.style.setProperty('--editor-glass-opacity', String(state.editorSurfaceOpacity ?? state.editorDim ?? 0.88));
  root.style.setProperty('--bg-terminal-opacity', String(state.terminalOpacity ?? 1));
  root.style.setProperty('--bg-custom-image', normalizeBgImage(state.bgImageUrl));
  root.style.setProperty('--bg-image-opacity', String(state.bgImageOpacity ?? 0));

}

export function loadAppearanceFieldsFromConfig(config = {}) {
  state.appBg = config.appBg || state.appBg;
  state.sidebarBg = config.sidebarBg || state.sidebarBg;
  state.editorBg = config.editorBg || state.editorBg;
  state.panelBg = config.panelBg || state.panelBg;
  if (typeof config.appOpacity === 'number') state.appOpacity = config.appOpacity;
  if (typeof config.sidebarOpacity === 'number') state.sidebarOpacity = config.sidebarOpacity;
  if (typeof config.activityOpacity === 'number') state.activityOpacity = config.activityOpacity;
  if (typeof config.editorSurfaceOpacity === 'number') state.editorSurfaceOpacity = config.editorSurfaceOpacity;
  if (typeof config.terminalOpacity === 'number') state.terminalOpacity = config.terminalOpacity;
  if (typeof config.bgImageUrl === 'string') state.bgImageUrl = config.bgImageUrl;
  if (typeof config.bgImageOpacity === 'number') state.bgImageOpacity = config.bgImageOpacity;
}

export function syncAppearanceControlsFromState() {
  const set = (id, value, isColor = false) => {
    const el = document.getElementById(id);
    if (!el || value == null) return;
    el.value = isColor ? value : String(value);
  };
  set('app-bg-color', state.appBg, true);
  set('sidebar-bg-color', state.sidebarBg, true);
  set('editor-bg-color', state.editorBg, true);
  set('panel-bg-color', state.panelBg, true);
  set('app-opacity-range', state.appOpacity);
  set('sidebar-opacity-range', state.sidebarOpacity);
  set('activity-opacity-range', state.activityOpacity);
  set('editor-surface-opacity-range', state.editorSurfaceOpacity);
  set('terminal-opacity-range', state.terminalOpacity);
  set('bg-image-url', state.bgImageUrl);
  set('bg-image-opacity-range', state.bgImageOpacity);

  pctLabel(document.getElementById('app-opacity-value'), state.appOpacity);
  pctLabel(document.getElementById('sidebar-opacity-value'), state.sidebarOpacity);
  pctLabel(document.getElementById('activity-opacity-value'), state.activityOpacity);
  pctLabel(document.getElementById('editor-surface-opacity-value'), state.editorSurfaceOpacity);
  pctLabel(document.getElementById('terminal-opacity-value'), state.terminalOpacity);
  pctLabel(document.getElementById('bg-image-opacity-value'), state.bgImageOpacity);
}

export function readAppearanceFieldsFromDom() {
  const color = (id, fallback) => document.getElementById(id)?.value || fallback;
  const num = (id, fallback) => {
    const el = document.getElementById(id);
    if (!el) return fallback;
    const v = parseFloat(el.value);
    return Number.isFinite(v) ? v : fallback;
  };
  state.appBg = color('app-bg-color', state.appBg);
  state.sidebarBg = color('sidebar-bg-color', state.sidebarBg);
  state.editorBg = color('editor-bg-color', state.editorBg);
  state.panelBg = color('panel-bg-color', state.panelBg);
  state.appOpacity = num('app-opacity-range', state.appOpacity);
  state.sidebarOpacity = num('sidebar-opacity-range', state.sidebarOpacity);
  state.activityOpacity = num('activity-opacity-range', state.activityOpacity);
  state.editorSurfaceOpacity = num('editor-surface-opacity-range', state.editorSurfaceOpacity);
  state.terminalOpacity = num('terminal-opacity-range', state.terminalOpacity);
  state.bgImageUrl = document.getElementById('bg-image-url')?.value ?? state.bgImageUrl;
  state.bgImageOpacity = num('bg-image-opacity-range', state.bgImageOpacity);
}

export function wireAppearanceControls() {
  const bindColor = (id, key) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      state[key] = el.value;
      applyBackgroundCustomization();
      saveAllConfig();
    });
  };
  const bindRange = (id, key, valueId) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      state[key] = parseFloat(el.value);
      pctLabel(document.getElementById(valueId), state[key]);
      applyBackgroundCustomization();
      saveAllConfig();
    });
  };

  bindColor('app-bg-color', 'appBg');
  bindColor('sidebar-bg-color', 'sidebarBg');
  bindColor('editor-bg-color', 'editorBg');
  bindColor('panel-bg-color', 'panelBg');
  bindRange('app-opacity-range', 'appOpacity', 'app-opacity-value');
  bindRange('sidebar-opacity-range', 'sidebarOpacity', 'sidebar-opacity-value');
  bindRange('activity-opacity-range', 'activityOpacity', 'activity-opacity-value');
  bindRange('editor-surface-opacity-range', 'editorSurfaceOpacity', 'editor-surface-opacity-value');
  bindRange('terminal-opacity-range', 'terminalOpacity', 'terminal-opacity-value');
  bindRange('bg-image-opacity-range', 'bgImageOpacity', 'bg-image-opacity-value');

  const bgUrl = document.getElementById('bg-image-url');
  if (bgUrl) {
    bgUrl.addEventListener('change', () => {
      state.bgImageUrl = bgUrl.value;
      applyBackgroundCustomization();
      saveAllConfig();
    });
  }
}

export function getAppearanceConfigSlice() {
  return {
    appBg: state.appBg,
    sidebarBg: state.sidebarBg,
    editorBg: state.editorBg,
    panelBg: state.panelBg,
    appOpacity: state.appOpacity,
    sidebarOpacity: state.sidebarOpacity,
    activityOpacity: state.activityOpacity,
    editorSurfaceOpacity: state.editorSurfaceOpacity,
    terminalOpacity: state.terminalOpacity,
    bgImageUrl: state.bgImageUrl,
    bgImageOpacity: state.bgImageOpacity
  };
}
