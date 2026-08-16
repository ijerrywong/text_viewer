/**
 * core/encoding/decoder.js - 自实现编码解码器
 *
 * 小程序无 TextDecoder，本模块提供：
 * - UTF-8 解码（从 Uint8Array）
 * - GBK/GB18030 解码（双字节查表 + 四字节算法映射）
 * - Big5 解码（双字节查表）
 * - UTF-16LE/BE 解码
 *
 * ⚠️ 纯函数模块：不依赖任何 wx API
 * 表数据通过参数传入（由调用方异步加载后注入）
 */

// ─── 懒加载表缓存 ───
let _gbkTable = null;
let _big5Table = null;
let _gb18030Ranges = null;

// String.fromCharCode.apply 的实参上限（V8 约 12.5 万，留足余量）
// 超过这个长度必须分片，否则纯 ASCII 大文件会直接 "Maximum call stack size exceeded"
const APPLY_CHUNK = 8192;

/**
 * 安全地把一段字节按 latin1/ASCII 语义转成字符串
 * 必须分片：apply 的实参个数受调用栈限制，
 * 一个 200KB 的纯英文/代码/JSON 文件曾因此直接解码失败
 * @param {Uint8Array} bytes
 * @param {number} start
 * @param {number} end - 不含
 * @returns {string}
 */
function bytesToAsciiString(bytes, start, end) {
  if (end - start <= APPLY_CHUNK) {
    return String.fromCharCode.apply(null, bytes.subarray(start, end));
  }
  const parts = [];
  for (let i = start; i < end; i += APPLY_CHUNK) {
    const stop = Math.min(i + APPLY_CHUNK, end);
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, stop)));
  }
  return parts.join('');
}

/**
 * 解码 Base64 → Uint16Array
 * 小程序中用 wx.base64ToArrayBuffer，Node 中用 Buffer
 */
function base64ToUint16Array(b64) {
  if (typeof wx !== 'undefined' && wx.base64ToArrayBuffer) {
    const buf = wx.base64ToArrayBuffer(b64);
    return new Uint16Array(buf);
  }
  // Node 环境 fallback
  // Buffer.from 走内存池，byteOffset 不保证 2 字节对齐，
  // 直接套 Uint16Array 视图会抛 RangeError —— 复制一份底层内存才安全
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(b64, 'base64');
    const copy = new ArrayBuffer(buf.byteLength);
    new Uint8Array(copy).set(buf);
    return new Uint16Array(copy);
  }
  throw new Error('No Base64 decoder available');
}

/**
 * 获取 GBK 码表（懒加载）
 * @returns {Uint16Array}
 */
function getGbkTable() {
  if (!_gbkTable) {
    const b64 = require('./gbk-table.js');
    _gbkTable = base64ToUint16Array(b64);
  }
  return _gbkTable;
}

/**
 * 获取 Big5 码表（懒加载）
 * @returns {Uint16Array}
 */
function getBig5Table() {
  if (!_big5Table) {
    const b64 = require('./big5-table.js');
    _big5Table = base64ToUint16Array(b64);
  }
  return _big5Table;
}

/**
 * 预加载码表（在 reader onLoad 时调用，避免首次解码卡顿）
 * @param {string} encoding - 预判编码，只加载需要的表
 */
function preloadTable(encoding) {
  if (encoding === 'GB18030' || encoding === 'GBK' || encoding === 'GB2312') {
    getGbkTable();
    getGb18030Ranges();
  } else if (encoding === 'Big5') {
    getBig5Table();
  }
}

// ─── UTF-8 解码 ───

/**
 * UTF-8 解码（从 Uint8Array）
 * 支持完整 UTF-8 规范（含 1-4 字节序列）
 * @param {Uint8Array} bytes
 * @param {number} [start=0] - 起始偏移
 * @param {number} [end] - 结束偏移（不含）
 * @returns {string}
 */
