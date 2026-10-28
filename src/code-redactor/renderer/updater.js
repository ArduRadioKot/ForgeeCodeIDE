/** GitHub Releases update UI, modeled on the FgSNotes update flow. */
import { state } from './state.js';
import { t, onLangChange } from './i18n.js';

const RELEASE_PAGE = 'https://github.com/ArduRadioKot/ForgeeCodeIDE/releases/latest';
const CHECK_GAP = 12 * 60 * 60 * 1000;
const CHECKED_KEY = 'frogee.updates.checked';
const DISMISSED_KEY = 'frogee.updates.dismissed';
const PROMPT_KEY = 'frogee.updates.prompted';

let release = null;
let checking = false;
let installing = false;
let startupPromptShown = false;

const get = (id) => document.getElementById(id);
const store = (key, value) => { try { localStorage.setItem(key, value); } catch { /* storage disabled */ } };
const saved = (key) => { try { return localStorage.getItem(key); } catch { return null; } };

function setStatus(value) { const element = get('about-update-status'); if (element) element.textContent = value; }
function setNotes(value) {
  const element = get('about-update-notes');
  if (!element) return;
  element.textContent = value || '';
  element.hidden = !value;
}
function setBanner(value) {
  const banner = get('update-banner');
  if (!banner) return;
  if (value) get('update-banner-text').textContent = value;
  banner.hidden = !value;
}
function sizeLabel(bytes) {
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
}

function showUpdateModal(force = false) {
  const modal = get('modal-update');
  if (!modal || !release?.ok || !release.available) return;
  // "Later" / dismiss always wins, even on startup
  if (saved(DISMISSED_KEY) === release.latest) return;
  if (!force && saved(PROMPT_KEY) === release.latest && startupPromptShown) return;
  const body = get('update-modal-body');
  if (body) body.textContent = t('update.modalBody', { v: release.latest });
  const notes = get('update-modal-notes');
  const notesLabel = get('update-modal-notes-label');
  if (notes) {
    notes.textContent = release.notes || '';
    notes.hidden = !release.notes;
    if (notesLabel) notesLabel.hidden = !release.notes;
  }
  const now = get('update-modal-now');
  if (now) {
    const downloadable = release.packaged && release.asset;
    const installable = downloadable && release.installMode !== 'manual' && release.installMode !== 'browser';
    now.textContent = installable ? t('about.downloadInstall') : downloadable ? t('about.downloadPackage') : t('about.openRelease');
  }
  modal.hidden = false;
  modal.style.display = 'flex';
  store(PROMPT_KEY, release.latest);
  startupPromptShown = true;
}

function hideUpdateModal() {
  const modal = get('modal-update');
  if (!modal) return;
  modal.style.display = 'none';
  modal.hidden = true;
}

export function openAbout() {
  const modal = get('modal-settings');
  if (modal) modal.style.display = 'flex';
  document.querySelector('[data-settings-tab="about"]')?.click();
}

function paintRelease({ showModal = false } = {}) {
  if (!release?.ok) return;
  const button = get('about-update-button');
  const action = get('update-banner-action');
  if (!release.available) {
    setStatus(t('about.upToDate'));
    setNotes('');
    setBanner('');
    if (button) button.textContent = t('about.check');
    return;
  }
  const size = release.asset?.size ? ` · ${sizeLabel(release.asset.size)}` : '';
  setStatus(t('about.available', { v: release.latest }) + size);
  setNotes(release.notes);
  const downloadable = release.packaged && release.asset;
  const installable = downloadable && release.installMode !== 'manual' && release.installMode !== 'browser';
  if (button) button.textContent = installable ? t('about.downloadInstall') : downloadable ? t('about.downloadPackage') : t('about.openRelease');
  if (action) action.textContent = installable ? t('about.update') : t('about.download');
  if (saved(DISMISSED_KEY) !== release.latest) setBanner(t('about.available', { v: release.latest }));
  if (showModal) showUpdateModal(true);
}

