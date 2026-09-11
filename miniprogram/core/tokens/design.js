/**
 * core/tokens/design.js — 视觉令牌的**唯一真源**
 *
 * 为什么要有这个文件：
 * 同一个视觉常量在这个项目里有两个消费方，而且它们必须永远相等 ——
 *
 *   1. WXSS：真正画到屏幕上的样式；
 *   2. core/render/index.js：虚拟滚动的块高度预估。
 *
 * 预估值一旦和实际样式对不上，滚动就会跳（AGENTS §6 门禁第 7 条）。
 * 在此之前这两边各写各的字面量，没有任何机制保证同步 —— 改了 reader.wxss
 * 的 padding 不会有人想起来去改 render 的预估。现在两边都从这里取值。
 *
 * ⚠️ 本文件是生成 `miniprogram/styles/tokens.wxss` 的输入。
 * 改完必须重新生成：`node scripts/gen_tokens.js`
 * 忘了生成会被 `tests/test-tokens.js` 拦下来。
 *
 * ⚠️ 纯数据模块：不依赖任何 wx API，Node 里可直接 require。
 *
 * 单位约定：所有尺寸值是**无单位的 rpx 数值**。JS 侧直接参与运算，
 * 生成 WXSS 时由 gen_tokens.js 补上 `rpx`。
 */

// ══════════════════════════════════════════════
// 1. 主题调色板
// ══════════════════════════════════════════════
//
// 三套主题共用同一批变量名，切换靠页面根节点上的 .theme-dark / .theme-sepia。
//
// ⚠️ 选择器是 `.theme-dark` 而不是 `page.theme-dark`：WXSS 里的 `page` 指页面
// 根元素本身，而主题 class 挂在 `<view class="page {{themeClass}}">` 上 ——
// 那是 page 的**子节点**。写成 `page.theme-dark` 永远匹配不上（D4）。

var THEME_LIGHT = {
  'bg-primary': '#ffffff',
  'bg-secondary': '#f5f5f5',
  'bg-tertiary': '#ebebeb',
  // 提示条、次要信息条的浅底。取值贴近它此前一直在吃的 fallback
  // rgba(127,127,127,0.08) 在白底上的呈色，所以改造前后观感基本一致 ——
  // 区别是它现在真的跟着主题走了（此前 --bg-subtle 根本没定义过）。
  'bg-subtle': '#f5f5f5',
  'text-primary': '#1a1a1a',
  'text-secondary': '#666666',
  'text-tertiary': '#999999',
  'accent': '#576b95',
  'accent-bg': '#e8eaf0',
  'border': '#e0e0e0',
  'code-bg': '#f6f8fa',
  'code-text': '#24292e',
  'shadow': 'rgba(0, 0, 0, 0.08)',
  // 遮罩：抽屉/弹窗背后的压暗层。深浅主题下都用黑，只差透明度
  'mask': 'rgba(0, 0, 0, 0.4)',
  'mask-strong': 'rgba(0, 0, 0, 0.5)',
  // 反白前景：铺在 accent 底色上的文字（主按钮、主入口卡片）
  'on-accent': '#ffffff',
  'on-accent-dim': 'rgba(255, 255, 255, 0.75)',
  'on-accent-bg': 'rgba(255, 255, 255, 0.2)',
  // 告警（存储空间告急）
  'warn': '#e6a23c',

  // 阅读区
  'reader-bg': '#ffffff',
  'reader-text': '#333333',
  'reader-heading': '#1a1a1a',
  'reader-link': '#576b95',
  'reader-code-bg': '#f6f8fa',
  'reader-blockquote': '#6a737d',
  'reader-blockquote-bg': '#f0f0f0',
  'reader-hr': '#d0d0d0',

  // 搜索命中高亮：普通命中一套、当前命中一套
  //（当前项要能在满屏黄底里被一眼挑出来）
  'search-hl-bg': '#ffe58f',
  'search-hl-text': '#1a1a1a',
  'search-hl-cur-bg': '#f5871f',
  'search-hl-cur-text': '#ffffff',
  'search-hit-bg': 'rgba(245, 135, 31, 0.08)',

  // 语法高亮（GitHub 亮色系）
  'code-tok-keyword': '#d73a49',
  'code-tok-string': '#032f62',
  'code-tok-comment': '#6a737d',
  'code-tok-number': '#005cc5',
  'code-tok-function': '#6f42c1',
  'code-tok-operator': '#d73a49'
};

