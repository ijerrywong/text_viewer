/**
 * core/parse/html/tokenizer.js - 轻量 HTML 解析器
 *
 * ⚠️ 纯函数模块：不依赖任何 wx API
 * 可在 Worker 和 Node 环境中运行
 *
 * 将 HTML 字符串解析为 DOM-like 树结构。
 * 设计目标：容错（不抛异常）、轻量（~400行）、覆盖 AI 生成 HTML 的常见模式。
 *
 * 节点结构：
 *   Element: { type:'element', tag, attrs:{}, children:[], style:{} }
 *   Text:    { type:'text', content }
 *   Comment: { type:'comment', content }
 *   Root:    { type:'root', children:[] }
 *
 * 安全限制（F2 防解析炸弹）：
 *   - 节点数上限 50,000
 *   - 嵌套深度上限 100
 *   - 超限截断并标记 truncated
 */

// ─── 常量 ───

// Void elements（无需闭合标签）
var VOID_TAGS = {
  'area': 1, 'base': 1, 'br': 1, 'col': 1, 'embed': 1,
  'hr': 1, 'img': 1, 'input': 1, 'link': 1, 'meta': 1,
  'param': 1, 'source': 1, 'track': 1, 'wbr': 1
};

// 块级元素（生成 IR 块的边界）
var BLOCK_TAGS = {
  'div': 1, 'section': 1, 'article': 1, 'main': 1, 'header': 1,
  'footer': 1, 'nav': 1, 'aside': 1, 'p': 1, 'h1': 1, 'h2': 1,
  'h3': 1, 'h4': 1, 'h5': 1, 'h6': 1, 'ul': 1, 'ol': 1, 'li': 1,
  'table': 1, 'thead': 1, 'tbody': 1, 'tfoot': 1, 'tr': 1,
  'td': 1, 'th': 1, 'blockquote': 1, 'pre': 1, 'figure': 1,
  'figcaption': 1, 'hr': 1, 'address': 1, 'dl': 1, 'dt': 1,
  'dd': 1, 'details': 1, 'summary': 1, 'form': 1, 'fieldset': 1
};

// 内联元素
var INLINE_TAGS = {
  'a': 1, 'span': 1, 'strong': 1, 'b': 1, 'em': 1, 'i': 1,
  'code': 1, 'kbd': 1, 'samp': 1, 'var': 1, 'del': 1, 's': 1,
  'strike': 1, 'ins': 1, 'u': 1, 'mark': 1, 'small': 1, 'big': 1,
  'sub': 1, 'sup': 1, 'abbr': 1, 'cite': 1, 'q': 1, 'time': 1,
  'br': 1, 'wbr': 1, 'img': 1, 'bdi': 1, 'bdo': 1, 'ruby': 1,
  'rt': 1, 'rp': 1, 'data': 1, 'font': 1, 'label': 1
};

// 需要跳过的标签（head 区域，不产生内容）
var SKIP_TAGS = {
  'head': 1, 'title': 1, 'meta': 1, 'link': 1, 'base': 1,
  'style': 1, 'script': 1, 'noscript': 1
};

