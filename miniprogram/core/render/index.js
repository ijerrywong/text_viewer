/**
 * core/render/index.js - 渲染数据层（Phase 1 增强版）
 *
 * 职责：
 * 1. IR → 虚拟滚动分片
 * 2. 字号感知的块高度预估
 * 3. 高度缓存管理 + 补偿计算（D13 最易做砸）
 * 4. 可见区域计算
 * 5. 进度 ↔ scrollTop 双向映射
 *
 * ⚠️ 纯函数模块：不直接操作 DOM
 * 高度测量由调用方（reader 页面）通过 createSelectorQuery 完成
 */

// ─── 默认渲染设置 ───
const DEFAULT_SETTINGS = {
  fontSize: 16,      // px（逻辑像素）
  lineHeight: 1.8,   // 倍率
  screenWidth: 375   // px（逻辑像素，iPhone 标准）
};

// rpx ↔ px 转换：750rpx = screenWidth px
function pxToRpx(px, screenWidth) {
  return px * (750 / (screenWidth || 375));
}

function rpxToPx(rpx, screenWidth) {
  return rpx * ((screenWidth || 375) / 750);
}

// ─── 高度预估 ───

/**
 * 预估块高度（字号感知）
 * @param {Block} block - IR 块
 * @param {Object} [settings] - { fontSize, lineHeight, screenWidth }
 * @returns {number} - 预估高度（rpx）
 */
// 归一化设置对象。estimateHeight 在滚动时每帧要被调用上万次，
// 每次 Object.assign 一个新对象是纯粹的 GC 压力，这里按引用缓存结果。
let _normCacheIn = null;
let _normCacheOut = DEFAULT_SETTINGS;

function normalizeSettings(settings) {
  if (!settings) return DEFAULT_SETTINGS;
  if (settings === _normCacheIn) return _normCacheOut;
  _normCacheIn = settings;
  _normCacheOut = {
    fontSize: settings.fontSize || DEFAULT_SETTINGS.fontSize,
    lineHeight: settings.lineHeight || DEFAULT_SETTINGS.lineHeight,
    screenWidth: settings.screenWidth || DEFAULT_SETTINGS.screenWidth
  };
  return _normCacheOut;
}

