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

module.exports = {
  getSystemInfo: getSystemInfo,
  withFallback: withFallback,
  FALLBACK: FALLBACK
};