function decodeUtf8(bytes, start, end) {
  const len = end || bytes.length;
  const offset = start || 0;
  const parts = [];
  let i = offset;
  let buf = '';

  while (i < len) {
    const b = bytes[i];

    if (b < 0x80) {
      // ASCII - 批量处理
      const chunkStart = i;
      while (i < len && bytes[i] < 0x80) {
        i++;
      }
      if (buf) {
        parts.push(buf);
        buf = '';
      }
      parts.push(bytesToAsciiString(bytes, chunkStart, i));
      continue;
    }

    let cp;
    if (b >= 0xC2 && b <= 0xDF) {
      // 2 字节
      if (i + 1 < len && (bytes[i + 1] & 0xC0) === 0x80) {
        cp = ((b & 0x1F) << 6) | (bytes[i + 1] & 0x3F);
        i += 2;
      } else {
        cp = 0xFFFD;
        i++;
      }
    } else if (b >= 0xE0 && b <= 0xEF) {
      // 3 字节
      if (i + 2 < len && (bytes[i + 1] & 0xC0) === 0x80 && (bytes[i + 2] & 0xC0) === 0x80) {
        cp = ((b & 0x0F) << 12) | ((bytes[i + 1] & 0x3F) << 6) | (bytes[i + 2] & 0x3F);
        i += 3;
      } else {
        cp = 0xFFFD;
        i++;
      }
    } else if (b >= 0xF0 && b <= 0xF4) {
      // 4 字节
      if (i + 3 < len && (bytes[i + 1] & 0xC0) === 0x80 &&
          (bytes[i + 2] & 0xC0) === 0x80 && (bytes[i + 3] & 0xC0) === 0x80) {
        cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3F) << 12) |
             ((bytes[i + 2] & 0x3F) << 6) | (bytes[i + 3] & 0x3F);
        i += 4;
      } else {
        cp = 0xFFFD;
        i++;
      }
    } else {
      cp = 0xFFFD;
      i++;
    }

    // 处理代理对
    if (cp <= 0xFFFF) {
      buf += String.fromCharCode(cp);
    } else {
      // BMP 之外：转 UTF-16 代理对
      cp -= 0x10000;
      buf += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
    }

    // 防止字符串过长
    if (buf.length > 8192) {
      parts.push(buf);
      buf = '';
    }
  }

  if (buf) {
    parts.push(buf);
  }

  return parts.join('');
}

// ─── GB18030 解码 ───

/**
 * GBK 双字节索引计算
 * @param {number} b1 - 第一字节 (0x81-0xFE)
 * @param {number} b2 - 第二字节 (0x40-0x7E or 0x80-0xFE)
 * @returns {number} - 表索引
 */
function gbkIndex(b1, b2) {
  let offset;
  if (b2 <= 0x7E) {
    offset = b2 - 0x40;
  } else {
    offset = b2 - 0x80 + 63;
  }
  return (b1 - 0x81) * 190 + offset;
}

/**
 * 获取 GB18030 四字节 BMP 区间表（懒加载）
 * @returns {{ pointers: number[], codePoints: number[] }}
 */
function getGb18030Ranges() {
  if (!_gb18030Ranges) {
    _gb18030Ranges = require('./gb18030-ranges.js');
  }
  return _gb18030Ranges;
}

/**
 * GB18030 四字节 → Unicode
 *
 * 四字节编码: (b1, b2, b3, b4)，b2/b4∈[0x30,0x39]，b3∈[0x81,0xFE]
 *
 * ⚠️ 两段的映射规则完全不同，不能用同一个线性公式：
 *
 * - **BMP 段**（b1∈[0x81,0x84]）：四字节区枚举的是"一/二字节区表达不了的
 *   BMP 码位"，中间有大量空洞，指针到码位的差值在每个空洞处跳变。
 *   必须查区间表（gb18030-ranges.js，由 Python 官方 codec 生成）。
 *   曾经的 `linear + 0x80` 写法只在第一个区间内正确，U+00A5 之后全错。
 *
 * - **补充平面段**（b1∈[0x90,0xE3]）：这一段才是严格线性的。
 *   曾经把 b1 限制在 [0x81,0x84]，导致 emoji、CJK 扩展 B 区
 *   完全解不出来（退化成两次双字节乱码）。
 *
 * @param {number} b1
 * @param {number} b2
 * @param {number} b3
 * @param {number} b4
 * @returns {number} - Unicode 码位（0 表示无效）
 */
function gb18030FourByteToUnicode(b1, b2, b3, b4) {
  if (b2 < 0x30 || b2 > 0x39) return 0;
  if (b3 < 0x81 || b3 > 0xFE) return 0;
  if (b4 < 0x30 || b4 > 0x39) return 0;

  // 补充平面段（线性）
  if (b1 >= 0x90 && b1 <= 0xE3) {
    const cp = 0x10000 + (b1 - 0x90) * 12600 + (b2 - 0x30) * 1260 +
      (b3 - 0x81) * 10 + (b4 - 0x30);
    return cp <= 0x10FFFF ? cp : 0;
  }

  // BMP 段（查区间表）
  if (b1 < 0x81 || b1 > 0x84) return 0;
  const pointer = (b1 - 0x81) * 12600 + (b2 - 0x30) * 1260 +
    (b3 - 0x81) * 10 + (b4 - 0x30);
  if (pointer > 39419) return 0; // 0x84 尾部未分配

  const ranges = getGb18030Ranges();
  const ptrs = ranges.pointers;
  // 二分找最后一个 pointers[k] <= pointer
  let lo = 0;
  let hi = ptrs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ptrs[mid] <= pointer) lo = mid;
    else hi = mid - 1;
  }
  return ranges.codePoints[lo] + (pointer - ptrs[lo]);
}

