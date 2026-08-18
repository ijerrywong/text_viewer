/**
 * tests/test-reader-search.js — 阅读器搜索交互与高亮
 *
 * 这两条行为是靠真机点出来的 bug 换来的，必须有回归网兜住：
 *   1. 按下键盘「搜索」后**留在浮层展示结果**，不许直接缩成底部窄条
 *      （旧实现搜完就跳第一个结果，用户还得再点一次才看得到列表）；
 *   2. 命中的关键词要着色 —— 段落、代码块、表格单元格都得有，
 *      否则一屏字里根本定位不到。
 *
 * reader.js 不是纯函数模块，但它对 wx API 的依赖很薄：
 * 桩掉 getApp / Page / wx 就能把整份页面对象取出来直接调方法，
 * 比进开发者工具点一遍快得多。
 *
 *   node tests/test-reader-search.js
 */

'use strict';

var path = require('path');

var pass = 0;
var fail = 0;

function ok(label, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + label); return; }
  fail++;
  console.log('  ✗ ' + label + (detail !== undefined ? ' — ' + detail : ''));
}

// ─── 小程序运行时的最小桩 ───

var pageConfig = null;

global.getApp = function () {
  return {
    globalData: { fileQueue: [], activeQueueIdx: -1, systemInfo: null },
    shareCard: function () { return {}; },
    enableShareMenu: function () {}
  };
};
global.Page = function (config) { pageConfig = config; };
global.wx = {
  showToast: function () {},
  hideKeyboard: function () {},
  getSystemInfoSync: function () {
    return { windowWidth: 375, windowHeight: 667, statusBarHeight: 20, platform: 'ios' };
  }
};

var READER = path.join(__dirname, '..', 'miniprogram', 'pages', 'reader', 'reader.js');
require(READER);
var renderMod = require(path.join(__dirname, '..', 'miniprogram', 'core', 'render', 'index.js'));

ok('reader.js 能在 Node 里装载并注册 Page', pageConfig !== null);

// ─── 造一个页面实例 ───

function deepCopy(v) { return JSON.parse(JSON.stringify(v)); }

function makePage(blocks) {
  var page = Object.create(pageConfig);
  page.data = deepCopy(pageConfig.data);
  page.setData = function (patch) {
    for (var k in patch) page.data[k] = patch[k];
  };
  page._blocks = blocks;
  page._screenWidth = 375;
  page._rpxRatio = 2;
  page._layout = renderMod.createLayout(blocks, page.renderSettings());
  page.data.useVirtualScroll = false;
  page.data.visibleBlocks = blocks;
  return page;
}

/** 一份覆盖各种块类型的文档：关键词统一用「河豚」 */
function makeBlocks() {
  return [
    {
      type: 'paragraph',
      text: '开头一段没有关键词的话',
      segments: [{ text: '开头一段没有关键词的话' }]
    },
    {
      type: 'paragraph',
      text: '河豚有毒，但河豚很好吃',
      segments: [{ text: '河豚有毒，但' }, { text: '河豚很好吃', bold: true }]
    },
    {
      type: 'code',
      text: 'const 河豚 = require("fugu");\nconsole.log(河豚);',
      lang: 'js'
    },
    {
      type: 'table',
      header: [{ text: '名字' }, { text: '备注' }],
      rows: [[{ text: '河豚' }, { text: '需持证处理' }], [{ text: '鲈鱼' }, { text: '随便做' }]],
      aligns: ['left', 'left']
    },
    {
      type: 'heading',
      level: 2,
      text: '结尾',
      segments: [{ text: '结尾' }]
    }
  ];
}

function search(page, kw) {
  page.setData({ searchPhase: 'input', searchKeyword: kw });
  page.doSearch();
}

function segTexts(segments, cls) {
  var out = [];
  (segments || []).forEach(function (s) {
    if ((s.hl || '').indexOf(cls) >= 0) out.push(s.text);
  });
  return out;
}

// ─── 1. 确认搜索后：留在浮层，把结果铺开 ───

console.log('\n按下「搜索」后的状态');

var page = makePage(makeBlocks());
search(page, '河豚');

ok('搜索后仍停在输入态浮层（不缩成底部窄条）',
  page.data.searchPhase === 'input', page.data.searchPhase);
ok('结果列表已备好', page.data.searchResults.length === 3,
  '命中块数 ' + page.data.searchResults.length);
ok('没有自作主张选中某一条', page.data.currentSearchIdx === -1,
  String(page.data.currentSearchIdx));
