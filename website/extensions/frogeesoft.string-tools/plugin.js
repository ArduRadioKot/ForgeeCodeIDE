// ==FrogeePlugin==
// @name String Tools
// @version 1.0.0
// @description Преобразования текста из палитры команд
// @isolation process
// ==/FrogeePlugin==

const words = (text) => text
  .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
  .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
  .match(/[\p{L}\p{N}\p{M}]+/gu) || [];
const capitalize = (word) => word.replace(/^./u, (letter) => letter.toUpperCase());
const identifier = (text) => words(text).map((word) => word.toLowerCase());

function mapLines(text, transform) {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const trailing = lines.length > 1 && lines.at(-1) === '';
  if (trailing) lines.pop();
  return transform(lines).join(newline) + (trailing ? newline : '');
}

const transforms = [
  ['camelCase', (text) => identifier(text).map((word, index) => index ? capitalize(word) : word).join('')],
  ['PascalCase', (text) => identifier(text).map(capitalize).join('')],
  ['snake_case', (text) => identifier(text).join('_')],
  ['kebab-case', (text) => identifier(text).join('-')],
  ['UPPER CASE', (text) => text.toUpperCase()],
  ['lower case', (text) => text.toLowerCase()],
  ['Sort lines / Сортировать строки', (text) => mapLines(text, (lines) => lines.sort()), true],
  ['Remove duplicate lines / Убрать дубли строк', (text) => mapLines(text, (lines) => [...new Set(lines)]), true],
  ['Trim lines / Убрать пробелы по краям строк', (text) => mapLines(text, (lines) => lines.map((line) => line.trim())), true],
];

function targetRange(text, from, to, lines) {
  if (!lines && from !== to) return { from, to };
  if (lines) {
    const start = from > 0 ? text.lastIndexOf('\n', from - 1) + 1 : 0;
    const end = text.indexOf('\n', to > from && text[to - 1] === '\n' ? to - 1 : to);
    return { from: start, to: end < 0 ? text.length : end - (text[end - 1] === '\r' ? 1 : 0) };
  }
  const before = text.slice(0, from).match(/[\p{L}\p{N}\p{M}_-]+$/u)?.[0] || '';
  const after = text.slice(to).match(/^[\p{L}\p{N}\p{M}_-]+/u)?.[0] || '';
  return { from: from - before.length, to: to + after.length };
}

for (const [name, transform, lines] of transforms) {
  frogee.addCommand({
    title: 'String Tools: ' + name,
    run(editor) {
      if (!editor.file()) {
        frogee.notify('Open a text file / Откройте текстовый файл');
        return;
      }
      const text = editor.get();
      const cursor = editor.cursor();
      const { from, to } = targetRange(text, cursor.from, cursor.to, lines);
      editor.replace(from, to, transform(text.slice(from, to)));
    },
  });
}
