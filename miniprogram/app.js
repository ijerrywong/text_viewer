/**
 * app.js - 纯文本阅读器全局入口
 */

// 默认设置
const DEFAULT_SETTINGS = {
  theme: 'light',        // light | dark | sepia
  fontSize: 16,          // px，逻辑像素
  lineHeight: 1.8,       // 行高倍率
  fontFamily: 'system',  // system | serif | mono
  networkImages: false,  // 网络图片默认关闭（隐私保护）
  keepScreenOn: true     // 屏幕常亮
};

// 主题对应的导航栏颜色
const THEME_NAV = {
  light: { bg: '#ffffff', text: 'black' },
  dark:  { bg: '#1a1a1a', text: 'white' },
  sepia: { bg: '#f4ecd8', text: 'black' }
};

App({
  globalData: {
    settings: null,
    systemInfo: null,
    // 当前打开的文件信息
    currentFile: null,
    // 隐私授权状态
    privacyAuthorized: false,
    privacyResolve: null,
    // 微信是否至少触发过一次授权询问。用来区分「用户拒绝了」和「后台指引没配」
    privacyPromptSeen: false,
    // 多文件队列：当前会话中打开的文件列表
    fileQueue: [],
    activeQueueIdx: -1,
    // 兼容性信息
    compat: null
  },

  onLaunch(options) {
    // onLaunch 里任何一处抛异常，后面的初始化就全断了，
    // 而每个页面都依赖 globalData.settings / systemInfo —— 结果就是整个小程序白屏。
    // 所以这里每一步都要能失败得体面。
    try {
      this.globalData.systemInfo = wx.getSystemInfoSync();
    } catch (e) {
      console.error('获取系统信息失败', e);
    }
    // 兜底一份，保证页面里 sys.xxx 永远不会读到 undefined 的属性
    if (!this.globalData.systemInfo) {
      this.globalData.systemInfo = {
        statusBarHeight: 20, windowWidth: 375, windowHeight: 667,
        screenHeight: 667, platform: 'devtools', SDKVersion: ''
      };
    }

    // 基础库版本检查
    try {
      this.checkCompatibility();
    } catch (e) {
      console.error('兼容性检查失败', e);
    }

    // 加载持久化设置（loadSettings 内部已有 try/catch，且一定会给出默认值）
    this.loadSettings();

    // 注册自定义隐私授权弹窗
    // 注册后，隐私接口需要授权时由我方弹窗处理（而非微信官方弹窗）
    if (wx.onNeedPrivacyAuthorization) {
      wx.onNeedPrivacyAuthorization((resolve) => {
        // 上一次的授权请求还没给答复就又来一次 —— 悬着的 resolve 必须先了结，
        // 否则那次接口调用既不 success 也不 fail，永久 pending，界面上表现为"点了没反应"
        if (this.globalData.privacyResolve) {
          try { this.globalData.privacyResolve({ event: 'disagree' }); } catch (e) {}
        }
        this.globalData.privacyResolve = resolve;
        // 记下"微信确实来问过了"。
        // 这是区分两种失败的唯一可靠依据：
        //   问过 + 失败 = 用户拒绝了
        //   没问过 + 失败 = 后台《用户隐私保护指引》没配好，微信压根没资格问
        this.globalData.privacyPromptSeen = true;

        // 通知当前页面显示自定义弹窗
        var pages = getCurrentPages();
        var currentPage = pages[pages.length - 1];
        if (currentPage && typeof currentPage.showPrivacyDialog === 'function') {
          currentPage.showPrivacyDialog();
        } else {
          // 当前页面没有自定义弹窗，使用 wx.showModal 兜底
          wx.showModal({
            title: '隐私保护说明',
            content: '本小程序所有文件均在你的手机本地解析渲染，全程不上传任何服务器。选择文件和读取剪贴板需要你的授权。',
            confirmText: '同意',
            cancelText: '拒绝',
            success: (res) => {
              if (res.confirm) {
                this.resolvePrivacy(true);
              } else {
                this.resolvePrivacy(false);
              }
            }
          });
        }
      });
    }

    // 处理启动场景（scene 1173 待 Phase 4 验证后启用）
    this.handleLaunchScene(options);
  },

  onShow(options) {
    // 导航栏配色放这里而不是 onLaunch：onLaunch 阶段页面栈还是空的，
    // setNavigationBarColor 必然失败。（index/reader 用的是自定义导航栏，
    // 真正受影响的只有设置页。）
    this.applyThemeNav(this.globalData.settings && this.globalData.settings.theme);

    // 热启动场景处理（幂等）
    this.handleLaunchScene(options);
  },

  /**
   * 全局异常兜底
   *
   * 小程序里任何未捕获的异常都只会让页面停在白屏，控制台不接真机调试就看不到。
   * 白屏是本项目最难排查的一类故障（真机白、模拟器正常），
   * 所以宁可弹窗打扰，也不要让失败无声无息。
   */
  onError(err) {
    console.error('[全局异常]', err);
    this.reportFatal('运行异常', err);
  },

  /**
   * 未处理的 Promise 拒绝
   * 文件接入整条链路都是 Promise，漏接的 reject 同样表现为白屏或卡在 loading
   */
  onUnhandledRejection(res) {
    console.error('[未处理的 Promise 拒绝]', res && res.reason);
    this.reportFatal('异步异常', res && res.reason);
  },

  onPageNotFound(res) {
    console.error('[页面不存在]', res);
    wx.reLaunch({ url: '/pages/index/index' });
  },

  /**
   * 把致命错误摆到用户面前（同时便于反馈给开发者）
   * 同一条错误只提示一次，避免循环报错刷屏
   */
  reportFatal(title, err) {
    var message = '';
    if (typeof err === 'string') message = err;
    else if (err && err.message) message = err.message + '\n' + (err.stack || '');
    else message = JSON.stringify(err || {});

    if (this._lastFatal === message) return;
    this._lastFatal = message;

    wx.showModal({
      title: title,
      content: String(message).slice(0, 300),
      showCancel: true,
      cancelText: '忽略',
      confirmText: '复制详情',
      success: function(res) {
        if (res.confirm) {
          wx.setClipboardData({ data: String(message).slice(0, 2000) });
        }
      }
    });
  },

  // ─── 转发 / 分享 ───
  //
  // 官方文档：只有定义了 onShareAppMessage，右上角菜单才会出现「转发」按钮；
  // 「分享到朋友圈」还需要 onShareTimeline + wx.showShareMenu 里带上 shareTimeline。
  // 三个页面此前一个都没实现，所以点转发只会提示「当前页面不可转发」。
  //
  // ⚠️ 只分享小程序卡片，绝不带文件信息（AGENTS §6.5 / Edge E3）：
  //   - path 固定指向首页：文件只存在于用户本机，带上 fileId 对方也打不开；
  //   - title 不含文件名：文件名本身可能就是隐私（"离职协议.md"），
  //     不该跟着分享卡片进到别人的聊天记录和朋友圈里；
  //   - 不分享文件内容：带文件的分享会让小程序被当成网盘类而拒审。
  // 对方点开卡片后自己选文件，这正是规范里写的语义。

  SHARE_TITLE: '纯文本阅读器 — 在微信里读 Markdown / HTML / TXT',

  shareCard() {
    return {
      title: this.SHARE_TITLE,
      path: '/pages/index/index'
    };
  },

  shareToTimeline() {
    // query 留空：不携带任何本机文件的标识
    return {
      title: this.SHARE_TITLE,
      query: ''
    };
  },

  /**
   * 开启分享菜单
   *
   * @param {boolean} [withTimeline] 是否同时开启「分享到朋友圈」
   *
   * ⚠️ 朋友圈分享**不能自定义 path**，分享出去的就是当前页面，
   * 接收方还是在「单页模式」里打开（禁止任何跳转、无登录态、剪贴板等接口被禁）。
   * 所以只有首页适合分享到朋友圈：
   *   - 阅读页：接收方没有 source 参数 → 落到「未指定内容来源」错误页，
   *     而且单页模式下连那个「返回首页」按钮都点不动；
   *   - 设置页：分享出去毫无意义。
   * 「发送给朋友」不受此限（onShareAppMessage 可以自定义 path），
   * 所以三个页面都保留转发，path 统一指向首页。
   *
   * 需基础库 2.11+（本项目最低 2.32.3）。展示朋友圈时必须同时展示发送给朋友。
   */
  enableShareMenu(withTimeline) {
    if (!wx.showShareMenu) return;
    var menus = withTimeline
      ? ['shareAppMessage', 'shareTimeline']
      : ['shareAppMessage'];
    wx.showShareMenu({
      menus: menus,
      fail: function() {}
    });
  },

  /**
   * 回到首页
   *
   * 优先 navigateBack（保留首页已有状态）；页面栈里只有当前页时它会失败 ——
   * 开发者工具从阅读页直接编译、scene 1173 进入、redirectTo 之后都是这种情况。
   *
   * ⚠️ 兜底**不能用 wx.switchTab**：它只能跳 tabBar 页面，而本项目没有 tabBar，
   * 于是兜底这一步也失败，且原来没写 fail 回调 ——
   * 用户点「返回首页」完全没反应，是个彻底静默的死按钮。
   * reLaunch 关掉所有页面重开首页，任何页面栈状态下都成立。
   */
  backToHome() {
    wx.navigateBack({
      fail: function() {
        wx.reLaunch({
          url: '/pages/index/index',
          fail: function(err) {
            console.error('返回首页失败', err);
          }
        });
      }
    });
  },

  /**
   * 基础库版本兼容性检查
   */
  checkCompatibility() {
    var sys = this.globalData.systemInfo;
    if (!sys || !sys.SDKVersion) return;

    // 最低要求：2.32.3（隐私保护指引）
    // 推荐：3.0.0+
    var version = sys.SDKVersion;
    var parts = version.split('.').map(function(n) { return parseInt(n) || 0; });
    var major = parts[0] || 0;
    var minor = parts[1] || 0;
    var patch = parts[2] || 0;
    var versionCode = major * 10000 + minor * 100 + patch;

    if (versionCode < 23203) {
      // 低于 2.32.3，隐私拦截不生效，但功能仍可用
      console.warn('[兼容性] 基础库版本 ' + version + ' 低于推荐的 2.32.3，隐私保护功能可能不完整');
    }

    // 记录关键 API 可用性
    this.globalData.compat = {
      canUseWorker: wx.canIUse && wx.canIUse('createWorker'),
      canUsePrivacy: typeof wx.requirePrivacyAuthorize === 'function',
      canUseChooseMessageFile: wx.canIUse && wx.canIUse('chooseMessageFile'),
      canUseReadFilePosition: wx.canIUse && wx.canIUse('getFileSystemManager.readFile.object.position'),
      sdkVersion: version
    };
  },

  /**
   * 加载设置，合并默认值
   */
  loadSettings() {
    try {
      const saved = wx.getStorageSync('settings');
      this.globalData.settings = Object.assign({}, DEFAULT_SETTINGS, saved || {});
    } catch (e) {
      this.globalData.settings = Object.assign({}, DEFAULT_SETTINGS);
    }
  },

  /**
   * 保存设置
   */
  saveSettings(patch) {
    this.globalData.settings = Object.assign({}, this.globalData.settings, patch);
    try {
      wx.setStorageSync('settings', this.globalData.settings);
    } catch (e) {
      console.error('保存设置失败', e);
    }
    // 同步导航栏主题
    if (patch.theme) {
      this.applyThemeNav(patch.theme);
    }
  },

  /**
   * 应用主题到导航栏
   */
  applyThemeNav(theme) {
    const nav = THEME_NAV[theme] || THEME_NAV.light;
    // 页面栈为空、或当前页是自定义导航栏时这个调用会 fail，
    // 不给 fail 回调的话会在控制台刷红，但它从来不是致命错误
    wx.setNavigationBarColor({
      frontColor: nav.text,
      backgroundColor: nav.bg,
      fail: function() {}
    });
  },

  /**
   * 处理启动场景
   * scene 1173（聊天素材打开）：从 forwardMaterials 获取文件并跳转阅读器
   */
  handleLaunchScene(options) {
    var scene = options && options.scene;
    if (scene === 1173 && options.forwardMaterials) {
      const materials = options.forwardMaterials;
      if (materials && materials.length > 0) {
        const material = materials[0];

        // 幂等：onLaunch 和 onShow 会带着同一份参数各触发一次，不能开两次。
        // 但去重必须按素材本身，不能用一次性开关 ——
        // 之前是 `if (this._scene1173Handled) return`，
        // 于是同一次启动周期内用户从聊天里点开第二个文件时，小程序完全没反应。
        var token = (material.path || '') + '|' + (material.size || 0);
        if (this._lastMaterialToken === token) return;
        this._lastMaterialToken = token;
        // material: {type, name, path, size}
        // 通过全局变量传递文件信息，跳转到阅读器
        this.globalData.pendingFile = {
          path: material.path,
          name: material.name,
          size: material.size || 0,
          fromScene: 1173
        };
        // ⚠️ onLaunch 阶段页面栈还是空的，此时 navigateTo 必定失败。
        // 必须等首页起来之后再跳，否则「从聊天点开文件」这条路
        // 要么没反应，要么直接把用户扔在一个白页上。
        var url = '/pages/reader/reader?source=material&name=' +
          encodeURIComponent(material.name || '未命名') +
          '&size=' + (material.size || 0);
        var go = function() {
          wx.navigateTo({
            url: url,
            fail: function() {
              // 页面栈满时降级
              wx.redirectTo({ url: url, fail: function() {} });
            }
          });
        };
        if (getCurrentPages().length === 0) {
          setTimeout(go, 0);
        } else {
          go();
        }
      }
    }
  },

  /**
   * 确保隐私授权（在调用 chooseMessageFile / getClipboardData 前调用）
   * 已注册 onNeedPrivacyAuthorization，隐私接口调用时会自动触发弹窗。
   * 此方法仅用于预检查：如果已授权则直接放行，未授权时触发授权流程。
   * @returns {Promise<boolean>}
   */
  ensurePrivacyAuthorized() {
    return new Promise((resolve) => {
      if (this.globalData.privacyAuthorized) {
        resolve(true);
        return;
      }
      // 触发隐私授权检查
      if (wx.requirePrivacyAuthorize) {
        wx.requirePrivacyAuthorize({
          success: () => {
            this.globalData.privacyAuthorized = true;
            resolve(true);
          },
          fail: () => {
            // 用户拒绝授权，onNeedPrivacyAuthorization 已处理弹窗
            resolve(false);
          }
        });
      } else {
        // 低版本基础库无隐私拦截，直接放行
        this.globalData.privacyAuthorized = true;
        resolve(true);
      }
    });
  },

  /**
   * 隐私接口调用失败时，给出**能照着做**的说明
   *
   * 背景（为什么会失败）：
   * app.json 里 `"__usePrivacyCheck__": true` 打开了隐私拦截之后，
   * wx.chooseMessageFile / wx.getClipboardData 就成了受管控的隐私接口。
   * 微信在放行前会检查两件事：
   *   1) 这个小程序在 mp 后台填过《小程序用户隐私保护指引》，并且**声明了这个接口**；
   *   2) 用户同意过这份指引。
   * 第 1 条不满足时，微信连问都不会问，接口直接 fail —— 代码这边无论怎么写都救不回来，
   * 唯一的解法是去后台配置。所以这里必须把两种失败分开讲，否则用户（和开发者）
   * 只会看到一句「需要隐私授权」然后无路可走。
   *
   * @param {Object} err - 接口的 fail 回调参数
   * @param {string} actionLabel - 用户视角的动作名，如「选择聊天文件」
   * @param {string} declareName - 该接口在指引里对应的声明项名称
   * @returns {boolean} 是否是隐私类失败（false 表示调用方该按普通错误处理）
   */
  /**
   * 当前运行环境：develop（开发版）/ trial（体验版）/ release（正式版）
   * 取不到时一律按 release 处理 —— 宁可对开发者少说一句，
   * 也不能把面向开发者的排查指引弹给真实用户
   */
  getEnvVersion() {
    try {
      var info = wx.getAccountInfoSync();
      return (info && info.miniProgram && info.miniProgram.envVersion) || 'release';
    } catch (e) {
      return 'release';
    }
  },

  handlePrivacyFailure(err, actionLabel, declareName) {
    var errMsg = (err && err.errMsg) || '';
    if (errMsg.indexOf('privacy') < 0) return false;

    // 微信从来没触发过授权回调 → 是后台配置问题，不是用户拒绝
    if (!this.globalData.privacyPromptSeen) {
      // ⚠️ 这一支的成因在**开发者侧**（后台没声明该接口），用户自己怎么调设置都没用。
      // 但提示是弹给谁看的要分清楚：开发版/体验版弹给开发者，正式版弹给真实用户。
      // 上线后万一声明被驳回或失效，让用户看到一句"请到 mp.weixin.qq.com..."是荒唐的。
      if (this.getEnvVersion() === 'release') {
        wx.showModal({
          title: '该功能暂不可用',
          content: '「' + actionLabel + '」暂时无法使用，我们正在处理。\n\n' +
            '你可以先用首页的「查看示例」体验阅读效果。',
          showCancel: false,
          confirmText: '知道了'
        });
      } else {
        wx.showModal({
          title: '隐私接口未开通（仅开发版可见）',
          content: '「' + actionLabel + '」需要在小程序后台声明后才能使用。\n\n' +
            '请到 mp.weixin.qq.com → 设置 → 服务内容声明 → 用户隐私保护指引，' +
            '补充声明「' + declareName + '」并提交，通过后即可使用。\n\n' +
            '这是开发者侧的一次性配置，用户在手机上无法自行解决。',
          confirmText: '复制错误',
          cancelText: '知道了',
          success: function(res) {
            if (res.confirm) {
              wx.setClipboardData({ data: errMsg, fail: function() {} });
            }
          }
        });
      }
      return true;
    }

    // 用户刚刚点了「拒绝」。
    //
    // ⚠️ 这里曾经弹一个「还需要你的授权」+「重新授权」的 modal，本意是
    // "别让用户走进死路"，结果造出了一个闭环：
    //   拒绝 → 弹 modal → 点「重新授权」→ 重调接口 → 又触发授权询问 → 拒绝 → ...
    // 而且「重新授权」被放在主按钮位置，唯一的出口「暂不」反而是次要按钮，
    // 等于在鼓励用户留在环里。真机上已复现（见 docs/verify-notes.md §16）。
    //
    // 现在只说一次就结束。用户点「拒绝」本身就是明确的意愿表达，
    // 紧接着再追问一次是骚扰；他改主意时再点一次入口按钮，
    // 自然会重新触发授权流程 —— 重试入口本来就一直在那儿，不需要我们替他着急。
    // 开发版/体验版把原始 errMsg 摆出来。
    // 只给用户看「已取消授权」的话，我们连微信到底报的什么都不知道 ——
    // "点了同意却提示已取消"这类问题，errMsg 是唯一能定案的证据。
    // 注意这个弹窗是终止性的：没有重试按钮，不会重新构成环路。
    if (this.getEnvVersion() !== 'release') {
      wx.showModal({
        title: '授权未通过（仅开发版可见）',
        content: actionLabel + '\n\n' + errMsg,
        confirmText: '复制',
        cancelText: '知道了',
        success: function(res) {
          if (res.confirm) {
            wx.setClipboardData({ data: errMsg, fail: function() {} });
          }
        }
      });
      return true;
    }

    wx.showToast({ title: '已取消授权', icon: 'none', duration: 2000 });
    return true;
  },

  /**
   * 解析隐私授权回调
   * @param {boolean} agreed - 用户是否同意
   */
  resolvePrivacy(agreed, buttonId) {
    if (this.globalData.privacyResolve) {
      var payload = { event: agreed ? 'agree' : 'disagree' };
      // 「同意」必须带上触发它的那个 open-type 按钮的 id。
      // 微信要确认确实有用户点了一个它认可的同意按钮，而不是小程序自己说同意 ——
      // 少了 buttonId 时这次 agree 可能不被采纳，接口照样以 privacy 错误失败，
      // 表现就是"我点了同意，它却提示已取消授权"。
      if (agreed && buttonId) payload.buttonId = buttonId;
      this.globalData.privacyResolve(payload);
      this.globalData.privacyResolve = null;
    }
    if (agreed) {
      this.globalData.privacyAuthorized = true;
    }
  }
});