ok('键盘让位（searchFocus 置否）', page.data.searchFocus === false);
ok('keyboardHeight 归零，浮层可用高度恢复', page.data.keyboardHeight === 0);
ok('记下已确认的关键词', page.data.searchActiveKeyword === '河豚',
  page.data.searchActiveKeyword);
ok('结果摘要里关键词被切出来上色',
  segTexts(page.data.searchResults[0].snippetSegs, 'seg-hl').indexOf('河豚') >= 0);

// ─── 2. 正文高亮 ───

console.log('\n正文高亮');

var vb = page.data.visibleBlocks;
ok('未命中的块不加任何标记', !vb[0]._hitClass && !vb[4]._hitClass);
ok('命中块挂上块级标记', vb[1]._hitClass === 'block-hit', vb[1]._hitClass);
ok('段落里两处关键词都着色',
  segTexts(vb[1].segments, 'seg-hl').join('|') === '河豚|河豚',
  segTexts(vb[1].segments, 'seg-hl').join('|'));
ok('切段保留原有行内属性（加粗的命中词仍加粗）',
  vb[1].segments.some(function (s) { return s.text === '河豚' && s.bold === true; }));
ok('未命中的文字没被误标',
  vb[1].segments.every(function (s) { return s.hl ? s.text === '河豚' : true; }));
ok('代码块内的关键词也着色（不止一条边色）',
  segTexts(vb[2].codeSegs, 'seg-hl').length === 2,
  JSON.stringify(segTexts(vb[2].codeSegs, 'seg-hl')));
ok('代码块原文一字不改（复制走的还是原文）',
  vb[2].text === 'const 河豚 = require("fugu");\nconsole.log(河豚);');
ok('表格命中单元格切出 hlSegs',
  segTexts(vb[3].rows[0][0].hlSegs, 'seg-hl').join('') === '河豚');
ok('表格未命中单元格不动（渲染走原分支）',
  vb[3].rows[1][0].hlSegs === undefined && vb[3].header[0].hlSegs === undefined);

// 高亮是渲染期加工，绝不能写回 _blocks —— 否则换关键词时旧色洗不掉
var src = page._blocks;
ok('_blocks 未被污染：没有块级标记',
  src.every(function (b) { return b._hitClass === undefined; }));
ok('_blocks 未被污染：段落还是原来两段',
  src[1].segments.length === 2 &&
  src[1].segments.every(function (s) { return s.hl === undefined; }));
ok('_blocks 未被污染：表格单元格没有 hlSegs',
  src[3].rows[0][0].hlSegs === undefined);

// ─── 3. 选中某条结果，才收起浮层 ───

console.log('\n选中结果之后');

// 命中依次是块 1（段落）、块 2（代码）、块 3（表格），这里挑第三条
page.jumpToSearchResult({ currentTarget: { dataset: { index: 3, resultIdx: 2 } } });

ok('浮层收成底部窄条', page.data.searchPhase === 'result', page.data.searchPhase);
ok('当前项记下来了', page.data.currentSearchIdx === 2);
vb = page.data.visibleBlocks;
ok('当前命中块用强调色', vb[3]._hitClass === 'block-hit block-hit-cur', vb[3]._hitClass);
ok('其余命中块保持普通色', vb[1]._hitClass === 'block-hit', vb[1]._hitClass);
ok('当前块内的词用强调高亮',
  segTexts(vb[3].rows[0][0].hlSegs, 'seg-hl-cur').join('') === '河豚');

page.nextSearchResult();
ok('最后一条按「下一个」绕回第一条',
  page.data.currentSearchIdx === 0 && page.data.searchPhase === 'result',
  String(page.data.currentSearchIdx));

page.backToSearchInput();
ok('点窄条上的关键词回到输入态', page.data.searchPhase === 'input');
ok('回列表时定位到当前那一条', page.data.resultScrollId === 'res-0',
  page.data.resultScrollId);
ok('结果没有被清空，改个字就能接着搜', page.data.searchResults.length === 3);

// ─── 4. 清空与关闭 ───

console.log('\n清空与关闭');

page.clearSearch();
ok('✕ 连旧结果一起清掉', page.data.searchResults.length === 0);
ok('✕ 同时撤掉正文高亮',
  page.data.visibleBlocks.every(function (b) { return b._hitClass === undefined; }));
ok('✕ 之后仍停在输入态等着重新打字',
  page.data.searchPhase === 'input' && page.data.searchFocus === true);

