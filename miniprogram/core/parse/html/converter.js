/**
 * core/parse/html/converter.js - HTML DOM 树 → 块级 IR 转换器
 *
 * ⚠️ 纯函数模块：不依赖任何 wx API
 *
 * 将 tokenizer 产出的 DOM 树转换为与 TXT/Markdown 同构的块级 IR，
 * 复用 Phase 1/2 的虚拟滚动管线。
 *
 * 处理：
 * - C7：片段 HTML（无 html/body）自动容错
 * - C8：<style> 提权 + 内联 CSS 合并
 * - C10：base64 图片标记（大图待主线程落盘）
 * - C12：坏块降级纯文本
 * - C17：Tailwind 类名展开
 * - C18-C21：CSS 变量/伪元素/视口钳制/fixed→static
 * - C22/C23：脚本降级块插入
 * - C26：内联 SVG → base64 图片
 * - F2：节点数/深度上限保护
 */

var tokenizer = require('./tokenizer.js');
var preprocess = require('./preprocess.js');
var tailwind = require('./tailwind.js');
var degrade = require('./degrade.js');
var inline = require('../md/inline.js');

// ─── 标签默认样式 ───

var TAG_DEFAULTS = {
  'h1': { 'font-weight': 'bold', 'font-size': '32px', 'margin-top': '16px', 'margin-bottom': '8px' },
  'h2': { 'font-weight': 'bold', 'font-size': '28px', 'margin-top': '14px', 'margin-bottom': '7px' },
  'h3': { 'font-weight': 'bold', 'font-size': '24px', 'margin-top': '12px', 'margin-bottom': '6px' },
  'h4': { 'font-weight': 'bold', 'font-size': '20px', 'margin-top': '10px', 'margin-bottom': '5px' },
  'h5': { 'font-weight': 'bold', 'font-size': '18px', 'margin-top': '8px', 'margin-bottom': '4px' },
  'h6': { 'font-weight': 'bold', 'font-size': '16px', 'margin-top': '8px', 'margin-bottom': '4px' },
  'p': { 'margin-top': '0', 'margin-bottom': '8px' },
  'blockquote': { 'border-left': '4px solid #ddd', 'padding-left': '16px', 'margin': '8px 0' },
  'pre': { 'background-color': '#f5f5f5', 'padding': '12px', 'border-radius': '6px', 'overflow-x': 'auto' },
  'code': { 'font-family': 'monospace' },
  'ul': { 'list-style-type': 'disc', 'padding-left': '24px' },
  'ol': { 'list-style-type': 'decimal', 'padding-left': '24px' },
  'table': { 'border-collapse': 'collapse', 'width': '100%' },
  'th': { 'font-weight': 'bold', 'border': '1px solid #ddd', 'padding': '8px' },
  'td': { 'border': '1px solid #ddd', 'padding': '8px' },
  'img': { 'max-width': '100%' },
  'a': { 'color': '#3b82f6', 'text-decoration': 'underline' },
  'strong': { 'font-weight': 'bold' },
  'em': { 'font-style': 'italic' },
  'hr': { 'border': 'none', 'border-top': '1px solid #ddd', 'margin': '16px 0' }
};

// 容器标签（递归提取子元素为块）
var CONTAINER_TAGS = {
  'html': 1, 'body': 1, 'head': 0, // head 跳过
  'div': 1, 'section': 1, 'article': 1, 'main': 1,
  'header': 1, 'footer': 1, 'nav': 1, 'aside': 1,
  'figure': 1, 'figcaption': 1, 'details': 1, 'summary': 1,
  'form': 1, 'fieldset': 1, 'address': 1,
  'dl': 1, 'dt': 1, 'dd': 1
};

// ─── ID 生成器 ───

function createIdGen() {
  var counter = 0;
  return function() { return 'h' + (counter++); };
}

// ─── 样式工具 ───

/**
 * 将 style 对象转为 CSS 字符串
 */
