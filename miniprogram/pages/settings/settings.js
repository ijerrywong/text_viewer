/**
 * settings.js - 设置页逻辑
 */

const app = getApp();

Page({
  data: {
    themeClass: '',
    accentColor: '#576b95',
    settings: {
      theme: 'light',
      fontSize: 16,
      lineHeight: 1.8,
      fontFamily: 'system',
      networkImages: false,
      keepScreenOn: true
    },
    cacheSizeText: '计算中...',
    storageWarn: false
  },

  onLoad() {
    this.loadSettings();
  },

  onShow() {
    this.loadSettings();
    this.calculateCacheSize();
  },

  loadSettings() {
    const settings = app.globalData.settings || {};
    const theme = settings.theme || 'light';
    this.setData({
      settings,
      themeClass: 'theme-' + theme,
      accentColor: this.getAccentColor(theme)
    });
  },

  getAccentColor(theme) {
    const colors = {
      light: '#576b95',
      dark: '#7c8db5',
      sepia: '#8b6914'
    };
    return colors[theme] || colors.light;
  },

  setTheme(e) {
    const theme = e.currentTarget.dataset.theme;
    app.saveSettings({ theme });
    this.setData({
      themeClass: 'theme-' + theme,
      accentColor: this.getAccentColor(theme)
    });
    // 更新本地 settings 副本
    this.setData({
      'settings.theme': theme
    });
  },

  setFontSize(e) {
    const fontSize = e.detail.value;
    app.saveSettings({ fontSize });
    this.setData({ 'settings.fontSize': fontSize });
  },

  setLineHeight(e) {
    const lineHeight = e.detail.value;
    app.saveSettings({ lineHeight });
    this.setData({ 'settings.lineHeight': lineHeight });
  },

  setFontFamily(e) {
    const fontFamily = e.currentTarget.dataset.font;
    app.saveSettings({ fontFamily });
    this.setData({ 'settings.fontFamily': fontFamily });
  },

  setNetworkImages(e) {
    const networkImages = e.detail.value;
    app.saveSettings({ networkImages });
    this.setData({ 'settings.networkImages': networkImages });

    if (networkImages) {
      wx.showToast({
        title: '已开启网络图片\n注意隐私风险',
        icon: 'none',
        duration: 2000
      });
    }
  },

  setKeepScreenOn(e) {
    const keepScreenOn = e.detail.value;
    app.saveSettings({ keepScreenOn });
    this.setData({ 'settings.keepScreenOn': keepScreenOn });
    wx.setKeepScreenOn(keepScreenOn);
  },

  async clearCache() {
    const res = await new Promise(resolve => {
      wx.showModal({
        title: '清除缓存',
        content: '将删除所有本地缓存的文件，阅读进度和设置不受影响。确定继续？',
        success: resolve
      });
    });

    if (!res.confirm) return;

    wx.showLoading({ title: '清理中...' });

    try {
      const fs = wx.getFileSystemManager();
      const dataPath = wx.env.USER_DATA_PATH;

      // 读取 files 目录并删除
      try {
        const entries = fs.readdirSync(dataPath + '/files');
        for (const entry of entries) {
          try {
            fs.rmdirSync(dataPath + '/files/' + entry, true);
          } catch (e) {
            // 忽略单个删除失败
          }
        }
      } catch (e) {
        // 目录不存在，忽略
      }

      // 清除最近文件列表和进度
      wx.removeStorageSync('recent');

      // 清理过期的 KV 存储
      var store = require('../../core/store/index.js');
      var keys = wx.getStorageInfoSync().keys || [];
      keys.forEach(function(key) {
        if (key.indexOf('progress:') === 0 || key.indexOf('meta:') === 0) {
          wx.removeStorageSync(key);
        }
      });

      wx.hideLoading();
      wx.showToast({ title: '缓存已清除', icon: 'success' });
      this.setData({ cacheSizeText: '0 B', storageWarn: false });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '清除失败', icon: 'none' });
    }
  },

  calculateCacheSize() {
    var store = require('../../core/store/index.js');
    var self = this;

    // KV 存储用量
    var kvUsage = store.getStorageUsage();
    var kvText = this.formatSize(kvUsage.currentSize);

    // 文件目录用量
    store.getFileDirSize().then(function(fileSize) {
      var fileText = self.formatSize(fileSize);
      var totalText = fileText + ' (KV: ' + kvText + ')';

      // 如果 KV 接近上限，显示告警
      if (kvUsage.warn) {
        store.compactStorage();
        // 重新检查
        var after = store.getStorageUsage();
        var afterText = self.formatSize(after.currentSize);
        totalText = fileText + ' (KV: ' + afterText + '，已精简)';
      }

      self.setData({
        cacheSizeText: totalText,
        storageWarn: kvUsage.warn
      });
    }).catch(function() {
      self.setData({ cacheSizeText: kvText, storageWarn: false });
    });
  },

  formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  },

  showAbout() {
    wx.showModal({
      title: '纯文本阅读器',
      content: '版本 v1.0.0\n\n一个纯本地、零后端的微信小程序，在微信里查看 HTML / Markdown / TXT 等纯文本文件。\n\n所有文件均在你的手机本地解析渲染，全程不上传任何服务器。',
      showCancel: false,
      confirmText: '知道了'
    });
  }
});