// 可选闭合规则：遇到这些标签时自动关闭栈顶的某些未闭合标签
// key = 栈顶标签, value = 能自动关闭它的标签集合
var AUTO_CLOSE_RULES = {
  'p': { 'p': 1, 'div': 1, 'section': 1, 'article': 1, 'main': 1, 'header': 1,
         'footer': 1, 'nav': 1, 'aside': 1, 'h1': 1, 'h2': 1, 'h3': 1, 'h4': 1,
         'h5': 1, 'h6': 1, 'ul': 1, 'ol': 1, 'table': 1, 'pre': 1, 'blockquote': 1,
         'hr': 1, 'figure': 1, 'address': 1, 'dl': 1, 'form': 1, 'fieldset': 1 },
  'h1': { 'p': 1, 'div': 1, 'section': 1, 'article': 1, 'main': 1, 'header': 1,
          'footer': 1, 'nav': 1, 'aside': 1, 'h1': 1, 'h2': 1, 'h3': 1, 'h4': 1,
          'h5': 1, 'h6': 1, 'ul': 1, 'ol': 1, 'table': 1, 'pre': 1, 'blockquote': 1,
          'hr': 1, 'figure': 1, 'address': 1, 'dl': 1, 'form': 1, 'fieldset': 1 },
  'h2': { 'p': 1, 'div': 1, 'section': 1, 'article': 1, 'main': 1, 'header': 1,
          'footer': 1, 'nav': 1, 'aside': 1, 'h1': 1, 'h2': 1, 'h3': 1, 'h4': 1,
          'h5': 1, 'h6': 1, 'ul': 1, 'ol': 1, 'table': 1, 'pre': 1, 'blockquote': 1,
          'hr': 1, 'figure': 1, 'address': 1, 'dl': 1, 'form': 1, 'fieldset': 1 },
  'h3': { 'p': 1, 'div': 1, 'section': 1, 'article': 1, 'main': 1, 'header': 1,
          'footer': 1, 'nav': 1, 'aside': 1, 'h1': 1, 'h2': 1, 'h3': 1, 'h4': 1,
          'h5': 1, 'h6': 1, 'ul': 1, 'ol': 1, 'table': 1, 'pre': 1, 'blockquote': 1,
          'hr': 1, 'figure': 1, 'address': 1, 'dl': 1, 'form': 1, 'fieldset': 1 },
  'h4': { 'p': 1, 'div': 1, 'section': 1, 'article': 1, 'main': 1, 'header': 1,
          'footer': 1, 'nav': 1, 'aside': 1, 'h1': 1, 'h2': 1, 'h3': 1, 'h4': 1,
          'h5': 1, 'h6': 1, 'ul': 1, 'ol': 1, 'table': 1, 'pre': 1, 'blockquote': 1,
          'hr': 1, 'figure': 1, 'address': 1, 'dl': 1, 'form': 1, 'fieldset': 1 },
  'h5': { 'p': 1, 'div': 1, 'section': 1, 'article': 1, 'main': 1, 'header': 1,
          'footer': 1, 'nav': 1, 'aside': 1, 'h1': 1, 'h2': 1, 'h3': 1, 'h4': 1,
          'h5': 1, 'h6': 1, 'ul': 1, 'ol': 1, 'table': 1, 'pre': 1, 'blockquote': 1,
          'hr': 1, 'figure': 1, 'address': 1, 'dl': 1, 'form': 1, 'fieldset': 1 },
  'h6': { 'p': 1, 'div': 1, 'section': 1, 'article': 1, 'main': 1, 'header': 1,
          'footer': 1, 'nav': 1, 'aside': 1, 'h1': 1, 'h2': 1, 'h3': 1, 'h4': 1,
          'h5': 1, 'h6': 1, 'ul': 1, 'ol': 1, 'table': 1, 'pre': 1, 'blockquote': 1,
          'hr': 1, 'figure': 1, 'address': 1, 'dl': 1, 'form': 1, 'fieldset': 1 },
  'li': { 'li': 1 },
  'td': { 'td': 1, 'th': 1 },
  'th': { 'td': 1, 'th': 1 },
  'tr': { 'tr': 1 },
  'dt': { 'dt': 1, 'dd': 1 },
  'dd': { 'dt': 1, 'dd': 1 },
  'option': { 'option': 1, 'optgroup': 1 }
};

// 安全限制
var MAX_NODES = 50000;
var MAX_DEPTH = 100;

// ─── HTML 实体解码 ───