function styleToString(style) {
  if (!style) return '';
  var parts = [];
  for (var prop in style) {
    if (style.hasOwnProperty(prop) && style[prop]) {
      parts.push(prop + ': ' + style[prop]);
    }
  }
  return parts.join('; ');
}

/**
 * 合并样式对象（后者覆盖前者）
 */
function mergeStyles() {
  var result = {};
  for (var i = 0; i < arguments.length; i++) {
    var src = arguments[i];
    if (src) {
      for (var key in src) {
        if (src.hasOwnProperty(key)) {
          result[key] = src[key];
        }
      }
    }
  }
  return result;
}

/**
 * 计算元素的最终样式
 * @param {Object} node - DOM 元素节点
 * @param {Array} cssRules - CSS 规则数组
 * @param {Array} ancestorPath - 祖先路径（用于后代选择器匹配）
 * @returns {Object} 计算后的样式对象
 */
function computeStyle(node, cssRules, ancestorPath, vars) {
  // 1. 标签默认样式
  var defaults = {};
  if (TAG_DEFAULTS[node.tag]) {
    defaults = Object.assign({}, TAG_DEFAULTS[node.tag]);
  }

  // 2. CSS 规则匹配
  var matched = {};
  if (cssRules) {
    for (var i = 0; i < cssRules.length; i++) {
      if (preprocess.matchesSelector(node, cssRules[i].selector, ancestorPath || [])) {
        matched = mergeStyles(matched, cssRules[i].declarations);
      }
    }
  }

  // 3. Tailwind 类名展开
  var twStyles = {};
  if (node.attrs && node.attrs.class) {
    twStyles = tailwind.expandClasses(node.attrs.class);
  }

  // 4. 内联样式（最高优先级）— 求值 CSS 变量
  var inlineStyle = node.style || {};
  if (vars) {
    for (var key in inlineStyle) {
      if (typeof inlineStyle[key] === 'string' && inlineStyle[key].indexOf('var(') >= 0) {
        inlineStyle[key] = preprocess.resolveVars(inlineStyle[key], vars);
      }
    }
  }

  // 合并：defaults < CSS rules < Tailwind < inline
  var result = mergeStyles(defaults, matched, twStyles, inlineStyle);

  // 5. 降级 fixed/sticky
  preprocess.degradeFixedStickyInline(result);

  return result;
}

// ─── 内联元素树构建 ───

/**
 * 将内联 DOM 节点转换为 inline 树（与 Markdown inline 同构）
 * 产出格式与 md/inline.js 的 parseInline 一致，可直接传给 flattenInline：
 *   { t:'text', text }
 *   { t:'strong', c:[Inline] }
 *   { t:'em', c:[Inline] }
 *   { t:'code', text }
 *   { t:'del', c:[Inline] }
 *   { t:'link', href, c:[Inline] }
 *   { t:'br' }
 *   { t:'image', src, alt }
 *
 * @param {Object} node - DOM 节点
 * @param {Array} ancestorPath - 祖先路径
 * @param {Object} ctx - 转换上下文
 * @returns {Array} inline 节点数组（t 格式）
 */
