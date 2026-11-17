const fs = require('node:fs/promises');
const path = require('node:path');

const json = (value) => JSON.stringify(value, null, 2) + '\n';
const nodeProject = (name, scripts, dependencies, devDependencies = {}) => json({
  name, version: '0.1.0', private: true, type: 'module', scripts,
  dependencies, devDependencies,
});
const html = (name, script, css = '') => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${name}</title>
  ${css}
</head>
<body>
  <main id="app"></main>
  <script type="module" src="${script}"></script>
</body>
</html>
`;
const templates = new Map([
  ['html', (name) => ({
    'index.html': html(name, './main.js', '<link rel="stylesheet" href="./style.css">'),
    'main.js': "document.querySelector('#app').textContent = 'Hello, world!';\n",
    'style.css': 'body { font-family: system-ui, sans-serif; margin: 2rem; }\n',
  })],
  ['node', (name) => ({
    'package.json': nodeProject(name, { start: 'node src/index.js', test: 'node --test' }, {}),
    'src/index.js': "console.log('Hello, world!');\n",
    '.gitignore': 'node_modules/\n.env\n',
  })],
  ['express', (name) => ({
    'package.json': nodeProject(name, { start: 'node src/index.js', dev: 'node --watch src/index.js' }, { express: '^5.0.0' }),
    'src/index.js': "import express from 'express';\n\nconst app = express();\napp.get('/', (_req, res) => res.json({ ok: true }));\napp.listen(process.env.PORT || 3000);\n",
    '.gitignore': 'node_modules/\n.env\n',
  })],
  ['react', (name) => ({
    'package.json': nodeProject(name, { dev: 'vite', build: 'vite build', preview: 'vite preview' }, { react: '^19.0.0', 'react-dom': '^19.0.0' }, { vite: '^7.0.0', '@vitejs/plugin-react': '^5.0.0', typescript: '^5.8.0', '@types/react': '^19.0.0', '@types/react-dom': '^19.0.0' }),
    'vite.config.js': "import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({ plugins: [react()] });\n",
    'tsconfig.json': json({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', strict: true, noEmit: true }, include: ['src'] }),
    'index.html': html(name, '/src/main.tsx'),
    'src/main.tsx': "import { createRoot } from 'react-dom/client';\n\ncreateRoot(document.getElementById('app')!).render(<h1>Hello, world!</h1>);\n",
    '.gitignore': 'node_modules/\ndist/\n.env\n',
  })],
  ['python', (name) => ({
    'pyproject.toml': `[project]\nname = "${name}"\nversion = "0.1.0"\nrequires-python = ">=3.10"\ndependencies = []\n`,
    'main.py': 'def main():\n    print("Hello, world!")\n\n\nif __name__ == "__main__":\n    main()\n',
    '.gitignore': '.venv/\n__pycache__/\n.env\n',
  })],
  ['fastapi', (name) => ({
    'pyproject.toml': `[project]\nname = "${name}"\nversion = "0.1.0"\nrequires-python = ">=3.10"\ndependencies = ["fastapi", "uvicorn"]\n`,
    'requirements.txt': 'fastapi\nuvicorn\n',
    'main.py': 'from fastapi import FastAPI\n\napp = FastAPI()\n\n\n@app.get("/")\ndef index():\n    return {"ok": True}\n',
    '.gitignore': '.venv/\n__pycache__/\n.env\n',
  })],
  ['go', (name) => ({
    'go.mod': `module example.com/${name}\n\ngo 1.22\n`,
    'main.go': 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Hello, world!")\n}\n',
  })],
  ['rust', (name) => ({
    'Cargo.toml': `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\n`,
    'src/main.rs': 'fn main() {\n    println!("Hello, world!");\n}\n',
    '.gitignore': '/target/\n',
  })],
]);

async function createProject(parent, name, template) {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(name) || !templates.has(template)) throw new Error('Use a project name such as my-app and select a template.');
  const root = path.join(parent, name);
  await fs.mkdir(root);
  try {
    for (const [file, content] of Object.entries(templates.get(template)(name))) {
      const target = path.join(root, file);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, { flag: 'wx' });
    }
    return root;
  } catch (error) {
    await fs.rm(root, { recursive: true, force: true });
    throw error;
  }
}

module.exports = { createProject };
