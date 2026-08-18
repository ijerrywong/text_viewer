/**
 * core/parse/md/inline.js - Markdown 行内解析器
 *
 * 纯函数模块：不依赖任何 wx API
 *
 * 输出 Inline 树：
 *   { t:'text', text }
 *   | { t:'raw', text }        原样文本：不参与强调配对，也不做实体解码（数学公式）
 *   | { t:'strong', c:[Inline] }
 *   | { t:'em', c:[Inline] }
 *   | { t:'del', c:[Inline] }
 *   | { t:'code', text }
 *   | { t:'link', href, title, c:[Inline] }
 *   | { t:'image', src, alt }
 *   | { t:'br' }
 *   | { t:'footref', label }
 */

'use strict';

var NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  nbsp: '\u00A0', hellip: '…', mdash: '—', ndash: '–',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201C', rdquo: '\u201D',
  copy: '©', reg: '®', trade: '™', deg: '°', middot: '·',
  bull: '•', dagger: '†', prime: '′', larr: '←', rarr: '→', uarr: '↑', darr: '↓'
};

function decodeEntities(s) {
  if (!s || s.indexOf('&') < 0) return s;
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, function (m, body) {
    if (body[0] === '#') {
      var code;
      if (body[1] === 'x' || body[1] === 'X') code = parseInt(body.slice(2), 16);
      else code = parseInt(body.slice(1), 10);
      if (isFinite(code) && code > 0 && code < 0x110000) {
        try { return String.fromCodePoint(code); } catch (e) { return m; }
      }
      return m;
    }
    var named = NAMED_ENTITIES[body];
    return named !== undefined ? named : m;
  });
}

function inlineToPlainText(nodes) {
  if (!nodes) return '';
  var out = '';
  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i];
    if (n.t === 'text' || n.t === 'code' || n.t === 'raw') out += n.text;
    else if (n.t === 'strong' || n.t === 'em' || n.t === 'del') out += inlineToPlainText(n.c);
    else if (n.t === 'link') out += inlineToPlainText(n.c);
    else if (n.t === 'image') out += (n.alt || '');
    else if (n.t === 'br') out += '\n';
    else if (n.t === 'footref') out += '[' + n.label + ']';
  }
  return out;
}

var ESCAPABLE = '\\`*_{}[]()#+-.!:|>~<&';

function extractEscapes(text) {
  if (text.indexOf('\\') < 0) return null;
  var buf = '';
  for (var i = 0; i < text.length; i++) {
    if (text[i] === '\\' && i + 1 < text.length && ESCAPABLE.indexOf(text[i + 1]) >= 0) {
      buf += text[i + 1];
      i++;
    } else {
      buf += text[i];
    }
  }
  return [{ t: 'text', text: buf }];
}

function extractCodeSpans(text) {
  if (text.indexOf('`') < 0) return null;
  var out = [];
  var buf = '';
  var i = 0;
  while (i < text.length) {
    if (text[i] === '`') {
      var openLen = 0;
      while (text[i + openLen] === '`') openLen++;
      var closeIdx = -1;
      var j = i + openLen;
      while (j < text.length) {
        if (text[j] === '`') {
          var closeLen = 0;
          while (text[j + closeLen] === '`') closeLen++;
          if (closeLen === openLen) { closeIdx = j; break; }
          j += closeLen;
        } else {
          j++;
        }
      }
      if (closeIdx > i + openLen) {
        if (buf) { out.push({ t: 'text', text: buf }); buf = ''; }
        var code = text.slice(i + openLen, closeIdx).replace(/\n/g, ' ');
        if (code.length >= 2 && code[0] === ' ' && code[code.length - 1] === ' ' && code.trim() !== '') {
          code = code.slice(1, -1);
        }
        out.push({ t: 'code', text: code });
        i = closeIdx + openLen;
        continue;
      }
    }
    buf += text[i];
    i++;
  }
  if (buf) out.push({ t: 'text', text: buf });
  return out;
}

