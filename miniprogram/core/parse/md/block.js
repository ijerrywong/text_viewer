/**
 * core/parse/md/block.js - Markdown 块级解析器（GFM 子集）
 *
 * 纯函数模块：不依赖任何 wx API
 *
 * 输出扁平块列表（G9 节点树扁平化），与 TXT IR 同构：
 *   { type:'heading', level, children:Inline[], text, id }
 *   { type:'paragraph', children:Inline[], text, id }
 *   { type:'code', lang, text, id, longHint? }
 *   { type:'listItem', ordered, ordIndex, depth, task, checked, children:Inline[], id }
 *   { type:'quote', depth, children:Inline[], text, id }
 *   { type:'table', header:[Cell], rows:[[Cell]], aligns:[], id }
 *   { type:'image', src, alt, id }
 *   { type:'hr', id }
 *   { type:'html', text, id }
 *   { type:'footnote', label, children:Inline[], id }
 *
 * TOC: { blockIndex, level, text, id }
 */

'use strict';

var inline = require('./inline.js');
var parseInline = inline.parseInline;
var inlineToPlainText = inline.inlineToPlainText;

// ─── 工具 ───

function createIdGen() {
  var counter = 0;
  return function () { return 'b' + (counter++); };
}

var MAX_LIST_DEPTH = 10; // C6
var MAX_BLOCKS = 50000;  // AGENTS §2.4 防解析炸弹
var MAX_TOC = 2000;

/**
 * 标出哪些行位于围栏代码块内部
 *
 * 引用链接定义 / 脚注定义是在全文逐行扫描后"抽走"的，
 * 不先算出代码块范围的话，代码示例里的 `[foo]: bar` 或 `[^1]: x`
 * 会被当成定义直接从正文里删掉 —— 用户看到的是代码凭空少了一行。
 * @param {string[]} lines
 * @returns {boolean[]} 与 lines 等长，true 表示该行在代码块内
 */
function markFencedLines(lines) {
  var inFence = new Array(lines.length);
  var openFence = null;
  for (var i = 0; i < lines.length; i++) {
    var m = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (openFence === null) {
      inFence[i] = false;
      if (m) openFence = { char: m[2][0], len: m[2].length };
    } else {
      // 围栏行本身也算"在代码块内"，避免闭合行被当成定义
      inFence[i] = true;
      if (m && m[2][0] === openFence.char && m[2].length >= openFence.len &&
          m[3].trim() === '') {
        openFence = null;
      }
    }
  }
  return inFence;
}

// ─── Front-matter 剥离（C24）───

function stripFrontMatter(text) {
  if (text.charCodeAt(0) !== 0x2D /* '-' */) return { text: text, meta: null };
  // 必须以 --- 开头
  if (text.slice(0, 3) !== '---') return { text: text, meta: null };
  var lines = text.split('\n');
  if (lines[0].trim() !== '---') return { text: text, meta: null };
  // 找闭合 ---
  var closeIdx = -1;
  for (var i = 1; i < Math.min(lines.length, 100); i++) {
    if (lines[i].trim() === '---' || lines[i].trim() === '...') { closeIdx = i; break; }
  }
  if (closeIdx < 0) return { text: text, meta: null };
  // 简单解析 key: value
  var meta = {};
  for (var j = 1; j < closeIdx; j++) {
    var m = /^([a-zA-Z_][\w-]*)\s*:\s*(.*)$/.exec(lines[j]);
    if (m) meta[m[1].toLowerCase()] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return { text: lines.slice(closeIdx + 1).join('\n'), meta: meta };
}

// ─── 引用链接定义收集 ───

function collectLinkRefs(lines, inFence) {
  // [label]: url "title"  —— 但排除 [^label]: (脚注定义)
  var refs = {};
  var remaining = [];
  for (var i = 0; i < lines.length; i++) {
    if (inFence && inFence[i]) { remaining.push(lines[i]); continue; }
    if (/^\s*\[\^/.test(lines[i])) { remaining.push(lines[i]); continue; }
    var m = /^\s*\[([^\]]+)\]:\s*(\S+)(?:\s+["'(]([^"')]*)["')\)]?)?\s*$/.exec(lines[i]);
    if (m) {
      refs[m[1].trim().toLowerCase()] = { href: m[2], title: m[3] || '' };
    } else {
      remaining.push(lines[i]);
    }
  }
  return { refs: refs, lines: remaining };
}