var NAMED_ENTITIES = {
  'amp': '&', 'lt': '<', 'gt': '>', 'quot': '"', 'apos': "'",
  'nbsp': '\u00A0', 'copy': '\u00A9', 'reg': '\u00AE', 'trade': '\u2122',
  'hellip': '\u2026', 'mdash': '\u2014', 'ndash': '\u2013',
  'lsquo': '\u2018', 'rsquo': '\u2019', 'ldquo': '\u201C', 'rdquo': '\u201D',
  'laquo': '\u00AB', 'raquo': '\u00BB', 'middot': '\u00B7',
  'bull': '\u2022', 'dagger': '\u2020', 'Dagger': '\u2021',
  'permil': '\u2030', 'prime': '\u2032', 'Prime': '\u2033',
  'times': '\u00D7', 'divide': '\u00F7', 'plusmn': '\u00B1',
  'minus': '\u2212', 'frasl': '\u2044', 'deg': '\u00B0',
  'euro': '\u20AC', 'pound': '\u00A3', 'cent': '\u00A2', 'yen': '\u00A5',
  'sect': '\u00A7', 'para': '\u00B6', 'middot': '\u00B7',
  'sdot': '\u22C5', 'asymp': '\u2248', 'ne': '\u2260',
  'le': '\u2264', 'ge': '\u2265', 'infin': '\u221E',
  'alpha': '\u03B1', 'beta': '\u03B2', 'gamma': '\u03B3', 'delta': '\u03B4',
  'epsilon': '\u03B5', 'zeta': '\u03B6', 'eta': '\u03B7', 'theta': '\u03B8',
  'iota': '\u03B9', 'kappa': '\u03BA', 'lambda': '\u03BB', 'mu': '\u03BC',
  'nu': '\u03BD', 'xi': '\u03BE', 'omicron': '\u03BF', 'pi': '\u03C0',
  'rho': '\u03C1', 'sigma': '\u03C3', 'tau': '\u03C4', 'upsilon': '\u03C5',
  'phi': '\u03C6', 'chi': '\u03C7', 'psi': '\u03C8', 'omega': '\u03C9',
  'Alpha': '\u0391', 'Beta': '\u0392', 'Gamma': '\u0393', 'Delta': '\u0394',
  'Epsilon': '\u0395', 'Zeta': '\u0396', 'Eta': '\u0397', 'Theta': '\u0398',
  'Iota': '\u0399', 'Kappa': '\u039A', 'Lambda': '\u039B', 'Mu': '\u039C',
  'Nu': '\u039D', 'Xi': '\u039E', 'Omicron': '\u039F', 'Pi': '\u03A0',
  'Rho': '\u03A1', 'Sigma': '\u03A3', 'Tau': '\u03A4', 'Upsilon': '\u03A5',
  'Phi': '\u03A6', 'Chi': '\u03A7', 'Psi': '\u03A8', 'Omega': '\u03A9'
};

function decodeEntities(s) {
  if (!s || s.indexOf('&') < 0) return s;
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, function(match, entity) {
    // 数字实体
    if (entity[0] === '#') {
      var code;
      if (entity[1] === 'x' || entity[1] === 'X') {
        code = parseInt(entity.slice(2), 16);
      } else {
        code = parseInt(entity.slice(1), 10);
      }
      if (!isNaN(code) && code > 0 && code <= 0x10FFFF) {
        return String.fromCharCode(code);
      }
      return match;
    }
    // 命名实体
    if (NAMED_ENTITIES[entity]) {
      return NAMED_ENTITIES[entity];
    }
    return match;
  });
}

// ─── 属性解析 ───

/**
 * 解析标签内的属性字符串
 * @param {string} attrStr - 标签名之后的属性字符串（不含 <>）
 * @returns {Object} 属性键值对
 */
