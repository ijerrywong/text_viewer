/**
 * core/detect/index.js - 类型识别 + 编码识别
 *
 * ⚠️ 纯函数模块：不依赖任何 wx API
 * 可在 Worker 和 Node 环境中运行
 *
 * 识别顺序（编码）：
 * BOM → HTML <meta charset> → UTF-8 合法性状态机 → GB18030/Big5 打分 → 默认 UTF-8
 *
 * 识别顺序（格式）：
 * 扩展名 + 魔数(magic bytes) + 内容嗅探
 */

// 阈值的唯一定义处：core/tokens/limits.js
var LIMITS = require('../tokens/limits.js');

/**
 * 检测 BOM 并返回编码
 * @param {Uint8Array} bytes - 文件头部字节
 * @returns {{ encoding: string|null, bomLength: number }}
 */
function detectBOM(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return { encoding: 'UTF-8', bomLength: 3 };
  }
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
    return { encoding: 'UTF-16LE', bomLength: 2 };
  }
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
    return { encoding: 'UTF-16BE', bomLength: 2 };
  }
  return { encoding: null, bomLength: 0 };
}

/**
 * 从 HTML 内容中提取 <meta charset>
 * @param {string} text - 已解码的文本（前 1024 字节即可）
 * @returns {string|null} - 编码名
 */
function detectMetaCharset(text) {
  // 匹配 <meta charset="xxx"> 或 <meta http-equiv="content-type" content="text/html; charset=xxx">
  const match = text.match(/<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i);
  if (match) {
    const enc = match[1].toLowerCase();
    // 归一化编码名
    if (enc === 'gb2312' || enc === 'gbk' || enc === 'gb18030') return 'GB18030';
    if (enc === 'big5') return 'Big5';
    if (enc === 'utf-8' || enc === 'utf8') return 'UTF-8';
    if (enc === 'utf-16' || enc === 'utf16') return 'UTF-16LE';
    return enc.toUpperCase();
  }
  return null;
}

/**
 * UTF-8 合法性检查（状态机）
 * @param {Uint8Array} bytes - 字节数组
 * @param {number} maxCheck - 最多检查的字节数（默认前 8KB）
 * @returns {boolean} - 是否为合法 UTF-8
 */
function isValidUtf8(bytes, maxCheck = 8192) {
  const len = Math.min(bytes.length, maxCheck);
  let i = 0;
  let invalidCount = 0;
  const threshold = len * 0.01; // 允许 1% 的无效字节

  while (i < len) {
    const b = bytes[i];
    if (b < 0x80) {
      // ASCII
      i++;
    } else if (b >= 0xC2 && b <= 0xDF) {
      // 2 字节序列
      if (i + 1 < len && (bytes[i + 1] & 0xC0) === 0x80) {
        i += 2;
      } else {
        invalidCount++;
        i++;
      }
    } else if (b >= 0xE0 && b <= 0xEF) {
      // 3 字节序列
      if (i + 2 < len && (bytes[i + 1] & 0xC0) === 0x80 && (bytes[i + 2] & 0xC0) === 0x80) {
        i += 3;
      } else {
        invalidCount++;
        i++;
      }
    } else if (b >= 0xF0 && b <= 0xF4) {
      // 4 字节序列
      if (i + 3 < len && (bytes[i + 1] & 0xC0) === 0x80 &&
          (bytes[i + 2] & 0xC0) === 0x80 && (bytes[i + 3] & 0xC0) === 0x80) {
        i += 4;
      } else {
        invalidCount++;
        i++;
      }
    } else {
      // 无效的 UTF-8 起始字节
      invalidCount++;
      i++;
    }
  }

  return invalidCount <= threshold;
}

/**
 * GB18030 / Big5 启发式打分（增强版）
 * 通过双字节区有效字符出现频率 + 常见字符加权来判断
 * @param {Uint8Array} bytes - 字节数组
 * @param {number} maxCheck - 最多检查的字节数
 * @returns {{ gb18030: number, big5: number }} - 各编码的置信度分数
 */
