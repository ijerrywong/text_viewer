/**
 * index.js - 首页逻辑
 *
 * 三大入口：chooseMessageFile / 剪贴板粘贴 / 示例文档
 * 最近文件管理
 * 隐私授权流程
 */

const app = getApp();

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 68,
    themeClass: '',
    showTip: true,
    showPrivacy: false,
    recentFiles: [],
    // 朋友圈单页模式（scene 1154）：跳转、选文件、剪贴板全被平台禁用，
    // 首屏必须换一套说明，否则每个按钮都是死按钮
    singlePage: false
  },

  onLoad() {
    // 获取状态栏高度用于自定义导航栏
    const sys = app.globalData.systemInfo;
    if (sys) {
      const statusBarHeight = sys.statusBarHeight || 20;
      // 导航栏高度 = 状态栏 + 内容区(44px on iOS, 48px on Android)
      const navContent = sys.platform === 'android' ? 48 : 44;
      this.setData({
        statusBarHeight,
        navBarHeight: statusBarHeight + navContent
      });
    }

    // 应用主题
    this.applyTheme();

    this.setData({ singlePage: app.isSinglePageMode() });
  },

  // ─── 转发 / 分享（Edge E3）───
  // 只分享小程序卡片，不带任何文件信息，理由见 app.js 的 shareCard 注释

  onShareAppMessage() {
    return app.shareCard();
  },

  onShareTimeline() {
    return app.shareToTimeline();
  },

  onShow() {
    // 每次显示时刷新主题和最近文件
    this.applyTheme();
    this.loadRecentFiles();
    this.setData({ singlePage: app.isSinglePageMode() });

    // 转发菜单放 onShow 而不是 onLoad：
    // wx.showShareMenu 要求页面已经显示，onLoad 阶段页面还没上屏，
    // 调用可能被忽略 —— 表现就是「右上角没有转发按钮」这种时有时无的怪事。
    app.enableShareMenu(true);

    // scene 1173：App 只负责把素材登记到 globalData，跳转由这里发起。
    // 放在 onShow 是因为此刻页面栈一定就绪，不需要赌任何时序（见 app.handleLaunchScene）。
    this.consumePendingMaterial();
  },

  /**
   * 消费「从聊天素材打开」登记的文件
   *
   * 只有 fromScene 1173 的才在这里消费：chooseMessageFile / 最近文件那两条路
   * 是先跳转再由阅读页取 pendingFile，不该被首页截胡。
   */
  consumePendingMaterial() {
    var pending = app.globalData.pendingFile;
    if (!pending || pending.fromScene !== 1173) return;

    // 去重按**对象身份**，不按 path。
    // handleLaunchScene 每被调用一次就新建一个对象，所以：
    //   同一次启动里 onLaunch + onShow 各登记一次 → 只有最后那个对象会走到这里，天然幂等；
    //   用户过一会儿从聊天里再点同一个文件 → 是个新对象 → 照常打开。
    // （之前按 path 去重，代价是同一个文件永远只能打开一次。）
    if (this._consumedMaterial === pending) return;
    this._consumedMaterial = pending;

    var url = '/pages/reader/reader?source=material&name=' +
      encodeURIComponent(pending.name || '未命名') +
      '&size=' + (pending.size || 0);

    // 跳转没发起成功就把标记退回去，留给下一次 onShow 重试
    if (!app.navigate(url, '打开文件')) {
      this._consumedMaterial = null;
    }
  },

  /**
   * 应用主题 class
   */
  applyTheme() {
    // 不用可选链：全项目只有这一处用了 `?.` 和对象展开，
    // 真机上万一命中未转译的运行时，首页 JS 会整个解析失败 —— 表现就是白屏，
    // 而且模拟器里完全复现不出来。首页是入口，不值得为省两个字符冒这个险。
    const settings = app.globalData.settings || {};
    this.setData({ themeClass: 'theme-' + (settings.theme || 'light') });
  },

  /**
   * 加载最近文件列表
   */
  loadRecentFiles() {
    try {
      const recent = wx.getStorageSync('recent') || [];
      const self = this;
      // 同上：不用对象展开。顺带只挑渲染要用的字段下发，
      // 而不是把整条 meta（含 localPath 等）原样塞进 setData。
      const formatted = recent.map(function (f) {
        return {
          id: f.id,
          name: f.name,
          format: f.format,
          localPath: f.localPath,
          size: f.size,
          sizeText: self.formatSize(f.size || 0),
          timeText: self.formatTime(f.openedAt || 0)
        };
      });
      this.setData({ recentFiles: formatted });
    } catch (e) {
      console.error('加载最近文件失败', e);
    }
  },

  /**
   * 格式化文件大小
   */
  formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  },

  /**
   * 格式化时间
   */
  formatTime(ts) {
    if (!ts) return '';
    const now = Date.now();
    const diff = now - ts;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    const d = new Date(ts);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  },

  /**
   * 显示隐私弹窗（供 app.js 回调）
   */
  showPrivacyDialog() {
    this.setData({ showPrivacy: true });
  },

  // 由 privacy-dialog 组件的 open-type 按钮触发，事件里带回按钮 id
  grantPrivacy(e) {
    this.setData({ showPrivacy: false });
    app.resolvePrivacy(true, e && e.detail && e.detail.buttonId);
  },

  denyPrivacy() {
    this.setData({ showPrivacy: false });
    app.resolvePrivacy(false);
    // 这里不再自己弹提示：resolvePrivacy(false) 会让挂起的接口立即 fail，
    // 而 fail 回调统一走 app.handlePrivacyFailure，那边会给出唯一的一次提示。
    // 两处都弹的话，用户点一次「拒绝」会连着看到两个提示。
  },

  /**
   * 从聊天选择文件
   */
  chooseFile() {
    // 单页模式下 chooseMessageFile 属于被禁接口，且选中后也无处跳转
    if (app.isSinglePageMode()) { app.explainSinglePageMode(); return; }
    // 不传 extension：一旦限定白名单，无后缀文件、大小写后缀（.TXT）、
    // 多段后缀（.tar.gz.txt）在选择器里就直接灰掉了 —— 而 A4/A5 明确要求
    // 「内容嗅探优先于扩展名」。选进来之后再按类型分流（handleSelectedFile），
    // 那里对 Office/PDF/压缩包给的是有意义的引导，比选不中好。
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      success: (res) => {
        if (res.tempFiles && res.tempFiles.length > 0) {
          const file = res.tempFiles[0];
          this.handleSelectedFile(file);
        }
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        // 用户自己点了取消，什么都不用做
        if (msg.includes('cancel')) return;
        // 隐私类失败交给统一处理：它会区分「后台指引没配」和「用户拒绝了」，
        // 并给出各自能照着做的下一步 —— 而不是一个飘过就没了的 toast（F6）
        if (app.handlePrivacyFailure(err, '选择聊天文件', '收集你选中的文件')) return;
        console.error('选择文件失败', err);
        wx.showToast({ title: '选择文件失败', icon: 'none' });
      }
    });
  },

  /**
   * 粘贴文本
   */
  pasteText() {
    if (app.isSinglePageMode()) { app.explainSinglePageMode(); return; }
    wx.getClipboardData({
      success: (res) => {
        const text = res.data;
        if (!text || text.trim().length === 0) {
          wx.showToast({
            title: '剪贴板里没有文本内容',
            icon: 'none'
          });
          return;
        }
        // 跳转到阅读器，传递粘贴内容
        // 内容通过全局变量传递，避免 URL 过长
        app.globalData.pendingText = text;
        app.navigate(
          '/pages/reader/reader?source=clipboard&name=' + encodeURIComponent('粘贴文本'),
          '打开'
        );
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        if (msg.includes('cancel')) return;
        if (app.handlePrivacyFailure(err, '读取剪贴板', '读取你的剪切板')) return;
        wx.showToast({ title: '读取剪贴板失败', icon: 'none' });
      }
    });
  },

  /**
   * 查看示例文档
   */
  viewSamples() {
    if (app.isSinglePageMode()) { app.explainSinglePageMode(); return; }
    // ⚠️ wx.showActionSheet 的 itemList 上限是 6 项，超出会整个调用失败（不是截断）。
    // 这里 3 项安全；将来加示例时必须同步检查这条硬限制。
    wx.showActionSheet({
      itemList: ['Markdown 示例', 'HTML 示例', 'TXT 示例'],
      success: (res) => {
        const samples = ['sample.md', 'sample.html', 'sample.txt'];
        const names = ['Markdown 示例', 'HTML 示例', 'TXT 示例'];
        const idx = res.tapIndex;
        app.globalData.pendingText = '';
        app.navigate(
          '/pages/reader/reader?source=sample&name=' + encodeURIComponent(names[idx]) +
          '&file=' + samples[idx],
          '打开示例'
        );
      },
      // 用户点蒙层取消也会走 fail，不该当成错误
      fail: function() {}
    });
  },

  /**
   * 处理选中的文件（含非目标格式引导）
   * 支持的纯文本格式直接打开，Office/PDF 引导用 wx.openDocument
   */
  handleSelectedFile(file) {
    var name = file.name || '';
    var ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();

    // 非目标格式：Office / PDF → 引导用 wx.openDocument
    var officeExts = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf'];
    if (officeExts.indexOf(ext) !== -1) {
      this.openWithSystem(file);
      return;
    }

    // 压缩包 → 明确提示
    var archiveExts = ['zip', 'rar', '7z', 'gz', 'tar', 'bz2'];
    if (archiveExts.indexOf(ext) !== -1) {
      wx.showModal({
        title: '暂不支持',
        content: '暂不支持压缩包文件，请解压后选择其中的文本文件。',
        showCancel: false,
        confirmText: '知道了'
      });
      return;
    }

    // 其他格式按纯文本处理
    this.openFile(file);
  },

  /**
   * 用微信系统组件打开 Office/PDF 文件
   */
  openWithSystem(file) {
    // file.name 缺失时 file.name.lastIndexOf 会直接抛异常，
    // 而 chooseMessageFile 的返回项确实可能没有 name
    var name = file.name || '';
    var dotIdx = name.lastIndexOf('.');
    var extLabel = dotIdx >= 0 ? name.slice(dotIdx + 1).toUpperCase() : '未知类型';

    wx.showModal({
      title: '使用微信打开',
      content: '此文件类型（' + extLabel + '）适合用微信内置查看器打开。是否继续？',
      confirmText: '打开',
      success: (res) => {
        if (res.confirm) {
          // 先复制到本地（防 tempPath 失效）
          var fs = wx.getFileSystemManager();
          var ext = dotIdx >= 0 ? name.slice(dotIdx + 1).toLowerCase() : '';
          // ⚠️ 文件名不能固定成 temp_open.xxx：
          // 上一次打开的同名残留会被 copyFile 覆盖，但 Android 端 openDocument
          // 有可能仍拿着旧的文件句柄，出现「打开的是上一个文件」这种极难复现的错。
          // 每次用新名字，顺便让旧的走 LRU 自然过期。
          var localPath = wx.env.USER_DATA_PATH + '/open_' + Date.now() + '.' + (ext || 'dat');
          // 上一次转交给微信预览的副本在这里清。
          // 不在 openDocument 的 complete 里删：success 只代表「预览器打开了」，
          // 文件这时候还被它占着，删掉会让预览页变成空白。
          this.sweepOpenTemps(fs);
          fs.copyFile({
            srcPath: file.path,
            destPath: localPath,
            success: () => {
              var opts = {
                filePath: localPath,
                showMenu: true,
                success: function() {},
                fail: function(err) {
                  console.error('openDocument 失败', err);
                  wx.showToast({ title: '打开失败', icon: 'none' });
                }
              };
              // ⚠️ Android 上不传 fileType 时 openDocument 常常直接失败
              // （iOS 能从扩展名推断，Android 不能）。这是双端表现不一致的经典来源。
              if (ext) opts.fileType = ext;
              wx.openDocument(opts);
            },
            fail: (err) => {
              console.error('复制文件失败', err);
              wx.showToast({ title: '文件处理失败', icon: 'none' });
            }
          });
        }
      }
    });
  },

  /**
   * 清掉历史遗留的 open_* 临时副本
   *
   * 用户文件目录与缓存文件**共用 200MB 的小程序总配额**（官方口径），
   * 这些几十 MB 的 PDF/PPT 副本本身没有留存价值，攒着只会挤占正文缓存。
   */
  sweepOpenTemps(fs) {
    try {
      var entries = fs.readdirSync(wx.env.USER_DATA_PATH);
      for (var i = 0; i < entries.length; i++) {
        var n = entries[i];
        // 兼容历史版本留下的固定文件名
        if (n.indexOf('open_') === 0 || n.indexOf('temp_open.') === 0) {
          try { fs.unlinkSync(wx.env.USER_DATA_PATH + '/' + n); } catch (e) {}
        }
      }
    } catch (e) {
      // 目录读不到就算了，这只是顺手做的清理
    }
  },

  /**
   * 打开文件（从 chooseMessageFile 获取）
   */
  openFile(file) {
    // 通过全局变量传递文件信息
    app.globalData.pendingFile = {
      path: file.path,
      name: file.name,
      size: file.size
    };
    app.navigate(
      '/pages/reader/reader?source=file&name=' + encodeURIComponent(file.name || '未命名') +
      '&size=' + (file.size || 0),
      '打开文件'
    );
  },

  /**
   * 打开最近文件
   */
  openRecent(e) {
    const id = e.currentTarget.dataset.id;
    const file = this.data.recentFiles.find(f => f.id === id);
    if (!file) return;

    // 本地副本可能已被 LRU 清掉或被系统回收，先确认还在
    // （G4：打不开新文件时要有明确报错引导，而不是进去一片空白）
    try {
      wx.getFileSystemManager().accessSync(file.localPath);
    } catch (e) {
      wx.showModal({
        title: '文件已不在本地',
        content: '这个文件的本地缓存已被清理，请重新从聊天中选择。',
        showCancel: false,
        confirmText: '知道了',
        success: () => {
          require('../../core/intake/index.js').removeFile(id);
          this.loadRecentFiles();
        }
      });
      return;
    }

    app.globalData.pendingFile = {
      path: file.localPath,
      name: file.name,
      size: file.size
    };
    app.navigate(
      '/pages/reader/reader?source=recent&name=' + encodeURIComponent(file.name || '未命名') +
      '&size=' + (file.size || 0) + '&fileId=' + encodeURIComponent(id),
      '打开文件'
    );
  },

  /**
   * 清空最近文件
   */
  clearRecent() {
    wx.showModal({
      title: '清空最近文件',
      content: '将清除最近文件列表和本地文件缓存，确定继续？',
      success: (res) => {
        if (res.confirm) {
          // 删除本地文件和元数据
          const recent = this.data.recentFiles;
          const intake = require('../../core/intake/index.js');
          recent.forEach(function(f) {
            if (f.id) {
              intake.removeFile(f.id);
            }
          });
          wx.removeStorageSync('recent');
          this.setData({ recentFiles: [] });
          wx.showToast({ title: '已清空', icon: 'success' });
        }
      }
    });
  },

  /**
   * 关闭提示
   */
  closeTip() {
    this.setData({ showTip: false });
  },

  /**
   * 跳转设置
   */
  goSettings() {
    app.navigate('/pages/settings/settings', '打开设置');
  }
});