function parseAttrs(attrStr) {
  var attrs = {};
  var i = 0;
  var len = attrStr.length;

  while (i < len) {
    // 跳过空白
    while (i < len && /\s/.test(attrStr[i])) i++;
    if (i >= len) break;

    // 读取属性名
    var nameStart = i;
    while (i < len && !/[\s=\/>]/.test(attrStr[i])) i++;
    var name = attrStr.slice(nameStart, i).toLowerCase();

    if (!name) {
      i++;
      continue;
    }

    // 跳过空白
    while (i < len && /\s/.test(attrStr[i])) i++;

    var value = '';

    // 检查是否有 =
    if (i < len && attrStr[i] === '=') {
      i++; // 跳过 =
      while (i < len && /\s/.test(attrStr[i])) i++;

      if (i < len && (attrStr[i] === '"' || attrStr[i] === "'")) {
        var quote = attrStr[i];
        i++;
        var valStart = i;
        while (i < len && attrStr[i] !== quote) i++;
        value = attrStr.slice(valStart, i);
        if (i < len) i++; // 跳过引号
      } else {
        var valStart2 = i;
        while (i < len && !/[\s>]/.test(attrStr[i])) i++;
        value = attrStr.slice(valStart2, i);
      }
    }

    // 解码实体
    value = decodeEntities(value);

    // class 特殊处理：合并
    if (name === 'class') {
      attrs.class = (attrs.class ? attrs.class + ' ' : '') + value;
    } else {
      attrs[name] = value;
    }
  }

  return attrs;
}

// ─── 内联样式解析 ───

/**
 * 将 style="color:red; font-size:14px" 解析为 { color:'red', 'font-size':'14px' }
 */
function parseStyle(styleStr) {
  var style = {};
  if (!styleStr) return style;
  var parts = styleStr.split(';');
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i].trim();
    if (!part) continue;
    var colonIdx = part.indexOf(':');
    if (colonIdx < 0) continue;
    var prop = part.slice(0, colonIdx).trim().toLowerCase();
    var val = part.slice(colonIdx + 1).trim();
    if (prop && val) {
      style[prop] = val;
    }
  }
  return style;
}

// ─── HTML 解析器主逻辑 ───

/**
 * 解析 HTML 字符串为 DOM 树
 * @param {string} html - HTML 字符串
 * @returns {{ root: Object, styles: string[], truncated: boolean, nodeCount: number }}
 *   root: 根节点 { type:'root', children:[] }
 *   styles: 从 <style> 标签提取的 CSS 文本数组
 *   truncated: 是否因超限截断
 *   nodeCount: 总节点数
 */
