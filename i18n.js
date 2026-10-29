/** Site language: Russian (default) and English. No em dashes in UI strings. */
(function () {
  const KEY = 'frogee-lang';
  const dict = {
    ru: {
      'meta.description': 'Редактор кода с ИИ на вашем компьютере: чат, правки с проверкой, подсказки на лету, ноутбуки, терминалы и плагины.',
      'meta.extDescription': 'Каталог расширений для FrogeeCodeIDE: плагины, темы и сниппеты. Устанавливаются из редактора в один клик.',
      'meta.extTitle': 'Расширения FrogeeCodeIDE',
      'skip': 'К содержимому',
      'nav.overview': 'Обзор',
      'nav.features': 'Возможности',
      'nav.extensions': 'Расширения',
      'nav.companies': 'Для компаний',
      'nav.faq': 'Вопросы',
      'nav.download': 'Скачать',
      'nav.main': 'Основная навигация',
      'nav.menu': 'Меню',
      'nav.openMenu': 'Открыть меню',
      'nav.closeMenu': 'Закрыть меню',
      'theme.toggle': 'Переключить тему',
      'lang.toggle': 'Language / Язык',
      'lang.ru': 'RU',
      'lang.en': 'EN',
      'brand.home': 'FrogeeCodeIDE, наверх',
      'brand.main': 'FrogeeCodeIDE, на главную',
      'hero.title': 'Редактор кода с ИИ <span>на вашем компьютере</span>',
      'hero.lead': 'Подключите Ollama, LM Studio или свой провайдер. Чат видит ваши файлы, предлагает правки, а вы принимаете или откатываете их одной кнопкой.',
      'hero.download': 'Скачать',
      'hero.downloadFor': 'Скачать для {os}',
      'hero.source': 'Исходный код',
      'hero.fine': 'Другие платформы',
      'hero.fineAnd': 'и',
      'hero.releases': 'все релизы',
      'hero.fineTail': 'на GitHub',
      'hero.shotAlt': 'Окно FrogeeCodeIDE: проводник, редактор и чат с ИИ',
      'tour.head': 'Всё для кода <em>в одном окне</em>',
      'tour.lead': 'Чат с ИИ, проверка его правок, ноутбуки, терминалы и запуск проекта без переключения между программами.',
      'tour.tabs': 'Обзор',
      'tour.tab0': 'Проверка правок',
      'tour.tab1': 'Ноутбуки',
      'tour.tab2': 'Запуск и терминалы',
      'tour.p0h': 'Правки ИИ, которые можно проверить',
      'tour.p0p': 'Ответ модели не затирает файл. Изменения подсвечиваются в самом редакторе, и вы решаете, что оставить: «Оставить файл» или «Отменить файл».',
      'tour.p0alt': 'Проверка правок ИИ с кнопками Оставить и Отменить',
      'tour.p1h': 'Ноутбуки с выбором окружения',
      'tour.p1p': 'Открывайте .ipynb и запускайте ячейки. Редактор сам находит .venv, conda и pyenv проекта и предлагает выбрать ядро.',
      'tour.p1alt': 'Jupyter-ноутбук с выводом ячеек',
      'tour.p2h': 'Конфигурации запуска и несколько терминалов',
      'tour.p2p': 'Сохраните команду один раз и запускайте кнопкой. Каждая конфигурация открывается в своей вкладке терминала, скрипты из package.json подхватываются сами.',
      'tour.p2alt': 'Панель запуска и вкладки терминала',
      'feat.head': 'ИИ работает там, <em>где вы решите</em>',
      'feat.lead': 'Локальная модель держит код на вашей машине. Если нужна мощнее, подключается провайдер с вашим ключом.',
      'feat.c1h': 'Локальные модели',
      'feat.c1p': 'Ollama и LM Studio. Код остаётся на вашем компьютере и работает без интернета.',
      'feat.c2h': 'Подсказки на лету',
      'feat.c2p': 'Серое продолжение принимается по Tab. Для FIM-моделей учитывается код после курсора.',
      'feat.c3h': 'Контекст из файлов',
      'feat.c3p': 'Прикрепляйте файлы к сообщению, редактируйте свои сообщения и перегенерируйте ответы.',
      'feat.c4h': 'Live Server и браузер',
      'feat.c4p': 'Страница обновляется при сохранении, встроенный браузер открывается рядом с кодом.',
      'feat.c5h': 'Поиск и проект',
      'feat.c5p': 'Поиск и замена, поиск по проекту, перетаскивание файлов, изменения из других программ подхватываются сами.',
      'feat.c6h': 'Стеклянное окно',
      'feat.c6p': 'Liquid Glass на macOS, светлые и тёмные темы, свои темы в JSON, несколько окон.',
      'ext.head': 'Расширения <em>для FrogeeCodeIDE</em>',
      'ext.lead': 'Ставятся из панели «Расширения» в один клик и работают полностью. Темы и сниппеты можно взять и из расширений VS Code в Open VSX.',
      'ext.loading': 'Загружаю каталог…',
      'ext.all': 'Весь каталог',
      'ext.make': 'Сделать своё расширение',
      'ext.empty': 'В каталоге пока пусто.',
      'ext.loadFail': 'Каталог не загрузился. Обновите страницу.',
      'ext.downloadPlugin': 'Скачать плагин',
      'ext.source': 'Исходники',
      'ext.count': '{n} {word}, обновлено {date}',
      'ext.word.one': 'расширение',
      'ext.word.few': 'расширения',
      'ext.word.many': 'расширений',
      'ext.plugin.one': 'плагин',
      'ext.plugin.few': 'плагина',
      'ext.plugin.many': 'плагинов',
      'ext.theme.one': 'тема',
      'ext.theme.few': 'темы',
      'ext.theme.many': 'тем',
      'ext.snip.one': 'набор сниппетов',
      'ext.snip.few': 'набора сниппетов',
      'ext.snip.many': 'наборов сниппетов',
      'plugins.head': 'Плагин <em>одним файлом</em>',
      'plugins.lead': 'Плагин - это файл .js или .css с доступом к редактору: кнопки на левой панели, текст открытого файла, предпросмотр Markdown. Его можно поставить отдельно или упаковать в расширение. Плагины FgSNotes работают без изменений.',
      'plugins.how': 'Как написать плагин',
      'plugins.example': 'Пример плагина',
      'company.eyebrow': 'FrogeeSoft / проекты',
      'company.head': 'Проекты <em>для компаний</em>',
      'company.lead': 'Примеры задач для компаний и проектов с их поддержкой. По ссылкам можно посмотреть готовый сайт и исходный код.',
      'company.cta': 'Обсудить свой проект',
      'company.yandex.label': 'Яндекс',
      'company.yandex.head': 'Топология',
      'company.yandex.desc': 'Сервис для проектирования логистических систем и складов: распознавание планов и автоматическая расстановка стеллажей.',
      'company.view': 'Смотреть проект ↗',
      'company.geoscan.label': 'При поддержке «Геоскан»',
      'company.geoscan.head': 'МОПС',
      'company.geoscan.desc': 'Обследование сооружений с помощью БПЛА: ортофото фасада и поиск трещин на снимках.',
      'company.yakovlev.label': 'При поддержке ПАО «Яковлев»',
      'company.yakovlev.head': 'Визуальная навигация дрона',
      'company.yakovlev.desc': 'Коррекция курса и посадки по цветовой метке. Алгоритм отрабатывается в симуляторе Gazebo SITL.',
      'company.source': 'Код проекта ↗',
      'faq.head': 'Частые <em>вопросы</em>',
      'faq.lead': 'Не нашли ответ? Напишите нам, контакты ниже.',
      'faq.q1': 'Нужен ли интернет?',
      'faq.a1': 'Нет, если модель локальная: Ollama и LM Studio работают на вашем компьютере. Интернет нужен только для облачных провайдеров вроде OpenRouter.',
      'faq.q2': 'Сколько стоит?',
      'faq.a2': 'Ничего. Код открыт и распространяется по лицензии MIT.',
      'faq.q3': 'Какие системы поддерживаются?',
      'faq.a3': 'macOS, Windows и Linux. Стеклянное окно с размытием есть только на macOS, на остальных окно непрозрачное и берёт цвета темы.',
      'faq.q4': 'Где хранятся настройки, темы и плагины?',
      'faq.a4': 'В папке Документы/FrogeeCodeIDE: настройки в config, темы в themes, плагины в plugins, расширения в extensions.',
      'faq.q5': 'Работают ли расширения VS Code?',
      'faq.a5': 'Частично. Панель «Расширения» ищет в Open VSX: из расширений VS Code берутся темы оформления и сниппеты, а их код не запускается. Расширения из каталога FrogeeCodeIDE работают полностью.',
      'faq.q6': 'Как поставить плагин?',
      'faq.a6': 'Настройки → Плагины → «Установить…» и выберите файл .js или .css. Плагин выполняется внутри редактора, поэтому ставьте только те, которым доверяете.',
      'dl.head': 'Скачать <em>FrogeeCodeIDE</em>',
      'dl.ver': 'Бесплатно. Сборки лежат на странице релизов GitHub.',
      'dl.verReady': 'Бесплатно. Версия {v}, сборки лежат на странице релизов GitHub.',
      'dl.mac.p': '.dmg для Apple Silicon и .zip с приложением.',
      'dl.mac.btn': 'Для macOS',
      'dl.win.p': 'Установщик .exe и портативная версия в .zip.',
      'dl.win.btn': 'Для Windows',
      'dl.linux.p': 'AppImage без установки и пакет .deb.',
      'dl.linux.btn': 'Для Linux',
      'contact.head': 'Нашли ошибку <em>или есть идея</em>',
      'contact.lead': 'Напишите в Issues на GitHub или на почту команды. Мы читаем всё и отвечаем.',
      'contact.issues': 'Открыть Issues',
      'footer.links': 'Ссылки',
      'footer.docs': 'Документация',
      'footer.releases': 'Релизы',
      'footer.mail': 'Почта',
      'footer.legal': '© {y} FrogeeSoft. Открытый код, лицензия MIT.',
      'extPage.title': 'Расширения <span>для FrogeeCodeIDE</span>',
      'extPage.lead': 'Плагины, темы и сниппеты. Ставятся из редактора в один клик: панель «Расширения» берёт их прямо из этого каталога.',
      'install.head': 'Как <em>установить</em>',
      'install.lead': 'Нужна версия FrogeeCodeIDE с панелью «Расширения» на левой панели.',
      'install.s1h': 'Откройте «Расширения»',
      'install.s1p': 'Кнопка с квадратиками на левой панели редактора.',
      'install.s2h': 'Нажмите «Установить»',
      'install.s2p': 'В разделе «Для FrogeeCodeIDE» лежит этот каталог. Редактор скачает расширение и сразу включит его.',
      'install.s3h': 'Или поставьте из папки',
      'install.s3p': 'Своё расширение или скачанное с GitHub ставится кнопкой с плюсом в заголовке панели: выберите папку с extension.json.',
      'make.head': 'Своё <em>расширение</em>',
      'make.lead': 'Расширение - это обычная папка: extension.json, плагины .js и .css, темы и сниппеты в формате VS Code, иконка. Положите её в extensions/ репозитория, и скрипт добавит её в каталог. После пул-реквеста расширение появится здесь и в редакторе.',
      'make.format': 'Формат и пример',
      'make.api': 'API плагинов',
    },
    en: {
      'meta.description': 'A code editor with AI on your computer: chat, reviewable edits, inline completions, notebooks, terminals and plugins.',
      'meta.extDescription': 'Extension catalog for FrogeeCodeIDE: plugins, themes and snippets. Install from the editor in one click.',
      'meta.extTitle': 'FrogeeCodeIDE Extensions',
      'skip': 'Skip to content',
      'nav.overview': 'Overview',
      'nav.features': 'Features',
      'nav.extensions': 'Extensions',
      'nav.companies': 'For companies',
      'nav.faq': 'FAQ',
      'nav.download': 'Download',
      'nav.main': 'Main navigation',
      'nav.menu': 'Menu',
      'nav.openMenu': 'Open menu',
      'nav.closeMenu': 'Close menu',
      'theme.toggle': 'Toggle theme',
      'lang.toggle': 'Language / Язык',
      'lang.ru': 'RU',
      'lang.en': 'EN',
      'brand.home': 'FrogeeCodeIDE, back to top',
      'brand.main': 'FrogeeCodeIDE, home',
      'hero.title': 'A code editor with AI <span>on your computer</span>',
      'hero.lead': 'Connect Ollama, LM Studio or your own provider. Chat sees your files, suggests edits, and you accept or undo them with one click.',
      'hero.download': 'Download',
      'hero.downloadFor': 'Download for {os}',
      'hero.source': 'Source code',
      'hero.fine': 'Other platforms',
      'hero.fineAnd': 'and',
      'hero.releases': 'all releases',
      'hero.fineTail': 'on GitHub',
      'hero.shotAlt': 'FrogeeCodeIDE window: explorer, editor and AI chat',
      'tour.head': 'Everything for code <em>in one window</em>',
      'tour.lead': 'AI chat, reviewable edits, notebooks, terminals and project run - without switching apps.',
      'tour.tabs': 'Overview',
      'tour.tab0': 'Edit review',
      'tour.tab1': 'Notebooks',
      'tour.tab2': 'Run and terminals',
      'tour.p0h': 'AI edits you can review',
      'tour.p0p': 'The model does not overwrite the file. Changes are highlighted in the editor, and you choose what to keep: “Keep file” or “Undo file”.',
      'tour.p0alt': 'AI edit review with Keep and Undo buttons',
      'tour.p1h': 'Notebooks with environment picker',
      'tour.p1p': 'Open .ipynb files and run cells. The editor finds project .venv, conda and pyenv and lets you pick a kernel.',
      'tour.p1alt': 'Jupyter notebook with cell output',
      'tour.p2h': 'Run configs and multiple terminals',
      'tour.p2p': 'Save a command once and run it with a button. Each config opens in its own terminal tab; package.json scripts are picked up automatically.',
      'tour.p2alt': 'Run panel and terminal tabs',
      'feat.head': 'AI runs <em>where you choose</em>',
      'feat.lead': 'A local model keeps code on your machine. Need more power? Connect a provider with your key.',
      'feat.c1h': 'Local models',
      'feat.c1p': 'Ollama and LM Studio. Code stays on your computer and works offline.',
      'feat.c2h': 'Inline suggestions',
      'feat.c2p': 'Ghost text is accepted with Tab. FIM models also see code after the cursor.',
      'feat.c3h': 'File context',
      'feat.c3p': 'Attach files to a message, edit your prompts and regenerate answers.',
      'feat.c4h': 'Live Server and browser',
      'feat.c4p': 'The page refreshes on save; the built-in browser opens beside your code.',
      'feat.c5h': 'Search and project',
      'feat.c5p': 'Find and replace, project search, drag-and-drop files, external changes picked up automatically.',
      'feat.c6h': 'Glass window',
      'feat.c6p': 'Liquid Glass on macOS, light and dark themes, custom JSON themes, multiple windows.',
      'ext.head': 'Extensions <em>for FrogeeCodeIDE</em>',
      'ext.lead': 'Install from the Extensions panel in one click and they work fully. Themes and snippets can also come from VS Code packages on Open VSX.',
      'ext.loading': 'Loading catalog…',
      'ext.all': 'Full catalog',
      'ext.make': 'Make your own extension',
      'ext.empty': 'The catalog is empty for now.',
      'ext.loadFail': 'Could not load the catalog. Refresh the page.',
      'ext.downloadPlugin': 'Download plugin',
      'ext.source': 'Source',
      'ext.count': '{n} {word}, updated {date}',
      'ext.word.one': 'extension',
      'ext.word.few': 'extensions',
      'ext.word.many': 'extensions',
      'ext.plugin.one': 'plugin',
      'ext.plugin.few': 'plugins',
      'ext.plugin.many': 'plugins',
      'ext.theme.one': 'theme',
      'ext.theme.few': 'themes',
      'ext.theme.many': 'themes',
      'ext.snip.one': 'snippet pack',
      'ext.snip.few': 'snippet packs',
      'ext.snip.many': 'snippet packs',
      'plugins.head': 'A plugin <em>in one file</em>',
      'plugins.lead': 'A plugin is a .js or .css file with editor access: sidebar buttons, open file text, Markdown preview. Install it alone or pack it into an extension. FgSNotes plugins work unchanged.',
      'plugins.how': 'How to write a plugin',
      'plugins.example': 'Plugin example',
      'company.eyebrow': 'FrogeeSoft / projects',
      'company.head': 'Projects <em>for companies</em>',
      'company.lead': 'Examples of work for companies and projects backed by industry partners. Follow the links to see the live site and source code.',
      'company.cta': 'Discuss your project',
      'company.yandex.label': 'Yandex',
      'company.yandex.head': 'Topology',
      'company.yandex.desc': 'A service for planning logistics systems and warehouses: recognizing floor plans and automatically placing storage racks.',
      'company.view': 'View project ↗',
      'company.geoscan.label': 'Supported by Geoscan',
      'company.geoscan.head': 'MOPS',
      'company.geoscan.desc': 'Drone-assisted inspection of structures: facade orthophotos and crack detection in images.',
      'company.yakovlev.label': 'Supported by Yakovlev PJSC',
      'company.yakovlev.head': 'Drone visual navigation',
      'company.yakovlev.desc': 'Course correction and landing using a color marker. The algorithm is tested in Gazebo SITL.',
      'company.source': 'View code ↗',
      'faq.head': 'Frequent <em>questions</em>',
      'faq.lead': 'Didn’t find an answer? Write to us - contacts below.',
      'faq.q1': 'Do I need the internet?',
      'faq.a1': 'No, if the model is local: Ollama and LM Studio run on your computer. Internet is only needed for cloud providers like OpenRouter.',
      'faq.q2': 'How much does it cost?',
      'faq.a2': 'Nothing. The code is open source under the MIT license.',
      'faq.q3': 'Which systems are supported?',
      'faq.a3': 'macOS, Windows and Linux. The frosted glass window is macOS-only; elsewhere the window is opaque and follows the theme colors.',
      'faq.q4': 'Where are settings, themes and plugins stored?',
      'faq.a4': 'In Documents/FrogeeCodeIDE: settings in config, themes in themes, plugins in plugins, extensions in extensions.',
      'faq.q5': 'Do VS Code extensions work?',
      'faq.a5': 'Partly. The Extensions panel searches Open VSX: themes and snippets are taken from VS Code packages; their code does not run. Extensions from the FrogeeCodeIDE catalog work fully.',
      'faq.q6': 'How do I install a plugin?',
      'faq.a6': 'Settings → Plugins → “Install…” and pick a .js or .css file. Plugins run inside the editor, so only install ones you trust.',
      'dl.head': 'Download <em>FrogeeCodeIDE</em>',
      'dl.ver': 'Free. Builds are on the GitHub releases page.',
      'dl.verReady': 'Free. Version {v}, builds are on the GitHub releases page.',
      'dl.mac.p': '.dmg for Apple Silicon and a .zip with the app.',
      'dl.mac.btn': 'For macOS',
      'dl.win.p': '.exe installer and a portable .zip.',
      'dl.win.btn': 'For Windows',
      'dl.linux.p': 'AppImage (no install) and a .deb package.',
      'dl.linux.btn': 'For Linux',
      'contact.head': 'Found a bug <em>or have an idea</em>',
      'contact.lead': 'Open a GitHub Issue or email the team. We read everything and reply.',
      'contact.issues': 'Open Issues',
      'footer.links': 'Links',
      'footer.docs': 'Docs',
      'footer.releases': 'Releases',
      'footer.mail': 'Email',
      'footer.legal': '© {y} FrogeeSoft. Open source, MIT license.',
      'extPage.title': 'Extensions <span>for FrogeeCodeIDE</span>',
      'extPage.lead': 'Plugins, themes and snippets. Install from the editor in one click: the Extensions panel pulls them from this catalog.',
      'install.head': 'How to <em>install</em>',
      'install.lead': 'You need a FrogeeCodeIDE build with the Extensions panel on the left.',
      'install.s1h': 'Open “Extensions”',
      'install.s1p': 'The squares button on the editor’s left sidebar.',
      'install.s2h': 'Click “Install”',
      'install.s2p': 'Under “For FrogeeCodeIDE” is this catalog. The editor downloads the extension and enables it right away.',
      'install.s3h': 'Or install from a folder',
      'install.s3p': 'Your own extension or one from GitHub installs with the plus button in the panel header: pick a folder with extension.json.',
      'make.head': 'Your own <em>extension</em>',
      'make.lead': 'An extension is a normal folder: extension.json, .js/.css plugins, VS Code-format themes and snippets, and an icon. Put it in the repo’s extensions/ folder and the build script adds it to the catalog. After a pull request it shows up here and in the editor.',
      'make.format': 'Format and example',
      'make.api': 'Plugin API',
    },
  };

  function detect() {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === 'en' || saved === 'ru') return saved;
    } catch { /* private mode */ }
    const nav = (navigator.language || 'ru').toLowerCase();
    return nav.startsWith('en') ? 'en' : 'ru';
  }

  let lang = detect();
  const listeners = new Set();

  function t(key, vars = {}) {
    const table = dict[lang] || dict.ru;
    let s = table[key] ?? dict.ru[key] ?? key;
    for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
  }

  function apply(root = document) {
    const year = String(new Date().getFullYear());
    const vars = { y: year };
    document.documentElement.lang = lang === 'en' ? 'en' : 'ru';
    document.documentElement.dataset.lang = lang;
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) {
      const key = document.body?.dataset?.page === 'extensions' ? 'meta.extDescription' : 'meta.description';
      metaDesc.setAttribute('content', t(key));
    }
    if (document.body?.dataset?.page === 'extensions') document.title = t('meta.extTitle');
    else if (document.body?.dataset?.page === 'home') document.title = 'FrogeeCodeIDE';

    root.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (el.childElementCount === 0) el.textContent = t(key, vars);
      else {
        const textNode = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
        if (textNode) textNode.textContent = t(key, vars);
        else el.textContent = t(key, vars);
      }
    });
    root.querySelectorAll('[data-i18n-html]').forEach((el) => {
      el.innerHTML = t(el.getAttribute('data-i18n-html'), vars);
    });
    root.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.setAttribute('title', t(el.getAttribute('data-i18n-title'), vars));
    });
    root.querySelectorAll('[data-i18n-aria]').forEach((el) => {
      el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria'), vars));
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder'), vars));
    });
    root.querySelectorAll('[data-i18n-alt]').forEach((el) => {
      el.setAttribute('alt', t(el.getAttribute('data-i18n-alt'), vars));
    });

    document.querySelectorAll('[data-lang-btn]').forEach((btn) => {
      const code = btn.getAttribute('data-lang-btn');
      btn.setAttribute('aria-pressed', String(code === lang));
      btn.classList.toggle('is-active', code === lang);
    });
    document.documentElement.dataset.i18nReady = '1';
  }

  function setLang(next) {
    const value = next === 'en' ? 'en' : 'ru';
    if (value === lang) { apply(); return; }
    lang = value;
    try { localStorage.setItem(KEY, lang); } catch { /* */ }
    apply();
    for (const fn of listeners) {
      try { fn(lang); } catch { /* */ }
    }
  }

  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function plural(n, oneKey, fewKey, manyKey) {
    if (lang === 'en') return t(n === 1 ? oneKey : manyKey);
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return t(oneKey);
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return t(fewKey);
    return t(manyKey);
  }

  // Early apply when DOM is ready enough
  function boot() {
    apply();
    document.querySelectorAll('[data-lang-btn]').forEach((btn) => {
      btn.addEventListener('click', () => setLang(btn.getAttribute('data-lang-btn')));
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.FrogeeI18n = { t, setLang, getLang: () => lang, apply, onChange, plural };
})();
