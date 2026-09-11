#!/usr/bin/env node
/**
 * scripts/gen_icons.js — 把 assets/icons/*.svg 按主题着色，生成 miniprogram/assets/icons.js
 *
 * 为什么要生成而不是直接引 SVG 文件：
 *
 * 1. 小程序读不到代码包里的 .svg 资源文件，只能 require JS 模块 ——
 *    与 gen_samples.js 的处境相同。
 * 2. **`<image>` 的颜色 CSS 改不了。** 不像 HTML 里的 inline SVG 能吃
 *    currentColor，小程序的 image 组件拿到什么颜色就显示什么颜色。
 *    而这套图标要在三套主题下工作，首页主入口卡还要白色、另外两张要强调色。
 *    所以着色只能在构建时做：把源文件里的 currentColor 替换成实际色值，
 *    每个用途 × 每套主题各生成一份 base64。
 *
 * 主题色取自 core/tokens/design.js —— 改主题色时图标自动跟着变，
 * 不需要重新画任何东西。这与 gen_tokens.js 是同一套路子。
 *
 * 改完图标或用途表后跑：node scripts/gen_icons.js
 */

'use strict';

var fs = require('fs');
var path = require('path');

var design = require('../miniprogram/core/tokens/design.js');

var SRC = path.join(__dirname, '..', 'assets', 'icons');
var OUT = path.join(__dirname, '..', 'miniprogram', 'assets', 'icons.js');

/**
 * 用途表：每个键是页面里的一个具体位置，指明用哪个图标、取哪个主题色。
 *
 * ⚠️ 「哪个位置用什么颜色」的知识只存在于这张表里。页面 wxml 只写
 * `{{icons.toolbarToc}}`，不关心颜色是怎么来的；主题一换，整份 icons
 * 重新 setData 即可。
 *
 * color 的取值是 core/tokens/design.js 里 THEMES 的键名，不是色值本身。
 */
var USAGE = [
  // 阅读页底部工具栏：四个同级按钮，统一走次要文字色
  { key: 'toolbarToc',      icon: 'toc',       color: 'text-secondary' },
  { key: 'toolbarSearch',   icon: 'search',    color: 'text-secondary' },
  { key: 'toolbarSettings', icon: 'settings',  color: 'text-secondary' },
  { key: 'toolbarBookmark', icon: 'bookmark',  color: 'text-secondary' },

  // 首页入口卡：主入口卡（entry-primary）是 accent 底色，图标得反白；
  // 另外两张是浅底，图标用 accent
  { key: 'entryChat',       icon: 'chat-file', color: 'on-accent' },
  { key: 'entryPaste',      icon: 'paste',     color: 'accent' },
  { key: 'entrySample',     icon: 'sample',    color: 'accent' }
];

// ─── 读取并压掉 SVG 里的多余空白 ───

function readIcon(name) {
  var file = path.join(SRC, name + '.svg');
  if (!fs.existsSync(file)) {
    throw new Error('图标源文件不存在：' + path.relative(path.join(__dirname, '..'), file));
  }
  return fs.readFileSync(file, 'utf-8')
    .replace(/\n/g, '')
    .replace(/>\s+</g, '><')
    .trim();
}

function tint(svg, color) {
  if (svg.indexOf('currentColor') < 0) {
    throw new Error('源文件里没有 currentColor 占位，无法着色');
  }
  return svg.split('currentColor').join(color);
}

// data URI。用 encodeURIComponent 而不是 base64：
// SVG 是文本，转义后的体积比 base64 更小（base64 固定膨胀 33%）
function toDataUri(svg) {
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

// ─── 生成 ───

var themes = Object.keys(design.THEMES);
var out = {};
var total = 0;

themes.forEach(function (theme) {
  var palette = design.THEMES[theme];
  out[theme] = {};

  USAGE.forEach(function (u) {
    var color = palette[u.color];
    if (!color) {
      throw new Error('主题 ' + theme + ' 里没有颜色令牌 ' + u.color);
    }
    var uri = toDataUri(tint(readIcon(u.icon), color));
    out[theme][u.key] = uri;
    total += uri.length;
  });
});

var lines = [];
lines.push('/**');
lines.push(' * assets/icons.js — 由 scripts/gen_icons.js 自动生成，请勿手改');
lines.push(' *');
lines.push(' * 源文件：assets/icons/*.svg（24×24 网格，currentColor 占位）');
lines.push(' * 主题色：miniprogram/core/tokens/design.js 的 THEMES');
lines.push(' * 重新生成：node scripts/gen_icons.js');
lines.push(' *');
lines.push(' * 用法：页面按当前主题整份取用，wxml 里 <image src="{{icons.toolbarToc}}"/>');
lines.push(' *   var icons = require(\'<相对路径>/assets/icons.js\');');
lines.push(' *   this.setData({ icons: icons[theme] || icons.light });');
lines.push(' */');
lines.push('');
lines.push('module.exports = ' + JSON.stringify(out, null, 2) + ';');
lines.push('');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, lines.join('\n'), 'utf-8');

console.log('已生成 ' + path.relative(path.join(__dirname, '..'), OUT));
console.log('  ' + themes.length + ' 套主题 × ' + USAGE.length + ' 个用途 = ' +
  (themes.length * USAGE.length) + ' 份，data URI 合计 ' + Math.round(total / 1024) + ' KB');
