/**
 * tests/test-parse-limits.js — 文本类解析器的清洗与上限
 *
 * HTML 侧的防炸弹上限本来就有测试覆盖（test-html-*.js），
 * 这里补的是 TXT / Markdown / 代码 / JSON 这几条一直没有上限的路径。
 *
 * 直接跑：node tests/test-parse-limits.js
 */

'use strict';

var parseMod = require('../miniprogram/core/parse/index.js');

var pass = 0;
var fail = 0;

function ok(label, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + label); return; }
  fail++;
  console.log('  ✗ ' + label + (detail !== undefined ? ' — ' + detail : ''));
}

function types(blocks) {
  return blocks.map(function (b) { return b.type; }).join(',');
}

// ─── 前置清洗 ───

console.log('\n前置清洗（B2 / B12 / B16）');

var bom = parseMod.parse('﻿# 标题\n\n正文', 'markdown');
ok('Markdown 剥 BOM 后首行仍是标题',
  bom.blocks[0] && bom.blocks[0].type === 'heading', types(bom.blocks));

var zw = parseMod.parse('#​ 标题\n\n正文', 'markdown');
ok('行首零宽字符不影响 ATX 标题',
  zw.blocks[0] && zw.blocks[0].type === 'heading', types(zw.blocks));

var zwMid = parseMod.parse('正文里的零宽​字符', 'markdown');
ok('正文中的零宽字符保留',
  zwMid.blocks[0].text.indexOf('​') >= 0);

var crlf = parseMod.parse('第一行\r\n第二行\r\n', 'code');
ok('代码/日志归一化 CRLF',
  crlf.blocks[0].text.indexOf('\r') < 0, JSON.stringify(crlf.blocks[0].text));

var cr = parseMod.parse('老 Mac 一行\r第二行', 'txt');
ok('TXT 归一化单 \\r', cr.blocks.length >= 1 &&
  cr.blocks[0].text.indexOf('\r') < 0);

// ─── 上限（§2.4 防解析炸弹）───

console.log('\n解析上限（§2.4 / B13 / D12）');

var LIMITS = parseMod.LIMITS;
ok('导出了上限常量', LIMITS && LIMITS.MAX_BLOCKS > 0);

// 超长单行
var longLine = 'x'.repeat(LIMITS.MAX_LINE_CHARS * 3);
var longTxt = parseMod.parse(longLine, 'txt');
ok('TXT 超长单行被截断',
  longTxt.blocks[0].text.length < longLine.length,
  longTxt.blocks[0].text.length);
ok('TXT 截断处有说明',
  longTxt.blocks[0].text.indexOf('已截断') >= 0);

var longCode = parseMod.parse(longLine, 'code');
ok('代码超长单行被截断', longCode.blocks[0].text.length < longLine.length);

// 块数上限
var manyLines = [];
for (var i = 0; i < LIMITS.MAX_BLOCKS + 2000; i++) {
  manyLines.push('第 ' + i + ' 段');
  manyLines.push('');
}
var manyTxt = parseMod.parse(manyLines.join('\n'), 'txt');
ok('TXT 块数不超过上限', manyTxt.blocks.length <= LIMITS.MAX_BLOCKS,
  manyTxt.blocks.length);
ok('TXT 截断有降级记录',
  manyTxt.truncated === true && manyTxt.degraded.length > 0);

var manyMd = parseMod.parse(manyLines.join('\n'), 'markdown');
ok('Markdown 块数不超过上限', manyMd.blocks.length <= LIMITS.MAX_BLOCKS,
  manyMd.blocks.length);

// TOC 上限：对话体小说里每句短白话都可能被启发式当成标题
var chatty = [];
for (var c = 0; c < 6000; c++) {
  chatty.push('');
  chatty.push('短句' + c);
  chatty.push('');
}
var chattyTxt = parseMod.parse(chatty.join('\n'), 'txt');
ok('TXT 目录条目不超过上限', chattyTxt.toc.length <= LIMITS.MAX_TOC,
  chattyTxt.toc.length);

