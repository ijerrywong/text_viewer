#!/usr/bin/env node
/**
 * scripts/gen_tokens.js — 从令牌源生成 miniprogram/styles/tokens.wxss
 *
 * 为什么要生成而不是各写一份：
 * WXSS 没法 require JS，但视觉常量在 JS 侧（core/render 的高度预估）也要用。
 * 让 WXSS 手抄一遍 JS 里的值，就是这个项目此前的状态 —— 改一边忘一边，
 * 高度预估和实际样式对不上，表现为滚动跳动（AGENTS §6 门禁第 7 条）。
 *
 * 所以定死方向：`core/tokens/design.js` 是源，本脚本是唯一的搬运工。
 * **不要手改 tokens.wxss**，改动会被下一次生成覆盖，
 * 而且 tests/test-tokens.js 会当场发现生成物与源不一致。
 *
 * 改完 core/tokens/design.js 后跑：node scripts/gen_tokens.js
 */

'use strict';

var fs = require('fs');
var path = require('path');

var design = require('../miniprogram/core/tokens/design.js');

var OUT = path.join(__dirname, '..', 'miniprogram', 'styles', 'tokens.wxss');

// ─── 值的格式化 ───

// 尺寸类令牌在源里是无单位的 rpx 数值，这里补上单位；
// 已经带单位或是关键字的（'50%'、'100rpx'、'ease'）原样输出
function rpx(v) {
  return typeof v === 'number' ? v + 'rpx' : String(v);
}

// 无单位的倍率 / 权重 / 层级
function bare(v) {
  return String(v);
}

// camelCase → kebab-case，令牌名在 WXSS 里一律用连字符
function kebab(s) {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

// ─── 输出缓冲 ───

var lines = [];

function comment(text) {
  lines.push('');
  lines.push('  /* ' + text + ' */');
}

function decl(name, value) {
  lines.push('  --' + name + ': ' + value + ';');
}

function group(prefix, obj, fmt) {
  Object.keys(obj).forEach(function (key) {
    decl(prefix + kebab(key), fmt(obj[key]));
  });
}

// ─── 文件头 ───

lines.push('/**');
lines.push(' * tokens.wxss — 由 scripts/gen_tokens.js 自动生成，请勿手改');
lines.push(' *');
lines.push(' * 源文件：miniprogram/core/tokens/design.js');
lines.push(' * 重新生成：node scripts/gen_tokens.js');
lines.push(' *');
lines.push(' * 手改这里的后果：下次生成时被覆盖，且 tests/test-tokens.js 会失败。');
lines.push(' */');

// ─── page：浅色主题 + 全部非颜色令牌 ───
// 非颜色令牌不随主题变化，只在这里出现一次。

lines.push('');
lines.push('page {');

comment('主题调色板 · 浅色（默认）');
group('', design.THEMES.light, String);

// 设置页的主题预览色块要同时显示三套主题的颜色，用不了 var(--bg-primary)
//（那永远是**当前**主题的值）。所以为每套主题各发一组固定令牌 ——
// 源头仍是上面同一份 THEMES，改主题色时预览自动跟着变，
// 不必像此前那样在 settings.wxss 里手抄一遍色值。
comment('主题预览色块（设置页专用：跨主题的固定值）');
Object.keys(design.THEMES).forEach(function (name) {
  decl('preview-' + name + '-bg', design.THEMES[name]['bg-primary']);
  decl('preview-' + name + '-text', design.THEMES[name]['text-primary']);
});

comment('正文排版（用户可调：阅读器以 inline style 下发同名变量覆盖）');
decl('reader-font-size', design.TYPOGRAPHY_DEFAULT.fontSize + 'px');
decl('reader-line-height', bare(design.TYPOGRAPHY_DEFAULT.lineHeight));

comment('间距阶梯');
group('space-', design.SPACE, rpx);

comment('字号阶梯');
group('text-', design.FONT_SIZE, rpx);

comment('正文标题字号（与 core/render 高度预估共享同一组值）');
group('heading-', design.HEADING_SIZE, rpx);

comment('行高倍率');
group('leading-', design.LEADING, bare);

comment('字重');
group('weight-', design.FONT_WEIGHT, bare);

comment('字距');
group('tracking-', design.TRACKING, rpx);

comment('行内元素相对字号（em 倍率，跟随正文字号缩放）');
group('em-', design.EM_SCALE, function (v) { return v + 'em'; });

comment('阴影几何（颜色另取 var(--shadow)，拼起来用）');
group('shadow-', design.SHADOW, String);

comment('字体族');
decl('font-family', design.FONT_FAMILY.sans);
decl('font-serif', design.FONT_FAMILY.serif);
decl('font-mono', design.FONT_FAMILY.mono);

comment('圆角');
group('radius-', design.RADIUS, rpx);

comment('描边宽度');
group('bw-', design.BORDER, rpx);

comment('尺寸');
group('size-', design.SIZE, rpx);

comment('层级');
group('z-', design.Z_INDEX, bare);

comment('动效');
group('motion-', design.MOTION, bare);

comment('阅读区几何（与 core/render 高度预估共享同一组值）');
Object.keys(design.READER).forEach(function (key) {
  // 行高是倍率，不能补 rpx
  var isRatio = /Leading$/.test(key);
  decl('rd-' + kebab(key), isRatio ? bare(design.READER[key]) : rpx(design.READER[key]));
});

comment('页面默认外观');
lines.push('  background-color: var(--bg-secondary);');
lines.push('  color: var(--text-primary);');
lines.push('  font-family: var(--font-family);');
lines.push('  font-size: var(--reader-font-size);');
lines.push('  line-height: var(--reader-line-height);');

lines.push('}');

// ─── 深色 / 护眼主题：只覆盖颜色 ───
//
// ⚠️ 选择器是 `.theme-dark` 而不是 `page.theme-dark`：WXSS 里的 `page` 指页面
// 根元素本身，而主题 class 挂在 `<view class="page {{themeClass}}">` 上 ——
// 那是 page 的子节点，写成 `page.theme-dark` 永远匹配不上（D4）。

[['dark', '深色主题'], ['sepia', '护眼主题']].forEach(function (pair) {
  var name = pair[0];
  lines.push('');
  lines.push('/* ══ ' + pair[1] + '：只覆盖颜色，尺寸类令牌不随主题变化 ══ */');
  lines.push('.' + design.THEME_CLASS[name] + ' {');
  group('', design.THEMES[name], String);
  lines.push('}');
});

lines.push('');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, lines.join('\n'), 'utf-8');

console.log('已生成 ' + path.relative(path.join(__dirname, '..'), OUT) +
  '（' + lines.length + ' 行）');