function tokenize(html) {
  if (!html || typeof html !== 'string') {
    return { root: { type: 'root', children: [] }, styles: [], truncated: false, nodeCount: 0 };
  }

  var root = { type: 'root', children: [] };
  var stack = [root];
  var styles = [];
  var nodeCount = 0;
  var truncated = false;

  var i = 0;
  var len = html.length;

  while (i < len) {
    if (truncated) break;

    // 查找下一个 <
    var ltIdx = html.indexOf('<', i);

    if (ltIdx < 0) {
      // 剩余都是文本
      var text = html.slice(i);
      if (text.trim()) {
        addText(stack[stack.length - 1], decodeEntities(text));
      }
      break;
    }

    // < 之前的文本
    if (ltIdx > i) {
      var textBefore = html.slice(i, ltIdx);
      if (textBefore.trim()) {
        addText(stack[stack.length - 1], decodeEntities(textBefore));
      }
    }

    i = ltIdx;

    // 处理 < 后的内容
    if (i + 1 >= len) {
      addText(stack[stack.length - 1], '<');
      break;
    }

    var nextChar = html[i + 1];

    // 注释 <!-- -->
    if (nextChar === '!' && html.substr(i + 2, 2) === '--') {
      var endComment = html.indexOf('-->', i + 4);
      if (endComment < 0) {
        i = len;
      } else {
        i = endComment + 3;
      }
      continue;
    }

    // CDATA <![CDATA[ ]]>
    if (nextChar === '!' && html.substr(i + 2, 7) === '[CDATA[') {
      var endCdata = html.indexOf(']]>', i + 9);
      if (endCdata < 0) {
        addText(stack[stack.length - 1], html.slice(i + 9));
        i = len;
      } else {
        addText(stack[stack.length - 1], html.slice(i + 9, endCdata));
        i = endCdata + 3;
      }
      continue;
    }

    // DOCTYPE <!DOCTYPE ...>
    if (nextChar === '!') {
      var endDoctype = html.indexOf('>', i + 2);
      if (endDoctype < 0) {
        i = len;
      } else {
        i = endDoctype + 1;
      }
      continue;
    }

    // 处理指令 <? ... ?>
    if (nextChar === '?') {
      var endPi = html.indexOf('?>', i + 2);
      if (endPi < 0) {
        i = len;
      } else {
        i = endPi + 2;
      }
      continue;
    }

    // 闭合标签 </tag>
    if (nextChar === '/') {
      var endClose = html.indexOf('>', i + 2);
      if (endClose < 0) {
        i = len;
        break;
      }
      var closeTag = html.slice(i + 2, endClose).trim().toLowerCase();
      i = endClose + 1;

      // 弹栈到匹配的标签
      for (var s = stack.length - 1; s >= 1; s--) {
        if (stack[s].tag === closeTag) {
          stack.length = s;
          break;
        }
      }
      continue;
    }

    // 开始标签 <tag attrs>
    // 找到 > 的位置（注意属性值中的 > ）
    var tagEnd = findTagEnd(html, i + 1);
    if (tagEnd < 0) {
      // 没有闭合 >，当作文本
      addText(stack[stack.length - 1], html.slice(i));
      break;
    }

    var tagContent = html.slice(i + 1, tagEnd);
    var selfClosing = tagContent[tagContent.length - 1] === '/';
    if (selfClosing) {
      tagContent = tagContent.slice(0, -1);
    }

    // 解析标签名
    var tagMatch = tagContent.match(/^([a-zA-Z][a-zA-Z0-9:-]*)/);
    if (!tagMatch) {
      // 不是合法标签名，当作文本
      addText(stack[stack.length - 1], '<' + tagContent + '>');
      i = tagEnd + 1;
      continue;
    }

    var tag = tagMatch[1].toLowerCase();
    var attrStr = tagContent.slice(tagMatch[0].length);
    var attrs = parseAttrs(attrStr);

    // 可选闭合规则：自动关闭栈顶未闭合的标签
    // 例如 <p>文本<p>段落 → 第一个 <p> 在遇到第二个 <p> 时自动关闭
    var topTag = stack[stack.length - 1].tag;
    if (topTag && AUTO_CLOSE_RULES[topTag] && AUTO_CLOSE_RULES[topTag][tag]) {
      stack.pop();
    }

    // 解析 style 属性
    var styleObj = {};
    if (attrs.style) {
      styleObj = parseStyle(attrs.style);
    }

    i = tagEnd + 1;

    // 节点数检查
    nodeCount++;
    if (nodeCount > MAX_NODES) {
      truncated = true;
      break;
    }

    // 深度检查
    if (stack.length > MAX_DEPTH) {
      truncated = true;
      break;
    }

    // <style> 标签：提取内容，不加入 DOM 树
    if (tag === 'style') {
      var endStyle = findCloseTag(html, i, 'style');
      if (endStyle) {
        var cssText = html.slice(i, endStyle.pos);
        styles.push(cssText);
        i = endStyle.endPos;
      } else {
        styles.push(html.slice(i));
        i = len;
      }
      continue;
    }

    // <script> 标签：已被 sanitize 剥离，但如果残留则跳过内容
    if (tag === 'script') {
      var endScript = findCloseTag(html, i, 'script');
      if (endScript) {
        i = endScript.endPos;
      } else {
        i = len;
      }
      // 保留 script 节点信息用于降级检测
      var scriptNode = { type: 'element', tag: 'script', attrs: attrs, children: [], style: {} };
      stack[stack.length - 1].children.push(scriptNode);
      continue;
    }

    // <pre> 标签：正常解析内部 HTML（保留 <code> 子元素结构）
    // 注意：不将 <pre> 内容当作 raw text，否则 <code class="language-x"> 无法被识别
    // 空白保留由 text node 的 content 原样存储保证

    // <textarea> 标签：类似 pre
    if (tag === 'textarea') {
      var taNode = { type: 'element', tag: tag, attrs: attrs, children: [], style: styleObj };
      stack[stack.length - 1].children.push(taNode);
      if (selfClosing || VOID_TAGS[tag]) continue;

      var endTa = findCloseTag(html, i, 'textarea');
      if (endTa) {
        var taContent = html.slice(i, endTa.pos);
        if (taContent) {
          taNode.children.push({ type: 'text', content: decodeEntities(taContent) });
        }
        i = endTa.endPos;
      } else {
        i = len;
      }
      continue;
    }

    // 创建元素节点
    var element = {
      type: 'element',
      tag: tag,
      attrs: attrs,
      children: [],
      style: styleObj
    };

    stack[stack.length - 1].children.push(element);

    // Void 元素或自闭合标签：不入栈
    if (selfClosing || VOID_TAGS[tag]) {
      continue;
    }

    // 入栈
    stack.push(element);
  }

  return {
    root: root,
    styles: styles,
    truncated: truncated,
    nodeCount: nodeCount
  };
}