function buildInlineTree(node, ancestorPath, ctx) {
  if (!node) return [];
  var nodes = [];

  if (node.type === 'text') {
    var text = node.content || '';
    if (text) {
      nodes.push({ t: 'text', text: text });
    }
    return nodes;
  }

  if (node.type !== 'element') return nodes;

  var tag = node.tag;

  // <br>
  if (tag === 'br') {
    nodes.push({ t: 'br' });
    return nodes;
  }

  // <img> (inline)
  if (tag === 'img') {
    var src = (node.attrs && node.attrs.src) || '';
    var alt = (node.attrs && node.attrs.alt) || '';
    if (src) {
      ctx.images.push({ src: src, alt: alt, inline: true });
      if (src.indexOf('data:image/') === 0) {
        ctx.hasBase64 = true;
      } else if (src.indexOf('http') === 0 || src.indexOf('//') === 0) {
        ctx.hasNetworkImage = true;
      }
      nodes.push({ t: 'image', src: src, alt: alt });
    }
    return nodes;
  }

  // 获取子节点的 inline 树
  var childInline = [];
  var children = node.children || [];
  var newAncestor = ancestorPath.concat([node]);

  for (var i = 0; i < children.length; i++) {
    var childNodes = buildInlineTree(children[i], newAncestor, ctx);
    for (var j = 0; j < childNodes.length; j++) {
      childInline.push(childNodes[j]);
    }
  }

  // 根据标签映射为 Markdown inline 格式
  switch (tag) {
    case 'strong':
    case 'b':
      return [{ t: 'strong', c: childInline }];
    case 'em':
    case 'i':
      return [{ t: 'em', c: childInline }];
    case 'code':
    case 'kbd':
    case 'samp':
      // code 提取纯文本
      var codeText = '';
      for (var k = 0; k < childInline.length; k++) {
        if (childInline[k].t === 'text') codeText += childInline[k].text;
      }
      return [{ t: 'code', text: codeText }];
    case 'del':
    case 's':
    case 'strike':
      return [{ t: 'del', c: childInline }];
    case 'a':
      var href = (node.attrs && node.attrs.href) || '';
      return [{ t: 'link', href: href, c: childInline }];
    // sub/sup/mark/u/ins 等无 Markdown inline 对应，pass-through
    default:
      return childInline;
  }
}

// ─── 块级元素转换 ───

/**
 * 转换 DOM 树为 IR 块数组
 * @param {string} html - 原始 HTML（已消毒）
 * @param {Object} options - { cssRules, vars, pseudos, hasTailwind }
 * @returns {{ blocks: Array, toc: Array, images: Array, degraded: Array, hasBase64: boolean, hasNetworkImage: boolean, truncated: boolean }}
 */
function convert(html, options) {
  if (!html || typeof html !== 'string') {
    return { blocks: [], toc: [], images: [], degraded: [{ reason: 'empty-input', message: '输入为空' }], hasBase64: false, hasNetworkImage: false, truncated: false };
  }

  options = options || {};

  // 1. 检测脚本降级（使用传入的或在原始 HTML 上检测）
  // 注意：sanitize 会移除 <script> 标签，所以 scriptInfo 必须在 sanitize 前计算
  var scriptInfo = options.scriptInfo || degrade.detectScripts(html);

  // 2. tokenize
  var tokenized = tokenizer.tokenize(html);
  var root = tokenized.root;
  var styles = tokenized.styles;

  // 3. CSS 预处理
  var cssCtx = preprocess.preprocess(html, styles);
  var cssRules = options.cssRules || cssCtx.rules;

  // 4. 转换上下文
  var ctx = {
    idGen: createIdGen(),
    cssRules: cssRules,
    cssVars: cssCtx.vars || {},
    blocks: [],
    toc: [],
    images: [],
    degraded: [],
    hasBase64: false,
    hasNetworkImage: false,
    truncated: tokenized.truncated,
    pseudos: cssCtx.pseudos
  };

  if (tokenized.truncated) {
    ctx.degraded.push({ reason: 'node-limit', message: '文档节点数超限，已截断显示' });
  }

  // 5. 生成脚本降级块
  var degradeBlocks = degrade.generateDegradeBlocks(scriptInfo, ctx.idGen);
  for (var d = 0; d < degradeBlocks.length; d++) {
    ctx.blocks.push(degradeBlocks[d]);
    if (degradeBlocks[d].type === 'scriptDegrade') {
      ctx.degraded.push({ reason: 'script-' + degradeBlocks[d].degradeType, message: degradeBlocks[d].title });
    } else if (degradeBlocks[d].type === 'code' && degradeBlocks[d].lang === 'mermaid') {
      ctx.degraded.push({ reason: 'mermaid', message: 'Mermaid 图表已转为代码块' });
    }
  }

  // 6. 遍历 DOM 树
  walkDOM(root, [], ctx);

  // 7. 如果没有任何块，降级为纯文本
  if (ctx.blocks.length === 0) {
    var text = tokenizer.getTextContent(root);
    if (text && text.trim()) {
      // 按 TXT 方式分块
      var lines = text.split('\n');
      var buffer = [];
      for (var li = 0; li < lines.length; li++) {
        if (lines[li].trim() === '') {
          if (buffer.length > 0) {
            ctx.blocks.push({
              type: 'paragraph',
              text: buffer.join('\n'),
              children: [{ text: buffer.join('\n') }],
              segments: inline.flattenInline([{ t: 'text', text: buffer.join('\n') }]),
              id: ctx.idGen()
            });
            buffer = [];
          }
        } else {
          buffer.push(lines[li]);
        }
      }
      if (buffer.length > 0) {
        ctx.blocks.push({
          type: 'paragraph',
          text: buffer.join('\n'),
          children: [{ text: buffer.join('\n') }],
          segments: inline.flattenInline([{ t: 'text', text: buffer.join('\n') }]),
          id: ctx.idGen()
        });
      }
    }
    ctx.degraded.push({ reason: 'html-fallback', message: 'HTML 解析降级为纯文本' });
  }

  // 8. 如果 HTML 无标签（纯文本被 walkDOM 处理为段落），也标记降级
  if (ctx.blocks.length > 0 && ctx.degraded.length === 0) {
    var hasHtmlTags = /<[a-zA-Z!/]/.test(html);
    if (!hasHtmlTags) {
      ctx.degraded.push({ reason: 'html-fallback', message: '无 HTML 标签，按纯文本处理' });
    }
  }

  return {
    blocks: ctx.blocks,
    toc: ctx.toc,
    images: ctx.images,
    degraded: ctx.degraded,
    hasBase64: ctx.hasBase64,
    hasNetworkImage: ctx.hasNetworkImage,
    truncated: ctx.truncated
  };
}

