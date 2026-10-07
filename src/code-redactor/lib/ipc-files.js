const { ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;

function safeRemoveHandler(channel) {
  try {
    ipcMain.removeHandler(channel);
  } catch {}
}

async function getAllFiles(dirPath, arrayOfFiles = []) {
  const files = await fs.readdir(dirPath, { withFileTypes: true });

  for (const file of files) {
    const filePath = path.join(dirPath, file.name);

    if (file.isDirectory() && !file.name.startsWith('.') && file.name !== 'node_modules') {
      arrayOfFiles = await getAllFiles(filePath, arrayOfFiles);
    } else if (file.isFile()) {
      arrayOfFiles.push(filePath);
    }
  }

  return arrayOfFiles;
}

async function copyDirectory(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      const { copyFile } = require('fs').promises;
      await copyFile(srcPath, destPath);
    }
  }
}

const FILE_CHANNELS = [
  'open-file',
  'open-folder',
  'open-file-or-folder',
  'list-files',
  'get-file-content',
  'create-file-in-folder',
  'create-folder-in-folder',
  'rename-file',
  'delete-file',
  'search-in-files',
  'copy-file',
  'save-file',
  'save-file-as',
  'write-file',
  'run-python-code',
  'list-kernels',
  'list-python-envs',
  'run-kernel-code',
  'new-file'
];

