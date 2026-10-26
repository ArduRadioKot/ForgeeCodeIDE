#!/usr/bin/env node
/**
 * Builds the FrogeeCodeIDE extension catalog for the website.
 *
 *   node scripts/build-extensions.js
 *
 * Every folder in extensions/ with an extension.json is copied as is to website/extensions/<publisher>.<name>/,
 * and website/extensions/index.json lists them with their files — the editor reads it from
 * https://arduradiokot.github.io/ForgeeCodeIDE/extensions/index.json and downloads the files one by one.
 * No archives and no dependencies.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'extensions');
const OUT = path.join(ROOT, 'website', 'extensions');
const SKIP = /(^|\/)(node_modules|\.git|\.DS_Store)(\/|$)/;
const ID_RE = /^[a-z0-9][\w.-]{0,100}$/i;

function walk(dir, base = dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    const rel = path.relative(base, full).split(path.sep).join('/');
    if (SKIP.test(rel)) continue;
    if (ent.isDirectory()) out.push(...walk(full, base));
    else out.push(rel);
  }
  return out.sort();
}

function check(name, m, files) {
  for (const key of ['publisher', 'name', 'version']) if (!m[key]) throw new Error(`${name}/extension.json: нет поля ${key}`);
  if (!ID_RE.test(m.publisher) || !ID_RE.test(m.name)) throw new Error(`${name}/extension.json: publisher и name — латиница, цифры, точка, дефис`);
  const has = new Set(files);
  for (const p of m.plugins || []) if (!has.has(p)) throw new Error(`${name}: нет файла плагина ${p}`);
  for (const t of m.themes || []) if (!has.has(t.path)) throw new Error(`${name}: нет файла темы ${t.path}`);
  for (const s of m.snippets || []) if (!has.has(s.path)) throw new Error(`${name}: нет файла сниппетов ${s.path}`);
  if (m.icon && !has.has(m.icon)) throw new Error(`${name}: нет иконки ${m.icon}`);
  if (!(m.plugins || []).length && !(m.themes || []).length && !(m.snippets || []).length) throw new Error(`${name}: в extension.json нет ни плагинов, ни тем, ни сниппетов`);
}

function build() {
  const list = [];
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  for (const ent of fs.readdirSync(SRC, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const dir = path.join(SRC, ent.name);
    const manifestFile = path.join(dir, 'extension.json');
    if (!fs.existsSync(manifestFile)) continue;
    const m = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const files = walk(dir);
    check(ent.name, m, files);

    const id = `${m.publisher}.${m.name}`;
    const target = path.join(OUT, id);
    let size = 0;
    for (const rel of files) {
      const to = path.join(target, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(path.join(dir, rel), to);
      size += fs.statSync(to).size;
    }
    list.push({
      id,
      publisher: m.publisher,
      name: m.name,
      displayName: m.displayName || m.name,
      description: m.description || '',
      version: m.version,
      author: m.author || m.publisher,
      tags: m.keywords || [],
      icon: m.icon || '',
      path: `${id}/`,
      files,
      size,
      plugins: (m.plugins || []).length,
      themes: (m.themes || []).length,
      snippets: (m.snippets || []).length,
      license: m.license || '',
      repository: m.repository || '',
    });
    console.log(`  ${id} ${m.version}: ${files.length} файлов, ${Math.round(size / 1024)} КБ`);
  }
  list.sort((a, b) => a.displayName.localeCompare(b.displayName, 'ru'));
  const index = { version: 2, updated: new Date().toISOString().slice(0, 10), extensions: list };
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  console.log(`Каталог: ${path.relative(ROOT, path.join(OUT, 'index.json'))}, расширений: ${list.length}`);
}

build();