// ─── 数学公式保护（$…$ / $$…$$）───
//
// 我们不渲染公式，原样显示就行 —— 但「原样」必须是真的原样。
// 不圈出来的话 `$x_1 + x_2$` 会被强调规则啃掉一对下划线变成 $x1 + x2$，
// `\sum_{i=1}^{n}` 里的 `_{` 同理。丢的是字符，不是样式，触了「零丢失」的线。
//
// 判据保守，宁可漏认不可错认（错认只是少了一次保护，漏认不会改变任何输出）：
//   - 内容非空、不含 $、不以空白开头或结尾（挡掉「$5 到 $10」这类货币写法）
//   - 行内式不跨行，长度设上限，避免把半篇文档误圈成一个公式

var MAX_INLINE_MATH = 200;
var MAX_BLOCK_MATH = 2000;

function extractMath(text) {
  if (text.indexOf('$') < 0) return null;
  var out = [];
  var buf = '';
  var i = 0;
  while (i < text.length) {
    if (text[i] === '$') {
      var isBlock = text[i + 1] === '$';
      var open = isBlock ? 2 : 1;
      var limit = isBlock ? MAX_BLOCK_MATH : MAX_INLINE_MATH;
      var close = findMathClose(text, i + open, isBlock, limit);
      if (close > 0) {
        if (buf) { out.push({ t: 'text', text: buf }); buf = ''; }
        out.push({ t: 'raw', text: text.slice(i, close + open) });
        i = close + open;
        continue;
      }
    }
    buf += text[i];
    i++;
  }
  if (buf) out.push({ t: 'text', text: buf });
  return out;
}

function findMathClose(text, from, isBlock, limit) {
  if (from >= text.length) return -1;
  // 行内式两端不许贴空白（挡掉「$5 到 $10」这类货币写法）；
  // 块级式本来就常写成 $$ 独占一行，这条不适用
  if (!isBlock && /\s/.test(text[from])) return -1;
  var end = Math.min(text.length, from + limit);
  for (var j = from; j < end; j++) {
    var ch = text[j];
    if (ch === '\n' && !isBlock) return -1;        // 行内式不跨行
    if (ch !== '$') continue;
    if (isBlock && text[j + 1] !== '$') continue;  // 块级式要成对的 $$
    if (j === from) return -1;                     // 空内容
    if (!isBlock && /\s/.test(text[j - 1])) return -1;
    return j;
  }
  return -1;
}

function extractFootrefs(text) {
  if (text.indexOf('[^') < 0) return null;
  var out = [];
  var buf = '';
  var i = 0;
  while (i < text.length) {
    if (text[i] === '[' && text[i + 1] === '^') {
      var close = text.indexOf(']', i + 2);
      if (close > i + 2) {
        var label = text.slice(i + 2, close);
        if (/^[^\s\]]+$/.test(label)) {
          if (buf) { out.push({ t: 'text', text: buf }); buf = ''; }
          out.push({ t: 'footref', label: label });
          i = close + 1;
          continue;
        }
      }
    }
    buf += text[i];
    i++;
  }
  if (buf) out.push({ t: 'text', text: buf });
  return out;
}

function extractAutolinks(text) {
  if (text.indexOf('<') < 0) return null;
  var out = [];
  var buf = '';
  var i = 0;
  while (i < text.length) {
    if (text[i] === '<') {
      // URL autolink: <http...> / <https...> / <mailto...>
      var m = /^<(https?:\/\/[^\s<>]+|mailto:[^\s<>]+)>/.exec(text.slice(i));
      if (m) {
        if (buf) { out.push({ t: 'text', text: buf }); buf = ''; }
        var href = m[1];
        if (href.indexOf('mailto:') === 0) href = href.slice(7);
        out.push({ t: 'link', href: m[1], title: '', c: [{ t: 'text', text: href }] });
        i += m[0].length;
        continue;
      }
    }
    buf += text[i];
    i++;
  }
  if (buf) out.push({ t: 'text', text: buf });
  return out;
}

