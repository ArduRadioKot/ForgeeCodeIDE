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
    const data = await fs.readFile(configFile, 'utf8');
    return JSON.parse(data);
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
    await fs.writeFile(configFile, JSON.stringify(config, null, 2), 'utf8');
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
  
  // Загружаем API ключ OpenRouter из localStorage (через main process)
  try {
    const configPath = path.join(app.getPath('userData'), 'config.json');
    const configData = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(configData);
    openRouterApiKey = config.openRouterApiKey;
  } catch (error) {
    console.log('OpenRouter API ключ не найден');
  }
  
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
    openRouterApiKey = apiKey;
    const config = await loadConfig();
    config.openRouterApiKey = apiKey;
    await saveConfig(config);
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
    throw new Error(`OpenRouter API ошибка: ${error.message}`);
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