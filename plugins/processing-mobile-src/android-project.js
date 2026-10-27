/**
 * Проект Processing Studio: настройки приложения и экспорт в Android-проект (Gradle).
 *
 * Скетч (.pde) — это Java, поэтому экспорт не требует Processing for Android:
 * исходник становится подклассом собственного PApplet, а в проект попадает
 * мини-рантайм с рисованием, касаниями, датчиками и разрешениями.
 */

import { ADAPTIVE_UI_JAVA } from './android-runtime.js';

export const PROJECT_FILE = 'processing-studio.json';

export const PERMISSIONS = [
  { id: 'INTERNET', label: 'Интернет' },
  { id: 'ACCESS_NETWORK_STATE', label: 'Состояние сети' },
  { id: 'CAMERA', label: 'Камера' },
  { id: 'RECORD_AUDIO', label: 'Микрофон' },
  { id: 'ACCESS_FINE_LOCATION', label: 'Точное местоположение' },
  { id: 'ACCESS_COARSE_LOCATION', label: 'Приблизительное местоположение' },
  { id: 'READ_EXTERNAL_STORAGE', label: 'Чтение файлов' },
  { id: 'WRITE_EXTERNAL_STORAGE', label: 'Запись файлов' },
  { id: 'READ_PHONE_STATE', label: 'Состояние телефона' },
  { id: 'VIBRATE', label: 'Вибрация' },
  { id: 'BLUETOOTH', label: 'Bluetooth' },
  { id: 'NFC', label: 'NFC' },
  { id: 'USE_SIP', label: 'SIP-вызовы' },
];

export const ORIENTATIONS = [
  { id: 'unspecified', label: 'Не задана' },
  { id: 'portrait', label: 'Портрет' },
  { id: 'landscape', label: 'Альбом' },
  { id: 'sensor', label: 'Как в системе' },
];

export const DEFAULT_SETTINGS = {
  name: 'Sketch',
  packageName: 'com.example.sketch',
  minSdk: 24,
  targetSdk: 34,
  orientation: 'unspecified',
  permissions: ['INTERNET'],
  theme: 'dark',
  sketch: 'sketch.pde',
  adaptiveUi: true,
};

export function defaultSettingsFor(sketchName = 'sketch.pde') {
  const base = String(sketchName || 'sketch').replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9]+/g, ' ') || 'Sketch';
  const title = base.split(' ').filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('') || 'Sketch';
  const pkg = 'com.example.' + base.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return { ...DEFAULT_SETTINGS, name: title, packageName: pkg, sketch: sketchName };
}

export function sanitizePackageName(name) {
  const parts = String(name || '').split('.').map((p) => p.replace(/[^A-Za-z0-9_]/g, '')).filter(Boolean);
  return parts.length ? parts.join('.') : 'com.example.sketch';
}

export function isValidPackageName(name) {
  return /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(String(name || ''));
}

export function javaClassName(name) {
  const parts = String(name || 'Sketch').split(/[^A-Za-z0-9]+/).filter(Boolean);
  const out = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
  return /^[A-Za-z_]/.test(out) ? out : 'Sketch';
}

// ── чтение и запись настроек ──────────────────────────────────────────────────────────

export async function loadProject(root) {
  if (!root) return null;
  try {
    const res = await window.electronAPI?.getFileContent?.(joinPath(root, PROJECT_FILE));
    if (!res?.success || !res.content) return null;
    const data = JSON.parse(res.content);
    return { ...DEFAULT_SETTINGS, ...data };
  } catch (err) {
    return null;
  }
}

export async function saveProject(root, settings) {
  if (!root) return false;
  try {
    const res = await window.electronAPI?.writeFile?.(joinPath(root, PROJECT_FILE), JSON.stringify(settings, null, 2));
    return !!(res && res.success);
  } catch (err) {
    return false;
  }
}

