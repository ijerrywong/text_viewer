/**
 * core/parse/html/postprocess.js - HTML IR 后处理
 *
 * 在 Worker 返回 IR 后、setData 前执行（主线程）：
 * 1. C10/D3/D12：base64 大图抽取落盘，替换 src 为本地路径
 * 2. F9：网络图片默认关闭，用户可设置开启
 * 3. F2：IR 大小安全检查（parse bomb 最终防线）
 *
 * 文件写入通过 writeCallback 抽象，便于测试和适配不同环境
 */

// ─── 常量 ───

// base64 图片抽取阈值：大于此值的 data URI 才落盘
var BASE64_EXTRACT_THRESHOLD = 4096; // 4KB

// IR 安全限制
var MAX_BLOCKS = 50000;
var MAX_TOTAL_TEXT = 5 * 1024 * 1024; // 5MB
var MAX_IMAGES = 1000;

// ─── base64 图片抽取（C10/D3/D12）───

/**
 * 从 IR blocks 中提取大型 base64 图片，落盘为本地文件
 * 小于阈值的 base64 保留内联（setData 可承受）
 *
 * @param {Array} blocks - IR blocks 数组（原地修改）
 * @param {Object} options
 *   - writeCallback: function(data, filePath) => Promise<void>  写文件回调
 *   - cacheDir: string  缓存目录路径
 *   - threshold: number  抽取阈值（字节），默认 4096
 * @returns {Promise<{ extracted: number, errors: string[] }>}
 */
function extractBase64Images(blocks, options) {
  options = options || {};
  var threshold = options.threshold || BASE64_EXTRACT_THRESHOLD;
  var cacheDir = options.cacheDir || '';
  var writeCallback = options.writeCallback;

  if (!blocks || !blocks.length) {
    return Promise.resolve({ extracted: 0, errors: [] });
  }

  var extracted = 0;
  var errors = [];
  var promises = [];

  for (var i = 0; i < blocks.length; i++) {
    var block = blocks[i];
    if (block.type !== 'image') continue;
    var src = block.src || '';
    if (src.indexOf('data:image/') !== 0) continue;

    // 解析 data URI: data:image/png;base64,xxxx
    var commaIdx = src.indexOf(',');
    if (commaIdx < 0) continue;

    var header = src.slice(0, commaIdx);
    var base64Data = src.slice(commaIdx + 1);
    var isBase64 = header.indexOf('base64') >= 0;

    if (!isBase64 || !base64Data) continue;

    // 小于阈值的保留内联
    if (base64Data.length < threshold) continue;

    // 提取 MIME 类型
    var mimeMatch = header.match(/data:(image\/[\w+]+)/);
    var mime = mimeMatch ? mimeMatch[1] : 'image/png';
    var ext = mimeToExt(mime);

    // 生成文件名（基于 base64 数据的简单 hash）
    var hash = simpleHash(base64Data);
    var fileName = 'img_' + hash + '.' + ext;
    var filePath = cacheDir ? cacheDir + '/' + fileName : fileName;

    // 如果没有 writeCallback，跳过（测试环境）
    if (!writeCallback) continue;

    // 异步写文件
    (function(block, base64Data, filePath) {
      var promise = writeCallback(base64Data, filePath).then(function() {
        block.src = filePath;
        block._extracted = true;
        extracted++;
      }).catch(function(err) {
        errors.push('Failed to extract image: ' + (err && err.message || err));
      });
      promises.push(promise);
    })(block, base64Data, filePath);
  }

  // 同时处理 inline segments 中的 base64 图片
  for (var j = 0; j < blocks.length; j++) {
    var b = blocks[j];
    if (!b.segments) continue;
    for (var k = 0; k < b.segments.length; k++) {
      var seg = b.segments[k];
      if (!seg.image || !seg.src) continue;
      if (seg.src.indexOf('data:image/') !== 0) continue;

      var sComma = seg.src.indexOf(',');
      if (sComma < 0) continue;
      var sHeader = seg.src.slice(0, sComma);
      var sData = seg.src.slice(sComma + 1);
      if (sHeader.indexOf('base64') < 0 || !sData) continue;
      if (sData.length < threshold) continue;

      var sMimeMatch = sHeader.match(/data:(image\/[\w+]+)/);
      var sMime = sMimeMatch ? sMimeMatch[1] : 'image/png';
      var sExt = mimeToExt(sMime);
      var sHash = simpleHash(sData);
      var sFileName = 'img_' + sHash + '.' + sExt;
      var sFilePath = cacheDir ? cacheDir + '/' + sFileName : sFileName;

      if (!writeCallback) continue;

      (function(seg, sData, sFilePath) {
        var promise = writeCallback(sData, sFilePath).then(function() {
          seg.src = sFilePath;
          seg._extracted = true;
          extracted++;
        }).catch(function(err) {
          errors.push('Failed to extract inline image: ' + (err && err.message || err));
        });
        promises.push(promise);
      })(seg, sData, sFilePath);
    }
  }

  return Promise.all(promises).then(function() {
    return { extracted: extracted, errors: errors };
  });
}

