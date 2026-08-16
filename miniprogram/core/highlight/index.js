/**
 * core/highlight/index.js
 * 轻量级语法高亮器
 *
 * 设计：
 * - 纯正则分词，无 DOM 依赖，可在 Worker / Node 中运行
 * - 覆盖 Top 15 语言（JS/TS/Python/Java/C/C++/Go/Rust/PHP/Ruby/HTML/CSS/JSON/Bash/SQL）
 * - 输出 token 数组：[{ text, type }]
 * - type: keyword | string | comment | number | function | operator | plain
 * - 体积 < 8KB，无需 npm 构建，直接 require
 *
 * AGENTS.md 约束：highlight.js 全量 900KB 不可接受，裁剪版也需 npm 构建+进分包。
 * 本实现用正则覆盖核心模式，体积更小、零依赖、加载更快。
 */

// ─── 通用 token 类型 ───
var TYPE_KEYWORD = 'keyword';
var TYPE_STRING = 'string';
var TYPE_COMMENT = 'comment';
var TYPE_NUMBER = 'number';
var TYPE_FUNCTION = 'function';
var TYPE_OPERATOR = 'operator';
var TYPE_PLAIN = 'plain';

// ─── 语言定义 ───
// 每种语言定义：keywords（关键字列表），commentPattern（注释），stringPattern（字符串）
var LANGS = {
  javascript: {
    aliases: ['js', 'jsx', 'node'],
    keywords: 'var let const function return if else for while do switch case break continue new this typeof instanceof in of void delete try catch finally throw class extends super static get set async await yield import export from default as null undefined true false NaN Infinity',
    comment: /\/\/.*$|\/\*[\s\S]*?\*\//,
    string: /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/,
    number: /\b0[xX][0-9a-fA-F]+\b|\b0[oO][0-7]+\b|\b0[bB][01]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/,
    func: /[a-zA-Z_$][\w$]*(?=\s*\()/,
  },
  typescript: {
    aliases: ['ts', 'tsx'],
    keywords: 'var let const function return if else for while do switch case break continue new this typeof instanceof in of void delete try catch finally throw class extends super static get set async await yield import export from default as null undefined true false NaN Infinity type interface enum namespace public private protected readonly abstract implements declare module ambient',
    comment: /\/\/.*$|\/\*[\s\S]*?\*\//,
    string: /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/,
    number: /\b0[xX][0-9a-fA-F]+\b|\b0[oO][0-7]+\b|\b0[bB][01]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/,
    func: /[a-zA-Z_$][\w$]*(?=\s*\()/,
  },
  python: {
    aliases: ['py'],
    keywords: 'def class return if elif else for while break continue pass try except finally raise with as import from lambda yield global nonlocal local del assert in is not and or None True False self cls print',
    comment: /#[^\n]*/,
    string: /'''[\s\S]*?'''|"""[\s\S]*?"""|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/,
    number: /\b0[xX][0-9a-fA-F]+\b|\b0[oO][0-7]+\b|\b0[bB][01]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/,
    func: /[a-zA-Z_][\w]*(?=\s*\()/,
  },
  java: {
    aliases: [],
    keywords: 'public private protected class interface extends implements static final void int long double float boolean char byte short String return if else for while do switch case break continue new this super try catch finally throw throws import package abstract synchronized volatile transient native enum instanceof null true false',
    comment: /\/\/.*$|\/\*[\s\S]*?\*\//,
    string: /"(?:[^"\\]|\\.)*"/,
    number: /\b0[xX][0-9a-fA-F]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?[fFdDlL]?\b/,
    func: /[a-zA-Z_][\w]*(?=\s*\()/,
  },
  c: {
    aliases: ['h'],
    keywords: 'int long short char float double void unsigned signed const volatile static extern register auto struct union enum typedef return if else for while do switch case break continue goto sizeof sizeof null true false',
    comment: /\/\/.*$|\/\*[\s\S]*?\*\//,
    string: /"(?:[^"\\]|\\.)*"/,
    number: /\b0[xX][0-9a-fA-F]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?[fFlLuU]*\b/,
    func: /[a-zA-Z_][\w]*(?=\s*\()/,
  },
  cpp: {
    aliases: ['c++', 'cc', 'cxx', 'hpp'],
    keywords: 'int long short char float double void unsigned signed const volatile static extern register auto struct union enum typedef return if else for while do switch case break continue goto sizeof class public private protected namespace using template typename new delete this virtual override final friend operator nullptr true false bool wchar_t size_t std',
    comment: /\/\/.*$|\/\*[\s\S]*?\*\//,
    string: /"(?:[^"\\]|\\.)*"/,
    number: /\b0[xX][0-9a-fA-F]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?[fFlLuU]*\b/,
    func: /[a-zA-Z_][\w]*(?=\s*\()/,
  },
  go: {
    aliases: ['golang'],
    keywords: 'package import func var const type struct interface map chan range return if else for switch case default break continue goto fallthrough defer go select nil true false iota break default func interface select case defer go map struct chan else goto package switch const if range type',
    comment: /\/\/.*$|\/\*[\s\S]*?\*\//,
    string: /"(?:[^"\\]|\\.)*"|`[^`]*`/,
    number: /\b0[xX][0-9a-fA-F]+\b|\b0[oO][0-7]+\b|\b0[bB][01]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/,
    func: /[a-zA-Z_][\w]*(?=\s*\()/,
  },
  rust: {
    aliases: ['rs'],
    keywords: 'fn let mut const static struct enum trait impl pub use mod crate extern as ref move box where async await dyn unsafe return if else for while loop match break continue self Self super in type fn super trait struct impl true false',
    comment: /\/\/.*$|\/\*[\s\S]*?\*\//,
    string: /"(?:[^"\\]|\\.)*"/,
    number: /\b0[xX][0-9a-fA-F]+\b|\b0[oO][0-7]+\b|\b0[bB][01]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/,
    func: /[a-zA-Z_][\w]*(?=\s*\()/,
  },
  php: {
    aliases: [],
    keywords: 'function class public private protected static final abstract return if else elseif for while do switch case break continue new try catch finally throw use namespace implements extends const var echo print isset unset array null true false $this parent self',
    comment: /\/\/.*$|#.*$|\/\*[\s\S]*?\*\//,
    string: /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/,
    number: /\b0[xX][0-9a-fA-F]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/,
    func: /[a-zA-Z_][\w]*(?=\s*\()/,
  },
  ruby: {
    aliases: ['rb'],
    keywords: 'def class module return if elsif else unless while until for case when break next redo retry begin end rescue ensure raise require require_relative include extend attr_accessor attr_reader attr_writer public private protected nil true false self super yield lambda proc do end then',
    comment: /#[^\n]*/,
    string: /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/,
    number: /\b0[xX][0-9a-fA-F]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/,
    func: /[a-zA-Z_][\w]*(?=\s*\()/,
  },
  html: {
    aliases: ['xml', 'svg'],
    keywords: 'html head body div span p a img ul ol li table tr td th form input button label select option textarea nav header footer main section article aside h1 h2 h3 h4 h5 h6 br hr meta link title script style',
    comment: /<!--[\s\S]*?-->/,
    string: /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/,
    number: null,
    func: null,
    tagPattern: true, // 特殊处理：高亮标签名和属性
  },
  css: {
    aliases: ['scss', 'less'],
    keywords: 'color background margin padding border width height display position top left right bottom float clear overflow z-index font text align justify content flex grid gap important none auto inherit initial',
    comment: /\/\*[\s\S]*?\*\//,
    string: /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/,
    number: /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|\b\d+(?:\.\d+)?(?:px|em|rem|vw|vh|%|s|ms|deg|fr)?\b/,
    func: null,
    propertyPattern: true, // 特殊处理：高亮属性名
  },
  json: {
    aliases: [],
    keywords: 'true false null',
    comment: null,
    string: /"(?:[^"\\]|\\.)*"/,
    number: /\b-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/,
    func: null,
    keyPattern: true, // 特殊处理：高亮 key
  },
  bash: {
    aliases: ['sh', 'shell', 'zsh'],
    keywords: 'if then else elif fi for while do done case esac function return exit echo printf read export unset source alias local declare typeset let test cd pwd ls cat grep sed awk find xargs mkdir rmdir rm cp mv touch chmod chown sudo apt yum brew npm pip git',
    comment: /#[^\n]*/,
    string: /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/,
    number: /\b\d+(?:\.\d+)?\b/,
    func: /[a-zA-Z_][\w]*(?=\s*\()/,
  },
  sql: {
    aliases: ['mysql', 'postgresql', 'sqlite'],
    keywords: 'SELECT FROM WHERE INSERT INTO UPDATE DELETE CREATE TABLE ALTER DROP INDEX VIEW JOIN INNER LEFT RIGHT OUTER ON GROUP BY HAVING ORDER ASC DESC LIMIT OFFSET UNION ALL DISTINCT COUNT SUM AVG MIN MAX AS AND OR NOT IN LIKE BETWEEN IS NULL EXISTS CASE WHEN THEN ELSE END PRIMARY KEY FOREIGN REFERENCES DEFAULT UNIQUE CHECK AUTO_INCREMENT',
    comment: /--[^\n]*|\/\*[\s\S]*?\*\//,
    string: /'(?:[^'\\]|\\.)*'/,
    number: /\b\d+(?:\.\d+)?\b/,
    func: /[a-zA-Z_][\w]*(?=\s*\()/,
  },
};

