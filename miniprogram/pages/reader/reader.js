/**
 * reader.js - 阅读器核心页
 *
 * 完整流程：
 * 文件接入 → 编码检测 → 解码 → 格式识别 → IR 解析 → 虚拟滚动渲染
 * 含：进度保存/恢复、编码切换、目录跳转、高度补偿
 */

var app = getApp();
var detect = require('../../core/detect/index.js');
var parseMod = require('../../core/parse/index.js');
var renderMod = require('../../core/render/index.js');
var intake = require('../../core/intake/index.js');
var store = require('../../core/store/index.js');
var inlineMod = require('../../core/parse/md/inline.js');
var highlightMod = require('../../core/highlight/index.js');
var postprocess = require('../../core/parse/html/postprocess.js');
var samples = require('../../assets/samples.js');

// 虚拟滚动阈值：超过此数量启用虚拟滚动
var VIRTUAL_SCROLL_THRESHOLD = 150;
// 文件队列里最多缓存几份已解析文档（D20：多文档累积会撑爆内存）
var QUEUE_CACHE_LIMIT = 3;
// 单段文本里最多切出多少个高亮片段：
// 一段话里出现几十次关键词时再拆下去，setData 的段数比正文本身还多。
var MAX_HL_PER_SEG = 50;

/**
 * 把一段行内段按关键词切成「命中/未命中」两类小段，命中的挂上高亮 class。
 *
 * 只拆纯文本类的段，图片占位和换行原样保留；
 * 拆出来的小段完整继承原段的 bold/italic/href 等属性，
 * 否则加粗的命中词会在高亮后变回常规字重。
 *
 * @param {Array} segments
 * @param {string} lowerKw - 已转小写的关键词
 * @param {boolean} isCur - 是否为「当前命中块」，决定用哪套高亮色
 * @returns {Array} 未命中时原样返回入参，避免无谓的 setData 数据膨胀
 */
function highlightSegments(segments, lowerKw, isCur) {
  if (!segments || !lowerKw) return segments;
  var hlClass = isCur ? 'seg-hl seg-hl-cur' : 'seg-hl';
  var kwLen = lowerKw.length;
  var out = [];
  var touched = false;

  for (var i = 0; i < segments.length; i++) {
    var seg = segments[i];
    if (!seg.text || seg.br || seg.image) { out.push(seg); continue; }

    var lower = seg.text.toLowerCase();
    var from = 0;
    var count = 0;
    var pieces = null;
    var pos = lower.indexOf(lowerKw);

    while (pos >= 0 && count < MAX_HL_PER_SEG) {
      if (!pieces) pieces = [];
      if (pos > from) pieces.push(cloneSeg(seg, seg.text.slice(from, pos), ''));
      pieces.push(cloneSeg(seg, seg.text.slice(pos, pos + kwLen), hlClass));
      from = pos + kwLen;
      count++;
      pos = lower.indexOf(lowerKw, from);
    }

    if (!pieces) { out.push(seg); continue; }
    if (from < seg.text.length) pieces.push(cloneSeg(seg, seg.text.slice(from), ''));
    touched = true;
    out.push.apply(out, pieces);
  }

  return touched ? out : segments;
}

function cloneSeg(seg, text, hlClass) {
  var copy = {};
  for (var k in seg) copy[k] = seg[k];
  copy.text = text;
  copy.hl = hlClass;
  return copy;
}

/**
 * 纯文本切段：命中返回小段数组，没命中返回 null（调用方据此走「原样渲染」分支）。
 *
 * 表格单元格、没做语法高亮的代码块都不是行内段结构，
 * 只有单独走这条路，它们里面的关键词才有颜色 —— 否则整块只剩一条边色，
 * 一屏几十行代码里还是得靠人眼扫。
 */
function highlightPlain(text, lowerKw, isCur) {
  if (!text || !lowerKw) return null;
  if (text.toLowerCase().indexOf(lowerKw) < 0) return null;
  return highlightSegments([{ text: text }], lowerKw, isCur);
}

/** 表格单元格逐个切段；没命中的单元格原样复用，不做多余的对象复制 */
function highlightCells(cells, lowerKw, isCur) {
  if (!cells) return cells;
  var out = [];
  var touched = false;
  for (var i = 0; i < cells.length; i++) {
    var cell = cells[i];
    var segs = cell ? highlightPlain(cell.text, lowerKw, isCur) : null;
    if (!segs) { out.push(cell); continue; }
    var copy = {};
    for (var k in cell) copy[k] = cell[k];
    copy.hlSegs = segs;
    out.push(copy);
    touched = true;
  }
  return touched ? out : cells;
}

/** 结果条摘要也按同样规则切段，列表里一眼看得见命中在哪 */
function snippetToSegs(snippet, lowerKw) {
  return highlightSegments([{ text: snippet }], lowerKw, false);
}

