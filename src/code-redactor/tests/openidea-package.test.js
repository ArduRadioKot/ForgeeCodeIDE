const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { readOpenIdeaPackage, packageFile } = require('../lib/openidea-package');

async function scratch(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'frogee-openidea-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('imports the OpenIDEA theme and applies the separate editor scheme', async (t) => {
  const root = await scratch(t);
  await fs.writeFile(path.join(root, 'plugin.toml'), [
    'id = "openidea.test-theme"',
    'name = "Test"',
    'version = "1.0.0"',
    '[[contributes.themes]]',
    'path = "theme.json"',
    'editor-scheme = "scheme.json"',
  ].join('\n'));
  await fs.writeFile(path.join(root, 'theme.json'), JSON.stringify({
    name: 'Test', kind: 'light', tokens: { '--accent': '#226688', '--syn-keyword': '#114477' },
  }));
  await fs.writeFile(path.join(root, 'scheme.json'), JSON.stringify({ tokens: { '--syn-keyword': '#557799' } }));
  const bundle = await readOpenIdeaPackage(root, JSON.parse);
  assert.equal(bundle.themes[0].content.type, 'light');
  assert.equal(bundle.themes[0].content.colors['accent-color'], '#226688');
  assert.equal(bundle.themes[0].content.syntax.keyword, '#557799');
  assert.deepEqual(bundle.files, ['plugin.toml', 'theme.json', 'scheme.json']);
});

test('refuses required OpenIDEA capabilities that the editor does not provide', async (t) => {
  const root = await scratch(t);
  await fs.writeFile(path.join(root, 'plugin.toml'), [
    'id = "openidea.test"',
    'name = "Test"',
    'version = "1.0.0"',
    'wasm = "component.wasm"',
    '[capabilities]',
    'required = ["project.read"]',
  ].join('\n'));
  await fs.writeFile(path.join(root, 'component.wasm'), Buffer.from([0, 97, 115, 109, 13, 0, 1, 0]));
  await assert.rejects(readOpenIdeaPackage(root, JSON.parse), /Unsupported required OpenIDEA capabilities: project\.read/);
});

test('rejects plugin asset paths that resolve outside their folder', async (t) => {
  const root = await scratch(t);
  await fs.mkdir(path.join(root, 'package'));
  await fs.writeFile(path.join(root, 'outside.json'), '{}');
  await assert.rejects(packageFile(path.join(root, 'package'), '../outside.json'), /inside its package/);
});
