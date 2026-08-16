/**
 * core/parse/index.js - 解析层入口
 *
 * ⚠️ 纯函数模块：不依赖任何 wx API
 * 可在 Worker 和 Node 环境中运行
 *
 * 各格式解析器统一输出 IR (Intermediate Representation)
 * 渲染层只认 IR，不关心原始格式
 *
 * IR 定义：
 * Block =
 *   { type:'heading', level:1..6, text, id }
 *   | { type:'paragraph', text, children:Inline[], id }
 *   | { type:'code', lang, text, raw, id }
 *   | { type:'list', ordered, items:[{children:Inline[], depth}], id }
 *   | { type:'table', header:[], rows:[[Inline]], id }
 *   | { type:'blockquote', children:Block[], id }
 *   | { type:'image', src, alt, w, h, id }
 *   | { type:'hr', id }
 *   | { type:'math', tex, display, id }
 *
 * TOC 项: { blockIndex, level, text, id }
 */

// ─── 解析上限（AGENTS §2.4 防解析炸弹）───
// HTML 侧的上限在 html/tokenizer.js 与 html/postprocess.js 里，
// 这里是 TXT / Markdown / 代码 / JSON 侧的对应上限。
var LIMITS = {
  MAX_BLOCKS: 50000,        // 块数上限，超出截断并提示
  MAX_LINE_CHARS: 20000,    // 单行字符上限（B13：minified JSON/HTML 一行几 MB）
  MAX_BLOCK_CHARS: 100000,  // 单块字符上限（防止一个巨块把 setData 撑爆）
  MAX_TOC: 2000             // 目录条目上限（TXT 启发式标题可能爆量）
};

/**
 * 截断超长单行（B13）
 * 一行几 MB 的 minified 内容会让行级正则和 setData 双双爆炸，
 * 这里只在渲染层面截断，并明确告诉用户被截断了。
 * @param {string} line
 * @returns {string}
 */
function truncateLine(line) {
  if (line.length <= LIMITS.MAX_LINE_CHARS) return line;
  return line.slice(0, LIMITS.MAX_LINE_CHARS) +
    ' …（本行超长，已截断 ' + (line.length - LIMITS.MAX_LINE_CHARS) + ' 字）';
}

/**
 * 给结果补一条截断说明
 */
function markTruncated(result, reason) {
  result.truncated = true;
  result.degraded = (result.degraded || []).concat([{ reason: reason, message: '文档过大，已截断显示' }]);
  return result;
}

// ─── 文本清洗工具 ───

/**
 * 剥 BOM
 */
function stripBOM(text) {
  if (text.charCodeAt(0) === 0xFEFF) {
    return text.slice(1);
  }
  return text;
}

/**
 * 归一换行符（CRLF / CR → LF）
 */