function extractHardBreaks(text) {
  // 两个以上尾随空格 + 换行 → br；行尾反斜杠 + 换行 → br
  if (text.indexOf('\n') < 0) return null;
  var parts = text.split('\n');
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var seg = parts[i];
    var hadBreak = false;
    if (i < parts.length - 1) {
      if (/  $/.test(seg)) { seg = seg.replace(/  +$/, ''); hadBreak = true; }
      else if (/\\$/.test(seg)) { seg = seg.slice(0, -1); hadBreak = true; }
    }
    if (seg) out.push({ t: 'text', text: seg });
    if (hadBreak) out.push({ t: 'br' });
    else if (i < parts.length - 1) out.push({ t: 'text', text: ' ' });
  }
  return out;
}

function extractImagesAndLinks(nodes, refs) {
  var out = [];
  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i];
    if (n.t !== 'text') { out.push(n); continue; }
    out.push.apply(out, extractImgLink(n.text, refs));
  }
  return out;
}

function extractImgLink(text, refs) {
  if (text.indexOf('[') < 0 && text.indexOf('!') < 0) return [{ t: 'text', text: text }];
  var out = [];
  var buf = '';
  var i = 0;
  while (i < text.length) {
    // 图片: ![alt](src "title") 或 ![alt][label]
    if (text[i] === '!' && text[i + 1] === '[') {
      var img = parseLinkLike(text, i + 1, refs, true);
      if (img) {
        if (buf) { out.push({ t: 'text', text: buf }); buf = ''; }
        out.push(img.node);
        i = img.end;
        continue;
      }
    }
    // 链接: [text](url) 或 [text][label] 或 [text][]
    if (text[i] === '[') {
      var lnk = parseLinkLike(text, i, refs, false);
      if (lnk) {
        if (buf) { out.push({ t: 'text', text: buf }); buf = ''; }
        out.push(lnk.node);
        i = lnk.end;
        continue;
      }
    }
    buf += text[i];
    i++;
  }
  if (buf) out.push({ t: 'text', text: buf });
  return out;
}

/**
 * 解析 [text](url "title") / [text][label] / [text][]
 * @param {string} text - 原始文本
 * @param {number} start - '[' 的位置
 * @param {Object} refs - 引用链接定义
 * @param {boolean} isImage - 图片模式
 * @returns {{node, end} | null}
 */
function parseLinkLike(text, start, refs, isImage) {
  // 找闭合的 ']'（考虑嵌套）
  var depth = 0;
  var j = start;
  while (j < text.length) {
    if (text[j] === '[') depth++;
    else if (text[j] === ']') { depth--; if (depth === 0) break; }
    j++;
  }
  if (depth !== 0) return null;
  var labelEnd = j;
  var labelRaw = text.slice(start + 1, labelEnd);

  // inline: (url "title")
  if (text[labelEnd + 1] === '(') {
    var closeP = findMatchingParen(text, labelEnd + 1);
    if (closeP > labelEnd + 1) {
      var inner = text.slice(labelEnd + 2, closeP).trim();
      var parsed = parseUrlTitle(inner);
      if (parsed) {
        var node;
        if (isImage) {
          node = { t: 'image', src: parsed.url, alt: decodeEntities(labelRaw) };
        } else {
          node = {
            t: 'link', href: parsed.url, title: parsed.title || '',
            c: [{ t: 'text', text: decodeEntities(labelRaw) }]
          };
        }
        return { node: node, end: closeP + 1 };
      }
    }
  }

  // reference: [text][label] 或 [text][]
  if (text[labelEnd + 1] === '[') {
    var closeR = text.indexOf(']', labelEnd + 2);
    if (closeR > labelEnd + 1) {
      var refLabel = text.slice(labelEnd + 2, closeR).trim().toLowerCase() || labelRaw.trim().toLowerCase();
      var def = refs[refLabel];
      if (def) {
        if (isImage) {
          return { node: { t: 'image', src: def.href, alt: decodeEntities(labelRaw) }, end: closeR + 1 };
        }
        return {
          node: { t: 'link', href: def.href, title: def.title || '', c: [{ t: 'text', text: decodeEntities(labelRaw) }] },
          end: closeR + 1
        };
      }
    }
  }

  return null;
}

