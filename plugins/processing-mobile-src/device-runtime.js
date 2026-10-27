/**
 * Runtime of the phone emulator: a compact engine compatible with Processing.
 *
 * The panel copies this function into the emulator frame with toString(), so the body must not
 * reference anything outside itself: no imports, no module-level helpers, no closures over
 * module variables. Everything lives inside.
 *
 * Supported: canvas, shapes, text, colors, matrices, math, PVector, ArrayList/HashMap,
 * mouse/touch/keyboard events, sensors (accelerometer, orientation, shake), println/console.
 */

export function createProcessingRuntime(options) {
  const opts = options || {};
  const TAG = 'frogee-device';
  const HOST = 'frogee-device-host';
  const W = window;

  const post = (msg) => {
    try { parent.postMessage(Object.assign({ source: TAG }, msg), '*'); } catch (err) { /* the frame is gone */ }
  };

  // ── State ────────────────────────────────────────────────────────────────────────────────
  const S = {
    w: opts.width || 390,
    h: opts.height || 844,
    dpr: opts.dpr || 2,
    sketchW: opts.width || 390,
    sketchH: opts.height || 844,
    fill: [255, 255, 255, 255],
    stroke: [0, 0, 0, 255],
    doFill: true,
    doStroke: true,
    weight: 1,
    rectMode: 0,    // CORNER
    ellipseMode: 3, // CENTER
    imageMode: 0,   // CORNER
    textSize: 12,
    textLeading: 0,
    font: 'sans-serif',
    alignH: 39,     // LEFT
    alignV: 0,      // BASELINE
    styleStack: [],
    loop: true,
    frame: 0,
    targetFps: 60,
    last: 0,
    delta: 0,
    started: Date.now(),
    mouseX: 0, mouseY: 0, pmouseX: 0, pmouseY: 0,
    mouseDown: false, mouseButton: 'LEFT',
    touches: [],
    key: '', keyCode: 0, keyDown: false,
    accelX: 0, accelY: 0, accelZ: 9.81,
    gyroX: 0, gyroY: 0, gyroZ: 0,
    magX: 0, magY: 0, magZ: 0,
    rotation: 0, orientation: 'portrait', heading: 0,
    lat: 0, lon: 0, alt: 0, accuracy: 0,
    permissions: Object.assign({}, opts.permissions || {}),
    orientationLock: 0,        // 0 — не зафиксирована
    keyboard: false,
    paused: false,
    light: 320,
    proximity: 8,
    dataFiles: Object.assign({}, opts.dataFiles || {}),
    images: new Map(),
    dead: false,
    showTouches: !!opts.showTouches,
    shape: null,
    shapeMode: 0,
    fpsFrames: 0,
    fpsSince: 0,
    fpsValue: 0,
  };

  const fail = (err) => {
    if (S.dead) return;
    S.dead = true;
    post({
      type: 'error',
      message: String((err && err.message) || err),
      stack: String((err && err.stack) || ''),
    });
  };

  // ── Canvas ───────────────────────────────────────────────────────────────────────────────
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.style.cssText = 'position:absolute;left:0;top:0;';
  document.documentElement.style.cssText = 'margin:0;padding:0;overflow:hidden;background:#000;';
  document.body.style.cssText = 'margin:0;padding:0;overflow:hidden;background:#000;';
  document.body.appendChild(canvas);

  const fitCanvas = () => {
    const vw = W.innerWidth || S.w;
    const vh = W.innerHeight || S.h;
    const k = Math.min(vw / S.sketchW, vh / S.sketchH);
    canvas.style.width = S.sketchW * k + 'px';
    canvas.style.height = S.sketchH * k + 'px';
    canvas.style.left = (vw - S.sketchW * k) / 2 + 'px';
    canvas.style.top = (vh - S.sketchH * k) / 2 + 'px';
  };

  const applySize = () => {
    canvas.width = Math.max(1, Math.round(S.sketchW * S.dpr));
    canvas.height = Math.max(1, Math.round(S.sketchH * S.dpr));
    ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    ctx.lineWidth = S.weight;
    fitCanvas();
  };

  const toSketch = (clientX, clientY) => {
    const r = canvas.getBoundingClientRect();
    const sx = S.sketchW / Math.max(1, r.width);
    const sy = S.sketchH / Math.max(1, r.height);
    return { x: (clientX - r.left) * sx, y: (clientY - r.top) * sy };
  };

  // ── Colors ───────────────────────────────────────────────────────────────────────────────
  const color = (...args) => {
    if (!args.length) return [0, 0, 0, 255];
    if (args.length === 1) {
      const v = args[0];
      if (Array.isArray(v)) return v.length === 4 ? v.slice() : [v[0], v[1], v[2], 255];
      if (typeof v === 'string') {
        const h = v.trim().replace('#', '');
        if (h.length === 3) return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16), 255];
        if (h.length === 6) return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 255];
        return [0, 0, 0, 255];
      }
      const n = Math.max(0, Math.min(255, Math.round(v)));
      return [n, n, n, 255];
    }
    if (args.length === 2) {
      const g = Math.max(0, Math.min(255, Math.round(args[0])));
      return [g, g, g, Math.round(args[1] <= 1 ? args[1] * 255 : args[1])];
    }
    if (args.length === 3) return [args[0] | 0, args[1] | 0, args[2] | 0, 255];
    return [args[0] | 0, args[1] | 0, args[2] | 0, Math.round(args[3] <= 1 ? args[3] * 255 : args[3])];
  };

  const css = (c) => {
    const v = color(c);
    return 'rgba(' + (v[0] | 0) + ',' + (v[1] | 0) + ',' + (v[2] | 0) + ',' + ((v[3] === undefined ? 255 : v[3]) / 255) + ')';
  };

  // ── Math / random ────────────────────────────────────────────────────────────────────────
  const rng = (seed) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  let randomGen = rng(1);
  const random = (a, b) => {
    if (a === undefined) return randomGen();
    if (b === undefined) return randomGen() * a;
    return a + randomGen() * (b - a);
  };
  const randomSeed = (s) => { randomGen = rng(s); };

  const perm = new Uint8Array(512);
  const buildPerm = (seed) => {
    const r = rng(seed >>> 0);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  };
  buildPerm(1);

  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + (b - a) * t;
  const grad3 = (h, x, y, z) => {
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  };

  const noise = (x, y, z) => {
    y = y || 0; z = z || 0;
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = fade(x), v = fade(y), w = fade(z);
    const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z;
    const B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
    return lerp(
      lerp(
        lerp(grad3(perm[AA] & 15, x, y, z), grad3(perm[BA] & 15, x - 1, y, z), u),
        lerp(grad3(perm[AB] & 15, x, y - 1, z), grad3(perm[BB] & 15, x - 1, y - 1, z), u), v),
      lerp(
        lerp(grad3(perm[AA + 1] & 15, x, y, z - 1), grad3(perm[BA + 1] & 15, x - 1, y, z - 1), u),
        lerp(grad3(perm[AB + 1] & 15, x, y - 1, z - 1), grad3(perm[BB + 1] & 15, x - 1, y - 1, z - 1), u), v), w);
  };
  const noiseSeed = (s) => buildPerm(s);

  const map = (v, a, b, c, d, clamp) => {
    const r = c + ((v - a) / (b - a)) * (d - c);
    if (!clamp) return r;
    return d > c ? Math.max(c, Math.min(d, r)) : Math.max(d, Math.min(c, r));
  };
  const constrain = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
  const norm = (v, a, b) => map(v, a, b, 0, 1);
  const radians = (d) => (d * Math.PI) / 180;
  const degrees = (r) => (r * 180) / Math.PI;
  const sq = (v) => v * v;
  const mag = (x, y) => Math.hypot(x, y);
  const shuffle = (arr, seed) => {
    const r = seed === undefined ? randomGen : rng(seed);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  };
  const lerpColor = (c1, c2, amt) => {
    const a = color(c1), b = color(c2);
    return [
      Math.round(lerp(a[0], b[0], amt)),
      Math.round(lerp(a[1], b[1], amt)),
      Math.round(lerp(a[2], b[2], amt)),
      Math.round(lerp(a[3] === undefined ? 255 : a[3], b[3] === undefined ? 255 : b[3], amt)),
    ];
  };

  // ── Events ───────────────────────────────────────────────────────────────────────────────
  const callHandler = (name, ...args) => {
    const cap = name.charAt(0).toUpperCase() + name.slice(1);
    const fn = W['__on' + cap] || W['__' + name] || W[name];
    if (typeof fn === 'function') {
      try { fn(...args); } catch (err) { fail(err); }
    }
  };

  const addTouch = (id, x, y) => {
    for (const t of S.touches) if (t.id === id) { t.x = x; t.y = y; return; }
    S.touches.push({ id, x, y, area: 0, pressure: 0 });
  };
  const removeTouch = (id) => { S.touches = S.touches.filter((t) => t.id !== id); };

  const onPointerDown = (e) => {
    const p = toSketch(e.clientX, e.clientY);
    S.mouseX = p.x; S.mouseY = p.y; S.pmouseX = p.x; S.pmouseY = p.y;
    S.mouseDown = true;
    S.mouseButton = e.button === 2 ? 'RIGHT' : (e.button === 1 ? 'CENTER' : 'LEFT');
    addTouch(e.pointerId, p.x, p.y);
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* no capture */ }
    callHandler('mousePressed', e);
    callHandler('touchStarted', e);
    e.preventDefault();
  };

  const onPointerMove = (e) => {
    const p = toSketch(e.clientX, e.clientY);
    S.pmouseX = S.mouseX; S.pmouseY = S.mouseY;
    S.mouseX = p.x; S.mouseY = p.y;
    if (S.mouseDown) {
      addTouch(e.pointerId, p.x, p.y);
      callHandler('mouseDragged', e);
      callHandler('touchMoved', e);
    } else {
      callHandler('mouseMoved', e);
    }
  };

  const onPointerUp = (e) => {
    const p = toSketch(e.clientX, e.clientY);
    S.mouseX = p.x; S.mouseY = p.y;
    S.mouseDown = false;
    removeTouch(e.pointerId);
    callHandler('mouseReleased', e);
    callHandler('touchEnded', e);
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
  };

  const onKeyDown = (e) => {
    S.key = e.key === undefined ? '' : e.key;
    S.keyCode = e.keyCode || e.which || 0;
    S.keyDown = true;
    callHandler('keyPressed', e);
  };
  const onKeyUp = (e) => { S.keyDown = false; callHandler('keyReleased', e); };
  const onKeyTyped = (e) => callHandler('keyTyped', e);
  const onWheel = (e) => {
    e.preventDefault();
    callHandler('mouseWheel', { getCount: () => (e.deltaY < 0 ? -1 : 1), count: e.deltaY < 0 ? -1 : 1, delta: e.deltaY });
  };

  // ── Drawing ──────────────────────────────────────────────────────────────────────────────
  const paint = () => {
    if (S.doFill) { ctx.fillStyle = css(S.fill); ctx.fill(); }
    if (S.doStroke) { ctx.strokeStyle = css(S.stroke); ctx.lineWidth = S.weight; ctx.stroke(); }
  };

  const rectCoords = (x, y, w, h) => {
    if (S.rectMode === 1) return [Math.min(x, x + w), Math.min(y, y + h), Math.abs(w), Math.abs(h)];
    if (S.rectMode === 3) return [x - w / 2, y - h / 2, w, h];
    if (S.rectMode === 2) return [x - w / 2, y - h / 2, w, h];
    return [x, y, w, h];
  };

  const ellipseCoords = (x, y, w, h) => {
    if (S.ellipseMode === 1) return [(x + x + w) / 2, (y + y + h) / 2, Math.abs(w) / 2, Math.abs(h) / 2];
    if (S.ellipseMode === 2) return [x, y, Math.abs(w), Math.abs(h)];
    return [x, y, Math.abs(w) / 2, Math.abs(h) / 2];
  };

  const alignToCtx = () => {
    ctx.textAlign = S.alignH === 3 ? 'center' : (S.alignH === 33 ? 'right' : 'left');
    ctx.textBaseline = S.alignV === 101 ? 'top' : (S.alignV === 102 ? 'bottom' : 'alphabetic');
  };

  // Наконечник и соединение штриха: принимаем и числа Processing, и строки.
  const capName = (c) => {
    if (typeof c === 'string') return c.toLowerCase();
    if (c === 0) return 'butt';
    if (c === 1) return 'square';
    return 'round';
  };
  const joinName = (j) => {
    if (typeof j === 'string') return j.toLowerCase();
    if (j === 0) return 'miter';
    if (j === 3) return 'bevel';
    return 'round';
  };

  /**
   * В Processing key — это char, поэтому сравнения работают и с буквой ('a'),
   * и с её кодом (97). В JS тот же объект сравнивается с обоими.
   */
  const makeChar = (ch) => {
    const text = String(ch ?? '');
    const obj = new String(text);
    obj[Symbol.toPrimitive] = (hint) => (hint === 'number' ? (text.charCodeAt(0) || 0) : text);
    return obj;
  };

  // ── Android: настройки и активность ─────────────────────────────────────────────────────
  const PREFS = {
    data: Object.assign({}, opts.preferences || {}),
    save() { post({ type: 'prefs', data: PREFS.data }); },
    contains(k) { return Object.prototype.hasOwnProperty.call(PREFS.data, k); },
    remove(k) { delete PREFS.data[k]; PREFS.save(); },
    clear() { PREFS.data = {}; PREFS.save(); },
    getString(k, d) { return PREFS.contains(k) ? String(PREFS.data[k]) : (d === undefined ? null : d); },
    putString(k, v) { PREFS.data[k] = String(v); PREFS.save(); },
    getInt(k, d) { return PREFS.contains(k) ? parseInt(PREFS.data[k], 10) : (d === undefined ? 0 : d); },
    putInt(k, v) { PREFS.data[k] = Math.round(Number(v) || 0); PREFS.save(); },
    getFloat(k, d) { return PREFS.contains(k) ? parseFloat(PREFS.data[k]) : (d === undefined ? 0 : d); },
    putFloat(k, v) { PREFS.data[k] = Number(v) || 0; PREFS.save(); },
    getBoolean(k, d) { return PREFS.contains(k) ? !!PREFS.data[k] : (d === undefined ? false : d); },
    putBoolean(k, v) { PREFS.data[k] = !!v; PREFS.save(); },
  };

  const pendingPermissions = [];

  const ACTIVITY = {
    getPackageName: () => opts.packageName || 'com.example.sketch',
    finish() { post({ type: 'finish' }); },
    getPreferences: () => PREFS,
    requestPermission: (permission, callback) => API.requestPermission(permission, callback),
    hasPermission: (permission) => !!S.permissions[String(permission)],
    runOnUiThread: (fn) => { try { if (typeof fn === 'function') fn(); } catch (err) { fail(err); } },
    getSensorManager: () => SENSOR_MANAGER,
    getWindowManager: () => ({
      getDefaultDisplay: () => ({ getWidth: () => S.sketchW, getHeight: () => S.sketchH, getRotation: () => S.rotation }),
    }),
    getResources: () => ({
      getDisplayMetrics: () => ({ widthPixels: Math.round(S.sketchW * S.dpr), heightPixels: Math.round(S.sketchH * S.dpr), density: S.dpr }),
    }),
  };

  // ── JSON: как в processing.data ───────────────────────────────────────────────────────
  class JSONArray {
    constructor(data) { this.data = Array.isArray(data) ? data : []; }
    size() { return this.data.length; }
    getInt(i) { return Math.trunc(Number(this.data[i]) || 0); }
    getFloat(i) { return Number(this.data[i]) || 0; }
    getString(i) { return String(this.data[i] ?? ''); }
    getJSONObject(i) { const v = this.data[i]; return (v && typeof v === 'object') ? new JSONObject(v) : null; }
    getJSONArray(i) { const v = this.data[i]; return Array.isArray(v) ? new JSONArray(v) : null; }
    getStringArray(i) { const v = this.data[i]; return Array.isArray(v) ? v.map(String) : null; }
  }

  class JSONObject {
    constructor(data) { this.data = (data && typeof data === 'object') ? data : {}; }
    hasKey(key) { return Object.prototype.hasOwnProperty.call(this.data, key); }
    getString(key, fallback) { const v = this.data[key]; return v === undefined ? (fallback === undefined ? null : fallback) : String(v); }
    getInt(key, fallback) { const v = this.data[key]; return v === undefined ? (fallback === undefined ? 0 : fallback) : Math.trunc(Number(v) || 0); }
    getFloat(key, fallback) { const v = this.data[key]; return v === undefined ? (fallback === undefined ? 0 : fallback) : Number(v) || 0; }
    getBoolean(key, fallback) { const v = this.data[key]; return v === undefined ? (fallback === undefined ? false : fallback) : !!v; }
    getJSONObject(key) { const v = this.data[key]; return (v && typeof v === 'object' && !Array.isArray(v)) ? new JSONObject(v) : null; }
    getJSONArray(key) { const v = this.data[key]; return Array.isArray(v) ? new JSONArray(v) : null; }
    getStringArray(key) { const v = this.data[key]; return Array.isArray(v) ? v.map(String) : null; }
    setString(key, value) { this.data[key] = String(value); }
    setInt(key, value) { this.data[key] = Math.trunc(Number(value) || 0); }
    setFloat(key, value) { this.data[key] = Number(value) || 0; }
  }

  // ── Сенсоры: шина SensorManager, как в Processing for Android ──────────────────────────
  const sensorListeners = [];

  const sensorValues = (type) => {
    switch (type) {
      case 'accelerometer': return [S.accelX, S.accelY, S.accelZ];
      case 'linear': return [S.accelX, S.accelY, S.accelZ];
      case 'gyroscope': return [S.gyroX, S.gyroY, S.gyroZ];
      case 'magnetic': return [S.magX, S.magY, S.magZ];
      case 'light': return [S.light];
      case 'proximity': return [S.proximity];
      case 'rotation': return [0, 0, 0, 1];
      default: return [0, 0, 0];
    }
  };

  const SENSOR_MANAGER = {
    getDefaultSensor(type) {
      const key = String(type);
      return { type: key, getName: () => key, getType: () => key };
    },
    registerListener(listener, sensor, delay) {
      if (!listener || !sensor) return false;
      sensorListeners.push({ listener, type: String(sensor.type), delay: delay || 1 });
      return true;
    },
    unregisterListener(listener) {
      for (let i = sensorListeners.length - 1; i >= 0; i--) {
        if (sensorListeners[i].listener === listener) sensorListeners.splice(i, 1);
      }
      return true;
    },
  };

  const tickSensors = () => {
    if (!sensorListeners.length) return;
    for (const entry of sensorListeners.slice()) {
      const event = {
        values: sensorValues(entry.type),
        sensor: { type: entry.type, getName: () => entry.type },
        accuracy: 3,
        timestamp: Date.now(),
      };
      try { entry.listener.onSensorChanged(event); } catch (err) { fail(err); }
    }
  };

  const CONTEXT = {
    SENSOR_SERVICE: 'sensor',
    getSystemService(name) {
      if (name === 'sensor' || name === 'SensorManager') return SENSOR_MANAGER;
      return null;
    },
    getPackageName: () => opts.packageName || 'com.example.sketch',
    getAssets: () => ({ open: (name) => Promise.resolve(S.dataFiles[name] || null) }),
  };

  // ── API ──────────────────────────────────────────────────────────────────────────────────
  const API = {
    // constants
    CENTER: 3, LEFT: 39, RIGHT: 33, TOP: 101, BOTTOM: 102, BASELINE: 0,
    CORNER: 0, CORNERS: 1, RADIUS: 2,
    POINTS: 0, LINES: 1, TRIANGLES: 2, QUADS: 3, CLOSE: 4,
    POLYGON: 9, PATH: 10, GEOMETRY: 11, GROUP: 13, TEXT: 14, PRIMITIVE: 5,
    PI: Math.PI, TWO_PI: Math.PI * 2, HALF_PI: Math.PI / 2, QUARTER_PI: Math.PI / 4,
    DEG_TO_RAD: Math.PI / 180, RAD_TO_DEG: 180 / Math.PI, EPSILON: 0.0001,

    // Рендереры (в эмуляторе всегда 2D)
    DEFAULT: 0, P2D: 1, P3D: 2, FX2D: 3, AR: 4, METRO: 5, WEBGL: 2, OPENGL: 2,

    // Ориентация экрана (как в android.content.pm.ActivityInfo)
    PORTRAIT: 0, LANDSCAPE: 1, REVERSE_PORTRAIT: 2, REVERSE_LANDSCAPE: 3, UNKNOWN: 4,

    // Коды клавиш
    CODED: 65535, ENTER: 10, RETURN: 13, BACKSPACE: 8, TAB: 9, ESC: 27, DELETE: 127,
    UP: 38, DOWN: 40, LEFT: 37, RIGHT: 39, CONTROL: 17, ALT: 18, SHIFT: 16,

    // Типы сенсоров Android
    Sensor: {
      TYPE_ACCELEROMETER: 'accelerometer',
      TYPE_GYROSCOPE: 'gyroscope',
      TYPE_MAGNETIC_FIELD: 'magnetic',
      TYPE_LIGHT: 'light',
      TYPE_PROXIMITY: 'proximity',
      TYPE_ROTATION_VECTOR: 'rotation',
      TYPE_LINEAR_ACCELERATION: 'linear',
    },
    SensorManager: { SENSOR_DELAY_FASTEST: 0, SENSOR_DELAY_GAME: 1, SENSOR_DELAY_UI: 2, SENSOR_DELAY_NORMAL: 3 },
    Context: { SENSOR_SERVICE: 'sensor' },

    // Наконечники и соединения штриха
    PROJECT: 0, SQUARE: 1, ROUND: 2, MITER: 0, BEVEL: 3,

    ADAPTIVE_CONTAIN: 0, ADAPTIVE_COVER: 1, ADAPTIVE_STRETCH: 2,
    AdaptiveUI: {
      CONTAIN: 0, COVER: 1, STRETCH: 2,
      attach() { /* эмулятор уже вписывает холст в рамку телефона */ },
      detach() {},
      enabled() { return true; },
      scale() { return 1; },
      screenX(_app, x) { return x; },
      screenY(_app, y) { return y; },
      designX(_app, x) { return x; },
      designY(_app, y) { return y; },
      s(_app, value) { return value; },
    },

    // canvas
    size(w, h, renderer) {
      if (renderer !== undefined && renderer !== null && renderer !== API.P2D && renderer !== API.FX2D) {
        const name = renderer === API.P3D || renderer === API.WEBGL ? 'P3D/WEBGL' : String(renderer);
        post({ type: 'log', level: 'warn', text: `Рендерер ${name} не поддерживается — рисуем в 2D (P2D).` });
      }
      S.sketchW = Math.max(1, Math.round(w));
      S.sketchH = Math.max(1, Math.round(h));
      applySize();
    },
    fullScreen() { applySize(); },
    createCanvas(w, h) { API.size(w, h); return { elt: canvas }; },
    noCanvas() { /* the canvas always exists */ },
    pixelDensity(d) { if (d === undefined) return S.dpr; S.dpr = d; applySize(); },
    /** В Processing for Android это переменная: `24 * displayDensity`. Поддерживаем и вызов. */
    displayDensity() { return S.dpr; },
    get width() { return S.sketchW; },
    get height() { return S.sketchH; },
    get pixelWidth() { return canvas.width; },
    get pixelHeight() { return canvas.height; },

    // style
    color: (...args) => color(...args),
    background(...args) {
      if (args.length === 1 && args[0] && args[0].nodeType) { // an image
        try { ctx.drawImage(args[0], 0, 0, S.sketchW, S.sketchH); } catch (err) { /* not loaded yet */ }
        return;
      }
      const c = color(...args);
      ctx.save();
      ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
      ctx.fillStyle = css(c);
      ctx.fillRect(0, 0, S.sketchW, S.sketchH);
      ctx.restore();
    },
    fill(...args) { S.fill = color(...args); S.doFill = true; },
    noFill() { S.doFill = false; },
    stroke(...args) { S.stroke = color(...args); S.doStroke = true; },
    noStroke() { S.doStroke = false; },
    strokeWeight(w) { S.weight = w; ctx.lineWidth = w; },
    strokeCap(c) { ctx.lineCap = capName(c); },
    strokeJoin(j) { ctx.lineJoin = joinName(j); },
    rectMode(m) { S.rectMode = m; },
    ellipseMode(m) { S.ellipseMode = m; },
    smooth() { ctx.imageSmoothingEnabled = true; },
    noSmooth() { ctx.imageSmoothingEnabled = false; },
    pushStyle() {
      ctx.save();
      S.styleStack.push({
        fill: S.fill.slice(), stroke: S.stroke.slice(), doFill: S.doFill, doStroke: S.doStroke,
        weight: S.weight, textSize: S.textSize, font: S.font, alignH: S.alignH, alignV: S.alignV,
      });
    },
    popStyle() {
      const st = S.styleStack.pop();
      if (st) {
        S.fill = st.fill; S.stroke = st.stroke; S.doFill = st.doFill; S.doStroke = st.doStroke;
        S.weight = st.weight; S.textSize = st.textSize; S.font = st.font; S.alignH = st.alignH; S.alignV = st.alignV;
      }
      ctx.restore();
    },
    push() { ctx.save(); API.pushStyle(); },
    pop() { API.popStyle(); ctx.restore(); },

    // shapes
    rect(x, y, w, h) {
      const r = rectCoords(x, y, w, h);
      ctx.beginPath();
      ctx.rect(r[0], r[1], r[2], r[3]);
      paint();
    },
    square(x, y, s) { API.rect(x, y, s, s); },
    ellipse(x, y, w, h) {
      const e = ellipseCoords(x, y, w, h);
      ctx.beginPath();
      ctx.ellipse(e[0], e[1], Math.abs(e[2]), Math.abs(e[3]), 0, 0, Math.PI * 2);
      paint();
    },
    circle(x, y, d) {
      ctx.beginPath();
      ctx.ellipse(x, y, Math.abs(d) / 2, Math.abs(d) / 2, 0, 0, Math.PI * 2);
      paint();
    },
    line(x1, y1, x2, y2) {
      if (!S.doStroke) return;
      ctx.strokeStyle = css(S.stroke);
      ctx.lineWidth = S.weight;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    },
    point(x, y) {
      if (!S.doStroke) return;
      ctx.save();
      ctx.fillStyle = css(S.stroke);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.5, S.weight / 2), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },
    triangle(x1, y1, x2, y2, x3, y3) {
      ctx.beginPath();
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.closePath();
      paint();
    },
    quad(x1, y1, x2, y2, x3, y3, x4, y4) {
      ctx.beginPath();
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4); ctx.closePath();
      paint();
    },
    arc(x, y, w, h, start, stop) {
      ctx.beginPath();
      ctx.ellipse(x, y, Math.abs(w) / 2, Math.abs(h) / 2, 0, start, stop);
      paint();
    },
    beginShape(mode) { S.shape = []; S.shapeMode = mode || 0; },
    vertex(x, y) { if (S.shape) S.shape.push([x, y]); },
    endShape(close) {
      const pts = S.shape || [];
      S.shape = null;
      if (!pts.length) return;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      if (close) ctx.closePath();
      paint();
    },

    // text
    text(str, x, y) {
      const s = String(str);
      ctx.font = S.textSize + 'px ' + S.font;
      alignToCtx();
      if (S.doFill) { ctx.fillStyle = css(S.fill); ctx.fillText(s, x, y); }
      if (S.doStroke) { ctx.strokeStyle = css(S.stroke); ctx.lineWidth = S.weight; ctx.strokeText(s, x, y); }
    },
    textSize(s) { if (s === undefined) return S.textSize; S.textSize = s; },
    textLeading(l) { if (l === undefined) return S.textLeading; S.textLeading = l; },
    textFont(f) { if (f === undefined) return S.font; S.font = String(f); },
    textAlign(h, v) { if (h !== undefined) S.alignH = h; if (v !== undefined) S.alignV = v; },
    textWidth(s) { ctx.font = S.textSize + 'px ' + S.font; return ctx.measureText(String(s)).width; },
    textAscent() { ctx.font = S.textSize + 'px ' + S.font; return S.textSize * 0.8; },
    textDescent() { ctx.font = S.textSize + 'px ' + S.font; return S.textSize * 0.2; },

    // transforms
    pushMatrix() { ctx.save(); },
    popMatrix() { ctx.restore(); },
    translate(x, y) { ctx.translate(x, y || 0); },
    rotate(a) { ctx.rotate(a); },
    scale(x, y) { ctx.scale(x, y === undefined ? x : y); },
    resetMatrix() { ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0); },

    // math
    map, constrain, dist, norm, lerp, lerpColor, radians, degrees, sq, mag,
    random, randomSeed, noise, noiseSeed, shuffle,
    abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round, sqrt: Math.sqrt, pow: Math.pow,
    min: Math.min, max: Math.max, sin: Math.sin, cos: Math.cos, tan: Math.tan, atan2: Math.atan2,
    asin: Math.asin, acos: Math.acos, atan: Math.atan,
    exp: Math.exp, log: Math.log, sign: Math.sign, hypot: Math.hypot,

    // Приведение типов (в Java это casts)
    int: (v) => Math.trunc(Number(v)) | 0,
    float: (v) => Number(v),
    boolean: (v) => !!v,
    char: (v) => String(v).charAt(0),
    byte: (v) => Math.trunc(Number(v)),
    short: (v) => Math.trunc(Number(v)),
    long: (v) => Math.trunc(Number(v)),

    // Компоненты цвета
    red: (c) => color(c)[0],
    green: (c) => color(c)[1],
    blue: (c) => color(c)[2],
    alpha: (c) => (color(c)[3] === undefined ? 255 : color(c)[3]),
    hex: (r, g, b) => {
      if (g === undefined) {
        const v = color(r);
        return ('#' + v.slice(0, 3).map((n) => (n | 0).toString(16).padStart(2, '0')).join('')).toUpperCase();
      }
      return ('#' + [r, g, b].map((n) => (n | 0).toString(16).padStart(2, '0')).join('')).toUpperCase();
    },

    // time
    millis() { return Date.now() - S.started; },
    second() { return new Date().getSeconds(); },
    minute() { return new Date().getMinutes(); },
    hour() { return new Date().getHours(); },
    day() { return new Date().getDate(); },
    month() { return new Date().getMonth() + 1; },
    year() { return new Date().getFullYear(); },
    get frameCount() { return S.frame; },
    frameRate(fps) { if (fps === undefined) return S.fpsValue; S.targetFps = fps; return fps; },
    get currentFrameRate() { return S.fpsValue; },
    deltaTime() { return S.delta; },
    loop() { S.loop = true; },
    noLoop() { S.loop = false; },
    redraw() { drawFrame(); },
    exit() { S.dead = true; post({ type: 'stopped' }); },

    // sensors
    get accelerometerX() { return S.accelX; },
    get accelerometerY() { return S.accelY; },
    get accelerometerZ() { return S.accelZ; },
    get gyroscopeX() { return S.gyroX; },
    get gyroscopeY() { return S.gyroY; },
    get gyroscopeZ() { return S.gyroZ; },
    get magnetometerX() { return S.magX; },
    get magnetometerY() { return S.magY; },
    get magnetometerZ() { return S.magZ; },
    get rotation() { return S.rotation; },
    get orientation() { return S.orientation; },
    get heading() { return S.heading; },
    get latitude() { return S.lat; },
    get longitude() { return S.lon; },
    get altitude() { return S.alt; },
    get accuracy() { return S.accuracy; },

    // Android: активность, разрешения, настройки
    getActivity() { return ACTIVITY; },
    getContext() { return CONTEXT; },
    getPreferences() { return PREFS; },
    /**
     * requestPermission("android.permission.CAMERA") — вызовет onPermissionGranted(name, granted).
     * requestPermission("android.permission.CAMERA", "onCameraPermission") — вызовет метод с boolean.
     */
    requestPermission(permission, callback) {
      const name = String(permission);
      pendingPermissions.push({ name, callback: callback ? String(callback) : null });
      post({ type: 'permission-request', permission: name });
    },
    hasPermission(permission) { return !!S.permissions[String(permission)]; },
    getPackageName() { return opts.packageName || 'com.example.sketch'; },
    isPermissionGranted(permission) { return !!S.permissions[String(permission)]; },

    // Android Mode: ориентация, клавиатура, кнопка «Назад», lifecycle
    orientation(mode) {
      S.orientationLock = mode === undefined ? 0 : mode;
      post({ type: 'orientation', mode: S.orientationLock });
    },
    openKeyboard() {
      S.keyboard = true;
      post({ type: 'keyboard', open: true });
    },
    closeKeyboard() {
      S.keyboard = false;
      post({ type: 'keyboard', open: false });
    },
    /** Кнопка «Назад»: сначала sketch, потом выход из приложения. */
    onBackPressed() {
      const fn = W.backPressed;
      if (typeof fn === 'function') { try { fn(); return; } catch (err) { fail(err); return; } }
      ACTIVITY.finish();
    },
    /** Фоновый поток: в браузере это отдельная задача, а не настоящий поток. */
    thread(name) {
      const fn = W[name];
      if (typeof fn !== 'function') { post({ type: 'log', level: 'warn', text: `thread("${name}"): метод не найден` }); return; }
      setTimeout(() => { try { fn(); } catch (err) { fail(err); } }, 0);
    },
    /** Вызов в UI-потоке: в эмуляторе выполняется сразу. */
    runOnUiThread(fn) { try { if (typeof fn === 'function') fn(); } catch (err) { fail(err); } },

    // Числа и шрифты
    nf(value, left, right) {
      const v = Number(value) || 0;
      const l = left === undefined ? 0 : Math.max(0, Math.floor(left));
      const r = right === undefined ? 2 : Math.max(0, Math.floor(right));
      return v.toFixed(r).padStart(l + r + 1, '0');
    },
    createFont(name, size) { return { name: String(name || 'sans-serif'), size: Number(size) || 12, isLoaded: true }; },
    str: (v) => String(v),
    parseBool: (v) => (v === true || String(v).toLowerCase() === 'true'),

    // Данные проекта: data/ проекта и внутренняя папка приложения
    loadStrings(name) {
      const raw = S.dataFiles[name];
      if (raw === undefined) return null;
      return String(raw).split(/\r?\n/);
    },
    loadJSONObject(name) {
      const raw = S.dataFiles[name];
      if (raw === undefined) return null;
      try { return new JSONObject(JSON.parse(raw)); } catch (err) { return null; }
    },
    saveStrings(name, values) {
      S.dataFiles[name] = (values || []).map((v) => String(v)).join('\n');
      post({ type: 'save-data', name, data: S.dataFiles[name] });
    },
    saveJSONObject(name, obj) {
      S.dataFiles[name] = JSON.stringify(obj);
      post({ type: 'save-data', name, data: S.dataFiles[name] });
    },

    // input
    get mouseX() { return S.mouseX; },
    get mouseY() { return S.mouseY; },
    get pmouseX() { return S.pmouseX; },
    get pmouseY() { return S.pmouseY; },
    get mouseButton() { return S.mouseButton; },
    get mouseIsPressed() { return S.mouseDown; },
    get __mouseDown() { return S.mouseDown; },
    get touches() { return S.touches; },
    get touchCount() { return S.touches.length; },
    get key() { return makeChar(S.key); },
    get keyCode() { return S.keyCode; },
    get keyIsPressed() { return S.keyDown; },
    get pressed() { return S.keyDown; },
    get __keyDown() { return S.keyDown; },
  };

  API.JSONObject = JSONObject;
  API.JSONArray = JSONArray;

  // ── PVector ───────────────────────────────────────────────────────────────────────────────
  API.PVector = class PVector {
    constructor(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; }
    set(x, y, z) {
      if (x && x.x !== undefined) { this.x = x.x; this.y = x.y; this.z = x.z; }
      else { this.x = x; this.y = y || 0; this.z = z || 0; }
      return this;
    }
    add(x, y, z) {
      if (x && x.x !== undefined) { this.x += x.x; this.y += x.y || 0; this.z += x.z || 0; }
      else { this.x += x || 0; this.y += y || 0; this.z += z || 0; }
      return this;
    }
    sub(x, y, z) {
      if (x && x.x !== undefined) { this.x -= x.x; this.y -= x.y || 0; this.z -= x.z || 0; }
      else { this.x -= x || 0; this.y -= y || 0; this.z -= z || 0; }
      return this;
    }
    mult(x, y, z) {
      if (x && x.x !== undefined) { this.x *= x.x; this.y *= x.y; this.z *= x.z; }
      else if (y === undefined) { this.x *= x; this.y *= x; this.z *= x; }
      else { this.x *= x; this.y *= y; this.z *= z || 0; }
      return this;
    }
    div(x, y, z) {
      if (x && x.x !== undefined) { this.x /= x.x; this.y /= x.y; this.z /= x.z; }
      else if (y === undefined) { this.x /= x; this.y /= x; this.z /= x; }
      else { this.x /= x; this.y /= y; this.z /= z || 0; }
      return this;
    }
    mag() { return Math.hypot(this.x, this.y, this.z); }
    magSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
    normalize() { const m = this.mag(); if (m > 0) this.div(m); return this; }
    limit(max) { if (this.magSq() > max * max) this.normalize().mult(max); return this; }
    setMag(len) { return this.normalize().mult(len); }
    heading() { return Math.atan2(this.y, this.x); }
    rotate(a) {
      const c = Math.cos(a), s = Math.sin(a), x = this.x;
      this.x = x * c - this.y * s; this.y = x * s + this.y * c;
      return this;
    }
    dist(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - (v.z || 0)); }
    lerp(v, amt) {
      this.x += (v.x - this.x) * amt; this.y += (v.y - this.y) * amt; this.z += ((v.z || 0) - this.z) * amt;
      return this;
    }
    copy() { return new PVector(this.x, this.y, this.z); }
    array() { return [this.x, this.y, this.z]; }
    static fromAngle(angle, len) { len = len === undefined ? 1 : len; return new PVector(Math.cos(angle) * len, Math.sin(angle) * len, 0); }
    static fromAngleXYZ(x, y, z) { return new PVector(Math.cos(x) * Math.cos(y) * z, Math.sin(x) * Math.cos(y) * z, Math.sin(y) * z); }
    static random2D() { return PVector.fromAngle(randomGen() * Math.PI * 2); }
    static add(a, b) { return a.copy().add(b); }
    static sub(a, b) { return a.copy().sub(b); }
    static mult(v, s) { return v.copy().mult(s); }
    static dist(a, b) { return a.dist(b); }
    static lerp(a, b, amt) { return a.copy().lerp(b, amt); }
  };

  // ── Collections ───────────────────────────────────────────────────────────────────────────
  API.ArrayList = class ArrayList {
    constructor() { this.items = []; }
    add(v) { this.items.push(v); return true; }
    addAll(arr) { for (const v of arr) this.items.push(v); }
    get(i) { return this.items[i]; }
    set(i, v) { this.items[i] = v; }
    size() { return this.items.length; }
    isEmpty() { return this.items.length === 0; }
    contains(v) { return this.items.indexOf(v) >= 0; }
    remove(i) {
      if (typeof i === 'number') this.items.splice(i, 1);
      else { const k = this.items.indexOf(i); if (k >= 0) this.items.splice(k, 1); }
    }
    clear() { this.items.length = 0; }
    toArray() { return this.items.slice(); }
    [Symbol.iterator]() { return this.items[Symbol.iterator](); }
  };

  API.HashMap = class HashMap {
    constructor() { this.map = new Map(); }
    put(k, v) { this.map.set(k, v); }
    get(k) { return this.map.has(k) ? this.map.get(k) : null; }
    containsKey(k) { return this.map.has(k); }
    remove(k) { this.map.delete(k); }
    size() { return this.map.size; }
    clear() { this.map.clear(); }
    keySet() { return Array.from(this.map.keys()); }
    values() { return Array.from(this.map.values()); }
  };

  // ── Output ────────────────────────────────────────────────────────────────────────────────
  const stringify = (v) => {
    if (typeof v === 'object' && v !== null) { try { return JSON.stringify(v); } catch (err) { return String(v); } }
    return String(v);
  };
  const log = (level, text) => post({ type: 'log', level, text: String(text) });

  API.println = (...args) => log('log', args.map(stringify).join(' '));
  API.print = (...args) => log('log', args.map(stringify).join(' '));
  API.format = (fmt, ...args) => {
    let i = 0;
    return String(fmt).replace(/%[sdif%]/g, (m) => {
      if (m === '%%') return '%';
      const v = args[i++];
      if (m === '%d') return String(Math.round(Number(v)));
      if (m === '%f') return String(Number(v));
      return stringify(v);
    });
  };

  const origLog = console.log ? console.log.bind(console) : null;
  console.log = (...args) => { if (origLog) origLog(...args); log('log', args.map(stringify).join(' ')); };
  console.error = (...args) => log('error', args.map(stringify).join(' '));
  console.warn = (...args) => log('warn', args.map(stringify).join(' '));

  // ── Images ────────────────────────────────────────────────────────────────────────────────
  const resolveUrl = (u) => {
    const s = String(u || '');
    if (/^(https?:|data:|blob:|file:)/i.test(s)) return s;
    const base = opts.baseDir || '';
    if (base) return 'file://' + base.replace(/\/+$/, '') + '/' + s.replace(/^\.\//, '');
    return s;
  };
  API.loadImage = (path, cb) => {
    const img = new Image();
    img.onload = () => { if (typeof cb === 'function') cb(img); };
    img.onerror = () => { log('warn', 'Не удалось загрузить изображение: ' + path); if (typeof cb === 'function') cb(null); };
    img.src = resolveUrl(path);
    S.images.set(path, img);
    return img;
  };
  API.imageMode = (mode) => { S.imageMode = mode; };
  API.image = (img, x, y, w, h) => {
    if (!img) return;
    const mode = S.imageMode;
    try {
      if (mode === 1) { // CORNERS
        const iw = img.width || 0, ih = img.height || 0;
        ctx.drawImage(img, x, y, w - x, h - y);
      } else if (mode === 3) { // CENTER
        const iw = (w === undefined ? (img.width || 0) : w) / 2;
        const ih = (h === undefined ? (img.height || 0) : h) / 2;
        ctx.drawImage(img, x - iw, y - ih, w === undefined ? (img.width || 0) : w, h === undefined ? (img.height || 0) : h);
      } else if (w === undefined) ctx.drawImage(img, x, y);
      else ctx.drawImage(img, x, y, w, h);
    } catch (err) { /* the image is not ready yet */ }
  };
  API.saveFrame = (name) => {
    try { post({ type: 'save', url: canvas.toDataURL('image/png'), name: name || 'frame.png' }); } catch (err) { /* the canvas is tainted */ }
  };

  // ── Frame loop ────────────────────────────────────────────────────────────────────────────
  const drawTouches = () => {
    if (!S.showTouches || !S.touches.length) return;
    ctx.save();
    ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    for (const t of S.touches) {
      ctx.beginPath();
      ctx.arc(t.x, t.y, 18, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,180,0,0.9)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(t.x, t.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,180,0,0.9)';
      ctx.fill();
    }
    ctx.restore();
  };

  const drawFrame = () => {
    if (S.dead) return;
    const now = performance.now();
    S.delta = S.last ? now - S.last : 16;
    S.last = now;
    try {
      tickSensors();
      if (typeof W.draw === 'function') W.draw();
    } catch (err) {
      fail(err);
      return;
    }
    S.frame++;
    S.fpsFrames++;
    if (!S.fpsSince) S.fpsSince = now;
    if (now - S.fpsSince >= 500) {
      S.fpsValue = Math.round((S.fpsFrames * 1000) / (now - S.fpsSince));
      S.fpsFrames = 0;
      S.fpsSince = now;
      post({ type: 'fps', fps: S.fpsValue });
    }
    drawTouches();
  };

  const loopFn = () => {
    if (S.dead) return;
    if (S.loop) drawFrame();
    requestAnimationFrame(loopFn);
  };

  // ── Installation ─────────────────────────────────────────────────────────────────────────
  const SKIP = { install: 1, start: 1, state: 1, __report: 1, __state: 1 };

  const install = () => {
    for (const key in API) {
      if (SKIP[key]) continue;
      const desc = Object.getOwnPropertyDescriptor(API, key);
      if (desc && desc.get) {
        Object.defineProperty(W, key, { get: desc.get, configurable: true });
      } else if (typeof API[key] === 'function') {
        const isClass = API[key].prototype && API[key].prototype.constructor === API[key];
        W[key] = isClass ? API[key] : API[key].bind(API);
      } else {
        W[key] = API[key];
      }
    }
    applySize();
    // displayDensity/frameRate — и число, и функция: `56 * displayDensity` и `displayDensity()`.
    for (const key of ['displayDensity', 'frameRate']) {
      if (typeof W[key] === 'function') {
        W[key].valueOf = () => (key === 'displayDensity' ? S.dpr : S.fpsValue);
        W[key].toString = () => String(key === 'displayDensity' ? S.dpr : S.fpsValue);
      }
    }
    W.addEventListener('resize', fitCanvas);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    W.addEventListener('keydown', onKeyDown);
    W.addEventListener('keyup', onKeyUp);
    W.addEventListener('keypress', onKeyTyped);
    W.addEventListener('message', (e) => {
      const d = e.data || {};
      if (d.source !== HOST) return;
      if (d.type === 'sensor') {
        if (d.x !== undefined) S.accelX = d.x;
        if (d.y !== undefined) S.accelY = d.y;
        if (d.z !== undefined) S.accelZ = d.z;
        if (d.rotation !== undefined) S.rotation = d.rotation;
        if (d.orientation !== undefined) S.orientation = d.orientation;
        if (d.heading !== undefined) S.heading = d.heading;
        if (d.shake) callHandler('shake', d);
      } else if (d.type === 'permission-result') {
        S.permissions[String(d.permission)] = !!d.granted;
        const pending = pendingPermissions.find((p) => p.name === String(d.permission));
        if (pending && pending.callback) {
          const fn = W[pending.callback];
          if (typeof fn === 'function') { try { fn(!!d.granted); } catch (err) { fail(err); } }
        }
        callHandler('permissionGranted', String(d.permission), !!d.granted);
      } else if (d.type === 'location') {
        S.lat = d.lat ?? S.lat;
        S.lon = d.lon ?? S.lon;
        S.alt = d.alt ?? S.alt;
        S.accuracy = d.accuracy ?? S.accuracy;
        callHandler('locationChanged', S.lat, S.lon, S.alt, S.accuracy);
      } else if (d.type === 'lifecycle') {
        S.paused = d.paused === true;
        const fn = W[d.paused ? 'onPause' : 'onResume'];
        if (typeof fn === 'function') { try { fn(); } catch (err) { fail(err); } }
      } else if (d.type === 'back') {
        const fn = W.backPressed;
        if (typeof fn === 'function') { try { fn(); } catch (err) { fail(err); } }
        else post({ type: 'finish' });
      } else if (d.type === 'key') {
        if (d.action === 'down') onKeyDown(d);
        else if (d.action === 'up') onKeyUp(d);
        else callHandler('keyTyped', d);
      } else if (d.type === 'stop') {
        S.dead = true;
      }
    });
  };

  const start = () => {
    try {
      if (typeof W.setup === 'function') W.setup();
    } catch (err) {
      fail(err);
      return;
    }
    post({ type: 'ready' });
    S.last = performance.now();
    requestAnimationFrame(loopFn);
  };

  API.install = install;
  API.start = start;
  API.__report = fail;
  API.__state = S;

  return API;
}
