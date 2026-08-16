/**
 * tests/test-render-layout.js — 虚拟滚动布局层测试
 *
 * 覆盖质量门禁 #7「滚动无跳动」依赖的全部计算：
 * 前缀和、可见范围、高度回填、进度双向映射。
 *
 * 直接跑：node tests/test-render-layout.js
 */

'use strict';

var render = require('../miniprogram/core/render/index.js');

var pass = 0;
var fail = 0;

function ok(label, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + label); return; }
  fail++;
  console.log('  ✗ ' + label + (detail !== undefined ? ' — ' + detail : ''));
}

function near(label, actual, expected, tol) {
  ok(label, Math.abs(actual - expected) <= (tol || 0.001),
    '得到 ' + actual + '，期望 ' + expected);
}

var SETTINGS = { fontSize: 16, lineHeight: 1.8, screenWidth: 375 };

function makeBlocks(n) {
  var blocks = [];
  for (var i = 0; i < n; i++) {
    blocks.push({
      type: i % 7 === 0 ? 'heading' : 'paragraph',
      level: 2,
      text: '第 ' + i + ' 段。' + '内容'.repeat((i % 13) + 1),
      id: 'b' + i
    });
  }
  return blocks;
}

// ─── 前缀和与查找 ───

console.log('\n布局索引');

var blocks = makeBlocks(5000);
var layout = render.createLayout(blocks, SETTINGS);

ok('长度正确', layout.length === 5000);

// 与朴素累加对拍
function naiveOffset(upto, overrides) {
  var sum = 0;
  for (var i = 0; i < upto; i++) {
    sum += (overrides && overrides[i] != null)
      ? overrides[i]
      : render.estimateHeight(blocks[i], SETTINGS);
  }
  return sum;
}

near('offset(0)', layout.offset(0), 0);
near('offset(1)', layout.offset(1), naiveOffset(1), 0.01);
near('offset(1234)', layout.offset(1234), naiveOffset(1234), 0.01);
near('total()', layout.total(), naiveOffset(5000), 0.01);

// indexAt：块顶端、块中间、块末端
var probeIdx = 777;
var probeTop = layout.offset(probeIdx);
var probeH = layout.height(probeIdx);
ok('indexAt 块顶端', layout.indexAt(probeTop) === probeIdx, layout.indexAt(probeTop));
ok('indexAt 块中间', layout.indexAt(probeTop + probeH / 2) === probeIdx, layout.indexAt(probeTop + probeH / 2));
ok('indexAt 块末端前一点', layout.indexAt(probeTop + probeH - 0.01) === probeIdx);
ok('indexAt 负值归 0', layout.indexAt(-100) === 0);
ok('indexAt 超出末尾夹到最后一块', layout.indexAt(layout.total() * 2) === 4999);

// ─── 高度回填 ───

console.log('\n高度回填');

var before = layout.total();
var oldH = layout.height(100);
var delta = layout.setHeight(100, oldH + 50);
near('setHeight 返回增量', delta, 50);
near('总高同步更新', layout.total(), before + 50, 0.01);
near('回填后 offset 同步', layout.offset(200), naiveOffset(200, { 100: oldH + 50 }), 0.01);
ok('标记为已测量', layout.isMeasured(100) === true);
ok('未回填的块仍是预估', layout.isMeasured(101) === false);
near('重复设置同一高度增量为 0', layout.setHeight(100, oldH + 50), 0);

// 字号变更后重估：已测高度全部作废（E1b）
layout.reestimate({ fontSize: 24, lineHeight: 1.8, screenWidth: 375 });
ok('reestimate 清空已测标记', layout.isMeasured(100) === false);
ok('reestimate 后总高变大（字号变大）', layout.total() > before);

// ─── 可见范围 ───

console.log('\n可见范围');

var l2 = render.createLayout(makeBlocks(1000), SETTINGS);
var viewport = 1200; // rpx
var r0 = render.visibleRange(l2, 0, viewport, 2);
ok('顶部 startIndex 为 0', r0.startIndex === 0, r0.startIndex);
near('顶部 offsetTop 为 0', r0.offsetTop, 0);
ok('顶部渲染了若干块', r0.endIndex > 0);
near('顶部 spacer 之和 = 总高',
  r0.offsetTop + (l2.offset(r0.endIndex) - r0.offsetTop) + r0.offsetBottom,
  l2.total(), 0.01);

