const path = require('node:path');
const fs = require('node:fs/promises');

const CAPABILITIES = new Set(['editor.read', 'editor.write']);
const ID = /^[a-z0-9][a-z0-9_.-]{0,99}$/i;
const COMPONENT_MAGIC = Buffer.from([0, 97, 115, 109, 13, 0, 1, 0]);
const MAX_WASM = 16 * 1024 * 1024;

/** Read a regular file that resolves inside the selected package. */
async function packageFile(root, relative, limit = 1024 * 1024) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || /[:\\]/.test(relative)) {
    throw new Error('Invalid path in plugin.toml');
  }
  const target = await fs.realpath(path.resolve(root, relative));
  const fromRoot = path.relative(await fs.realpath(root), target);
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith('..' + path.sep) || path.isAbsolute(fromRoot)) {
    throw new Error('A plugin file must be inside its package: ' + relative);
  }
  const info = await fs.stat(target);
  if (!info.isFile() || info.size > limit) throw new Error('Invalid or oversized plugin file: ' + relative);
  return target;
}

function records(items, kind) {
  if (items === undefined) return [];
  if (!Array.isArray(items) || items.length > 100) throw new Error('Invalid OpenIDEA ' + kind);
  const ids = new Set();
  return items.map(({ id, title }) => {
    if (!ID.test(id || '') || typeof title !== 'string' || !title.trim() || ids.has(id)) {
      throw new Error('Invalid or duplicate ' + kind + ' in plugin.toml');
    }
    ids.add(id);
    return { id, title: title.slice(0, 160) };
  });
}

async function readOpenIdeaPackage(root, parseJson) {
  const { parse } = await import('smol-toml');
  const read = async (file, limit) => fs.readFile(await packageFile(root, file, limit));
  const manifest = parse((await read('plugin.toml', 128 * 1024)).toString());
  const { id, name, version, wasm } = manifest;
  if (!ID.test(id || '') || typeof name !== 'string' || !name.trim() || typeof version !== 'string' || !version.trim()) {
    throw new Error('OpenIDEA plugin.toml must declare id, name and version');
  }
  const contributes = manifest.contributes || {};
  const files = ['plugin.toml'];
  const themes = [];
  for (const theme of contributes.themes || []) {
    const raw = parseJson((await read(theme.path)).toString());
    files.push(theme.path);
    let scheme;
    if (theme['editor-scheme']) {
      scheme = parseJson((await read(theme['editor-scheme'])).toString());
      files.push(theme['editor-scheme']);
    }
    themes.push({ path: theme.path, label: String(raw.name || name), content: convertOpenIdeaTheme(raw, scheme, manifest.authors?.[0]) });
  }

  let runtime;
  if (wasm) {
    const bytes = await read(wasm, MAX_WASM);
    if (!bytes.subarray(0, 8).equals(COMPONENT_MAGIC)) throw new Error('Expected a compiled OpenIDEA WebAssembly component');
    files.push(wasm);
    const required = manifest.capabilities?.required || [];
    if (!Array.isArray(required) || required.some((cap) => !CAPABILITIES.has(cap))) {
      throw new Error('Unsupported required OpenIDEA capabilities: ' + (Array.isArray(required) ? required.filter((cap) => !CAPABILITIES.has(cap)).join(', ') : 'invalid manifest'));
    }
    const commands = records(contributes.commands, 'commands');
    const views = records(contributes.views, 'views');
    if (!commands.length && !views.length) throw new Error('This OpenIDEA component declares no supported commands or tool views');
    const menuCommands = (contributes.menus || []).filter((item) => item.menu === 'editor.context').map((item) => item.command);
    const settings = Object.create(null);
    if (contributes.settings?.schema) {
      const schema = parseJson((await read(contributes.settings.schema)).toString());
      files.push(contributes.settings.schema);
      for (const [key, field] of Object.entries(schema.properties || {})) {
        if (field && Object.hasOwn(field, 'default')) settings[key] = JSON.stringify(field.default);
      }
    }
    runtime = { wasm, capabilities: [...new Set(required)], commands, views, menuCommands, settings };
  }
  if (!themes.length && !runtime) throw new Error('This package has no supported themes, commands or tool views');
  return { manifest, themes, runtime, files: [...new Set(files)] };
}

const COLORS = {
  'window-bg': '--bg-app', 'card-bg': '--bg-elev', 'header-bg': '--bg-elev',
  'code-bg': '--bg-input', 'editor-bg': '--bg-editor', 'text-color': '--fg',
  'text-muted': '--fg-secondary', 'text-faint': '--fg-muted', 'border-color': '--border',
  'hover-color': '--bg-hover', 'active-bg': '--bg-selected', 'accent-color': '--accent',
  'accent-text': '--fg-on-accent', 'link-color': '--link', selection: '--bg-selection',
  'success-color': '--success', 'warning-color': '--warning', 'danger-color': '--danger',
};

function convertOpenIdeaTheme(theme, scheme, author) {
  const tokens = { ...theme.tokens, ...scheme?.tokens };
  const colors = Object.fromEntries(Object.entries(COLORS).map(([key, token]) => [key, tokens[token]]));
  colors['editor-bg'] ||= tokens['--bg-input'] || tokens['--bg-app'];
  const syntax = {};
  for (const key of ['keyword', 'string', 'number', 'comment', 'function', 'type', 'field', 'tag', 'attr', 'heading', 'annotation']) {
    syntax[key] = tokens['--syn-' + key];
  }
  return { name: theme.name, type: theme.kind === 'light' ? 'light' : 'dark', author, colors, syntax };
}

module.exports = { readOpenIdeaPackage, packageFile, MAX_WASM };
