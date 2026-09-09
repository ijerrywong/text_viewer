/**
 * core/tokens/index.js — 令牌层入口
 *
 * 这一层的规矩只有一条：**凡是有名字的常量，只有一个定义处。**
 *
 *   design.js —— 视觉令牌（颜色、间距、字号、圆角、层级、动效、阅读区几何）
 *                同时喂给 WXSS（经 scripts/gen_tokens.js 生成）和 JS
 *   limits.js —— 工程限额（AGENTS §2.4 / §2.6 / §2.3 的硬约束）
 *
 * 用法（页面里 require 本文件，路径按各自深度写）：
 *   var tokens = require('<相对路径>/core/tokens/index.js');
 *   tokens.READER.blockGap        // 24
 *   tokens.LIMITS.MAX_BLOCKS      // 50000
 *
 * 只用一个子集时直接引对应文件更省，解析层就是这么做的 ——
 * 只引 limits.js，不把整张调色板拖进解析路径。
 */

var design = require('./design.js');
var limits = require('./limits.js');

module.exports = {
  THEMES: design.THEMES,
  TYPOGRAPHY_DEFAULT: design.TYPOGRAPHY_DEFAULT,
  THEME_CLASS: design.THEME_CLASS,
  NAV_FRONT: design.NAV_FRONT,
  navBarColor: design.navBarColor,
  SPACE: design.SPACE,
  FONT_SIZE: design.FONT_SIZE,
  HEADING_SIZE: design.HEADING_SIZE,
  LEADING: design.LEADING,
  FONT_WEIGHT: design.FONT_WEIGHT,
  TRACKING: design.TRACKING,
  EM_SCALE: design.EM_SCALE,
  SHADOW: design.SHADOW,
  FONT_FAMILY: design.FONT_FAMILY,
  RADIUS: design.RADIUS,
  BORDER: design.BORDER,
  SIZE: design.SIZE,
  RPX_PER_SCREEN: design.RPX_PER_SCREEN,
  CHROME_PX: design.CHROME_PX,
  navContentPx: design.navContentPx,
  Z_INDEX: design.Z_INDEX,
  MOTION: design.MOTION,
  READER: design.READER,
  LIMITS: limits
};