export function joinPath(a, b) {
  const left = String(a || '').replace(/[\\/]+$/, '');
  return `${left}/${b}`;
}

// ── скетч → класс Java ────────────────────────────────────────────────────────────────

const OVERRIDABLE = [
  'setup', 'draw', 'mousePressed', 'mouseReleased', 'mouseDragged', 'mouseMoved',
  'keyPressed', 'keyReleased', 'touchStarted', 'touchMoved', 'touchEnded',
  'onSensorChanged', 'onPermissionGranted',
];

const METHOD_RE = /^\s*(?:(?:public|private|protected|static|final|abstract)\s+)*([A-Za-z_][\w<>\[\],.]*)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/;
const FIELD_RE = /^\s*(?:(?:public|private|protected|static|final|volatile|transient)\s+)*([A-Za-z_][\w.]*(?:\s*<[^<>]*>)?(?:\s*\[\s*\])*)\s+([A-Za-z_]\w*)\s*(?:=[^;]*)?;\s*$/;
const STATEMENT_WORDS = /^(?:return|if|else|for|while|do|switch|case|default|break|continue|try|catch|finally|throw|new|println|print)\b/;

/** Processing считает 0.14 литералом float; javac — double. */
function javaifyFloats(text) {
  let out = '';
  let inString = false;
  let quote = '';
  let inBlock = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inBlock) {
      out += ch;
      if (ch === '*' && next === '/') { out += '/'; i++; inBlock = false; }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === '\\') { out += text[++i] || ''; continue; }
      if (ch === quote) inString = false;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') { out += text[i]; i++; }
      if (i < text.length) out += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlock = true;
      out += '/*';
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      out += ch;
      continue;
    }
    if (ch >= '0' && ch <= '9') {
      const rest = text.slice(i);
      const match = rest.match(/^(\d+\.\d+)(?![eEfF\d])/);
      if (match) {
        out += match[1] + 'f';
        i += match[1].length - 1;
        continue;
      }
    }
    out += ch;
  }
  return out;
}

/**
 * Разбирает .pde: верхнеуровневые объявления становятся полями класса,
 * верхнеуровневые операторы — началом setup(), методы — методами класса.
 */
function sketchText(source) {
  if (Array.isArray(source)) return source.map((s) => s?.code || '').join('\n');
  return String(source || '');
}

function sketchMentionsAdaptive(source) {
  return /\bAdaptiveUI\s*\./.test(sketchText(source));
}

