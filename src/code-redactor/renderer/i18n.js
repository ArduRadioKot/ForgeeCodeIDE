/**
 * UI language: Russian (default) and English.
 * Mark static HTML with data-i18n / data-i18n-title / data-i18n-placeholder / data-i18n-aria.
 * Use t('key') from JS. Never use em dashes (—) in UI strings.
 */
import { looseEn } from './loose-en.js';

const KEY = 'frogee.ui.lang';
const listeners = new Set();

const dict = {
  ru: {
    'sidebar.explorer': 'Проект',
    'sidebar.search': 'Поиск',
    'sidebar.git': 'Git',
    'sidebar.run': 'Запуск',
    'sidebar.extensions': 'Расширения',
    'sidebar.browser': 'Браузер',
    'sidebar.chat': 'AI-чат',
    'sidebar.terminal': 'Терминал',
    'sidebar.settings': 'Настройки',
    'activity.explorer': 'Проводник',
    'activity.openFolder': 'Открыть папку',
    'activity.newFile': 'Новый файл',
    'explorer.empty': 'Папка не открыта',
    'explorer.emptyHint': 'Нажмите «Открыть» на стартовой странице',
    'resizer.width': 'Потяните, чтобы изменить ширину',
    'welcome.subtitle': 'Редактор нового поколения',
    'welcome.start': 'Начало',
    'welcome.newFile': 'Новый файл…',
    'welcome.newFileDesc': 'Создать пустой файл',
    'welcome.open': 'Открыть…',
    'welcome.openDesc': 'Открыть файл или папку',
    'welcome.clone': 'Клонировать репозиторий…',
    'welcome.cloneDesc': 'Скоро',
    'status.terminal': 'Терминал',
    'status.problems': 'Проблемы в файле',
    'status.aiThinking': 'ИИ думает…',
    'terminal.clear': 'Очистить',
    'terminal.new': 'Новый терминал',
    'terminal.toTab': 'Открыть как вкладку',
    'terminal.restart': 'Перезапустить',
    'terminal.close': 'Закрыть',
    'terminal.resize': 'Изменить высоту',
    'chat.resizer': 'Потяните, чтобы изменить ширину. Двойной щелчок - по умолчанию.',
    'settings.title': 'Настройки',
    'settings.editor': 'Редактор',
    'settings.appearance': 'Внешний вид',
    'settings.background': 'Фон',
    'settings.ai': 'AI',
    'settings.plugins': 'Плагины',
    'settings.shortcuts': 'Горячие клавиши',
    'settings.about': 'О программе',
    'settings.close': 'Закрыть',
    'settings.fontSize': 'Размер шрифта',
    'settings.tabSize': 'Табуляция',
    'settings.tab2': '2 пробела',
    'settings.tab4': '4 пробела',
    'settings.tab8': '8 пробелов',
    'settings.editorFont': 'Шрифт редактора',
    'settings.fontName': 'Название шрифта',
    'settings.ligatures': 'Лигатуры в коде',
    'settings.autosave': 'Автосохранение',
    'settings.autoIndent': 'Автоотступ при Enter',
    'settings.autoIndentSub': 'Новая строка повторяет отступ предыдущей, в Markdown продолжается список',
    'settings.aiComplete': 'Подсказки ИИ в редакторе',
    'settings.aiCompleteSub': 'Серое продолжение после курсора. Tab - принять, Alt+\\ - спросить сразу',
    'settings.language': 'Язык интерфейса',
    'settings.languageSub': 'Русский или English. Применяется сразу.',
    'settings.lang.ru': 'Русский',
    'settings.lang.en': 'English',
    'about.tagline': 'Лёгкая IDE с локальным ИИ',
    'about.version': 'Версия {v}',
    'about.check': 'Проверить обновления',
    'about.releases': 'Открыть страницу релизов',
    'about.done': 'Готово',
    'about.upToDate': 'Установлена последняя версия',
    'about.available': 'Доступна версия {v}',
    'about.downloadInstall': 'Скачать и установить',
    'about.downloadPackage': 'Скачать пакет',
    'about.openRelease': 'Открыть страницу релиза',
    'about.checking': 'Проверка обновлений…',
    'about.checkFailed': 'Не удалось проверить обновления',
    'about.downloading': 'Загрузка обновления…',
    'about.downloadingPct': 'Загрузка… {p}%',
    'about.installing': 'Установка… приложение перезапустится',
    'about.saveFirst': 'Сохраните изменённые файлы ({n}), затем повторите установку',
    'about.downloadedSave': 'Обновление загружено - сохраните файлы перед установкой',
    'about.update': 'Обновить',
    'about.details': 'Подробнее',
    'about.download': 'Скачать',
    'about.hide': 'Скрыть уведомление',
    'update.modalTitle': 'Доступно обновление',
    'update.modalBody': 'Найдена новая версия FrogeeCodeIDE {v}. Обновить сейчас?',
    'update.modalLater': 'Позже',
    'update.modalNow': 'Обновить',
    'update.modalNotes': 'Что нового',
    'plugins.hint': 'Плагины - файлы .js и .css в папке Documents/FrogeeCodeIDE/plugins. «Установить…» копирует выбранные файлы туда и сразу включает их; файлы, положенные в папку вручную, включаются переключателем. Плагин выполняется внутри редактора с доступом к открытым файлам: ставьте только те, которым доверяете. Плагины FgSNotes тоже подходят.',
    'plugins.installed': 'Установленные плагины',
    'plugins.install': 'Установить…',
    'plugins.openFolder': 'Открыть папку',
    'shortcut.newFile': 'Новый файл',
    'shortcut.open': 'Открыть',
    'shortcut.save': 'Сохранить',
    'shortcut.palette': 'Палитра команд',
    'shortcut.quickOpen': 'Быстрое открытие файла',
    'ext.panelTitle': 'Расширения',
    'ext.searchPh': 'Поиск в Open VSX: темы, сниппеты, языки…',
    'ext.note': 'Open VSX: темы, сниппеты, языки; код (main) - через vscode.* API Frogee: команды, правки, диагностика, completion/hover/format, findFiles, terminal, простые webview. Не полный VS Code (нет LSP-сервера и debug). Кнопка «Запустить код» у установленного расширения.',
    'ext.installed': 'Установленные',
    'ext.forFrogee': 'Для FrogeeCodeIDE',
    'ext.popular': 'Популярное в Open VSX: темы',
    'ext.empty': 'Пока ничего не установлено. Своё расширение можно поставить из папки кнопкой с плюсом вверху.',
    'ext.install': 'Установить',
    'ext.installing': 'Установка…',
    'ext.remove': 'Удалить',
    'ext.removing': 'Удаление…',
    'ext.runCode': 'Запустить код',
    'ext.stopCode': 'Остановить код',
    'ext.applyTheme': 'Применить тему',
    'palette.commands': 'Введите команду…',
    'palette.commandsFoot': 'Стрелки - выбор · Enter - выполнить · Esc - закрыть',
    'palette.files': 'Имя файла или :номер строки',
    'palette.filesEmpty': 'Откройте папку, чтобы искать файлы · :номер строки',
    'palette.filesFoot': 'Enter открыть · «:42» - перейти к строке',
    'palette.problems': 'Проблемы в файле…',
    'palette.problemsEmpty': 'Проблем не найдено',
    'palette.problemsFoot': 'Enter - перейти к месту · F8 - следующая проблема',
    'palette.apply': 'Enter - применить · Esc - отмена',
    'diag.problemsTitle': 'Проблемы в файле. Нажмите или F8 - перейти к следующей',
    'complete.hint': 'Tab - принять · Cmd/Ctrl+→ - слово · Esc - убрать',
    'git.notRepo': '{name} - не репозиторий git',
    'git.commitPh': 'Сообщение коммита (Ctrl+Enter - закоммитить)',
    'git.branchFoot': 'Enter - создать · Esc - отмена',
    'nb.emptyMd': '*Двойной щелчок - редактировать текст*',
    'nb.noPython': 'Python не найден - создайте .venv в проекте',
    'nb.openFolder': 'Откройте папку проекта, чтобы выбрать venv',
    'font.missing': '{name} - не найден',
    'live.on': 'Live Server: {url}\nКлик - остановить',
    'live.off': 'Запустить Live Server для проекта',
    'ai.ollamaOff': 'Ollama не запущена - нажмите «Запустить».',
    'rc.cwdPh': 'Пусто - папка проекта; можно относительный путь',
    'bg.hint': 'Диапазон прозрачности UI: 0.4–1. URL изображения необязателен; для CSS используйте формат url(...).',
  },
  en: {
    'sidebar.explorer': 'Explorer',
    'sidebar.search': 'Search',
    'sidebar.git': 'Git',
    'sidebar.run': 'Run',
    'sidebar.extensions': 'Extensions',
    'sidebar.browser': 'Browser',
    'sidebar.chat': 'AI chat',
    'sidebar.terminal': 'Terminal',
    'sidebar.settings': 'Settings',
    'activity.explorer': 'Explorer',
    'activity.openFolder': 'Open folder',
    'activity.newFile': 'New file',
    'explorer.empty': 'No folder open',
    'explorer.emptyHint': 'Click “Open” on the welcome page',
    'resizer.width': 'Drag to resize',
    'welcome.subtitle': 'A next-generation editor',
    'welcome.start': 'Start',
    'welcome.newFile': 'New file…',
    'welcome.newFileDesc': 'Create an empty file',
    'welcome.open': 'Open…',
    'welcome.openDesc': 'Open a file or folder',
    'welcome.clone': 'Clone repository…',
    'welcome.cloneDesc': 'Coming soon',
    'status.terminal': 'Terminal',
    'status.problems': 'Problems in file',
    'status.aiThinking': 'AI thinking…',
    'terminal.clear': 'Clear',
    'terminal.new': 'New terminal',
    'terminal.toTab': 'Open as tab',
    'terminal.restart': 'Restart',
    'terminal.close': 'Close',
    'terminal.resize': 'Resize height',
    'chat.resizer': 'Drag to resize. Double-click to reset.',
    'settings.title': 'Settings',
    'settings.editor': 'Editor',
    'settings.appearance': 'Appearance',
    'settings.background': 'Background',
    'settings.ai': 'AI',
    'settings.plugins': 'Plugins',
    'settings.shortcuts': 'Keyboard shortcuts',
    'settings.about': 'About',
    'settings.close': 'Close',
    'settings.fontSize': 'Font size',
    'settings.tabSize': 'Tab size',
    'settings.tab2': '2 spaces',
    'settings.tab4': '4 spaces',
    'settings.tab8': '8 spaces',
    'settings.editorFont': 'Editor font',
    'settings.fontName': 'Font name',
    'settings.ligatures': 'Font ligatures',
    'settings.autosave': 'Auto save',
    'settings.autoIndent': 'Auto indent on Enter',
    'settings.autoIndentSub': 'New line keeps the previous indent; Markdown lists continue',
    'settings.aiComplete': 'AI inline suggestions',
    'settings.aiCompleteSub': 'Ghost text after the cursor. Tab to accept, Alt+\\ to request now',
    'settings.language': 'Interface language',
    'settings.languageSub': 'Russian or English. Applies immediately.',
    'settings.lang.ru': 'Русский',
    'settings.lang.en': 'English',
    'about.tagline': 'A lightweight IDE with local AI',
    'about.version': 'Version {v}',
    'about.check': 'Check for updates',
    'about.releases': 'Open releases page',
    'about.done': 'Done',
    'about.upToDate': 'You have the latest version',
    'about.available': 'Version {v} is available',
    'about.downloadInstall': 'Download and install',
    'about.downloadPackage': 'Download package',
    'about.openRelease': 'Open release page',
    'about.checking': 'Checking for updates…',
    'about.checkFailed': 'Could not check for updates',
    'about.downloading': 'Downloading update…',
    'about.downloadingPct': 'Downloading… {p}%',
    'about.installing': 'Installing… the app will restart',
    'about.saveFirst': 'Save modified files ({n}), then install again',
    'about.downloadedSave': 'Update downloaded - save files before installing',
    'about.update': 'Update',
    'about.details': 'Details',
    'about.download': 'Download',
    'about.hide': 'Dismiss',
    'update.modalTitle': 'Update available',
    'update.modalBody': 'A new version of FrogeeCodeIDE {v} was found. Update now?',
    'update.modalLater': 'Later',
    'update.modalNow': 'Update',
    'update.modalNotes': 'What’s new',
    'plugins.hint': 'Plugins are .js and .css files in Documents/FrogeeCodeIDE/plugins. “Install…” copies files there and enables them; files added manually use the toggle. A plugin runs inside the editor with access to open files: only install ones you trust. FgSNotes plugins work too.',
    'plugins.installed': 'Installed plugins',
    'plugins.install': 'Install…',
    'plugins.openFolder': 'Open folder',
    'shortcut.newFile': 'New file',
    'shortcut.open': 'Open',
    'shortcut.save': 'Save',
    'shortcut.palette': 'Command palette',
    'shortcut.quickOpen': 'Quick open file',
    'ext.panelTitle': 'Extensions',
    'ext.searchPh': 'Search Open VSX: themes, snippets, languages…',
    'ext.note': 'Open VSX: themes, snippets, languages; code (main) runs via Frogee’s vscode.* API. Not full VS Code (no LSP server or debug). Use “Run code” on an installed extension.',
    'ext.installed': 'Installed',
    'ext.forFrogee': 'For FrogeeCodeIDE',
    'ext.popular': 'Popular on Open VSX: themes',
    'ext.empty': 'Nothing installed yet. Install from a folder with the plus button above.',
    'ext.install': 'Install',
    'ext.installing': 'Installing…',
    'ext.remove': 'Remove',
    'ext.removing': 'Removing…',
    'ext.runCode': 'Run code',
    'ext.stopCode': 'Stop code',
    'ext.applyTheme': 'Apply theme',
    'palette.commands': 'Type a command…',
    'palette.commandsFoot': 'Arrows - select · Enter - run · Esc - close',
    'palette.files': 'File name or :line number',
    'palette.filesEmpty': 'Open a folder to search files · :line number',
    'palette.filesFoot': 'Enter to open · “:42” - go to line',
    'palette.problems': 'Problems in file…',
    'palette.problemsEmpty': 'No problems found',
    'palette.problemsFoot': 'Enter - go to location · F8 - next problem',
    'palette.apply': 'Enter - apply · Esc - cancel',
    'diag.problemsTitle': 'Problems in file. Click or press F8 for the next one',
    'complete.hint': 'Tab - accept · Cmd/Ctrl+→ - word · Esc - dismiss',
    'git.notRepo': '{name} - not a git repository',
    'git.commitPh': 'Commit message (Ctrl+Enter to commit)',
    'git.branchFoot': 'Enter - create · Esc - cancel',
    'nb.emptyMd': '*Double-click to edit*',
    'nb.noPython': 'Python not found - create a .venv in the project',
    'nb.openFolder': 'Open a project folder to pick a venv',
    'font.missing': '{name} - not found',
    'live.on': 'Live Server: {url}\nClick to stop',
    'live.off': 'Start Live Server for the project',
    'ai.ollamaOff': 'Ollama is not running - click “Start”.',
    'rc.cwdPh': 'Empty - project folder; relative paths allowed',
    'bg.hint': 'UI opacity range: 0.4–1. Image URL is optional; for CSS use url(...).',
  },
};

