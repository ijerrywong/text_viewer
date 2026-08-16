#!/usr/bin/env node
/**
 * postprocess.js 测试 + parseHtml 全管线测试
 */

var path = require('path');
var postprocess = require(path.resolve(__dirname, '../miniprogram/core/parse/html/postprocess.js'));
var parse = require(path.resolve(__dirname, '../miniprogram/core/parse/index.js'));

var passed = 0;
var failed = 0;
var failures = [];

function assert(condition, message) {
  if (condition) { passed++; }
  else { failed++; failures.push(message); console.log('  ✗ FAIL: ' + message); }
}

function assertEqual(actual, expected, message) {
  var ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; }
  else { failed++; failures.push(message); console.log('  ✗ FAIL: ' + message);
    console.log('    expected: ' + JSON.stringify(expected));
    console.log('    actual:   ' + JSON.stringify(actual)); }
}

// ═══════════════════════════════════════════════════
// 测试 1：checkIRSize 正常 IR
// ═══════════════════════════════════════════════════
console.log('\n测试 1：checkIRSize 正常 IR');
(function() {
  var ir = {
    blocks: [
      { type: 'heading', text: '标题', segments: [] },
      { type: 'paragraph', text: '段落内容', segments: [{ text: '段落内容' }] }
    ],
    images: [],
    truncated: false
  };
  var result = postprocess.checkIRSize(ir);
  assert(result.ok, '正常 IR 应通过检查');
  assertEqual(result.stats.blockCount, 2, '块数应为 2');
})();

// ═══════════════════════════════════════════════════
// 测试 2：checkIRSize 超限 IR
// ═══════════════════════════════════════════════════
console.log('\n测试 2：checkIRSize 超限 IR');
(function() {
  // 生成超多块
  var blocks = [];
  for (var i = 0; i < 60000; i++) {
    blocks.push({ type: 'paragraph', text: 'x', segments: [] });
  }
  var ir = { blocks: blocks, images: [] };
  var result = postprocess.checkIRSize(ir);
  assert(!result.ok, '超限 IR 不应通过');
  assertEqual(result.reason, 'too-many-blocks', '原因应为 too-many-blocks');
})();

// ═══════════════════════════════════════════════════
// 测试 3：checkIRSize 空值
// ═══════════════════════════════════════════════════
console.log('\n测试 3：checkIRSize 空值');
(function() {
  var result = postprocess.checkIRSize(null);
  assert(!result.ok, 'null 不应通过');
  assertEqual(result.reason, 'null-ir', '原因应为 null-ir');
})();

// ═══════════════════════════════════════════════════
// 测试 4：gateNetworkImages 关闭网络图片
// ═══════════════════════════════════════════════════
console.log('\n测试 4：gateNetworkImages 关闭网络图片');
(function() {
  var blocks = [
    { type: 'image', src: 'https://example.com/img.png', alt: '网络图' },
    { type: 'image', src: 'data:image/png;base64,abc', alt: 'base64图' },
    { type: 'image', src: 'wxfile://local/img.png', alt: '本地图' }
  ];
  postprocess.gateNetworkImages(blocks, false);

  assertEqual(blocks[0]._networkBlocked, true, '网络图片应被标记为 blocked');
  assertEqual(blocks[0].src, '', '网络图片 src 应被清空');
  assert(blocks[0]._originalSrc === 'https://example.com/img.png', '应保留原始 src');

  // base64 和本地图片不受影响
  assert(!blocks[1]._networkBlocked, 'base64 图片不应被 blocked');
  assertEqual(blocks[1].src, 'data:image/png;base64,abc', 'base64 src 不应变');
  assert(!blocks[2]._networkBlocked, '本地图片不应被 blocked');
})();

// ═══════════════════════════════════════════════════
// 测试 5：gateNetworkImages 开启网络图片
// ═══════════════════════════════════════════════════
console.log('\n测试 5：gateNetworkImages 开启网络图片');
(function() {
  var blocks = [
    { type: 'image', src: 'https://example.com/img.png', alt: '网络图' }
  ];
  postprocess.gateNetworkImages(blocks, false); // 先关闭
  assertEqual(blocks[0].src, '', '关闭后 src 应为空');

  postprocess.gateNetworkImages(blocks, true); // 再开启
  assertEqual(blocks[0].src, 'https://example.com/img.png', '开启后 src 应恢复');
  assert(!blocks[0]._networkBlocked, '开启后不应有 blocked 标记');
})();

