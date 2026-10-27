#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const bundle = fs.readFileSync(path.join(__dirname, '..', 'extensions', 'processing-mobile', 'plugin.js'), 'utf8');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'processing-mobile-'));
const windowStub = {
  addEventListener() {}, removeEventListener() {},
  electronAPI: {
    async writeFile(file, content) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
      return { success: true };
    },
    async listFiles(folder) {
      if (!fs.existsSync(folder)) return { success: false, files: [] };
      return { success: true, files: fs.readdirSync(folder, { withFileTypes: true }).map((item) => ({
        name: item.name, path: path.join(folder, item.name), isDirectory: item.isDirectory(),
      })) };
    },
    async getFileContent(file) {
      return fs.existsSync(file) ? { success: true, content: fs.readFileSync(file, 'utf8') } : { success: false };
    },
  },
};
const frogeeStub = { addStyle() {}, addButton() {}, onUnload() {} };
const kit = new Function('frogee', 'window', `${bundle}\nreturn { transpileProcessing, sketchToJava, exportAndroidProject, PAPPLET_JAVA, PVECTOR_JAVA, PFONT_JAVA, JSONOBJECT_JAVA, ADAPTIVE_UI_JAVA };`)(frogeeStub, windowStub);

(async () => {
  try {
    const main = 'int count = 0;\nvoid setup() { size(320, 480); }\nvoid draw() { background(20); ellipse(80, 80, 40, 40); count++; }';
    const extra = 'float speed = 1.5;';
    const transpiled = kit.transpileProcessing(main);
    assert.match(transpiled.code, /function setup\(/);
    assert.match(transpiled.code, /function draw\(/);
    const settings = { name: 'Smoke', packageName: 'com.example.smoke', minSdk: 24, targetSdk: 34,
      orientation: 'portrait', permissions: ['INTERNET'], adaptiveUi: true, sketch: 'Smoke.pde' };
    const result = await kit.exportAndroidProject({ root, sketchName: 'Smoke.pde',
      sketchSource: [{ name: 'Smoke.pde', code: main }, { name: 'Extra.pde', code: extra }], settings,
      runtime: { pApplet: kit.PAPPLET_JAVA, pVector: kit.PVECTOR_JAVA, pFont: kit.PFONT_JAVA,
        json: kit.JSONOBJECT_JAVA, adaptiveUi: kit.ADAPTIVE_UI_JAVA } });
    assert.equal(result.ok, true, result.error);
    const java = fs.readFileSync(path.join(root, 'android/app/src/main/java/com/example/smoke/Smoke.java'), 'utf8');
    assert.match(java, /class Smoke extends PApplet/);
    assert.match(java, /float speed = 1\.5f/);
    assert.match(java, /AdaptiveUI\.attach\(this\)/);
    assert.ok(fs.existsSync(path.join(root, 'android/app/build.gradle')));
    assert.ok(fs.existsSync(path.join(root, 'android/app/src/main/AndroidManifest.xml')));
    console.log('Processing Mobile: transpilation and Android export passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