let lang = 'ru';

// Older panels still render Russian copy directly. Keep their original text on each
// DOM node so switching back to Russian restores it without touching user content.
const knownEn = Object.fromEntries(Object.keys(dict.ru).map((key) => [dict.ru[key], dict.en[key]]));
Object.assign(knownEn, looseEn);
const originalText = new WeakMap();
const originalAttrs = new WeakMap();
const skipLoose = 'script, style, pre, code, [contenteditable], #tabs-list, .file-name, .search-line-text, .search-file-name, .search-file-dir, .git-log, .git-output, .run-name, .run-cmd, .ext-name, .ext-desc, .nb-md-preview, .nb-output, .nb-toc-item, .nb-var-val, .msg-text, .msg-body, .think-body, .msg-files, .msg-who, .msg-foot, .history-open strong, .terminal-output';

function eligible(el) {
  return el && !el.closest(skipLoose);
}

function translateText(node) {
  const parent = node.parentElement;
  if (parent?.matches('textarea')) return;
  if (!eligible(parent) || parent.closest('[data-i18n]')) return;
  const current = node.nodeValue;
  let source = originalText.get(node);
  const priorEn = source && knownEn[source.trim()];
  if (source && current !== source && current !== source.replace(source.trim(), priorEn || source.trim())) {
    originalText.delete(node);
    source = null;
  }
  if (!source) {
    if (!knownEn[current.trim()]) return;
    source = current;
    originalText.set(node, source);
  }
  const target = lang === 'en' ? source.replace(source.trim(), knownEn[source.trim()]) : source;
  if (node.nodeValue !== target) node.nodeValue = target;
}