function hasAdaptiveAttach(source) {
  return /\bAdaptiveUI\s*\.\s*attach\s*\(/.test(sketchText(source));
}

export function sketchToJava(source, className = 'Sketch', pkg = '', opts = {}) {
  const sources = Array.isArray(source)
    ? source.map((s) => ({ name: s.name || 'sketch.pde', code: s.code || '' }))
    : [{ name: 'sketch.pde', code: String(source || '') }];
  const fields = [];
  const setupPrelude = [];
  const methods = [];
  const classes = [];
  const imports = new Set([
    'import java.util.ArrayList;',
    'import java.util.HashMap;',
    'import java.util.List;',
    'import android.content.Context;',
  ]);

  // Все вкладки .pde склеиваются в один класс — как в preprocessor Processing.
  sources.forEach((file, fileIndex) => {
    const parsed = parseSketchFile(file.code, fileIndex === 0);
    parsed.imports.forEach((imp) => {
      // AdaptiveUI лежит в том же пакете, что и скетч — `import AdaptiveUI;` в Java невалиден.
      if (/^import\s+(?:[\w.]+\.)?AdaptiveUI\s*;$/.test(imp)) return;
      imports.add(imp);
    });
    fields.push(...parsed.fields);
    setupPrelude.push(...parsed.prelude);
    methods.push(...parsed.methods);
    classes.push(...parsed.classes);
  });

  const setup = methods.find((m) => m.name === 'setup');
  const draw = methods.find((m) => m.name === 'draw');
  const others = methods.filter((m) => m !== setup && m !== draw);

  const out = [];
  if (pkg) {
    out.push(`package ${pkg};`);
    out.push('');
  }
  for (const imp of imports) out.push(imp);
  out.push('');
  out.push(`public class ${className} extends PApplet {`);
  out.push('');
  out.push(`  public ${className}(Context context) { super(context); }`);
  out.push('');
  for (const field of fields) out.push(`  ${field}`);
  if (fields.length) out.push('');

  out.push('  @Override');
  out.push('  public void setup() {');
  for (const line of setupPrelude) out.push(line ? `  ${line}` : '');
  for (const line of (setup?.body || [])) out.push(`  ${line}`);
  if (opts.adaptiveUi && !hasAdaptiveAttach(source)) {
    out.push('    AdaptiveUI.attach(this);');
  }
  out.push('  }');
  out.push('');

  out.push('  @Override');
  out.push('  public void draw() {');
  for (const line of (draw?.body || [])) out.push(`  ${line}`);
  out.push('  }');

  for (const method of others) {
    out.push('');
    if (OVERRIDABLE.includes(method.name)) out.push('  @Override');
    out.push(`  public ${method.returnType} ${method.name}(${method.params.replace(/\bfinal\s+/g, '')}) {`);
    for (const line of method.body) out.push(`  ${line}`);
    out.push('  }');
  }

  // Вложенные классы: в Java у вложенного класса не может быть public.
  for (const cls of classes) {
    out.push('');
    const header = cls.header.trim().replace(/^(?:public|private|protected)\s+/, '').replace(/^static\s+/, '');
    out.push(`  ${header}`);
    for (const line of cls.body) out.push(line ? `  ${line}` : '');
    out.push('  }');
  }
  out.push('}');
  return javaifyFloats(out.join('\n'));
}

/** Разбирает один .pde: поля, операторы, методы и вложенные классы. */
function parseSketchFile(source, isMain) {
  const lines = String(source || '').split('\n');
  const fields = [];
  const prelude = [];
  const methods = [];
  const classes = [];
  const imports = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')
      || trimmed.startsWith('package ')) {
      i++;
      continue;
    }

    if (trimmed.startsWith('import ')) {
      imports.push(trimmed.replace(/;?\s*$/, '') + ';');
      i++;
      continue;
    }

    // Внутренний класс sketch становится вложенным классом приложения.
    const classDecl = trimmed.match(/^(?:(?:public|private|protected|static|final|abstract)\s+)*class\s+([A-Za-z_]\w*)/);
    if (classDecl) {
      const body = [];
      let depth = countBraces(line);
      let started = line.includes('{');
      let j = i + 1;
      for (; j < lines.length; j++) {
        const current = lines[j];
        const nextDepth = depth + countBraces(current);
        if (started && nextDepth <= 0) break;
        body.push(current);
        depth = nextDepth;
        if (!started && current.includes('{')) started = true;
      }
      classes.push({ name: classDecl[1], header: line, body });
      i = j + 1;
      continue;
    }

    const decl = trimmed.match(METHOD_RE);
    if (decl && !trimmed.endsWith(';') && !STATEMENT_WORDS.test(trimmed)) {
      const open = trimmed.indexOf('{');
      const close = trimmed.lastIndexOf('}');
      if (open >= 0 && close > open) {
        // Метод целиком в одной строке: void setup() { size(100, 100); }
        methods.push({
          returnType: decl[1].trim(),
          name: decl[2],
          params: decl[3].trim(),
          body: [trimmed.slice(open + 1, close).trim()],
        });
        i++;
        continue;
      }
      // Метод в несколько строк: собираем тело до закрывающей скобки.
      const body = [];
      let depth = countBraces(line);
      let started = line.includes('{');
      let j = i + 1;
      for (; j < lines.length; j++) {
        const current = lines[j];
        const nextDepth = depth + countBraces(current);
        if (started && nextDepth <= 0) break; // закрывающая скобка — её ставим сами
        body.push(current);
        depth = nextDepth;
        if (!started && current.includes('{')) started = true;
      }
      methods.push({ returnType: decl[1].trim(), name: decl[2], params: decl[3].trim(), body });
      i = j + 1;
      continue;
    }

    const field = trimmed.match(FIELD_RE);
    if (field && !STATEMENT_WORDS.test(trimmed)) {
      fields.push(line.replace(/^\s*final\s+/, '').trim());
      i++;
      continue;
    }
    prelude.push(line);
    i++;
  }

  // setup()/draw() определяются только в основной вкладке.
  if (!isMain) {
    return {
      imports,
      fields,
      prelude,
      methods: methods.filter((m) => m.name !== 'setup' && m.name !== 'draw'),
      classes,
    };
  }
  return { imports, fields, prelude, methods, classes };
}