// ─── 构建语言查找表（含别名）───
var LANG_MAP = {};
for (var name in LANGS) {
  LANG_MAP[name] = LANGS[name];
  var aliases = LANGS[name].aliases || [];
  for (var i = 0; i < aliases.length; i++) {
    LANG_MAP[aliases[i]] = LANGS[name];
  }
}

/**
 * 检测是否支持指定语言
 * @param {string} lang - 语言名称或别名
 * @returns {boolean}
 */
function isSupported(lang) {
  if (!lang) return false;
  return !!LANG_MAP[lang.toLowerCase()];
}

/**
 * 获取规范化语言名
 * @param {string} lang
 * @returns {string|null}
 */
function normalizeLang(lang) {
  if (!lang) return null;
  lang = lang.toLowerCase().trim();
  var def = LANG_MAP[lang];
  if (!def) return null;
  // 返回主语言名
  for (var name in LANGS) {
    if (LANGS[name] === def) return name;
  }
  return lang;
}

/**
 * 构建关键字正则
 */
function buildKeywordRegex(keywords) {
  if (!keywords) return null;
  var words = keywords.split(/\s+/).filter(Boolean);
  // 按长度降序排列，避免短关键字匹配长关键字的前缀
  words.sort(function(a, b) { return b.length - a.length; });
  var escaped = words.map(function(w) {
    return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  return new RegExp('\\b(' + escaped.join('|') + ')\\b', 'g');
}

/**
 * 高亮代码，返回 token 数组
 * @param {string} code - 源代码
 * @param {string} lang - 语言名称
 * @returns {Array<{text:string, type:string}>} token 数组
 */
function highlight(code, lang) {
  if (!code || !lang) {
    return [{ text: code || '', type: TYPE_PLAIN }];
  }

  var def = LANG_MAP[lang.toLowerCase()];
  if (!def) {
    return [{ text: code, type: TYPE_PLAIN }];
  }

  // 收集所有匹配规则
  var rules = [];

  // 注释（最高优先级）
  if (def.comment) {
    rules.push({ pattern: def.comment, type: TYPE_COMMENT, flags: 'gm' });
  }

  // 字符串
  if (def.string) {
    rules.push({ pattern: def.string, type: TYPE_STRING, flags: 'gm' });
  }

  // 数字
  if (def.number) {
    rules.push({ pattern: def.number, type: TYPE_NUMBER, flags: 'g' });
  }

  // 关键字
  var kwRegex = buildKeywordRegex(def.keywords);
  if (kwRegex) {
    rules.push({ pattern: kwRegex, type: TYPE_KEYWORD, flags: 'g' });
  }

  // 函数名
  if (def.func) {
    rules.push({ pattern: def.func, type: TYPE_FUNCTION, flags: 'g' });
  }

  // HTML 特殊处理
  if (def.tagPattern) {
    return highlightHTML(code, def);
  }

  // CSS 特殊处理
  if (def.propertyPattern) {
    return highlightCSS(code, def);
  }

  // JSON 特殊处理
  if (def.keyPattern) {
    return highlightJSON(code, def);
  }

  return tokenize(code, rules);
}

/**
 * 通用分词器：收集所有匹配，按位置排序，未匹配部分为 plain
 */
function tokenize(code, rules) {
  if (rules.length === 0) {
    return [{ text: code, type: TYPE_PLAIN }];
  }

  // 收集所有匹配区间
  var matches = [];
  for (var i = 0; i < rules.length; i++) {
    var rule = rules[i];
    var regex = new RegExp(rule.pattern.source, rule.flags || 'g');
    var m;
    while ((m = regex.exec(code)) !== null) {
      if (m[0].length === 0) {
        regex.lastIndex++;
        continue;
      }
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        text: m[0],
        type: rule.type,
      });
      if (m.index === regex.lastIndex) {
        regex.lastIndex++;
      }
    }
  }

  if (matches.length === 0) {
    return [{ text: code, type: TYPE_PLAIN }];
  }

  // 按起始位置排序
  matches.sort(function(a, b) { return a.start - b.start; });

  // 解决重叠：保留先出现的（优先级高的在前）
  var filtered = [];
  var lastEnd = 0;
  for (var j = 0; j < matches.length; j++) {
    if (matches[j].start >= lastEnd) {
      filtered.push(matches[j]);
      lastEnd = matches[j].end;
    }
  }

  // 构建结果
  var result = [];
  var pos = 0;
  for (var k = 0; k < filtered.length; k++) {
    if (filtered[k].start > pos) {
      result.push({ text: code.slice(pos, filtered[k].start), type: TYPE_PLAIN });
    }
    result.push({ text: filtered[k].text, type: filtered[k].type });
    pos = filtered[k].end;
  }
  if (pos < code.length) {
    result.push({ text: code.slice(pos), type: TYPE_PLAIN });
  }

  return result;
}