search(page, '河豚');
page.closeSearch();
ok('关闭后状态整体归零',
  page.data.searchPhase === 'off' &&
  page.data.searchResults.length === 0 &&
  page.data.searchActiveKeyword === '');
ok('关闭后正文高亮全部撤除',
  page.data.visibleBlocks.every(function (b) { return b._hitClass === undefined; }));

// ─── 5. 搜不到 / 空词 ───

console.log('\n边界');

var page2 = makePage(makeBlocks());
search(page2, '不存在的词');
ok('无结果时不留半截高亮',
  page2.data.searchResults.length === 0 &&
  page2.data.visibleBlocks.every(function (b) { return b._hitClass === undefined; }));
ok('无结果时仍停在浮层（好让用户改词）', page2.data.searchPhase === 'input');

search(page2, '   ');
ok('纯空格不触发搜索', page2.data.searchResults.length === 0 &&
  page2.data.searchActiveKeyword === '');

var page3 = makePage(makeBlocks());
search(page3, 'REQUIRE');
ok('大小写不敏感', page3.data.searchResults.length === 1);
ok('大小写不敏感时原文大小写不被改写',
  segTexts(page3.data.visibleBlocks[2].codeSegs, 'seg-hl').join('') === 'require');

// 一段里出现极多次时要有上限，否则 setData 的段数比正文还多
var manyText = new Array(200).join('河豚');
var page4 = makePage([{ type: 'paragraph', text: manyText, segments: [{ text: manyText }] }]);
search(page4, '河豚');
ok('单段高亮片段数有上限',
  page4.data.visibleBlocks[0].segments.length <= 101,
  '切出 ' + page4.data.visibleBlocks[0].segments.length + ' 段');
ok('超出上限的尾巴仍完整保留（文字不丢）',
  page4.data.visibleBlocks[0].segments.map(function (s) { return s.text; }).join('') === manyText);

// ─── 6. 换文档必须清干净（命中下标属于上一份文档）───

console.log('\n换文档');

var page5 = makePage(makeBlocks());
search(page5, '河豚');
page5.resetSearchState();
ok('resetSearchState 抹掉内部高亮依据',
  page5._hlKeyword === '' && page5._hitBlockSet === null);
ok('resetSearchState 后再渲染不会给新文档乱涂',
  page5.decorateSearch(makeBlocks()).every(function (b) { return b._hitClass === undefined; }));

// ─── 7. 虚拟滚动下的高亮（长文档走的是另一条渲染路径）───

console.log('\n虚拟滚动');

var manyBlocks = [];
for (var i = 0; i < 400; i++) {
  var t = i === 250 ? '这一段里有河豚' : '第 ' + i + ' 段普通内容';
  manyBlocks.push({ type: 'paragraph', text: t, segments: [{ text: t }] });
}
var page6 = makePage(manyBlocks);
page6.data.useVirtualScroll = true;
page6.data.visibleBlocks = [];
page6._viewportRpx = 1200;
page6.scheduleHeightMeasurement = function () {}; // 真机才需要，Node 里没有 selectorQuery

search(page6, '河豚');
ok('长文档也能搜到', page6.data.searchResults.length === 1 &&
  page6.data.searchResults[0].blockIndex === 250);

// 跳过去：可见窗口平移到命中块，高亮按 _vIndex（文档真实下标）对号入座
page6.jumpToSearchResult({ currentTarget: { dataset: { index: 250, resultIdx: 0 } } });
var hit = page6.data.visibleBlocks.filter(function (b) { return b._hitClass; });
ok('可见窗口里只有真正命中的那一块被标记', hit.length === 1,
  '被标记 ' + hit.length + ' 块');
ok('标记落在正确的块上（_vIndex 而不是数组位置）',
  hit.length === 1 && hit[0]._vIndex === 250,
  hit.length === 1 ? String(hit[0]._vIndex) : '-');
ok('虚拟滚动下同样是强调色 + 词级高亮',
  hit.length === 1 && hit[0]._hitClass === 'block-hit block-hit-cur' &&
  segTexts(hit[0].segments, 'seg-hl-cur').join('') === '河豚');

page6.closeSearch();
ok('关闭后虚拟滚动的可见块也干净了',
  page6.data.visibleBlocks.every(function (b) { return b._hitClass === undefined; }));

// ─── 汇总 ───

console.log('\n' + '='.repeat(40));
console.log('通过: ' + pass + ' | 失败: ' + fail);
if (fail > 0) process.exitCode = 1;
else console.log('全部通过！');
