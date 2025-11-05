const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const axios = require('axios');
const { spawn } = require('child_process');
const os = require('os');

// Константы
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1';
let openRouterApiKey = '';

// Путь к конфигурации в папке Documents/FrogeeCodeIDE/config
const documentsPath = path.join(os.homedir(), 'Documents');
const configDir = path.join(documentsPath, 'FrogeeCodeIDE', 'config');
const configFile = path.join(configDir, 'settings.json');
const alternativeConfigFile = path.join(configDir, 'config.json');

// Функции для работы с конфигурацией
async function ensureConfigDir() {
  try {
    // Создаем папку Documents/FrogeeCodeIDE если её нет
    const frogeeCodeIDEPath = path.join(documentsPath, 'FrogeeCodeIDE');
    try {
      await fs.access(frogeeCodeIDEPath);
    } catch {
      await fs.mkdir(frogeeCodeIDEPath, { recursive: true });
    }
    
    // Создаем папку config если её нет
    try {
      await fs.access(configDir);
    } catch {
      await fs.mkdir(configDir, { recursive: true });
    }
  } catch (error) {
    console.error('Ошибка создания папок конфигурации:', error);
  }
}

async function loadConfig() {
  try {
    await ensureConfigDir();
    // Пробуем прочитать основной файл настроек
    try {
      const data = await fs.readFile(configFile, 'utf8');
      return JSON.parse(data);
    } catch {
      // Если его нет, пробуем альтернативный файл config.json
      try {
        const altData = await fs.readFile(alternativeConfigFile, 'utf8');
        const parsed = JSON.parse(altData);
        // Сохраняем как основной для единообразия
        try {
          await fs.writeFile(configFile, JSON.stringify(parsed, null, 2), 'utf8');
        } catch (copyErr) {
          console.error('Не удалось скопировать config.json в settings.json:', copyErr);
        }
        return parsed;
      } catch {
        // Пойдём на дефолты
      }
    }
  } catch {
    // Возвращаем настройки по умолчанию
    return {
      fontSize: '16',
      theme: 'dark',
      tabSize: '4',
      defaultAiProvider: 'ollama',
      currentAiProvider: 'ollama',
      currentAiModel: 'llama3',
      showWelcomePage: true,
      editorTabs: [],
      chatHistory: []
    };
  }
}

async function saveConfig(config) {
  try {
    await ensureConfigDir();
    // Мержим с текущей конфигурацией, чтобы не терять поля вроде openRouterApiKey
    let current = {};
    try {
      current = await loadConfig();
    } catch {}
    const merged = { ...current, ...config };
    await fs.writeFile(configFile, JSON.stringify(merged, null, 2), 'utf8');
    // Также поддерживаем дубликат под новым именем для совместимости
    try {
      await fs.writeFile(alternativeConfigFile, JSON.stringify(merged, null, 2), 'utf8');
    } catch (mirrorErr) {
      console.warn('Не удалось записать альтернативный конфиг config.json:', mirrorErr?.message || mirrorErr);
    }
    return { success: true };
  } catch (error) {
    console.error('Ошибка сохранения конфигурации:', error);
    return { success: false, error: error.message };
  }
}

let ollamaProcess = null;
let mainWindow = null;