/**
 * 递归遍历 DOM 树，生成 IR 块
 */
function walkDOM(node, ancestorPath, ctx) {
  if (!node) return;
  if (ctx.blocks.length > 50000) {
    ctx.truncated = true;
    return;
  }

  if (node.type === 'text') {
    var text = (node.content || '').trim();
    if (text) {
      // 独立的文本节点 → 段落
      ctx.blocks.push({
        type: 'paragraph',
        text: text,
        children: [{ t: 'text', text: text }],
        segments: inline.flattenInline([{ t: 'text', text: text }]),
        style: '',
        id: ctx.idGen()
      });
    }
    return;
  }

  if (node.type === 'comment') return;
  if (node.type === 'root') {
    var children = node.children || [];
    for (var i = 0; i < children.length; i++) {
      walkDOM(children[i], ancestorPath, ctx);
    }
    return;
  }

  if (node.type !== 'element') return;

  var tag = node.tag;

  // 伪元素内容合成（C19）
  var beforePseudo = '';
  var afterPseudo = '';
  if (ctx.pseudos && ctx.pseudos.length > 0) {
    for (var pi2 = 0; pi2 < ctx.pseudos.length; pi2++) {
      var pse = ctx.pseudos[pi2];
      if (preprocess.matchesSelector(node, pse.selector, ancestorPath || [])) {
        if (pse.pseudo === 'before') beforePseudo += pse.content;
        if (pse.pseudo === 'after') afterPseudo = pse.content + afterPseudo;
      }
    }
  }
  var newAncestor = ancestorPath.concat([node]);

  // 计算样式
  var computedStyle = computeStyle(node, ctx.cssRules, ancestorPath, ctx.cssVars);
  var styleStr = styleToString(computedStyle);

  // ─── 标题 ───
  if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') {
    var level = parseInt(tag[1]);
    var headingText = tokenizer.getTextContent(node).trim();
    var id = ctx.idGen();
    var headingChildren = [];
    if (beforePseudo) headingChildren.push({ t: 'text', text: beforePseudo });
    var hChildren = node.children || [];
    for (var hi = 0; hi < hChildren.length; hi++) {
      var hc = buildInlineTree(hChildren[hi], newAncestor, ctx);
      for (var hj = 0; hj < hc.length; hj++) headingChildren.push(hc[hj]);
    }
    if (afterPseudo) headingChildren.push({ t: 'text', text: afterPseudo });
    var headingTextWithPseudo = (beforePseudo || '') + headingText + (afterPseudo || '');
    ctx.blocks.push({
      type: 'heading',
      level: level,
      text: headingTextWithPseudo,
      children: headingChildren,
      segments: inline.flattenInline(headingChildren),
      style: styleStr,
      id: id
    });
    ctx.toc.push({ blockIndex: ctx.blocks.length - 1, level: level, text: headingTextWithPseudo, id: id });
    return;
  }

  // ─── 段落 ───
  if (tag === 'p') {
    var pChildren = [];
    if (beforePseudo) pChildren.push({ t: 'text', text: beforePseudo });
    var pKids = node.children || [];
    for (var pi = 0; pi < pKids.length; pi++) {
      var pc = buildInlineTree(pKids[pi], newAncestor, ctx);
      for (var pj = 0; pj < pc.length; pj++) pChildren.push(pc[pj]);
    }
    if (afterPseudo) pChildren.push({ t: 'text', text: afterPseudo });
    var pText = (beforePseudo || '') + tokenizer.getTextContent(node).trim() + (afterPseudo || '');
    if (pText || pChildren.length > 0) {
      ctx.blocks.push({
        type: 'paragraph',
        text: pText,
        children: pChildren,
        segments: inline.flattenInline(pChildren),
        style: styleStr,
        id: ctx.idGen()
      });
    }
    return;
  }

  // ─── 预格式化 / 代码块 ───
  if (tag === 'pre') {
    var preText = tokenizer.getTextContent(node);
    // 检测语言
    var lang = '';
    var codeChild = null;
    var preKids = node.children || [];
    for (var ci = 0; ci < preKids.length; ci++) {
      if (preKids[ci].tag === 'code') {
        codeChild = preKids[ci];
        break;
      }
    }
    if (codeChild && codeChild.attrs && codeChild.attrs.class) {
      var langMatch = codeChild.attrs.class.match(/(?:language-|lang-)([\w-]+)/);
      if (langMatch) lang = langMatch[1];
    }
    // 清理 pre 内容（去除 <code> 标签文本）
    if (codeChild) {
      preText = tokenizer.getTextContent(codeChild);
    }
    // 不再另存 raw：raw 与 text 内容完全一致，两份都会被 setData 下发，
    // 大代码块的传输量白白翻倍（D12），而渲染层从来没用过 raw
    ctx.blocks.push({
      type: 'code',
      lang: lang,
      text: preText,
      longHint: preText.split('\n').length > 2000,
      style: styleStr,
      id: ctx.idGen()
    });
    return;
  }

  // ─── 引用 ───
  if (tag === 'blockquote') {
    // 递归处理子元素
    var bqKids = node.children || [];
    for (var bi = 0; bi < bqKids.length; bi++) {
      walkDOM(bqKids[bi], newAncestor, ctx);
    }
    return;
  }

  // ─── 列表 ───
  if (tag === 'ul' || tag === 'ol') {
    var ordered = tag === 'ol';
    var listKids = node.children || [];
    var ordIndex = 1;
    for (var li2 = 0; li2 < listKids.length; li2++) {
      var liNode = listKids[li2];
      if (liNode.tag === 'li') {
        var liChildren = [];
        var liKids = liNode.children || [];
        for (var lic = 0; lic < liKids.length; lic++) {
          var licNodes = buildInlineTree(liKids[lic], newAncestor.concat([liNode]), ctx);
          for (var lic2 = 0; lic2 < licNodes.length; lic2++) liChildren.push(licNodes[lic2]);
        }
        var liText = tokenizer.getTextContent(liNode).trim();
        // 检测任务列表
        var isTask = false;
        var isChecked = false;
        if (liNode.attrs && liNode.attrs.class) {
          var taskMatch = liNode.attrs.class.match(/task-list-item/);
          if (taskMatch) {
            isTask = true;
            // 检查 checkbox
            for (var ti = 0; ti < liKids.length; ti++) {
              if (liKids[ti].tag === 'input' && liKids[ti].attrs && liKids[ti].attrs.type === 'checkbox') {
                isChecked = liKids[ti].attrs.checked !== undefined;
              }
            }
          }
        }
        ctx.blocks.push({
          type: 'listItem',
          ordered: ordered,
          ordIndex: ordered ? ordIndex++ : 0,
          depth: 0,
          task: isTask,
          checked: isChecked,
          text: liText,
          children: liChildren,
          segments: inline.flattenInline(liChildren),
          style: styleStr,
          id: ctx.idGen()
        });
      }
    }
    return;
  }

  // ─── 表格 ───
  if (tag === 'table') {
    var table = parseTable(node, newAncestor, ctx);
    if (table) {
      table.style = styleStr;
      table.id = ctx.idGen();
      ctx.blocks.push(table);
    }
    return;
  }

  // ─── 图片 ───
  if (tag === 'img') {
    var src = (node.attrs && node.attrs.src) || '';
    var alt = (node.attrs && node.attrs.alt) || '';
    if (src) {
      ctx.images.push({ src: src, alt: alt, inline: false });
      if (src.indexOf('data:image/') === 0) ctx.hasBase64 = true;
      if (src.indexOf('http') === 0 || src.indexOf('//') === 0) ctx.hasNetworkImage = true;
      ctx.blocks.push({
        type: 'image',
        src: src,
        alt: alt,
        style: styleStr,
        id: ctx.idGen()
      });
    }
    return;
  }

  // ─── 水平线 ───
  if (tag === 'hr') {
    ctx.blocks.push({ type: 'hr', style: styleStr, id: ctx.idGen() });
    return;
  }

  // ─── SVG → base64 图片（C26）───
  if (tag === 'svg') {
    // 提取 SVG 内容并转为 base64
    var svgContent = serializeSVG(node);
    if (svgContent) {
      // 简单 base64 编码（小程序中用 wx.arrayBufferToBase64，这里只标记）
      var dataUri = 'data:image/svg+xml;base64,' + base64Encode(svgContent);
      ctx.images.push({ src: dataUri, alt: 'SVG 图形', inline: false });
      ctx.blocks.push({
        type: 'image',
        src: dataUri,
        alt: 'SVG 图形',
        style: 'max-width: 100%',
        id: ctx.idGen()
      });
    }
    return;
  }

  // ─── 容器元素（div, section, article 等）───
  if (CONTAINER_TAGS[tag]) {
    var containerKids = node.children || [];
    // 如果容器只有一个子元素且是文本，创建段落
    if (containerKids.length === 1 && containerKids[0].type === 'text') {
      var cText = containerKids[0].content.trim();
      if (cText) {
        ctx.blocks.push({
          type: 'paragraph',
          text: cText,
          children: [{ t: 'text', text: cText }],
          segments: inline.flattenInline([{ t: 'text', text: cText }]),
          style: styleStr,
          id: ctx.idGen()
        });
      }
      return;
    }
    // 递归处理子元素
    for (var ck = 0; ck < containerKids.length; ck++) {
      walkDOM(containerKids[ck], newAncestor, ctx);
    }
    return;
  }

  // ─── script 标签（已被消毒，但 tokenizer 保留了节点）───
  if (tag === 'script') {
    // 跳过，降级块已在前面处理
    return;
  }

  // ─── 其他元素：尝试提取文本内容 ───
  var otherText = tokenizer.getTextContent(node).trim();
  if (otherText) {
    var otherChildren = [];
    var otherKids = node.children || [];
    for (var oi = 0; oi < otherKids.length; oi++) {
      var oc = buildInlineTree(otherKids[oi], newAncestor, ctx);
      for (var oj = 0; oj < oc.length; oj++) otherChildren.push(oc[oj]);
    }
    ctx.blocks.push({
      type: 'paragraph',
      text: otherText,
      children: otherChildren,
      segments: inline.flattenInline(otherChildren),
      style: styleStr,
      id: ctx.idGen()
    });
  }
}