function translateAttr(el, attr) {
  if (!eligible(el)) return;
  const marker = { title: 'data-i18n-title', placeholder: 'data-i18n-placeholder', 'aria-label': 'data-i18n-aria' }[attr];
  if (el.hasAttribute(marker) || !el.hasAttribute(attr)) return;
  const current = el.getAttribute(attr);
  let saved = originalAttrs.get(el);
  let source = saved?.[attr];
  if (source && current !== source && current !== knownEn[source]) {
    delete saved[attr];
    source = null;
  }
  if (!source) {
    if (!knownEn[current]) return;
    source = current;
    saved ||= {};
    saved[attr] = source;
    originalAttrs.set(el, saved);
  }
  const target = lang === 'en' ? knownEn[source] : source;
  if (current !== target) el.setAttribute(attr, target);
}

function translateLoose(root) {
  if (root.nodeType === Node.TEXT_NODE) {
    translateText(root);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
  if (root.nodeType === Node.ELEMENT_NODE && !eligible(root)) return;
  const elements = root.nodeType === Node.ELEMENT_NODE ? [root, ...root.querySelectorAll('*')] : root.querySelectorAll('*');
  for (const el of elements) {
    if (!eligible(el)) continue;
    for (const attr of ['title', 'placeholder', 'aria-label']) translateAttr(el, attr);
    for (const child of el.childNodes) if (child.nodeType === Node.TEXT_NODE) translateText(child);
  }
}

function detect() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'en' || saved === 'ru') return saved;
  } catch { /* ignore */ }
  const nav = (navigator.language || 'ru').toLowerCase();
  return nav.startsWith('en') ? 'en' : 'ru';
}