function estimateHeight(block, settings) {
  const s = normalizeSettings(settings);
  const fontRpx = pxToRpx(s.fontSize, s.screenWidth);
  const lineRpx = fontRpx * s.lineHeight;

  switch (block.type) {
    case 'heading': {
      const sizes = { 1: 1.8, 2: 1.6, 3: 1.4, 4: 1.25, 5: 1.1, 6: 1.0 };
      const multiplier = sizes[block.level] || 1.0;
      const headingFontRpx = fontRpx * multiplier;
      const headingLineRpx = headingFontRpx * s.lineHeight;
      // 标题通常一行，加上下间距
      return headingLineRpx + pxToRpx(24, s.screenWidth);
    }

    case 'paragraph': {
      const text = block.text ||
        (block.children && block.children[0] && block.children[0].text) || '';
      // 每行字符数：CJK 约 fontSize*1.0 宽，ASCII 约 fontSize*0.55 宽
      // 取混合估算：每行约 (screenWidth - 32) / (fontSize * 0.7) 字符
      const contentWidth = s.screenWidth - 32; // 两侧各 16px padding
      const charsPerLine = Math.max(1, Math.floor(contentWidth / (s.fontSize * 0.7)));
      const lineCount = Math.ceil(text.length / charsPerLine);
      return Math.max(lineRpx, lineCount * lineRpx) + pxToRpx(12, s.screenWidth);
    }

    case 'code': {
      const lines = (block.text || '').split('\n').length;
      const codeLineRpx = pxToRpx(s.fontSize * 0.85, s.screenWidth) * 1.6;
      return lines * codeLineRpx + pxToRpx(24, s.screenWidth);
    }

    case 'list': {
      const items = block.items || [];
      return items.length * (lineRpx + pxToRpx(8, s.screenWidth)) + pxToRpx(8, s.screenWidth);
    }

    case 'listItem': {
      // 列表项：缩进 + 文本行数
      const text = block.text || '';
      const indent = (block.depth || 0) * 2; // 每个 depth 缩进 2 字符
      const contentWidth = s.screenWidth - 32 - indent * s.fontSize;
      const charsPerLine = Math.max(1, Math.floor(contentWidth / (s.fontSize * 0.7)));
      const lineCount = Math.ceil(text.length / charsPerLine);
      return Math.max(lineRpx, lineCount * lineRpx) + pxToRpx(4, s.screenWidth);
    }

    case 'table': {
      const headerCount = (block.header || []).length;
      const rowCount = (block.rows || []).length;
      const totalRows = rowCount + (headerCount > 0 ? 1 : 0);
      // 每行预估高度：每单元格可能多行，取 1.5 倍行高
      const cellLineRpx = pxToRpx(s.fontSize * 0.9, s.screenWidth) * 1.5;
      return totalRows * cellLineRpx + pxToRpx(16, s.screenWidth);
    }

    case 'image': {
      // 图片：预估 200px 高 + 上下间距
      return pxToRpx(200, s.screenWidth) + pxToRpx(16, s.screenWidth);
    }

    case 'blockquote': {
      const children = block.children || [];
      const text = block.text || '';
      if (text) {
        const contentWidth = s.screenWidth - 56;
        const charsPerLine = Math.max(1, Math.floor(contentWidth / (s.fontSize * 0.7)));
        const lineCount = Math.ceil(text.length / charsPerLine);
        return lineCount * lineRpx + pxToRpx(16, s.screenWidth);
      }
      return children.length * lineRpx + pxToRpx(16, s.screenWidth);
    }

    case 'quote': {
      // 引用块：缩进 + 文本行数
      const text = block.text || '';
      const indent = (block.depth || 1) * 16; // 每层引用缩进 16px
      const contentWidth = s.screenWidth - 32 - indent;
      const charsPerLine = Math.max(1, Math.floor(contentWidth / (s.fontSize * 0.7)));
      const lineCount = Math.ceil(text.length / charsPerLine);
      return Math.max(lineRpx, lineCount * lineRpx) + pxToRpx(12, s.screenWidth);
    }

    case 'footnote': {
      // 脚注：小字号 + 缩进
      const text = block.text || '';
      const contentWidth = s.screenWidth - 48;
      const charsPerLine = Math.max(1, Math.floor(contentWidth / (s.fontSize * 0.75 * 0.7)));
      const lineCount = Math.ceil(text.length / charsPerLine);
      const footLineRpx = pxToRpx(s.fontSize * 0.75, s.screenWidth) * 1.6;
      return Math.max(footLineRpx, lineCount * footLineRpx) + pxToRpx(8, s.screenWidth);
    }

    case 'html': {
      // HTML 块：按等宽代码块估算
      const lines = (block.text || '').split('\n').length;
      const htmlLineRpx = pxToRpx(s.fontSize * 0.85, s.screenWidth) * 1.6;
      return lines * htmlLineRpx + pxToRpx(16, s.screenWidth);
    }

    case 'hr': {
      return pxToRpx(32, s.screenWidth);
    }

    case 'scriptDegrade': {
      // 脚本降级卡片：标题 + 消息 + 提示
      var msgLines = Math.ceil((block.message || '').length / Math.max(1, Math.floor((s.screenWidth - 64) / (s.fontSize * 0.7))));
      return pxToRpx(40 + 24 + msgLines * lineRpx + 20, s.screenWidth);
    }

    case 'math': {
      return pxToRpx(60, s.screenWidth);
    }

    default:
      return pxToRpx(40, s.screenWidth);
  }
}

// ─── 布局索引（树状数组）───

