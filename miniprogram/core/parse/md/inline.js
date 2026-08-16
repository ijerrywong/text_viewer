/**
 * core/parse/md/inline.js - Markdown 行内解析器
 *
 * 纯函数模块：不依赖任何 wx API
 *
 * 输出 Inline 树：
 *   { t:'text', text }
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
    if (n.t === 'text' || n.t === 'code') out += n.text;
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
// 简化 CommonMark：收集连续的同种标记 run，按从左到右配对。
// 开标记：不被空白/标点跟随；关标记：不被空白/标点前导。

function extractEmphasis(nodes) {
  var out = [];
  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i];
    if (n.t === 'text') {
      out.push.apply(out, parseEmphasis(n.text));
    } else {
      out.push(n);
    }
  }
  return out;
}

function parseEmphasis(text) {
  if (!text) return [{ t: 'text', text: '' }];
  var out = [{ t: 'text', text: text }];
  var changed = true;
  var passes = 0;
  while (changed && passes < 5) {
    changed = false;
    passes++;
    var next = [];
    for (var i = 0; i < out.length; i++) {
      var node = out[i];
      if (node.t === 'text') {
        var res = tryOneEmphasis(out, i);
        if (res) {
          // 直接展开 parts 到 next，剩余文本在下一轮继续匹配
          next.push.apply(next, res.parts);
          changed = true;
          continue;
        }
      }
      next.push(node);
    }
    out = next;
  }
  return out;
}

/**
 * 在 out[i] 这个 text 节点上尝试匹配一次强调
 * 支持: ~~del~~ / **strong** / *em* / __strong__ / _em_
 */
function tryOneEmphasis(out, i) {
  var text = out[i].text;
  // 优先级：~~ > __ > ** > _ > *
  var markers = ['~~', '__', '**', '_', '*'];
  for (var m = 0; m < markers.length; m++) {
    var mk = markers[m];
    var idx = text.indexOf(mk);
    if (idx < 0) continue;
    // 检查开标记合法性：后面非空白
    var afterOpen = text[idx + mk.length];
    if (afterOpen === ' ' || afterOpen === '\t' || afterOpen === '\n' || afterOpen === undefined) continue;
    // 找闭合（从开标记后搜索，允许更长 run）
    var searchFrom = idx + mk.length;
    while (searchFrom < text.length) {
      var closeIdx = findCloseMarker(text, mk, searchFrom, idx);
      if (closeIdx < 0) break;
      // 检查闭标记合法性：前面非空白
      var beforeClose = text[closeIdx - 1];
      if (beforeClose === ' ' || beforeClose === '\t' || beforeClose === '\n') {
        searchFrom = closeIdx + mk.length;
        continue;
      }
      // 找到了
      var inner = text.slice(idx + mk.length, closeIdx);
      var type;
      if (mk === '~~') type = 'del';
      else if (mk === '**' || mk === '__') type = 'strong';
      else type = 'em';
      var parts = [];
      if (idx > 0) parts.push({ t: 'text', text: text.slice(0, idx) });
      // inner 递归解析行内（只递归强调，其他已处理）
      var innerNodes = [{ t: 'text', text: inner }];
      innerNodes = extractEmphasis(innerNodes);
      parts.push({ t: type, c: innerNodes });
      if (closeIdx + mk.length < text.length) parts.push({ t: 'text', text: text.slice(closeIdx + mk.length) });
      return { parts: parts };
    }
  }
  return null;
}

function findCloseMarker(text, mk, from, openIdx) {
  var idx = text.indexOf(mk, from);
  // 不能是更长 run 的一部分（如 ** 匹配 **** 中的中间）
  while (idx >= 0) {
    // 确保不是 4 个连续 * 中的重叠
    var before = text[idx - 1];
    var after = text[idx + mk.length];
    if (mk === '*' || mk === '_') {
      if (before === mk[0] || after === mk[0]) {
        idx = text.indexOf(mk, idx + mk.length);
        continue;
      }
    }
    return idx;
  }
  return -1;
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
