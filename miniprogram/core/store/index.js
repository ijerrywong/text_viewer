/**
 * core/store/index.js - 本地持久化
 *
 * 职责：
 * 1. 文件落盘（USER_DATA_PATH）
 * 2. 元数据管理（key-value 存储）
 * 3. 阅读进度（{ fileId, blockIndex, ratio }，绝不存 scrollTop）
 * 4. 设置持久化
 * 5. 最近文件列表（环形，最多 50 条）
 * 6. LRU 缓存清理
 *
 * 注意：此模块依赖 wx API
 *
 * 存储结构：
 * - USER_DATA_PATH/files/{stableId}/origin.{ext}  ← 文件本体
 * - USER_DATA_PATH/files/{stableId}/assets/       ← 抽取的图片
 * - wx.storage: meta:{id}, recent, progress:{id}, settings
 */

const MAX_RECENT = 50;

/**
 * LRU 清理阈值
 *
 * ⚠️ 官方口径：**本地缓存文件与本地用户文件加起来，每个小程序共 200MB**。
 * 也就是说 200MB 是**平台配额本身**，不是我们可以用到的量。
 *
 * 原先把阈值直接设成 200MB，等于宣布「永远不清理」：
 * 真正先撞墙的一定是 copyFile 写失败（配额里还躺着微信自己的缓存文件），
 * LRU 这条主动防线从来没有机会生效，只剩 intake 里那个写失败后的补救路径。
 * 而那条路径要先失败一次、清一次、再重试一次，用户实打实地多等一轮。
 *
 * 压到 120MB 留出足够余量，让清理发生在写入之前而不是之后。
 */
const CACHE_THRESHOLD = 120 * 1024 * 1024;
var KV_WARN_THRESHOLD = 8 * 1024 * 1024; // KV 存储 8MB 告警（官方上限 10MB/用户/小程序）

/**
 * 保存阅读进度
 * @param {string} fileId - 文件 ID
 * @param {number} blockIndex - 块索引
 * @param {number} ratio - 块内比例 (0-1)
 */
function saveProgress(fileId, blockIndex, ratio) {
  try {
    wx.setStorageSync(`progress:${fileId}`, {
      blockIndex,
      ratio,
      savedAt: Date.now()
    });
  } catch (e) {
    console.error('保存进度失败', e);
  }
}

/**
 * 读取阅读进度
 * @param {string} fileId
 * @returns {{ blockIndex: number, ratio: number, savedAt: number } | null}
 */
function getProgress(fileId) {
  try {
    return wx.getStorageSync(`progress:${fileId}`) || null;
  } catch (e) {
    return null;
  }
}

/**
 * 保存文件元数据
 * @param {Object} meta - { id, name, size, format, encoding, localPath, createdAt }
 */
function saveMeta(meta) {
  try {
    wx.setStorageSync(`meta:${meta.id}`, meta);
  } catch (e) {
    console.error('保存元数据失败', e);
  }
}

/**
 * 读取文件元数据
 * @param {string} id
 * @returns {Object|null}
 */
function getMeta(id) {
  try {
    return wx.getStorageSync(`meta:${id}`) || null;
  } catch (e) {
    return null;
  }
}

/**
 * 添加到最近文件列表
 * @param {Object} fileMeta - { id, name, size, format, localPath, openedAt }
 */
function addToRecent(fileMeta) {
  try {
    let recent = wx.getStorageSync('recent') || [];
    // 去重
    recent = recent.filter(f => f.id !== fileMeta.id);
    // 添加到头部
    recent.unshift({
      id: fileMeta.id,
      name: fileMeta.name,
      size: fileMeta.size,
      format: fileMeta.format,
      localPath: fileMeta.localPath,
      openedAt: Date.now()
    });
    // 限制数量
    if (recent.length > MAX_RECENT) {
      recent = recent.slice(0, MAX_RECENT);
    }
    wx.setStorageSync('recent', recent);
  } catch (e) {
    console.error('保存最近文件失败', e);
  }
}

/**
 * 获取最近文件列表
 * @returns {Array}
 */
function getRecent() {
  try {
    return wx.getStorageSync('recent') || [];
  } catch (e) {
    return [];
  }
}

/**
 * 清空最近文件列表
 */
function clearRecent() {
  try {
    wx.removeStorageSync('recent');
  } catch (e) {
    console.error('清空最近文件失败', e);
  }
}

/**
 * 保存设置
 * @param {Object} settings
 */
function saveSettings(settings) {
  try {
    wx.setStorageSync('settings', settings);
  } catch (e) {
    console.error('保存设置失败', e);
  }
}

/**
 * 读取设置
 * @returns {Object|null}
 */
function getSettings() {
  try {
    return wx.getStorageSync('settings') || null;
  } catch (e) {
    return null;
  }
}

/**
 * 递归计算目录总大小（bytes）
 * @param {Object} fs - FileSystemManager
 * @param {string} dirPath - 目录路径
 * @returns {number}
 */
function getDirSizeSync(fs, dirPath) {
  var total = 0;
  var entries;
  try {
    entries = fs.readdirSync(dirPath);
  } catch (e) {
    return 0;
  }
  for (var i = 0; i < entries.length; i++) {
    var fullPath = dirPath + '/' + entries[i];
    try {
      var stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        total += getDirSizeSync(fs, fullPath);
      } else {
        total += stat.size || 0;
      }
    } catch (e) {
      // 忽略单个文件 stat 失败
    }
  }
  return total;
}