/**
 * 布局索引：块高度的前缀和结构
 *
 * 为什么需要它：computeVisibleRange 原先每次滚动都要把所有块线性走三遍
 * （找 startIndex、重算 offsetTop、找 endIndex），并且每个块都现算一次
 * estimateHeight。10 万块的文档意味着每帧 30 万次调用 —— 滚动必然掉帧。
 *
 * 树状数组把三件事都变成 O(log n)：
 *   - offset(i)   前 i 块的总高
 *   - indexAt(y)  某个 y 落在哪一块
 *   - setHeight   测到真实高度后回填
 *
 * 高度单位统一是 rpx。
 */
function createLayout(blocks, settings) {
  const n = blocks.length;
  const heights = new Float64Array(n);
  const measured = new Uint8Array(n); // 1 = 已测量，0 = 预估
  const tree = new Float64Array(n + 1);

  for (let i = 0; i < n; i++) {
    heights[i] = estimateHeight(blocks[i], settings);
  }

  // O(n) 建树
  for (let i = 1; i <= n; i++) {
    tree[i] += heights[i - 1];
    const parent = i + (i & -i);
    if (parent <= n) tree[parent] += tree[i];
  }

  function add(i, delta) {
    for (let k = i + 1; k <= n; k += k & -k) tree[k] += delta;
  }

  /** 前 i 块（不含第 i 块）的总高 */
  function offset(i) {
    if (i > n) i = n;
    let sum = 0;
    for (let k = i; k > 0; k -= k & -k) sum += tree[k];
    return sum;
  }

  /**
   * 找到 y 落在哪一块：返回最大的 i 使得 offset(i) <= y
   * 树状数组上直接二分下降，不用外层 binary search
   */
  function indexAt(y) {
    if (y <= 0 || n === 0) return 0;
    let pos = 0;
    let remaining = y;
    let step = 1;
    while (step * 2 <= n) step *= 2;
    for (; step > 0; step >>= 1) {
      const next = pos + step;
      if (next <= n && tree[next] <= remaining) {
        pos = next;
        remaining -= tree[next];
      }
    }
    // 下降过程逐段做减法，边界上会累积几个浮点末位的误差，
    // 恰好停在某块顶端时可能落到前一块。用一次精确的 offset 校正回来 ——
    // 否则「保存进度 → 恢复进度」会稳定地往前漂一整块。
    const EPS = 1e-6;
    if (pos < n && offset(pos + 1) <= y + EPS) pos++;
    else if (pos > 0 && offset(pos) > y + EPS) pos--;
    return Math.min(Math.max(pos, 0), n - 1);
  }

  return {
    length: n,
    height: function (i) { return heights[i] || 0; },
    isMeasured: function (i) { return measured[i] === 1; },
    offset: offset,
    total: function () { return offset(n); },
    indexAt: indexAt,

    /**
     * 回填真实高度
     * @returns {number} 高度变化量（rpx），0 表示无变化
     */
    setHeight: function (i, h) {
      if (i < 0 || i >= n) return 0;
      const delta = h - heights[i];
      if (delta === 0) {
        measured[i] = 1;
        return 0;
      }
      heights[i] = h;
      measured[i] = 1;
      add(i, delta);
      return delta;
    },

    /**
     * 字号/行距/主题变更后重建（E1b：清空已测高度并重新预估）
     */
    reestimate: function (nextSettings) {
      for (let i = 0; i < n; i++) {
        const h = estimateHeight(blocks[i], nextSettings);
        const delta = h - heights[i];
        if (delta !== 0) {
          heights[i] = h;
          add(i, delta);
        }
        measured[i] = 0;
      }
    }
  };
}

/**
 * 用布局索引计算可见范围
 * @param {Object} layout - createLayout 的返回值
 * @param {number} scrollTop - rpx
 * @param {number} viewportRpx - 视口高度（rpx）
 * @param {number} [bufferSize=2] - 上下缓冲屏数
 * @returns {{ startIndex, endIndex, offsetTop, offsetBottom, totalHeight }}
 */