// ─── 辅助函数 ───

function addText(parent, text) {
  if (!text) return;
  // 合并相邻文本节点
  var children = parent.children;
  if (children.length > 0 && children[children.length - 1].type === 'text') {
    children[children.length - 1].content += text;
  } else {
    children.push({ type: 'text', content: text });
  }
}

/**
 * 找到标签的 > 结束位置（考虑引号内的 >）
 */
function findTagEnd(html, start) {
  var i = start;
  var len = html.length;
  var inQuote = null;

  while (i < len) {
    var ch = html[i];
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      }
    } else {
      if (ch === '"' || ch === "'") {
        inQuote = ch;
      } else if (ch === '>') {
        return i;
      }
    }
    i++;
  }
  return -1;
}

/**
 * 找到指定标签的闭合位置 </tag>
 * @returns {{ pos: number, endPos: number }} pos = 内容结束位置, endPos = 闭合标签之后的位置
 */
function findCloseTag(html, start, tag) {
  var lower = html.toLowerCase();
  var pattern = '</' + tag;
  var pos = lower.indexOf(pattern, start);
  if (pos < 0) return null;
  var gt = html.indexOf('>', pos + pattern.length);
  if (gt < 0) return null;
  return { pos: pos, endPos: gt + 1 };
}

// ─── DOM 树遍历工具 ───

/**
 * 获取元素的纯文本内容
 */
function getTextContent(node) {
  if (!node) return '';
  if (node.type === 'text') return node.content || '';
  if (node.type === 'element' || node.type === 'root') {
    var text = '';
    var children = node.children || [];
    for (var i = 0; i < children.length; i++) {
      text += getTextContent(children[i]);
    }
    return text;
  }
  return '';
}

/**
 * 获取元素的 class 列表
 */
function getClasses(node) {
  if (!node || !node.attrs || !node.attrs.class) return [];
  return node.attrs.class.split(/\s+/).filter(function(c) { return c; });
}

/**
 * 判断元素是否有指定 class
 */
function hasClass(node, className) {
  var classes = getClasses(node);
  return classes.indexOf(className) >= 0;
}

/**
 * 获取元素的 id
 */
function getId(node) {
  return (node && node.attrs && node.attrs.id) || '';
}

module.exports = {
  tokenize: tokenize,
  decodeEntities: decodeEntities,
  parseAttrs: parseAttrs,
  parseStyle: parseStyle,
  getTextContent: getTextContent,
  getClasses: getClasses,
  hasClass: hasClass,
  getId: getId,
  VOID_TAGS: VOID_TAGS,
  BLOCK_TAGS: BLOCK_TAGS,
  INLINE_TAGS: INLINE_TAGS,
  SKIP_TAGS: SKIP_TAGS,
  MAX_NODES: MAX_NODES,
  MAX_DEPTH: MAX_DEPTH
};