/**
 * LRU 缓存清理
 * 检查文件目录占用，超过阈值时删除最久未用的文件
 *
 * @param {boolean} [aggressive] - 配额已经写不进去了，无视阈值强行腾出空间
 */
function lruClean(aggressive) {
  try {
    const fs = wx.getFileSystemManager();
    const filesDir = `${wx.env.USER_DATA_PATH}/files`;

    let entries;
    try {
      entries = fs.readdirSync(filesDir);
    } catch (e) {
      return; // 目录不存在
    }

    // 「最近」列表里的 openedAt 才是权威的访问时间。
    // 只看 meta.openedAt 时，历史上写入的 meta 常常没有这个字段，
    // 全部退化成 0，排序失去意义 —— LRU 变成随机删除。
    const recent = wx.getStorageSync('recent') || [];
    const recentOpenedAt = {};
    recent.forEach(function (f) {
      if (f && f.id) recentOpenedAt[f.id] = f.openedAt || 0;
    });

    // 收集文件信息和最近访问时间
    const fileList = [];
    for (const entry of entries) {
      try {
        const meta = wx.getStorageSync(`meta:${entry}`) || {};
        const dirPath = `${filesDir}/${entry}`;
        const size = getDirSizeSync(fs, dirPath); // 递归计算目录大小
        fileList.push({
          id: entry,
          path: dirPath,
          openedAt: Math.max(recentOpenedAt[entry] || 0, meta.openedAt || 0),
          size: size
        });
      } catch (e) {
        // 忽略
      }
    }

    // 按最近访问时间排序（最旧的在前）
    fileList.sort((a, b) => a.openedAt - b.openedAt);

    // 计算总大小
    let totalSize = fileList.reduce((sum, f) => sum + f.size, 0);
    // 强制清理时把目标压到阈值的一半，避免刚清完又立刻满
    const target = aggressive ? CACHE_THRESHOLD / 2 : CACHE_THRESHOLD;

    // 从最旧的开始删除。留一份最新的，避免把用户正在读的文件删掉
    while (totalSize > target && fileList.length > 1) {
      const oldest = fileList.shift();
      try {
        fs.rmdirSync(oldest.path, true);
        wx.removeStorageSync(`meta:${oldest.id}`);
        wx.removeStorageSync(`progress:${oldest.id}`);
        totalSize -= oldest.size;
      } catch (e) {
        break;
      }
    }
  } catch (e) {
    console.error('LRU 清理失败', e);
  }
}

/**
 * 检查 KV 存储用量
 * @returns {{ currentSize: number, limitSize: number, warn: boolean }}
 */
function getStorageUsage() {
  try {
    var res = wx.getStorageInfoSync();
    var currentSize = (res.currentSize || 0) * 1024; // KB → bytes
    var limitSize = (res.limitSize || 10240) * 1024;
    return {
      currentSize: currentSize,
      limitSize: limitSize,
      keys: res.keys || [],
      warn: currentSize > KV_WARN_THRESHOLD
    };
  } catch (e) {
    return { currentSize: 0, limitSize: 0, warn: false, keys: [] };
  }
}

/**
 * 检查文件目录占用大小
 * @returns {Promise<number>} 文件总大小（bytes）
 */
function getFileDirSize() {
  return new Promise(function(resolve) {
    try {
      var fs = wx.getFileSystemManager();
      var filesDir = wx.env.USER_DATA_PATH + '/files';
      try {
        fs.readdirSync(filesDir);
      } catch (e) {
        resolve(0);
        return;
      }
      // 使用递归计算（每个子目录是 files/{stableId}/）
      var totalSize = getDirSizeSync(fs, filesDir);
      resolve(totalSize);
    } catch (e) {
      resolve(0);
    }
  });
}

/**
 * 精简 KV 存储：删除过期的进度和元数据
 * 保留最近 MAX_RECENT 个文件的元数据
 */
function compactStorage() {
  try {
    var res = wx.getStorageInfoSync();
    var keys = res.keys || [];
    var recent = wx.getStorageSync('recent') || [];
    var recentIds = {};
    recent.forEach(function(f) { recentIds[f.id] = true; });

    var removed = 0;
    keys.forEach(function(key) {
      // 删除不在最近列表中的进度和元数据
      if (key.indexOf('progress:') === 0) {
        var id = key.slice(9);
        if (!recentIds[id]) {
          wx.removeStorageSync(key);
          removed++;
        }
      } else if (key.indexOf('meta:') === 0) {
        var mid = key.slice(5);
        if (!recentIds[mid]) {
          // 检查元数据是否过期（30天以上）
          var meta = wx.getStorageSync(key);
          if (meta && meta.openedAt && (Date.now() - meta.openedAt > 30 * 24 * 3600 * 1000)) {
            wx.removeStorageSync(key);
            removed++;
          }
        }
      }
    });
    return removed;
  } catch (e) {
    return 0;
  }
}

module.exports = {
  saveProgress,
  getProgress,
  saveMeta,
  getMeta,
  addToRecent,
  getRecent,
  clearRecent,
  saveSettings,
  getSettings,
  lruClean,
  getStorageUsage,
  getFileDirSize,
  compactStorage,
  MAX_RECENT,
  CACHE_THRESHOLD,
  KV_WARN_THRESHOLD
};
