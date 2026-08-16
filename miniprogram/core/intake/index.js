/**
 * core/intake/index.js - 文件接入层
 *
 * 适配器模式：统一不同来源的文件接入
 * - chat-file: wx.chooseMessageFile
 * - clipboard: wx.getClipboardData
 * - launch-material: scene 1173 forwardMaterials（Phase 4 已实现）
 *
 * 职责：
 * 1. 接收原始文件/文本
 * 2. 复制 temp → USER_DATA_PATH（防失效，Edge A7）
 * 3. 文件名清洗（Edge A3）
 * 4. 生成 stableId
 * 5. 登记元数据
 * 6. 读取文件字节 + 编码检测 + 解码
 *
 * 注意：此模块依赖 wx API，与 detect/parse/sanitize（纯函数）隔离
 */

var detect = require('../detect/index.js');
var decoder = require('../encoding/decoder.js');
var store = require('../store/index.js');

// 超过这个大小走"纯文本分页"降级，不整份读进内存（AGENTS §2.6）
var HUGE_FILE_BYTES = 50 * 1024 * 1024;
// 超过这个大小先给用户一个明确提示，而不是闷头卡住
var LARGE_FILE_BYTES = 10 * 1024 * 1024;
// 巨型文件降级模式下实际读取的字节数
var DEGRADED_READ_BYTES = 4 * 1024 * 1024;