function countBraces(line) {
  let depth = 0;
  let inString = false;
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = true; quote = ch; continue; }
    if (ch === '/' && line[i + 1] === '/') break;
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  return depth;
}

// ── генерация Android-проекта ─────────────────────────────────────────────────────────

function gradleRoot(name) {
  return `// Сгенерировано Processing Studio
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "${name}"
include ':app'
`;
}

const GRADLEW_UNIX = `#!/bin/sh
# Gradle Wrapper — Processing Studio (macOS / Linux)
APP_HOME=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CLASSPATH="$APP_HOME/gradle/wrapper/gradle-wrapper.jar"
if [ -n "$JAVA_HOME" ] && [ -x "$JAVA_HOME/bin/java" ]; then
  JAVACMD="$JAVA_HOME/bin/java"
else
  JAVACMD="java"
fi
exec "$JAVACMD" -Dorg.gradle.appname=gradlew -classpath "$CLASSPATH" org.gradle.wrapper.GradleWrapperMain "$@"
`;

const GRADLEW_BAT = `@echo off
setlocal
set APP_HOME=%~dp0
set CLASSPATH=%APP_HOME%gradle\\wrapper\\gradle-wrapper.jar
if defined JAVA_HOME (
  set "JAVACMD=%JAVA_HOME%\\bin\\java.exe"
) else (
  set "JAVACMD=java.exe"
)
"%JAVACMD%" -Dorg.gradle.appname=gradlew -classpath "%CLASSPATH%" org.gradle.wrapper.GradleWrapperMain %*
`;

function gradleApp(settings) {
  return `plugins {
    id 'com.android.application'
}

android {
    namespace '${settings.packageName}'
    compileSdk ${settings.targetSdk}

    defaultConfig {
        applicationId "${settings.packageName}"
        minSdk ${settings.minSdk}
        targetSdk ${settings.targetSdk}
        versionCode 1
        versionName "1.0"
    }

    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }

    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }
}

dependencies {
}
`;
}

function manifest(settings) {
  const perms = (settings.permissions || []).map((p) => `    <uses-permission android:name="android.permission.${p}" />`).join('\n');
  const orientation = settings.orientation && settings.orientation !== 'unspecified'
    ? `\n            android:screenOrientation="${settings.orientation}"` : '';
  return `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

${perms}

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:roundIcon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:theme="@style/AppTheme">
        <activity
            android:name=".MainActivity"
            android:exported="true"${orientation}
            android:configChanges="orientation|screenSize|keyboardHidden|screenLayout|uiMode">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
`;
}

function mainActivity(pkg, className, adaptiveUi) {
  const adaptiveImport = adaptiveUi ? `\nimport ${pkg}.AdaptiveUI;\n` : '\n';
  const attach = adaptiveUi
    ? `\n    AdaptiveUI.attach(sketch);`
    : '';
  return `package ${pkg};
${adaptiveImport}import android.app.Activity;
import android.os.Bundle;
import android.view.WindowManager;

/** Точка входа: держит экран и передаёт результаты запросов разрешений скетчу. */
public class MainActivity extends Activity {

  private ${className} sketch;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    sketch = new ${className}(this);${attach}
    setContentView(sketch);
  }

  @Override
  public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    if (sketch != null) sketch.onRequestPermissionsResult(requestCode, permissions, grantResults);
  }
}
`;
}