function visibleRange(layout, scrollTop, viewportRpx, bufferSize) {
  const n = layout.length;
  if (n === 0) {
    return { startIndex: 0, endIndex: 0, offsetTop: 0, offsetBottom: 0, totalHeight: 0 };
  }
  const buf = bufferSize == null ? 2 : bufferSize;
  const topLimit = scrollTop - viewportRpx * buf;
  const bottomLimit = scrollTop + viewportRpx * (1 + buf);

  const startIndex = layout.indexAt(Math.max(0, topLimit));
  const offsetTop = layout.offset(startIndex);

  let endIndex = startIndex;
  let cursor = offsetTop;
  while (endIndex < n && cursor < bottomLimit) {
    cursor += layout.height(endIndex);
    endIndex++;
  }
  if (endIndex <= startIndex) endIndex = Math.min(startIndex + 1, n);

  const totalHeight = layout.total();
  return {
    startIndex: startIndex,
    endIndex: endIndex,
    offsetTop: offsetTop,
    // 底部占位用真实前缀和算，不再拿预估高度另算一遍
    offsetBottom: Math.max(0, totalHeight - layout.offset(endIndex)),
    totalHeight: totalHeight
  };
}

/**
 * scrollTop ↔ 进度（块索引 + 块内比例），基于布局索引
 */
function layoutToProgress(layout, scrollTop) {
  if (layout.length === 0) return { blockIndex: 0, ratio: 0 };
  const y = Math.max(0, scrollTop);
  let idx = layout.indexAt(y);
  let top = layout.offset(idx);
  let h = layout.height(idx);

  // 块边界归一化：正好停在第 i 块顶端时，答案必须是 (i, 0)，不能是 (i-1, 1)。
  // 树状数组的前缀和是逐段累加出来的，边界上两侧会差几个浮点末位，
  // 不归一化的话「保存进度 → 恢复进度」会稳定地往前漂一整块。
  const EPS = 1e-6;
  while (h > 0 && y - top >= h - EPS && idx + 1 < layout.length) {
    idx++;
    top += h;
    h = layout.height(idx);
  }
  while (idx > 0 && y < top - EPS) {
    idx--;
    h = layout.height(idx);
    top -= h;
  }

  const ratio = h > 0 ? (y - top) / h : 0;
  return { blockIndex: idx, ratio: Math.max(0, Math.min(1, ratio)) };
}

function progressToLayoutTop(layout, blockIndex, ratio) {
  if (layout.length === 0) return 0;
  const idx = Math.max(0, Math.min(blockIndex, layout.length - 1));
  return layout.offset(idx) + layout.height(idx) * Math.max(0, Math.min(1, ratio || 0));
}

/**
 * 计算所有块的总高度（用于 scroll-view 内容区高度）
 * @param {Block[]} blocks
 * @param {Object} heightCache - 已测量的高度 { index: rpx }
 * @param {Object} settings
 * @returns {number} - 总高度（rpx）
 */
function totalHeight(blocks, heightCache, settings) {
  let total = 0;
  for (let i = 0; i < blocks.length; i++) {
    total += (heightCache && heightCache[i]) || estimateHeight(blocks[i], settings);
  }
  return total;
}

// ─── 可见区域计算 ───

/**
 * 根据 scrollTop 计算可见块范围
 * @param {Block[]} blocks
 * @param {number} scrollTop - 当前滚动位置（rpx）
 * @param {number} viewportRpx - 视口高度（rpx）
 * @param {Object} heightCache - { index: rpx }
 * @param {number} [bufferSize=2] - 上下缓冲屏数
 * @param {Object} [settings]
 * @returns {{ startIndex, endIndex, offsetTop, totalHeight }}
 */
