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
    showSearch: false,
    searchKeyword: '',
    searchResults: [],
    currentSearchIdx: -1,

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

  // ─── 生命周期 ───

  onLoad: function(options) {
    var sys = app.globalData.systemInfo || wx.getSystemInfoSync();
    var statusBarHeight = sys.statusBarHeight || 20;
    var navContent = sys.platform === 'android' ? 48 : 44;

    this._screenWidth = sys.windowWidth || 375;
    this._rpxRatio = 750 / this._screenWidth;

    // 计算视口高度（rpx）
    var toolbarPx = 50 + (sys.safeArea ? sys.safeArea.bottom - sys.safeArea.height : 0);
    var viewportPx = sys.windowHeight - statusBarHeight - navContent - 50;
    this._viewportRpx = viewportPx * this._rpxRatio;

    this.setData({
      statusBarHeight: statusBarHeight,
      navBarHeight: statusBarHeight + navContent,
      toolbarHeight: 50 * this._rpxRatio + (sys.safeArea ? (sys.screenHeight - sys.safeArea.bottom) * this._rpxRatio : 0)
    });

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

    // 开启转发/朋友圈菜单
    app.enableShareMenu();

    // 注册到多文件队列
    this.registerInQueue(source, name, options.file, fileId);
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
    // 如果已有内容，重新计算高度预估
    if (this._blocks.length > 0 && this.data.useVirtualScroll) {
      this.updateVisibleRange(this._lastScrollTopRpx);
    }
  },

  onHide: function() {
    this.saveReadingProgress();
    this.saveCurrentToQueue();
  },

  onUnload: function() {
    wx.setKeepScreenOn(false);
    this.saveReadingProgress();
    this.saveCurrentToQueue();
    // 清空文件队列（页面销毁时）
    app.globalData.fileQueue = [];
    app.globalData.activeQueueIdx = -1;
    if (this._scrollTimer) {
      clearTimeout(this._scrollTimer);
      this._scrollTimer = null;
    }
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
      visibleBlocks: useVS ? [] : this._blocks,
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
      visibleBlocks: renderData.visibleBlocks,
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

  toggleSearch: function() {
    this.setData({ showSearch: !this.data.showSearch });
  },

  closeSearch: function() {
    this.setData({ showSearch: false, searchKeyword: '' });
  },

  onSearchInput: function(e) {
    this.setData({ searchKeyword: e.detail.value });
  },

  clearSearch: function() {
    this.setData({ searchKeyword: '' });
  },

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

  doSearch: function() {
    var keyword = this.data.searchKeyword.trim();
    if (!keyword || this._blocks.length === 0) {
      this.setData({ searchResults: [], currentSearchIdx: -1 });
      return;
    }

    var lowerKeyword = keyword.toLowerCase();
    var results = [];
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
        results.push({ blockIndex: i, snippet: snippet, pos: pos });
      }
    }

    this.setData({
      searchResults: results,
      searchTruncated: truncatedSearch,
      currentSearchIdx: results.length > 0 ? 0 : -1
    });

    if (results.length > 0) {
      // 跳转到第一个结果（保持搜索面板打开）
      this.jumpToSearchResult({
        currentTarget: { dataset: { index: results[0].blockIndex, resultIdx: 0 } }
      });
    } else {
      wx.showToast({ title: '未找到结果', icon: 'none' });
    }
  },

  jumpToSearchResult: function(e) {
    var blockIndex = e.currentTarget.dataset.index;
    var resultIdx = e.currentTarget.dataset.resultIdx;

    this.setData({ currentSearchIdx: resultIdx });

    // 跳转到该块
    var scrollTopRpx = renderMod.progressToLayoutTop(this._layout, blockIndex, 0);

    this._lastScrollTopRpx = scrollTopRpx;
    var scrollTopPx = scrollTopRpx / this._rpxRatio;

    if (this.data.useVirtualScroll) {
      this.updateVisibleRange(scrollTopRpx);
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
          this.setData({ activeQueueIdx: i, fileQueue: queue });
          return;
        }
      }
    }

    // 添加到队列
    queue.push(entry);
    app.globalData.activeQueueIdx = queue.length - 1;
    this.setData({ activeQueueIdx: queue.length - 1, fileQueue: queue });
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
      // 需要重新加载
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
      this.setData({ showFileQueue: false, fileQueue: queue, activeQueueIdx: newIdx });
      // 切换到新的当前文件
      this.switchToFile({ currentTarget: { dataset: { index: newIdx } } });
    } else {
      // 只更新队列列表
      var adjustedIdx = this.data.activeQueueIdx;
      if (idx < adjustedIdx) {
        adjustedIdx--;
      }
      app.globalData.activeQueueIdx = adjustedIdx;
      this.setData({ fileQueue: queue, activeQueueIdx: adjustedIdx });
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
