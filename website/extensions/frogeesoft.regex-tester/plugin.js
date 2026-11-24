// ==FrogeePlugin==
// @name Regex Tester
// @version 1.0.0
// @description Проверяет регулярные выражения JavaScript на выделенном или введённом тексте
// ==/FrogeePlugin==

const title = 'Regex Tester';
const en = (document.documentElement.lang || '').startsWith('en');
const tr = (ru, english) => en ? english : ru;
const inputLimit = 32000;
const matchLimit = 100;

function evaluateRegex() {
  self.onmessage = ({ data: { pattern, flags, text, replacement, limit } }) => {
    try {
      const expression = new RegExp(pattern, flags);
      const matches = [];
      const first = expression.global ? text.matchAll(expression) : [expression.exec(text)].filter(Boolean);
      for (const match of first) {
        matches.push({ index: match.index, value: match[0], groups: [...match.slice(1)], named: match.groups });
        if (matches.length > limit) break;
      }
      expression.lastIndex = 0;
      const result = text.replace(expression, replacement);
      self.postMessage({ matches, result: result.slice(0, 64000), truncated: result.length > 64000 });
    } catch (error) {
      self.postMessage({ error: error.message });
    }
  };
}

frogee.addStyle(`
  .regex-tool { padding: var(--pad); overflow: auto; gap: 12px; }
  .regex-tool h2 { font-size: 15px; }
  .regex-tool label { display: grid; gap: 4px; min-width: 0; color: var(--text-muted); }
  .regex-tool input, .regex-tool textarea, .regex-tool pre {
    min-width: 0; width: 100%; padding: 7px 9px; border: 1px solid var(--border-color);
    border-radius: var(--radius-sm); background: var(--code-bg); color: var(--text-color);
    font: 12px/1.55 var(--mono-font);
  }
  .regex-tool textarea { resize: vertical; min-height: 80px; }
  .regex-tool pre { white-space: pre-wrap; overflow-wrap: anywhere; }
  .regex-tool mark { background: var(--accent-soft); color: inherit; }
  .regex-fields { display: grid; grid-template-columns: minmax(0, 1fr) minmax(58px, 72px); gap: 8px; }
  .regex-matches { margin-left: 20px; overflow-wrap: anywhere; }
  .regex-status.is-error { color: var(--danger-color); }
`);

function openTester(editor) {
  const selection = editor.selection();
  let dispose;
  const tab = frogee.openTab({
    title,
    onClose: () => dispose?.(),
    render(element) {
      dispose = buildTester(element);
    },
  });
  const sample = tab?.element.querySelector('[data-regex-sample]');
  if (sample && selection) {
    sample.value = selection.slice(0, inputLimit);
    if (selection.length > inputLimit) frogee.notify(tr('Образец обрезан до 32 000 символов.', 'Sample limited to 32,000 characters.'));
    sample.dispatchEvent(new Event('input'));
  }
  tab?.element.querySelector('[data-regex-pattern]')?.focus();
}

function buildTester(element) {
  element.classList.add('regex-tool');
  element.innerHTML = `
    <h2>Regex Tester</h2>
    <div class="regex-fields">
      <label>${tr('Выражение', 'Pattern')}<input data-regex-pattern spellcheck="false" autocomplete="off" placeholder="\\w+"></label>
      <label>${tr('Флаги', 'Flags')}<input data-regex-flags spellcheck="false" autocomplete="off" value="g" maxlength="8"></label>
    </div>
    <label>${tr('Образец текста', 'Sample text')}<textarea data-regex-sample rows="5" maxlength="${inputLimit}" spellcheck="false"></textarea></label>
    <label>${tr('Замена', 'Replacement')}<input data-regex-replacement spellcheck="false" maxlength="256" placeholder="$1"></label>
    <div class="regex-status" role="status"></div>
    <pre data-regex-highlight hidden></pre>
    <ol class="regex-matches" hidden></ol>
    <label>${tr('Результат замены', 'Replacement preview')}<textarea data-regex-result rows="4" readonly></textarea></label>`;
  const field = (name) => element.querySelector('[data-regex-' + name + ']');
  const status = element.querySelector('.regex-status');
  const highlight = field('highlight');
  const list = element.querySelector('.regex-matches');
  const result = field('result');
  const workerUrl = URL.createObjectURL(new Blob(['(' + evaluateRegex.toString() + ')()'], { type: 'text/javascript' }));
  let timer;
  let deadline;
  let worker;

  function cancel() {
    clearTimeout(timer);
    clearTimeout(deadline);
    worker?.terminate();
    worker = null;
  }

  function reset(message, error = false) {
    status.textContent = message;
    status.classList.toggle('is-error', error);
    highlight.hidden = true;
    list.hidden = true;
    result.value = '';
  }

  function paint(data, text) {
    if (data.error) {
      reset(data.error, true);
      return;
    }
    const matches = data.matches.slice(0, matchLimit);
    const count = data.matches.length > matchLimit ? matchLimit + '+' : matches.length;
    status.classList.remove('is-error');
    status.textContent = tr('Совпадений: ', 'Matches: ') + count;
    if (data.truncated) status.textContent += tr(' · Замена обрезана', ' · Replacement truncated');
    highlight.replaceChildren();
    list.replaceChildren();
    let offset = 0;
    for (const { index, value, groups, named } of matches) {
      const mark = document.createElement('mark');
      mark.textContent = value || '│';
      highlight.append(text.slice(offset, index), mark);
      offset = index + value.length;
      const item = document.createElement('li');
      const captures = [...groups.map((value, index) => [index + 1, value]), ...Object.entries(named || {})];
      item.textContent = '@' + index + ' ' + JSON.stringify(value)
        + captures.map(([key, value]) => '  $' + key + ' = ' + (value === undefined ? '—' : JSON.stringify(value))).join('');
      list.append(item);
    }
    highlight.append(text.slice(offset));
    highlight.hidden = !matches.length;
    list.hidden = !matches.length;
    result.value = data.result;
  }

  function refresh() {
    cancel();
    const pattern = field('pattern').value;
    reset(pattern ? tr('Проверка…', 'Matching…') : tr('Введите регулярное выражение.', 'Enter a regular expression.'));
    if (!pattern) return;
    const text = field('sample').value;
    const flags = field('flags').value.trim();
    const replacement = field('replacement').value;
    timer = setTimeout(() => {
      let task;
      try { task = new Worker(workerUrl); }
      catch (error) { reset(error.message, true); return; }
      worker = task;
      deadline = setTimeout(() => {
        cancel();
        reset(tr('Выражение выполнялось слишком долго.', 'The expression took too long.'), true);
      }, 1200);
      task.onmessage = ({ data }) => {
        if (task !== worker) return;
        cancel();
        paint(data, text);
      };
      task.onerror = () => {
        if (task !== worker) return;
        cancel();
        reset(tr('Не удалось проверить выражение.', 'Could not evaluate the expression.'), true);
      };
      task.postMessage({ pattern, flags, text, replacement, limit: matchLimit });
    }, 140);
  }

  element.addEventListener('input', refresh);
  refresh();
  return () => { cancel(); URL.revokeObjectURL(workerUrl); };
}

frogee.addButton({ title, icon: 'code', run: openTester });
frogee.addCommand({ title, run: openTester });