function normalizeLineEndings(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * 清洗零宽字符和控制字符
 * - 移除 BOM、零宽空格(U+200B)、零宽连字(U+200C/200D)
 * - 移除 BOM(U+FEFF)
 * - 保留制表符(\t)和换行(\n)
 * - 其他控制字符替换为空格
 */
function cleanText(text) {
  // 移除零宽字符
  text = text.replace(/[\u200B\u200C\u200D\uFEFF]/g, '');
  // 移除其他控制字符（保留 \t \n）
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  return text;
}

/**
 * 只清洗每行行首/行尾的零宽字符 + 全文控制字符（Edge B16）
 *
 * 与 cleanText 的区别：cleanText 会抹掉正文中间的零宽字符，
 * 而零宽连字在阿拉伯语、天城文等场景是有语义的，不能全文一刀切。
 * 行首零宽字符才是真正的杀手 —— `#​ 标题` 会让 ATX 正则失配。
 * @param {string} text
 * @returns {string}
 */
function cleanZeroWidthEdges(text) {
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  // 行尾
  text = text.replace(/[​‌‍﻿]+$/gm, '');
  // 行首的"块级标记区"：从行首起、由空白与块级标记字符组成的一段。
  // 零宽字符藏在这一段里就会让标记失配（B16 举的例子 `#​ 标题` 正是如此），
  // 而正文中间的零宽字符有语义（RTL、天城文），必须留着。
  return text.replace(/^[\s​‌‍﻿#>*+\-0-9.)\[\]`~|]*/gm, function (seg) {
    return seg.replace(/[​‌‍﻿]/g, '');
  });
}

/**
 * 清洗行首尾空白和零宽字符
 */
function cleanLine(line) {
  return line.replace(/^[\u200B\uFEFF\s]+|[\u200B\uFEFF\s]+$/g, '');
}

// ─── 块 ID 生成器 ───

function createIdGen() {
  let counter = 0;
  return () => 'b' + (counter++);
}

// ─── TXT 标题检测 ───

/**
 * 检测行是否为标题
 * @param {string} line - 清洗后的行
 * @param {string} prevLine - 上一行（空字符串表示空行或文件开头）
 * @param {string} nextLine - 下一行
 * @returns {{ level: number, text: string } | null}
 */
function detectHeading(line, prevLine, nextLine) {
  const trimmed = line.trim();

  // 1. Markdown 风格标题（# ## ### ...）
  const mdMatch = trimmed.match(/^(#{1,6})\s+(.+)/);
  if (mdMatch) {
    return { level: mdMatch[1].length, text: mdMatch[2].trim() };
  }

  // 2. 中文章节标记
  // 第一章 / 第1章 / 第十二回 / 第三节 / 第一部分
  const cnChapter = trimmed.match(/^第[\d一二三四五六七八九十百千零〇两]+[章回节卷部篇](\s.*|$)/);
  if (cnChapter) {
    return { level: 1, text: trimmed };
  }

  // 3. 英文章节标记
  // Chapter 1 / CHAPTER I / Part 1 / Section 1
  const enChapter = trimmed.match(/^(chapter|part|section|prologue|epilogue|preface|序言|前言|引言|附录|后记|尾声)\s*[\dIVXLC]*[:\.\s]/i);
  if (enChapter && trimmed.length < 50) {
    return { level: 1, text: trimmed };
  }

  // 4. 短行标题检测（启发式）
  // 条件：前后为空行、长度 < 30、不含句末标点、不是代码行
  if (prevLine === '' && nextLine === '' && trimmed.length > 0 && trimmed.length < 30) {
    // 含结构性符号的行是代码/配置/数据，不是章节标题。
    // 少了这一条，JSON 片段、日志行、YAML 键值都会被判成标题，
    // 目录里塞满噪音，正文排版也跟着变形。
    if (/[{}\[\]<>=;|`\\]/.test(trimmed)) return null;
    // 不以标点结尾
    if (!/[。，；！？.,;!?…：:]$/.test(trimmed)) {
      // 不是以数字开头的大量数字行（如页码）
      if (!/^\d+$/.test(trimmed)) {
        // 全大写英文（可能是标题）
        if (/^[A-Z\s]+$/.test(trimmed) && trimmed.length > 3) {
          return { level: 2, text: trimmed };
        }
        // 中文短行 + 前后空行 → 可能是标题
        // 但要避免误判：至少含一个中文字符
        if (/[\u4e00-\u9fff]/.test(trimmed)) {
          return { level: 3, text: trimmed };
        }
      }
    }
  }

  return null;
}

// ─── TXT 解析器 ───

/**
 * TXT 解析器（增强版）
 * 按段落分块 + 启发式标题识别 + TOC 生成
 * @param {string} text
 * @returns {{ blocks, toc, images, degraded }}
 */
function parseTxt(text) {
  // 清洗
  text = stripBOM(text);
  text = normalizeLineEndings(text);
  text = cleanText(text);

  const lines = text.split('\n');
  const blocks = [];
  const toc = [];
  const genId = createIdGen();
  let paragraphBuffer = [];
  let prevNonEmptyLine = '';

  let truncated = false;

  const flushParagraph = () => {
    if (paragraphBuffer.length > 0) {
      let text = paragraphBuffer.join('\n');
      if (text.length > LIMITS.MAX_BLOCK_CHARS) {
        text = text.slice(0, LIMITS.MAX_BLOCK_CHARS) + ' …（段落过长，已截断）';
      }
      blocks.push({
        type: 'paragraph',
        text: text,
        children: [{ t: 'text', text }],
        id: genId()
      });
      paragraphBuffer = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    if (blocks.length >= LIMITS.MAX_BLOCKS) {
      truncated = true;
      break;
    }
    const line = truncateLine(cleanLine(lines[i]));

    // 空行：刷新段落
    if (line.trim() === '') {
      flushParagraph();
      prevNonEmptyLine = '';
      continue;
    }

    // 获取上下文行
    const prevLine = (i > 0 && lines[i - 1].trim() !== '') ? prevNonEmptyLine : '';
    const nextLine = (i + 1 < lines.length) ? cleanLine(lines[i + 1]) : '';

    // 标题检测
    const heading = detectHeading(line, prevLine, nextLine);
    if (heading) {
      flushParagraph();
      const id = genId();
      const blockIndex = blocks.length;
      blocks.push({
        type: 'heading',
        level: heading.level,
        text: heading.text,
        children: [{ t: 'text', text: heading.text }],
        id: id
      });
      // TXT 的标题是启发式识别的：对话体小说里每句短白话都可能被当成标题，
      // 目录条目无上限时会把 setData 撑爆，这里封顶
      if (toc.length < LIMITS.MAX_TOC) {
        toc.push({
          blockIndex,
          level: heading.level,
          text: heading.text,
          id: id
        });
      }
      prevNonEmptyLine = line;
      continue;
    }

    // 水平分割线
    if (/^[-=*_~]{3,}$/.test(line.trim())) {
      flushParagraph();
      blocks.push({ type: 'hr', id: genId() });
      prevNonEmptyLine = '';
      continue;
    }

    // 普通文本行
    paragraphBuffer.push(line);
    prevNonEmptyLine = line;
  }
  flushParagraph();

  const result = { blocks, toc, images: [], degraded: [], truncated: false };
  if (truncated) markTruncated(result, 'txt-block-limit');
  return result;
}

/**
 * 解析入口，根据格式分流
 * @param {string} text - 已解码的文本
 * @param {string} format - 格式：txt / markdown / html / json / csv / code / log
 * @returns {{ blocks: Block[], toc: Array, images: Array, degraded: Array }}
 */
function parse(text, format) {
  if (text == null) text = '';
  if (typeof text !== 'string') text = String(text);
  switch (format) {
    case 'txt':
      return parseTxt(text);
    case 'markdown':
    case 'md':
      return parseMarkdown(text);
    case 'html':
    case 'htm':
      return parseHtml(text);
    case 'json':
      return parseJson(text);
    case 'csv':
      return parseCsv(text);
    case 'code':
    case 'log':
    case 'xml':
      return parseCode(text);
    default:
      return parseTxt(text);
  }
}

/**
 * Markdown 解析器（GFM 子集）
 * 支持：标题/段落/列表(嵌套+任务列表)/表格/代码块/引用/图片/链接/分割线/脚注/Front-matter
 * 容错（C2）：任何异常 → 降级 parseTxt，内容零丢失
 */
function parseMarkdown(text) {
  try {
    // 必须在块解析之前清洗（AGENTS §2.5 / Edge B2、B16）：
    // 残留的 BOM 或行首零宽字符会让 `# 标题` 匹配不上 ATX 正则，
    // 表现为"整篇第一个标题莫名其妙变成普通段落"。
    // 之前只有 parseTxt 做了清洗，Markdown 这条路径是漏的。
    text = stripBOM(text);
    text = normalizeLineEndings(text);
    text = cleanZeroWidthEdges(text);

    var mdBlock = require('./md/block.js');
    var result = mdBlock.parseMarkdownBlocks(text);
    // 空文档或异常结果 → 兜底
    if (!result || !result.blocks || result.blocks.length === 0) {
      var txtResult = parseTxt(text);
      txtResult.degraded = (txtResult.degraded || []).concat([{ reason: 'markdown-empty', fallback: 'txt' }]);
      return txtResult;
    }
    return {
      blocks: result.blocks,
      toc: result.toc,
      images: result.images,
      degraded: result.degraded || [],
      frontMeta: result.frontMeta || null
    };
  } catch (e) {
    console.warn('[parse] Markdown 解析异常，降级为 TXT:', e && e.message);
    var fallback = parseTxt(text);
    fallback.degraded = (fallback.degraded || []).concat([{ reason: 'markdown-error', error: e && e.message, fallback: 'txt' }]);
    return fallback;
  }
}

/**
 * HTML 解析器（Phase 3）
 * 流程：脚本检测（原始 HTML）→ 消毒 → 预处理 + DOM 解析 → IR
 * 注意：脚本降级检测必须在 sanitize 之前，因为 sanitize 会移除 <script> 标签
 */
function parseHtml(text) {
  try {
    if (text == null) text = '';
    if (typeof text !== 'string') text = String(text);

    // 清洗文本
    text = stripBOM(text);
    text = normalizeLineEndings(text);
    text = cleanText(text);

    var sanitizeMod = require('../sanitize/index.js');
    var converter = require('./html/converter.js');
    var degrade = require('./html/degrade.js');

    // 1. 在原始 HTML 上检测脚本库（Chart.js/Mermaid/reveal.js 等）
    //    必须在 sanitize 前，因为 sanitize 会移除 <script> 标签
    var scriptInfo = degrade.detectScripts(text);

    // 2. 消毒（剥离 script/iframe/on*/javascript: 等）
    var sanitizeResult = sanitizeMod.sanitize(text);
    var cleanHtml = sanitizeResult.html;

    // 3. 转换为 IR（传入预计算的 scriptInfo）
    var result = converter.convert(cleanHtml, { scriptInfo: scriptInfo });

    // 4. 记录消毒信息。
    //    只有真正的危险内容才值得提示用户：<meta charset>、<link> 这类
    //    是常规清理，几乎每份 HTML 都有，报出来只会变成恒定噪音，
    //    反而稀释了「这份文档里有脚本被拦掉了」这种真信号。
    if (sanitizeResult.removed && sanitizeResult.removed.length > 0) {
      var NOTABLE = { script: 1, iframe: 1, form: 1, object: 1, embed: 1, applet: 1, 'meta-refresh': 1 };
      var notable = sanitizeResult.removed.filter(function (r) {
        return NOTABLE[r] || String(r).indexOf('dangerous-url') === 0;
      });
      result.degraded = (result.degraded || []).concat([{
        reason: 'sanitized',
        message: notable.length > 0
          ? '为安全起见已移除 ' + notable.length + ' 处可执行内容（脚本 / 内嵌框架等）'
          : '',
        removed: sanitizeResult.removed,
        notableCount: notable.length
      }]);
    }

    return {
      blocks: result.blocks,
      toc: result.toc,
      images: result.images,
      degraded: result.degraded || [],
      hasBase64: result.hasBase64,
      hasNetworkImage: result.hasNetworkImage,
      truncated: result.truncated
    };
  } catch (e) {
    console.warn('[parse] HTML 解析异常，降级为 TXT:', e && e.message);
    var fallback = parseTxt(text);
    fallback.degraded = (fallback.degraded || []).concat([{
      reason: 'html-error',
      error: e && e.message,
      fallback: 'txt'
    }]);
    return fallback;
  }
}

/**
 * JSON 美化解析（Phase 3 / P2）
 */
function parseJson(text) {
  let formatted;
  try {
    formatted = JSON.stringify(JSON.parse(text), null, 2);
  } catch (e) {
    // 解析失败降级为纯文本
    return parseTxt(text);
  }
  // 美化后的 JSON 一律走代码分块管线：
  // 整份塞进单个 block 会让 setData 直接超限（D12），
  // 而 raw 原文再复制一份是纯粹的内存浪费。
  const result = parseCode(formatted);
  result.blocks.forEach(function (b) { b.lang = 'json'; });
  return result;
}

/**
 * CSV 解析（Phase 3 / P2）
 */
function parseCsv(text) {
  // Phase 3: CSV → table IR
  return parseTxt(text);
}

/**
 * 代码/日志解析
 */
function parseCode(text) {
  // 与 parseTxt 一致地做前置清洗：不归一换行会让 CRLF 文件每行尾多一个 \r
  text = stripBOM(text);
  text = normalizeLineEndings(text);

  const lines = text.split('\n');
  const blocks = [];
  const CHUNK_SIZE = 50;
  let counter = 0;
  let truncated = false;

  for (let i = 0; i < lines.length; i += CHUNK_SIZE) {
    if (blocks.length >= LIMITS.MAX_BLOCKS) {
      truncated = true;
      break;
    }
    const chunk = lines.slice(i, Math.min(i + CHUNK_SIZE, lines.length))
      .map(truncateLine);
    // raw 曾与 text 存同一份内容 —— 两份都会进 setData，白白翻倍
    blocks.push({
      type: 'code',
      lang: '',
      text: chunk.join('\n'),
      id: 'b' + (counter++)
    });
  }

  const result = { blocks, toc: [], images: [], degraded: [], truncated: false };
  if (truncated) markTruncated(result, 'code-block-limit');
  return result;
}

module.exports = {
  parse,
  parseTxt,
  parseMarkdown,
  parseHtml,
  parseJson,
  parseCsv,
  parseCode,
  stripBOM,
  normalizeLineEndings,
  cleanText,
  cleanZeroWidthEdges,
  truncateLine,
  LIMITS
};