// JSON 走分块，不是一个巨块
var bigObj = { items: [] };
for (var k = 0; k < 20000; k++) bigObj.items.push({ id: k, name: 'item-' + k });
var jsonResult = parseMod.parse(JSON.stringify(bigObj), 'json');
ok('大 JSON 被拆成多个块', jsonResult.blocks.length > 1, jsonResult.blocks.length);
ok('JSON 块标了语言', jsonResult.blocks[0].lang === 'json');
ok('JSON 块不再重复存 raw', jsonResult.blocks[0].raw === undefined);
var maxBlockChars = 0;
jsonResult.blocks.forEach(function (b) {
  maxBlockChars = Math.max(maxBlockChars, b.text.length);
});
ok('单个 JSON 块远小于 setData 上限（64KB）', maxBlockChars < 64 * 1024,
  maxBlockChars + ' chars');

var badJson = parseMod.parse('{ 这不是 JSON', 'json');
ok('非法 JSON 降级为纯文本且内容不丢',
  badJson.blocks.length > 0 &&
  badJson.blocks[0].type !== 'heading' &&
  badJson.blocks[0].text.indexOf('这不是 JSON') >= 0,
  badJson.blocks[0] && badJson.blocks[0].type);

// TXT 启发式标题不该把代码/配置行认成章节标题
var codeish = parseMod.parse('\nconst a = { b: 1 };\n\n普通段落\n', 'txt');
ok('含结构符号的短行不判为标题',
  codeish.blocks[0].type !== 'heading', codeish.blocks[0].type);
var chapter = parseMod.parse('\n第一章\n\n正文内容在这里。\n', 'txt');
ok('中文章节标记仍然识别为标题',
  chapter.blocks[0].type === 'heading', chapter.blocks[0].type);

// ─── Markdown 正确性回归 ───

console.log('\nMarkdown 回归');

var fenced = parseMod.parse(
  '```js\n[foo]: http://example.com\n[^1]: 脚注\n```\n\n正文', 'markdown');
ok('代码块里的引用定义不被抽走',
  fenced.blocks[0].type === 'code' &&
  fenced.blocks[0].text.indexOf('[foo]: http://example.com') >= 0 &&
  fenced.blocks[0].text.indexOf('[^1]: 脚注') >= 0,
  JSON.stringify(fenced.blocks[0].text));

var two = parseMod.parse('- a\n  - b\n    - c', 'markdown');
var four = parseMod.parse('- a\n    - b\n        - c', 'markdown');
ok('2 空格嵌套层级 0/1/2',
  two.blocks.map(function (b) { return b.depth; }).join(',') === '0,1,2',
  two.blocks.map(function (b) { return b.depth; }).join(','));
ok('4 空格嵌套层级同样是 0/1/2',
  four.blocks.map(function (b) { return b.depth; }).join(',') === '0,1,2',
  four.blocks.map(function (b) { return b.depth; }).join(','));

var cont = parseMod.parse('- 第一项\n  这是续行\n- 第二项', 'markdown');
ok('列表续行内容不丢失',
  cont.blocks[0].text.indexOf('这是续行') >= 0,
  JSON.stringify(cont.blocks[0].text));

var fm = parseMod.parse('---\ntitle: 我的文档\n---\n\n# 标题', 'markdown');
ok('Front-matter 被剥离', fm.blocks[0].type === 'heading', types(fm.blocks));
ok('Front-matter 的 title 被保留', fm.frontMeta && fm.frontMeta.title === '我的文档');

// ─── 异常输入 ───

console.log('\n异常输入');

['txt', 'markdown', 'html', 'json', 'code', 'csv', '未知格式'].forEach(function (f) {
  [null, undefined, '', '   ', '\n\n\n', 0, {}].forEach(function (input) {
    var label = f + ' ← ' + JSON.stringify(input);
    try {
      var r = parseMod.parse(input, f);
      ok(label + ' 不崩溃', r && Array.isArray(r.blocks));
    } catch (e) {
      ok(label + ' 不崩溃', false, e.message);
    }
  });
});

// ─── 汇总 ───

console.log('\n' + '='.repeat(40));
console.log('通过: ' + pass + ' | 失败: ' + fail);
if (fail > 0) process.exitCode = 1;
else console.log('全部通过！');
