const root = document.documentElement;
const REPO = 'ArduRadioKot/ForgeeCodeIDE';
const I18n = window.FrogeeI18n;

// theme: dark by default, the choice is remembered
document.getElementById('theme').addEventListener('click', () => {
  root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light';
  try { localStorage.setItem('frogee-theme', root.dataset.theme); } catch (e) { /* private mode */ }
});

// header: compact after scrolling; mobile menu
const header = document.querySelector('[data-header]');
const onScroll = () => header.classList.toggle('is-scrolled', scrollY > 12);
onScroll();
addEventListener('scroll', onScroll, { passive: true });
const menuButton = document.querySelector('[data-menu-toggle]');
const menu = document.querySelector('[data-mobile-menu]');
function setMenu(open) {
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? I18n.t('nav.closeMenu') : I18n.t('nav.openMenu'));
  menu.classList.toggle('is-open', open);
  menu.setAttribute('aria-hidden', String(!open));
  menu.inert = !open;
  document.body.classList.toggle('menu-open', open);
}
menuButton.addEventListener('click', () => setMenu(menuButton.getAttribute('aria-expanded') !== 'true'));
menu.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
addEventListener('resize', () => { if (innerWidth > 1100) setMenu(false); });

// tour tabs
const tabs = [...document.querySelectorAll('.tabs [role=tab]')];
const panels = [...document.querySelectorAll('.panel')];
tabs.forEach((tab, i) => tab.addEventListener('click', () => {
  tabs.forEach((x, j) => x.setAttribute('aria-selected', String(i === j)));
  panels.forEach((p, j) => { p.hidden = i !== j; });
}));

// blocks appear once as they scroll into view
const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
  entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
}, { rootMargin: '0px 0px -8% 0px' }) : null;
document.querySelectorAll('.reveal').forEach((el) => (io ? io.observe(el) : el.classList.add('is-in')));

// the visitor's system and direct links to the latest GitHub release
const ua = navigator.userAgent;
const os = /Mac/.test(ua) ? 'mac' : /Win/.test(ua) ? 'win' : /Linux|X11/.test(ua) ? 'linux' : '';
const names = { mac: 'macOS', win: 'Windows', linux: 'Linux' };
const dlMain = document.getElementById('dl-main');
const dlLabel = document.getElementById('dl-label');
let latestVersion = '';

function refreshDownloadLabel() {
  if (!dlLabel) return;
  if (os) {
    dlLabel.textContent = I18n.t('hero.downloadFor', { os: names[os] });
    if (dlMain) dlMain.querySelector('use')?.setAttribute('href', '#i-' + os);
  } else {
    dlLabel.textContent = I18n.t('hero.download');
  }
}

function refreshVersionLine() {
  const el = document.getElementById('dl-ver');
  if (!el) return;
  el.textContent = latestVersion
    ? I18n.t('dl.verReady', { v: latestVersion })
    : I18n.t('dl.ver');
}

refreshDownloadLabel();

if (dlMain) {
  const pick = {
    mac: [/arm64.*\.dmg$/i, /\.dmg$/i, /mac.*\.zip$/i],
    win: [/setup.*\.exe$/i, /\.exe$/i, /win.*\.zip$/i],
    linux: [/\.AppImage$/i, /\.deb$/i],
  };
  fetch(`https://api.github.com/repos/${REPO}/releases/latest`).then((r) => (r.ok ? r.json() : Promise.reject())).then((rel) => {
    const assets = rel.assets || [];
    latestVersion = String(rel.tag_name || '').replace(/^v/, '');
    refreshVersionLine();
    for (const k of Object.keys(pick)) {
      const a = pick[k].map((re) => assets.find((x) => re.test(x.name))).find(Boolean);
      const link = document.querySelector(`.dl[data-os=${k}] .button`);
      if (a && link) link.href = a.browser_download_url;
      if (a && k === os) dlMain.href = a.browser_download_url;
    }
  }).catch(() => { /* no release yet: the buttons open the releases page */ });
}