// ─── 表格解析 ───

function parseTable(tableNode, ancestorPath, ctx) {
  var header = [];
  var rows = [];
  var aligns = [];

  var rows_ = [];
  collectTableRows(tableNode, rows_);

  for (var i = 0; i < rows_.length; i++) {
    var row = rows_[i];
    var cells = [];
    var isHeader = row.tag === 'th' || (row.parentTag === 'thead');
    var cellNodes = (row.children || []).filter(function(c) {
      return c.type === 'element' && (c.tag === 'td' || c.tag === 'th');
    });

    for (var c = 0; c < cellNodes.length; c++) {
      var cellText = tokenizer.getTextContent(cellNodes[c]).trim();
      cells.push({ text: cellText });
    }

    if (i === 0 && isHeader) {
      header = cells;
    } else {
      rows.push(cells);
    }
  }

  if (header.length === 0 && rows.length > 0) {
    header = rows[0];
    rows = rows.slice(1);
  }

  if (header.length === 0 && rows.length === 0) return null;

  return {
    type: 'table',
    header: header,
    rows: rows,
    aligns: aligns
  };
}

function collectTableRows(node, rows) {
  if (!node || node.type !== 'element') return;
  if (node.tag === 'tr') {
    rows.push(node);
    return;
  }
  var children = node.children || [];
  for (var i = 0; i < children.length; i++) {
    collectTableRows(children[i], rows);
  }
}