// ─── 脚注定义收集 ───

function collectFootnotes(lines, inFence) {
  var defs = {}; // label → text
  var remaining = [];
  for (var i = 0; i < lines.length; i++) {
    if (inFence && inFence[i]) { remaining.push(lines[i]); continue; }
    var m = /^\s*\[\^([^\]]+)\]:\s*(.*)$/.exec(lines[i]);
    if (m) {
      defs[m[1]] = m[2];
    } else {
      remaining.push(lines[i]);
    }
  }
  return { defs: defs, lines: remaining };
}

// ─── 块解析主函数 ───

function parseMarkdownBlocks(text) {
  var genId = createIdGen();
  var blocks = [];
  var toc = [];
  var images = [];
  var degraded = [];
  var linkRefs = {};
  var footDefs = {};

  // Front-matter
  var fm = stripFrontMatter(text);
  text = fm.text;
  var frontMeta = fm.meta;

  // 归一换行
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  var rawLines = text.split('\n');

  // 收集引用链接定义 & 脚注定义（先扫一遍，剥离这些行）
  // 两次收集都要重新算围栏范围：第一次收集会改变行号
  var refResult = collectLinkRefs(rawLines, markFencedLines(rawLines));
  linkRefs = refResult.refs;
  rawLines = refResult.lines;

  var fnResult = collectFootnotes(rawLines, markFencedLines(rawLines));
  footDefs = fnResult.defs;
  rawLines = fnResult.lines;

  var opts = { linkRefs: linkRefs };

  // 逐行扫描
  var i = 0;
  var truncated = false;
  while (i < rawLines.length) {
    if (blocks.length >= MAX_BLOCKS) { truncated = true; break; }

    var line = rawLines[i];

    // 空行
    if (line.trim() === '') { i++; continue; }

    // 围栏代码块
    var fence = matchFence(line);
    if (fence) {
      i = parseFence(rawLines, i, fence, genId, blocks);
      continue;
    }

    // ATX 标题
    var atx = matchAtx(line);
    if (atx) {
      var hId = genId();
      var hChildren = parseInline(atx.text, opts);
      var hPlain = inlineToPlainText(hChildren);
      blocks.push({ type: 'heading', level: atx.level, children: hChildren, text: hPlain, id: hId });
      toc.push({ blockIndex: blocks.length - 1, level: atx.level, text: hPlain, id: hId });
      i++;
      // 收集 Setext 下划线误配保护：跳过
      continue;
    }

    // HR
    if (matchHr(line)) {
      blocks.push({ type: 'hr', id: genId() });
      i++;
      continue;
    }

    // 引用块
    if (matchQuote(line)) {
      i = parseQuote(rawLines, i, genId, blocks, toc, opts);
      continue;
    }

    // 列表
    if (matchListItem(line)) {
      i = parseList(rawLines, i, genId, blocks, toc, opts);
      continue;
    }

    // 表格
    if (i + 1 < rawLines.length && matchTable(line, rawLines[i + 1])) {
      i = parseTable(rawLines, i, genId, blocks, opts);
      continue;
    }

    // 独立图片行
    var imgMatch = /^\s*!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)\s*$/.exec(line);
    if (imgMatch) {
      var imgId = genId();
      var src = imgMatch[2];
      blocks.push({ type: 'image', src: src, alt: imgMatch[1], id: imgId });
      if (/^https?:\/\//.test(src)) images.push({ src: src, blockIndex: blocks.length - 1 });
      i++;
      continue;
    }

    // HTML 块（行以 < 开头）
    if (/^\s*<\w/.test(line) && !/^<\s/.test(line.trim())) {
      i = parseHtmlBlock(rawLines, i, genId, blocks);
      continue;
    }

    // 段落（收集连续非空行，直到遇到块级标记或空行）
    i = parseParagraph(rawLines, i, genId, blocks, toc, opts);
  }

  // 脚注定义 → 末尾渲染为 quote 块
  var fnLabels = Object.keys(footDefs);
  if (fnLabels.length > 0) {
    for (var fi = 0; fi < fnLabels.length; fi++) {
      var lbl = fnLabels[fi];
      var fnId = genId();
      var fnChildren = parseInline(footDefs[lbl], opts);
      blocks.push({
        type: 'footnote', label: lbl, children: fnChildren,
        text: inlineToPlainText(fnChildren), id: fnId
      });
    }
  }

  // 内联图片收集
  for (var bi = 0; bi < blocks.length; bi++) {
    var b = blocks[bi];
    if (b.children) collectInlineImages(b.children, images, bi);
  }

  if (truncated) {
    degraded.push({ reason: 'md-block-limit', message: '文档块数超过 ' + MAX_BLOCKS + '，已截断显示' });
  }
  if (toc.length > MAX_TOC) {
    toc = toc.slice(0, MAX_TOC);
  }

  return {
    blocks: blocks, toc: toc, images: images,
    degraded: degraded, frontMeta: frontMeta,
    truncated: truncated,
    linkRefs: linkRefs, footnotes: footDefs
  };
}

