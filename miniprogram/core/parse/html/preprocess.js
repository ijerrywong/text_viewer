/**
 * core/parse/html/preprocess.js - CSS 预处理层
 *
 * ⚠️ 纯函数模块：不依赖任何 wx API
 *
 * 在 HTML 送入 IR 转换器之前执行以下预处理：
 * 1. 解析 <style> CSS 规则 → 选择器 + 声明
 * 2. CSS 变量求值（C18）：收集 :root{} 定义，替换 var()
 * 3. ::before/::after 合成为真实子节点（C19）
 * 4. 视口钳制注入（C20）：* { max-width:100%; box-sizing:border-box }
 * 5. position:fixed/sticky → static（C21）
 *
 * 用法：
 *   var ctx = preprocess(html, styles);
 *   // ctx.cssRules: 解析后的 CSS 规则数组
 *   // ctx.cssVars: CSS 变量映射表
 *   // ctx.viewportGuard: 视口钳制 CSS 字符串
 */

// ─── CSS 规则解析 ───

/**
 * 解析 CSS 文本为规则数组
 * @param {string} cssText - CSS 文本
 * @returns {Array<{ selector: string, declarations: Object }>}
 */
function parseCSS(cssText) {
  if (!cssText) return [];
  var rules = [];
  var i = 0;
  var len = cssText.length;

  while (i < len) {
    // 跳过注释
    if (cssText[i] === '/' && cssText[i + 1] === '*') {
      var endComment = cssText.indexOf('*/', i + 2);
      i = endComment < 0 ? len : endComment + 2;
      continue;
    }

    // 跳过空白
    while (i < len && /\s/.test(cssText[i])) i++;
    if (i >= len) break;

    // @media / @import / @keyframes 等跳过
    if (cssText[i] === '@') {
      var braceIdx = cssText.indexOf('{', i);
      if (braceIdx < 0) {
        // @import 等无大括号的，跳到分号
        var semiIdx = cssText.indexOf(';', i);
        i = semiIdx < 0 ? len : semiIdx + 1;
        continue;
      }
      // 检查是否是 @media
      var atRule = cssText.slice(i, braceIdx).trim();
      if (atRule.indexOf('@media') === 0) {
        // 找到匹配的 }
        var depth = 1;
        var j = braceIdx + 1;
        while (j < len && depth > 0) {
          if (cssText[j] === '{') depth++;
          else if (cssText[j] === '}') depth--;
          j++;
        }
        // 递归解析 @media 内的规则（简化：直接解析内部）
        var innerCSS = cssText.slice(braceIdx + 1, j - 1);
        var innerRules = parseCSS(innerCSS);
        for (var r = 0; r < innerRules.length; r++) {
          rules.push(innerRules[r]);
        }
        i = j;
        continue;
      }
      // 其他 @ 规则（@keyframes 等）跳过
      var depth2 = 1;
      var j2 = braceIdx + 1;
      while (j2 < len && depth2 > 0) {
        if (cssText[j2] === '{') depth2++;
        else if (cssText[j2] === '}') depth2--;
        j2++;
      }
      i = j2;
      continue;
    }

    // 读取选择器
    var selStart = i;
    while (i < len && cssText[i] !== '{') i++;
    if (i >= len) break;
    var selector = cssText.slice(selStart, i).trim();
    i++; // 跳过 {

    // 读取声明
    var declStart = i;
    while (i < len && cssText[i] !== '}') i++;
    if (i >= len) break;
    var declStr = cssText.slice(declStart, i).trim();
    i++; // 跳过 }

    if (!selector || !declStr) continue;

    // 解析声明
    var declarations = {};
    var parts = declStr.split(';');
    for (var p = 0; p < parts.length; p++) {
      var part = parts[p].trim();
      if (!part) continue;
      var colonIdx = part.indexOf(':');
      if (colonIdx < 0) continue;
      var prop = part.slice(0, colonIdx).trim().toLowerCase();
      var val = part.slice(colonIdx + 1).trim();
      if (prop && val) {
        declarations[prop] = val;
      }
    }

    // 处理多个选择器（逗号分隔）
    var selectors = selector.split(',');
    for (var s = 0; s < selectors.length; s++) {
      var sel = selectors[s].trim();
      if (sel) {
        rules.push({ selector: sel, declarations: declarations });
      }
    }
  }

  return rules;
}

// ─── CSS 变量求值（C18）───

/**
 * 从 CSS 规则中收集 CSS 变量定义
 * @param {Array} rules - 解析后的 CSS 规则
 * @returns {Object} 变量名→值映射 { '--primary': '#4f46e5', ... }
 */