function hashString(str) {
  var hash = 0;
  for (var i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/**
 * 生成稳定的文件 ID
 *
 * ⚠️ 必须真的稳定：同一个文件重复打开必须得到同一个 id。
 * 早先的实现掺了 Date.now() 和 Math.random()，后果是
 *   - 阅读进度永远恢复不了（进度按 id 存，id 每次都变）
 *   - 「最近」列表里同一个文件反复堆积
 *   - 每打开一次就在 USER_DATA_PATH 里多存一份副本，配额被白白吃光
 * 现在只由「文件名 + 大小 + 内容指纹」决定。
 *
 * @param {string} name - 原始文件名
 * @param {number} size - 文件大小
 * @param {Uint8Array} [headBytes] - 文件头部字节，用于区分同名同大小的不同文件
 * @returns {string} stableId
 */
function generateStableId(name, size, headBytes) {
  var base = hashString(String(name || '') + '|' + String(size || 0));
  var fingerprint = '0';
  if (headBytes && headBytes.length) {
    // 采样若干字节即可，目的是区分同名同大小的不同文件，不是防碰撞
    var acc = 0;
    var step = Math.max(1, Math.floor(headBytes.length / 256));
    for (var i = 0; i < headBytes.length; i += step) {
      acc = ((acc << 5) - acc + headBytes[i]) | 0;
    }
    fingerprint = (acc >>> 0).toString(36);
  }
  return base + '-' + fingerprint;
}

/**
 * 清洗文件名（Edge A3）
 * - 去除路径穿越（../、绝对路径）
 * - 去除非法字符 : * ? " < > |
 * - 截断超长文件名
 * - 空名回退为 "未命名.txt"
 * @param {string} name - 原始文件名
 * @returns {{ safeName: string, ext: string }}
 */
function sanitizeFileName(name) {
  if (!name || typeof name !== 'string') {
    return { safeName: '未命名.txt', ext: 'txt' };
  }
  var safe = name.replace(/^.*[\/\\]/, '');
  safe = safe.replace(/[:*?"<>|]/g, '_');
  if (safe.length > 100) {
    var dotIdx = safe.lastIndexOf('.');
    if (dotIdx > 0 && dotIdx > safe.length - 20) {
      var ext = safe.slice(dotIdx);
      safe = safe.slice(0, 100 - ext.length) + ext;
    } else {
      safe = safe.slice(0, 100);
    }
  }
  if (!safe || safe.trim() === '') {
    safe = '未命名.txt';
  }
  var dIdx = safe.lastIndexOf('.');
  var ext = dIdx > 0 ? safe.slice(dIdx + 1).toLowerCase() : '';
  return { safeName: safe, ext: ext };
}

/**
 * 从聊天选择文件
 * @param {Object} options - { count, extension }
 * @returns {Promise<Object>} - { path, name, size, tempPath }
 */
function chooseFromChat(options) {
  options = options || {};
  return new Promise(function(resolve, reject) {
    wx.chooseMessageFile({
      count: options.count || 1,
      type: 'file',
      extension: options.extension,
      success: function(res) {
        if (res.tempFiles && res.tempFiles.length > 0) {
          var f = res.tempFiles[0];
          resolve({
            path: f.path,
            name: f.name,
            size: f.size,
            tempPath: f.path
          });
        } else {
          reject(new Error('未选择文件'));
        }
      },
      fail: function(err) { reject(err); }
    });
  });
}

/**
 * 复制临时文件到 USER_DATA_PATH
 * 防止 tempFilePath 失效（Edge A7）
 * @param {string} tempPath - 临时文件路径
 * @param {string} stableId - 稳定 ID
 * @param {string} ext - 文件扩展名
 * @returns {Promise<string>} - 本地持久化路径
 */
function copyToUserDir(tempPath, stableId, ext) {
  var fs = wx.getFileSystemManager();
  var dir = wx.env.USER_DATA_PATH + '/files/' + stableId;
  var localPath = dir + '/origin.' + (ext || 'txt');

  // stableId 现在真的稳定了，同一个文件重开时本地副本已经在，
  // 而且源文件大小一致就没必要再拷一遍（大文件重复拷贝很贵）
  var srcSize = statSize(tempPath);
  var dstSize = statSize(localPath);
  if (dstSize >= 0 && dstSize === srcSize) {
    return Promise.resolve(localPath);
  }

  function attempt() {
    return new Promise(function(resolve, reject) {
      try {
        fs.mkdirSync(dir, true);
      } catch (e) {
        // 目录已存在，忽略
      }
      fs.copyFile({
        srcPath: tempPath,
        destPath: localPath,
        success: function() { resolve(localPath); },
        fail: function(err) { reject(err); }
      });
    });
  }

  // G4：配额耗尽时先做一次 LRU 清理再重试，而不是直接把错误甩给用户
  return attempt().catch(function(err) {
    try {
      store.lruClean(true);
    } catch (e) {
      // 清理失败不掩盖原始错误
    }
    return attempt().catch(function() {
      var e2 = new Error('本地存储空间不足，请在设置中清理缓存后重试');
      e2.code = 'QUOTA';
      e2.cause = err;
      throw e2;
    });
  });
}

/**
 * 从剪贴板获取文本
 * 仅在用户明确点击时调用（Edge E9）
 * @returns {Promise<string>}
 */
function fromClipboard() {
  return new Promise(function(resolve, reject) {
    wx.getClipboardData({
      success: function(res) { resolve(res.data || ''); },
      fail: function(err) { reject(err); }
    });
  });
}

/**
 * 保存剪贴板文本到本地文件
 * @param {string} text - 文本内容
 * @param {string} stableId
 * @returns {Promise<string>} - 本地路径
 */
function saveTextToFile(text, stableId) {
  return new Promise(function(resolve, reject) {
    var fs = wx.getFileSystemManager();
    var dir = wx.env.USER_DATA_PATH + '/files/' + stableId;
    var localPath = dir + '/origin.txt';

    try {
      fs.mkdirSync(dir, true);
    } catch (e) {}

    fs.writeFile({
      filePath: localPath,
      data: text,
      encoding: 'utf-8',
      success: function() { resolve(localPath); },
      fail: function(err) { reject(err); }
    });
  });
}

/**
 * 读取文件字节（ArrayBuffer）
 * @param {string} filePath - 文件路径
 * @param {number} [length] - 读取长度（不传则读全部）
 * @param {number} [position=0] - 起始位置
 * @returns {Promise<{ data: ArrayBuffer, bytes: Uint8Array }>}
 */
function readFileBytes(filePath, length, position) {
  return new Promise(function(resolve, reject) {
    var fs = wx.getFileSystemManager();
    var opts = {
      filePath: filePath,
      success: function(res) {
        var bytes = new Uint8Array(res.data);
        resolve({ data: res.data, bytes: bytes });
      },
      fail: function(err) { reject(err); }
    };
    if (typeof length === 'number') {
      opts.length = length;
      opts.position = position || 0;
    }
    fs.readFile(opts);
  });
}

/**
 * 读取文件头部字节（用于编码检测）
 * @param {string} filePath
 * @param {number} [size=8192] - 读取字节数
 * @returns {Promise<Uint8Array>}
 */
function readFileHead(filePath, size) {
  // 读长度不能超过文件实际大小：部分平台上 length 越界会直接 fail，
  // 于是几十字节的小文件反而打不开。
  var want = size || 8192;
  var actual = statSize(filePath);
  if (actual === 0) return Promise.resolve(new Uint8Array(0));
  if (actual > 0 && actual < want) want = actual;
  return readFileBytes(filePath, want, 0)
    .then(function(res) { return res.bytes; })
    .catch(function() {
      // 部分基础库/平台不支持带 position+length 的 readFile（G5），
      // 小文件整份读也不贵，直接退回去
      return readFileBytes(filePath).then(function(res) {
        return res.bytes.length > want ? res.bytes.subarray(0, want) : res.bytes;
      });
    });
}

/**
 * 取文件大小，失败返回 -1（未知）
 */
function statSize(filePath) {
  try {
    var stat = wx.getFileSystemManager().statSync(filePath);
    return stat && typeof stat.size === 'number' ? stat.size : -1;
  } catch (e) {
    return -1;
  }
}

/**
 * 把头部字节按 ASCII 解出来，用于提取 <meta charset>
 *
 * 编码还没确定，所以只能按单字节读：<meta charset="gbk"> 里的字符都是 ASCII，
 * 这样读足够可靠。B15 要求 meta charset 的优先级仅次于 BOM，
 * 但之前 detectEncodingDetailed 从来没拿到过这个参数，整条规则是空转的。
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function headAsAscii(bytes) {
  var limit = Math.min(bytes.length, 4096);
  var out = '';
  for (var i = 0; i < limit; i++) {
    var b = bytes[i];
    out += (b >= 0x20 && b < 0x7F) || b === 0x0A || b === 0x0D || b === 0x09
      ? String.fromCharCode(b)
      : ' ';
  }
  return out;
}

/**
 * 完整文件加载流程
 * 选择文件 → 复制到本地 → 读取字节 → 编码检测 → 解码 → 格式检测
 *
 * @param {Object} file - { path, name, size }
 * @returns {Promise<{ text, encoding, format, confidence, meta }>}
 */
function loadFile(file) {
  var cleaned = sanitizeFileName(file.name);
  var meta = {
    id: '',
    name: cleaned.safeName,
    originalName: file.name,
    size: file.size,
    format: 'txt',
    encoding: 'UTF-8',
    localPath: '',
    createdAt: Date.now(),
    openedAt: Date.now()
  };
  var notices = [];

  // 1. 先读源文件头部，据此算出稳定 id（同一文件重复打开要落到同一目录）
  return readFileHead(file.path, 8192)
    .then(function(headBytes) {
      meta.id = generateStableId(file.name, file.size, headBytes);

      // 二进制伪装成 .txt（B14）：整篇乱码不如直接说明白
      if (detect.isBinary(headBytes)) {
        var err = new Error('这是一个二进制文件，不是纯文本，无法阅读');
        err.code = 'BINARY';
        throw err;
      }

      // 2. 复制到 USER_DATA_PATH（A7：temp 路径随时可能失效）
      return copyToUserDir(file.path, meta.id, cleaned.ext);
    })
    .then(function(localPath) {
      meta.localPath = localPath;
      return readFileHead(localPath, 8192);
    })
    .then(function(headBytes) {
      // 3. 编码检测。<meta charset> 的优先级仅次于 BOM（B15），
      //    所以要先把头部按 ASCII 解出来喂给检测器。
      var metaCharsetText = headAsAscii(headBytes);
      var detectResult = detect.detectEncodingDetailed(headBytes, metaCharsetText);
      meta.encoding = detectResult.encoding;
      meta.confidence = detectResult.confidence;

      decoder.preloadTable(detectResult.encoding);

      // 4. 读取内容。
      //    ⚠️ 超大文件绝不整份读进内存（§2.6 / D1）：
      //    50MB 的 txt 读成 ArrayBuffer 再解成 JS 字符串会直接把内存打爆。
      var actualSize = statSize(meta.localPath);
      if (actualSize < 0) actualSize = meta.size || 0;

      if (actualSize === 0) {
        // 空文件（B8）：明确提示而不是白屏
        return { bytes: new Uint8Array(0), degradedRead: false };
      }

      if (actualSize > HUGE_FILE_BYTES) {
        meta.hugeFile = true;
        notices.push('文件超过 ' + Math.round(HUGE_FILE_BYTES / 1024 / 1024) +
          'MB，仅载入开头约 ' + Math.round(DEGRADED_READ_BYTES / 1024 / 1024) + 'MB 内容');
        return readFileBytes(meta.localPath, DEGRADED_READ_BYTES, 0)
          .then(function(res) { return { bytes: res.bytes, degradedRead: true }; });
      }

      if (actualSize > LARGE_FILE_BYTES) {
        notices.push('大文件（' + (actualSize / 1024 / 1024).toFixed(1) + 'MB），首次打开可能较慢');
      }

      return readFileBytes(meta.localPath).then(function(res) {
        return { bytes: res.bytes, degradedRead: false };
      });
    })
    .then(function(read) {
      var bytes = read.bytes;

      if (bytes.length === 0) {
        meta.format = 'txt';
        store.saveMeta(meta);
        return {
          text: '', encoding: meta.encoding, format: 'txt',
          confidence: meta.confidence, meta: meta,
          empty: true, notices: ['这是一个空文件（0 字节）']
        };
      }

      // 5. 解码
      var bom = detect.detectBOM(bytes);
      var text = decoder.decode(bytes, meta.encoding, bom.bomLength);

      // 截断读取时最后一个字符可能是半个多字节序列，去掉替换符尾巴
      if (read.degradedRead) {
        text = text.replace(/�+$/, '');
      }

      // 6. 格式检测
      var formatResult = detect.detectFormat(meta.name, text.slice(0, 2048));
      meta.format = formatResult.format;

      // 7. 保存元数据 + 最近文件
      store.saveMeta(meta);
      store.addToRecent({
        id: meta.id,
        name: meta.name,
        size: meta.size,
        format: meta.format,
        localPath: meta.localPath,
        openedAt: meta.openedAt
      });

      // 8. LRU 清理（异步，不阻塞）
      setTimeout(function() { store.lruClean(); }, 100);

      return {
        text: text,
        encoding: meta.encoding,
        format: meta.format,
        confidence: meta.confidence,
        meta: meta,
        truncatedRead: read.degradedRead,
        notices: notices
      };
    });
}

/**
 * 从已有本地路径加载文件（用于最近文件恢复）
 * @param {Object} meta - 文件元数据 { id, name, localPath, ... }
 * @param {string} [forcedEncoding] - 手动指定编码
 * @returns {Promise<{ text, encoding, format, meta }>}
 */
function loadFromLocal(meta, forcedEncoding) {
  var encoding = forcedEncoding || meta.encoding || 'UTF-8';
  var notices = [];
  var degradedRead = false;

  var actualSize = statSize(meta.localPath);
  var readPromise;
  if (actualSize === 0) {
    readPromise = Promise.resolve({ bytes: new Uint8Array(0) });
  } else if (actualSize > HUGE_FILE_BYTES) {
    degradedRead = true;
    notices.push('文件超过 ' + Math.round(HUGE_FILE_BYTES / 1024 / 1024) +
      'MB，仅载入开头约 ' + Math.round(DEGRADED_READ_BYTES / 1024 / 1024) + 'MB 内容');
    readPromise = readFileBytes(meta.localPath, DEGRADED_READ_BYTES, 0);
  } else {
    readPromise = readFileBytes(meta.localPath);
  }

  return readPromise
    .then(function(res) {
      var bytes = res.bytes;
      var bom = detect.detectBOM(bytes);

      // 如果没有强制编码，重新检测（同样要把 meta charset 喂进去，B15）
      if (!forcedEncoding) {
        var detectResult = detect.detectEncodingDetailed(bytes, headAsAscii(bytes));
        encoding = detectResult.encoding;
      }

      decoder.preloadTable(encoding);
      var text = decoder.decode(bytes, encoding, bom.bomLength);
      if (degradedRead) text = text.replace(/�+$/, '');

      // 格式检测
      var formatResult = detect.detectFormat(meta.name, text.slice(0, 2048));

      // 更新元数据
      meta.encoding = encoding;
      meta.format = formatResult.format;
      meta.openedAt = Date.now();
      store.saveMeta(meta);
      store.addToRecent({
        id: meta.id,
        name: meta.name,
        size: meta.size,
        format: meta.format,
        localPath: meta.localPath,
        openedAt: meta.openedAt
      });

      return {
        text: text,
        encoding: encoding,
        format: meta.format,
        confidence: 1.0,
        meta: meta,
        empty: bytes.length === 0,
        truncatedRead: degradedRead,
        notices: notices
      };
    });
}

/**
 * 用指定编码重新解码文件
 * @param {Object} meta - 文件元数据
 * @param {string} encoding - 新编码
 * @returns {Promise<{ text, encoding }>}
 */
function reDecode(meta, encoding) {
  return readFileBytes(meta.localPath)
    .then(function(res) {
      var bytes = res.bytes;
      var bom = detect.detectBOM(bytes);
      var bomLen = (bom.encoding === encoding) ? bom.bomLength : 0;

      decoder.preloadTable(encoding);
      var text = decoder.decode(bytes, encoding, bomLen);

      // 更新元数据
      meta.encoding = encoding;
      store.saveMeta(meta);

      return { text: text, encoding: encoding };
    });
}

/**
 * 删除本地文件
 * @param {string} stableId
 */
function removeFile(stableId) {
  try {
    var fs = wx.getFileSystemManager();
    var dir = wx.env.USER_DATA_PATH + '/files/' + stableId;
    fs.rmdirSync(dir, true);
  } catch (e) {
    // 目录可能已不存在，继续清理索引
  }
  try {
    wx.removeStorageSync('meta:' + stableId);
    wx.removeStorageSync('progress:' + stableId);
    // 「最近」里的条目也要一并摘掉，否则列表里留着一条点不开的死项
    var recent = wx.getStorageSync('recent') || [];
    var next = recent.filter(function (f) { return f && f.id !== stableId; });
    if (next.length !== recent.length) {
      wx.setStorageSync('recent', next);
    }
  } catch (e) {
    // 忽略
  }
}

module.exports = {
  generateStableId,
  sanitizeFileName,
  chooseFromChat,
  copyToUserDir,
  fromClipboard,
  saveTextToFile,
  readFileBytes,
  readFileHead,
  loadFile,
  loadFromLocal,
  reDecode,
  removeFile
};