export async function checkForUpdates({ showModal = false } = {}) {
  if (checking || installing) return;
  checking = true;
  const button = get('about-update-button');
  if (button) button.disabled = true;
  setStatus(t('about.checking'));
  try {
    release = await window.electronAPI.checkUpdates();
    if (!release?.ok) {
      setStatus(release?.error || t('about.checkFailed'));
      setNotes('');
      return;
    }
    store(CHECKED_KEY, String(Date.now()));
    paintRelease({ showModal: showModal && release.available });
  } catch (error) {
    setStatus(error?.message || t('about.checkFailed'));
  } finally {
    checking = false;
    if (button) button.disabled = false;
  }
}

async function startUpdate() {
  if (!release?.ok || !release.available || installing) return;
  hideUpdateModal();
  if (!release.packaged || !release.asset) {
    await window.electronAPI.openExternal(release.url || RELEASE_PAGE);
    return;
  }
  installing = true;
  const button = get('about-update-button');
  const action = get('update-banner-action');
  if (button) button.disabled = true;
  if (action) action.disabled = true;
  const off = window.electronAPI.onUpdateProgress((progress) => {
    const pct = progress.total ? Math.min(100, Math.round(progress.received / progress.total * 100)) : null;
    const label = pct != null ? t('about.downloadingPct', { p: pct }) : t('about.downloading');
    setStatus(label);
    setBanner(`${label} · ${release.latest}`);
  });
  try {
    setStatus(t('about.downloading'));
    const downloaded = await window.electronAPI.downloadUpdate();
    if (!downloaded?.ok) { setStatus(downloaded?.error || t('about.checkFailed')); return; }
    const dirty = state.currentTabs.filter((tab) => tab?.modified);
    if (dirty.length && release.installMode !== 'manual') {
      setStatus(t('about.saveFirst', { n: dirty.length }));
      setBanner(t('about.downloadedSave'));
      return;
    }
    setStatus(t('about.installing'));
    setBanner(t('about.installing'));
    const installed = await window.electronAPI.installUpdate();
    if (!installed?.ok) setStatus(installed?.error || t('about.checkFailed'));
    else if (installed.mode === 'manual') { setStatus(installed.message); setBanner(''); }
  } catch (error) {
    setStatus(error?.message || t('about.checkFailed'));
  } finally {
    off?.();
    installing = false;
    if (button) button.disabled = false;
    if (action) action.disabled = false;
  }
}

export function setupUpdater() {
  const api = window.electronAPI;
  if (!api?.checkUpdates) return;
  api.currentVersion().then((info) => {
    const version = get('about-version');
    if (version) version.textContent = t('about.version', { v: info.version });
    const last = Number(saved(CHECKED_KEY) || 0);
    // Startup: check and show a popup when an update is found
    if (info.packaged && (!last || Date.now() - last >= CHECK_GAP)) {
      setTimeout(() => checkForUpdates({ showModal: true }), 2500);
    } else if (info.packaged) {
      // Still refresh quietly; popup only if not dismissed for this version
      setTimeout(() => checkForUpdates({ showModal: true }), 5000);
    }
  }).catch(() => {});

  get('about-update-button')?.addEventListener('click', () => release?.ok && release.available ? startUpdate() : checkForUpdates());
  get('about-release-button')?.addEventListener('click', () => api.openExternal(RELEASE_PAGE));
  get('update-banner-action')?.addEventListener('click', startUpdate);
  get('update-banner-details')?.addEventListener('click', openAbout);
  get('update-banner-close')?.addEventListener('click', () => {
    setBanner('');
    if (release?.latest) store(DISMISSED_KEY, release.latest);
  });
  get('update-modal-now')?.addEventListener('click', startUpdate);
  get('update-modal-later')?.addEventListener('click', () => {
    hideUpdateModal();
    if (release?.latest) store(DISMISSED_KEY, release.latest);
  });
  get('update-modal-close')?.addEventListener('click', () => {
    hideUpdateModal();
    if (release?.latest) store(DISMISSED_KEY, release.latest);
  });
  get('modal-update')?.addEventListener('click', (e) => {
    if (e.target === get('modal-update')) {
      hideUpdateModal();
      if (release?.latest) store(DISMISSED_KEY, release.latest);
    }
  });
  onLangChange(() => {
    if (release?.ok) paintRelease();
    const version = get('about-version');
    api.currentVersion().then((info) => {
      if (version) version.textContent = t('about.version', { v: info.version });
    }).catch(() => {});
  });
}