async function checkOllamaRunning() {
  try {
    await axios.get('http://localhost:11434/api/tags', { timeout: 1000 });
    return true;
  } catch {
    return false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  mainWindow.loadFile('index.html');
}

app.whenReady().then(async () => {
  // Проверяем, запущен ли Ollama, но не запускаем его автоматически
  const ollamaRunning = await checkOllamaRunning();
  if (!ollamaRunning) {
    console.log('Ollama не запущен. Пользователь должен запустить его вручную.');
  }
  
  // Загружаем конфигурацию при запуске
  const config = await loadConfig();
  openRouterApiKey = config.openRouterApiKey || '';
  
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// Обработчики IPC
ipcMain.handle('open-file', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'All Files', extensions: ['*'] },
        { name: 'Text Files', extensions: ['txt', 'md', 'js', 'py', 'html', 'css', 'json'] }
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
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'openDirectory'],
      filters: [
        { name: 'All Files', extensions: ['*'] },
        { name: 'Text Files', extensions: ['txt', 'md', 'js', 'py', 'html', 'css', 'json'] }
      ]
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const path = result.filePaths[0];
      const stats = await fs.stat(path);
      
      if (stats.isDirectory()) {
        return { success: true, isDirectory: true, path };
      } else {
        const content = await fs.readFile(path, 'utf8');
        return { success: true, isDirectory: false, filePath: path, content };
      }
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

// Обработчики для операций с файлами в explorer
ipcMain.handle('create-file-in-folder', async (event, folderPath, fileName) => {
  try {
    const filePath = path.join(folderPath, fileName);
    // Проверяем, существует ли файл
    try {
      await fs.access(filePath);
      return { success: false, error: 'Файл уже существует' };
    } catch {
      // Файл не существует, создаём его
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
    // Проверяем, существует ли папка
    try {
      await fs.access(folderPath);
      return { success: false, error: 'Папка уже существует' };
    } catch {
      // Папка не существует, создаём её
      await fs.mkdir(folderPath, { recursive: true });
      return { success: true, folderPath };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('rename-file', async (event, oldPath, newName) => {
  try {
    // Нормализуем пути
    const normalizedOldPath = path.normalize(oldPath);
    
    // Проверяем, что исходный файл существует
    try {
      await fs.access(normalizedOldPath);
    } catch (err) {
      console.error('Исходный файл не найден:', normalizedOldPath, err);
      return { success: false, error: 'Исходный файл не найден' };
    }
    
    // Проверяем недопустимые символы в имени файла (зависит от ОС)
    const invalidChars = process.platform === 'win32' 
      ? /[<>:"|?*]/ 
      : /[\/]/;
    if (invalidChars.test(newName)) {
      return { success: false, error: 'Имя файла содержит недопустимые символы' };
    }
    
    // Проверяем, что имя не пустое
    if (!newName || !newName.trim()) {
      return { success: false, error: 'Имя файла не может быть пустым' };
    }
    
    const dir = path.dirname(normalizedOldPath);
    const newPath = path.join(dir, newName.trim());
    const normalizedNewPath = path.normalize(newPath);
    
    // Проверяем, что новое имя не совпадает со старым
    if (normalizedOldPath === normalizedNewPath) {
      return { success: false, error: 'Новое имя совпадает со старым' };
    }
    
    // Проверяем, существует ли файл с новым именем
    try {
      await fs.access(normalizedNewPath);
      return { success: false, error: 'Файл с таким именем уже существует' };
    } catch {
      // Файл с новым именем не существует, можно переименовывать
    }
    
    console.log('Переименование файла:', normalizedOldPath, '->', normalizedNewPath);
    
    // Переименовываем
    await fs.rename(normalizedOldPath, normalizedNewPath);
    
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

// Рекурсивная функция для поиска всех файлов в папке
async function getAllFiles(dirPath, arrayOfFiles = []) {
  const files = await fs.readdir(dirPath, { withFileTypes: true });
  
  for (const file of files) {
    const filePath = path.join(dirPath, file.name);
    
    // Пропускаем скрытые папки и node_modules
    if (file.isDirectory() && !file.name.startsWith('.') && file.name !== 'node_modules') {
      arrayOfFiles = await getAllFiles(filePath, arrayOfFiles);
    } else if (file.isFile()) {
      arrayOfFiles.push(filePath);
    }
  }
  
  return arrayOfFiles;
}

// Рекурсивная функция для копирования папки
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

// Поиск в файлах проекта
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
    
    // Получаем все файлы в папке
    const allFiles = await getAllFiles(folderPath);
    
    // Фильтруем файлы по типу
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
    
    // Создаем регулярное выражение
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
    
    // Ищем в каждом файле
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
      } catch (err) {
        // Пропускаем файлы, которые не удалось прочитать (бинарные и т.д.)
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
      // Для папок нужна рекурсивная копия
      await copyDirectory(sourcePath, destinationPath);
    } else {
      // Для файлов используем copyFile
      const { copyFile } = require('fs').promises;
      await copyFile(sourcePath, destinationPath);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-file', async (event, content) => {
  // Если файл уже открыт, сохраняем его
  // В реальном приложении нужно отслеживать текущий файл
  return await ipcMain.handle('save-file-as', event, content);
});

ipcMain.handle('save-file-as', async (event, content) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: [
      { name: 'Все файлы', extensions: ['*'] },
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

ipcMain.handle('new-file', async () => {
  return { success: true, content: '' };
});

// IPC обработчики для конфигурации
ipcMain.handle('load-config', async () => {
  return await loadConfig();
});

ipcMain.handle('save-config', async (event, config) => {
  return await saveConfig(config);
});

// Обновляем существующие обработчики для работы с конфигурацией
ipcMain.handle('set-openrouter-key', async (event, apiKey) => {
  try {
    const config = await loadConfig();
    config.openRouterApiKey = apiKey;
    await saveConfig(config);
    openRouterApiKey = apiKey;
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-openrouter-key', async () => {
  try {
    const config = await loadConfig();
    return config.openRouterApiKey || '';
  } catch (error) {
    return '';
  }
});

ipcMain.handle('get-openrouter-models', async () => {
  try {
    const response = await axios.get(`${OPENROUTER_API_URL}/models`);
    return { success: true, models: response.data.data };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Обновленная функция отправки сообщений с поддержкой OpenRouter
ipcMain.handle('send-message', async (event, message, model, useOpenRouter = false) => {
  try {
    if (useOpenRouter) {
      return await sendMessageOpenRouter(message, model, null, event);
    } else {
      return await sendMessageOllama(message, model, null, event);
    }
  } catch (err) {
    console.error('AI Error:', err);
    throw new Error(err.message || 'Неизвестная ошибка AI');
  }
});

async function sendMessageOpenRouter(message, model, signal, event) {
  if (!openRouterApiKey) {
    throw new Error('OpenRouter API ключ не настроен');
  }

  try {
    const response = await axios.post(`${OPENROUTER_API_URL}/chat/completions`, {
      model: model || 'openai/gpt-3.5-turbo',
      messages: [
        { role: 'user', content: message }
      ],
      stream: true
    }, {
      headers: {
        'Authorization': `Bearer ${openRouterApiKey}`,
        'Content-Type': 'application/json'
      },
      responseType: 'stream'
    });
    
    let aiMsg = '';
    
    return new Promise((resolve, reject) => {
      response.data.on('data', (chunk) => {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          if (line.trim() === '' || !line.startsWith('data: ')) continue;
          
          try {
            const data = JSON.parse(line.slice(6));
            if (data.choices && data.choices[0] && data.choices[0].delta && data.choices[0].delta.content) {
              const content = data.choices[0].delta.content;
              aiMsg += content;
              
              // Отправляем обновление в реальном времени
              event.sender.send('stream-update', { 
                content: content,
                fullMessage: aiMsg 
              });
            }
          } catch (e) {
            // Игнорируем невалидный JSON
          }
        }
      });
      
      response.data.on('end', () => {
        resolve({ answer: aiMsg, think: '' });
      });
      
      response.data.on('error', (err) => {
        reject(err);
      });
    });
  } catch (error) {
    console.error('OpenRouter API error:', error);
    let errorMessage = error.message;
    if (error.response) {
      errorMessage = `HTTP status ${error.response.status}: ${error.response.data?.error?.message || error.response.data}`;
    }
    throw new Error(`OpenRouter API ошибка: ${errorMessage}`);
  }
}

async function sendMessageOllama(message, model, signal, event) {
  try {
    const response = await axios.post('http://localhost:11434/api/chat', {
      model: model || 'llama3',
      messages: [
        { role: 'user', content: message }
      ],
      stream: true
    }, {
      responseType: 'stream'
    });
    
    let aiMsg = '';
    
    return new Promise((resolve, reject) => {
      response.data.on('data', (chunk) => {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          if (line.trim() === '') continue;
          try {
            const data = JSON.parse(line);
            if (data.message?.content) {
              aiMsg += data.message.content;
              // Отправляем обновление в реальном времени
              event.sender.send('stream-update', { 
                content: data.message.content,
                fullMessage: aiMsg 
              });
            }
          } catch (e) {
            // Игнорируем невалидный JSON
          }
        }
      });
      
      response.data.on('end', () => {
        resolve({ answer: aiMsg, think: '' });
      });
      
      response.data.on('error', (err) => {
        reject(err);
      });
    });
  } catch (error) {
    console.error('Ollama API error:', error);
    throw new Error(`Ollama API ошибка: ${error.message}`);
  }
}

// Существующие функции чата
ipcMain.handle('get-models', async () => {
  try {
    const response = await axios.get('http://localhost:11434/api/tags');
    return response.data.models.map(m => m.name);
  } catch (err) {
    return [];
  }
});

ipcMain.handle('download-model', async (event, model) => {
  return new Promise((resolve) => {
    const proc = spawn('ollama', ['pull', model]);
    let output = '';
    let error = '';
    proc.stdout.on('data', d => { output += d.toString(); });
    proc.stderr.on('data', d => { error += d.toString(); });
    proc.on('close', code => {
      if (code === 0) resolve({ success: true, output });
      else resolve({ success: false, error: error || output });
    });
  });
});

ipcMain.handle('delete-model', async (event, model) => {
  return new Promise((resolve) => {
    const proc = spawn('ollama', ['rm', model]);
    let output = '';
    let error = '';
    proc.stdout.on('data', d => { output += d.toString(); });
    proc.stderr.on('data', d => { error += d.toString(); });
    proc.on('close', code => {
      if (code === 0) resolve({ success: true, output });
      else resolve({ success: false, error: error || output });
    });
  });
}); 

ipcMain.handle('open-external', async (event, url) => {
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}); 