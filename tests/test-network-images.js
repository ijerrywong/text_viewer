/**
 * tests/test-network-images.js — 网络图片默认值与门控覆盖面（ADR-13）
 *
 * ADR-13 把网络图片默认值从「关」翻成「开」。翻默认值这件事有两个容易漏的地方，
 * 两个都只在真机上才暴露，所以在这里静态 + 纯函数各钉一遍：
 *
 *   1. **老用户到不了新默认值**。saveSettings 写的是整个 settings 对象，
 *      用户只要动过任意一项设置，旧的 networkImages:false 就在本地存储里，
 *      之后 Object.assign(DEFAULT_SETTINGS, saved) 永远是 saved 赢。
 *      必须配一次显式迁移。
 *   2. **门控只覆盖了 HTML**。原先 gateNetworkImages 只在 reader 的 html 分支里调用，
 *      Markdown 的图床外链根本没被门控住 —— 而引用图床的恰恰以 Markdown 居多。
 *      默认开启之后这个开关是隐私用户唯一的关掉方式，它必须真的关得掉。
 *
 *   node tests/test-network-images.js
 */

'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..', 'miniprogram');
var mdBlock = require(path.join(ROOT, 'core', 'parse', 'md', 'block.js'));
var mdInline = require(path.join(ROOT, 'core', 'parse', 'md', 'inline.js'));
var postprocess = require(path.join(ROOT, 'core', 'parse', 'html', 'postprocess.js'));

var pass = 0;
var fail = 0;

function ok(label, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + label); return; }
  fail++;
  console.log('  ✗ ' + label + (detail !== undefined ? ' — ' + detail : ''));
}

function read(p) {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
}

// ─── 1. 默认值与迁移 ───

console.log('\n默认值与迁移（ADR-13）');

var appJs = read(path.join(ROOT, 'app.js'));

ok('DEFAULT_SETTINGS.networkImages 为 true',
  /DEFAULT_SETTINGS\s*=\s*\{[\s\S]*?networkImages:\s*true[\s\S]*?\}/.test(appJs));

ok('设置页 data 里的兜底默认值同步为 true',
  /networkImages:\s*true/.test(read(path.join(ROOT, 'pages', 'settings', 'settings.js'))));