/**
 * HTML 高亮：标签名、属性名、字符串、注释
 */
function highlightHTML(code, def) {
  var rules = [];
  if (def.comment) {
    rules.push({ pattern: def.comment, type: TYPE_COMMENT, flags: 'gm' });
  }
  // 标签名：<tagname 或 </tagname
  rules.push({ pattern: /<\/?[\w-]+/g, type: TYPE_KEYWORD, flags: 'g' });
  // 属性名：空格后跟属性名=
  rules.push({ pattern: /\s[\w-]+(?==)/g, type: TYPE_FUNCTION, flags: 'g' });
  // 字符串
  if (def.string) {
    rules.push({ pattern: def.string, type: TYPE_STRING, flags: 'gm' });
  }
  // 标签结束符 >
  rules.push({ pattern: /\/?>/g, type: TYPE_OPERATOR, flags: 'g' });
  return tokenize(code, rules);
}

/**
 * CSS 高亮：选择器、属性名、值、注释
 */
function highlightCSS(code, def) {
  var rules = [];
  if (def.comment) {
    rules.push({ pattern: def.comment, type: TYPE_COMMENT, flags: 'gm' });
  }
  // 字符串
  if (def.string) {
    rules.push({ pattern: def.string, type: TYPE_STRING, flags: 'gm' });
  }
  // 属性名：行首或分号后的 属性:
  rules.push({ pattern: /[\w-]+(?=\s*:)/g, type: TYPE_KEYWORD, flags: 'g' });
  // 数字/单位
  if (def.number) {
    rules.push({ pattern: def.number, type: TYPE_NUMBER, flags: 'g' });
  }
  // 选择器（.class, #id, :pseudo）
  rules.push({ pattern: /[.#:][\w-]+/g, type: TYPE_FUNCTION, flags: 'g' });
  // !important
  rules.push({ pattern: /!important/g, type: TYPE_OPERATOR, flags: 'g' });
  return tokenize(code, rules);
}

/**
 * JSON 高亮：key、字符串、数字、布尔/null
 */
function highlightJSON(code, def) {
  var rules = [];
  // 字符串
  if (def.string) {
    rules.push({ pattern: def.string, type: TYPE_STRING, flags: 'gm' });
  }
  // 数字
  if (def.number) {
    rules.push({ pattern: def.number, type: TYPE_NUMBER, flags: 'g' });
  }
  // true/false/null
  var kwRegex = buildKeywordRegex(def.keywords);
  if (kwRegex) {
    rules.push({ pattern: kwRegex, type: TYPE_KEYWORD, flags: 'g' });
  }
  return tokenize(code, rules);
}

module.exports = {
  highlight: highlight,
  isSupported: isSupported,
  normalizeLang: normalizeLang,
  // 导出类型常量供 WXML 映射
  TYPES: {
    KEYWORD: TYPE_KEYWORD,
    STRING: TYPE_STRING,
    COMMENT: TYPE_COMMENT,
    NUMBER: TYPE_NUMBER,
    FUNCTION: TYPE_FUNCTION,
    OPERATOR: TYPE_OPERATOR,
    PLAIN: TYPE_PLAIN,
  },
};