function computeVisibleRange(blocks, scrollTop, viewportRpx, heightCache, bufferSize, settings) {
  const total = blocks.length;
  const buf = bufferSize || 2;
  const cache = heightCache || {};

  if (total === 0) {
    return { startIndex: 0, endIndex: 0, offsetTop: 0, totalHeight: 0 };
  }

  let totalH = 0;
  let startIndex = 0;
  let endIndex = total;
  let offsetTop = 0;
  let foundStart = false;

  for (let i = 0; i < total; i++) {
    const h = cache[i] || estimateHeight(blocks[i], settings);
    totalH += h;

    if (!foundStart) {
      if (offsetTop + h >= scrollTop - viewportRpx * buf) {
        startIndex = i;
        foundStart = true;
      } else {
        offsetTop += h;
      }
    }

    if (foundStart) {
      if (offsetTop + (i - startIndex + 1) * h > scrollTop + viewportRpx * (1 + buf)) {
        // 粗略估计，实际需要累加
      }
    }
  }

  // 更精确的二分查找方式（对大文件更高效）
  // 重新计算 offsetTop 和 endIndex
  offsetTop = 0;
  let topLimit = scrollTop - viewportRpx * buf;
  let bottomLimit = scrollTop + viewportRpx * (1 + buf);

  startIndex = 0;
  for (let i = 0; i < total; i++) {
    const h = cache[i] || estimateHeight(blocks[i], settings);
    if (offsetTop + h >= topLimit) {
      startIndex = i;
      break;
    }
    offsetTop += h;
  }

  // 重新计算 offsetTop（到 startIndex 的总高度）
  offsetTop = 0;
  for (let i = 0; i < startIndex; i++) {
    offsetTop += cache[i] || estimateHeight(blocks[i], settings);
  }

  // 找 endIndex
  endIndex = startIndex;
  let currentTop = offsetTop;
  for (let i = startIndex; i < total; i++) {
    const h = cache[i] || estimateHeight(blocks[i], settings);
    currentTop += h;
    endIndex = i + 1;
    if (currentTop >= bottomLimit) {
      break;
    }
  }

  // 确保 endIndex 至少比 startIndex 大 1
  if (endIndex <= startIndex) {
    endIndex = Math.min(startIndex + 1, total);
  }

  return { startIndex, endIndex, offsetTop, totalHeight: totalH };
}

// ─── 高度缓存更新 + 补偿 ───

/**
 * 更新块高度缓存，计算需要的 scrollTop 补偿
 *
 * D13 核心逻辑：
 * 如果修改的是已渲染区域上方的块高度，
 * 必须同步反向调整 scrollTop 做补偿，否则页面会猛跳。
 *
 * @param {Object} heightCache - 当前高度缓存
 * @param {number} index - 被更新的块索引
 * @param {number} oldHeight - 旧高度（rpx）
 * @param {number} newHeight - 新高度（rpx）
 * @param {number} scrollTop - 当前 scrollTop（rpx）
 * @returns {{ delta: number, newScrollTop: number }}
 *   delta > 0 表示块变高了，需要向下补偿；delta < 0 表示变矮了
 */
function updateHeight(heightCache, index, oldHeight, newHeight, scrollTop, blocks, settings) {
  const delta = newHeight - oldHeight;
  heightCache[index] = newHeight;

  // 计算该块的顶部偏移。
  // ⚠️ 未测量的块在 heightCache 里是 undefined，以前按 0 计入，
  // blockTop 因此被严重低估，几乎恒小于 scrollTop —— 结果是
  // 视口下方的块变高时也去补偿 scrollTop，正是 D13 要防的那种"页面猛跳"。
  // 缺高度时必须用预估值兜底。
  let blockTop = 0;
  for (let i = 0; i < index; i++) {
    let h = heightCache[i];
    if (h == null) {
      h = blocks && blocks[i] ? estimateHeight(blocks[i], settings) : 0;
    }
    blockTop += h;
  }

  // 只有已滚过去的块（严格在视口上方）才需要反向补偿
  if (blockTop < scrollTop && delta !== 0) {
    return {
      delta,
      newScrollTop: scrollTop + delta
    };
  }

  // 块在视口内或下方，不需要补偿
  return { delta, newScrollTop: scrollTop };
}