var mid = l2.total() / 2;
var rMid = render.visibleRange(l2, mid, viewport, 2);
ok('中部 startIndex > 0', rMid.startIndex > 0);
ok('中部 startIndex 在缓冲区之上', l2.offset(rMid.startIndex) <= mid);
ok('中部 endIndex 覆盖到视口底部', l2.offset(rMid.endIndex) >= mid + viewport || rMid.endIndex === l2.length);
near('中部三段拼回总高',
  rMid.offsetTop + (l2.offset(rMid.endIndex) - rMid.offsetTop) + rMid.offsetBottom,
  l2.total(), 0.01);

var rEnd = render.visibleRange(l2, l2.total(), viewport, 2);
ok('底部 endIndex 到末尾', rEnd.endIndex === l2.length, rEnd.endIndex);
near('底部 offsetBottom 为 0', rEnd.offsetBottom, 0, 0.01);

var empty = render.createLayout([], SETTINGS);
var rEmpty = render.visibleRange(empty, 0, viewport, 2);
ok('空文档不崩溃', rEmpty.startIndex === 0 && rEmpty.endIndex === 0 && rEmpty.totalHeight === 0);

// ─── 进度双向映射 ───

console.log('\n进度映射');

var l3 = render.createLayout(makeBlocks(500), SETTINGS);
[0, 7, 123, 499].forEach(function (idx) {
  [0, 0.5, 0.999].forEach(function (ratio) {
    var top = render.progressToLayoutTop(l3, idx, ratio);
    var back = render.layoutToProgress(l3, top);
    ok('往返 block=' + idx + ' ratio=' + ratio,
      back.blockIndex === idx && Math.abs(back.ratio - ratio) < 0.01,
      'block=' + back.blockIndex + ' ratio=' + back.ratio.toFixed(3));
  });
});

// 进度对字号变更免疫（E1/E1b）：块索引不变，像素位置随之改变
var pTop = render.progressToLayoutTop(l3, 200, 0.3);
var pBefore = render.layoutToProgress(l3, pTop);
l3.reestimate({ fontSize: 22, lineHeight: 2.0, screenWidth: 375 });
var pTopAfter = render.progressToLayoutTop(l3, pBefore.blockIndex, pBefore.ratio);
var pAfter = render.layoutToProgress(l3, pTopAfter);
ok('字号变更后块索引不漂移', pAfter.blockIndex === 200, pAfter.blockIndex);
ok('字号变更后像素位置确实变了', Math.abs(pTopAfter - pTop) > 1);

// ─── D13：滚动补偿方向 ───

console.log('\n滚动补偿（D13）');

var compBlocks = makeBlocks(300);
var cache = {};
var scrollTop = 20000;

// 视口上方的块变高 → 必须反向补偿，否则内容会往下窜
var upIdx = 5;
var upOld = render.estimateHeight(compBlocks[upIdx], SETTINGS);
var upRes = render.updateHeight(cache, upIdx, upOld, upOld + 120, scrollTop, compBlocks, SETTINGS);
near('上方块变高 → scrollTop 加同样的量', upRes.newScrollTop, scrollTop + 120, 0.01);

// 视口下方的块变高 → 不该动 scrollTop
var cache2 = {};
var downIdx = 280;
var downOld = render.estimateHeight(compBlocks[downIdx], SETTINGS);
var downRes = render.updateHeight(cache2, downIdx, downOld, downOld + 120, scrollTop, compBlocks, SETTINGS);
near('下方块变高 → scrollTop 不动', downRes.newScrollTop, scrollTop, 0.01);

// 回归：不传 blocks 时（老调用方）不应因缺高度而误判成"上方"
var cache3 = {};
cache3[downIdx] = downOld;
var noBlocks = render.updateHeight(cache3, downIdx, downOld, downOld + 120, scrollTop);
ok('缺 blocks 参数时仍不崩溃', typeof noBlocks.newScrollTop === 'number');

// ─── 性能：滚动路径必须是次线性的 ───

console.log('\n性能');

var bigLayout = render.createLayout(makeBlocks(100000), SETTINGS);
var t0 = Date.now();
for (var s = 0; s < 2000; s++) {
  render.visibleRange(bigLayout, (s * 997) % bigLayout.total(), viewport, 2);
}
var elapsed = Date.now() - t0;
ok('10 万块 × 2000 次可见范围计算 < 500ms', elapsed < 500, elapsed + 'ms');

// ─── 汇总 ───

console.log('\n' + '='.repeat(40));
console.log('通过: ' + pass + ' | 失败: ' + fail);
if (fail > 0) process.exitCode = 1;
else console.log('全部通过！');
