/** Liquid Glass wiring: preset / quality / sliders, native theme sync and attaching the lens substrate. */
import { state } from './state.js';
import { saveAllConfig } from './save-hook.js';

const DIALOG_LENS = { refraction: 0.4, displacement: 16, edgeWidth: 14, blur: 16, opacity: 0.1, highlight: 0.2, dispersion: 0.04, specular: 0.35 };
const $ = (id) => document.getElementById(id);

export const defaultGlassPreset = () => (/Mac|Win/i.test(navigator.platform) ? 'regular' : 'off');

export function applyGlass() {
  const root = document.documentElement;
  const lg = window.LiquidGlass;
  const preset = state.glassPreset;
  root.dataset.liquidGlass = preset;
  root.style.setProperty('--sg-opacity', '0.78');
  if (!lg) return;
  if (preset === 'off') {
    lg.detachAll('[data-glass]');
    syncGlassControls();
    return;
  }
  // Presets first, then the two user sliders on top (sliders always win).
  lg.configure({ reset: true, preset, quality: state.glassQuality }, { persist: false });
  const overrides = {};
  const tint = state.activeTheme?.colors?.['window-bg'];
  if (tint && /^#[0-9a-f]{6}$/i.test(tint)) overrides.tint = tint;
  if (typeof state.glassOpacity === 'number') overrides.opacity = state.glassOpacity;
  if (typeof state.glassBlur === 'number') overrides.blur = state.glassBlur;
  if (Object.keys(overrides).length) lg.configure({ overrides }, { persist: false });
  // One shared substrate for the whole window (nothing of the page is behind it, so no refraction);
  // dialogs get a light lens.
  lg.attachAll('[data-glass="substrate"]', { interactive: false, overrides: { refraction: 0 } });
  lg.attachAll('[data-glass="dialog"]', { interactive: false, overrides: DIALOG_LENS });
  syncGlassControls();
}

/** Floating surfaces created later (palette) join the glass when it is on. */
export function attachGlassTo(element) {
  if (!element || state.glassPreset === 'off' || !window.LiquidGlass) return;
  window.LiquidGlass.attach(element, { interactive: false, overrides: DIALOG_LENS });
}

export function syncGlassControls() {
  const lg = window.LiquidGlass;
  const preset = $('lg-preset');
  if (preset) preset.value = state.glassPreset;
  const quality = $('lg-quality');
  if (quality) quality.value = state.glassQuality;
  const cfg = lg && state.glassPreset !== 'off' ? lg.getState().config : null;
  const density = $('lg-density');
  const blur = $('lg-blur');
  const off = state.glassPreset === 'off';
  [density, blur, quality].forEach((el) => { if (el) el.disabled = off; });
  if (cfg && density) {
    density.value = typeof state.glassOpacity === 'number' ? state.glassOpacity : cfg.opacity;
    $('lg-density-value').textContent = Math.round(Number(density.value) * 100) + '%';
  }
  if (cfg && blur) {
    blur.value = typeof state.glassBlur === 'number' ? state.glassBlur : cfg.blur;
    $('lg-blur-value').textContent = Math.round(Number(blur.value)) + 'px';
  }
}

export function toggleGlass() {
  state.glassPreset = state.glassPreset === 'off' ? (defaultGlassPreset() === 'off' ? 'regular' : defaultGlassPreset()) : 'off';
  state.glassOpacity = null;
  state.glassBlur = null;
  applyGlass();
  saveAllConfig();
}

export function setupGlass() {
  $('lg-preset')?.addEventListener('change', (e) => {
    state.glassPreset = e.target.value;
    state.glassOpacity = null; // a new preset starts from its own look
    state.glassBlur = null;
    applyGlass();
    saveAllConfig();
  });
  $('lg-quality')?.addEventListener('change', (e) => {
    state.glassQuality = e.target.value;
    applyGlass();
    saveAllConfig();
  });
  $('lg-density')?.addEventListener('input', (e) => {
    state.glassOpacity = Number(e.target.value);
    $('lg-density-value').textContent = Math.round(state.glassOpacity * 100) + '%';
    window.LiquidGlass?.configure({ overrides: { opacity: state.glassOpacity } }, { persist: false });
    saveAllConfig();
  });
  $('lg-blur')?.addEventListener('input', (e) => {
    state.glassBlur = Number(e.target.value);
    $('lg-blur-value').textContent = state.glassBlur + 'px';
    window.LiquidGlass?.configure({ overrides: { blur: state.glassBlur } }, { persist: false });
    saveAllConfig();
  });
}