// ─── 进度映射 ───

/**
 * scrollTop → 进度（块索引 + 块内比例）
 * @param {Block[]} blocks
 * @param {number} scrollTop - rpx
 * @param {Object} heightCache
 * @param {Object} [settings]
 * @returns {{ blockIndex: number, ratio: number }}
 */
function scrollTopToProgress(blocks, scrollTop, heightCache, settings) {
  const cache = heightCache || {};
  let offset = 0;

  for (let i = 0; i < blocks.length; i++) {
    const h = cache[i] || estimateHeight(blocks[i], settings);
    if (offset + h > scrollTop) {
      const ratio = h > 0 ? (scrollTop - offset) / h : 0;
      return { blockIndex: i, ratio: Math.max(0, Math.min(1, ratio)) };
    }
    offset += h;
  }

  return { blockIndex: Math.max(0, blocks.length - 1), ratio: 1 };
}

/**
 * 进度 → scrollTop
 * @param {Block[]} blocks
 * @param {number} blockIndex
 * @param {number} ratio - 0-1
 * @param {Object} heightCache
 * @param {Object} [settings]
 * @returns {number} - scrollTop (rpx)
 */
function progressToScrollTop(blocks, blockIndex, ratio, heightCache, settings) {
  const cache = heightCache || {};
  let offset = 0;

  for (let i = 0; i < blockIndex && i < blocks.length; i++) {
    offset += cache[i] || estimateHeight(blocks[i], settings);
  }

  const blockHeight = cache[blockIndex] ||
    estimateHeight(blocks[blockIndex] || { type: 'paragraph', text: '' }, settings);
  return offset + blockHeight * Math.max(0, Math.min(1, ratio));
}

// ─── 渲染数据生成 ───

/**
 * 生成渲染所需的数据
 * @param {Block[]} blocks
 * @param {Object} range - { startIndex, endIndex, offsetTop, totalHeight }
 * @returns {{ visibleBlocks, topSpacer, bottomSpacer, contentHeight }}
 */
function getRenderData(blocks, range, heightCache, settings) {
  const visibleBlocks = blocks.slice(range.startIndex, range.endIndex).map((block, i) => {
    return Object.assign({}, block, {
      _vIndex: range.startIndex + i  // 虚拟索引，用于高度测量
    });
  });

  // range 里若已带 offsetBottom（visibleRange 用前缀和算出来的），直接用。
  let bottomSpacer = range.offsetBottom;
  if (bottomSpacer == null) {
    // 兼容旧的 computeVisibleRange 路径。
    // ⚠️ 这里以前无视 heightCache 和 settings 直接 estimateHeight(blocks[i])，
    // 而 totalHeight 是按 heightCache 算的，两者口径不一致 ——
    // 一旦有块测出真实高度，bottomSpacer 就开始偏移，滚动条越滚越不对。
    const cache = heightCache || {};
    let bottomOffset = range.offsetTop;
    for (let i = range.startIndex; i < range.endIndex; i++) {
      bottomOffset += cache[i] || estimateHeight(blocks[i], settings);
    }
    bottomSpacer = Math.max(0, range.totalHeight - bottomOffset);
  }

  return {
    visibleBlocks,
    topSpacer: range.offsetTop,
    bottomSpacer: Math.max(0, bottomSpacer),
    contentHeight: range.totalHeight
  };
}

module.exports = {
  estimateHeight,
  createLayout,
  visibleRange,
  layoutToProgress,
  progressToLayoutTop,
  totalHeight,
  computeVisibleRange,
  updateHeight,
  scrollTopToProgress,
  progressToScrollTop,
  getRenderData,
  pxToRpx,
  rpxToPx,
  DEFAULT_SETTINGS
};