function collectCSSVars(rules) {
  var vars = {};
  for (var i = 0; i < rules.length; i++) {
    var rule = rules[i];
    // :root 或 html 选择器中定义的变量
    if (rule.selector === ':root' || rule.selector === 'html') {
      for (var prop in rule.declarations) {
        if (rule.declarations.hasOwnProperty(prop) && prop.indexOf('--') === 0) {
          vars[prop] = rule.declarations[prop];
        }
      }
    }
  }
  return vars;
}

/**
 * 替换 CSS 值中的 var() 引用
 * @param {string} value - CSS 值，如 'var(--primary)' 或 '1px solid var(--border-color)'
 * @param {Object} vars - 变量映射表
 * @returns {string} 替换后的值
 */
function resolveVars(value, vars) {
  if (!value || value.indexOf('var(') < 0) return value;
  return value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\s*\)/g, function(match, varName, fallback) {
    if (vars[varName]) {
      // 递归解析（变量可能引用另一个变量）
      return resolveVars(vars[varName], vars);
    }
    if (fallback) {
      return fallback.trim();
    }
    return ''; // 变量未定义且无 fallback
  });
}

/**
 * 对所有 CSS 规则的声明值进行变量求值
 * @param {Array} rules - CSS 规则数组
 * @param {Object} vars - 变量映射表
 */
function resolveVarsInRules(rules, vars) {
  for (var i = 0; i < rules.length; i++) {
    var decls = rules[i].declarations;
    for (var prop in decls) {
      if (decls.hasOwnProperty(prop)) {
        decls[prop] = resolveVars(decls[prop], vars);
      }
    }
  }
}

// ─── 伪元素合成（C19）───

/**
 * 从 CSS 规则中提取 ::before/::after 的 content 声明
 * @param {Array} rules - CSS 规则数组
 * @returns {Array<{ selector: string, pseudo: 'before'|'after', content: string, declarations: Object }>}
 */