document.querySelectorAll('[data-year]').forEach((e) => { e.textContent = new Date().getFullYear(); });

// Extensions catalog: extensions/index.json, built by scripts/build-extensions.js. [data-limit] shows only the first few.
let catalogData = null;
const catalog = document.querySelector('[data-catalog]');

function renderCatalog() {
  if (!catalog) return;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  if (!catalogData) {
    catalog.replaceChildren(el('p', 'ext-empty', I18n.t('ext.loading')));
    return;
  }
  const list = catalogData.extensions || [];
  const limit = Number(catalog.dataset.limit) || list.length;
  const featured = catalog.dataset.featured;
  const shown = featured
    ? [...list].sort((a, b) => Number(b.id === featured) - Number(a.id === featured))
    : list;
  catalog.replaceChildren();
  for (const x of shown.slice(0, limit)) {
    const card = el('article', 'info-card ext-card');
    const head = el('div', 'ext-head');
    const icon = el('img', 'ext-icon');
    icon.src = x.icon ? `extensions/${x.path}${x.icon}` : 'img/icon.png'; icon.alt = ''; icon.width = 56; icon.height = 56; icon.loading = 'lazy';
    const title = el('div');
    title.append(el('h3', null, x.displayName), el('p', 'ext-meta', `${x.version} · ${x.publisher}`));
    head.append(icon, title);
    const tags = el('ul', 'ext-tags');
    if (x.plugins) tags.append(el('li', null, `${x.plugins} ${I18n.plural(x.plugins, 'ext.plugin.one', 'ext.plugin.few', 'ext.plugin.many')}`));
    if (x.themes) tags.append(el('li', null, `${x.themes} ${I18n.plural(x.themes, 'ext.theme.one', 'ext.theme.few', 'ext.theme.many')}`));
    if (x.snippets) tags.append(el('li', null, `${x.snippets} ${I18n.plural(x.snippets, 'ext.snip.one', 'ext.snip.few', 'ext.snip.many')}`));
    const actions = el('div', 'ext-actions');
    if (x.files?.includes('plugin.js')) {
      const download = el('a', 'button button-primary', I18n.t('ext.downloadPlugin'));
      download.href = `extensions/${x.path}plugin.js`;
      download.download = `${x.name}.js`;
      actions.append(download);
    }
    const src = el('a', 'button button-secondary', I18n.t('ext.source'));
    src.href = /^https:\/\/github\.com\//.test(x.repository || '') ? `${x.repository}/tree/main/extensions/${encodeURIComponent(x.name)}` : `extensions/${x.path}README.md`;
    actions.append(src);
    card.append(head, el('p', 'ext-desc', x.description), tags, actions);
    catalog.append(card);
  }
  if (!list.length) catalog.append(el('p', 'ext-empty', I18n.t('ext.empty')));
  const count = document.querySelector('[data-catalog-count]');
  if (count) {
    const locale = I18n.getLang() === 'en' ? 'en-US' : 'ru-RU';
    const date = new Date(catalogData.updated).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
    count.textContent = I18n.t('ext.count', {
      n: list.length,
      word: I18n.plural(list.length, 'ext.word.one', 'ext.word.few', 'ext.word.many'),
      date,
    });
  }
}

if (catalog) {
  fetch('extensions/index.json').then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status)))).then((data) => {
    catalogData = data;
    renderCatalog();
  }).catch(() => {
    const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    catalog.replaceChildren(el('p', 'ext-empty', I18n.t('ext.loadFail')));
  });
}

I18n.onChange(() => {
  refreshDownloadLabel();
  refreshVersionLine();
  if (catalogData) renderCatalog();
  else if (catalog && !catalog.querySelector('.ext-card')) {
    const empty = catalog.querySelector('.ext-empty');
    if (empty) empty.textContent = I18n.t('ext.loading');
  }
  // Keep menu aria in sync if open
  const open = menuButton.getAttribute('aria-expanded') === 'true';
  menuButton.setAttribute('aria-label', open ? I18n.t('nav.closeMenu') : I18n.t('nav.openMenu'));
});