var THEME_DARK = {
  'bg-primary': '#1a1a1a',
  'bg-secondary': '#141414',
  'bg-tertiary': '#2a2a2a',
  'bg-subtle': '#242424',
  'text-primary': '#e0e0e0',
  'text-secondary': '#a0a0a0',
  'text-tertiary': '#707070',
  'accent': '#7c8db5',
  'accent-bg': '#2a3040',
  'border': '#333333',
  'code-bg': '#1e1e1e',
  'code-text': '#d4d4d4',
  'shadow': 'rgba(0, 0, 0, 0.3)',
  'mask': 'rgba(0, 0, 0, 0.6)',
  'mask-strong': 'rgba(0, 0, 0, 0.7)',
  'on-accent': '#ffffff',
  'on-accent-dim': 'rgba(255, 255, 255, 0.75)',
  'on-accent-bg': 'rgba(255, 255, 255, 0.2)',
  'warn': '#e6a23c',

  'reader-bg': '#1a1a1a',
  'reader-text': '#c8c8c8',
  'reader-heading': '#e0e0e0',
  'reader-link': '#7c8db5',
  'reader-code-bg': '#1e1e1e',
  'reader-blockquote': '#888888',
  'reader-blockquote-bg': '#222222',
  'reader-hr': '#333333',

  'search-hl-bg': '#5c4b1f',
  'search-hl-text': '#f5e6b8',
  'search-hl-cur-bg': '#c77b21',
  'search-hl-cur-text': '#ffffff',
  'search-hit-bg': 'rgba(199, 123, 33, 0.12)',

  // 语法高亮（GitHub 暗色系）
  'code-tok-keyword': '#ff7b72',
  'code-tok-string': '#a5d6ff',
  'code-tok-comment': '#8b949e',
  'code-tok-number': '#79c0ff',
  'code-tok-function': '#d2a8ff',
  'code-tok-operator': '#ff7b72'
};

var THEME_SEPIA = {
  'bg-primary': '#f4ecd8',
  'bg-secondary': '#efe6cf',
  'bg-tertiary': '#e6dcc4',
  'bg-subtle': '#e9e2cf',
  'text-primary': '#5b4636',
  'text-secondary': '#8a7a66',
  'text-tertiary': '#a89880',
  'accent': '#8b6914',
  'accent-bg': '#ede0c8',
  'border': '#d4c9b0',
  'code-bg': '#ebe2cc',
  'code-text': '#4a3f33',
  'shadow': 'rgba(91, 70, 54, 0.1)',
  'mask': 'rgba(59, 45, 32, 0.4)',
  'mask-strong': 'rgba(59, 45, 32, 0.5)',
  'on-accent': '#fff8e8',
  'on-accent-dim': 'rgba(255, 248, 232, 0.75)',
  'on-accent-bg': 'rgba(255, 248, 232, 0.22)',
  'warn': '#b8791f',

  'reader-bg': '#f4ecd8',
  'reader-text': '#5b4636',
  'reader-heading': '#3d2f24',
  'reader-link': '#8b6914',
  'reader-code-bg': '#ebe2cc',
  'reader-blockquote': '#8a7a66',
  'reader-blockquote-bg': '#e8dfca',
  'reader-hr': '#d4c9b0',

  'search-hl-bg': '#e6d08a',
  'search-hl-text': '#4a3a28',
  'search-hl-cur-bg': '#b57a1c',
  'search-hl-cur-text': '#fff8e8',
  'search-hit-bg': 'rgba(181, 122, 28, 0.10)',

  // 语法高亮（低饱和暖色系，配合护眼底色）
  'code-tok-keyword': '#8b4513',
  'code-tok-string': '#556b2f',
  'code-tok-comment': '#a89880',
  'code-tok-number': '#8b6914',
  'code-tok-function': '#6b4226',
  'code-tok-operator': '#8b4513'
};

var THEMES = {
  light: THEME_LIGHT,
  dark: THEME_DARK,
  sepia: THEME_SEPIA
};

// 主题在 WXML 上对应的 class（light 是默认态，不加 class）
var THEME_CLASS = {
  light: '',
  dark: 'theme-dark',
  sepia: 'theme-sepia'
};

/**
 * 微信导航栏配色。
 * `wx.setNavigationBarColor` 的 frontColor 只接受 'black' / 'white' 两个字面量，
 * 所以前景色单列；背景色从主题调色板取，不再另抄一份（此前 app.js 里抄了一遍，
 * 改主题色必漏）。
 */
