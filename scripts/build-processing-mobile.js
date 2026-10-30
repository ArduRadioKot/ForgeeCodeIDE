#!/usr/bin/env node
// Bundles the GPL-2.0 Processing Studio runtime into one FrogeeCodeIDE plugin.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourceDir = path.join(root, 'plugins', 'processing-mobile-src');
const output = path.join(root, 'extensions', 'processing-mobile', 'plugin.js');
const modules = ['android-runtime', 'android-project', 'device-transpile', 'device-runtime'];
const parts = [
  '// ==FrogeePlugin==',
  '// @name        Processing Mobile',
  '// @version     1.1.0',
  '// @description Эмулятор Processing, экспорт и сборка Android',
  '// @author      FrogeeSoft',
  '// ==/FrogeePlugin==',
  '// Processing Studio components: Copyright FrogeeSoft, GPL-2.0.',
  '// Source: https://github.com/ArduRadioKot/Processing-Studio',
];

for (const name of modules) {
  let source = fs.readFileSync(path.join(sourceDir, `${name}.js`), 'utf8');
  source = source.replace(/^import \{[^\n]+\} from '[^']+';\n/gm, '');
  source = source.replace(/^export (async )?(const|function) /gm, '$1$2 ');
  if (/^export (?:async )?(?:const|function) /m.test(source) || /^import \{/m.test(source)) throw new Error(`Unbundled module syntax in ${name}`);
  parts.push(`\n// ── ${name} (Processing Studio) ──\n${source}`);
}
parts.push(fs.readFileSync(path.join(sourceDir, 'plugin-source.js'), 'utf8'));
const bundled = parts.join('\n');
if (Buffer.byteLength(bundled) > 2 * 1024 * 1024) throw new Error('Plugin exceeds the FrogeeCodeIDE 2 MB limit');
fs.writeFileSync(output, bundled);
console.log(`${output}: ${Math.round(Buffer.byteLength(bundled) / 1024)} KB`);
