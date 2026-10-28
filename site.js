const root = document.documentElement;
const REPO = 'ArduRadioKot/ForgeeCodeIDE';

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
  menuButton.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
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
tabs.forEach((t, i) => t.addEventListener('click', () => {
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
if (os && dlMain) {
  document.getElementById('dl-label').textContent = 'Скачать для ' + names[os];
  dlMain.querySelector('use').setAttribute('href', '#i-' + os);
}
if (dlMain) {
  const pick = {
    mac: [/arm64.*\.dmg$/i, /\.dmg$/i, /mac.*\.zip$/i],
    win: [/setup.*\.exe$/i, /\.exe$/i, /win.*\.zip$/i],
    linux: [/\.AppImage$/i, /\.deb$/i],
  };
  fetch(`https://api.github.com/repos/${REPO}/releases/latest`).then((r) => (r.ok ? r.json() : Promise.reject())).then((rel) => {
    const assets = rel.assets || [];
    document.getElementById('dl-ver').textContent = `Бесплатно. Версия ${String(rel.tag_name || '').replace(/^v/, '')}, сборки лежат на странице релизов GitHub.`;
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
const catalog = document.querySelector('[data-catalog]');
if (catalog) {
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const plural = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many);
  fetch('extensions/index.json').then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status)))).then((data) => {
    const list = data.extensions || [];
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
      if (x.plugins) tags.append(el('li', null, `${x.plugins} ${plural(x.plugins, 'плагин', 'плагина', 'плагинов')}`));
      if (x.themes) tags.append(el('li', null, `${x.themes} ${plural(x.themes, 'тема', 'темы', 'тем')}`));
      if (x.snippets) tags.append(el('li', null, `${x.snippets} ${plural(x.snippets, 'набор сниппетов', 'набора сниппетов', 'наборов сниппетов')}`));
      const actions = el('div', 'ext-actions');
      if (x.files?.includes('plugin.js')) {
        const download = el('a', 'button button-primary', 'Скачать плагин');
        download.href = `extensions/${x.path}plugin.js`;
        download.download = `${x.name}.js`;
        actions.append(download);
      }
      const src = el('a', 'button button-secondary', 'Исходники');
      src.href = /^https:\/\/github\.com\//.test(x.repository || '') ? `${x.repository}/tree/main/extensions/${encodeURIComponent(x.name)}` : `extensions/${x.path}README.md`;
      actions.append(src);
      card.append(head, el('p', 'ext-desc', x.description), tags, actions);
      catalog.append(card);
    }
    if (!list.length) catalog.append(el('p', 'ext-empty', 'В каталоге пока пусто.'));
    const count = document.querySelector('[data-catalog-count]');
    if (count) count.textContent = `${list.length} ${plural(list.length, 'расширение', 'расширения', 'расширений')}, обновлено ${new Date(data.updated).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}`;
  }).catch(() => {
    catalog.replaceChildren(el('p', 'ext-empty', 'Каталог не загрузился. Обновите страницу.'));
  });
}