const RES_VALUES = (settings) => ({
  'res/values/strings.xml': `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">${settings.name}</string>
</resources>
`,
  'res/values/colors.xml': `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#1E1F22</color>
</resources>
`,
  'res/values/themes.xml': `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme" parent="android:Theme.Material.NoActionBar">
        <item name="android:windowBackground">#1E1F22</item>
        <item name="android:statusBarColor">#1E1F22</item>
    </style>
</resources>
`,
});

const LAUNCHER_ADAPTIVE = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
</adaptive-icon>
`;

const LAUNCHER_FOREGROUND = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:fillColor="#548AF7"
        android:pathData="M38,32 h18 a12,12 0 0 1 0,24 h-8 v20 h-10 z M48,42 h7 a4,4 0 0 1 0,8 h-7 z" />
</vector>
`;

async function copyDataAssets(root, write) {
  const listed = await window.electronAPI?.listFiles?.(joinPath(root, 'data'));
  const files = listed?.files || [];
  for (const file of files) {
    if (file.isDirectory || !file.path) continue;
    const res = await window.electronAPI?.getFileContent?.(file.path);
    if (!res?.success || res.content == null) continue;
    await write(`app/src/main/assets/${file.name}`, res.content);
  }
}

async function resolveAdaptiveSource(root, pkg, runtime) {
  const fallback = String(runtime?.adaptiveUi || ADAPTIVE_UI_JAVA).replace('%(package)s', pkg);
  if (!root) return fallback;
  try {
    const libRes = await window.electronAPI?.getFileContent?.(joinPath(root, 'libraries/AdaptiveUI.java'));
    const raw = libRes?.success ? String(libRes.content || '') : '';
    if (!raw || !/\bclass\s+AdaptiveUI\b/.test(raw)) return fallback;
    if (/^package\s+[\w.]+;/m.test(raw)) return raw.replace(/^package\s+[\w.]+;/m, `package ${pkg};`);
    return `package ${pkg};\n\n${raw}`;
  } catch {
    return fallback;
  }
}

/**
 * Создаёт Android-проект рядом со скетчем.
 * @returns {{ ok: boolean, path?: string, error?: string, files?: number }}
 */
