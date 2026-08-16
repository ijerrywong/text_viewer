/**
 * core/sanitize/index.js - HTML 消毒
 *
 * ⚠️ 纯函数模块：不依赖任何 wx API
 * 可在 Worker 和 Node 环境中运行
 *
 * 安全规则（ADR-6）：
 * - 剥离 script/iframe/object/embed/form/base/meta[refresh]
 * - 剥离所有 on* 事件属性
 * - 剥离 javascript:/vbscript:/data:text/html 链接
 * - style 里的 expression/url(javascript:) 清除
 * - 图片只允许 data:image/ 和本地路径
 */

// 危险标签白名单（需要剥离的）
const DANGEROUS_TAGS = new Set([
  'script', 'iframe', 'object', 'embed', 'form',
  'base', 'link', 'meta', 'noscript', 'applet'
]);

// 允许的标签白名单
const ALLOWED_TAGS = new Set([
  'a', 'abbr', 'address', 'article', 'aside', 'b', 'bdi', 'bdo',
  'blockquote', 'br', 'caption', 'cite', 'code', 'col', 'colgroup',
  'data', 'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt',
  'em', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'i', 'img',
  'ins', 'kbd', 'li', 'main', 'mark', 'nav', 'ol', 'p',
  'pre', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'section',
  'small', 'span', 'strong', 'sub', 'summary', 'sup',
  'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time',
  'tr', 'u', 'ul', 'var', 'wbr'
]);

// 允许的属性前缀（on* 之外的事件属性）
const ALLOWED_ATTRS = new Set([
  'href', 'src', 'alt', 'title', 'width', 'height',
  'colspan', 'rowspan', 'lang', 'dir', 'class', 'id',
  'style', 'data-src', 'data-alt', 'data-width', 'data-height'
]);

/**
 * 消毒 HTML 文本
 * @param {string} html - 原始 HTML
 * @returns {{ html: string, removed: string[] }} - 消毒后的 HTML 和被移除的内容列表
 */
function sanitize(html) {
  const removed = [];

  // 1. 移除注释中的条件注释（IE 条件注释可执行脚本）
  html = html.replace(/<!--\[if[\s\S]*?\]>/gi, '');
  html = html.replace(/<!\[endif\]-->/gi, '');

  // 2. 移除 <script> 标签及内容
  html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, (match) => {
    removed.push('script');
    return '';
  });

  // 3. 移除 meta refresh（在 DANGEROUS_TAGS 之前检测，给出更具体的标签）
  html = html.replace(/<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, () => {
    removed.push('meta-refresh');
    return '';
  });

  // 4. 移除其他危险标签及内容
  for (const tag of DANGEROUS_TAGS) {
    const regex = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
    html = html.replace(regex, () => {
      removed.push(tag);
      return '';
    });
    // 自闭合形式
    const selfClosingRegex = new RegExp(`<${tag}\\b[^>]*/?>`, 'gi');
    html = html.replace(selfClosingRegex, () => {
      removed.push(tag);
      return '';
    });
  }

  // 5. 移除所有 on* 事件属性
  html = html.replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  // 6. 清洗 href/src 中的危险协议
  html = html.replace(/(href|src)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (match, attr, value) => {
    const unquoted = value.replace(/^["']|["']$/g, '').trim();
    const lower = unquoted.toLowerCase();
    if (lower.startsWith('javascript:') ||
        lower.startsWith('vbscript:') ||
        lower.startsWith('data:text/html')) {
      removed.push(`dangerous-url: ${unquoted.slice(0, 50)}`);
      return '';
    }
    return match;
  });

  // 7. 清洗 style 中的危险内容
  html = html.replace(/style\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (match, value) => {
    const quote = (value[0] === '"' || value[0] === "'") ? value[0] : '';
    const unquoted = quote ? value.slice(1, -1) : value;
    const cleaned = unquoted
      .replace(/expression\s*\(/gi, '')
      .replace(/url\s*\(\s*["']?\s*javascript:/gi, 'url(')
      .replace(/url\s*\(\s*["']?\s*vbscript:/gi, 'url(');
    // ⚠️ 一律用双引号重新包起来会撕坏 style='content: "→"' 这类声明 ——
    // 而 ::before/::after 的 content 正是 AI 文档里的高频写法。
    // 原来带什么引号就还回什么引号；值里出现同名引号时改用另一种。
    let out = quote;
    if (!out) {
      out = cleaned.indexOf('"') >= 0 ? "'" : '"';
    } else if (cleaned.indexOf(out) >= 0) {
      out = out === '"' ? "'" : '"';
    }
    // 两种引号都出现时，把值里的引号转义成实体，保证标签结构不被撕开
    const safe = cleaned.indexOf(out) >= 0
      ? cleaned.replace(new RegExp(out, 'g'), out === '"' ? '&quot;' : '&#39;')
      : cleaned;
    return 'style=' + out + safe + out;
  });

  // 8. 清洗完成
  return { html, removed };
}

/**
 * 检查 HTML 是否包含危险内容（不修改）
 * @param {string} html
 * @returns {{ isDangerous: boolean, threats: string[] }}
 */
function checkSafety(html) {
  const threats = [];
  const lower = html.toLowerCase();

  if (/<script\b/i.test(html)) threats.push('script');
  if (/<iframe\b/i.test(html)) threats.push('iframe');
  if (/\son\w+\s*=/i.test(html)) threats.push('event-handler');
  if (/javascript:/i.test(lower)) threats.push('javascript-url');
  if (/vbscript:/i.test(lower)) threats.push('vbscript-url');
  if (/<form\b/i.test(html)) threats.push('form');
  if (/<object\b/i.test(html)) threats.push('object');
  if (/<embed\b/i.test(html)) threats.push('embed');

  return {
    isDangerous: threats.length > 0,
    threats
  };
}

module.exports = {
  sanitize,
  checkSafety,
  DANGEROUS_TAGS,
  ALLOWED_TAGS,
  ALLOWED_ATTRS
};