var NAV_FRONT = {
  light: 'black',
  dark: 'white',
  sepia: 'black'
};

function navBarColor(theme) {
  var t = THEMES[theme] ? theme : 'light';
  return { backgroundColor: THEMES[t]['bg-primary'], frontColor: NAV_FRONT[t] };
}

// ══════════════════════════════════════════════
// 2. 间距阶梯（rpx）
// ══════════════════════════════════════════════
//
// 4rpx 基准阶梯。只有这些档位可用 —— 有限的选项才是约束力所在，
// 想加个 27rpx 时没有对应 token 就会被迫回到阶梯上。
//
// `half` 是唯一的半格，留给行内元素（`.seg-code` 的上下内边距）：
// 那里 4rpx 会让行内代码明显变胖，撑开正文行距。

var SPACE = {
  half: 2,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
  20: 80,
  50: 200   // 空状态/加载态的整屏留白
};

// ══════════════════════════════════════════════
// 3. 字号阶梯（rpx）
// ══════════════════════════════════════════════
//
// 字号不吸附到间距阶梯 —— 两者是彼此独立的 scale，
// 22/24/26 这种 2rpx 步进在小字区是有意义的区分。

var FONT_SIZE = {
  '2xs': 20,   // 进度百分比、工具栏标签
  xs: 22,      // 脚注、次要说明
  sm: 24,      // 辅助文字
  md: 26,      // 正文级小字、代码
  lg: 28,      // 列表项标题
  xl: 30,      // 段落标题、导航标题
  '2xl': 32,   // 区块标题
  '3xl': 34,   // 弹窗标题
  '4xl': 36,   // 主导航标题、图标字
  '5xl': 40,   // 大图标
  '6xl': 48,   // Hero 标题
  '7xl': 80    // 空状态装饰字
};

// 正文标题字号（rpx）。
// ⚠️ 同时被 reader.wxss 的 .block-h1~h6 和 core/render 的高度预估消费 ——
// 这正是必须只有一个定义处的那类值。
var HEADING_SIZE = { 1: 44, 2: 38, 3: 34, 4: 30, 5: 28, 6: 26 };

/**
 * 正文排版的**用户可调**令牌默认值。
 *
 * 与其它令牌不同，这三项运行时会被覆盖：设置页的字号/行距滑块写进用户设置，
 * 阅读器在页面根节点上以 inline style 下发 `--reader-font-size` /
 * `--reader-line-height`，压过这里的默认值。
 *
 * ⚠️ 此前这组默认值在 4 个地方各写了一遍（app.wxss、settings.js、reader.js、
 * core/render 的 DEFAULT_SETTINGS），而且**根本没有下发环节** ——
 * CSS 变量永远是静态的 16px/1.8，滑块拖了正文纹丝不动，
 * 高度预估却按用户设的新值在算，两边反向背离，越调越跳。
 *
 * fontSize 的单位是 px 而不是 rpx：px 在小程序里是逻辑像素，
 * 不同屏宽下正文字号的逻辑大小一致，这是阅读器该有的行为
 *（设置页也以 "16px" 的形式展示给用户）。
 */
var TYPOGRAPHY_DEFAULT = {
  fontSize: 16,      // px，设置页滑块可调
  lineHeight: 1.8,   // 倍率，设置页滑块可调
  screenWidth: 375   // px，iPhone 标准，仅作 rpx↔px 换算的兜底
};

// 行高倍率（无单位）
var LEADING = {
  tight: 1.4,
  snug: 1.5,
  normal: 1.6,
  relaxed: 1.7,
  loose: 1.8    // 正文默认，与设置项 lineHeight 默认值一致
};

// 字重
var FONT_WEIGHT = { normal: 400, medium: 500, semibold: 600, bold: 700 };

// 字距。只在小号全大写/徽章文字上放宽一点，正文不动
var TRACKING = { normal: 0, wide: 1 };

/**
 * 行内元素相对正文的字号比例（em 倍率）。
 * 行内片段必须跟着正文字号缩放 —— 用户把字号调大时，行内代码和上标
 * 也得一起变大，写死 rpx 会脱节。
 */
var EM_SCALE = {
  code: 0.88,    // 行内代码
  sup: 0.8,      // 脚注上标
  hint: 0.85,    // 图片占位等提示性行内文字
  quote: 0.96    // 引用正文（比正文略小一点点）
};

// 字体族
var FONT_FAMILY = {
  sans: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif',
  serif: '"Songti SC", "SimSun", "Noto Serif SC", serif',
  mono: '"SF Mono", "Fira Code", "Menlo", "Consolas", monospace'
};