function registerFileIpc(getMainWindow) {
  for (const ch of FILE_CHANNELS) safeRemoveHandler(ch);

  ipcMain.handle('open-file', async () => {
    try {
      const mainWindow = getMainWindow();
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [
          { name: 'All Files', extensions: ['*'] },
          { name: 'Text Files', extensions: ['txt', 'md', 'js', 'py', 'html', 'css', 'json', 'ipynb'] },
          { name: 'Jupyter Notebook', extensions: ['ipynb'] }
        ]
      });

      if (!result.canceled && result.filePaths.length > 0) {
        const filePath = result.filePaths[0];
        const content = await fs.readFile(filePath, 'utf8');
        return { success: true, filePath, content };
      }
      return { success: false, error: 'No file selected' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('open-folder', async () => {
    try {
      const mainWindow = getMainWindow();
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
      });

      if (!result.canceled && result.filePaths.length > 0) {
        const folderPath = result.filePaths[0];
        return { success: true, folderPath };
      }
      return { success: false, error: 'No folder selected' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('open-file-or-folder', async () => {
    try {
      const mainWindow = getMainWindow();
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile', 'openDirectory'],
        filters: [
          { name: 'All Files', extensions: ['*'] },
          { name: 'Text Files', extensions: ['txt', 'md', 'js', 'py', 'html', 'css', 'json', 'ipynb'] },
          { name: 'Jupyter Notebook', extensions: ['ipynb'] }
        ]
      });

      if (!result.canceled && result.filePaths.length > 0) {
        const selectedPath = result.filePaths[0];
        const stats = await fs.stat(selectedPath);

        if (stats.isDirectory()) {
          return { success: true, isDirectory: true, path: selectedPath };
        }
        const content = await fs.readFile(selectedPath, 'utf8');
        return { success: true, isDirectory: false, filePath: selectedPath, content };
      }
      return { success: false, error: 'No file or folder selected' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('list-files', async (event, folderPath) => {
    try {
      const files = await fs.readdir(folderPath, { withFileTypes: true });
      const fileList = files.map(file => ({
        name: file.name,
        isDirectory: file.isDirectory(),
        path: path.join(folderPath, file.name)
      }));
      return { success: true, files: fileList };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-file-content', async (event, filePath) => {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      return { success: true, content };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('create-file-in-folder', async (event, folderPath, fileName) => {
    try {
      const filePath = path.join(folderPath, fileName);
      try {
        await fs.access(filePath);
        return { success: false, error: 'Файл уже существует' };
      } catch {
        await fs.writeFile(filePath, '', 'utf8');
        return { success: true, filePath };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('create-folder-in-folder', async (event, parentPath, folderName) => {
    try {
      const folderPath = path.join(parentPath, folderName);
      try {
        await fs.access(folderPath);
        return { success: false, error: 'Папка уже существует' };
      } catch {
        await fs.mkdir(folderPath, { recursive: true });
        return { success: true, folderPath };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('rename-file', async (event, oldPath, newName) => {
    try {
      const normalizedOldPath = path.normalize(oldPath);

      try {
        await fs.access(normalizedOldPath);
      } catch (err) {
        console.error('Исходный файл не найден:', normalizedOldPath, err);
        return { success: false, error: 'Исходный файл не найден' };
      }

      const invalidChars = process.platform === 'win32'
        ? /[<>:"|?*]/
        : /[\/]/;
      if (invalidChars.test(newName)) {
        return { success: false, error: 'Имя файла содержит недопустимые символы' };
      }

      if (!newName || !newName.trim()) {
        return { success: false, error: 'Имя файла не может быть пустым' };
      }

      const dir = path.dirname(normalizedOldPath);
      const newPath = path.join(dir, newName.trim());
      const normalizedNewPath = path.normalize(newPath);

      if (normalizedOldPath === normalizedNewPath) {
        return { success: false, error: 'Новое имя совпадает со старым' };
      }

      try {
        await fs.access(normalizedNewPath);
        return { success: false, error: 'Файл с таким именем уже существует' };
      } catch {}

      console.log('Переименование файла:', normalizedOldPath, '->', normalizedNewPath);

      const onlyCaseChange = normalizedOldPath.toLowerCase() === normalizedNewPath.toLowerCase()
        && normalizedOldPath !== normalizedNewPath;

      if (onlyCaseChange) {
        const tempPath = path.join(dir, `.${Date.now()}_${newName.trim()}.tmp`);
        await fs.rename(normalizedOldPath, tempPath);
        await fs.rename(tempPath, normalizedNewPath);
      } else {
        await fs.rename(normalizedOldPath, normalizedNewPath);
      }

      console.log('Файл успешно переименован:', normalizedNewPath);
      return { success: true, newPath: normalizedNewPath };
    } catch (error) {
      console.error('Ошибка переименования файла:', error);
      return { success: false, error: error.message || 'Неизвестная ошибка при переименовании' };
    }
  });

  ipcMain.handle('delete-file', async (event, filePath) => {
    try {
      const stats = await fs.stat(filePath);
      if (stats.isDirectory()) {
        await fs.rmdir(filePath, { recursive: true });
      } else {
        await fs.unlink(filePath);
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('search-in-files', async (event, folderPath, query, options = {}) => {
    try {
      if (!folderPath) {
        return { success: false, error: 'Папка не открыта' };
      }

      const {
        caseSensitive = false,
        useRegex = false,
        fileFilter = ''
      } = options;

      const allFiles = await getAllFiles(folderPath);

      let filteredFiles = allFiles;
      if (fileFilter) {
        const filters = fileFilter.split(',').map(f => f.trim());
        filteredFiles = allFiles.filter(file => {
          const ext = path.extname(file).toLowerCase().slice(1);
          return filters.some(filter => {
            if (filter.startsWith('.')) {
              return file.toLowerCase().endsWith(filter.toLowerCase());
            }
            return ext === filter.toLowerCase();
          });
        });
      }

      const results = [];
      let regex;

      if (useRegex) {
        try {
          regex = new RegExp(query, caseSensitive ? 'g' : 'gi');
        } catch (err) {
          return { success: false, error: 'Неверное регулярное выражение: ' + err.message };
        }
      } else {
        const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        regex = new RegExp(escapedQuery, caseSensitive ? 'g' : 'gi');
      }

      for (const filePath of filteredFiles) {
        try {
          const content = await fs.readFile(filePath, 'utf8');
          const lines = content.split('\n');
          const fileMatches = [];

          lines.forEach((line, lineNumber) => {
            const matches = [...line.matchAll(regex)];
            if (matches.length > 0) {
              matches.forEach(match => {
                fileMatches.push({
                  line: lineNumber + 1,
                  text: line.trim(),
                  matchIndex: match.index,
                  matchText: match[0]
                });
              });
            }
          });

          if (fileMatches.length > 0) {
            const relativePath = path.relative(folderPath, filePath);
            results.push({
              file: relativePath,
              fullPath: filePath,
              matches: fileMatches,
              matchCount: fileMatches.length
            });
          }
        } catch {
          continue;
        }
      }

      return { success: true, results, totalMatches: results.reduce((sum, r) => sum + r.matchCount, 0) };
    } catch (error) {
      console.error('Ошибка поиска:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('copy-file', async (event, sourcePath, destinationPath) => {
    try {
      const stats = await fs.stat(sourcePath);
      if (stats.isDirectory()) {
        await copyDirectory(sourcePath, destinationPath);
      } else {
        const { copyFile } = require('fs').promises;
        await copyFile(sourcePath, destinationPath);
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('save-file', async (event, content) => {
    const mainWindow = getMainWindow();
    const result = await dialog.showSaveDialog(mainWindow, {
      filters: [
        { name: 'Все файлы', extensions: ['*'] },
        { name: 'Jupyter Notebook', extensions: ['ipynb'] },
        { name: 'Текстовые файлы', extensions: ['txt'] },
        { name: 'JavaScript', extensions: ['js'] },
        { name: 'Python', extensions: ['py'] },
        { name: 'HTML', extensions: ['html'] },
        { name: 'CSS', extensions: ['css'] }
      ]
    });

    if (!result.canceled && result.filePath) {
      try {
        await fs.writeFile(result.filePath, content, 'utf8');
        return { success: true, filePath: result.filePath };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
    return { success: false, canceled: true };
  });

  ipcMain.handle('save-file-as', async (event, content) => {
    const mainWindow = getMainWindow();
    const result = await dialog.showSaveDialog(mainWindow, {
      filters: [
        { name: 'Все файлы', extensions: ['*'] },
        { name: 'Jupyter Notebook', extensions: ['ipynb'] },
        { name: 'Текстовые файлы', extensions: ['txt'] },
        { name: 'JavaScript', extensions: ['js'] },
        { name: 'Python', extensions: ['py'] },
        { name: 'HTML', extensions: ['html'] },
        { name: 'CSS', extensions: ['css'] }
      ]
    });

    if (!result.canceled && result.filePath) {
      try {
        await fs.writeFile(result.filePath, content, 'utf8');
        return { success: true, filePath: result.filePath };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
    return { success: false, canceled: true };
  });

  ipcMain.handle('write-file', async (event, filePath, content) => {
    try {
      if (!filePath || typeof filePath !== 'string') {
        return { success: false, error: 'Не указан путь файла' };
      }
      await fs.writeFile(filePath, content ?? '', 'utf8');
      return { success: true, filePath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('run-python-code', async (event, payload = {}) => {
    return runKernelCode({
      ...(typeof payload === 'string' ? { code: payload } : payload),
      language: 'python'
    });
  });

  ipcMain.handle('list-python-envs', async (event, workspace) => {
    try {
      const { listPythonEnvironments } = require('./python-envs');
      const envs = await listPythonEnvironments(workspace || null);
      return { success: true, environments: envs };
    } catch (err) {
      return { success: false, error: err.message || String(err), environments: [] };
    }
  });

  // backward compat: same as list-python-envs
  ipcMain.handle('list-kernels', async (event, workspace) => {
    try {
      const { listPythonEnvironments } = require('./python-envs');
      const envs = await listPythonEnvironments(workspace || null);
      return {
        success: true,
        kernels: envs.map((e) => ({
          name: e.id || e.pythonPath,
          display_name: e.display_name,
          detail: e.detail,
          language: 'python',
          pythonPath: e.pythonPath,
          kind: e.kind,
          preferred: e.preferred,
          version: e.version
        }))
      };
    } catch (err) {
      return { success: false, error: err.message || String(err), kernels: [] };
    }
  });

  ipcMain.handle('run-kernel-code', async (event, payload = {}) => {
    return runKernelCode(payload || {});
  });

  ipcMain.handle('new-file', async () => {
    return { success: true, content: '' };
  });

  console.log('[files] IPC handlers registered');
}

function runKernelCode(payload = {}) {
  const { spawn } = require('child_process');
  const os = require('os');
  const fsSync = require('fs');
  const path = require('path');
  const code = payload.code || '';
  const cwd = payload.cwd || os.homedir();
  const language = (payload.language || 'python').toLowerCase();
  const pythonPath = payload.pythonPath || payload.interpreter || null;
  const kernelName = (payload.kernel || payload.kernelName || '').toLowerCase();

  let cmd;
  let args;
  let tmpFile = null;

  const isNode = /node|javascript|js/.test(kernelName) || language === 'javascript';
  const isBash = /bash|shell|sh|zsh/.test(kernelName) || language === 'bash' || language === 'shell';

  if (isNode) {
    cmd = 'node';
    args = ['-e', code];
  } else if (isBash) {
    cmd = process.platform === 'win32' ? 'bash' : (process.env.SHELL || '/bin/bash');
    args = ['-lc', code];
  } else {
    cmd = pythonPath
      || (process.platform === 'win32' ? 'python' : 'python3');
    tmpFile = path.join(os.tmpdir(), `frogee-nb-${Date.now()}-${Math.random().toString(36).slice(2)}.py`);
    try {
      fsSync.writeFileSync(tmpFile, code, 'utf8');
    } catch (err) {
      return Promise.resolve({ success: false, error: err.message, stdout: '', stderr: '' });
    }
    args = ['-u', tmpFile];
  }

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (tmpFile) {
        try { fsSync.unlinkSync(tmpFile); } catch {}
      }
      resolve(result);
    };

    let child;
    try {
      child = spawn(cmd, args, {
        cwd,
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (err) {
      finish({ success: false, error: err.message || String(err), stdout: '', stderr: '' });
      return;
    }

    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish({
        success: false,
        error: 'Timeout (30s)',
        stdout,
        stderr: stderr || 'Превышено время выполнения'
      });
    }, 30000);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      clearTimeout(timer);
      const missing = err.code === 'ENOENT';
      finish({
        success: false,
        error: missing
          ? `Интерпретатор не найден: ${cmd}. Выберите другой Python / venv.`
          : (err.message || String(err)),
        stdout,
        stderr
      });
    });
    child.on('close', (codeExit) => {
      clearTimeout(timer);
      finish({
        success: codeExit === 0,
        exitCode: codeExit,
        stdout,
        stderr,
        error: codeExit === 0 ? null : (stderr || `exit ${codeExit}`)
      });
    });
  });
}

module.exports = {
  registerFileIpc
};