function extractPseudoElements(rules) {
  var pseudos = [];
  for (var i = 0; i < rules.length; i++) {
    var rule = rules[i];
    // 匹配 ::before, :before, ::after, :after
    var pseudoMatch = rule.selector.match(/^(.+?)::?(before|after)$/);
    if (pseudoMatch) {
      var baseSelector = pseudoMatch[1].trim();
      var pseudo = pseudoMatch[2];
      var content = rule.declarations['content'] || '';
      // 去除 content 的引号
      content = content.replace(/^["']|["']$/g, '');
      if (content && content !== 'none') {
        var pseudoDecls = {};
        for (var prop in rule.declarations) {
          if (rule.declarations.hasOwnProperty(prop) && prop !== 'content') {
            pseudoDecls[prop] = rule.declarations[prop];
          }
        }
        pseudos.push({
          selector: baseSelector,
          pseudo: pseudo,
          content: content,
          declarations: pseudoDecls
        });
      }
    }
  }
  return pseudos;
}

// ─── 视口钳制注入（C20）───

/**
 * 生成视口钳制 CSS 规则
 * 注入优先级最低的兜底：* { max-width:100%; box-sizing:border-box }
 * 以及钳制根容器固定宽度
 * @returns {string}
 */
function getViewportGuard() {
  return '* { max-width: 100% !important; box-sizing: border-box !important; } ' +
           'html, body { max-width: 100% !important; overflow-x: hidden !important; } ' +
           'img, video, table, pre { max-width: 100% !important; } ' +
           'div, section, article, main, header, footer, nav, aside, figure { max-width: 100% !important; }';
}

// ─── fixed/sticky → static（C21）───

/**
 * 在 CSS 规则和内联样式中将 position:fixed/sticky 降级为 static
 * @param {Array} rules - CSS 规则数组（原地修改）
 */
function degradeFixedSticky(rules) {
  for (var i = 0; i < rules.length; i++) {
    var decls = rules[i].declarations;
    if (decls['position'] === 'fixed' || decls['position'] === 'sticky') {
      decls['position'] = 'static';
    }
  }
}

/**
 * 降级内联样式中的 position
 * @param {Object} style - 内联样式对象
 */
function degradeFixedStickyInline(style) {
  if (!style) return;
  if (style['position'] === 'fixed' || style['position'] === 'sticky') {
    style['position'] = 'static';
  }
}

// ─── 选择器匹配（简化版）───

/**
 * 检查元素是否匹配简单选择器
 * 支持：tag, .class, #id, tag.class, .class.class, tag#id.class
 * @param {Object} node - DOM 节点
 * @param {string} selector - CSS 选择器（简单，不含组合器）
 * @returns {boolean}
 */
function matchesSimpleSelector(node, selector) {
  if (!node || node.type !== 'element' || !selector) return false;

  // 解析选择器
  var tag = '';
  var classes = [];
  var id = '';

  var remaining = selector;
  // 提取 tag
  var tagMatch = remaining.match(/^([a-zA-Z][\w-]*)/);
  if (tagMatch) {
    tag = tagMatch[1].toLowerCase();
    remaining = remaining.slice(tagMatch[0].length);
  }
  // 提取 #id 和 .class
  var classIdMatches = remaining.match(/[.#][\w-]+/g);
  if (classIdMatches) {
    for (var i = 0; i < classIdMatches.length; i++) {
      if (classIdMatches[i][0] === '#') {
        id = classIdMatches[i].slice(1);
      } else {
        classes.push(classIdMatches[i].slice(1));
      }
    }
  }

  // 检查 tag
  if (tag && node.tag !== tag) return false;
  // 检查 id
  if (id && (!node.attrs || node.attrs.id !== id)) return false;
  // 检查 classes
  if (classes.length > 0) {
    var nodeClasses = (node.attrs && node.attrs.class) ? node.attrs.class.split(/\s+/) : [];
    for (var c = 0; c < classes.length; c++) {
      if (nodeClasses.indexOf(classes[c]) < 0) return false;
    }
  }

  return true;
}

/**
 * 检查元素是否匹配选择器（含后代选择器）
 * 支持：a b, a > b, a.b, #id, tag 等
 * @param {Object} node - DOM 节点
 * @param {string} selector - CSS 选择器
 * @param {Array} ancestorPath - 从 root 到当前节点的路径（不含当前节点）
 * @returns {boolean}
 */
function matchesSelector(node, selector, ancestorPath) {
  if (!selector) return false;

  // 拆分后代选择器
  var parts = selector.split(/\s+/).filter(function(s) { return s; });
  if (parts.length === 0) return false;

  // 最后一个部分必须匹配当前节点
  var lastPart = parts[parts.length - 1];
  if (!matchesSimpleSelector(node, lastPart)) return false;

  // 如果只有一部分，直接返回
  if (parts.length === 1) return true;

  // 检查祖先是否匹配前面的部分（从右到左）
  var ancestorIdx = ancestorPath.length - 1;
  for (var p = parts.length - 2; p >= 0; p--) {
    var matched = false;
    while (ancestorIdx >= 0) {
      if (matchesSimpleSelector(ancestorPath[ancestorIdx], parts[p])) {
        matched = true;
        ancestorIdx--;
        break;
      }
      ancestorIdx--;
    }
    if (!matched) return false;
  }

  return true;
}

// ─── 主预处理入口 ───

/**
 * CSS 预处理主函数
 * @param {string} html - 原始 HTML（用于检测 Tailwind CDN）
 * @param {Array<string>} styles - 从 <style> 标签提取的 CSS 文本数组
 * @returns {{
 *   rules: Array<{ selector, declarations }>,
 *   vars: Object,
 *   pseudos: Array,
 *   viewportGuard: string,
 *   hasTailwind: boolean
 * }}
 */
function preprocess(html, styles) {
  var cssText = (styles || []).join('\n');

  // 1. 解析 CSS 规则
  var rules = parseCSS(cssText);

  // 2. 收集 CSS 变量
  var vars = collectCSSVars(rules);

  // 3. 变量求值（替换所有规则中的 var()）
  resolveVarsInRules(rules, vars);

  // 4. 提取伪元素
  var pseudos = extractPseudoElements(rules);

  // 5. 降级 fixed/sticky
  degradeFixedSticky(rules);

  // 6. 视口钳制
  var viewportGuard = getViewportGuard();

  // 7. 检测 Tailwind
  var tw = require('./tailwind.js');
  var hasTailwind = tw.hasTailwind(html || '');

  return {
    rules: rules,
    vars: vars,
    pseudos: pseudos,
    viewportGuard: viewportGuard,
    hasTailwind: hasTailwind
  };
}

module.exports = {
  preprocess: preprocess,
  parseCSS: parseCSS,
  collectCSSVars: collectCSSVars,
  resolveVars: resolveVars,
  resolveVarsInRules: resolveVarsInRules,
  extractPseudoElements: extractPseudoElements,
  getViewportGuard: getViewportGuard,
  degradeFixedSticky: degradeFixedSticky,
  degradeFixedStickyInline: degradeFixedStickyInline,
  matchesSimpleSelector: matchesSimpleSelector,
  matchesSelector: matchesSelector
};
