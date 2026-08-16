/**
 * components/privacy-dialog - 隐私授权弹窗
 *
 * 做成组件而不是各页面各写一份：首页要授权（选文件 / 读剪贴板），
 * 阅读页也要（复制链接 / 复制代码走 setClipboardData）。
 * 之前只有首页有自定义弹窗，阅读页退化成 wx.showModal ——
 * 而原生 modal 里放不进 open-type 按钮，那条路的「同意」根本没法正确回传。
 */
Component({
  options: {
    // 让页面的主题 class 能影响组件内部（CSS 变量本身会继承，
    // 这里放开是为了 .theme-dark 这类祖先类选择器也能命中）
    addGlobalClass: true
  },

  properties: {
    visible: { type: Boolean, value: false }
  },

  methods: {
    // 由 <button open-type="agreePrivacyAuthorization"> 触发，
    // 事件里带着微信认可的按钮信息
    onAgree: function () {
      this.triggerEvent('agree', { buttonId: 'agree-privacy-btn' });
    },

    onDeny: function () {
      this.triggerEvent('deny', {});
    }
  }
});