// ═══════════════════════════════════════════════════
// 测试 6：gateNetworkImages 处理 inline segments
// ═══════════════════════════════════════════════════
console.log('\n测试 6：gateNetworkImages 处理 inline segments');
(function() {
  var blocks = [{
    type: 'paragraph',
    text: '文本',
    segments: [
      { text: '前' },
      { image: true, src: 'https://example.com/inline.png' },
      { text: '后' }
    ]
  }];
  postprocess.gateNetworkImages(blocks, false);

  assertEqual(blocks[0].segments[1]._networkBlocked, true, 'inline 网络图片应被 blocked');
  assertEqual(blocks[0].segments[1].src, '', 'inline src 应被清空');
  assertEqual(blocks[0].segments[0].text, '前', '文本 segment 不应受影响');
})();

// ═══════════════════════════════════════════════════
// 测试 7：extractBase64Images 大图抽取
// ═══════════════════════════════════════════════════
console.log('\n测试 7：extractBase64Images 大图抽取');
(function() {
  // 生成一个大于阈值的 base64 图片
  var largeBase64 = 'data:image/png;base64,' + 'A'.repeat(5000);
  var smallBase64 = 'data:image/png;base64,' + 'B'.repeat(100);

  var blocks = [
    { type: 'image', src: largeBase64, alt: '大图' },
    { type: 'image', src: smallBase64, alt: '小图' }
  ];

  var writtenFiles = {};
  var mockWriteCallback = function(base64Data, filePath) {
    writtenFiles[filePath] = base64Data;
    return Promise.resolve();
  };

  postprocess.extractBase64Images(blocks, {
    writeCallback: mockWriteCallback,
    cacheDir: '/tmp/img_cache',
    threshold: 4096
  }).then(function(result) {
    assertEqual(result.extracted, 1, '应抽取 1 张大图');
    assertEqual(result.errors.length, 0, '不应有错误');

    // 大图的 src 应被替换为本地路径
    assert(blocks[0].src.indexOf('/tmp/img_cache/') === 0, '大图 src 应为本地路径');
    assert(blocks[0]._extracted === true, '大图应标记为 extracted');

    // 小图应保持内联
    assertEqual(blocks[1].src, smallBase64, '小图应保持内联');
    assert(!blocks[1]._extracted, '小图不应被 extracted');
  }).catch(function(err) {
    assert(false, 'extractBase64Images 不应抛异常: ' + err);
  });
})();

// ═══════════════════════════════════════════════════
// 测试 8：extractBase64Images 无 writeCallback
// ═══════════════════════════════════════════════════
console.log('\n测试 8：extractBase64Images 无 writeCallback');
(function() {
  var blocks = [
    { type: 'image', src: 'data:image/png;base64,' + 'A'.repeat(5000) }
  ];
  return postprocess.extractBase64Images(blocks, {}).then(function(result) {
    assertEqual(result.extracted, 0, '无 writeCallback 不应抽取');
    assert(blocks[0].src.indexOf('data:image/') === 0, 'src 应保持 data URI');
  });
})();

// ═══════════════════════════════════════════════════
// 测试 9：extractBase64Images 空 blocks
// ═══════════════════════════════════════════════════
console.log('\n测试 9：extractBase64Images 空 blocks');
(function() {
  return postprocess.extractBase64Images([], {}).then(function(result) {
    assertEqual(result.extracted, 0, '空 blocks 应返回 0');
  });
})();

// ═══════════════════════════════════════════════════
// 测试 10：isNetworkSrc
// ═══════════════════════════════════════════════════
console.log('\n测试 10：isNetworkSrc');
(function() {
  assert(postprocess.isNetworkSrc('https://example.com/img.png'), 'https 应为网络');
  assert(postprocess.isNetworkSrc('http://example.com/img.png'), 'http 应为网络');
  assert(postprocess.isNetworkSrc('//example.com/img.png'), '// 应为网络');
  assert(!postprocess.isNetworkSrc('data:image/png;base64,abc'), 'data URI 不应为网络');
  assert(!postprocess.isNetworkSrc('wxfile://local/img.png'), 'wxfile 不应为网络');
  assert(!postprocess.isNetworkSrc('/local/path/img.png'), '相对路径不应为网络');
  assert(!postprocess.isNetworkSrc(''), '空字符串不应为网络');
  assert(!postprocess.isNetworkSrc(null), 'null 不应为网络');
})();

