const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const axios = require('axios');
const { spawn } = require('child_process');

let ollamaProcess = null;
let mainWindow = null;

// Конфигурация OpenRouter
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1';
let openRouterApiKey = null;

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

// Функции для работы с файлами
ipcMain.handle('open-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Все файлы', extensions: ['*'] },
      { name: 'Текстовые файлы', extensions: ['txt', 'md', 'js', 'py', 'html', 'css', 'json', 'xml', 'csv'] },
      { name: 'JavaScript', extensions: ['js', 'jsx', 'ts', 'tsx'] },
      { name: 'Python', extensions: ['py', 'pyw'] },
      { name: 'HTML', extensions: ['html', 'htm'] },
      { name: 'CSS', extensions: ['css', 'scss', 'sass'] }
    ]
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    const filePath = result.filePaths[0];
    try {
      const content = await fs.readFile(filePath, 'utf8');
      return { success: true, filePath, content };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  return { success: false, canceled: true };
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

ipcMain.handle('get-file-content', async (event, filePath) => {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return { success: true, content };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('list-files', async (event, directory) => {
  try {
    const files = await fs.readdir(directory, { withFileTypes: true });
    return files.map(file => ({
      name: file.name,
      isDirectory: file.isDirectory(),
      path: path.join(directory, file.name)
    }));
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Функции для работы с OpenRouter
ipcMain.handle('set-openrouter-key', async (event, apiKey) => {
  try {
    openRouterApiKey = apiKey;
    const configPath = path.join(app.getPath('userData'), 'config.json');
    const config = { openRouterApiKey: apiKey };
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-openrouter-key', async () => {
  return { success: true, apiKey: openRouterApiKey };
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
ipcMain.handle('send-message', async (event, { message, model, signal, useOpenRouter = false }) => {
  try {
    if (useOpenRouter) {
      return await sendMessageOpenRouter(message, model, signal, event);
    } else {
      return await sendMessageOllama(message, model, signal, event);
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      return 'Request aborted';
    }
    return 'Ошибка: ' + (err.response?.data?.error || err.message);
  }
});

async function sendMessageOpenRouter(message, model, signal, event) {
  if (!openRouterApiKey) {
    throw new Error('OpenRouter API ключ не настроен');
  }

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
    responseType: 'stream',
    signal: signal ? new AbortController().signal : undefined
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
      if (err.name === 'AbortError') {
        reject(new Error('Request aborted'));
      } else {
        reject(err);
      }
    });
  });
}

async function sendMessageOllama(message, model, signal, event) {
  // Создаём AbortController если signal передан
  let abortController = null;
  if (signal) {
    abortController = new AbortController();
    // Слушаем событие abort из renderer
    event.sender.on('abort-request', () => {
      abortController.abort();
    });
  }
  
  const response = await axios.post('http://localhost:11434/api/chat', {
    model: model || 'llama3',
    messages: [
      { role: 'user', content: message }
    ],
    stream: true
  }, {
    responseType: 'stream',
    signal: abortController?.signal
  });
  
  let aiMsg = '';
  let think = '';
  let answer = '';
  
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
      // Ищем мысли (<think>...</think>) и отделяем их
      const thinkMatch = aiMsg.match(/<think>([\s\S]*?)<\/think>/i);
      if (thinkMatch) {
        think = thinkMatch[1].trim();
        answer = aiMsg.replace(thinkMatch[0], '').trim();
      } else {
        answer = aiMsg;
      }
      resolve({ answer, think });
    });
    
    response.data.on('error', (err) => {
      if (err.name === 'AbortError') {
        reject(new Error('Request aborted'));
      } else {
        reject(err);
      }
    });
  });
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