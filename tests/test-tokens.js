/**
 * tests/test-tokens.js — 令牌层门禁
 *
 * token 化不是一次性的整理，是一条要守住的线。没有门禁，下一次「就加个
 * 27rpx 吧」就会把它蛀空，几个月后又退回到满地字面量的状态。
 *
 * 这里查五件事：
 *
 *   1. 生成物与源同步 —— 改了 design.js 忘了跑 gen_tokens.js，当场拦下；
 *   2. 页面/组件 WXSS 里没有色值和 rpx 字面量 —— 全部走 var(--token)；
 *   3. 引用的每个令牌都真的有定义 —— `--bg-subtle` 就是没定义却被引用了
 *      三处，一直在吃 fallback，提示条在三套主题下从没跟过主题；
 *   4. var() 不许带 fallback —— fallback 正是上面那个 bug 藏了这么久的原因，
 *      它让「令牌不存在」表现得和「令牌存在」一模一样；
 *   5. 工程限额只有一个定义处 —— MAX_BLOCKS 曾在 5 个文件里各写一遍。
 *
 * 直接跑：node tests/test-tokens.js
 */

'use strict';

var fs = require('fs');
var path = require('path');
var childProcess = require('child_process');

var ROOT = path.join(__dirname, '..');
var MINI = path.join(ROOT, 'miniprogram');
var TOKENS_WXSS = path.join(MINI, 'styles', 'tokens.wxss');

var pass = 0;
var fail = 0;

function ok(label, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + label); return; }
  fail++;
  console.log('  ✗ ' + label + (detail !== undefined ? ' — ' + detail : ''));
}

function read(p) {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null;
}

// 递归收集某个目录下的指定后缀文件
function collect(dir, ext, out) {
  out = out || [];
  if (!fs.existsSync(dir)) return out;
  fs.readdirSync(dir).forEach(function (name) {
    var full = path.join(dir, name);
    var st = fs.statSync(full);
    if (st.isDirectory()) collect(full, ext, out);
    else if (name.slice(-ext.length) === ext) out.push(full);
  });
  return out;
}

function rel(p) {
  return path.relative(ROOT, p);
}

// 令牌源。图标层与高度预估两节都要用，所以在这里就取
var design = require(path.join(MINI, 'core', 'tokens', 'design.js'));

// 去掉 /* */ 注释，避免注释里写的示例值被误判成字面量
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

// ─── 1. 生成物与源同步 ───

console.log('\n生成物与源同步');

var before = read(TOKENS_WXSS);
ok('styles/tokens.wxss 存在', before !== null);

if (before !== null) {
  var res = childProcess.spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'gen_tokens.js')],
    { encoding: 'utf-8' }
  );
  ok('gen_tokens.js 能正常跑完', res.status === 0,
    (res.stderr || '').trim().split('\n').slice(-3).join(' / '));

  var after = read(TOKENS_WXSS);
  ok('tokens.wxss 与 core/tokens/design.js 一致'
    + '（不一致说明改了源没重新生成：node scripts/gen_tokens.js）',
    before === after);
}

// ─── 1b. 图标生成物与 SVG 源同步 ───

console.log('\n图标层');

var ICONS_JS = path.join(MINI, 'assets', 'icons.js');
var ICONS_SRC = path.join(ROOT, 'assets', 'icons');

var iconsBefore = read(ICONS_JS);
ok('assets/icons.js 存在', iconsBefore !== null);