// ═══════════════════════════════════════════════════
// 测试 11：parseHtml 全管线
// ═══════════════════════════════════════════════════
console.log('\n测试 11：parseHtml 全管线');
(function() {
  var html = '<html><body>' +
    '<h1>HTML 全管线测试</h1>' +
    '<p>包含<strong>加粗</strong>和<a href="https://example.com">链接</a>。</p>' +
    '<pre><code class="language-python">def hello():\n  print("world")</code></pre>' +
    '<img src="data:image/png;base64,iVBORw0KGgo=" alt="小图">' +
    '<img src="https://example.com/big.png" alt="网络图">' +
    '</body></html>';

  var result = parse.parseHtml(html);

  assert(result.blocks.length > 0, '应产出 blocks');
  assert(result.blocks[0].type === 'heading', '第一个块应为 heading');
  assertEqual(result.blocks[0].text, 'HTML 全管线测试', '标题文本');

  // 应包含 code 块
  var codeBlocks = result.blocks.filter(function(b) { return b.type === 'code'; });
  assert(codeBlocks.length >= 1, '应有 code 块');
  assertEqual(codeBlocks[0].lang, 'python', '代码语言应为 python');

  // 应标记 hasBase64
  assertEqual(result.hasBase64, true, '应标记 hasBase64');
  // 应标记 hasNetworkImage
  assertEqual(result.hasNetworkImage, true, '应标记 hasNetworkImage');

  // 应有 images 数组
  assert(result.images.length >= 2, '应有 2+ 图片');
})();

// ═══════════════════════════════════════════════════
// 测试 12：parseHtml 消毒 + 脚本降级
// ═══════════════════════════════════════════════════
console.log('\n测试 12：parseHtml 消毒 + 脚本降级');
(function() {
  var html = '<script>alert("xss")</script>' +
    '<canvas id="chart"></canvas>' +
    '<script src="chart.js"></script>' +
    '<script>new Chart(ctx, {});</script>' +
    '<p>正常文本</p>' +
    '<div onclick="alert(1)">点击</div>';

  var result = parse.parseHtml(html);

  // script 应被消毒
  var hasScriptInText = result.blocks.some(function(b) {
    return b.text && b.text.indexOf('alert') >= 0;
  });
  assert(!hasScriptInText, '不应包含 script 内容');

  // Chart.js 应被降级
  var degradeBlocks = result.blocks.filter(function(b) { return b.type === 'scriptDegrade'; });
  assert(degradeBlocks.length >= 1, '应有 Chart.js 降级块');

  // onclick 应被移除
  var hasOnclick = result.blocks.some(function(b) {
    return (b.text && b.text.indexOf('onclick') >= 0) ||
           (b.style && b.style.indexOf('onclick') >= 0);
  });
  assert(!hasOnclick, '不应包含 onclick');

  // 正常文本应保留
  var paras = result.blocks.filter(function(b) { return b.type === 'paragraph'; });
  assert(paras.length >= 1, '应有正常段落');

  // 应有消毒记录
  var hasSanitizeInfo = result.degraded.some(function(d) { return d.reason === 'sanitized'; });
  assert(hasSanitizeInfo, '应记录消毒信息');
})();

// ═══════════════════════════════════════════════════
// 测试 13：parseHtml 异常降级
// ═══════════════════════════════════════════════════
console.log('\n测试 13：parseHtml 异常降级');
(function() {
  // 传入非字符串应降级
  var result = parse.parseHtml(null);
  assert(result.blocks.length === 0, 'null 应产出空 blocks');
  assert(result.degraded.length > 0, '应有降级信息');
})();

// ═══════════════════════════════════════════════════
// 测试 14：parseHtml + postprocess 全链路
// ═══════════════════════════════════════════════════
console.log('\n测试 14：parseHtml + postprocess 全链路');
(function() {
  var html = '<h1>全链路测试</h1>' +
    '<img src="https://example.com/net.png" alt="网络图">' +
    '<img src="data:image/png;base64,' + 'X'.repeat(5000) + '" alt="大base64">';

  // 1. 解析
  var result = parse.parseHtml(html);
  assert(result.hasNetworkImage, '应检测到网络图片');
  assert(result.hasBase64, '应检测到 base64 图片');

  // 2. 门控网络图片（关闭）
  postprocess.gateNetworkImages(result.blocks, false);
  var netImg = result.blocks.find(function(b) { return b.type === 'image' && b._networkBlocked; });
  assert(netImg !== undefined, '网络图片应被 blocked');

  // 3. IR 大小检查
  var sizeCheck = postprocess.checkIRSize(result);
  assert(sizeCheck.ok, 'IR 大小应通过检查');
  assert(sizeCheck.stats.blockCount > 0, '应有块');
})();

// ═══════════════════════════════════════════════════
// 汇总
// ═══════════════════════════════════════════════════
console.log('\n════════════════════════════════════════');
console.log('通过: ' + passed + ' | 失败: ' + failed);
if (failed > 0) {
  console.log('\n失败项:');
  failures.forEach(function(f) { console.log('  - ' + f); });
  process.exit(1);
} else {
  console.log('全部通过！');
  process.exit(0);
}
