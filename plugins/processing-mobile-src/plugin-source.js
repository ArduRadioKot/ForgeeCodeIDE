
// ── FrogeeCodeIDE integration ──
(function processingMobilePlugin() {
  const api = frogee;
  const bridge = window.electronAPI;
  const devices = {
    pixel: { label: 'Pixel 8', size: '393 × 851', width: 393, height: 851, dpr: 2.75 },
    galaxy: { label: 'Galaxy S', size: '360 × 800', width: 360, height: 800, dpr: 3 },
    small: { label: 'Компактный', size: '360 × 640', width: 360, height: 640, dpr: 2 },
    tablet: { label: 'Планшет', size: '800 × 1280', width: 800, height: 1280, dpr: 2 },
  };
  // Screen orientation values, as in android.content.pm.ActivityInfo (and the emulator / exported PApplet)
  const LANDSCAPE_MODES = new Set([0, 6, 8, 11]);
  const PORTRAIT_MODES = new Set([1, 7, 9, 12]);

  let panel = null;
  let frame = null;
  let running = false;
  let landscape = false;
  let lock = null; // 'portrait' | 'landscape' when the sketch or the project fixes the orientation
  let lockSource = '';
  let projectRoot = '';
  let currentSettings = null;
  let stageObserver = null;
  const buildSessionId = `processing-mobile-${Math.random().toString(36).slice(2)}`;
  let buildOutputTail = '';

  const I = (d, extra = '') => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${d}</svg>`;
  const ICON = {
    play: I('<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/>'),
    stop: I('<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>'),
    restart: I('<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4.5v4h4"/>'),
    rotate: I('<rect x="4" y="9" width="11" height="11" rx="2"/><path d="M13 3.5a7 7 0 0 1 7 7M20 6.5v4h-4"/>'),
    settings: I('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
    close: I('<path d="M6 6l12 12M18 6 6 18"/>'),
    back: I('<path d="M15 5l-7 7 7 7"/>'),
    shake: I('<rect x="8" y="4" width="8" height="16" rx="2"/><path d="M4 9v6M20 9v6M2 11v2M22 11v2"/>'),
    android: I('<path d="M6 10h12v7a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2zM6 10a6 6 0 0 1 12 0M8.5 5 7 3M15.5 5 17 3"/><circle cx="9.5" cy="7.5" r=".6" fill="currentColor"/><circle cx="14.5" cy="7.5" r=".6" fill="currentColor"/>'),
    build: I('<path d="M14.5 6.5l3 3M4 20l7.5-7.5M13 4l7 7-3 3-7-7z"/>'),
    phone: I('<rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M11 18.5h2"/>'),
    clear: I('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>'),
  };
  const STRIPE_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6.5" y="2.5" width="11" height="19" rx="2.4"/><path d="M10.5 18.5h3"/><path d="M10 8.5l-1.6 1.8L10 12M14 8.5l1.6 1.8L14 12"/></svg>';

  api.addStyle(`
    .pm-panel{position:fixed;z-index:9500;right:12px;top:52px;bottom:12px;width:var(--pm-w,440px);min-width:340px;max-width:calc(100vw - 80px);display:flex;flex-direction:column;color:var(--text-color);background:var(--card-bg);border:1px solid var(--border-color);border-radius:var(--radius-lg,12px);box-shadow:0 18px 50px var(--shadow-color,#0006);overflow:hidden;font-size:12.5px}
    .pm-panel[hidden]{display:none}
    .pm-resize{position:absolute;left:0;top:0;bottom:0;width:6px;cursor:ew-resize;z-index:3}
    .pm-resize:hover{background:color-mix(in srgb,var(--accent-color) 30%,transparent)}
    .pm-row{display:flex;align-items:center;gap:6px;padding:8px 10px}
    .pm-head{border-bottom:1px solid var(--border-color);padding:8px 8px 8px 14px}
    .pm-title{font-weight:600;font-size:13px;white-space:nowrap}
    .pm-file{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-muted);font-size:12px}
    .pm-spacer{flex:1}
    .pm-panel button,.pm-panel select,.pm-panel input{font:inherit;color:inherit}
    .pm-btn{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border:1px solid var(--border-color);border-radius:var(--radius-md,8px);background:transparent;cursor:pointer;white-space:nowrap}
    .pm-btn:hover:not(:disabled){background:var(--hover-color)}
    .pm-btn:disabled{opacity:.45;cursor:default}
    .pm-btn.pm-primary{background:var(--accent-color);border-color:var(--accent-color);color:var(--accent-text,#fff);font-weight:600}
    .pm-btn.pm-primary:hover:not(:disabled){background:color-mix(in srgb,var(--accent-color) 86%,#fff)}
    .pm-icon{width:28px;padding:0;justify-content:center;border-color:transparent}
    .pm-icon.pm-on{background:var(--active-bg,var(--hover-color));border-color:var(--border-color)}
    .pm-select{height:28px;padding:0 8px;border:1px solid var(--border-color);border-radius:var(--radius-md,8px);background:var(--code-bg,transparent);min-width:0;max-width:170px}
    .pm-stage{position:relative;flex:1;min-height:160px;display:grid;place-items:center;overflow:hidden;background:var(--editor-bg,var(--code-bg));border-block:1px solid var(--border-color);padding:18px}
    .pm-phone{position:relative;width:var(--pm-pw);height:var(--pm-ph);padding:var(--pm-bezel,8px);background:#0b0d10;border-radius:var(--pm-r,30px);box-shadow:0 0 0 1px #ffffff14 inset,0 14px 34px #0007;box-sizing:border-box;transition:width .25s ease,height .25s ease}
    .pm-phone::after{content:'';position:absolute;width:7px;height:7px;border-radius:50%;background:#1d2128;top:calc(var(--pm-bezel,8px) + 6px);left:calc(50% - 3.5px)}
    .pm-phone[data-orientation="landscape"]::after{top:calc(50% - 3.5px);left:calc(var(--pm-bezel,8px) + 6px)}
    .pm-screen{width:100%;height:100%;border-radius:calc(var(--pm-r,30px) - var(--pm-bezel,8px));overflow:hidden;background:#000}
    .pm-screen iframe{display:block;width:100%;height:100%;border:0;background:#000}
    .pm-empty{position:absolute;inset:auto 16px 14px;text-align:center;color:var(--text-muted);font-size:12px;pointer-events:none}
    .pm-lock{position:absolute;top:10px;left:50%;transform:translateX(-50%);padding:3px 10px;border-radius:999px;background:var(--card-bg);border:1px solid var(--border-color);color:var(--text-muted);font-size:11px;white-space:nowrap}
    .pm-lock[hidden],.pm-empty[hidden]{display:none}
    .pm-hw{padding-bottom:2px}
    .pm-tilts{border-bottom:1px solid var(--border-color);gap:12px}
    .pm-tilt-name{color:var(--text-muted)}
    .pm-tilt{flex:1;min-width:0;display:flex;align-items:center;gap:6px;color:var(--text-muted)}
    .pm-tilt input[type=range]{flex:1;min-width:40px;accent-color:var(--accent-color)}
    .pm-tilt output{min-width:30px;color:var(--text-color);font-variant-numeric:tabular-nums}
    .pm-section-title{padding:10px 12px 0;color:var(--text-muted);font-size:11px}
    .pm-android{flex-wrap:wrap}
    .pm-settings{display:grid;grid-template-columns:1fr 1fr;gap:8px 10px;padding:4px 12px 12px;border-bottom:1px solid var(--border-color)}
    .pm-settings[hidden]{display:none}
    .pm-settings label{display:flex;flex-direction:column;gap:4px;color:var(--text-muted);font-size:11.5px}
    .pm-settings input:not([type=checkbox]),.pm-settings select{height:28px;padding:0 8px;border:1px solid var(--border-color);border-radius:var(--radius-md,8px);background:var(--code-bg,transparent);color:var(--text-color)}
    .pm-settings input:focus,.pm-select:focus{outline:none;border-color:var(--accent-color)}
    .pm-settings .pm-wide{grid-column:1/-1}
    .pm-settings .pm-check{flex-direction:row;align-items:center;gap:8px;color:var(--text-color)}
    .pm-perms{display:flex;flex-wrap:wrap;gap:4px 12px}
    .pm-perms label{flex-direction:row;align-items:center;gap:6px;color:var(--text-color)}
    .pm-foot{display:flex;flex-direction:column;min-height:0}
    .pm-status{display:flex;align-items:center;gap:8px;padding:6px 8px 6px 12px;border-top:1px solid var(--border-color);color:var(--text-muted)}
    .pm-status span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .pm-status[data-kind="error"] span{color:var(--danger-color,#e5484d)}
    .pm-status[data-kind="ok"] span{color:var(--success-color,#30a46c)}
    .pm-dot{width:7px;height:7px;border-radius:50%;background:var(--text-faint,#888);flex:none}
    .pm-status[data-run="1"] .pm-dot{background:var(--success-color,#30a46c)}
    .pm-console{height:110px;min-height:44px;max-height:50vh;resize:vertical;overflow:auto;background:var(--code-bg);padding:6px 12px 8px;font:11.5px/1.5 var(--mono-font,ui-monospace,monospace);white-space:pre-wrap;color:var(--text-color)}
    .pm-console:empty::before{content:'Вывод println() и сборки появится здесь';color:var(--text-faint)}
    .pm-console .error{color:var(--danger-color,#e5484d)}
    .pm-console .warn{color:var(--warning-color,#d6a100)}
    .pm-console .meta{color:var(--text-muted)}
  `);

  const basename = (p) => String(p || '').split(/[\\/]/).pop();
  const dirname = (p) => String(p || '').replace(/[\\/][^\\/]*$/, '');
  const $ = (sel) => panel?.querySelector(sel);

  const log = (message, level = '') => {
    const out = $('.pm-console');
    if (!out) return;
    const text = String(message);
    if (!text) return;
    const line = document.createElement('div');
    line.textContent = text;
    if (level) line.className = level;
    out.append(line);
    while (out.childNodes.length > 400) out.firstChild.remove();
    out.scrollTop = out.scrollHeight;
  };
  let holdUntil = 0; // an error or a result stays visible for a while: the FPS counter does not overwrite it
  const status = (text, kind = '', { passive = false } = {}) => {
    const el = $('.pm-status');
    if (!el) return;
    if (passive && Date.now() < holdUntil) return;
    if (!passive && kind) holdUntil = Date.now() + 4000;
    el.querySelector('span').textContent = text;
    el.dataset.kind = kind;
    el.dataset.run = running ? '1' : '';
  };
  const post = (data) => frame?.contentWindow?.postMessage({ source: 'frogee-device-host', ...data }, '*');
  const device = () => devices[$('[data-field="device"]')?.value] || devices.pixel;
  const screenSize = () => { const d = device(); return landscape ? { width: d.height, height: d.width } : { width: d.width, height: d.height }; };

  function mount() {
    if (panel) { panel.hidden = false; updateFileLabel(); fitPhone(); return; }
    panel = document.createElement('section');
    panel.className = 'pm-panel';
    panel.setAttribute('aria-label', 'Processing Mobile');
    const savedWidth = Number(api.storage.get('width', 0));
    if (savedWidth >= 340) panel.style.setProperty('--pm-w', `${savedWidth}px`);
    panel.innerHTML = `
      <div class="pm-resize" title="Потяните, чтобы изменить ширину"></div>
      <div class="pm-row pm-head">
        <span class="pm-title">Processing Mobile</span><span class="pm-file"></span><span class="pm-spacer"></span>
        <button type="button" class="pm-btn pm-icon" data-action="settings" title="Настройки Android-проекта" aria-pressed="false">${ICON.settings}</button>
        <button type="button" class="pm-btn pm-icon" data-action="close" title="Закрыть панель">${ICON.close}</button>
      </div>
      <div class="pm-row">
        <button type="button" class="pm-btn pm-primary" data-action="run" title="Запустить скетч в эмуляторе">${ICON.play}<span>Запустить</span></button>
        <button type="button" class="pm-btn pm-icon" data-action="stop" title="Остановить" disabled>${ICON.stop}</button>
        <span class="pm-spacer"></span>
        <select class="pm-select" data-field="device" aria-label="Устройство">${Object.entries(devices).map(([id, d]) => `<option value="${id}">${d.label} · ${d.size}</option>`).join('')}</select>
        <button type="button" class="pm-btn pm-icon" data-action="rotate" title="Повернуть устройство">${ICON.rotate}</button>
      </div>
      <div class="pm-stage">
        <div class="pm-lock" hidden></div>
        <div class="pm-phone" data-orientation="portrait"><div class="pm-screen"><iframe title="Эмулятор Processing" sandbox="allow-scripts"></iframe></div></div>
        <div class="pm-empty">Откройте файл .pde и нажмите «Запустить»</div>
      </div>
      <div class="pm-row pm-hw">
        <button type="button" class="pm-btn" data-action="back" title="Кнопка «Назад» Android" disabled>${ICON.back}<span>Назад</span></button>
        <button type="button" class="pm-btn" data-action="shake" title="Встряхнуть устройство" disabled>${ICON.shake}<span>Встряхнуть</span></button>
      </div>
      <div class="pm-row pm-tilts">
        <span class="pm-tilt-name">Наклон</span>
        <label class="pm-tilt" title="Наклон влево-вправо (акселерометр X, м/с²)">X <input type="range" min="-9.8" max="9.8" step="0.1" value="0" data-sensor="x"><output data-out="x">0.0</output></label>
        <label class="pm-tilt" title="Наклон вперёд-назад (акселерометр Y, м/с²)">Y <input type="range" min="-9.8" max="9.8" step="0.1" value="0" data-sensor="y"><output data-out="y">0.0</output></label>
        <button type="button" class="pm-btn pm-icon" data-action="level" title="Положить ровно">${ICON.restart}</button>
      </div>
      <div class="pm-settings" hidden>
        <label>Имя приложения<input data-field="app-name" spellcheck="false"></label>
        <label>Package name<input data-field="package" spellcheck="false" placeholder="com.example.sketch"></label>
        <label>Min SDK<input data-field="min-sdk" type="number" min="21" max="36"></label>
        <label>Target SDK<input data-field="target-sdk" type="number" min="21" max="36"></label>
        <label class="pm-wide">Ориентация приложения<select data-field="orientation">${ORIENTATIONS.map((o) => `<option value="${o.id}">${o.label}</option>`).join('')}</select></label>
        <div class="pm-wide"><div style="color:var(--text-muted);font-size:11.5px;margin-bottom:4px">Разрешения</div><div class="pm-perms">${PERMISSIONS.map((p) => `<label><input type="checkbox" data-perm="${p.id}">${p.label}</label>`).join('')}</div></div>
        <label class="pm-check pm-wide"><input data-field="adaptive" type="checkbox"> Adaptive UI: подгонять интерфейс под экран</label>
        <div class="pm-wide" style="display:flex;gap:6px;justify-content:flex-end"><button type="button" class="pm-btn" data-action="settings">Отмена</button><button type="button" class="pm-btn pm-primary" data-action="save-settings">Сохранить</button></div>
      </div>
      <div class="pm-section-title">Android</div>
      <div class="pm-row pm-android">
        <button type="button" class="pm-btn" data-action="export" title="Создать или обновить папку android/ рядом со скетчем">${ICON.android}<span>Экспорт проекта</span></button>
        <button type="button" class="pm-btn" data-action="build" title="Gradle assembleDebug">${ICON.build}<span>Собрать APK</span></button>
        <button type="button" class="pm-btn" data-action="device-run" title="Собрать, установить через adb и запустить">${ICON.phone}<span>На телефоне</span></button>
      </div>
      <div class="pm-foot">
        <div class="pm-status" role="status"><i class="pm-dot"></i><span>Готово</span><button type="button" class="pm-btn pm-icon" data-action="clear-log" title="Очистить консоль">${ICON.clear}</button></div>
        <div class="pm-console" role="log" aria-label="Консоль скетча"></div>
      </div>`;
    document.body.append(panel);
    frame = panel.querySelector('iframe');
    panel.addEventListener('click', onClick);
    panel.addEventListener('change', (event) => { if (event.target.matches('[data-field="device"]')) onDeviceChange(); });
    panel.addEventListener('input', (event) => { if (event.target.matches('[data-sensor]')) sendSensors(); });
    setupResize(panel.querySelector('.pm-resize'));
    stageObserver = new ResizeObserver(() => fitPhone());
    stageObserver.observe(panel.querySelector('.pm-stage'));
    updateFileLabel();
    fitPhone();
  }

  function setupResize(handle) {
    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      const startX = event.clientX;
      const startW = panel.getBoundingClientRect().width;
      const move = (e) => panel.style.setProperty('--pm-w', `${Math.max(340, Math.min(window.innerWidth - 80, startW + startX - e.clientX))}px`);
      const up = () => {
        handle.removeEventListener('pointermove', move);
        api.storage.set('width', Math.round(panel.getBoundingClientRect().width));
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up, { once: true });
    });
  }

  function updateFileLabel() {
    const file = api.editor.file();
    const el = $('.pm-file');
    if (el) el.textContent = file && /\.pde$/i.test(file.name) ? file.name : '';
  }

  /** Fits the phone frame into the stage, keeping the screen's aspect ratio. */
  function fitPhone() {
    if (!panel) return;
    const stage = $('.pm-stage');
    const phone = $('.pm-phone');
    const { width, height } = screenSize();
    const availW = Math.max(120, stage.clientWidth - 36);
    const availH = Math.max(120, stage.clientHeight - 36);
    const bezel = 8;
    const scale = Math.min(1, (availW - bezel * 2) / width, (availH - bezel * 2) / height);
    phone.style.setProperty('--pm-pw', `${Math.round(width * scale + bezel * 2)}px`);
    phone.style.setProperty('--pm-ph', `${Math.round(height * scale + bezel * 2)}px`);
    phone.style.setProperty('--pm-r', `${Math.round(Math.max(14, 34 * Math.min(1, scale * 1.15)))}px`);
    phone.dataset.orientation = landscape ? 'landscape' : 'portrait';
    $('[data-action="rotate"]')?.classList.toggle('pm-on', landscape);
  }

  function showLock() {
    const el = $('.pm-lock');
    if (!el) return;
    el.hidden = !lock;
    el.textContent = lock ? `${lock === 'landscape' ? 'Альбомная' : 'Портретная'} ориентация зафиксирована ${lockSource}` : '';
  }

  /** Turns the device. A running sketch keeps running and gets the new screen size, as on a phone. */
  function setLandscape(value) {
    if (landscape === value) { fitPhone(); return; }
    landscape = value;
    fitPhone();
    if (running) {
      const { width, height } = screenSize();
      post({ type: 'rotate', width, height, rotation: landscape ? 1 : 0, orientation: landscape ? 'landscape' : 'portrait' });
      status(`Экран ${width} × ${height}`);
    }
  }

  function onDeviceChange() {
    fitPhone();
    if (running) runSketch().catch(report); // another screen size: start over on the new device
  }

  async function getSketch() {
    const active = api.editor.file();
    const selectedPath = active?.path && /\.pde$/i.test(active.name) ? active.path : null;
    const root = active?.path ? dirname(active.path) : null;
    if (!root) throw new Error('Откройте сохранённый файл .pde из папки скетча');
    const listing = await bridge.listFiles(root);
    if (!listing?.success) throw new Error(listing?.error || 'Не удалось прочитать папку скетча');
    const pdeFiles = listing.files.filter((file) => !file.isDirectory && /\.pde$/i.test(file.name));
    if (!pdeFiles.length) throw new Error('В папке нет файлов .pde. Откройте файл скетча Processing');
    const settings = await loadProject(root);
    const configured = settings?.sketch;
    const main = pdeFiles.find((file) => file.path === selectedPath)
      || pdeFiles.find((file) => file.name === configured)
      || pdeFiles.find((file) => file.name.toLowerCase() === `${basename(root).toLowerCase()}.pde`)
      || pdeFiles[0];
    const sources = [];
    for (const file of [main, ...pdeFiles.filter((item) => item.path !== main.path).sort((a, b) => a.name.localeCompare(b.name))]) {
      const result = await bridge.getFileContent(file.path);
      if (!result?.success) throw new Error(result?.error || `Не удалось прочитать ${file.name}`);
      sources.push({ name: file.name, path: file.path, code: file.path === selectedPath ? api.editor.get() : result.content });
    }
    projectRoot = root;
    currentSettings = { ...defaultSettingsFor(main.name), ...(settings || {}) };
    currentSettings.sketch = main.name;
    return { root, sources, settings: currentSettings };
  }

  async function dataFiles(root) {
    const out = {};
    const listed = await bridge.listFiles(joinPath(root, 'data'));
    if (!listed?.success) return out;
    for (const file of listed.files) {
      if (file.isDirectory) continue;
      const result = await bridge.getFileContent(file.path);
      if (result?.success) out[file.name] = result.content;
    }
    return out;
  }

  function frameHtml(code, options) {
    const runtime = createProcessingRuntime.toString();
    const source = JSON.stringify(`${code}\n//# sourceURL=sketch.pde\n`).replace(/<\//g, '<\\/');
    const opts = JSON.stringify(options).replace(/<\//g, '<\\/');
    return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden;background:#000}</style></head><body><script>window.__frogee=(${runtime})(${opts});window.__frogee.install();</script><script>try{(0,eval)(${source})}catch(e){window.__frogee.__report(e)}</script><script>window.__frogee.start();</script></body></html>`;
  }

  function setRunning(value) {
    running = value;
    for (const action of ['stop', 'back', 'shake']) { const b = $(`[data-action="${action}"]`); if (b) b.disabled = !value; }
    const run = $('[data-action="run"]');
    if (run) run.innerHTML = value ? `${ICON.restart}<span>Перезапустить</span>` : `${ICON.play}<span>Запустить</span>`;
    const empty = $('.pm-empty');
    if (empty) empty.hidden = value;
    const st = $('.pm-status');
    if (st) st.dataset.run = value ? '1' : '';
  }

  async function runSketch() {
    mount();
    const { root, sources, settings } = await getSketch();
    const code = sources.map((source) => transpileProcessing(source.code).code).join('\n');
    if (!code.trim()) throw new Error('Скетч пуст');
    // the orientation fixed in the project's manifest applies before the sketch starts
    lock = settings.orientation === 'portrait' || settings.orientation === 'landscape' ? settings.orientation : null;
    lockSource = lock ? 'в настройках проекта' : '';
    if (lock) { landscape = lock === 'landscape'; fitPhone(); }
    showLock();
    const d = device();
    const { width, height } = screenSize();
    const options = { width, height, dpr: d.dpr, baseDir: root, packageName: settings.packageName, dataFiles: await dataFiles(root), showTouches: true };
    $('.pm-console').replaceChildren();
    buildOutputTail = '';
    frame.srcdoc = frameHtml(code, options);
    setRunning(true);
    status(`${sources[0].name} · ${d.label} · ${width} × ${height}`);
    if (sources.length > 1) log(`Вкладки: ${sources.map((source) => source.name).join(', ')}`, 'meta');
    sendSensors();
  }

  function stopSketch() {
    if (!running) return;
    post({ type: 'stop' });
    frame.srcdoc = '<!doctype html><html><body style="background:#000"></body></html>';
    setRunning(false);
    status('Скетч остановлен');
  }

  function sendSensors() {
    if (!panel) return;
    const value = (axis) => Number($(`[data-sensor="${axis}"]`).value) || 0;
    const x = value('x');
    const y = value('y');
    for (const axis of ['x', 'y']) $(`[data-out="${axis}"]`).textContent = value(axis).toFixed(1);
    // the device lies flat by default: whatever does not go into the tilt stays on Z
    const z = Math.sqrt(Math.max(0, 9.81 * 9.81 - x * x - y * y));
    post({ type: 'sensor', x, y, z: Number(z.toFixed(2)), orientation: landscape ? 'landscape' : 'portrait' });
  }

  async function exportProject() {
    const { root, sources, settings } = await getSketch();
    if (!isValidPackageName(settings.packageName)) throw new Error('Некорректное package name: откройте настройки (шестерёнка) и задайте вида com.example.app');
    const existing = await bridge.listFiles(joinPath(root, 'android'));
    if (existing?.success && !window.confirm('Папка android уже есть. Обновить сгенерированные файлы?')) return null;
    status('Экспорт Android-проекта…');
    const result = await exportAndroidProject({ root, sketchSource: sources, sketchName: sources[0].name, settings,
      runtime: { pApplet: PAPPLET_JAVA, pVector: PVECTOR_JAVA, pFont: PFONT_JAVA, json: JSONOBJECT_JAVA, adaptiveUi: ADAPTIVE_UI_JAVA } });
    if (!result.ok) throw new Error(result.error || 'Ошибка экспорта Android');
    status(`Android-проект обновлён: ${result.path}`, 'ok');
    log(`Экспортирован ${result.path}`, 'meta');
    return result.path;
  }

  const quote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;
  function gradleCommand(runOnDevice, pkg) {
    if (/^Win/i.test(navigator.platform)) {
      const build = 'if (Test-Path gradle\\wrapper\\gradle-wrapper.jar) { .\\gradlew.bat assembleDebug } elseif (Get-Command gradle -ErrorAction SilentlyContinue) { gradle assembleDebug } else { Write-Error "Gradle не найден"; exit 1 }';
      return runOnDevice ? `${build}; if ($LASTEXITCODE -eq 0) { adb install -r app\\build\\outputs\\apk\\debug\\app-debug.apk; adb shell am start -n ${pkg}/.MainActivity }` : build;
    }
    const gradle = 'if [ -f gradle/wrapper/gradle-wrapper.jar ]; then sh ./gradlew assembleDebug; elif command -v gradle >/dev/null 2>&1; then gradle assembleDebug; elif [ -x "$HOME/Documents/ProcessingStudio/toolchain/gradle/bin/gradle" ]; then "$HOME/Documents/ProcessingStudio/toolchain/gradle/bin/gradle" assembleDebug; else echo "Gradle не найден: установите Gradle или Android Studio" >&2; false; fi';
    const env = 'if [ -z "$ANDROID_HOME" ]; then for sdk in "$HOME/Library/Android/sdk" "$HOME/Documents/Processing/android/sdk" "$HOME/Documents/ProcessingStudio/toolchain/android-sdk"; do if [ -d "$sdk/platforms" ]; then export ANDROID_HOME="$sdk"; break; fi; done; fi; if [ -n "$ANDROID_HOME" ]; then export PATH="$ANDROID_HOME/platform-tools:$PATH"; fi; if [ -z "$JAVA_HOME" ] && [ -x /usr/libexec/java_home ]; then export JAVA_HOME="$(/usr/libexec/java_home -v 17 2>/dev/null)"; fi';
    return runOnDevice ? `${env}; ${gradle} && adb install -r app/build/outputs/apk/debug/app-debug.apk && adb shell am start -n ${quote(pkg + '/.MainActivity')}` : `${env}; ${gradle}`;
  }

  async function build(runOnDevice) {
    const androidDir = await exportProject();
    if (!androidDir) return;
    const activeTerminal = document.querySelector('#terminal-tab-list .terminal-tab.active')?.dataset.id;
    const started = await bridge.terminalStart({ id: buildSessionId, cwd: androidDir, cols: 100, rows: 24 });
    if (!started?.success) throw new Error(started?.error || 'Не удалось открыть терминал сборки');
    if (activeTerminal) await bridge.terminalActive(activeTerminal);
    $('.pm-console').replaceChildren();
    const command = gradleCommand(runOnDevice, currentSettings.packageName);
    const done = /^Win/i.test(navigator.platform) ? '; Write-Output "__PM_DONE_$LASTEXITCODE"' : '; printf "__PM_DONE_%s\\n" "$?"';
    const sent = await bridge.terminalWrite(`${command}${done}\r`, buildSessionId);
    if (!sent?.success) throw new Error(sent?.error || 'Не удалось запустить Gradle');
    status(runOnDevice ? 'Сборка и установка на телефон…' : 'Сборка APK…');
  }

  function fillSettings() {
    if (!currentSettings || !panel) return;
    const values = { 'app-name': currentSettings.name, package: currentSettings.packageName, 'min-sdk': currentSettings.minSdk, 'target-sdk': currentSettings.targetSdk, orientation: currentSettings.orientation || 'unspecified' };
    for (const [key, value] of Object.entries(values)) $(`[data-field="${key}"]`).value = value;
    $('[data-field="adaptive"]').checked = currentSettings.adaptiveUi !== false;
    const perms = new Set(currentSettings.permissions || []);
    panel.querySelectorAll('[data-perm]').forEach((box) => { box.checked = perms.has(box.dataset.perm); });
  }

  async function toggleSettings() {
    const box = $('.pm-settings');
    const opening = box.hidden;
    if (opening) { await getSketch(); fillSettings(); }
    box.hidden = !opening;
    $('.pm-head [data-action="settings"]').setAttribute('aria-pressed', String(opening));
    $('.pm-head [data-action="settings"]').classList.toggle('pm-on', opening);
  }

  async function saveSettings() {
    await getSketch();
    const field = (name) => $(`[data-field="${name}"]`).value.trim();
    const next = { ...currentSettings, name: field('app-name') || 'Sketch', packageName: field('package'),
      minSdk: Number(field('min-sdk')), targetSdk: Number(field('target-sdk')), orientation: field('orientation'),
      permissions: [...panel.querySelectorAll('[data-perm]:checked')].map((box) => box.dataset.perm),
      adaptiveUi: $('[data-field="adaptive"]').checked };
    if (!isValidPackageName(next.packageName)) throw new Error('Package name должен выглядеть как com.example.app');
    if (!Number.isInteger(next.minSdk) || !Number.isInteger(next.targetSdk) || next.minSdk < 21 || next.targetSdk < next.minSdk) throw new Error('Проверьте Min SDK и Target SDK: Min SDK не меньше 21 и не больше Target SDK');
    if (!await saveProject(projectRoot, next)) throw new Error('Не удалось записать processing-studio.json');
    currentSettings = next;
    $('.pm-settings').hidden = true;
    $('.pm-head [data-action="settings"]').classList.remove('pm-on');
    status('Настройки проекта сохранены', 'ok');
  }

  function report(error) {
    const message = error?.message || String(error);
    status(message, 'error');
    log(message, 'error');
  }

  async function onClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled) return;
    try {
      switch (button.dataset.action) {
        case 'close': stopSketch(); panel.hidden = true; break;
        case 'run': await runSketch(); break;
        case 'stop': stopSketch(); break;
        case 'rotate':
          if (lock) {
            status(`Поворот недоступен: ориентация зафиксирована ${lockSource}`, 'error');
            break;
          }
          setLandscape(!landscape);
          break;
        case 'back': post({ type: 'back' }); break;
        case 'level': panel.querySelectorAll('[data-sensor]').forEach((input) => { input.value = '0'; }); sendSensors(); break;
        case 'shake': post({ type: 'sensor', shake: true }); break;
        case 'clear-log': $('.pm-console').replaceChildren(); break;
        case 'export': await exportProject(); break;
        case 'build': await build(false); break;
        case 'device-run': await build(true); break;
        case 'settings': await toggleSettings(); break;
        case 'save-settings': await saveSettings(); break;
      }
    } catch (error) {
      report(error);
    }
  }

  function onMessage(event) {
    if (!frame || event.source !== frame.contentWindow || event.data?.source !== 'frogee-device') return;
    const data = event.data;
    if (data.type === 'log') log(data.text, data.level === 'error' ? 'error' : data.level === 'warn' ? 'warn' : '');
    else if (data.type === 'error') { log(data.message || 'Ошибка скетча', 'error'); setRunning(false); status(`Ошибка: ${data.message}`, 'error'); }
    else if (data.type === 'fps') status(`${$('.pm-file')?.textContent || 'Скетч'} · ${screenSize().width} × ${screenSize().height} · ${data.fps} FPS`, '', { passive: true });
    else if (data.type === 'finish' || data.type === 'stopped') { setRunning(false); status('Скетч завершён'); }
    else if (data.type === 'permission-request') {
      const granted = window.confirm(`Скетч просит доступ: ${data.permission}. Разрешить?`);
      post({ type: 'permission-result', permission: data.permission, granted });
    } else if (data.type === 'save-data' && projectRoot && /^[^\\/]+$/.test(data.name || '')) {
      bridge.writeFile(joinPath(projectRoot, `data/${data.name}`), data.data ?? '');
    } else if (data.type === 'save' && data.url) {
      const link = document.createElement('a'); link.href = data.url; link.download = data.name || 'sketch.png'; link.click();
    } else if (data.type === 'orientation') {
      // orientation(PORTRAIT / LANDSCAPE) in the sketch: values of ActivityInfo
      const mode = Number(data.mode);
      lock = LANDSCAPE_MODES.has(mode) ? 'landscape' : PORTRAIT_MODES.has(mode) ? 'portrait' : null;
      lockSource = lock ? 'скетчем' : '';
      showLock();
      if (lock) setLandscape(lock === 'landscape');
    }
  }

  window.addEventListener('message', onMessage);
  const offTerminalData = bridge.onTerminalData?.(({ id, data }) => {
    if (id !== buildSessionId) return;
    const plain = String(data || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r(?!\n)/g, '');
    buildOutputTail = (buildOutputTail + plain).slice(-160);
    const done = /__PM_DONE_(\d+)/.exec(buildOutputTail);
    if (done) {
      buildOutputTail = '';
      if (Number(done[1]) === 0) status('Сборка завершена', 'ok');
      else status(`Сборка завершилась с ошибкой (код ${done[1]}), подробности в консоли`, 'error');
    }
    for (const line of plain.replace(/__PM_DONE_\d+/, '').split('\n')) {
      const text = line.trimEnd();
      if (text) log(text, /\b(error|FAILED|ошибк)/i.test(text) ? 'error' : /\bwarning\b/i.test(text) ? 'warn' : '');
    }
  });
  const offTerminalExit = bridge.onTerminalExit?.(({ id, code }) => {
    if (id === buildSessionId) status(`Терминал сборки закрыт (${code})`);
  });
  api.onTabChange(() => updateFileLabel());
  api.addButton({ title: 'Processing Mobile', icon: STRIPE_ICON, run: () => mount() });
  api.onUnload(() => {
    stopSketch();
    stageObserver?.disconnect();
    panel?.remove();
    panel = null;
    frame = null;
    window.removeEventListener('message', onMessage);
    offTerminalData?.();
    offTerminalExit?.();
    bridge.terminalKill?.(buildSessionId);
  });
})();