function collectInlineImages(nodes, images, blockIndex) {
  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i];
    if (n.t === 'image' && /^https?:\/\//.test(n.src)) {
      images.push({ src: n.src, blockIndex: blockIndex });
    }
    if (n.c) collectInlineImages(n.c, images, blockIndex);
  }
}

// ─── 围栏代码块 ───

function matchFence(line) {
  var m = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(line);
  if (!m) return null;
  var indent = m[1].length;
  var fence = m[2];
  var info = m[3].trim();
  return { indent: indent, char: fence[0], len: fence.length, info: info };
}

function parseFence(lines, start, fence, genId, blocks) {
  var codeLines = [];
  var i = start + 1;
  var closed = false;
  while (i < lines.length) {
    var line = lines[i];
    // 闭合围栏：相同字符、长度 >= 开标记、仅空白
    var closeM = /^(\s*)(`{3,}|~{3,})\s*$/.exec(line);
    if (closeM && closeM[2][0] === fence.char && closeM[2].length >= fence.len) {
      closed = true;
      i++;
      break;
    }
    // 剥前导缩进（最多 fence.indent）
    if (line.length >= fence.indent && line.slice(0, fence.indent).trim() === '') {
      codeLines.push(line.slice(fence.indent));
    } else {
      codeLines.push(line);
    }
    i++;
  }
  // C25：未闭合 → 到文末为止（CommonMark 行为），超 2000 行给提示
  var longHint = false;
  if (!closed && codeLines.length > 2000) longHint = true;

  var lang = fence.info.split(/\s/)[0].replace(/^./, function (c) { return c.toLowerCase(); });
  blocks.push({
    type: 'code', lang: lang, text: codeLines.join('\n'),
    id: genId(), longHint: longHint
  });
  return i;
}

// ─── ATX 标题 ───

function matchAtx(line) {
  var m = /^( {0,3})(#{1,6})(?:\s+|$)(.*\S.*)?\s*#*\s*$/.exec(line);
  if (!m) return null;
  var text = (m[3] || '').replace(/\s+#+\s*$/, '').trim();
  if (!text && m[2].length <= 6) text = '';
  return { level: m[2].length, text: text };
}

// ─── Setext 标题（段落下方 === 或 ---）───

function matchSetextUnderline(line) {
  if (/^=+\s*$/.test(line)) return 1;
  if (/^-{2,}\s*$/.test(line)) return 2;
  return 0;
}

// ─── HR ───

function matchHr(line) {
  return /^\s{0,3}([-*_])\s*(\1\s*){2,}$/.test(line);
}

// ─── 引用块 ───

function matchQuote(line) {
  return /^\s{0,3}>/.test(line);
}

function parseQuote(lines, start, genId, blocks, toc, opts) {
  // 收集连续引用行，计算深度，剥离 > 前缀
  var collected = []; // { depth, text }
  var i = start;
  while (i < lines.length) {
    var line = lines[i];
    var m = /^(\s{0,3})(>+\s*)(.*)$/.exec(line);
    if (m) {
      var gtCount = (m[2].match(/>/g) || []).length;
      collected.push({ depth: Math.min(gtCount, MAX_LIST_DEPTH), text: m[3] });
      i++;
      continue;
    }
    // lazy continuation：非空行且上一行是引用
    if (line.trim() !== '' && collected.length > 0) {
      collected.push({ depth: collected[collected.length - 1].depth, text: line });
      i++;
      continue;
    }
    break;
  }

  // 按深度分组：同深度的连续行合并为一个 quote 块
  var j = 0;
  while (j < collected.length) {
    var depth = collected[j].depth;
    var textParts = [];
    while (j < collected.length && collected[j].depth === depth) {
      textParts.push(collected[j].text);
      j++;
    }
    var qText = textParts.join('\n').trim();
    if (qText) {
      var qId = genId();
      var qChildren = parseInline(qText, opts);
      // 引用内可能含标题
      var atx = matchAtx(qText);
      if (atx && atx.text) {
        blocks.push({ type: 'heading', level: atx.level + 1, children: qChildren, text: inlineToPlainText(qChildren), id: qId });
        toc.push({ blockIndex: blocks.length - 1, level: atx.level + 1, text: inlineToPlainText(qChildren), id: qId });
      } else {
        blocks.push({ type: 'quote', depth: depth, children: qChildren, text: inlineToPlainText(qChildren), id: qId });
      }
    }
  }
  return i;
}

// ─── 列表 ───

function matchListItem(line) {
  return /^\s{0,3}([-*+]|\d{1,9}[.)])\s+/.test(line);
}

function getListIndent(line) {
  var m = /^(\s*)([-*+]|\d{1,9}[.)])\s+/.exec(line);
  if (!m) return -1;
  return m[0].length;
}

function parseList(lines, start, genId, blocks, toc, opts) {
  var i = start;
  var ordered = false;
  var ordIndex = 0;
  // 判断有序/无序
  var firstMatch = /^(\s*)([-*+]|\d{1,9}[.)])\s+/.exec(lines[start]);
  if (firstMatch && /\d/.test(firstMatch[2])) {
    ordered = true;
    ordIndex = parseInt(firstMatch[2], 10);
  }

  // 层级由实际出现过的缩进量决定，而不是 indent/2。
  // 写死除以 2 时，用 4 空格缩进的文档（同样合法且常见）
  // 每一级都会被算成两级，渲染出来的缩进翻倍。
  var indentLevels = [firstMatch ? firstMatch[1].length : 0];

  function depthOf(indent) {
    for (var k = indentLevels.length - 1; k >= 0; k--) {
      if (indent === indentLevels[k]) return Math.min(k, MAX_LIST_DEPTH);
      if (indent > indentLevels[k]) {
        indentLevels = indentLevels.slice(0, k + 1);
        indentLevels.push(indent);
        return Math.min(k + 1, MAX_LIST_DEPTH);
      }
    }
    indentLevels = [indent];
    return 0;
  }

  while (i < lines.length) {
    var line = lines[i];
    if (line.trim() === '') {
      // 空行：检查下一行是否还是列表项
      if (i + 1 < lines.length && matchListItem(lines[i + 1])) { i++; continue; }
      break;
    }
    var m = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(line);
    if (!m) {
      // 非列表项行：可能是续行（缩进 >= 标记缩进）或列表结束
      var contIndent = line.match(/^(\s*)/)[1].length;
      if (contIndent >= 2 && i > start) {
        // 续行：并回上一个 listItem。
        // 这里以前直接 i++ 跳过，续行内容就凭空消失了 ——
        // "不支持的语法降级为纯文本，但内容零丢失" 是硬要求
        var last = blocks[blocks.length - 1];
        if (last && last.type === 'listItem') {
          var contText = last.text + '\n' + line.trim();
          last.children = last.children.concat(
            [{ t: 'br' }],
            parseInline(line.trim(), opts)
          );
          last.text = contText;
        }
        i++;
        continue;
      }
      break;
    }

    var indent = m[1].length;
    var depth = depthOf(indent);
    var content = m[3];
    var task = false;
    var checked = false;
    var taskM = /^\[([ xX])\]\s+(.*)$/.exec(content);
    if (taskM) {
      task = true;
      checked = taskM[1] === 'x' || taskM[1] === 'X';
      content = taskM[2];
    }

    // 有序列表序号
    if (ordered && depth === 0) {
      var numMatch = /\d{1,9}/.exec(m[2]);
      if (numMatch) ordIndex = parseInt(numMatch[0], 10);
    }

    var itemId = genId();
    var itemChildren = parseInline(content, opts);
    blocks.push({
      type: 'listItem', ordered: ordered, ordIndex: ordered ? ordIndex : 0,
      depth: depth, task: task, checked: checked,
      children: itemChildren, text: inlineToPlainText(itemChildren), id: itemId
    });

    if (ordered && depth === 0) ordIndex++;
    i++;
  }
  return i;
}

// ─── 表格 ───

function matchTable(headerLine, sepLine) {
  if (headerLine.indexOf('|') < 0) return false;
  // 分隔行：| --- | :--: | --: |
  return /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(sepLine);
}

function parseTable(lines, start, genId, blocks, opts) {
  var headerLine = lines[start];
  var sepLine = lines[start + 1];
  var aligns = parseTableAligns(sepLine);
  var headerCells = splitTableRow(headerLine);

  var rows = [];
  var i = start + 2;
  while (i < lines.length) {
    var line = lines[i];
    if (line.trim() === '' || line.indexOf('|') < 0) break;
    // 不是表格行（可能是其他块级标记）
    if (matchHr(line) || matchAtx(line) || matchFence(line) || matchQuote(line)) break;
    rows.push(splitTableRow(line));
    i++;
  }

  var tableId = genId();
  blocks.push({
    type: 'table',
    header: headerCells.map(function (c) { return { children: parseInline(c, opts), text: c }; }),
    rows: rows.map(function (r) { return r.map(function (c) { return { children: parseInline(c, opts), text: c }; }); }),
    aligns: aligns,
    id: tableId
  });
  return i;
}

function parseTableAligns(sepLine) {
  var cells = splitTableRow(sepLine);
  return cells.map(function (c) {
    c = c.trim();
    var left = c[0] === ':';
    var right = c[c.length - 1] === ':';
    if (left && right) return 'center';
    if (right) return 'right';
    return 'left';
  });
}

function splitTableRow(line) {
  // 剥首尾空白和首尾的 |
  line = line.trim();
  if (line[0] === '|') line = line.slice(1);
  if (line[line.length - 1] === '|' && !/\\\|/.test(line.slice(-2))) line = line.slice(0, -1);
  // 按 | 分割，但处理 \|
  var cells = [];
  var buf = '';
  for (var i = 0; i < line.length; i++) {
    if (line[i] === '\\' && line[i + 1] === '|') { buf += '|'; i++; continue; }
    if (line[i] === '|') { cells.push(buf.trim()); buf = ''; continue; }
    buf += line[i];
  }
  cells.push(buf.trim());
  return cells;
}

// ─── 段落 ───

function parseParagraph(lines, start, genId, blocks, toc, opts) {
  var textParts = [];
  var i = start;
  while (i < lines.length) {
    var line = lines[i];
    if (line.trim() === '') break;
    // Setext 标题下划线（优先于 HR/块级标记检查，CommonMark 规定下划线优先于 thematic break）
    if (i > start && textParts.length > 0 && matchSetextUnderline(line)) {
      var lvl = matchSetextUnderline(line);
      var sId = genId();
      var sText = textParts.join('\n').trim();
      var sChildren = parseInline(sText, opts);
      blocks.push({ type: 'heading', level: lvl, children: sChildren, text: inlineToPlainText(sChildren), id: sId });
      toc.push({ blockIndex: blocks.length - 1, level: lvl, text: inlineToPlainText(sChildren), id: sId });
      return i + 1;
    }
    // 遇到块级标记则停止
    if (i > start && (matchFence(line) || matchAtx(line) || matchHr(line) ||
      matchQuote(line) || matchListItem(line) ||
      (i + 1 < lines.length && matchTable(line, lines[i + 1])))) {
      break;
    }
    textParts.push(line.trim());
    i++;
  }

  if (textParts.length > 0) {
    var pText = textParts.join('\n');
    var pId = genId();
    var pChildren = parseInline(pText, opts);
    blocks.push({ type: 'paragraph', children: pChildren, text: inlineToPlainText(pChildren), id: pId });
  }
  return i;
}

// ─── HTML 块（简化：收集到空行为止，作为 html 块渲染纯文本）───

function parseHtmlBlock(lines, start, genId, blocks) {
  var htmlLines = [];
  var i = start;
  while (i < lines.length) {
    var line = lines[i];
    if (line.trim() === '') break;
    // 遇到 markdown 块级标记停止
    if (i > start && (matchAtx(line) || matchFence(line) || matchHr(line))) break;
    htmlLines.push(line);
    i++;
  }
  if (htmlLines.length > 0) {
    blocks.push({ type: 'html', text: htmlLines.join('\n'), id: genId() });
  }
  return i;
}

module.exports = {
  parseMarkdownBlocks: parseMarkdownBlocks
};