ok('存在设置迁移函数', /function\s+migrateSettings\s*\(/.test(appJs));

ok('loadSettings 走迁移', /loadSettings\(\)\s*\{[\s\S]*?migrateSettings\(/.test(appJs));

ok('迁移把 networkImages 置为 true',
  /function\s+migrateSettings[\s\S]*?networkImages\s*=\s*true/.test(appJs));

ok('迁移记版本号，不会每次启动都重跑',
  /_mv\s*=\s*SETTINGS_MIGRATION/.test(appJs) &&
  /from\s*>=\s*SETTINGS_MIGRATION/.test(appJs));

// ─── 2. 门控覆盖 Markdown ───

console.log('\n门控覆盖面：Markdown 也必须能关掉');

var mdText = [
  '# 标题',
  '',
  '![图床图](https://img.example.com/a.png)',
  '',
  '正文里还有一张 ![行内图](https://img.example.com/b.png) 图。',
  '',
  '![本地图](./local.png)',
  ''
].join('\n');

var parsed = mdBlock.parseMarkdownBlocks(mdText);
var blocks = parsed.blocks;

// reader 在门控之前会先把行内树展平成 segments —— 顺序反了行内图就漏网
for (var i = 0; i < blocks.length; i++) {
  if (blocks[i].children && !blocks[i].segments) {
    blocks[i].segments = mdInline.flattenInline(blocks[i].children);
  }
}

function findImageBlock(list, src) {
  for (var k = 0; k < list.length; k++) {
    if (list[k].type === 'image' &&
        (list[k].src === src || list[k]._originalSrc === src)) return list[k];
  }
  return null;
}

function findInlineImage(list, src) {
  for (var k = 0; k < list.length; k++) {
    var segs = list[k].segments || [];
    for (var j = 0; j < segs.length; j++) {
      if (segs[j].image && (segs[j].src === src || segs[j]._originalSrc === src)) {
        return segs[j];
      }
    }
  }
  return null;
}

ok('解析出块级网络图', findImageBlock(blocks, 'https://img.example.com/a.png') !== null);
ok('解析出行内网络图', findInlineImage(blocks, 'https://img.example.com/b.png') !== null);

postprocess.gateNetworkImages(blocks, false);

var blockImg = findImageBlock(blocks, 'https://img.example.com/a.png');
ok('关闭后：块级网络图被屏蔽', blockImg && blockImg._networkBlocked === true);
ok('关闭后：块级网络图 src 被清空', blockImg && blockImg.src === '');

var inlineImg = findInlineImage(blocks, 'https://img.example.com/b.png');
ok('关闭后：行内网络图被屏蔽', inlineImg && inlineImg._networkBlocked === true);

var localImg = findImageBlock(blocks, './local.png');
ok('关闭后：本地图不受影响', localImg && !localImg._networkBlocked &&
  localImg.src === './local.png');

postprocess.gateNetworkImages(blocks, true);

blockImg = findImageBlock(blocks, 'https://img.example.com/a.png');
ok('开启后：块级网络图恢复原 src',
  blockImg && !blockImg._networkBlocked &&
  blockImg.src === 'https://img.example.com/a.png');

inlineImg = findInlineImage(blocks, 'https://img.example.com/b.png');
ok('开启后：行内网络图恢复原 src',
  inlineImg && !inlineImg._networkBlocked &&
  inlineImg.src === 'https://img.example.com/b.png');

// 幂等：切回缓存的文档、从设置页返回都会重复调用
postprocess.gateNetworkImages(blocks, true);
postprocess.gateNetworkImages(blocks, true);
blockImg = findImageBlock(blocks, 'https://img.example.com/a.png');
ok('重复开启幂等', blockImg && blockImg.src === 'https://img.example.com/a.png');

postprocess.gateNetworkImages(blocks, false);
postprocess.gateNetworkImages(blocks, false);
postprocess.gateNetworkImages(blocks, true);
blockImg = findImageBlock(blocks, 'https://img.example.com/a.png');
ok('反复开关后仍能恢复原 src',
  blockImg && blockImg.src === 'https://img.example.com/a.png');

// ─── 3. reader 接线：门控不能再只挂在 html 分支上 ───

console.log('\nreader 接线');

var readerJs = read(path.join(ROOT, 'pages', 'reader', 'reader.js'));

ok('存在统一的门控入口 applyNetworkImageGate',
  /applyNetworkImageGate:\s*function/.test(readerJs));

// 用切片而不是 /[\s\S]*?/ —— 后者会匹配到别的方法里的同名调用，
// 把「_finalizeRender 里的那一处被删了」放过去
function bodyOf(src, name) {
  var start = src.indexOf(name + ': function');
  if (start < 0) return '';
  var end = src.indexOf('\n  },', start);
  return end < 0 ? src.slice(start) : src.slice(start, end);
}

var finalizeBody = bodyOf(readerJs, '_finalizeRender');
ok('_finalizeRender 里对所有格式门控', finalizeBody.indexOf('applyNetworkImageGate(') >= 0);
ok('门控在 createLayout 之前 —— 占位与真图高度不同',
  finalizeBody.indexOf('applyNetworkImageGate(') <
  finalizeBody.indexOf('renderMod.createLayout('));

var applyBody = bodyOf(readerJs, 'applySettings');
ok('applySettings 里响应开关变化 —— 中途关掉要当场生效',
  applyBody.indexOf('_networkImagesApplied') >= 0 &&
  applyBody.indexOf('applyNetworkImageGate(') >= 0);

var restoreStart = readerJs.indexOf('if (target.blocks && target.blocks.length > 0)');
var restoreBody = restoreStart < 0 ? '' : readerJs.slice(restoreStart, restoreStart + 2000);
ok('切回缓存的文档时按当前设置重新门控',
  restoreBody.indexOf('applyNetworkImageGate(') >= 0);
ok('门控翻面时不复用缓存 layout 的实测高度',
  /netChanged[\s\S]{0,200}renderMod\.createLayout\(/.test(restoreBody));

// ─── 4. 首屏文案与入口顺序（ADR-13 的隐私文案下沉 + ADR-12 的入口主位）───
//
// ⚠️ 入口顺序的断言曾经反过来（要求 pasteText 占主位），依据是 AGENTS.md 旧版
// 「剪贴板是 AI 时代最高频场景」。该定位在 2026-08-27 被 ADR-12 修正记录作废：
// 收到一个微信打不开的 .md 时用户没有别的办法（被迫，真空），而粘贴是主动动作
// —— 用户人在 AI app 里，那儿已经渲染好了，他本不必复制出来。
// 这两条断言现在守的是「文件入口占主位」，改它之前先读 ADR-12 的修正记录。

console.log('\n首屏（ADR-12 / ADR-13）');

var indexWxml = read(path.join(ROOT, 'pages', 'index', 'index.wxml'));

var primary = /<view class="entry-card entry-primary"[^>]*bindtap="([a-zA-Z]+)"/.exec(indexWxml);
ok('主位入口是从聊天选文件（ADR-12）', primary !== null && primary[1] === 'chooseFile',
  primary ? primary[1] : '没找到 entry-primary');

ok('选文件入口排在粘贴之前（ADR-12）',
  indexWxml.indexOf('bindtap="chooseFile"') < indexWxml.indexOf('bindtap="pasteText"'));

ok('粘贴入口保留，未被删除（ADR-12：低频但零成本，不删）',
  indexWxml.indexOf('bindtap="pasteText"') >= 0);

var heroStart = indexWxml.indexOf('<view class="hero">');
var heroEnd = indexWxml.indexOf('class="entries"');
var hero = heroStart >= 0 && heroEnd > heroStart
  ? indexWxml.slice(heroStart, heroEnd) : '';
ok('hero 区拿得到', hero !== '');
ok('hero 里不再有隐私标语', hero !== '' && !/隐私|零上传|不上传/.test(hero));

ok('隐私说明下沉到页尾脚注', /class="privacy-note"/.test(indexWxml));

ok('脚注承认网络图片会由用户设备直接加载',
  /privacy-note[\s\S]*?网络图片[\s\S]*?设置中关闭/.test(indexWxml));

// ─── 汇总 ───

console.log('\n' + '='.repeat(40));
console.log('通过: ' + pass + ' | 失败: ' + fail);
if (fail > 0) process.exitCode = 1;
else console.log('全部通过！');
