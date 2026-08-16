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
    recentFiles: []
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
  },

  onShow() {
    // 每次显示时刷新主题和最近文件
    this.applyTheme();
    this.loadRecentFiles();
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

  grantPrivacy() {
    this.setData({ showPrivacy: false });
    app.resolvePrivacy(true);
  },

  denyPrivacy() {
    this.setData({ showPrivacy: false });
    app.resolvePrivacy(false);
    // 文案不能写死「选择文件」——粘贴文本、复制链接同样会走到这里。
    // 拒绝之后接口的 fail 回调会接手，由 handlePrivacyFailure 给出重新授权的入口，
    // 所以这里只做一个中性的确认，不抢那句说明。
    wx.showToast({
      title: '已拒绝，功能暂不可用',
      icon: 'none'
    });
  },

  /**
   * 从聊天选择文件
   */
  chooseFile() {
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
        if (app.handlePrivacyFailure(err, '选择聊天文件', '收集你选中的文件',
              () => this.chooseFile())) {
          return;
        }
        console.error('选择文件失败', err);
        wx.showToast({ title: '选择文件失败', icon: 'none' });
      }
    });
  },

  /**
   * 粘贴文本
   */
  pasteText() {
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
        wx.navigateTo({
          url: '/pages/reader/reader?source=clipboard&name=' + encodeURIComponent('粘贴文本')
        });
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        if (msg.includes('cancel')) return;
        if (app.handlePrivacyFailure(err, '读取剪贴板', '读取你的剪切板',
              () => this.pasteText())) {
          return;
        }
        wx.showToast({ title: '读取剪贴板失败', icon: 'none' });
      }
    });
  },

  /**
   * 查看示例文档
   */
  viewSamples() {
    wx.showActionSheet({
      itemList: ['Markdown 示例', 'HTML 示例', 'TXT 示例'],
      success: (res) => {
        const samples = ['sample.md', 'sample.html', 'sample.txt'];
        const names = ['Markdown 示例', 'HTML 示例', 'TXT 示例'];
        const idx = res.tapIndex;
        app.globalData.pendingText = '';
        wx.navigateTo({
          url: '/pages/reader/reader?source=sample&name=' + encodeURIComponent(names[idx]) + '&file=' + samples[idx]
        });
      }
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
          var ext = dotIdx >= 0 ? name.slice(dotIdx + 1) : 'dat';
          var localPath = wx.env.USER_DATA_PATH + '/temp_open.' + ext;
          fs.copyFile({
            srcPath: file.path,
            destPath: localPath,
            success: () => {
              wx.openDocument({
                filePath: localPath,
                showMenu: true,
                success: () => {
                  // 打开成功
                },
                fail: () => {
                  wx.showToast({ title: '打开失败', icon: 'none' });
                }
              });
            },
            fail: () => {
              wx.showToast({ title: '文件处理失败', icon: 'none' });
            }
          });
        }
      }
    });
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
    wx.navigateTo({
      url: '/pages/reader/reader?source=file&name=' + encodeURIComponent(file.name) + '&size=' + file.size
    });
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
    wx.navigateTo({
      url: '/pages/reader/reader?source=recent&name=' + encodeURIComponent(file.name) + '&size=' + file.size + '&fileId=' + id
    });
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
    wx.navigateTo({
      url: '/pages/settings/settings'
    });
  }
});