export async function exportAndroidProject({ root, sketchSource, sketchName, settings, runtime }) {
  if (!root) return { ok: false, error: 'Проект не открыт' };
  const pkg = sanitizePackageName(settings.packageName);
  const className = javaClassName(settings.name);
  const appDir = joinPath(root, 'android');
  const javaDir = joinPath(joinPath(joinPath(appDir, 'app'), 'src'), 'main');
  const javaPath = joinPath(javaDir, 'java');
  const resDir = joinPath(javaDir, 'res');
  const pkgPath = pkg.split('.').join('/');
  const javaPackageDir = joinPath(javaPath, pkgPath);
  const finalSettings = { ...settings, packageName: pkg, name: settings.name || className };

  const write = async (relative, content) => {
    const res = await window.electronAPI?.writeFile?.(joinPath(appDir, relative), content);
    if (!res || !res.success) throw new Error(res?.error || `Не удалось записать ${relative}`);
  };

  try {
    // Keep existing source files in android/: users may have edited the Gradle project.
    await write('settings.gradle', gradleRoot(finalSettings.name));
    await write('build.gradle', `// Сгенерировано Processing Studio\nplugins {\n    id 'com.android.application' version '8.5.2' apply false\n}\n`);
    await write('gradle.properties', `org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8\nandroid.useAndroidX=true\nandroid.nonTransitiveRClass=true\nandroid.builder.sdkDownload=false\n`);
    await write('gradle/wrapper/gradle-wrapper.properties', `distributionBase=GRADLE_USER_HOME\ndistributionPath=wrapper/dists\ndistributionUrl=https\\://services.gradle.org/distributions/gradle-8.7-bin.zip\nzipStoreBase=GRADLE_USER_HOME\nzipStorePath=wrapper/dists\n`);
    await write('gradlew', GRADLEW_UNIX);
    await write('gradlew.bat', GRADLEW_BAT);
    await write('.gitignore', `/.gradle/\n/build/\n/app/build/\n/local.properties\n/captures/\n*.apk\n*.ap_\n`);
    await write('app/build.gradle', gradleApp(finalSettings));
    await write('app/proguard-rules.pro', '# Правила для Processing Studio\n');
    await write('app/src/main/AndroidManifest.xml', manifest(finalSettings));
    const adaptiveOn = !!finalSettings.adaptiveUi || sketchMentionsAdaptive(sketchSource);
    await write(`app/src/main/java/${pkgPath}/MainActivity.java`, mainActivity(pkg, className, adaptiveOn));
    await write(`app/src/main/java/${pkgPath}/${className}.java`, sketchToJava(sketchSource, className, pkg, { adaptiveUi: adaptiveOn }));
    await write(`app/src/main/java/${pkgPath}/PApplet.java`, runtime.pApplet.replace('%(package)s', pkg));
    await write(`app/src/main/java/${pkgPath}/PVector.java`, runtime.pVector.replace('%(package)s', pkg));
    await write(`app/src/main/java/${pkgPath}/PFont.java`, runtime.pFont.replace('%(package)s', pkg));
    if (runtime.json) {
      await write(`app/src/main/java/${pkgPath}/JSONObject.java`, runtime.json.replace('%(package)s', pkg));
    }
    await copyDataAssets(root, write);
    if (adaptiveOn) {
      await write(`app/src/main/java/${pkgPath}/AdaptiveUI.java`, await resolveAdaptiveSource(root, pkg, runtime));
    }
    for (const [file, content] of Object.entries(RES_VALUES(finalSettings))) {
      await write(`app/src/main/${file}`, content);
    }
    await write('app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml', LAUNCHER_ADAPTIVE);
    await write('app/src/main/res/drawable/ic_launcher_foreground.xml', LAUNCHER_FOREGROUND);
    const adaptiveNote = finalSettings.adaptiveUi
      ? `\n## Adaptive UI\n\nВ проект подключена библиотека \`AdaptiveUI\`: любой интерфейс из \`size()\` масштабируется под экран телефона, касания пересчитываются автоматически. Чтобы выключить: уберите \`AdaptiveUI.attach(sketch)\` в \`MainActivity\` или вызовите \`AdaptiveUI.detach(sketch)\`.\n`
      : '';
    await write('README.md', `# ${finalSettings.name}\n\nAndroid-проект, созданный Processing Studio из скетча \`${sketchName || finalSettings.sketch}\`.\n\n## Сборка\n\nВ IDE: **Запуск → Собрать**. На любом macOS / Windows / Linux студия сама найдёт JDK 17–21 и Android SDK или поставит их в \`Documents/ProcessingStudio/toolchain\`.\n\nВ папке \`android\` есть Gradle Wrapper: \`./gradlew assembleDebug\` (Windows: \`gradlew.bat\`). JDK задайте через \`JAVA_HOME\`, путь к SDK — в \`local.properties\` (файл локальный, в git не входит).\n\nЛибо откройте папку в Android Studio.\n\nПриложение использует собственный рантайм \`PApplet\` — Processing for Android не требуется.\n${adaptiveNote}\nPackage: \`${pkg}\`\nMin SDK: ${finalSettings.minSdk}, Target SDK: ${finalSettings.targetSdk}\n`);
    return { ok: true, path: appDir };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
