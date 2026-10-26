# Расширения для FrogeeCodeIDE

Расширение — это обычная папка без архивов:

```
exildraw/
  extension.json   описание
  plugin.js        плагин FrogeeCodeIDE
  icon.png
  README.md
```

## extension.json

```json
{
  "publisher": "frogeesoft",
  "name": "exildraw",
  "version": "1.0.0",
  "displayName": "Exildraw",
  "description": "Доска для набросков",
  "author": "FrogeeSoft",
  "icon": "icon.png",
  "plugins": ["plugin.js"],
  "themes": [{ "label": "FrogeeSoft Dark", "uiTheme": "vs-dark", "path": "themes/frogee-dark.json" }],
  "snippets": [{ "language": "javascript", "path": "snippets/js.json" }]
}
```

| Поле | Что это |
| --- | --- |
| `publisher`, `name` | Обязательны. Латиница, цифры, `.`, `_`, `-`. Вместе дают id `publisher.name`. |
| `version` | Обязательно. По нему редактор предлагает обновление. |
| `displayName`, `description`, `author`, `icon` | Подпись, описание и иконка в панели и на сайте. |
| `plugins` | Файлы `.js` и `.css` в формате [плагинов FrogeeCodeIDE](../plugins/README.md) (API `frogee` / `fgs`). Их код выполняется. |
| `themes` | Темы в формате тем VS Code (`colors` и `tokenColors`). `uiTheme`: `vs-dark` или `vs`. |
| `snippets` | Сниппеты в формате VS Code. `language` — id языка VS Code (`javascript`, `python`, …). |

Нужно хотя бы одно из `plugins`, `themes`, `snippets`.

## Как ставится

- **Из каталога.** Панель «Расширения» → «Для FrogeeCodeIDE» показывает каталог с сайта (https://arduradiokot.github.io/ForgeeCodeIDE/extensions.html). Редактор читает `extensions/index.json`, скачивает файлы расширения по одному и, если в нём есть плагины, сначала спрашивает подтверждение. Когда на сайте выходит новая версия, в панели появляется кнопка «Обновить».
- **Из папки.** Кнопка с плюсом в заголовке панели → выберите папку с `extension.json`. Так удобно проверять своё расширение до публикации.

Плагины копируются в `Документы/FrogeeCodeIDE/plugins` под именем `<publisher>.<name>--<файл>` и сразу включаются, темы появляются в списке тем. Удаление расширения убирает всё это.

Расширения VS Code из Open VSX ставятся в той же панели через поиск: из их `.vsix` берутся только темы и сниппеты, код не запускается.

## Добавить расширение в каталог

1. Положите папку в `extensions/` репозитория.
2. Соберите каталог:

   ```bash
   node scripts/build-extensions.js
   ```

   Скрипт проверит `extension.json` и файлы, скопирует папки в `website/extensions/<publisher>.<name>/` и обновит `website/extensions/index.json`.
3. Опубликуйте `website/` на сайте (ветка `gh-pages`).

## Примеры

- `exildraw/` — доска для набросков, рисунок вставляется в Markdown-файл как SVG.
- `insert-date/` — кнопка вставляет текущую дату и время.
- `frogee-theme/` — темы FrogeeSoft Dark и Light в цветах дизайн-кита.