/**
 * GB18030 解码
 * @param {Uint8Array} bytes
 * @param {number} [start=0]
 * @param {number} [end]
 * @returns {string}
 */
function decodeGb18030(bytes, start, end) {
  const len = end || bytes.length;
  const offset = start || 0;
  const table = getGbkTable();
  const parts = [];
  let buf = '';
  let i = offset;

  while (i < len) {
    // 分段落袋：所有多字节分支都用 continue 跳过循环末尾，
    // 所以刷新必须放在循环开头，否则纯中文文档会把整篇拼进一个 buf
    if (buf.length > 8192) {
      parts.push(buf);
      buf = '';
    }

    const b1 = bytes[i];

    // ASCII
    if (b1 < 0x80) {
      const chunkStart = i;
      while (i < len && bytes[i] < 0x80) {
        i++;
      }
      if (buf) {
        parts.push(buf);
        buf = '';
      }
      parts.push(bytesToAsciiString(bytes, chunkStart, i));
      continue;
    }

    // 双字节区
    if (b1 >= 0x81 && b1 <= 0xFE && i + 1 < len) {
      const b2 = bytes[i + 1];

      // 检查是否为四字节序列
      if (b2 >= 0x30 && b2 <= 0x39 && i + 3 < len) {
        const b3 = bytes[i + 2];
        const b4 = bytes[i + 3];
        const cp = gb18030FourByteToUnicode(b1, b2, b3, b4);
        if (cp > 0) {
          if (cp <= 0xFFFF) {
            buf += String.fromCharCode(cp);
          } else {
            const adj = cp - 0x10000;
            buf += String.fromCharCode(0xD800 + (adj >> 10), 0xDC00 + (adj & 0x3FF));
          }
          i += 4;
          continue;
        }
        // 无效四字节，回退到双字节处理
      }

      // 双字节 GBK
      if ((b2 >= 0x40 && b2 <= 0x7E) || (b2 >= 0x80 && b2 <= 0xFE)) {
        const idx = gbkIndex(b1, b2);
        const cp = table[idx] || 0xFFFD;
        buf += String.fromCharCode(cp);
        i += 2;
        continue;
      }

      // 单字节无效，输出替换符
      buf += '\uFFFD';
      i++;
      continue;
    }

    // 无效字节
    buf += '\uFFFD';
    i++;

    if (buf.length > 8192) {
      parts.push(buf);
      buf = '';
    }
  }

  if (buf) {
    parts.push(buf);
  }
  return parts.join('');
}

// ─── Big5 解码 ───

/**
 * Big5 双字节索引计算
 * @param {number} b1 - 第一字节 (0xA1-0xF9)
 * @param {number} b2 - 第二字节 (0x40-0x7E or 0xA1-0xFE)
 * @returns {number} - 表索引
 */
function big5Index(b1, b2) {
  let offset;
  if (b2 <= 0x7E) {
    offset = b2 - 0x40;
  } else {
    offset = b2 - 0xA1 + 63;
  }
  return (b1 - 0xA1) * 157 + offset;
}

/**
 * Big5 解码
 * @param {Uint8Array} bytes
 * @param {number} [start=0]
 * @param {number} [end]
 * @returns {string}
 */
function decodeBig5(bytes, start, end) {
  const len = end || bytes.length;
  const offset = start || 0;
  const table = getBig5Table();
  const parts = [];
  let buf = '';
  let i = offset;

  while (i < len) {
    // 同 decodeGb18030：双字节分支 continue 会跳过循环末尾的刷新
    if (buf.length > 8192) {
      parts.push(buf);
      buf = '';
    }

    const b1 = bytes[i];

    // ASCII
    if (b1 < 0x80) {
      const chunkStart = i;
      while (i < len && bytes[i] < 0x80) {
        i++;
      }
      if (buf) {
        parts.push(buf);
        buf = '';
      }
      parts.push(bytesToAsciiString(bytes, chunkStart, i));
      continue;
    }

    // 双字节
    if (b1 >= 0xA1 && b1 <= 0xF9 && i + 1 < len) {
      const b2 = bytes[i + 1];
      if ((b2 >= 0x40 && b2 <= 0x7E) || (b2 >= 0xA1 && b2 <= 0xFE)) {
        const idx = big5Index(b1, b2);
        const cp = table[idx] || 0xFFFD;
        buf += String.fromCharCode(cp);
        i += 2;
        continue;
      }
    }

    // 无效字节
    buf += '\uFFFD';
    i++;

    if (buf.length > 8192) {
      parts.push(buf);
      buf = '';
    }
  }

  if (buf) {
    parts.push(buf);
  }
  return parts.join('');
}