// ══════════════════════════════════════════════
// 4. 圆角 / 描边（rpx）
// ══════════════════════════════════════════════

var RADIUS = {
  '2xs': 2,    // 进度条
  xs: 4,       // 行内高亮
  sm: 6,       // 行内代码
  md: 8,       // 小标签、命中块
  lg: 12,      // 代码块、提示条（最常用）
  xl: 16,      // 卡片
  '2xl': 20,   // 大卡片
  '3xl': 24,   // 入口卡片
  '4xl': 32,   // 弹窗
  pill: '100rpx',  // 胶囊徽章
  full: '50%'      // 圆形按钮
};

var BORDER = {
  hairline: 1,   // 分割线、卡片描边
  thick: 2,      // 表头下边线、占位框虚线
  focus: 4,      // 主题预览选中框、loading 环
  accent: 6      // 引用块/提示条的左侧强调色条
};

/**
 * 阴影的**几何部分**（偏移 + 模糊半径）。
 * 颜色是主题色，在 WXSS 里拼起来用：`box-shadow: var(--shadow-card) var(--shadow)`。
 * 这样阴影浓淡跟着主题走，形状只在这里定义一次。
 */
var SHADOW = {
  card: '0 2rpx 8rpx',        // 列表项、设置分组
  cardLg: '0 2rpx 12rpx',     // 通用 .card
  cardXl: '0 2rpx 16rpx',     // 首页入口卡片
  modal: '0 8rpx 32rpx',      // 搜索浮层
  barUp: '0 -4rpx 16rpx'      // 贴底窄条，阴影朝上
};

// ══════════════════════════════════════════════
// 5. 尺寸（rpx）
// ══════════════════════════════════════════════

var SIZE = {
  navBarHeight: 88,      // 自定义导航栏内容区高度
  navIcon: 64,           // 导航栏圆形按钮
  entryIcon: 80,         // 入口卡片图标框
  ctrlSm: 56,            // 小方形控件（搜索翻页、队列关闭）
  inputHeight: 72,       // 搜索输入框
  spinner: 60,           // 加载环
  buttonHeight: 88,      // 弹窗按钮
  drawerMaxWidth: 600,   // 抽屉面板 / 弹窗最大宽
  modalMaxWidth: 620,    // 搜索浮层最大宽
  themeSwatchW: 120,     // 设置页主题预览色块
  themeSwatchH: 80,
  // 线性图标的显示尺寸。图标是 <image>，要的是 width/height 而不是 font-size —— 
  // 换成 SVG 之前这两处借用的是字号令牌（--text-4xl / --text-5xl），
  // 那对 emoji 成立，对图片不成立
  iconToolbar: 36,   // 阅读页底部工具栏
  iconEntry: 40,     // 首页入口卡
  tableCellMinWidth: 160,
  searchListMinHeight: 160,
  progressTextMinWidth: 60,
  navActionMinWidth: 48,
  listMarkerMinWidth: 40
};

/**
 * 页面框架的**逻辑像素**尺寸（px，不是 rpx）。
 *
 * 这一组与其它令牌不同，单位是 px：它们参与的是与 `wx.getWindowInfo()`
 * 返回值的运算（状态栏高度、可用视口高度），那些值本身就是逻辑像素。
 *
 * ⚠️ `navContent` 的平台差异不是随手写的：iOS 的导航栏内容区是 44pt，
 * Android 是 48dp，这是两家各自的设计规范。算错会让首屏内容被导航栏压住，
 * 或者底部多出一条空白。
 */
// rpx 坐标系的定义常量：屏幕宽度恒等于 750rpx。
// px ⇄ rpx 的换算全项目只认这一个数。
var RPX_PER_SCREEN = 750;

var CHROME_PX = {
  navContentIOS: 44,
  navContentAndroid: 48,
  toolbarHeight: 50   // 底部工具栏（不含安全区，安全区另算）
};

function navContentPx(platform) {
  return platform === 'android' ? CHROME_PX.navContentAndroid : CHROME_PX.navContentIOS;
}

// ══════════════════════════════════════════════
// 6. 层级
// ══════════════════════════════════════════════
//
// 集中排布才看得出相对关系。此前散在各文件里，加新浮层只能靠猜。

