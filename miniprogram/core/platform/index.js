/**
 * core/platform/index.js - 平台信息适配
 *
 * `wx.getSystemInfoSync` 已被官方标记废弃，运行时每次调用都会打一条
 * deprecation 警告，指引拆用这三个更细的接口：
 *
 *   wx.getWindowInfo()   → pixelRatio / screenWidth / screenHeight /
 *                          windowWidth / windowHeight / statusBarHeight /
 *                          safeArea / screenTop
 *   wx.getDeviceInfo()   → brand / model / system / platform / abi / benchmarkLevel
 *   wx.getAppBaseInfo()  → SDKVersion / version / language / theme / host
 *
 * ⚠️ 但**不能直接切过去**：新接口要基础库 2.20.1+，更老的微信上根本不存在。
 * 本项目的目标用户是"在微信里临时看文档"的人，微信版本参差不齐，
 * 直接调用会在低版本上抛 TypeError，而这是在 onLaunch 里 ——
 * 一炸就是整个小程序白屏。所以按能力检测降级，老接口留作兜底。
 *
 * 调用方拿到的仍是一个扁平对象，字段名与原来的 systemInfo 一致，
 * 所以 `sys.statusBarHeight` / `sys.platform` 这些读法都不用改。
 */

// 本项目实际消费的字段，兜底值按 iPhone 标准屏给，
// 保证页面里 sys.xxx 永远不会读到 undefined 的属性
var FALLBACK = {
  statusBarHeight: 20,
  windowWidth: 375,
  windowHeight: 667,
  screenHeight: 667,
  platform: 'devtools',
  SDKVersion: ''
};

function mergeInto(target, src) {
  if (!src) return target;
  for (var key in src) {
    if (Object.prototype.hasOwnProperty.call(src, key)) target[key] = src[key];
  }
  return target;
}

function hasNewApis() {
  return typeof wx !== 'undefined' &&
    typeof wx.getWindowInfo === 'function' &&
    typeof wx.getDeviceInfo === 'function' &&
    typeof wx.getAppBaseInfo === 'function';
}

/**
 * 读取系统信息。永远返回一个对象，不抛异常。
 * @returns {Object} 扁平的 systemInfo，字段名兼容 wx.getSystemInfoSync
 */
function getSystemInfo() {
  var info = {};

  if (hasNewApis()) {
    try {
      mergeInto(info, wx.getWindowInfo());
      mergeInto(info, wx.getDeviceInfo());
      mergeInto(info, wx.getAppBaseInfo());
      return info;
    } catch (e) {
      // 新接口存在但调用失败（理论上不该发生），落到老接口
      console.error('getWindowInfo/getDeviceInfo/getAppBaseInfo 调用失败', e);
      info = {};
    }
  }

  // 老基础库：只剩这一条路，明知废弃也得走
  try {
    if (typeof wx !== 'undefined' && typeof wx.getSystemInfoSync === 'function') {
      return mergeInto(info, wx.getSystemInfoSync());
    }
  } catch (e) {
    console.error('获取系统信息失败', e);
  }

  return mergeInto(info, FALLBACK);
}

/**
 * 补齐缺失字段。系统信息拿到了但某几项是 undefined 时用，
 * 调用方不必各自写一遍兜底。
 */
function withFallback(info) {
  var out = mergeInto({}, FALLBACK);
  return mergeInto(out, info || {});
}

// ─── 自定义导航栏与胶囊按钮 ───

var design = require('../tokens/design.js');

/**
 * 右上角胶囊按钮（「···」和「○」）的位置与尺寸。
 *
 * `navigationStyle: custom` 之后，顶部整条都归我们画，**唯独这块不归** ——
 * 胶囊由微信绘制在页面之上，位置固定，既盖不住也移不走。所以自定义导航栏
 * 右侧放任何东西之前，都得先问它占了哪儿。
 *
 * @returns {Object|null} {width,height,top,right,bottom,left}（px），拿不到时 null
 */
function getMenuButtonRect() {
  try {
    if (typeof wx !== 'undefined' &&
        typeof wx.getMenuButtonBoundingClientRect === 'function') {
      var rect = wx.getMenuButtonBoundingClientRect();
      // PC 端和部分宿主会返回一个全 0 的对象，那种情况按「没有胶囊」处理，
      // 否则右侧会凭空让出一大块空白
      if (rect && rect.width > 0 && rect.height > 0) return rect;
    }
  } catch (e) {
    // 接口不存在或调用失败，走下面的兜底
  }
  return null;
}

/**
 * 自定义导航栏的布局参数。
 *
 * @param {Object} sys - 已 withFallback 过的系统信息
 * @returns {{contentHeight:number, rightInset:number}} 均为 px
 *   contentHeight - 导航栏内容区高度（不含状态栏）
 *   rightInset    - 右侧需要让开的宽度，直接用作 padding-right
 */
function getNavLayout(sys) {
  var statusBarHeight = sys.statusBarHeight;
  var rect = getMenuButtonRect();

  if (rect) {
    // 胶囊到状态栏底部的距离。上下各留同样一份，胶囊就垂直居中于内容区，
    // 我们自己的按钮也跟着对齐到同一条水平中线上
    var gap = rect.top - statusBarHeight;
    // 极端窗口（分屏、折叠屏中间态）下 gap 可能算成负数，钳一下
    if (!(gap > 0)) gap = 0;

    return {
      // 内容区高度按实测的胶囊位置算，比 44/48 的平台规范值更贴合当前设备
      contentHeight: gap * 2 + rect.height,
      // 让出胶囊左边缘以右的全部宽度，再加一份 gap 作为视觉间隙 ——
      // 紧贴着胶囊放按钮，点击热区会互相干扰
      rightInset: Math.max(0, sys.windowWidth - rect.left + gap)
    };
  }

  // 拿不到胶囊信息：回到平台规范值，右侧不额外让开
  //（真机上这条几乎不会走到，主要是 Node 测试和异常宿主）
  return {
    contentHeight: design.navContentPx(sys.platform),
    rightInset: 0
  };
}

module.exports = {
  getSystemInfo: getSystemInfo,
  withFallback: withFallback,
  getMenuButtonRect: getMenuButtonRect,
  getNavLayout: getNavLayout,
  FALLBACK: FALLBACK
};