lang = detect();

export function getLang() { return lang; }

export function uiText(source) {
  return lang === 'en' ? (knownEn[source] || source) : source;
}

export function t(key, vars = {}) {
  const table = dict[lang] || dict.ru;
  let s = table[key] ?? dict.ru[key] ?? key;
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

function setAttr(el, attr, key) {
  if (!key) return;
  const val = t(key);
  if (attr === 'text') {
    // Prefer updating a dedicated text node / keep child elements (icons)
    if (el.childElementCount === 0) {
      if (el.textContent !== val) el.textContent = val;
    }
    else {
      const span = el.querySelector('[data-i18n-text]') || [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
      if (span && span.nodeType === 3 && span.textContent !== val) span.textContent = val;
      else if (el.querySelector('[data-i18n-text]') && el.querySelector('[data-i18n-text]').textContent !== val) el.querySelector('[data-i18n-text]').textContent = val;
      else if (!span && el.textContent !== val) el.textContent = val;
    }
  } else if (el.getAttribute(attr) !== val) el.setAttribute(attr, val);
}

export function applyI18n(root = document) {
  document.documentElement.lang = lang === 'en' ? 'en' : 'ru';
  if (root.nodeType === Node.ELEMENT_NODE && !eligible(root)) return;
  if (root.nodeType === Node.ELEMENT_NODE || root.nodeType === Node.DOCUMENT_NODE) {
    for (const [attr, type] of [['data-i18n', 'text'], ['data-i18n-title', 'title'], ['data-i18n-placeholder', 'placeholder'], ['data-i18n-aria', 'aria-label']]) {
      if (root.nodeType === Node.ELEMENT_NODE && root.hasAttribute(attr)) setAttr(root, type, root.getAttribute(attr));
      root.querySelectorAll(`[${attr}]`).forEach((el) => { if (eligible(el)) setAttr(el, type, el.getAttribute(attr)); });
    }
  }
  translateLoose(root);
  // Settings tab titles map
  const title = document.getElementById('settings-main-title');
  const active = document.querySelector('.settings-nav-btn.active')?.dataset?.settingsTab;
  if (title && active && title.textContent !== t(`settings.${active}`)) title.textContent = t(`settings.${active}`);
}

export function setLang(next, { persist = true } = {}) {
  const value = next === 'en' ? 'en' : 'ru';
  if (value === lang) {
    applyI18n();
    return;
  }
  lang = value;
  if (persist) {
    try { localStorage.setItem(KEY, lang); } catch { /* ignore */ }
  }
  if (typeof window !== 'undefined') window.electronAPI?.setUiLanguage?.(lang);
  applyI18n();
  for (const fn of listeners) {
    try { fn(lang); } catch { /* ignore */ }
  }
}

export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setupI18n() {
  // Expose for modules that avoid circular imports
  if (typeof window !== 'undefined') window.__frogeeT = t;
  if (typeof window !== 'undefined') window.electronAPI?.setUiLanguage?.(lang);
  applyI18n();
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') translateText(mutation.target);
      else if (mutation.type === 'attributes') translateAttr(mutation.target, mutation.attributeName);
      else for (const node of mutation.addedNodes) applyI18n(node);
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', 'placeholder', 'aria-label'] });
  const select = document.getElementById('ui-lang-select');
  if (select) {
    select.value = lang;
    select.addEventListener('change', () => setLang(select.value));
  }
  // Keep settings panel titles in sync when switching tabs
  document.getElementById('settings-nav')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-settings-tab]');
    if (!btn) return;
    const title = document.getElementById('settings-main-title');
    if (title) title.textContent = t(`settings.${btn.dataset.settingsTab}`);
  });
}