function findMatchingParen(text, openIdx) {
  var depth = 0;
  for (var i = openIdx; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function parseUrlTitle(inner) {
  // url 可含 <...>；title 在 url 后用引号包围
  var urlEnd = inner.length;
  var title = '';
  // 从后找引号包裹的 title
  for (var i = inner.length - 1; i >= 0; i--) {
    if (inner[i] === '"' || inner[i] === "'") {
      var openQ = inner.lastIndexOf(inner[i], i - 1);
      if (openQ >= 0) {
        title = inner.slice(openQ + 1, i);
        urlEnd = openQ;
        break;
      }
    }
  }
  var url = inner.slice(0, urlEnd).trim();
  if (!url) return null;
  if (url[0] === '<' && url[url.length - 1] === '>') url = url.slice(1, -1);
  return { url: url, title: title };
}

// ─── 强调：*, _, ~~ ───
//
// 按 CommonMark 的 delimiter run + flanking 规则配对。
//
// 以前这里只判断「标记两侧是不是空白」，代价是 Markdown 方言里最贵的一类错误：
//   some_var_name  →  some<em>var</em>name   连下划线字符本身一起没了
//   $x_1 + x_2$    →  $x1 + x2$              公式下标被吃掉
// 丢的是字符不是样式，直接违反「降级可以，内容零丢失」。
//
// flanking 规则的要点是：一个标记 run 能不能开、能不能关，
// 由它**两侧字符的类别**（空白 / 标点 / 其他）共同决定。
// 词内的 `_` 两侧都是普通字符，于是既不能开也不能关 ——
// 这正是 CommonMark 用来保护 snake_case 的机制。

var ASCII_PUNCT = /[!-\/:-@\[-`{-~]/;
// 中日韩标点与全角符号：中文正文里「**重点**，」这类写法极常见，
// 不把 CJK 标点算作标点，flanking 判定会和中文排版的直觉对不上。
var CJK_PUNCT = /[ -⁯⸀-⹿　-〿︐-﹯＀-･]/;

function isSpaceChar(ch) { return ch === undefined || /\s/.test(ch); }

function isPunctChar(ch) {
  return ch !== undefined && (ASCII_PUNCT.test(ch) || CJK_PUNCT.test(ch));
}

/** 扫出所有分隔符 run，并判定每个 run 能开 / 能关 */
function scanDelimRuns(text) {
  var runs = [];
  var i = 0;
  while (i < text.length) {
    var ch = text[i];
    if (ch !== '*' && ch !== '_' && ch !== '~') { i++; continue; }
    var len = 1;
    while (text[i + len] === ch) len++;

    var before = text[i - 1];
    var after = text[i + len];
    // 左贴合：右边不是空白，且（右边不是标点，或左边是空白/标点）
    var leftFlank = !isSpaceChar(after) &&
      (!isPunctChar(after) || isSpaceChar(before) || isPunctChar(before));
    var rightFlank = !isSpaceChar(before) &&
      (!isPunctChar(before) || isSpaceChar(after) || isPunctChar(after));

    var canOpen, canClose;
    if (ch === '_') {
      // 下划线比星号严：词内的 `_` 两侧都贴合，所以既不能开也不能关
      canOpen = leftFlank && (!rightFlank || isPunctChar(before));
      canClose = rightFlank && (!leftFlank || isPunctChar(after));
    } else if (ch === '~') {
      // GFM 删除线只认 ~~：单个 ~ 是 ~/path、~约等于，当标记会误伤
      canOpen = len === 2 && leftFlank;
      canClose = len === 2 && rightFlank;
    } else {
      canOpen = leftFlank;
      canClose = rightFlank;
    }

    runs.push({
      ch: ch, start: i, len: len, origLen: len,
      canOpen: canOpen, canClose: canClose
    });
    i += len;
  }
  return runs;
}

/**
 * 配对：从左往右找闭标记，再往回找最近的可用开标记。
 * 两侧各消耗 1 或 2 个字符（都 ≥2 时按 strong），剩下的留着继续配 ——
 * `***x***` 就是这样先配出内层 strong、再配出外层 em 的。
 */
function matchDelims(runs) {
  var pairs = [];
  // 「找过没有」的记忆（CommonMark 的 openers_bottom）。
  // 少了它，「a* a* a* …」这种全是闭标记又配不上的文本会退化成 O(n²)：
  // 每个闭标记都要把前面所有 run 重扫一遍。实测 16000 个 run 要 147ms，
  // 10MB 文档里一段就能把解析卡住 —— 这类输入正是 §2.4 要防的解析炸弹。
  var bottoms = {};
  var ci = 0;
  while (ci < runs.length) {
    var closer = runs[ci];
    if (!closer.canClose || closer.len === 0) { ci++; continue; }

    var key = closer.ch + (closer.origLen % 3) + (closer.canOpen ? 'o' : '');
    var floor = bottoms[key] == null ? -1 : bottoms[key];
    var openerIdx = -1;
    for (var k = ci - 1; k > floor; k--) {
      var cand = runs[k];
      if (cand.ch !== closer.ch || !cand.canOpen || cand.len === 0) continue;
      // CommonMark 的「3 的倍数」规则：run 既能开又能关时，
      // 长度和被 3 整除的这一对要跳过，否则 **a*b* 之类会配错位
      if ((closer.canOpen || cand.canClose) &&
          (cand.origLen + closer.origLen) % 3 === 0 &&
          !(cand.origLen % 3 === 0 && closer.origLen % 3 === 0)) continue;
      openerIdx = k;
      break;
    }
    if (openerIdx < 0) {
      bottoms[key] = ci - 1;   // 同类闭标记下次不必再往前翻
      ci++;
      continue;
    }

    var opener = runs[openerIdx];
    // 配上了：夹在中间的分隔符作废，否则后面的闭标记会跨进
    // 已经闭合的区间里配对，切出互相交叉的范围
    for (var d = openerIdx + 1; d < ci; d++) runs[d].len = 0;
    var use = closer.ch === '~' ? 2
      : (opener.len >= 2 && closer.len >= 2 ? 2 : 1);

    pairs.push({
      type: closer.ch === '~' ? 'del' : (use === 2 ? 'strong' : 'em'),
      openAt: opener.start + opener.len - use,  // 开标记消耗右端
      closeAt: closer.start,                    // 闭标记消耗左端
      use: use
    });

    opener.len -= use;
    closer.len -= use;
    closer.start += use;
    if (closer.len === 0) ci++;
  }
  return pairs;
}

/** 按配对结果切树：只有标记字符被吃掉，其余字符一个不少地落进某个节点 */
function buildEmphasisTree(text, pairs) {
  if (pairs.length === 0) return [{ t: 'text', text: text }];

  var events = [];
  for (var p = 0; p < pairs.length; p++) {
    events.push({ pos: pairs[p].openAt, end: pairs[p].openAt + pairs[p].use, open: true, type: pairs[p].type });
    events.push({ pos: pairs[p].closeAt, end: pairs[p].closeAt + pairs[p].use, open: false, type: pairs[p].type });
  }
  events.sort(function (a, b) {
    if (a.pos !== b.pos) return a.pos - b.pos;
    return a.open === b.open ? 0 : (a.open ? 1 : -1); // 同一位置先闭后开
  });

  var root = { c: [] };
  var stack = [root];
  var cursor = 0;
  for (var e = 0; e < events.length; e++) {
    var ev = events[e];
    var top = stack[stack.length - 1];
    if (ev.pos > cursor) top.c.push({ t: 'text', text: text.slice(cursor, ev.pos) });
    cursor = Math.max(cursor, ev.end);
    if (ev.open) {
      var node = { t: ev.type, c: [] };
      top.c.push(node);
      stack.push(node);
    } else if (stack.length > 1) {
      stack.pop();
    }
  }
  if (cursor < text.length) stack[stack.length - 1].c.push({ t: 'text', text: text.slice(cursor) });
  return root.c;
}

function extractEmphasis(nodes) {
  var out = [];
  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i];
    if (n.t === 'text') out.push.apply(out, parseEmphasis(n.text));
    else out.push(n);
  }
  return out;
}

function parseEmphasis(text) {
  if (!text) return [{ t: 'text', text: '' }];
  var runs = scanDelimRuns(text);
  if (runs.length === 0) return [{ t: 'text', text: text }];
  return buildEmphasisTree(text, matchDelims(runs));
}

function finalizeText(nodes) {
  // 展开 __multi 占位节点
  var out = [];
  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i];
    if (n.t === '__multi') {
      out.push.apply(out, finalizeText(n.parts));
    } else if (n.t === 'text') {
      n.text = decodeEntities(n.text);
      out.push(n);
    } else {
      out.push(n);
    }
  }
  return out;
}

// ─── 工具：对 text 节点列表逐个应用 extractor ───

function mapTextNodes(nodes, extractor) {
  var out = [];
  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i];
    if (n.t === 'text') {
      var replaced = extractor(n.text);
      if (replaced) out.push.apply(out, replaced);
      else out.push(n);
    } else {
      out.push(n);
    }
  }
  return out;
}

// ─── 行内解析主入口 ───

function parseInline(text, opts) {
  if (!text) return [];
  opts = opts || {};
  var refs = opts.linkRefs || {};

  var nodes = [{ t: 'text', text: text }];
  nodes = mapTextNodes(nodes, extractEscapes);
  nodes = mapTextNodes(nodes, extractCodeSpans);
  // 公式紧跟在代码段之后：`$x$` 里的 $ 属于代码，不该被当成公式定界符
  nodes = mapTextNodes(nodes, extractMath);
  nodes = mapTextNodes(nodes, extractFootrefs);
  nodes = mapTextNodes(nodes, extractAutolinks);
  nodes = extractImagesAndLinks(nodes, refs);
  nodes = mapTextNodes(nodes, extractHardBreaks);
  nodes = extractEmphasis(nodes);
  nodes = finalizeText(nodes);

  return nodes;
}

// ─── 行内树 → 渲染段（扁平化，避免 WXML 递归模板）───

/**
 * 将 Inline 树展平为渲染段数组
 * 每段：{ text, bold, italic, strike, code, href, image, src, alt, br, footref, label }
 * @param {Inline[]} nodes
 * @param {Object} [styles] - 内部递归用
 * @returns {Segment[]}
 */
function flattenInline(nodes, styles) {
  styles = styles || {};
  var segments = [];
  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i];
    if (n.t === 'text') {
      if (n.text) {
        segments.push({
          text: n.text, bold: !!styles.bold, italic: !!styles.italic,
          strike: !!styles.strike, code: false, href: styles.href || ''
        });
      }
    } else if (n.t === 'raw') {
      // 公式等原样文本：继承外层样式，但内部一个字符都不动
      if (n.text) {
        segments.push({
          text: n.text, bold: !!styles.bold, italic: !!styles.italic,
          strike: !!styles.strike, code: false, href: styles.href || ''
        });
      }
    } else if (n.t === 'code') {
      segments.push({
        text: n.text, bold: false, italic: false, strike: false,
        code: true, href: ''
      });
    } else if (n.t === 'br') {
      segments.push({ text: '\n', br: true });
    } else if (n.t === 'link') {
      var linkStyles = {};
      for (var k in styles) linkStyles[k] = styles[k];
      linkStyles.href = n.href;
      var linkSegs = flattenInline(n.c, linkStyles);
      segments.push.apply(segments, linkSegs);
    } else if (n.t === 'image') {
      segments.push({
        text: '', image: true, src: n.src, alt: n.alt || '',
        bold: false, italic: false, strike: false, code: false, href: ''
      });
    } else if (n.t === 'footref') {
      segments.push({
        text: '[' + n.label + ']', bold: false, italic: false, strike: false,
        code: false, href: '', footref: true, label: n.label
      });
    } else if (n.t === 'strong' || n.t === 'em' || n.t === 'del') {
      var cs = {};
      for (var k2 in styles) cs[k2] = styles[k2];
      if (n.t === 'strong') cs.bold = true;
      if (n.t === 'em') cs.italic = true;
      if (n.t === 'del') cs.strike = true;
      segments.push.apply(segments, flattenInline(n.c, cs));
    }
  }
  return segments;
}

module.exports = {
  parseInline: parseInline,
  inlineToPlainText: inlineToPlainText,
  decodeEntities: decodeEntities,
  flattenInline: flattenInline
};