// ─── SVG 序列化 ───

function serializeSVG(node) {
  if (!node) return '';
  if (node.type === 'text') return node.content || '';
  if (node.type !== 'element') return '';

  var attrs = '';
  if (node.attrs) {
    for (var key in node.attrs) {
      if (node.attrs.hasOwnProperty(key) && key !== 'style') {
        attrs += ' ' + key + '="' + node.attrs[key] + '"';
      }
    }
  }

  var children = '';
  var kids = node.children || [];
  for (var i = 0; i < kids.length; i++) {
    children += serializeSVG(kids[i]);
  }

  return '<' + node.tag + attrs + '>' + children + '</' + node.tag + '>';
}

// ─── 简易 Base64 编码（纯 JS，不依赖 wx API）───

function base64Encode(str) {
  // 简单 UTF-8 → Base64
  // 小程序中有 wx.arrayBufferToBase64，这里提供纯函数兜底
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var bytes = [];
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xC0 | (c >> 6));
      bytes.push(0x80 | (c & 0x3F));
    } else {
      bytes.push(0xE0 | (c >> 12));
      bytes.push(0x80 | ((c >> 6) & 0x3F));
      bytes.push(0x80 | (c & 0x3F));
    }
  }

  var result = '';
  for (var j = 0; j < bytes.length; j += 3) {
    var b1 = bytes[j] || 0;
    var b2 = bytes[j + 1] || 0;
    var b3 = bytes[j + 2] || 0;

    result += chars[b1 >> 2];
    result += chars[((b1 & 3) << 4) | (b2 >> 4)];
    result += (j + 1 < bytes.length) ? chars[((b2 & 15) << 2) | (b3 >> 6)] : '=';
    result += (j + 2 < bytes.length) ? chars[b3 & 63] : '=';
  }

  return result;
}

module.exports = {
  convert: convert,
  computeStyle: computeStyle,
  styleToString: styleToString,
  buildInlineTree: buildInlineTree
};