function heuristicScore(bytes, maxCheck = 8192) {
  const len = Math.min(bytes.length, maxCheck);
  let gb18030Score = 0;
  let big5Score = 0;
  let gb18030Pairs = 0;
  let big5Pairs = 0;
  let gbkOnlyPairs = 0; // GBK 独有范围（Big5 不覆盖）
  let i = 0;

  while (i < len - 1) {
    const b1 = bytes[i];
    const b2 = bytes[i + 1];

    // GB18030 四字节区
    if (b1 >= 0x81 && b1 <= 0xFE && b2 >= 0x30 && b2 <= 0x39 && i + 3 < len) {
      const b3 = bytes[i + 2];
      const b4 = bytes[i + 3];
      if (b3 >= 0x81 && b3 <= 0xFE && b4 >= 0x30 && b4 <= 0x39) {
        gb18030Score += 3;
        gb18030Pairs++;
        gbkOnlyPairs++; // 四字节是 GB18030 独有
        i += 4;
        continue;
      }
    }

    // 判断双字节对的范围
    if (b1 >= 0x81 && b1 <= 0xFE) {
      const validGbkTrail = (b2 >= 0x40 && b2 <= 0x7E) || (b2 >= 0x80 && b2 <= 0xFE);
      const validBig5Lead = b1 >= 0xA1 && b1 <= 0xF9;
      const validBig5Trail = (b2 >= 0x40 && b2 <= 0x7E) || (b2 >= 0xA1 && b2 <= 0xFE);

      if (validGbkTrail) {
        gb18030Pairs++;
        // GBK 常用汉字区加权
        if (b1 >= 0xB0 && b1 <= 0xF7) {
          gb18030Score += 2;
        } else {
          gb18030Score += 1;
        }

        // 检查是否是 GBK 独有范围（Big5 不覆盖）
        // Big5 不覆盖：b1: 0x81-0xA0, 或 b2: 0x80-0xA0
        if (!validBig5Lead || !validBig5Trail) {
          gbkOnlyPairs++;
        }

        // Big5 范围内
        if (validBig5Lead && validBig5Trail) {
          big5Pairs++;
          if (b1 >= 0xA4 && b1 <= 0xC8) {
            big5Score += 2;
          } else {
            big5Score += 1;
          }
        }

        i += 2;
        continue;
      }
    }

    i++;
  }

  // 关键判别逻辑：
  // 如果有 GBK 独有字节对，则一定是 GBK（Big5 不可能产生这些字节）
  if (gbkOnlyPairs > 0) {
    // GBK 确认，清零 Big5 分数
    return { gb18030: gb18030Score, big5: 0 };
  }

  // 没有 GBK 独有字节对 + 有双字节对 → 可能是 Big5 也可能是 GBK
  // 保留两个分数，由 detectEncodingDetailed 的加权比较决定
  // Big5 的 common range (0xA4-0xC8) 给了更高权重，
  // GBK 的 common range (0xB0-0xF7) 也给了更高权重，
  // 实际上谁的分高就偏向谁
  if (gb18030Pairs < 5 && big5Pairs < 5) {
    return { gb18030: 0, big5: 0 };
  }

  return { gb18030: gb18030Score, big5: big5Score };
}

/**
 * 检测二进制文件（Edge B14）
 * 通过 NUL 字节占比和无效 UTF-8 占比判断
 * @param {Uint8Array} bytes
 * @returns {boolean} - 是否为二进制
 */
function isBinary(bytes, maxCheck = 8192) {
  const len = Math.min(bytes.length, maxCheck);
  if (len === 0) return false;

  let nullCount = 0;
  for (let i = 0; i < len; i++) {
    if (bytes[i] === 0) nullCount++;
  }

  // NUL 字节占比 > 5% 判为二进制
  return nullCount / len > 0.05;
}

/**
 * 综合编码识别
 * @param {Uint8Array} bytes - 文件字节
 * @param {string} [metaCharsetText] - 从 HTML meta 提取的编码声明（可选）
 * @returns {{ encoding: string, confidence: number, bomLength: number }}
 */
function detectEncoding(bytes, metaCharsetText) {
  // 1. BOM 优先
  const bom = detectBOM(bytes);
  if (bom.encoding) {
    return { encoding: bom.encoding, confidence: 1.0, bomLength: bom.bomLength };
  }

  // 2. HTML <meta charset>（仅当传入已解码文本时）
  if (metaCharsetText) {
    const meta = detectMetaCharset(metaCharsetText);
    if (meta) {
      return { encoding: meta, confidence: 0.9, bomLength: 0 };
    }
  }

  // 3. UTF-8 合法性
  if (isValidUtf8(bytes)) {
    return { encoding: 'UTF-8', confidence: 0.8, bomLength: 0 };
  }

  // 4. GB18030 / Big5 启发式打分
  const scores = heuristicScore(bytes);
  if (scores.gb18030 > 0 || scores.big5 > 0) {
    if (scores.gb18030 > scores.big5) {
      return { encoding: 'GB18030', confidence: 0.7, bomLength: 0 };
    } else {
      return { encoding: 'Big5', confidence: 0.7, bomLength: 0 };
    }
  }

  // 5. 默认 UTF-8
  return { encoding: 'UTF-8', confidence: 0.3, bomLength: 0 };
}

