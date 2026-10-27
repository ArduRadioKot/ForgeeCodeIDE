
// ── FrogeeCodeIDE integration ──
(function processingMobilePlugin() {
  const api = frogee;
  const bridge = window.electronAPI;
  const devices = {
    pixel: { label: 'Pixel · 393 × 851', width: 393, height: 851, dpr: 2.75 },
    galaxy: { label: 'Galaxy · 360 × 800', width: 360, height: 800, dpr: 3 },
    iphone: { label: 'iPhone · 390 × 844', width: 390, height: 844, dpr: 3 },
    tablet: { label: 'Планшет · 744 × 1133', width: 744, height: 1133, dpr: 2 },
  };
  let panel = null;
  let frame = null;
  let running = false;
  let landscape = false;
  let projectRoot = '';
  let currentSettings = null;
  const buildSessionId = `processing-mobile-${Math.random().toString(36).slice(2)}`;
  let buildOutputTail = '';

  api.addStyle(`
    .pm-panel{position:fixed;z-index:9500;right:16px;top:58px;bottom:16px;width:430px;min-width:340px;max-width:calc(100vw - 32px);display:flex;flex-direction:column;color:var(--text-color,#e9edf5);background:var(--panel-bg,#1b1f28);border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:14px;box-shadow:0 18px 60px #0008;overflow:hidden;font:13px/1.4 system-ui,sans-serif}
    .pm-panel[hidden]{display:none}.pm-head,.pm-toolbar,.pm-build{display:flex;align-items:center;gap:7px;padding:10px 12px;border-bottom:1px solid #ffffff18}.pm-head strong{font-size:14px}.pm-spacer{flex:1}.pm-panel button,.pm-panel select,.pm-panel input{font:inherit}.pm-panel button{color:inherit;background:#ffffff12;border:1px solid #ffffff22;border-radius:7px;padding:6px 9px;cursor:pointer}.pm-panel button:hover{background:#ffffff22}.pm-panel button.pm-primary{background:var(--accent-color,#3574f0);color:#fff;border-color:transparent}.pm-panel select,.pm-panel input{color:inherit;background:#111722;border:1px solid #ffffff30;border-radius:6px;padding:5px;min-width:0}.pm-panel select{flex:1}.pm-panel .pm-close{font-size:18px;line-height:1;padding:4px 9px}.pm-stage{flex:1;min-height:120px;display:grid;place-items:center;overflow:auto;background:radial-gradient(circle at 50% 20%,#343b49,#171a22 70%);padding:16px}.pm-phone{position:relative;width:var(--pm-width);height:var(--pm-height);max-width:100%;max-height:100%;background:#050608;border:8px solid #090b10;border-radius:32px;box-shadow:0 15px 36px #0009;overflow:hidden;box-sizing:border-box}.pm-phone:before{content:'';position:absolute;z-index:2;top:5px;left:calc(50% - 25px);width:50px;height:7px;background:#10131a;border-radius:8px;pointer-events:none}.pm-phone iframe{width:100%;height:100%;border:0;background:#000}.pm-status{padding:5px 12px;color:#b6c4d7;border-top:1px solid #ffffff18;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pm-console{height:100px;min-height:40px;resize:vertical;overflow:auto;background:#0d121b;color:#c5d5ec;padding:8px 12px;font:11px/1.45 ui-monospace,monospace;white-space:pre-wrap}.pm-console .error{color:#ff8a8a}.pm-console .warn{color:#f2cf80}.pm-settings{padding:8px 12px;border-top:1px solid #ffffff18;display:grid;grid-template-columns:1fr 1fr;gap:8px}.pm-settings[hidden]{display:none}.pm-settings label{display:flex;flex-direction:column;gap:3px}.pm-settings .pm-wide{grid-column:1/-1}.pm-settings .pm-inline{flex-direction:row;align-items:center}.pm-toolbar{flex-wrap:wrap}.pm-build{flex-wrap:wrap}.pm-sensors{display:flex;align-items:center;gap:6px;padding:6px 12px}.pm-sensors input{width:55px}
  `);

  const basename = (path) => String(path || '').split(/[\\/]/).pop();
  const dirname = (path) => String(path || '').replace(/[\\/][^\\/]*$/, '');
  const log = (message, level = '') => {
    if (!panel) return;
    const line = document.createElement('div');
    line.textContent = String(message);
    if (level) line.className = level;
    const consoleEl = panel.querySelector('.pm-console');
    consoleEl.append(line);
    while (consoleEl.childNodes.length > 150) consoleEl.firstChild.remove();
    consoleEl.scrollTop = consoleEl.scrollHeight;
  };
  const status = (text) => { if (panel) panel.querySelector('.pm-status').textContent = text; };
  const post = (data) => frame?.contentWindow?.postMessage({ source: 'frogee-device-host', ...data }, '*');

  function mount() {
    if (panel) { panel.hidden = false; return; }
    panel = document.createElement('section');
    panel.className = 'pm-panel';
    panel.setAttribute('aria-label', 'Processing Mobile');
    panel.innerHTML = `
      <div class="pm-head"><strong>Processing Mobile</strong><span class="pm-spacer"></span><button type="button" data-action="settings" title="Настройки Android">⚙</button><button type="button" class="pm-close" data-action="close" title="Закрыть">×</button></div>
      <div class="pm-toolbar"><select data-field="device" aria-label="Устройство">${Object.entries(devices).map(([id,d]) => `<option value="${id}">${d.label}</option>`).join('')}</select><button type="button" data-action="rotate" title="Повернуть">↻</button><button type="button" class="pm-primary" data-action="run">▶ Скетч</button><button type="button" data-action="stop">■</button></div>
      <div class="pm-stage"><div class="pm-phone"><iframe title="Эмулятор Processing" sandbox="allow-scripts"></iframe></div></div>
      <div class="pm-sensors">Акселерометр <label>X <input data-sensor="x" type="number" step="0.1" value="0"></label><label>Y <input data-sensor="y" type="number" step="0.1" value="0"></label><label>Z <input data-sensor="z" type="number" step="0.1" value="9.81"></label></div>
      <div class="pm-build"><button type="button" data-action="export">Экспорт Android</button><button type="button" data-action="build">Собрать APK</button><button type="button" data-action="device-run">На телефоне</button></div>
      <div class="pm-settings" hidden><label>Имя приложения<input data-field="app-name"></label><label>Package name<input data-field="package" spellcheck="false"></label><label>Min SDK<input data-field="min-sdk" type="number" min="21" max="36"></label><label>Target SDK<input data-field="target-sdk" type="number" min="21" max="36"></label><label class="pm-inline pm-wide"><input data-field="adaptive" type="checkbox"> Adaptive UI</label><button type="button" class="pm-wide" data-action="save-settings">Сохранить настройки проекта</button></div>
      <div class="pm-status" role="status">Откройте .pde и запустите скетч</div><div class="pm-console" role="log" aria-label="Консоль скетча"></div>`;
    document.body.append(panel);
    frame = panel.querySelector('iframe');
    panel.addEventListener('click', onClick);
    panel.addEventListener('change', (event) => {
      if (event.target.matches('[data-field="device"]')) applyDevice();
      if (event.target.matches('[data-sensor]')) sendSensors();
    });
    applyDevice();
  }

  function applyDevice() {
    if (!panel) return;
    const d = devices[panel.querySelector('[data-field="device"]').value] || devices.pixel;
    const stage = panel.querySelector('.pm-stage');
    const availableHeight = Math.max(180, stage.clientHeight - 32);
    const width = landscape ? d.height : d.width;
    const height = landscape ? d.width : d.height;
    const scale = Math.min(1, (stage.clientWidth - 32) / width, availableHeight / height);
    const phone = panel.querySelector('.pm-phone');
    phone.style.setProperty('--pm-width', `${Math.round(width * scale)}px`);
    phone.style.setProperty('--pm-height', `${Math.round(height * scale)}px`);
    if (running) post({ type: 'sensor', orientation: landscape ? 'landscape' : 'portrait', rotation: landscape ? 90 : 0 });
  }

  async function getSketch() {
    const active = api.editor.file();
    const selectedPath = active?.path && /\.pde$/i.test(active.name) ? active.path : null;
    const root = active?.path ? dirname(active.path) : null;
    if (!root) throw new Error('Откройте папку проекта или сохранённый файл .pde');
    const listing = await bridge.listFiles(root);
    if (!listing?.success) throw new Error(listing?.error || 'Не удалось прочитать папку проекта');
    const pdeFiles = listing.files.filter((file) => !file.isDirectory && /\.pde$/i.test(file.name));
    if (!pdeFiles.length) throw new Error('В папке проекта нет файлов .pde');
    const settings = await loadProject(root);
    const configured = settings?.sketch;
    const main = pdeFiles.find((file) => file.path === selectedPath)
      || pdeFiles.find((file) => file.name === configured)
      || pdeFiles.find((file) => file.name.toLowerCase() === `${basename(root).toLowerCase()}.pde`)
      || pdeFiles[0];
    const sources = [];
    for (const file of [main, ...pdeFiles.filter((item) => item.path !== main.path).sort((a,b) => a.name.localeCompare(b.name))]) {
      const result = await bridge.getFileContent(file.path);
      if (!result?.success) throw new Error(result?.error || `Не удалось прочитать ${file.name}`);
      sources.push({ name: file.name, path: file.path, code: file.path === selectedPath ? api.editor.get() : result.content });
    }
    projectRoot = root;
    currentSettings = settings || defaultSettingsFor(main.name);
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

  async function runSketch() {
    mount();
    const { root, sources, settings } = await getSketch();
    const code = sources.map((source) => transpileProcessing(source.code).code).join('\n');
    if (!code.trim()) throw new Error('Скетч пуст');
    const d = devices[panel.querySelector('[data-field="device"]').value] || devices.pixel;
    const options = { width: landscape ? d.height : d.width, height: landscape ? d.width : d.height,
      dpr: d.dpr, baseDir: root, packageName: settings.packageName, dataFiles: await dataFiles(root), showTouches: true };
    panel.querySelector('.pm-console').replaceChildren();
    buildOutputTail = '';
    frame.srcdoc = frameHtml(code, options);
    running = true;
    status(`Запущен ${sources[0].name} · ${options.width} × ${options.height}`);
    log(`Вкладки: ${sources.map((source) => source.name).join(', ')}`);
    sendSensors();
  }

  function stopSketch() {
    if (!running) return;
    post({ type: 'stop' });
    frame.srcdoc = '<!doctype html><html><body style="background:#000"></body></html>';
    running = false;
    status('Скетч остановлен');
  }

  function sendSensors() {
    if (!panel) return;
    const value = (axis) => Number(panel.querySelector(`[data-sensor="${axis}"]`).value) || 0;
    post({ type: 'sensor', x: value('x'), y: value('y'), z: value('z'), orientation: landscape ? 'landscape' : 'portrait' });
  }

  async function exportProject() {
    const { root, sources, settings } = await getSketch();
    if (!isValidPackageName(settings.packageName)) throw new Error('Некорректное package name в processing-studio.json');
    const existing = await bridge.listFiles(joinPath(root, 'android'));
    if (existing?.success && !window.confirm('Папка android уже существует. Обновить сгенерированные файлы?')) return null;
    const result = await exportAndroidProject({ root, sketchSource: sources, sketchName: sources[0].name, settings,
      runtime: { pApplet: PAPPLET_JAVA, pVector: PVECTOR_JAVA, pFont: PFONT_JAVA, json: JSONOBJECT_JAVA, adaptiveUi: ADAPTIVE_UI_JAVA } });
    if (!result.ok) throw new Error(result.error || 'Ошибка экспорта Android');
    status(`Android-проект: ${result.path}`);
    log(`Экспортирован ${result.path}`);
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
    panel.querySelector('.pm-console').replaceChildren();
    const command = gradleCommand(runOnDevice, currentSettings.packageName);
    const done = /^Win/i.test(navigator.platform)
      ? '; Write-Output "__PM_DONE_$LASTEXITCODE"'
      : '; printf "__PM_DONE_%s\\n" "$?"';
    const sent = await bridge.terminalWrite(`${command}${done}\r`, buildSessionId);
    if (!sent?.success) throw new Error(sent?.error || 'Не удалось запустить Gradle');
    status(runOnDevice ? 'Сборка и запуск на Android идут в консоли' : 'Сборка APK идёт в консоли');
  }

  function fillSettings() {
    if (!currentSettings || !panel) return;
    for (const [key, value] of Object.entries({ 'app-name': currentSettings.name, package: currentSettings.packageName, 'min-sdk': currentSettings.minSdk, 'target-sdk': currentSettings.targetSdk })) {
      panel.querySelector(`[data-field="${key}"]`).value = value;
    }
    panel.querySelector('[data-field="adaptive"]').checked = currentSettings.adaptiveUi !== false;
  }

  async function saveSettings() {
    await getSketch();
    const field = (name) => panel.querySelector(`[data-field="${name}"]`).value.trim();
    const next = { ...currentSettings, name: field('app-name') || 'Sketch', packageName: field('package'),
      minSdk: Number(field('min-sdk')), targetSdk: Number(field('target-sdk')),
      adaptiveUi: panel.querySelector('[data-field="adaptive"]').checked };
    if (!isValidPackageName(next.packageName)) throw new Error('Package name должен выглядеть как com.example.app');
    if (!Number.isInteger(next.minSdk) || !Number.isInteger(next.targetSdk) || next.minSdk < 21 || next.targetSdk < next.minSdk) throw new Error('Проверьте значения minSdk и targetSdk');
    if (!await saveProject(projectRoot, next)) throw new Error('Не удалось записать processing-studio.json');
    currentSettings = next;
    status('Настройки проекта сохранены');
  }

  async function onClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    try {
      switch (button.dataset.action) {
        case 'close': stopSketch(); panel.hidden = true; break;
        case 'run': await runSketch(); break;
        case 'stop': stopSketch(); break;
        case 'rotate': landscape = !landscape; applyDevice(); if (running) await runSketch(); break;
        case 'export': await exportProject(); break;
        case 'build': await build(false); break;
        case 'device-run': await build(true); break;
        case 'settings':
          await getSketch();
          fillSettings();
          panel.querySelector('.pm-settings').hidden = !panel.querySelector('.pm-settings').hidden;
          break;
        case 'save-settings': await saveSettings(); break;
      }
    } catch (error) {
      const message = error?.message || String(error);
      status(message);
      log(message, 'error');
      api.notify(message);
    }
  }

  function onMessage(event) {
    if (!frame || event.source !== frame.contentWindow || event.data?.source !== 'frogee-device') return;
    const data = event.data;
    if (data.type === 'log') log(data.text, data.level === 'error' ? 'error' : '');
    else if (data.type === 'error') { log(data.message || 'Ошибка скетча', 'error'); status(`Ошибка: ${data.message}`); running = false; }
    else if (data.type === 'fps') status(`Скетч запущен · ${data.fps} FPS`);
    else if (data.type === 'finish' || data.type === 'stopped') { running = false; status('Скетч завершён'); }
    else if (data.type === 'permission-request') {
      const granted = window.confirm(`Разрешить доступ к ${data.permission}?`);
      post({ type: 'permission-result', permission: data.permission, granted });
    } else if (data.type === 'save-data' && projectRoot && /^[^\\/]+$/.test(data.name || '')) {
      bridge.writeFile(joinPath(projectRoot, `data/${data.name}`), data.data ?? '');
    } else if (data.type === 'save' && data.url) {
      const link = document.createElement('a'); link.href = data.url; link.download = data.name || 'sketch.png'; link.click();
    } else if (data.type === 'orientation') {
      landscape = data.mode === 0 || data.mode === 8;
      applyDevice();
    }
  }

  window.addEventListener('message', onMessage);
  const offTerminalData = bridge.onTerminalData?.(({ id, data }) => {
    if (id !== buildSessionId) return;
    const plain = String(data || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
    buildOutputTail = (buildOutputTail + plain).slice(-160);
    const done = /__PM_DONE_(\d+)/.exec(buildOutputTail);
    if (done) status(Number(done[1]) === 0 ? 'Сборка завершена успешно' : `Сборка завершилась с ошибкой (${done[1]})`);
    log(plain.replace(/__PM_DONE_\d+/, '').trimEnd());
  });
  const offTerminalExit = bridge.onTerminalExit?.(({ id, code }) => {
    if (id === buildSessionId) status(`Терминал сборки завершён (${code})`);
  });
  const onResize = () => applyDevice();
  window.addEventListener('resize', onResize);
  api.addButton({ title: 'Processing Mobile', icon: 'code', run: () => mount() });
  api.onUnload(() => {
    stopSketch();
    panel?.remove();
    panel = null;
    frame = null;
    window.removeEventListener('message', onMessage);
    window.removeEventListener('resize', onResize);
    offTerminalData?.();
    offTerminalExit?.();
    bridge.terminalKill?.(buildSessionId);
  });
})();
