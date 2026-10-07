# Пользовательские темы FrogeeCodeIDE

Тема — это один JSON-файл. Положите его в папку тем (Настройки → Внешний вид → «Открыть папку тем»)
или нажмите «Импортировать тему…». Файл `dracula.json` рядом — готовый пример.

```json
{
  "name": "Моя тема",
  "type": "dark",
  "colors":   { "window-bg": "#1e1f29", "card-bg": "#282a36", "accent-color": "#bd93f9" },
  "syntax":   { "keyword": "#ff79c6", "string": "#f1fa8c" },
  "terminal": { "background": "#21222c", "red": "#ff5555" }
}
```

* `type` — `dark` или `light`: от него зависят значения, которые тема не переопределила.
* Все поля необязательны, достаточно указать только то, что хотите изменить.
* Цвета — `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(...)`, `rgba(...)`, `hsl(...)`.

## colors
`window-bg` фон окна · `card-bg` панели · `header-bg` вкладки · `code-bg` поля ввода и блоки кода · `editor-bg` редактор ·
`text-color` · `text-muted` · `text-faint` · `border-color` · `hover-color` наведение · `active-bg` выбранный элемент ·
`accent-color` акцент (кнопки, фокус) · `accent-text` текст на акценте · `link-color` · `selection` выделение ·
`success-color` · `warning-color` · `danger-color` · `shadow-color` · `scrim` затемнение под окнами.

## syntax
`keyword` `string` `number` `comment` `function` `type` `field` `tag` `attr` `heading` `annotation`

## terminal
`background` `foreground` `cursor` и ANSI-цвета `black` `red` `green` `yellow` `blue` `magenta` `cyan` `white`
(+ `bright…`, например `brightRed`).