/**
 * 格式识别（扩展名 + 内容嗅探）
 * @param {string} name - 文件名
 * @param {string} [textContent] - 已解码的文本内容（前 1024 字符即可）
 * @returns {{ format: string, confidence: number }}
 */
function detectFormat(name, textContent) {
  // 扩展名识别
  const dotIdx = name ? name.lastIndexOf('.') : -1;
  const ext = dotIdx > 0 ? name.slice(dotIdx + 1).toLowerCase() : '';

  const extMap = {
    'md': 'markdown',
    'markdown': 'markdown',
    'html': 'html',
    'htm': 'html',
    'txt': 'txt',
    'json': 'json',
    'csv': 'csv',
    'log': 'log',
    'xml': 'xml',
    'js': 'code',
    'ts': 'code',
    'py': 'code',
    'java': 'code',
    'c': 'code',
    'cpp': 'code',
    'go': 'code',
    'rs': 'code',
    'rb': 'code',
    'php': 'code',
    'sh': 'code',
    'yml': 'code',
    'yaml': 'code',
    'toml': 'code',
    'ini': 'code',
    'conf': 'code'
  };

  // 内容嗅探（扩展名与内容不符时，内容优先，Edge A4）
  if (textContent) {
    const prefix = textContent.slice(0, 512).trim();

    // HTML 嗅探
    if (/^<!doctype\s+html/i.test(prefix) ||
        /^<html/i.test(prefix) ||
        /^<head/i.test(prefix) ||
        /^<body/i.test(prefix) ||
        /^<div/i.test(prefix) && /<\/div>/i.test(textContent.slice(0, 2048))) {
      return { format: 'html', confidence: 0.9 };
    }

    // Markdown 嗅探
    if (/^#{1,6}\s+/m.test(prefix) ||
        /^\s*[-*+]\s+/m.test(prefix) ||
        /```[\s\S]*?```/.test(textContent.slice(0, 2048)) ||
        /^\|.+\|$/m.test(prefix)) {
      return { format: 'markdown', confidence: 0.85 };
    }

    // JSON 嗅探
    // 只在内容不大时才真的 JSON.parse：调用方一般只传前 2KB，
    // 但万一有人传了整份 10MB 文档进来，这里会白白解析一遍再丢掉。
    if (/^[\s]*[\[{]/.test(prefix)) {
      if (textContent.length <= LIMITS.JSON_SNIFF_MAX_BYTES) {
        try {
          JSON.parse(textContent);
          return { format: 'json', confidence: 0.95 };
        } catch (e) {
          // 不是合法 JSON（也可能只是被截断了），继续按扩展名判断
        }
      }
    }
  }

  // 回退到扩展名
  if (ext && extMap[ext]) {
    return { format: extMap[ext], confidence: 0.7 };
  }

  // 无扩展名 + 无内容嗅探结果 → 默认 txt
  return { format: 'txt', confidence: 0.3 };
}

/**
 * 综合编码识别（增强版，返回更多诊断信息）
 * @param {Uint8Array} bytes - 文件字节
 * @param {string} [metaCharsetText] - 从 HTML meta 提取的编码声明（可选）
 * @returns {{ encoding: string, confidence: number, bomLength: number, scores: Object }}
 */
function detectEncodingDetailed(bytes, metaCharsetText) {
  // 1. BOM 优先
  const bom = detectBOM(bytes);
  if (bom.encoding) {
    return { encoding: bom.encoding, confidence: 1.0, bomLength: bom.bomLength, scores: {} };
  }

  // 2. HTML <meta charset>
  if (metaCharsetText) {
    const meta = detectMetaCharset(metaCharsetText);
    if (meta) {
      return { encoding: meta, confidence: 0.9, bomLength: 0, scores: {} };
    }
  }

  // 3. UTF-8 合法性
  if (isValidUtf8(bytes)) {
    // 进一步检查是否包含 CJK 字符（有 CJK 的 UTF-8 更可信）
    // 只看头部：整份 some() 在纯英文大文件上会把几十 MB 全扫一遍才得出 false
    const probe = Math.min(bytes.length, 8192);
    let hasCJK = false;
    for (let i = 0; i + 2 < probe; i++) {
      if (bytes[i] >= 0xE4 && bytes[i] <= 0xE9) { hasCJK = true; break; }
    }
    return { encoding: 'UTF-8', confidence: hasCJK ? 0.85 : 0.8, bomLength: 0, scores: {} };
  }

  // 4. GB18030 / Big5 启发式打分
  const scores = heuristicScore(bytes);
  if (scores.gb18030 > 0 || scores.big5 > 0) {
    if (scores.gb18030 > scores.big5 * 1.2) {
      return { encoding: 'GB18030', confidence: 0.75, bomLength: 0, scores };
    } else if (scores.big5 > scores.gb18030 * 1.2) {
      return { encoding: 'Big5', confidence: 0.75, bomLength: 0, scores };
    } else {
      // 分数接近，默认 GB18030（中国大陆更常见）
      return { encoding: 'GB18030', confidence: 0.6, bomLength: 0, scores };
    }
  }

  // 5. 默认 UTF-8
  return { encoding: 'UTF-8', confidence: 0.3, bomLength: 0, scores: {} };
}

/**
 * 编码识别 + 解码 一步到位
 * 集成 detect + decode，适合在 reader 页面直接调用
 * @param {Uint8Array} bytes - 完整文件字节（或前 8KB 用于检测 + 完整用于解码）
 * @param {string} [forcedEncoding] - 手动指定的编码（跳过自动检测）
 * @param {string} [metaCharsetText] - 从 HTML meta 提取的编码声明
 * @returns {{ text: string, encoding: string, confidence: number, bomLength: number }}
 */
function detectAndDecode(bytes, forcedEncoding, metaCharsetText) {
  let encoding, confidence, bomLength;

  if (forcedEncoding) {
    const bom = detectBOM(bytes);
    encoding = forcedEncoding;
    confidence = 1.0;
    bomLength = bom.encoding === forcedEncoding ? bom.bomLength : 0;
  } else {
    const result = detectEncodingDetailed(bytes, metaCharsetText);
    encoding = result.encoding;
    confidence = result.confidence;
    bomLength = result.bomLength;
  }

  // 使用解码器解码
  const decoder = require('../encoding/decoder.js');
  const text = decoder.decode(bytes, encoding, bomLength);

  return { text, encoding, confidence, bomLength };
}

/**
 * 判断解码结果是否**疑似乱码** —— 编码自动识别误判时的信号。
 *
 * AGENTS §2.5：自动识别不可能 100% 准，兜底入口比把识别率从 95% 优化到
 * 97% 更有价值。但常驻一个「GBK / Big5」按钮，对不懂编码的人是噪音
 * （ADR-15）。所以改为：**只在看起来真的错了的时候**才把入口递出去。
 *
 * 两类乱码的特征完全不同，要分开认：
 *
 * 1. **编码猜得太宽**（GBK/Big5 文本按 UTF-8 解）——字节序列非法，
 *    解码器吐出大量 U+FFFD 替换字符。数它的占比就行，最可靠。
 *
 * 2. **编码猜得太窄**（UTF-8 文本按 GBK 解）——字节序列**全部合法**，
 *    解出来是一串有效但无意义的汉字，没有任何替换字符可数。
 *    这类只能认特征串，也就是俗称的「锟斤拷」。
 *
 * ⚠️ 特征只匹配**组合**不匹配单字：「烫」「屏」「踝」这些在乱码里高频，
 * 但它们本身都是常用字（烫手、屏幕），单字匹配会把正常文档误判成乱码。
 *
 * @param {string} text - 解码后的文本
 * @returns {{garbled:boolean, reason?:string, detail?:number}}
 */
function looksGarbled(text) {
  if (!text) return { garbled: false };

  // 只看开头一段：乱码是整份文档级的现象，抽样足够，
  // 而全文扫描在几 MB 的文档上是白花的开销
  var sample = text.length > 20000 ? text.slice(0, 20000) : text;
  var len = sample.length;
  // 太短判不准，宁可不报
  if (len < 32) return { garbled: false };

  // ── 1. 替换字符占比 ──
  var fffd = 0;
  for (var i = 0; i < len; i++) {
    if (sample.charCodeAt(i) === 0xFFFD) fffd++;
  }
  var ratio = fffd / len;
  // 正常文档的替换字符几乎恒为 0；0.5% 已经是明显不对了
  if (ratio > 0.005) {
    return { garbled: true, reason: 'replacement', detail: ratio };
  }

  // ── 2. 乱码特征串 ──
  var patterns = [
    /锟斤拷/g,        // UTF-8 → GBK，最经典的一组
    /鎴戜滑|浣犲ソ|鐨勬槸/g, // UTF-8 中文 → GBK 后的高频词形
    /嚙[踝緣諒databases]/g  // UTF-8 → Big5
  ];
  for (var p = 0; p < patterns.length; p++) {
    var m = sample.match(patterns[p]);
    if (m && m.length >= 2) {
      return { garbled: true, reason: 'marker', detail: m.length };
    }
  }

  return { garbled: false };
}

module.exports = {
  looksGarbled,
  detectBOM,
  detectMetaCharset,
  isValidUtf8,
  heuristicScore,
  isBinary,
  detectEncoding,
  detectEncodingDetailed,
  detectAndDecode,
  detectFormat
};