// ─── UTF-16 解码 ───

/**
 * UTF-16LE 解码
 * @param {Uint8Array} bytes
 * @param {number} [start=0] - BOM 之后的偏移
 * @param {number} [end]
 * @returns {string}
 */
function decodeUtf16LE(bytes, start, end) {
  const len = end || bytes.length;
  const offset = start || 0;
  const parts = [];
  let buf = '';
  let i = offset;

  // 确保偶数长度
  const safeLen = len - ((len - offset) % 2);

  while (i < safeLen) {
    const lo = bytes[i];
    const hi = bytes[i + 1];
    const code = lo | (hi << 8);
    i += 2;

    // 代理对处理：UTF-16 的代理对本身就是 JS 字符串的内部表示，
    // 原样输出两个码元即可，不要再做 0x10000 换算（换算后再拆会得到完全不同的字符）
    if (code >= 0xD800 && code <= 0xDBFF && i + 1 < safeLen) {
      const lo2 = bytes[i];
      const hi2 = bytes[i + 1];
      const trail = lo2 | (hi2 << 8);
      if (trail >= 0xDC00 && trail <= 0xDFFF) {
        buf += String.fromCharCode(code, trail);
        i += 2;
        continue;
      }
    }

    buf += String.fromCharCode(code);

    if (buf.length > 8192) {
      parts.push(buf);
      buf = '';
    }
  }

  if (buf) {
    parts.push(buf);
  }
  return parts.join('');
}

/**
 * UTF-16BE 解码
 * @param {Uint8Array} bytes
 * @param {number} [start=0] - BOM 之后的偏移
 * @param {number} [end]
 * @returns {string}
 */
function decodeUtf16BE(bytes, start, end) {
  const len = end || bytes.length;
  const offset = start || 0;
  const parts = [];
  let buf = '';
  let i = offset;

  const safeLen = len - ((len - offset) % 2);

  while (i < safeLen) {
    const hi = bytes[i];
    const lo = bytes[i + 1];
    const code = (hi << 8) | lo;
    i += 2;

    if (code >= 0xD800 && code <= 0xDBFF && i + 1 < safeLen) {
      const hi2 = bytes[i];
      const lo2 = bytes[i + 1];
      const trail = (hi2 << 8) | lo2;
      if (trail >= 0xDC00 && trail <= 0xDFFF) {
        buf += String.fromCharCode(code, trail);
        i += 2;
        continue;
      }
    }

    buf += String.fromCharCode(code);

    if (buf.length > 8192) {
      parts.push(buf);
      buf = '';
    }
  }

  if (buf) {
    parts.push(buf);
  }
  return parts.join('');
}

// ─── 统一解码入口 ───

/**
 * 根据编码名称解码字节数组
 * @param {Uint8Array} bytes - 文件字节
 * @param {string} encoding - 编码名称：UTF-8 / GB18030 / GBK / Big5 / UTF-16LE / UTF-16BE
 * @param {number} [bomLength=0] - BOM 长度（已检测出的）
 * @returns {string} - 解码后的文本
 */
function decode(bytes, encoding, bomLength) {
  const bom = bomLength || 0;
  const enc = (encoding || 'UTF-8').toUpperCase().replace(/-/g, '');

  switch (enc) {
    case 'UTF8':
      return decodeUtf8(bytes, bom);

    case 'GB18030':
    case 'GBK':
    case 'GB2312':
      return decodeGb18030(bytes, bom);

    case 'BIG5':
      return decodeBig5(bytes, bom);

    // bomLength 已经是调用方检测出的 BOM 字节数（有 BOM 时为 2，无 BOM 时为 0），
    // 这里再加 2 会多吞一个码元 —— 有 BOM 时丢首字符，无 BOM 时同样丢首字符
    case 'UTF16LE':
    case 'UTF16':
      return decodeUtf16LE(bytes, bom);

    case 'UTF16BE':
      return decodeUtf16BE(bytes, bom);

    default:
      // 未知编码，回退 UTF-8
      return decodeUtf8(bytes, bom);
  }
}

module.exports = {
  decode,
  decodeUtf8,
  decodeGb18030,
  decodeBig5,
  decodeUtf16LE,
  decodeUtf16BE,
  preloadTable,
  base64ToUint16Array
};