// ─── 网络图片门控（F9）───

/**
 * 根据用户设置门控网络图片
 * - 关闭时：将网络图片 src 替换为标记，WXML 显示占位提示
 * - 开启时：保持原 src
 *
 * @param {Array} blocks - IR blocks 数组（原地修改）
 * @param {boolean} networkImagesEnabled - 是否允许加载网络图片
 * @returns {Array} 修改后的 blocks
 */
function gateNetworkImages(blocks, networkImagesEnabled) {
  if (!blocks || !blocks.length) return blocks;

  for (var i = 0; i < blocks.length; i++) {
    var block = blocks[i];

    // 恢复之前被 block 的图片（无论当前 src 是什么）
    if (block._networkBlocked && networkImagesEnabled) {
      block.src = block._originalSrc || '';
      delete block._networkBlocked;
      delete block._originalSrc;
    }

    // 检查当前 src 是否需要 block
    if (!networkImagesEnabled && block.type === 'image' && isNetworkSrc(block.src)) {
      block._networkBlocked = true;
      block._originalSrc = block.src;
      block.src = '';
    }

    // 处理 inline segments 中的网络图片
    if (block.segments) {
      for (var k = 0; k < block.segments.length; k++) {
        var seg = block.segments[k];

        // 恢复
        if (seg._networkBlocked && networkImagesEnabled) {
          seg.src = seg._originalSrc || '';
          delete seg._networkBlocked;
          delete seg._originalSrc;
        }

        // block
        if (!networkImagesEnabled && seg.image && isNetworkSrc(seg.src)) {
          seg._networkBlocked = true;
          seg._originalSrc = seg.src;
          seg.src = '';
        }
      }
    }
  }

  return blocks;
}

// ─── IR 大小安全检查（F2）───

/**
 * 检查 IR 是否超过安全限制
 * @param {Object} ir - 解析结果 { blocks, toc, images, ... }
 * @returns {{ ok: boolean, reason: string, stats: Object }}
 */
function checkIRSize(ir) {
  if (!ir) return { ok: false, reason: 'null-ir', stats: {} };

  var blocks = ir.blocks || [];
  var blockCount = blocks.length;
  var totalText = 0;
  var imageCount = (ir.images || []).length;

  for (var i = 0; i < blockCount; i++) {
    var b = blocks[i];
    if (b.text) totalText += b.text.length;
    if (b.raw) totalText += b.raw.length;
    if (b.segments) {
      for (var j = 0; j < b.segments.length; j++) {
        if (b.segments[j].text) totalText += b.segments[j].text.length;
      }
    }
  }

  var stats = {
    blockCount: blockCount,
    totalText: totalText,
    imageCount: imageCount,
    truncated: !!ir.truncated
  };

  if (blockCount > MAX_BLOCKS) {
    return { ok: false, reason: 'too-many-blocks', stats: stats };
  }
  if (totalText > MAX_TOTAL_TEXT) {
    return { ok: false, reason: 'too-much-text', stats: stats };
  }
  if (imageCount > MAX_IMAGES) {
    return { ok: false, reason: 'too-many-images', stats: stats };
  }

  return { ok: true, reason: '', stats: stats };
}

// ─── 辅助函数 ───

/**
 * 判断 src 是否为网络图片
 */
function isNetworkSrc(src) {
  if (!src || typeof src !== 'string') return false;
  return src.indexOf('http://') === 0 ||
         src.indexOf('https://') === 0 ||
         src.indexOf('//') === 0;
}

/**
 * MIME 类型 → 文件扩展名
 */
function mimeToExt(mime) {
  var map = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'image/x-icon': 'ico'
  };
  return map[mime] || 'png';
}

/**
 * 简单字符串 hash（用于生成文件名，非安全用途）
 */
function simpleHash(str) {
  var hash = 0;
  var len = Math.min(str.length, 1000); // 只取前 1000 字符计算，加速
  for (var i = 0; i < len; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

module.exports = {
  extractBase64Images: extractBase64Images,
  gateNetworkImages: gateNetworkImages,
  checkIRSize: checkIRSize,
  isNetworkSrc: isNetworkSrc,
  BASE64_EXTRACT_THRESHOLD: BASE64_EXTRACT_THRESHOLD,
  MAX_BLOCKS: MAX_BLOCKS,
  MAX_TOTAL_TEXT: MAX_TOTAL_TEXT,
  MAX_IMAGES: MAX_IMAGES
};
