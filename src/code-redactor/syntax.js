// Syntax highlighter for the editor overlay.
// One pass per language: ordered rules are merged into a single regex, so a token can never be
// re-matched inside markup that was already produced (comments and strings always win).
(function (global) {
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  const words = (list) => list.trim().split(/\s+/).map(reEscape).join('|');
  const word = (list) => `(?<![\\w$])(?:${words(list)})(?![\\w$])`;
  const BOL = '(?<![^\\n])'; // start of a line (no multiline flag, so "$" keeps meaning "end of text")
  const EOL = '(?![^\\n])';

  // ───────── shared token patterns (no capture groups: they are joined with alternation) ─────────
  const P = {
    cLine: '//[^\\n]*',
    hashLine: '#[^\\n]*',
    dashLine: '--[^\\n]*',
    semiLine: ';[^\\n]*',
    block: '/\\*[\\s\\S]*?(?:\\*/|$)',
    dq: '"(?:\\\\.|[^"\\\\\\n])*"?',
    sq: "'(?:\\\\.|[^'\\\\\\n])*'?",
    tpl: '`(?:\\\\[\\s\\S]|[^`\\\\])*`?',
    pyTriple: '[rRbBfFuU]{0,2}(?:"""[\\s\\S]*?(?:"""|$)|\'\'\'[\\s\\S]*?(?:\'\'\'|$))',
    pyStr: '[rRbBfFuU]{1,2}(?:"(?:\\\\.|[^"\\\\\\n])*"?|\'(?:\\\\.|[^\'\\\\\\n])*\'?)',
    num: '(?<![\\w$.])(?:0[xX][\\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\\d[\\d_]*\\.?[\\d_]*|\\.\\d[\\d_]*)(?:[eE][+-]?\\d+)?)[fFlLuUnjd]{0,3}(?![\\w$])',
    fn: '(?<![\\w$.])[A-Za-z_$][\\w$]*(?=\\s*\\()',
    method: '(?<=\\.)[A-Za-z_$][\\w$]*(?=\\s*\\()',
    cap: '(?<![\\w$])[A-Z][A-Za-z0-9_]*(?![\\w$(])',
    deco: '@[A-Za-z_][\\w.]*',
    dollarVar: '\\$\\{[^}\\n]*\\}|\\$[A-Za-z_]\\w*|\\$[0-9@#?*!$-]',
    // A "/" starts a regex literal unless it follows an operand (word, ")" or "]").
    regex: '(?:(?<![\\w$)\\]]\\s*)|(?<=(?<![\\w$])(?:return|typeof|case|in|of|delete|void|throw|new|else|do|yield|await)\\s*))/(?![/*])(?:\\\\.|\\[(?:\\\\.|[^\\]\\n])*\\]|[^/\\n\\\\\\[])+/[dgimsuyv]*',
  };

  // Build a language: rules run in priority order, earlier rules win at the same position.
  function lang(spec) {
    const rules = [];
    const add = (cls, src) => { if (src) rules.push([cls, src]); };
    (spec.comments || []).forEach((c) => add('comment', c));
    (spec.strings || []).forEach((s) => add('string', s));
    (spec.pre || []).forEach(([cls, src]) => add(cls, src));
    if (spec.deco) add('annotation', P.deco);
    if (spec.number !== false) add('number', P.num);
    if (spec.keywords) add('keyword', word(spec.keywords));
    if (spec.literals) add('keyword', word(spec.literals));
    if (spec.types) add('type', word(spec.types));
    if (spec.self) add('field', word(spec.self));
    (spec.post || []).forEach(([cls, src]) => add(cls, src));
    if (spec.capTypes) add('type', P.cap);
    if (spec.calls !== false) add('function', P.fn);
    return { ...spec, rules, flags: spec.flags || '' };
  }

  const JS_KW = 'break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new of return static super switch throw try typeof var void while with yield async await from as get set';
  const JS_LIT = 'true false null undefined NaN Infinity';
  const TS_KW = `${JS_KW} interface type enum implements namespace declare abstract readonly public private protected keyof infer is satisfies override module`;
  const TS_TYPES = 'string number boolean any unknown never object symbol bigint void';
  const jsLike = (extra = {}) => lang({
    comments: [P.cLine, P.block], strings: [P.dq, P.sq, P.tpl],
    pre: [['string', P.regex], ['annotation', P.deco]], keywords: JS_KW, literals: JS_LIT, self: 'this super',
    post: [['function', P.method]], ...extra,
  });

  const cLike = (keywords, types, extra = {}) => lang({
    comments: [P.cLine, P.block], strings: [P.dq, P.sq], keywords, types,
    literals: 'true false null nullptr NULL nil', post: [['function', P.method]], ...extra,
  });
  const preproc = [['annotation', `${BOL}[ \\t]*#[ \\t]*(?:include|define|undef|ifdef|ifndef|if|else|elif|endif|pragma|error|warning|region|endregion|line)\\b[^\\n]*`]];

  const LANGS = {};

  LANGS.js = jsLike();
  LANGS.jsx = jsLike({ pre: [['string', P.regex], ['tag', '(?<![\\w$)\\]])</?[A-Za-z][\\w.:-]*']] });
  LANGS.ts = jsLike({ keywords: TS_KW, types: TS_TYPES, capTypes: true });
  LANGS.tsx = jsLike({ keywords: TS_KW, types: TS_TYPES, capTypes: true, pre: [['string', P.regex], ['annotation', P.deco], ['tag', '(?<![\\w$)\\]>])</?[A-Z][\\w.]*']] });

  LANGS.py = lang({
    comments: [P.hashLine], strings: [P.pyTriple, P.pyStr, P.dq, P.sq],
    pre: [['type', '(?<=\\bclass\\s+)[A-Za-z_]\\w*']], deco: true,
    keywords: 'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case',
    literals: 'True False None', self: 'self cls',
    types: 'int str float bool list dict set tuple bytes object type',
    post: [['function', P.method]],
  });

  LANGS.json = lang({
    comments: [P.cLine, P.block],
    pre: [['key', '"(?:\\\\.|[^"\\\\\\n])*"(?=\\s*:)'], ['string', P.dq]],
    calls: false, literals: 'true false null',
  });

  const cssSpec = {
    comments: [P.block], strings: [P.dq, P.sq], calls: false, number: false,
    pre: [
      ['annotation', '@[\\w-]+'],
      ['key', '--[A-Za-z][\\w-]*(?=\\s*:)'],
      ['property', `(?<=[{;]\\s*|${BOL}\\s*)[a-z-]+(?=\\s*:\\s*[^;{}\\n]*(?:;|\\}|${EOL}))`],
      ['number', '#[0-9a-fA-F]{3,8}\\b'],
      ['number', '(?<![\\w#-])-?\\d*\\.?\\d+(?:px|em|rem|%|vh|vw|vmin|vmax|s|ms|deg|fr|ch|pt|cm|mm|in)?(?![\\w-])'],
      ['function', '[\\w-]+(?=\\()'],
      ['selector', '(?<![\\w-])[.#][A-Za-z_-][\\w-]*'],
      ['selector', '(?<=[\\w\\])*>+~]|\\s)::?(?:hover|focus|active|visited|first-child|last-child|nth-child|nth-of-type|not|is|where|has|before|after|root|checked|disabled|first-letter|first-line|placeholder|selection|focus-within|focus-visible|empty|only-child)(?![\\w-])'],
      ['tag', '(?<![\\w.#:-])(?:html|body|a|p|div|span|h[1-6]|ul|ol|li|img|button|input|form|table|tr|td|th|section|main|header|footer|nav|article|aside|label|select|textarea|svg|canvas|video|code|pre)(?![\\w-])(?=[^;}]*\\{)'],
    ],
    post: [['keyword', '!important']],
  };
  LANGS.css = lang(cssSpec);
  LANGS.scss = lang({ ...cssSpec, comments: [P.block, P.cLine], pre: [...cssSpec.pre, ['key', '\\$[\\w-]+']] });

  LANGS.sh = lang({
    comments: ['(?<![\\w$])#[^\\n]*'], strings: [P.dq, P.sq, '`[^`]*`?'],
    pre: [['field', P.dollarVar]], number: false,
    keywords: 'if then else elif fi for while until do done case esac in function select time return exit break continue export local readonly declare unset source alias eval exec trap shift set',
    calls: false,
    post: [['function', '(?<![\\w$./-])(?:echo|cd|ls|cat|grep|sed|awk|find|mkdir|rm|cp|mv|chmod|chown|curl|wget|git|npm|npx|yarn|pnpm|pip|pip3|python|python3|node|docker|sudo|make|tar|ssh|kill|test|printf|read|touch|head|tail|sort|uniq|xargs|which|brew|apt|apt-get|systemctl)(?![\\w-])']],
  });

  LANGS.yaml = lang({
    comments: ['(?<![\\w$])#[^\\n]*'], strings: [P.dq, P.sq],
    pre: [
      ['key', `(?<=${BOL}[ \\t]*(?:-[ \\t]+)?)[\\w.][\\w.\\-/ ]*?(?=[ \\t]*:(?:[ \\t]|${EOL}))`],
      ['annotation', '[&*][\\w-]+'], ['tag', '!{1,2}[\\w./-]*'], ['keyword', `${BOL}(?:---|\\.\\.\\.)`],
    ],
    literals: 'true false null yes no on off True False Null', calls: false,
  });
  LANGS.toml = lang({
    comments: [P.hashLine], strings: ['"""[\\s\\S]*?(?:"""|$)', P.dq, P.sq],
    pre: [['tag', `${BOL}[ \\t]*\\[\\[?[^\\]\\n]+\\]\\]?`], ['key', `${BOL}[ \\t]*[\\w.\\-"]+(?=[ \\t]*=)`]], literals: 'true false', calls: false,
  });
  LANGS.ini = lang({
    comments: [`(?:${BOL}|(?<=\\s))[;#][^\\n]*`], strings: [P.dq, P.sq],
    pre: [['tag', `${BOL}[ \\t]*\\[[^\\]\\n]+\\]`], ['key', `${BOL}[ \\t]*[\\w.\\-]+(?=[ \\t]*[=:])`]], literals: 'true false yes no on off', calls: false,
  });

  LANGS.sql = lang({
    comments: [P.dashLine, P.block], strings: [P.sq, P.dq, '`[^`\\n]*`?'], flags: 'i',
    keywords: 'select from where and or not in is null like between exists join inner outer left right full cross on as group by order having limit offset insert into values update set delete create alter drop table database index view trigger primary key foreign references default unique check constraint distinct union all case when then else end asc desc with recursive returning begin commit rollback transaction explain truncate add column if cascade replace temporary',
    types: 'int integer bigint smallint tinyint serial varchar char text boolean bool date datetime timestamp time decimal numeric float double real json jsonb uuid blob',
    literals: 'true false',
  });

  LANGS.c = cLike(
    'auto break case const continue default do else enum extern for goto if inline register restrict return sizeof static struct switch typedef union volatile while',
    'int char short long float double void unsigned signed size_t bool uint8_t uint16_t uint32_t uint64_t int8_t int16_t int32_t int64_t FILE',
    { pre: [...preproc, ['string', `(?<=#\\s*include\\s+)<[\\w./+-]+>`]] },
  );
  LANGS.cpp = cLike(
    'alignas alignof and asm auto break case catch class const constexpr const_cast continue decltype default delete do dynamic_cast else enum explicit export extern for friend goto if inline mutable namespace new noexcept not operator or override private protected public register reinterpret_cast return sizeof static static_assert static_cast struct switch template throw try typedef typeid typename union using virtual volatile while final',
    'int char short long float double void unsigned signed bool size_t string vector map set unordered_map unique_ptr shared_ptr wchar_t',
    { pre: [...preproc, ['string', `(?<=#\\s*include\\s+)<[\\w./+-]+>`]], self: 'this' },
  );
  LANGS.cs = cLike(
    'abstract as base break case catch checked class const continue default delegate do else enum event explicit extern finally fixed for foreach goto if implicit in interface internal is lock namespace new operator out override params private protected public readonly ref return sealed sizeof stackalloc static struct switch throw try typeof unchecked unsafe using virtual volatile while var async await record init get set yield partial where',
    'bool byte char decimal double float int long object sbyte short string uint ulong ushort void dynamic',
    { pre: [...preproc, ['annotation', '\\[[A-Z]\\w*(?:\\([^)]*\\))?\\]']], capTypes: true, self: 'this base' },
  );
  LANGS.java = cLike(
    'abstract assert break case catch class const continue default do else enum extends final finally for goto if implements import instanceof interface native new package private protected public return static strictfp super switch synchronized throw throws transient try volatile while var record sealed permits yield',
    'boolean byte char double float int long short void String Object Integer Long Double List Map Set',
    { deco: true, capTypes: true, self: 'this super' },
  );
  LANGS.kt = cLike(
    'as break by catch class companion constructor continue data do else enum external final finally for fun if import in infix init inline inner interface internal is lateinit lazy object open operator out override package private protected public reified return sealed suspend throw try typealias val var vararg when where while get set',
    'Int Long Short Byte Float Double Boolean Char String Unit Any Nothing List Map Set Array',
    { deco: true, capTypes: true, strings: ['"""[\\s\\S]*?(?:"""|$)', P.dq, P.sq], self: 'this super' },
  );
  LANGS.swift = cLike(
    'actor associatedtype async await break case catch class continue default defer deinit do else enum extension fallthrough fileprivate for func guard if import in indirect infix init inout internal is let nonisolated open operator override postfix precedencegroup prefix private protocol public repeat rethrows return static struct subscript switch throw throws try typealias var where while willSet didSet get set some any',
    'Int Int8 Int16 Int32 Int64 UInt Float Double Bool String Character Array Dictionary Set Optional Any AnyObject Void',
    { deco: true, capTypes: true, self: 'self Self super' },
  );
  LANGS.go = cLike(
    'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var',
    'int int8 int16 int32 int64 uint uint8 uint16 uint32 uint64 uintptr float32 float64 complex64 complex128 string bool byte rune error any',
    { strings: [P.dq, P.sq, '`[^`]*`?'], literals: 'true false nil iota' },
  );
  LANGS.rs = cLike(
    'as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return static struct super trait type unsafe use where while',
    'i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str String Vec Option Result Box Rc Arc',
    {
      strings: [P.dq, "'(?:\\\\.|[^'\\\\\\n])'", 'r#*"[\\s\\S]*?"#*'], literals: 'true false None Some Ok Err', self: 'self Self', capTypes: true,
      pre: [['annotation', '#!?\\[[^\\]\\n]*\\]'], ['function', '[A-Za-z_]\\w*!(?=\\s*[(\\[{])'], ['annotation', "'[a-z_]+(?![\\w'])"]],
    },
  );
  LANGS.dart = cLike(
    'abstract as assert async await break case catch class const continue covariant default deferred do dynamic else enum export extends extension external factory final finally for get hide if implements import in interface is late library mixin new on operator part required rethrow return set show static switch sync throw try typedef var void while with yield',
    'int double num bool String List Map Set Future Stream Object dynamic void',
    { deco: true, capTypes: true, self: 'this super' },
  );
  LANGS.scala = cLike(
    'abstract case catch class def do else extends final finally for forSome if implicit import lazy match new object override package private protected return sealed throw trait try type val var while with yield given using enum then',
    'Int Long Double Float Boolean String Char Unit Any AnyRef Nothing List Map Set Seq Option Either',
    { deco: true, capTypes: true, self: 'this super' },
  );

  LANGS.php = lang({
    comments: [P.cLine, '#(?!\\[)[^\\n]*', P.block], strings: [P.dq, P.sq],
    pre: [['field', '\\$[A-Za-z_]\\w*'], ['annotation', '<\\?php|<\\?=|\\?>']],
    keywords: 'abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile enum extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield',
    literals: 'true false null TRUE FALSE NULL', types: 'int float string bool array object mixed void iterable callable self parent', capTypes: true, self: 'this',
    post: [['function', '(?<=->)[A-Za-z_]\\w*(?=\\s*\\()'], ['function', P.method]],
  });
  LANGS.rb = lang({
    comments: [`${BOL}=begin[\\s\\S]*?(?:${BOL}=end|$)`, '(?<![\\w$])#[^\\n]*'], strings: [P.dq, P.sq, '%[qQwWiI]?[({\\[<][^)}\\]>\\n]*[)}\\]>]'],
    pre: [['annotation', '(?<![\\w:]):[A-Za-z_]\\w*[?!]?'], ['field', '@{1,2}[A-Za-z_]\\w*'], ['field', '\\$[A-Za-z_]\\w*']],
    keywords: 'alias and begin break case class def do else elsif end ensure for if in module next not or redo rescue retry return then undef unless until when while yield require require_relative include extend attr_accessor attr_reader attr_writer private protected public lambda proc puts print raise loop',
    literals: 'true false nil', self: 'self super', capTypes: true,
  });
  LANGS.lua = lang({
    comments: ['--\\[=*\\[[\\s\\S]*?(?:\\]=*\\]|$)', '--[^\\n]*'], strings: [P.dq, P.sq, '\\[=*\\[[\\s\\S]*?(?:\\]=*\\]|$)'],
    keywords: 'and break do else elseif end for function goto if in local not or repeat return then until while', literals: 'true false nil', self: 'self',
  });
  LANGS.r = lang({
    comments: [P.hashLine], strings: [P.dq, P.sq, '`[^`]*`?'],
    keywords: 'if else repeat while function for next break in return library require source', literals: 'TRUE FALSE NULL NA NA_integer_ NA_real_ NA_character_ Inf NaN',
    post: [['annotation', '<<-|<-|->|%[^%\\n]*%']],
  });
  LANGS.ps1 = lang({
    comments: ['#[^\\n]*', '<#[\\s\\S]*?(?:#>|$)'], strings: [P.dq, P.sq], flags: 'i',
    pre: [['field', '\\$\\{[^}]*\\}|\\$[A-Za-z_]\\w*'], ['function', '(?<![\\w-])[A-Z][a-z]+-[A-Z][A-Za-z]+']],
    keywords: 'begin break catch class continue data do dynamicparam else elseif end exit filter finally for foreach from function if in param process return switch throw trap try until using var while workflow',
  });
  LANGS.dockerfile = lang({
    comments: [`${BOL}[ \\t]*#[^\\n]*`], strings: [P.dq, P.sq], flags: 'i', calls: false,
    pre: [['keyword', `${BOL}[ \\t]*(?:FROM|RUN|CMD|LABEL|MAINTAINER|EXPOSE|ENV|ADD|COPY|ENTRYPOINT|VOLUME|USER|WORKDIR|ARG|ONBUILD|STOPSIGNAL|HEALTHCHECK|SHELL)(?![\\w-])`], ['field', P.dollarVar], ['keyword', '(?<=FROM\\s+\\S+\\s+)AS(?![\\w-])']],
  });
  LANGS.makefile = lang({
    comments: ['(?<![\\w$\\\\])#[^\\n]*'], strings: [P.dq, P.sq], calls: false, number: false,
    pre: [
      ['field', '\\$\\([^)\\n]*\\)|\\$\\{[^}\\n]*\\}|\\$[@<^?*%+|]'],
      ['key', `${BOL}[\\w.%/\\-]+(?=[ \\t]*:(?!=))`],
      ['keyword', `${BOL}(?:ifeq|ifneq|ifdef|ifndef|else|endif|include|-include|define|endef|export|override|vpath)(?![\\w-])`],
    ],
  });
  LANGS.diff = lang({
    number: false, calls: false,
    pre: [['diffadd', `${BOL}\\+(?!\\+\\+)[^\\n]*`], ['diffdel', `${BOL}-(?!--)[^\\n]*`], ['annotation', `${BOL}@@[^\\n]*`], ['tag', `${BOL}(?:diff|index|\\+\\+\\+|---)[^\\n]*`]],
  });
  LANGS.lisp = lang({
    comments: [P.semiLine], strings: [P.dq], calls: false,
    keywords: 'defun defmacro defvar defparameter let lambda if cond when unless progn setq setf loop do dolist dotimes quote function define begin', literals: 't nil',
  });
  LANGS.plain = { rules: [], flags: '' };

  // ───────── compile ─────────
  Object.values(LANGS).forEach((l) => {
    if (!l.rules.length) { l.re = null; return; }
    l.classes = l.rules.map((r) => r[0]);
    l.re = new RegExp(l.rules.map((r) => `(${r[1]})`).join('|'), `g${l.flags}`);
  });

  const span = (cls, text) => `<span class="tok-${cls}">${esc(text)}</span>`;

  function run(l, code) {
    if (!l.re) return esc(code);
    const re = l.re;
    re.lastIndex = 0;
    let out = '';
    let last = 0;
    let m;
    while ((m = re.exec(code)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      let g = 1;
      while (g < m.length && m[g] === undefined) g++;
      if (m.index > last) out += esc(code.slice(last, m.index));
      out += span(l.classes[g - 1], m[0]);
      last = m.index + m[0].length;
    }
    return out + esc(code.slice(last));
  }

  // ───────── markup: html / xml / vue / svelte (with embedded <script> and <style>) ─────────
  const ATTR_VALUE = '"[^"]*"?|\'[^\']*\'?|[^\\s"\'=<>`]+';
  function highlightTag(tag) {
    const open = /^<\/?[\w:.-]*/.exec(tag)[0];
    const rest = tag.slice(open.length);
    let out = `<span class="tok-tag">${esc(open)}</span>`;
    const attr = new RegExp(`([^\\s=/>"']+)(\\s*=\\s*)?(${ATTR_VALUE})?|(/?>)`, 'g');
    let last = 0;
    let m;
    while ((m = attr.exec(rest)) !== null) {
      if (m[0].length === 0) { attr.lastIndex++; continue; }
      if (m.index > last) out += esc(rest.slice(last, m.index));
      if (m[4]) out += `<span class="tok-tag">${esc(m[4])}</span>`;
      else {
        out += `<span class="tok-attr">${esc(m[1])}</span>`;
        if (m[2]) out += esc(m[2]);
        if (m[3]) out += span(/^["']/.test(m[3]) ? 'string' : 'number', m[3]);
      }
      last = m.index + m[0].length;
    }
    return out + esc(rest.slice(last));
  }

  function highlightMarkup(code) {
    const re = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<!DOCTYPE[^>]*>?|<\?[\s\S]*?(?:\?>|$)|<(script|style)\b([^>]*)>([\s\S]*?)(?:<\/\1\s*>|$)|<\/?[A-Za-z][\w:.-]*(?:[^<>"']|"[^"]*"|'[^']*')*>?|&[#\w]+;|\{\{[\s\S]*?(?:\}\}|$)/gi;
    let out = '';
    let last = 0;
    let m;
    while ((m = re.exec(code)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      if (m.index > last) out += esc(code.slice(last, m.index));
      const t = m[0];
      if (t.startsWith('<!--')) out += span('comment', t);
      else if (t.startsWith('<![') || /^<!doctype/i.test(t) || t.startsWith('<?')) out += span('annotation', t);
      else if (t.startsWith('&')) out += span('number', t);
      else if (t.startsWith('{{')) out += span('field', t);
      else if (m[1]) {
        const openTag = `<${m[1]}${m[2]}>`;
        const closing = t.slice(openTag.length + m[3].length);
        const inner = LANGS[m[1].toLowerCase() === 'style' ? 'css' : 'js'];
        out += highlightTag(openTag) + run(inner, m[3]) + (closing ? highlightTag(closing) : '');
      } else out += highlightTag(t);
      last = m.index + t.length;
    }
    return out + esc(code.slice(last));
  }

  // ───────── markdown ─────────
  function highlightMarkdown(code) {
    const re = /^(```|~~~)[^\n]*\n[\s\S]*?(?:\n\1[^\n]*(?=\n|(?![\s\S]))|(?![\s\S]))|^#{1,6}[ \t][^\n]*|^>[^\n]*|^[ \t]*(?:[-*+]|\d+[.)])[ \t]|^(?:-{3,}|\*{3,}|_{3,})[ \t]*$|`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|(?<![\w*])\*[^*\n]+\*(?![\w*])|~~[^~\n]+~~|!?\[[^\]\n]*\]\([^)\n]*\)|<https?:\/\/[^>\n]+>/gm;
    let out = '';
    let last = 0;
    let m;
    while ((m = re.exec(code)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      if (m.index > last) out += esc(code.slice(last, m.index));
      const t = m[0];
      if (m[1]) {
        const nl = t.indexOf('\n');
        const info = t.slice(m[1].length, nl).trim().split(/\s+/)[0] || '';
        const bodyEnd = /\n(?:```|~~~)[^\n]*$/.exec(t);
        const body = t.slice(nl + 1, bodyEnd ? bodyEnd.index : t.length);
        const tail = bodyEnd ? t.slice(bodyEnd.index) : '';
        out += span('comment', t.slice(0, nl + 1)) + highlightByName(body, info) + (tail ? span('comment', tail) : '');
      } else if (t.startsWith('#')) out += span('heading', t);
      else if (t.startsWith('>')) out += span('comment', t);
      else if (t.startsWith('`')) out += span('string', t);
      else if (t.startsWith('**') || t.startsWith('__')) out += span('bold', t);
      else if (t.startsWith('*') && !/^\*{3,}/.test(t) && t.length > 2) out += span('italic', t);
      else if (t.startsWith('~~')) out += span('comment', t);
      else if (t.startsWith('[') || t.startsWith('!') || t.startsWith('<')) out += span('function', t);
      else out += span('keyword', t);
      last = m.index + t.length;
    }
    return out + esc(code.slice(last));
  }

  // ───────── language detection ─────────
  const EXT = {
    js: 'js', mjs: 'js', cjs: 'js', jsx: 'jsx', ts: 'ts', mts: 'ts', cts: 'ts', tsx: 'tsx',
    py: 'py', pyw: 'py', pyi: 'py', ipynb: 'json', json: 'json', jsonc: 'json', json5: 'json', webmanifest: 'json', geojson: 'json',
    html: 'html', htm: 'html', xhtml: 'html', xml: 'html', svg: 'html', xsd: 'html', plist: 'html', vue: 'html', svelte: 'html', astro: 'html', ejs: 'html', hbs: 'html',
    css: 'css', scss: 'scss', sass: 'scss', less: 'scss', md: 'md', markdown: 'md', mdx: 'md',
    sh: 'sh', bash: 'sh', zsh: 'sh', fish: 'sh', ksh: 'sh', env: 'ini', yml: 'yaml', yaml: 'yaml', toml: 'toml',
    ini: 'ini', cfg: 'ini', conf: 'ini', properties: 'ini', editorconfig: 'ini', gitconfig: 'ini', sql: 'sql', psql: 'sql',
    c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp', ino: 'cpp', cs: 'cs', csx: 'cs',
    java: 'java', kt: 'kt', kts: 'kt', swift: 'swift', go: 'go', rs: 'rs', dart: 'dart', scala: 'scala', sc: 'scala',
    php: 'php', phtml: 'php', rb: 'rb', rake: 'rb', gemspec: 'rb', lua: 'lua', r: 'r', ps1: 'ps1', psm1: 'ps1', psd1: 'ps1',
    diff: 'diff', patch: 'diff', lisp: 'lisp', cl: 'lisp', el: 'lisp', clj: 'lisp', scm: 'lisp', mk: 'makefile',
  };
  const NAMES = {
    dockerfile: 'dockerfile', makefile: 'makefile', gnumakefile: 'makefile', '.bashrc': 'sh', '.zshrc': 'sh', '.profile': 'sh', '.env': 'ini',
    '.gitignore': 'ini', '.gitattributes': 'ini', '.npmrc': 'ini', '.editorconfig': 'ini', rakefile: 'rb', gemfile: 'rb', 'cmakelists.txt': 'makefile',
  };

  function detectLanguage(fileName) {
    if (!fileName) return 'plain';
    const base = String(fileName).split(/[\\/]/).pop().toLowerCase();
    if (NAMES[base]) return NAMES[base];
    if (/^dockerfile(\.|$)/.test(base)) return 'dockerfile';
    if (!base.includes('.')) return 'plain';
    return EXT[base.split('.').pop()] || 'plain';
  }

  const LABELS = {
    js: 'JavaScript', jsx: 'JavaScript (JSX)', ts: 'TypeScript', tsx: 'TypeScript (TSX)', py: 'Python', json: 'JSON', html: 'HTML / XML', css: 'CSS', scss: 'SCSS',
    md: 'Markdown', sh: 'Shell', yaml: 'YAML', toml: 'TOML', ini: 'Config', sql: 'SQL', c: 'C', cpp: 'C++', cs: 'C#', java: 'Java', kt: 'Kotlin', swift: 'Swift',
    go: 'Go', rs: 'Rust', dart: 'Dart', scala: 'Scala', php: 'PHP', rb: 'Ruby', lua: 'Lua', r: 'R', ps1: 'PowerShell', dockerfile: 'Dockerfile', makefile: 'Makefile',
    diff: 'Diff', lisp: 'Lisp', plain: 'Plain Text',
  };
  const ALIASES = {
    javascript: 'js', node: 'js', typescript: 'ts', python: 'py', python3: 'py', shell: 'sh', bash: 'sh', zsh: 'sh', console: 'sh', yml: 'yaml', xml: 'html',
    svg: 'html', vue: 'html', jsonc: 'json', golang: 'go', rust: 'rs', csharp: 'cs', 'c++': 'cpp', 'c#': 'cs', kotlin: 'kt', ruby: 'rb', powershell: 'ps1',
    docker: 'dockerfile', make: 'makefile', markdown: 'md',
  };

  function highlightLang(lang, code) {
    if (code.length > 400000) return esc(code);
    try {
      if (lang === 'html') return highlightMarkup(code);
      if (lang === 'md') return highlightMarkdown(code);
      return run(LANGS[lang] || LANGS.plain, code);
    } catch (err) {
      return esc(code);
    }
  }

  function highlightByName(code, name) {
    const key = String(name || '').toLowerCase();
    const lang = ALIASES[key] || (LANGS[key] || key === 'html' || key === 'md' ? key : detectLanguage(`x.${key}`));
    return highlightLang(lang, code);
  }

  function highlight(code, fileName) {
    // Keep the trailing newline so the overlay height matches the textarea.
    const text = code.endsWith('\n') ? code : code + '\n';
    return highlightLang(detectLanguage(fileName), text);
  }

  global.SyntaxHighlight = {
    highlight, highlightByName, detectLanguage,
    label: (lang) => LABELS[lang] || String(lang).toUpperCase(),
    languages: Object.keys(LABELS),
  };
})(typeof window !== 'undefined' ? window : globalThis);