if (iconsBefore !== null) {
  var ires = childProcess.spawnSync(
    process.execPath, [path.join(ROOT, 'scripts', 'gen_icons.js')], { encoding: 'utf-8' }
  );
  ok('gen_icons.js 能正常跑完', ires.status === 0,
    (ires.stderr || '').trim().split('\n').slice(-3).join(' / '));
  ok('icons.js 与 assets/icons/*.svg 一致'
    + '（不一致说明改了图标没重新生成：node scripts/gen_icons.js）',
    iconsBefore === read(ICONS_JS));

  var icons = require(ICONS_JS);
  var themeNames = Object.keys(design.THEMES);

  ok('每套主题都有一份图标', themeNames.every(function (t) {
    return icons[t] && Object.keys(icons[t]).length > 0;
  }), Object.keys(icons).join(', '));

  // 着色必须真的发生 —— 残留 currentColor 在小程序里会渲染成黑色，
  // 深色主题下直接看不见
  ok('没有 currentColor 残留（image 的颜色 CSS 改不了，必须构建时注入）',
    JSON.stringify(icons).indexOf('currentColor') < 0);

  // 同一个用途在不同主题下必须是不同的着色结果，否则等于没跟主题
  var differs = themeNames.length < 2 ||
    icons[themeNames[0]].toolbarToc !== icons[themeNames[1]].toolbarToc;
  ok('同一图标在不同主题下着色不同', differs);

  // 抽一个用途，验证注入的正是令牌表里的色值
  var lightToc = decodeURIComponent(
    icons.light.toolbarToc.replace('data:image/svg+xml,', ''));
  ok('工具栏图标用的是 text-secondary 令牌色',
    lightToc.indexOf(design.THEMES.light['text-secondary']) >= 0);

  var lightChat = decodeURIComponent(
    icons.light.entryChat.replace('data:image/svg+xml,', ''));
  ok('主入口卡图标用的是 on-accent 令牌色（它铺在 accent 底上）',
    lightChat.indexOf(design.THEMES.light['on-accent']) >= 0);
}

// 源文件规格一致 —— 七个图标并排时，线宽不齐是最扎眼的
if (fs.existsSync(ICONS_SRC)) {
  var svgs = fs.readdirSync(ICONS_SRC).filter(function (f) { return /\.svg$/.test(f); });
  ok('扫到图标源文件', svgs.length > 0, svgs.length + ' 个');

  var badGrid = [], badStroke = [], noPlaceholder = [];
  svgs.forEach(function (f) {
    var src = read(path.join(ICONS_SRC, f)) || '';
    if (src.indexOf('viewBox="0 0 24 24"') < 0) badGrid.push(f);
    if (src.indexOf('stroke-width="2"') < 0) badStroke.push(f);
    if (src.indexOf('currentColor') < 0) noPlaceholder.push(f);
  });
  ok('全部用 24×24 网格', badGrid.length === 0, badGrid.join(', '));
  ok('全部是 2px 线宽（线宽不齐是成套图标最扎眼的破绽）',
    badStroke.length === 0, badStroke.join(', '));
  ok('全部用 currentColor 占位（源文件不上色，颜色构建时注入）',
    noPlaceholder.length === 0, noPlaceholder.join(', '));
}

// ─── 2. WXSS 里没有字面量 ───

console.log('\nWXSS 字面量泄漏');

// tokens.wxss 是令牌的定义处，字面量本来就该在那里
var wxssFiles = collect(MINI, '.wxss').filter(function (p) {
  return p !== TOKENS_WXSS;
});

ok('扫到了 WXSS 文件', wxssFiles.length > 0, '共 ' + wxssFiles.length + ' 个');