var Z_INDEX = {
  toolbar: 50,        // 底部工具栏
  searchBar: 60,      // 搜索结果窄条（压在工具栏之上）
  navBar: 100,        // 顶部导航栏
  drawerMask: 200,    // 抽屉遮罩
  drawerPanel: 201,   // 抽屉面板
  searchMask: 300,    // 搜索输入浮层
  dialog: 1000        // 隐私授权弹窗（最高）
};

// ══════════════════════════════════════════════
// 7. 动效
// ══════════════════════════════════════════════

var MOTION = {
  fast: '0.2s',      // 按压反馈、颜色过渡
  normal: '0.3s',    // 抽屉滑入滑出
  spin: '0.8s',      // 加载环一圈
  ease: 'ease'
};

// ══════════════════════════════════════════════
// 8. 阅读区几何（rpx）
// ══════════════════════════════════════════════
//
// ⚠️ 这一组是 WXSS 与 core/render 高度预估的共享契约。
// 每一项都在 reader.wxss 里有对应的样式声明，改这里必须两边一起动 ——
// 现在两边引用同一个值，改一处即可。

var READER = {
  contentPadding: SPACE[8],        // .reader-content 的四周内边距（32rpx）
  blockGap: SPACE[6],              // .block 的 margin-bottom（24rpx）
  headingMarginTop: SPACE[10],     // .block-heading margin-top（40rpx）
  headingMarginBottom: SPACE[4],   // .block-heading margin-bottom（16rpx）

  paragraphGap: SPACE[3],          // 段落额外行间补偿（12rpx）

  codeFontSize: FONT_SIZE.md,      // .code-text 字号（26rpx）
  codeLeading: LEADING.normal,     // .code-text 行高（1.6）
  codePadding: SPACE[6],           // .code-scroll 内边距（24rpx）

  listItemGap: SPACE[2],           // 列表项上下补偿（8rpx）
  listIndent: SPACE[8],            // 每层列表缩进（32rpx）

  quoteIndent: SPACE[4],           // 每层引用缩进（16rpx）
  quotePaddingX: SPACE[6],         // .block-quote 左右内边距（24rpx）
  quotePaddingY: SPACE[5],         // .block-quote 上下内边距（20rpx）

  // .table-cell：white-space:nowrap，每格恒为一行，
  // 行高与列宽、屏宽都无关，可精确算出
  tableCellFontSize: FONT_SIZE.md, // 26rpx
  tableCellLeading: LEADING.snug,  // 1.5
  tableCellPaddingY: SPACE[4],     // 上下各 16rpx
  tableRowBorder: BORDER.hairline, // 行分隔线 1rpx

  footnoteFontSize: FONT_SIZE.sm,  // .block-footnote 字号（24rpx）
  footnoteLeading: LEADING.normal,
  footnotePaddingY: SPACE[2],

  htmlFontSize: FONT_SIZE.sm,      // .html-text 字号（24rpx）
  htmlLeading: LEADING.snug,
  htmlPadding: SPACE[5],

  hrMargin: SPACE[10],             // .block-hr 上下外边距（40rpx）

  imagePlaceholderHeight: 400,     // 图片未加载时的占位高度（真实高度由测量回填）
  mathPlaceholderHeight: 120,      // 公式降级块高度
  fallbackBlockHeight: 80,         // 未知块类型的兜底预估高度

  degradeCardPadding: SPACE[6],    // .degrade-card 内边距（24rpx）
  degradeTitleSize: FONT_SIZE.lg,  // 28rpx
  degradeHintSize: FONT_SIZE.sm    // 24rpx
};

module.exports = {
  THEMES: THEMES,
  TYPOGRAPHY_DEFAULT: TYPOGRAPHY_DEFAULT,
  THEME_CLASS: THEME_CLASS,
  NAV_FRONT: NAV_FRONT,
  navBarColor: navBarColor,
  SPACE: SPACE,
  FONT_SIZE: FONT_SIZE,
  HEADING_SIZE: HEADING_SIZE,
  LEADING: LEADING,
  FONT_WEIGHT: FONT_WEIGHT,
  TRACKING: TRACKING,
  EM_SCALE: EM_SCALE,
  SHADOW: SHADOW,
  FONT_FAMILY: FONT_FAMILY,
  RADIUS: RADIUS,
  BORDER: BORDER,
  SIZE: SIZE,
  RPX_PER_SCREEN: RPX_PER_SCREEN,
  CHROME_PX: CHROME_PX,
  navContentPx: navContentPx,
  Z_INDEX: Z_INDEX,
  MOTION: MOTION,
  READER: READER
};