Page({
  data: {
    // 导航
    statusBarHeight: 20,
    navBarHeight: 68,
    toolbarHeight: 100,
    themeClass: '',

    // 文件信息
    fileName: '',
    fileSize: 0,
    fileId: '',
    fileMeta: null,
    source: '',

    // 内容状态
    loading: true,
    loadingText: '正在加载...',
    error: '',
    encoding: 'UTF-8',
    format: 'txt',

    // 虚拟滚动
    useVirtualScroll: false,
    visibleBlocks: [],
    topSpacerHeight: 0,
    bottomSpacerHeight: 0,
    contentHeight: 0,
    scrollTopPx: 0,

    // 目录
    toc: [],
    showToc: false,
    currentTocId: '',

    // 搜索
    // 两态：'off' 关闭 / 'input' 居中浮层打字 / 'result' 底部窄条看正文。
    // 顶部长条的老实现被 navigationStyle:custom 的两个雷区夹死了 ——
    // top:0 让搜索框埋进状态栏，右上角胶囊又压住上下跳转按钮。
    searchPhase: 'off',
    searchKeyword: '',
    searchResults: [],
    currentSearchIdx: -1,
    // 输入框聚焦由状态字段控制，不绑 searchPhase：
    // 按下「搜索」后要留在浮层看结果，键盘必须先让开。
    searchFocus: false,
    // 已确认（按过「搜索」）的关键词。与 searchKeyword 分开存：
    // 后者边打字边变，正文高亮不能跟着抖。
    searchActiveKeyword: '',
    // 结果列表要滚到哪一条（scroll-into-view 的 id，'' = 不干预）
    resultScrollId: '',
    // 键盘高度（px）。自己接管而不用 adjust-position，
    // 否则页面被系统上推，居中浮层会漂到 iOS/Android 各不相同的位置。
    keyboardHeight: 0,

    // 多文件队列
    showFileQueue: false,
    fileQueue: [],
    activeQueueIdx: 0,

    // 进度
    progressPercent: 0,
    progressText: '',

    // 降级/截断提示（§3.2「降级必须可见」）
    truncated: false,
    degradeNotice: '',
    // 粘贴内容默认不落盘，需要用户显式保存（E10）
    canSaveClipboard: false,
    searchTruncated: false,
    // 隐私授权弹窗
    showPrivacy: false,

    // 设置
    fontSize: 16,
    lineHeight: 1.8,
    fontFamily: 'system'
  },

  // ─── 内部状态（不参与 setData）───
  _blocks: [],
  _layout: null,          // renderMod.createLayout()，块高前缀和索引
  _viewportRpx: 0,
  _screenWidth: 375,
  _rpxRatio: 2, // rpx / px = 750 / screenWidth
  _scrollTimer: null,
  _progressTimer: null,
  _measureTimer: null,
  _lastScrollTopRpx: 0,
  _loadNotices: [],
  _pendingClipboardText: null,
  _renderSettings: null,
  _isProgrammaticScroll: false,
  _pendingScrollTopRpx: 0,
  _settingsUnsubscribe: null,
  _destroyed: false,
  _hlKeyword: '',         // 正文高亮用的小写关键词（'' = 不高亮）
  _hitBlockSet: null,     // { blockIndex: true }，命中块整体着色用

  // ─── 生命周期 ───

  onLoad: function(options) {
    // ⚠️ 页面销毁后仍会执行的异步回调，是本项目最难查的一类故障来源。
    //
    // 这一页的异步回调遍地都是：intake 的 Promise 链、解析前让帧的 setTimeout、
    // SelectorQuery.exec 的测量回调、恢复进度的两层嵌套 setTimeout……
    // 用户在文档还在加载时点了返回（或微信因内存告警销毁了页面），
    // 这些回调照样会跑到，然后对着一个已经销毁的页面实例调 setData。
    // 真机上轻则控制台报错，重则整页白屏，而且模拟器几乎复现不出来。
    //
    // 在几十个回调里逐个写守卫必然会漏，所以在入口处一次性拦掉。
    // （iOS 15 及以下 Promise 是 setTimeout 模拟的宏任务，回调时机比标准环境更晚，
    //   撞上销毁的概率还要更高一些 —— 官方 js-support 文档明确写了这一点。）
    var rawSetData = this.setData.bind(this);
    this._rawSetData = rawSetData;
    this.setData = function(data, cb) {
      if (this._destroyed) return;
      return rawSetData(data, cb);
    }.bind(this);

    this.measureViewport();

    // 应用主题和设置
    this.applySettings();

    // 解析来源参数
    var source = options.source || '';
    var name = options.name ? decodeURIComponent(options.name) : '未命名';
    var size = parseInt(options.size) || 0;
    var fileId = options.fileId || '';

    this.setData({
      source: source,
      fileName: name,
      fileSize: size,
      fileId: fileId
    });

    // 屏幕常亮
    if (app.globalData.settings && app.globalData.settings.keepScreenOn) {
      wx.setKeepScreenOn(true);
    }

    // 加载内容
    this.loadContent(source, options.file);

    // 注册到多文件队列
    this.registerInQueue(source, name, options.file, fileId);
  },

  /**
   * 测量视口，算出虚拟滚动依赖的三个量
   *
   * 拆成独立方法是为了让 onResize 能原样再跑一遍 —— 见 onResize 的注释。
   */
  measureViewport: function() {
    var sys = app.globalData.systemInfo || wx.getSystemInfoSync();
    var statusBarHeight = sys.statusBarHeight || 20;
    var navContent = sys.platform === 'android' ? 48 : 44;

    this._screenWidth = sys.windowWidth || 375;
    this._rpxRatio = 750 / this._screenWidth;

    var viewportPx = (sys.windowHeight || 667) - statusBarHeight - navContent - 50;
    this._viewportRpx = viewportPx * this._rpxRatio;

    this.setData({
      statusBarHeight: statusBarHeight,
      navBarHeight: statusBarHeight + navContent,
      toolbarHeight: 50 * this._rpxRatio +
        (sys.safeArea ? (sys.screenHeight - sys.safeArea.bottom) * this._rpxRatio : 0)
    });
  },

  /**
   * 窗口尺寸变化（横竖屏、iPad、PC 拉伸窗口、Android 分屏、折叠屏展开）
   *
   * ⚠️ 这是**平台侧最容易被忽略、后果又最重**的一类变化。
   * 虚拟滚动的每一个数字都建立在「屏宽固定」这个假设上：
   *   _rpxRatio = 750 / 屏宽    —— 换算 px ⇄ rpx
   *   _viewportRpx              —— 决定可见区间
   *   块高预估                  —— 按屏宽算每行能放多少字
   * 窗口一变，三者同时失真：占位高度对不上真实高度，滚动条长度错乱，
   * 页面会突然跳到一个完全无关的位置，看起来像「内容乱了」。
   *
   * PC 端微信可以随手拉伸窗口，iPad 和折叠屏更是随时触发，
   * 不是小概率场景。这里按 E1b 的同一套办法处理：
   * 先把当前位置换算成「块索引 + 块内比例」这个与像素无关的表示，
   * 重新测量、重估全部块高，再换算回新的 scrollTop。
   *
   * 注意 onResize 需要页面 json 里 "resizable": true 才会在 iPad 上触发；
   * PC 端和 Android 分屏无需配置即可触发。
   */
  onResize: function() {
    var hadLayout = this._layout && this._blocks.length > 0;
    var progress = hadLayout
      ? renderMod.layoutToProgress(this._layout, this._lastScrollTopRpx)
      : null;

    this.measureViewport();
    // 屏宽变了，renderSettings 里的 screenWidth 也变了，预估高度必须重算
    this._renderSettings = null;

    if (!hadLayout) return;

    this._layout.reestimate(this.renderSettings());
    this._lastScrollTopRpx = renderMod.progressToLayoutTop(
      this._layout, progress.blockIndex, progress.ratio
    );
    this.setData({ contentHeight: this._layout.total() });
    this.updateVisibleRange(this._lastScrollTopRpx, true);
    this.scrollTo(this._lastScrollTopRpx);
  },

  /**
   * 内存告警时的自救（由 app.releaseMemory 调用）
   *
   * 当前文档不能丢 —— 丢了用户正在读的东西才是真事故。
   * 能丢的是渲染侧的冗余：非虚拟滚动模式下 visibleBlocks 里躺着整份文档的副本
   * （逻辑层一份 + 视图层一份），这时候切到虚拟滚动能立刻省掉视图层那份。
   */
  onLowMemory: function() {
    if (this.data.useVirtualScroll || this._blocks.length === 0) return;
    this.setData({ useVirtualScroll: true, visibleBlocks: [] });
    this.updateVisibleRange(this._lastScrollTopRpx, true);
  },

  // ─── 转发（Edge E3）───
  // 只分享小程序卡片，不带任何文件信息，理由见 app.js 的 shareCard 注释。
  // 本页**不提供朋友圈分享**：朋友圈不能自定义 path，分享出去的就是当前页，
  // 接收方在单页模式打开只会得到一个用不了的页面。详见 app.enableShareMenu 注释。

  onShareAppMessage: function() {
    return app.shareCard();
  },


  onShow: function() {
    // 从设置页返回时刷新设置
    this.applySettings();
    // 转发菜单要在页面显示后再开（onLoad 时页面还没上屏，调用可能被忽略）
    app.enableShareMenu();
    // 如果已有内容，重新计算高度预估
    if (this._blocks.length > 0 && this.data.useVirtualScroll) {
      this.updateVisibleRange(this._lastScrollTopRpx);
    }
  },

  /**
   * onHide 才是持久化的唯一可靠时机
   *
   * 小程序进后台 5 秒后微信就会挂起 JS 线程，挂满 30 分钟直接销毁；
   * iOS 收到内存告警时更是立即销毁 —— 这两条路径**都不会触发 onUnload**。
   * 所以进度必须在 onHide 落盘，不能指望 onUnload 兜底（Edge D11）。
   */
  onHide: function() {
    this.saveReadingProgress();
    this.saveCurrentToQueue();
  },

  onUnload: function() {
    // 先落盘再拆东西：下面会清掉 _blocks/_layout，顺序反了就存不出进度
    this.saveReadingProgress();
    this.saveCurrentToQueue();

    this._destroyed = true;
    wx.setKeepScreenOn(false);

    // ⚠️ 三个定时器都要清。
    // 官方内存优化文档把「未清理的 setTimeout/setInterval」列为泄漏首因：
    // 定时器持有闭包 → 闭包持有页面实例 → 整份文档 IR 跟着一起留在内存里，
    // 页面明明已经关了却回收不掉。以前这里只清了 _scrollTimer。
    var timers = ['_scrollTimer', '_progressTimer', '_measureTimer'];
    for (var i = 0; i < timers.length; i++) {
      if (this[timers[i]]) {
        clearTimeout(this[timers[i]]);
        this[timers[i]] = null;
      }
    }

    // 主动断开对文档 IR 的引用，别等 GC 自己想明白
    this._blocks = [];
    this._layout = null;

    // 清空文件队列（页面销毁时）
    app.globalData.fileQueue = [];
    app.globalData.activeQueueIdx = -1;
  },

  // ─── 隐私授权 ───
  //
  // 阅读页也会用到隐私接口（复制链接 / 复制代码走 wx.setClipboardData）。
  // 以前这里没有自定义弹窗，app.js 退化成 wx.showModal 兜底 ——
  // 而原生 modal 里放不进 <button open-type="agreePrivacyAuthorization">，
  // 那条路的「同意」压根没法带 buttonId 正确回传给微信。

  showPrivacyDialog: function() {
    this.setData({ showPrivacy: true });
  },

  grantPrivacy: function(e) {
    this.setData({ showPrivacy: false });
    app.resolvePrivacy(true, e && e.detail && e.detail.buttonId);
  },

  denyPrivacy: function() {
    this.setData({ showPrivacy: false });
    app.resolvePrivacy(false);
  },

  // ─── 设置 ───

  applySettings: function() {
    var s = app.globalData.settings || {};
    var theme = s.theme || 'light';
    var nextFontSize = s.fontSize || 16;
    var nextLineHeight = s.lineHeight || 1.8;
    var typographyChanged = nextFontSize !== this.data.fontSize ||
      nextLineHeight !== this.data.lineHeight;

    this.setData({
      themeClass: 'theme-' + theme,
      fontSize: nextFontSize,
      lineHeight: nextLineHeight,
      fontFamily: s.fontFamily || 'system'
    });

    // E1b：字号/行距一变，之前测出的真实高度全部作废，
    // 必须清缓存重估，否则占位高度与实际渲染高度对不上，滚动会跳。
    // 进度用「块索引 + 块内比例」保存，天然免疫这次重估。
    if (typographyChanged && this._layout && this._blocks.length > 0) {
      var progress = renderMod.layoutToProgress(this._layout, this._lastScrollTopRpx);
      this._layout.reestimate(this.renderSettings());
      this._lastScrollTopRpx = renderMod.progressToLayoutTop(
        this._layout, progress.blockIndex, progress.ratio
      );
      this.setData({ contentHeight: this._layout.total() });
      this.updateVisibleRange(this._lastScrollTopRpx, true);
    }
  },

  /**
   * 当前排版设置（estimateHeight 需要）
   * 保持对象身份稳定，避免 estimateHeight 每次重新归一化
   */
  renderSettings: function() {
    if (!this._renderSettings ||
        this._renderSettings.fontSize !== this.data.fontSize ||
        this._renderSettings.lineHeight !== this.data.lineHeight ||
        this._renderSettings.screenWidth !== this._screenWidth) {
      this._renderSettings = {
        fontSize: this.data.fontSize,
        lineHeight: this.data.lineHeight,
        screenWidth: this._screenWidth
      };
    }
    return this._renderSettings;
  },

  // ─── 内容加载 ───

  loadContent: function(source, file) {
    this._loadNotices = [];
    this._pendingClipboardText = null;
    this.setData({ canSaveClipboard: false, degradeNotice: '', truncated: false });

    if (source === 'clipboard') {
      this.loadClipboardContent();
    } else if (source === 'sample') {
      this.loadSampleContent(file);
    } else if (source === 'file' || source === 'recent' || source === 'material') {
      this.loadFileContent(source);
    } else {
      this.setData({ loading: false, error: '未指定内容来源' });
    }
  },

  loadClipboardContent: function() {
    var self = this;
    var text = app.globalData.pendingText;
    app.globalData.pendingText = null;

    if (!text || text.trim().length === 0) {
      this.setData({ loading: false, error: '剪贴板为空' });
      return;
    }

    // 格式检测
    var formatResult = detect.detectFormat('clipboard.txt', text.slice(0, 1024));

    // E10：粘贴内容默认**不落盘**。
    // 剪贴板里常常是刚从别处复制的敏感内容（聊天记录、口令、私密文档），
    // 静默写进 USER_DATA_PATH 并登记到「最近」是隐私事故。
    // 只留在本次会话内存里，另给显式的「保存到最近」按钮。
    this._pendingClipboardText = text;
    this.setData({ canSaveClipboard: true });

    this.parseAndRender(text, formatResult.format, 'UTF-8');
  },

  /**
   * 用户显式把粘贴内容保存到「最近」（E10）
   */
  saveClipboardToRecent: function() {
    var self = this;
    var text = this._pendingClipboardText;
    if (!text) return;

    var stableId = intake.generateStableId('clipboard', text.length);
    var meta = {
      id: stableId,
      name: '粘贴文本 ' + this.formatStamp(),
      size: text.length,
      format: this.data.format,
      encoding: 'UTF-8',
      localPath: '',
      createdAt: Date.now(),
      openedAt: Date.now()
    };

    intake.saveTextToFile(text, stableId).then(function(path) {
      meta.localPath = path;
      self.data.fileMeta = meta;
      self.setData({ fileId: stableId, canSaveClipboard: false });
      store.saveMeta(meta);
      store.addToRecent({
        id: meta.id,
        name: meta.name,
        size: meta.size,
        format: meta.format,
        localPath: meta.localPath,
        openedAt: meta.openedAt
      });
      wx.showToast({ title: '已保存到最近', icon: 'success' });
    }).catch(function() {
      wx.showToast({ title: '保存失败', icon: 'none' });
    });
  },

  formatStamp: function() {
    var d = new Date();
    return (d.getMonth() + 1) + '-' + d.getDate() + ' ' +
      ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  },

  loadSampleContent: function(file) {
    var entry = samples[file] || samples['sample.txt'];
    if (!entry) {
      this.setData({ loading: false, error: '示例文档缺失' });
      return;
    }
    // 示例文档的格式是确定的，直接用声明值。
    // 走内容嗅探反而有风险：TXT 示例里的编号列表会被认成 Markdown，
    // 而这三份示例正是审核员唯一能测的内容（F7）。
    this.parseAndRender(entry.text, entry.format, 'UTF-8');
  },

  loadFileContent: function(source) {
    var self = this;
    var file = app.globalData.pendingFile;
    app.globalData.pendingFile = null;

    if (!file || !file.path) {
      // 尝试从 recent 恢复
      if (source === 'recent' && this.data.fileId) {
        var meta = store.getMeta(this.data.fileId);
        if (meta && meta.localPath) {
          file = { path: meta.localPath, name: meta.name, size: meta.size };
        }
      }
      if (!file) {
        this.setData({ loading: false, error: '文件信息丢失' });
        return;
      }
    }

    this.setData({ loadingText: '正在读取文件...' });

    var localMeta = null;
    if (file.path.indexOf(wx.env.USER_DATA_PATH) === 0 && this.data.fileId) {
      var m = store.getMeta(this.data.fileId);
      if (m && m.localPath) localMeta = m;
    }

    var primary = localMeta
      ? intake.loadFromLocal(localMeta)
      : intake.loadFile(file);

    primary
      .catch(function(err) {
        // 二进制文件是明确结论，不该再退回去重试一遍
        if (err && err.code === 'BINARY') throw err;
        if (!localMeta) throw err;
        // 本地副本可能已被清理，退回按新文件加载
        console.warn('[reader] 本地副本加载失败，改按新文件加载', err);
        self.setData({ loadingText: '正在重新加载...' });
        return intake.loadFile(file);
      })
      .then(function(result) {
        self.applyLoadResult(result);
      })
      .catch(function(err) {
        console.error('加载文件失败', err);
        self.setData({
          loading: false,
          error: (err && err.message) || (err && err.errMsg) || '文件加载失败，文件可能已被删除'
        });
      });
  },

  /**
   * 统一处理 intake 的加载结果
   * （三条加载路径以前各写了一遍一模一样的 then，改一处漏两处）
   */
  applyLoadResult: function(result) {
    this.data.fileMeta = result.meta;
    this.setData({
      fileId: result.meta.id,
      fileName: result.meta.name,
      fileSize: result.meta.size,
      encoding: result.encoding,
      format: result.format
    });

    // 空文件（B8）：明确说明，不要留一个"暂无内容"让用户猜
    if (result.empty) {
      this.setData({ loading: false, error: '这是一个空文件（0 字节）' });
      return;
    }

    this._loadNotices = result.notices || [];
    this.parseAndRender(result.text, result.format, result.encoding);
  },

  // ─── 解析与渲染 ───

  parseAndRender: function(text, format, encoding) {
    var self = this;
    // setData 是异步的：紧接着同步解析的话，"正在解析文档..." 这一帧根本没机会画出来，
    // 用户看到的是一个卡住不动的旧界面。让出一次事件循环，先把状态渲染出去。
    // （解析本身仍在主线程 —— Worker 化的阻塞见 docs/verify-notes.md）
    this.setData({ loadingText: '正在解析文档...' }, function() {
      setTimeout(function() { self._doParseAndRender(text, format, encoding); }, 0);
    });
  },

  _doParseAndRender: function(text, format, encoding) {
    var self = this;

    // 解析
    var result;
    try {
      result = parseMod.parse(text, format);
    } catch (e) {
      console.error('[reader] 解析失败', e);
      this.setData({ loading: false, error: '文档解析失败：' + (e && e.message || '未知错误') });
      return;
    }
    this._blocks = result.blocks;
    this._layout = null;

    // ─── HTML 后处理（C10/F2/F9）───
    if (format === 'html' || format === 'htm') {
      // 1. IR 大小安全检查（parse bomb 保护）
      var sizeCheck = postprocess.checkIRSize(result);
      if (!sizeCheck.ok) {
        this.setData({
          loading: false,
          error: '文档过大，可能无法正常显示（' + sizeCheck.reason + '）'
        });
        return;
      }

      // 2. 网络图片门控（F9）
      var networkEnabled = !!(app.globalData.settings && app.globalData.settings.networkImages);
      postprocess.gateNetworkImages(this._blocks, networkEnabled);

      // 3. base64 大图抽取（C10，异步）
      if (result.hasBase64) {
        this.setData({ loadingText: '正在处理图片...' });
        var cacheDir = wx.env.USER_DATA_PATH + '/img_cache';
        var fs = wx.getFileSystemManager();

        // 确保缓存目录存在
        try { fs.mkdirSync(cacheDir, true); } catch (e) { /* 目录已存在 */ }

        var writeCallback = function(base64Data, filePath) {
          return new Promise(function(resolve, reject) {
            try {
              var binary = wx.base64ToArrayBuffer(base64Data);
              fs.writeFile({
                filePath: filePath,
                data: binary,
                encoding: 'binary',
                success: function() { resolve(); },
                fail: function(err) { reject(err); }
              });
            } catch (e) {
              reject(e);
            }
          });
        };

        postprocess.extractBase64Images(self._blocks, {
          writeCallback: writeCallback,
          cacheDir: cacheDir
        }).then(function() {
          // 抽取完成后继续渲染
          self._finalizeRender(result, format, encoding);
        }).catch(function(err) {
          console.warn('[reader] base64 图片抽取失败:', err);
          // 失败不阻塞，继续渲染（base64 保留内联）
          self._finalizeRender(result, format, encoding);
        });
        return; // 异步路径，等抽取完成后再渲染
      }
    }

    this._finalizeRender(result, format, encoding);
  },

  _finalizeRender: function(result, format, encoding) {
    var self = this;

    // 块数组整个换掉了，旧搜索的命中下标全部作废
    this.resetSearchState();

    // 行内树展平为渲染段（避免 WXML 递归模板）
    for (var i = 0; i < this._blocks.length; i++) {
      var b = this._blocks[i];
      // HTML 解析器已设置 segments，仅在缺失时重新计算
      if (b.children && !b.segments) {
        b.segments = inlineMod.flattenInline(b.children);
      }
      // 代码块：尝试语法高亮
      if (b.type === 'code' && b.text && b.lang) {
        if (highlightMod.isSupported(b.lang)) {
          b.tokens = highlightMod.highlight(b.text, b.lang);
          b.highlighted = true;
        }
      }
    }

    // 建立块高前缀和索引（滚动路径的全部计算都基于它）
    this._layout = renderMod.createLayout(this._blocks, this.renderSettings());

    // 判断是否启用虚拟滚动
    var useVS = this._blocks.length > VIRTUAL_SCROLL_THRESHOLD;
    var totalH = this._layout.total();

    this.setData({
      loading: false,
      error: '',
      encoding: encoding,
      format: format,
      toc: result.toc,
      truncated: !!result.truncated,
      degradeNotice: this.summarizeDegraded(result.degraded),
      useVirtualScroll: useVS,
      contentHeight: totalH,
      visibleBlocks: useVS ? [] : this.decorateSearch(this._blocks),
      topSpacerHeight: 0,
      bottomSpacerHeight: useVS ? totalH : 0
    });

    // 恢复进度
    if (this.data.fileId) {
      this.restoreProgress();
    } else {
      // 无进度可恢复，初始渲染
      if (useVS) {
        this.updateVisibleRange(0);
      }
    }

    // 保存解析结果到文件队列
    var qIdx = this.data.activeQueueIdx;
    if (qIdx >= 0 && qIdx < app.globalData.fileQueue.length) {
      var qEntry = app.globalData.fileQueue[qIdx];
      qEntry.blocks = this._blocks;
      qEntry.layout = this._layout;
      qEntry.toc = result.toc;
      qEntry.encoding = encoding;
      qEntry.format = format;
      // ⚠️ 必须把本地副本路径记进队列条目。
      // 队列缓存受 QUEUE_CACHE_LIMIT 限制，也会被内存告警清空；
      // 被淘汰后切回这个文件时要重新加载，而 source='file' 那条路
      // 唯一的文件信息来源是 globalData.pendingFile —— 它在首次加载时就已被消费置空。
      // 结果是「切回刚才那个文件」必然报『文件信息丢失』。存下 localPath 才能重来。
      qEntry.localPath = (this.data.fileMeta && this.data.fileMeta.localPath) || '';
      qEntry.fileId = this.data.fileId || qEntry.fileId;
      qEntry.size = this.data.fileSize || 0;
      // 队列面板显示的 format/encoding 到这一步才确定，补一次投影
      this.syncQueueView();
    }
    this.trimQueueCache();
  },

  /**
   * 把降级信息汇总成一句可见的提示（§3.2「降级必须可见」）
   * 用户看到"这里被截断了/有内容显示不了"，远好于看到一片空白怀疑文件坏了。
   */
  summarizeDegraded: function(degraded) {
    var messages = (this._loadNotices || []).slice();
    if (degraded) {
      for (var i = 0; i < degraded.length; i++) {
        var d = degraded[i];
        if (d && d.message && messages.indexOf(d.message) < 0) {
          messages.push(d.message);
        }
      }
    }
    return messages.slice(0, 3).join('；');
  },

  /**
   * 只保留最近 QUEUE_CACHE_LIMIT 份解析结果（D20：长时间读多份文档后内存累积）
   * 被淘汰的条目下次切回去时重新解析，比闪退强。
   */
  trimQueueCache: function() {
    var queue = app.globalData.fileQueue;
    var active = this.data.activeQueueIdx;
    var cached = [];
    for (var i = 0; i < queue.length; i++) {
      if (queue[i].blocks) cached.push(i);
    }
    for (var k = 0; k < cached.length - QUEUE_CACHE_LIMIT; k++) {
      var idx = cached[k];
      if (idx === active) continue;
      queue[idx].blocks = null;
      queue[idx].layout = null;
    }
  },

  // ─── 虚拟滚动 ───

  onScroll: function(e) {
    if (this._isProgrammaticScroll) {
      return;
    }

    // 节流窗口内也要记下最新位置：
    // 只在窗口开头取一次的话，16ms 后用的是已经过时的 scrollTop，
    // 快速滑动时可见范围会稳定落后一截。
    this._pendingScrollTopRpx = e.detail.scrollTop * this._rpxRatio;

    // 节流：16ms 内只处理一次
    if (this._scrollTimer) {
      return;
    }

    var self = this;
    this._scrollTimer = setTimeout(function() {
      self._scrollTimer = null;
      var scrollTopRpx = self._pendingScrollTopRpx;
      self._lastScrollTopRpx = scrollTopRpx;

      if (self.data.useVirtualScroll) {
        self.updateVisibleRange(scrollTopRpx);
      }

      // 更新进度显示（节流）
      self.updateProgressDisplay(scrollTopRpx);
    }, 16);
  },

  updateVisibleRange: function(scrollTopRpx, force) {
    if (!this.data.useVirtualScroll || !this._layout || this._blocks.length === 0) {
      return;
    }

    var range = renderMod.visibleRange(
      this._layout, scrollTopRpx, this._viewportRpx, 2
    );

    // 可见范围没变时，仍要把 spacer 刷新一遍：
    // 高度回填会改变 offsetTop/offsetBottom，
    // 以前这里直接 return（注释还写着"只更新 spacer"却什么都没更新），
    // 于是占位高度停在旧值，滚动条长度和内容对不上。
    var currentFirst = this.data.visibleBlocks.length > 0
      ? this.data.visibleBlocks[0]._vIndex : -1;
    var sameRange = !force &&
      currentFirst === range.startIndex &&
      this.data.visibleBlocks.length === (range.endIndex - range.startIndex);

    if (sameRange) {
      if (Math.abs(this.data.topSpacerHeight - range.offsetTop) > 1 ||
          Math.abs(this.data.bottomSpacerHeight - range.offsetBottom) > 1) {
        this.setData({
          topSpacerHeight: range.offsetTop,
          bottomSpacerHeight: range.offsetBottom
        });
      }
      return;
    }

    var renderData = renderMod.getRenderData(this._blocks, range);

    this.setData({
      visibleBlocks: this.decorateSearch(renderData.visibleBlocks),
      topSpacerHeight: renderData.topSpacer,
      bottomSpacerHeight: renderData.bottomSpacer
    });

    // 延迟测量高度
    this.scheduleHeightMeasurement();
  },

  scheduleHeightMeasurement: function() {
    if (this._measureTimer) {
      clearTimeout(this._measureTimer);
    }
    var self = this;
    this._measureTimer = setTimeout(function() {
      self.measureHeights();
    }, 100);
  },

  measureHeights: function() {
    if (!this.data.visibleBlocks || this.data.visibleBlocks.length === 0) {
      return;
    }

    var self = this;
    var query = wx.createSelectorQuery().in(this);

    // 为每个可见块创建选择器
    for (var i = 0; i < this.data.visibleBlocks.length; i++) {
      var block = this.data.visibleBlocks[i];
      query.select('#block-' + block._vIndex).boundingClientRect();
    }

    query.exec(function(res) {
      if (!res || !res[0] || !self._layout) return;

      var layout = self._layout;
      var scrollTop = self._lastScrollTopRpx;
      var hasChanges = false;
      // D13：只有"已经滚过去的"块（整块都在视口上方）变高变矮，
      // 才需要反向补偿 scrollTop；视口内和视口下方的块变化不该动位置。
      var compensation = 0;

      for (var i = 0; i < res.length; i++) {
        if (!res[i]) continue;
        var block = self.data.visibleBlocks[i];
        if (!block) continue;
        var vIndex = block._vIndex;
        var measuredRpx = res[i].height * self._rpxRatio;
        var oldRpx = layout.height(vIndex);

        if (Math.abs(measuredRpx - oldRpx) <= 2) continue;

        // 补偿判断必须用「回填前」的位置，所以先取 offset 再 setHeight
        var blockTop = layout.offset(vIndex);
        var delta = layout.setHeight(vIndex, measuredRpx);
        hasChanges = true;

        if (blockTop + oldRpx <= scrollTop) {
          compensation += delta;
        }
      }

      if (!hasChanges) return;

      self.setData({ contentHeight: layout.total() });

      if (Math.abs(compensation) > 1) {
        var newScrollTopRpx = Math.max(0, scrollTop + compensation);
        self._isProgrammaticScroll = true;
        self._lastScrollTopRpx = newScrollTopRpx;
        self.setData({ scrollTopPx: newScrollTopRpx / self._rpxRatio });
        setTimeout(function() {
          self._isProgrammaticScroll = false;
        }, 50);
      }

      // 高度变了，占位高度必须跟着刷新
      self.updateVisibleRange(self._lastScrollTopRpx, true);
    });
  },

  // ─── 进度系统 ───

  updateProgressDisplay: function(scrollTopRpx) {
    if (this._blocks.length === 0 || !this._layout) return;

    var progress = renderMod.layoutToProgress(this._layout, scrollTopRpx);

    var percent = Math.round((progress.blockIndex / this._blocks.length) * 100);
    
    // 更新目录当前标题高亮
    var currentTocId = '';
    if (this.data.toc.length > 0) {
      for (var ti = this.data.toc.length - 1; ti >= 0; ti--) {
        if (this.data.toc[ti].blockIndex <= progress.blockIndex) {
          currentTocId = this.data.toc[ti].id;
          break;
        }
      }
    }

    if (percent !== this.data.progressPercent) {
      this.setData({
        progressPercent: percent,
        progressText: percent + '%',
        currentTocId: currentTocId
      });
    } else if (currentTocId !== this.data.currentTocId) {
      this.setData({ currentTocId: currentTocId });
    }

    // 防抖保存进度
    if (this._progressTimer) {
      clearTimeout(this._progressTimer);
    }
    var self = this;
    this._progressTimer = setTimeout(function() {
      self.saveReadingProgress();
    }, 2000);
  },

  saveReadingProgress: function() {
    if (!this.data.fileId || this._blocks.length === 0 || !this._layout) return;

    var progress = renderMod.layoutToProgress(this._layout, this._lastScrollTopRpx);
    store.saveProgress(this.data.fileId, progress.blockIndex, progress.ratio);
  },

  restoreProgress: function() {
    if (!this.data.fileId) {
      if (this.data.useVirtualScroll) {
        this.updateVisibleRange(0);
      }
      return;
    }

    var saved = store.getProgress(this.data.fileId);
    if (!saved) {
      if (this.data.useVirtualScroll) {
        this.updateVisibleRange(0);
      }
      return;
    }

    var scrollTopRpx = renderMod.progressToLayoutTop(
      this._layout, saved.blockIndex, saved.ratio
    );

    this._lastScrollTopRpx = scrollTopRpx;
    var scrollTopPx = scrollTopRpx / this._rpxRatio;

    // 先渲染可见区域，再滚动
    if (this.data.useVirtualScroll) {
      this.updateVisibleRange(scrollTopRpx);
    }

    // 延迟设置 scrollTop，确保内容已渲染
    var self = this;
    this._isProgrammaticScroll = true;
    setTimeout(function() {
      self.setData({ scrollTopPx: scrollTopPx });
      // 更新进度显示
      self.updateProgressDisplay(scrollTopRpx);
      setTimeout(function() {
        self._isProgrammaticScroll = false;
      }, 100);
    }, 200);
  },

  // ─── 编码切换 ───

  switchEncoding: function() {
    if (!this.data.fileMeta || !this.data.fileMeta.localPath) {
      wx.showToast({ title: '当前内容不支持编码切换', icon: 'none' });
      return;
    }

    var self = this;
    var encodings = ['UTF-8', 'GBK', 'GB18030', 'Big5', 'UTF-16LE', 'UTF-16BE'];
    var currentIdx = encodings.indexOf(this.data.encoding);

    wx.showActionSheet({
      itemList: encodings.map(function(e, i) {
        return e + (i === currentIdx ? ' (当前)' : '');
      }),
      success: function(res) {
        var newEnc = encodings[res.tapIndex];
        if (newEnc === self.data.encoding) return;
        self.reDecodeWithEncoding(newEnc);
      }
    });
  },

  reDecodeWithEncoding: function(encoding) {
    var self = this;
    this.setData({ loading: true, loadingText: '正在重新解码...' });

    intake.reDecode(this.data.fileMeta, encoding).then(function(result) {
      self.setData({ encoding: result.encoding });
      // 重新解析和渲染
      var formatResult = detect.detectFormat(self.data.fileMeta.name, result.text.slice(0, 1024));
      self.parseAndRender(result.text, formatResult.format, result.encoding);
      wx.showToast({ title: '已切换为 ' + encoding, icon: 'none' });
    }).catch(function(err) {
      console.error('编码切换失败', err);
      self.setData({ loading: false });
      wx.showToast({ title: '编码切换失败', icon: 'none' });
    });
  },

  // ─── 目录 ───

  toggleToc: function() {
    this.setData({ showToc: !this.data.showToc });
  },

  closeToc: function() {
    this.setData({ showToc: false });
  },

  jumpToHeading: function(e) {
    var blockIndex = e.currentTarget.dataset.index;
    if (typeof blockIndex !== 'number' || blockIndex < 0 || blockIndex >= this._blocks.length) {
      return;
    }

    var scrollTopRpx = renderMod.progressToLayoutTop(this._layout, blockIndex, 0);

    this._lastScrollTopRpx = scrollTopRpx;
    var scrollTopPx = scrollTopRpx / this._rpxRatio;

    if (this.data.useVirtualScroll) {
      this.updateVisibleRange(scrollTopRpx);
    }

    var self = this;
    this._isProgrammaticScroll = true;
    this.setData({
      showToc: false,
      scrollTopPx: scrollTopPx
    });
    setTimeout(function() {
      self._isProgrammaticScroll = false;
    }, 200);
  },

  // ─── 搜索（Phase 2） ───

  /**
   * 底部工具栏「搜索」：off/result → input，input → 整体关闭
   *
   * 从 result 回 input 时保留 searchKeyword 与 searchResults，
   * 用户改个字继续搜，不用从头打。
   */
  toggleSearch: function() {
    if (this.data.searchPhase === 'input') {
      // 浮层开着时再点一次 = 收工：连同正文高亮一起撤掉，
      // 只切 phase 会留下一屏没人管的黄底。
      this.closeSearch();
      return;
    }
    this.setData({ searchPhase: 'input', searchFocus: true });
  },

  /** 结果态窄条上点关键词 → 回到输入态改词 */
  backToSearchInput: function() {
    this.setData({
      searchPhase: 'input',
      searchFocus: true,
      // 列表重新展开时把当前那条滚进视野：几十条结果里不该让人再找一遍
      resultScrollId: this.data.currentSearchIdx >= 0
        ? 'res-' + this.data.currentSearchIdx : ''
    });
  },

  closeSearch: function() {
    this.resetSearchState();
    this.refreshSearchHighlight();
  },

  /**
   * 清空全部搜索状态。
   *
   * 换文档、重解析都必须调它：_hitBlockSet 存的是块下标，
   * 换了文档还留着，等于拿旧文档的命中位置去给新文档涂色。
   */
  resetSearchState: function() {
    this._hlKeyword = '';
    this._hitBlockSet = null;
    this.setData({
      searchPhase: 'off',
      searchKeyword: '',
      searchActiveKeyword: '',
      searchResults: [],
      currentSearchIdx: -1,
      searchTruncated: false,
      searchFocus: false,
      resultScrollId: '',
      keyboardHeight: 0
    });
  },

  onSearchInput: function(e) {
    this.setData({ searchKeyword: e.detail.value });
  },

  /**
   * 输入框里的「✕」= 从头再来：连上一轮的结果和正文高亮一起撤掉。
   * 只清输入框会留下一份对不上号的旧结果列表 —— 词已经没了，列表还在。
   */
  clearSearch: function() {
    this._hlKeyword = '';
    this._hitBlockSet = null;
    this.setData({
      searchKeyword: '',
      searchActiveKeyword: '',
      searchResults: [],
      currentSearchIdx: -1,
      searchTruncated: false,
      resultScrollId: '',
      searchFocus: true
    });
    this.refreshSearchHighlight();
  },

  /**
   * 输入框真实的聚焦状态要回写到 searchFocus。
   *
   * 收键盘靠的是 focus 属性从 true 变 false 这个「变化」：
   * 用户手点输入框聚焦时框架不会替我们改 searchFocus，
   * 不回写的话它一直是 false，按下「搜索」时那次 setData 就不构成变化，
   * 没有 wx.hideKeyboard 的低版本基础库上键盘会一直杵在结果列表前面。
   */
  onSearchFocus: function() {
    if (!this.data.searchFocus) this.setData({ searchFocus: true });
  },

  onSearchBlur: function() {
    if (this.data.searchFocus) this.setData({ searchFocus: false });
  },

  /**
   * 键盘升降 → 压缩遮罩的可用高度，浮层在剩余空间里居中，自然被顶到键盘上方。
   * 比手算 top 稳：不用关心机型状态栏、也不用关心键盘带不带候选词栏。
   */
  onKeyboardHeightChange: function(e) {
    this.setData({ keyboardHeight: (e.detail && e.detail.height) || 0 });
  },

  /** 浮层卡片内部吞掉点击，避免冒泡到遮罩把搜索关掉 */
  noopTap: function() {},

  // ─── 链接处理（F1：外链不跳转，确认后复制）───

  onLinkTap: function(e) {
    var href = e.currentTarget.dataset.href;
    if (!href) return;
    var self = this;
    wx.showModal({
      title: '打开链接',
      content: '小程序无法直接打开外部链接，是否复制到剪贴板？\n\n' + href,
      confirmText: '复制',
      cancelText: '取消',
      success: function(res) {
        if (res.confirm) {
          self.copyToClipboard(href, '已复制');
        }
      }
    });
  },

  // ─── 代码复制 ───

  copyCode: function(e) {
    var text = e.currentTarget.dataset.text;
    if (!text) return;
    this.copyToClipboard(text, '代码已复制');
  },

  /**
   * 写剪贴板
   *
   * 剪贴板也是受管控的隐私接口：后台《用户隐私保护指引》没声明「读取你的剪切板」时，
   * 这里会直接 fail。以前没有 fail 回调 —— 用户点了「复制」什么都不会发生，
   * 也不知道为什么，这是最难自查的一类故障。
   */
  copyToClipboard: function(data, okTitle) {
    wx.setClipboardData({
      data: data,
      success: function() {
        wx.showToast({ title: okTitle, icon: 'success' });
      },
      fail: function(err) {
        if (app.handlePrivacyFailure(err, '复制到剪贴板', '读取你的剪切板')) return;
        wx.showToast({ title: '复制失败', icon: 'none' });
      }
    });
  },

  // ─── 图片错误处理 ───

  onImageError: function(e) {
    var vIndex = e.currentTarget.dataset.index;
    if (vIndex == null) return;

    // 在 blocks 上标记（跨虚拟滚动持久化）
    if (this._blocks[vIndex]) {
      this._blocks[vIndex]._imgError = true;
    }

    // 更新当前可见块显示
    var visibleBlocks = this.data.visibleBlocks;
    for (var i = 0; i < visibleBlocks.length; i++) {
      if (visibleBlocks[i]._vIndex === vIndex) {
        this.setData({
          ['visibleBlocks[' + i + ']._imgError']: true
        });
        break;
      }
    }
  },

  // ─── 搜索 ───

  /**
   * 按下键盘上的「搜索」：只出结果，不跳转。
   *
   * 以前这里搜完直接跳第一个结果、浮层顺势收成底部窄条 ——
   * 用户刚按完确认，屏幕上什么都没看到就被丢回正文，
   * 还得再点一次窄条才能看到那几十条结果。
   * 现在留在浮层里：把键盘收掉腾出空间，列表铺开让用户挑；
   * 挑中哪一条，才由 jumpToSearchResult 收起浮层去正文。
   */
  doSearch: function() {
    var keyword = this.data.searchKeyword.trim();
    if (!keyword || this._blocks.length === 0) {
      this._hlKeyword = '';
      this._hitBlockSet = null;
      this.setData({
        searchResults: [],
        currentSearchIdx: -1,
        searchActiveKeyword: '',
        searchTruncated: false
      });
      this.refreshSearchHighlight();
      return;
    }

    var lowerKeyword = keyword.toLowerCase();
    var results = [];
    var hitSet = {};
    // 结果数封顶：10 万块的文档里搜「的」会命中几万条，
    // 整份 results 进 setData 直接超限（D12），页面反而什么都不显示。
    var MAX_RESULTS = 200;
    var truncatedSearch = false;

    for (var i = 0; i < this._blocks.length; i++) {
      if (results.length >= MAX_RESULTS) { truncatedSearch = true; break; }
      var block = this._blocks[i];
      // 获取块的可搜索文本（覆盖所有块类型）
      var text = '';
      if (block.text) {
        text = block.text;
      } else if (block.children) {
        text = inlineMod.inlineToPlainText(block.children);
      } else if (block.type === 'table') {
        // 表格：拼接所有单元格文本
        var parts = [];
        if (block.header) {
          for (var h = 0; h < block.header.length; h++) {
            if (block.header[h] && block.header[h].text) parts.push(block.header[h].text);
          }
        }
        if (block.rows) {
          for (var r = 0; r < block.rows.length; r++) {
            for (var c = 0; c < block.rows[r].length; c++) {
              if (block.rows[r][c] && block.rows[r][c].text) parts.push(block.rows[r][c].text);
            }
          }
        }
        text = parts.join(' ');
      } else if (block.type === 'image' && block.alt) {
        text = block.alt;
      }

      if (!text) continue;

      var lowerText = text.toLowerCase();
      var pos = lowerText.indexOf(lowerKeyword);
      if (pos >= 0) {
        // 生成上下文摘要
        var start = Math.max(0, pos - 20);
        var end = Math.min(text.length, pos + keyword.length + 20);
        var snippet = (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '');
        results.push({
          blockIndex: i,
          snippetSegs: snippetToSegs(snippet, lowerKeyword),
          pos: pos
        });
        hitSet[i] = true;
      }
    }

    // 正文高亮的依据：确认过的关键词 + 命中块集合
    this._hlKeyword = results.length > 0 ? lowerKeyword : '';
    this._hitBlockSet = results.length > 0 ? hitSet : null;

    this.setData({
      searchResults: results,
      searchTruncated: truncatedSearch,
      searchActiveKeyword: keyword,
      // 还没挑结果，先不认定「当前项」——正文里所有命中一视同仁地黄底
      currentSearchIdx: -1,
      // 新一轮结果从头看起，别停在上一轮滚到的位置
      resultScrollId: '',
      // 收键盘：浮层的可用高度立刻翻倍，结果列表才铺得开
      searchFocus: false,
      keyboardHeight: 0
    });

    // focus=false 在个别机型上不保证真的收键盘，补一刀（基础库 2.8.2+）
    if (wx.hideKeyboard) wx.hideKeyboard({});

    this.refreshSearchHighlight();

    if (results.length === 0) {
      wx.showToast({ title: '未找到结果', icon: 'none' });
    }
  },

  /**
   * 按当前搜索状态重画可见块（高亮是渲染期加工，不写回 _blocks）
   */
  refreshSearchHighlight: function() {
    if (this.data.useVirtualScroll) {
      // force：可见范围没变也要重画，否则换了关键词/当前项颜色不更新
      this.updateVisibleRange(this._lastScrollTopRpx, true);
    } else if (this._blocks.length > 0) {
      this.setData({ visibleBlocks: this.decorateSearch(this._blocks) });
    }
  },

  /**
   * 给待渲染的块套上搜索高亮：段内关键词着色 + 整块命中标记。
   *
   * 返回的是新对象，绝不改 _blocks —— 非虚拟滚动时 visibleBlocks 就是
   * _blocks 本身，就地改会把高亮永久烙进文档数据里。
   */
  decorateSearch: function(blocks) {
    var kw = this._hlKeyword;
    var hits = this._hitBlockSet;
    if (!kw || !hits || !blocks || blocks.length === 0) return blocks;

    var results = this.data.searchResults;
    var ci = this.data.currentSearchIdx;
    var curBlock = (ci >= 0 && ci < results.length) ? results[ci].blockIndex : -1;

    var out = [];
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      // 虚拟滚动下 _vIndex 才是块在文档里的真实下标；非虚拟时下标即数组位置
      var idx = b._vIndex == null ? i : b._vIndex;
      if (!hits[idx]) { out.push(b); continue; }

      var copy = {};
      for (var k in b) copy[k] = b[k];
      var isCur = idx === curBlock;
      // 块级标记：图片块（命中的是 alt）只能靠它，其余块类型是「远看」的锚点
      copy._hitClass = isCur ? 'block-hit block-hit-cur' : 'block-hit';

      if (b.segments) {
        copy.segments = highlightSegments(b.segments, kw, isCur);
      } else if (b.type === 'code') {
        // 语法高亮开着时 tokens 就是现成的段结构，直接切；
        // 关着时只有一整坨 text，得自己切一份出来（原 text 不动，复制粘贴照旧）
        if (b.highlighted && b.tokens) {
          copy.tokens = highlightSegments(b.tokens, kw, isCur);
        } else {
          copy.codeSegs = highlightPlain(b.text, kw, isCur);
        }
      } else if (b.type === 'table') {
        copy.header = highlightCells(b.header, kw, isCur);
        if (b.rows) {
          var rows = [];
          for (var r = 0; r < b.rows.length; r++) {
            rows.push(highlightCells(b.rows[r], kw, isCur));
          }
          copy.rows = rows;
        }
      }
      out.push(copy);
    }
    return out;
  },

  jumpToSearchResult: function(e) {
    var blockIndex = e.currentTarget.dataset.index;
    var resultIdx = e.currentTarget.dataset.resultIdx;

    // 选定结果 → 让出屏幕：浮层收起，只留底部窄条做上一个/下一个
    this.setData({
      currentSearchIdx: resultIdx,
      searchPhase: 'result',
      searchFocus: false,
      keyboardHeight: 0
    });

    // 跳转到该块
    var scrollTopRpx = renderMod.progressToLayoutTop(this._layout, blockIndex, 0);

    this._lastScrollTopRpx = scrollTopRpx;
    var scrollTopPx = scrollTopRpx / this._rpxRatio;

    if (this.data.useVirtualScroll) {
      // force：当前命中块要换成强调色，可见范围没变时也得重画
      this.updateVisibleRange(scrollTopRpx, true);
    } else {
      this.setData({ visibleBlocks: this.decorateSearch(this._blocks) });
    }

    var self = this;
    this._isProgrammaticScroll = true;
    this.setData({ scrollTopPx: scrollTopPx });
    setTimeout(function() {
      self._isProgrammaticScroll = false;
    }, 200);
  },

  prevSearchResult: function() {
    if (this.data.searchResults.length === 0) return;
    var idx = this.data.currentSearchIdx;
    var newIdx = idx <= 0 ? this.data.searchResults.length - 1 : idx - 1;
    this.jumpToSearchResult({
      currentTarget: { dataset: { index: this.data.searchResults[newIdx].blockIndex, resultIdx: newIdx } }
    });
  },

  nextSearchResult: function() {
    if (this.data.searchResults.length === 0) return;
    var idx = this.data.currentSearchIdx;
    var newIdx = idx >= this.data.searchResults.length - 1 ? 0 : idx + 1;
    this.jumpToSearchResult({
      currentTarget: { dataset: { index: this.data.searchResults[newIdx].blockIndex, resultIdx: newIdx } }
    });
  },

  // ─── 多文件队列 ───

  registerInQueue: function(source, name, file, fileId) {
    var entry = {
      fileId: fileId || '',
      name: name,
      source: source,
      file: file || '',
      // 保存解析后的状态（避免切换时重新解析）
      blocks: null,
      layout: null,
      toc: [],
      encoding: '',
      format: '',
      scrollTop: 0
    };

    var queue = app.globalData.fileQueue;
    // 如果 fileId 已在队列中，切换到它
    if (fileId) {
      for (var i = 0; i < queue.length; i++) {
        if (queue[i].fileId === fileId) {
          app.globalData.activeQueueIdx = i;
          this.setData({ activeQueueIdx: i });
          this.syncQueueView();
          return;
        }
      }
    }

    // 添加到队列
    queue.push(entry);
    app.globalData.activeQueueIdx = queue.length - 1;
    this.setData({ activeQueueIdx: queue.length - 1 });
    this.syncQueueView();
  },

  /**
   * 把队列**投影**成视图需要的那几个字段再下发
   *
   * ⚠️ 这是本页最严重的一处 setData 违规，且症状极具迷惑性。
   *
   * 队列条目在 _finalizeRender / saveCurrentToQueue 里会被挂上 `blocks`（整份文档 IR）
   * 和 `layout`（块高前缀和索引）。原先直接 `setData({ fileQueue: queue })`，
   * 等于把**整份解析后的文档**做一次逻辑层→Native→视图层的跨线程序列化。
   * 官方给 setData 的硬上限是单次 1MB（实践应控制在 64KB）——
   * 一份稍大的文档就能轻松超过，超限时 setData 直接失败：
   * 队列面板打不开、切文件没反应，而控制台只有一句不起眼的警告，
   * 看起来完全像是「点击事件没绑上」，根本不会往 setData 上想。
   *
   * 视图层其实只用到 name / format / encoding 三个字段。
   * blocks 和 layout 留在 globalData 里给逻辑层自己用，一个字节都不该过桥。
   */
  syncQueueView: function() {
    var queue = app.globalData.fileQueue || [];
    var view = [];
    for (var i = 0; i < queue.length; i++) {
      view.push({
        name: queue[i].name,
        format: queue[i].format,
        encoding: queue[i].encoding
      });
    }
    this.setData({ fileQueue: view });
  },

  toggleFileQueue: function() {
    this.setData({ showFileQueue: !this.data.showFileQueue });
  },

  closeFileQueue: function() {
    this.setData({ showFileQueue: false });
  },

  switchToFile: function(e) {
    var idx = e.currentTarget.dataset.index;
    if (idx == null || idx === this.data.activeQueueIdx) {
      this.setData({ showFileQueue: false });
      return;
    }

    // 保存当前文件状态到队列
    this.saveCurrentToQueue();
    // 命中下标属于上一份文档，跟着切过去就成了乱涂
    this.resetSearchState();

    var target = app.globalData.fileQueue[idx];
    app.globalData.activeQueueIdx = idx;

    this.setData({
      showFileQueue: false,
      activeQueueIdx: idx,
      fileName: target.name,
      fileId: target.fileId,
      source: target.source
    });

    if (target.blocks && target.blocks.length > 0) {
      // 恢复已缓存的解析状态
      this._blocks = target.blocks;
      this._layout = target.layout ||
        renderMod.createLayout(this._blocks, this.renderSettings());

      // 重新展平行内段（segments 是渲染数据，需要重建）
      for (var i = 0; i < this._blocks.length; i++) {
        var b = this._blocks[i];
        if (b.children && !b.segments) {
          b.segments = inlineMod.flattenInline(b.children);
        }
      }

      this.setData({
        loading: false,
        error: '',
        encoding: target.encoding,
        format: target.format,
        toc: target.toc,
        useVirtualScroll: this._blocks.length > VIRTUAL_SCROLL_THRESHOLD,
        visibleBlocks: this._blocks.length > VIRTUAL_SCROLL_THRESHOLD ? [] : this._blocks
      });

      // 恢复滚动位置
      this._lastScrollTopRpx = target.scrollTop || 0;
      var scrollTopPx = this._lastScrollTopRpx / this._rpxRatio;

      if (this.data.useVirtualScroll) {
        this.updateVisibleRange(this._lastScrollTopRpx);
      }

      var self = this;
      this._isProgrammaticScroll = true;
      this.setData({ scrollTopPx: scrollTopPx });
      setTimeout(function() {
        self._isProgrammaticScroll = false;
        self.updateProgressDisplay(self._lastScrollTopRpx);
      }, 200);
    } else {
      // 缓存已被淘汰（QUEUE_CACHE_LIMIT 或内存告警），需要重新加载。
      // 把当初记下的本地副本重新放回 pendingFile —— 见 _finalizeRender 里的说明。
      if (target.localPath) {
        app.globalData.pendingFile = {
          path: target.localPath,
          name: target.name,
          size: target.size || 0
        };
        this.setData({ fileId: target.fileId || '' });
      }
      this.setData({ loading: true, loadingText: '正在加载...' });
      this.loadContent(target.source, target.file);
    }
  },

  saveCurrentToQueue: function() {
    var idx = this.data.activeQueueIdx;
    if (idx < 0 || idx >= app.globalData.fileQueue.length) return;

    var entry = app.globalData.fileQueue[idx];
    entry.blocks = this._blocks;
    entry.layout = this._layout;
    entry.toc = this.data.toc;
    entry.encoding = this.data.encoding;
    entry.format = this.data.format;
    entry.scrollTop = this._lastScrollTopRpx;
  },

  closeFileInQueue: function(e) {
    var idx = e.currentTarget.dataset.index;
    var queue = app.globalData.fileQueue;
    if (idx < 0 || idx >= queue.length) return;

    var isCurrent = idx === this.data.activeQueueIdx;
    queue.splice(idx, 1);

    if (queue.length === 0) {
      // 没有文件了，返回首页
      app.globalData.activeQueueIdx = -1;
      this.setData({ showFileQueue: false });
      app.backToHome();
      return;
    }

    // 调整 activeQueueIdx
    if (isCurrent) {
      var newIdx = Math.min(idx, queue.length - 1);
      app.globalData.activeQueueIdx = newIdx;
      this.setData({ showFileQueue: false, activeQueueIdx: newIdx });
      this.syncQueueView();
      // 切换到新的当前文件
      this.switchToFile({ currentTarget: { dataset: { index: newIdx } } });
    } else {
      // 只更新队列列表
      var adjustedIdx = this.data.activeQueueIdx;
      if (idx < adjustedIdx) {
        adjustedIdx--;
      }
      app.globalData.activeQueueIdx = adjustedIdx;
      this.setData({ activeQueueIdx: adjustedIdx });
      this.syncQueueView();
    }
  },

  // ─── 其他 ───

  saveProgress: function() {
    this.saveReadingProgress();
    wx.showToast({ title: '进度已保存', icon: 'success' });
  },

  goSettings: function() {
    wx.navigateTo({ url: '/pages/settings/settings' });
  },

  goBack: function() {
    app.backToHome();
  },

  // ─── 示例文本 ───

  /**
   * 内置示例文档（Edge F7，P0 提审门禁）
   *
   * 正文来自 assets/samples.js —— 由 scripts/gen_samples.js 从 samples/ 生成。
   * 这里以前内联了一整套硬编码字符串，与 assets/samples/ 下的三份文件并存
   * 且内容早已分叉：真正会被审核员看到的是内联那份，被人维护的却是文件那份。
   */
  getSampleText: function(file) {
    var entry = samples[file] || samples['sample.txt'];
    return entry ? entry.text : '';
  }
});