var COLOR_RE = /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(/g;
var RPX_RE = /(?<![\w-])\d+(?:\.\d+)?rpx\b/g;

var colorLeaks = [];
var rpxLeaks = [];

wxssFiles.forEach(function (file) {
  var src = stripComments(read(file) || '');
  src.split('\n').forEach(function (line, i) {
    var where = rel(file) + ':' + (i + 1);
    var c = line.match(COLOR_RE);
    if (c) colorLeaks.push(where + ' ' + c.join(' '));
    var r = line.match(RPX_RE);
    if (r) rpxLeaks.push(where + ' ' + r.join(' '));
  });
});

ok('没有色值字面量（一律走 var(--token)）',
  colorLeaks.length === 0, colorLeaks.slice(0, 8).join('; '));
ok('没有 rpx 字面量（一律走 var(--token)）',
  rpxLeaks.length === 0, rpxLeaks.slice(0, 8).join('; '));

// ─── 3+4. 令牌引用完整、且不靠 fallback 兜底 ───

console.log('\n令牌引用');

var tokensSrc = read(TOKENS_WXSS) || '';
var defined = {};
var defRe = /^\s*--([a-z0-9-]+)\s*:/gim;
var m;
while ((m = defRe.exec(tokensSrc)) !== null) defined[m[1]] = true;

ok('tokens.wxss 里有令牌定义',
  Object.keys(defined).length > 20,
  '共 ' + Object.keys(defined).length + ' 个');

var undefinedRefs = [];
var fallbackRefs = [];

// 页面可以在 WXML 的 inline style 里下发自己的令牌（阅读器就是这么
// 把用户选的字号写进 --reader-font-size 的），这些不算未定义
var RUNTIME_TOKENS = { 'reader-font-size': true, 'reader-line-height': true };

wxssFiles.forEach(function (file) {
  var src = stripComments(read(file) || '');
  src.split('\n').forEach(function (line, i) {
    var where = rel(file) + ':' + (i + 1);
    var varRe = /var\(\s*--([a-z0-9-]+)\s*(,)?/gi;
    var v;
    while ((v = varRe.exec(line)) !== null) {
      var name = v[1];
      if (!defined[name] && !RUNTIME_TOKENS[name]) {
        undefinedRefs.push(where + ' --' + name);
      }
      if (v[2]) fallbackRefs.push(where + ' --' + name);
    }
  });
});

ok('引用的令牌都有定义', undefinedRefs.length === 0,
  undefinedRefs.slice(0, 8).join('; '));
ok('var() 不带 fallback（fallback 会把「令牌不存在」伪装成正常）',
  fallbackRefs.length === 0, fallbackRefs.slice(0, 8).join('; '));

// ─── 5. 工程限额只有一个定义处 ───

console.log('\n工程限额单一定义处');

var LIMITS = require(path.join(MINI, 'core', 'tokens', 'limits.js'));
var LIMITS_FILE = path.join(MINI, 'core', 'tokens', 'limits.js');

// tailwind.js 是 Tailwind 官方调色板/尺度的复刻，那里的数字是**外部规范**，
// 必须逐一对上游，不是本项目的设计决策，所以不纳入令牌层。
// 编码码表同理：那些是标准里的码位。
var LITERAL_SCAN_SKIP = /tailwind\.js$|-table\.js$|gb18030-ranges\.js$|decoder\.js$|samples\.js$/;

var jsFiles = collect(MINI, '.js').filter(function (p) {
  return p !== LIMITS_FILE && !LITERAL_SCAN_SKIP.test(p);
});

// 只查那些「一旦漂移就会让不同格式表现不一致」的跨文件阈值
var SHARED = ['MAX_BLOCKS', 'MAX_NODES', 'MAX_DEPTH', 'MAX_TOC', 'MAX_LIST_DEPTH'];

var dupDefs = [];
var bareLiterals = [];

jsFiles.forEach(function (file) {
  var src = read(file) || '';
  src.split('\n').forEach(function (line, i) {
    var where = rel(file) + ':' + (i + 1);
    // 注释行不算
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;

    SHARED.forEach(function (key) {
      // 本地重新赋一个字面量值 = 又一个定义处
      var re = new RegExp('\\b' + key + '\\s*[:=]\\s*\\d');
      if (re.test(line)) dupDefs.push(where + ' ' + key);
    });

    // 裸字面量 50000（converter.js 里曾经就有一个 `> 50000`）
    if (/(?<![\w.])50000(?![\w])/.test(line)) {
      bareLiterals.push(where);
    }
  });
});

ok('MAX_BLOCKS 等共享阈值没有第二个定义处', dupDefs.length === 0,
  dupDefs.slice(0, 8).join('; '));
ok('源码里没有裸的 50000 字面量', bareLiterals.length === 0,
  bareLiterals.slice(0, 8).join('; '));

ok('limits.js 导出了全部共享阈值',
  SHARED.every(function (k) { return typeof LIMITS[k] === 'number'; }),
  SHARED.filter(function (k) { return typeof LIMITS[k] !== 'number'; }).join(', '));

// ─── 5b. JS 里不再抄主题色 ───

console.log('\nJS 色值字面量');

// 主题色曾在 4 个地方各写一遍：app.wxss、app.js 的 THEME_NAV、
// settings.wxss 的预览色块、settings.js 的 getAccentColor。
// 原生组件（slider / switch）读不到 CSS 变量，确实需要 JS 侧的色值 ——
// 但必须从 core/tokens/design.js 取，不能再抄。
// converter.js 的 TAG_DEFAULTS 是**浏览器用户代理样式表**的复刻
//（小程序没有 UA 样式表，外来 HTML 的 <pre>/<a>/<table> 得自己补默认外观）。
// 那是渲染**别人的文档**该长什么样，和阅读器自身 UI 的主题是两个体系 ——
// 让外来文档跟着我们的主题变色反而破坏文档作者的设计意图。所以不纳入令牌层。
var UA_STYLESHEET = /parse\/html\/converter\.js$/;
var TOKENS_DIR = path.join(MINI, 'core', 'tokens');
var colorScanFiles = collect(MINI, '.js').filter(function (p) {
  return p.indexOf(TOKENS_DIR) !== 0 &&
    !LITERAL_SCAN_SKIP.test(p) && !UA_STYLESHEET.test(p);
});

var jsColorLeaks = [];
colorScanFiles.forEach(function (file) {
  var src = read(file) || '';
  src.split('\n').forEach(function (line, i) {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;   // 注释不算
    var m2 = line.match(/['"]#[0-9a-fA-F]{3,8}['"]/g);
    if (m2) jsColorLeaks.push(rel(file) + ':' + (i + 1) + ' ' + m2.join(' '));
  });
});

ok('JS 里没有色值字面量（一律从 core/tokens/design.js 取）',
  jsColorLeaks.length === 0, jsColorLeaks.slice(0, 8).join('; '));

// ─── 5c. 字号/行距的下发链路是通的 ───

console.log('\n用户可调排版的下发链路');

var readerWxmlSrc = read(path.join(MINI, 'pages', 'reader', 'reader.wxml')) || '';
var readerJsSrc = read(path.join(MINI, 'pages', 'reader', 'reader.js')) || '';

// 光在 WXSS 里定义 --reader-font-size 不够 —— 必须真的把用户设的值写到
// 页面根节点上，否则设置页的滑块就是断路的：正文纹丝不动，
// 而高度预估却按新值在算，两边反向背离。
ok('reader.wxml 根节点下发了排版样式',
  /class="page \{\{themeClass\}\}"\s+style="\{\{readerStyle\}\}"/.test(readerWxmlSrc));
ok('reader.js 把用户字号写进了 --reader-font-size',
  readerJsSrc.indexOf('--reader-font-size:') >= 0);
ok('reader.js 把用户行距写进了 --reader-line-height',
  readerJsSrc.indexOf('--reader-line-height:') >= 0);

// ─── 6. WXSS 与 JS 高度预估共享同一批几何值 ───

console.log('\n样式与高度预估同源');

var readerWxss = stripComments(read(path.join(MINI, 'pages', 'reader', 'reader.wxss')) || '');

// 抽查几条最容易漂移、且漂移后直接表现为滚动跳动的
var CONTRACT = [
  ['--rd-content-padding', '.reader-content 的内边距'],
  ['--rd-block-gap', '.block 的块间距'],
  ['--rd-table-cell-font-size', '表格单元格字号'],
  ['--rd-table-cell-leading', '表格单元格行高'],
  ['--rd-code-font-size', '代码块字号']
];

CONTRACT.forEach(function (pair) {
  ok(pair[1] + ' 在 reader.wxss 里走令牌 ' + pair[0],
    readerWxss.indexOf('var(' + pair[0] + ')') >= 0);
});

ok('标题字号 h1~h6 全部走 --heading-* 令牌',
  [1, 2, 3, 4, 5, 6].every(function (n) {
    return readerWxss.indexOf('var(--heading-' + n + ')') >= 0;
  }));

ok('design.js 的 READER 契约项齐备',
  typeof design.READER.contentPadding === 'number' &&
  typeof design.READER.blockGap === 'number' &&
  typeof design.HEADING_SIZE[1] === 'number');

// ─── 汇总 ───

console.log('\n' + '='.repeat(40));
console.log('通过: ' + pass + ' | 失败: ' + fail);
if (fail > 0) process.exitCode = 1;
else console.log('全部通过！');
