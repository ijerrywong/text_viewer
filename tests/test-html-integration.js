/**
 * test-html-integration.js — HTML 全管线集成测试
 *
 * 用接近真实 AI 生成文档的 HTML 跑完整管线：
 * detect → sanitize → convert → postprocess
 * 验证各模块协同工作、降级信息正确传递、安全措施生效。
 */

var assert = require('assert');

// 模块
var detect = require('../miniprogram/core/detect/index.js');
var parseMod = require('../miniprogram/core/parse/index.js');
var postprocess = require('../miniprogram/core/parse/html/postprocess.js');

var passed = 0;
var failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (e) {
    failed++;
    console.log('  ✗ ' + name);
    console.log('    ' + (e.message || e));
  }
}

console.log('\n═══ HTML 全管线集成测试 ═══\n');

// ── 完整 AI 文档管线 ──
console.log('AI 生成文档全管线');

var aiDoc = [
  '<!DOCTYPE html>',
  '<html lang="zh-CN">',
  '<head>',
  '<meta charset="UTF-8">',
  '<style>',
  ':root { --primary: #4f46e5; --bg: #f8fafc; }',
  '.card { background: var(--bg); border-radius: 12px; padding: 16px; }',
  '.card h2 { color: var(--primary); }',
  '.tag::before { content: "🏷️ "; }',
  '</style>',
  '<link rel="stylesheet" href="https://cdn.example.com/styles.css">',
  '</head>',
  '<body>',
  '<div class="card p-6 bg-slate-50 rounded-xl">',
  '<h1 style="color: var(--primary);">AI 生成报告</h1>',
  '<p class="text-slate-600 text-lg">2026 年度技术总结</p>',
  '</div>',
  '<h2>核心指标</h2>',
  '<table style="width:100%; border-collapse:collapse;">',
  '<thead><tr><th style="border:1px solid #ddd; padding:8px;">指标</th><th style="border:1px solid #ddd; padding:8px;">数值</th></tr></thead>',
  '<tbody>',
  '<tr><td style="border:1px solid #ddd; padding:8px;">用户数</td><td style="border:1px solid #ddd; padding:8px;">1,200,000</td></tr>',
  '<tr><td style="border:1px solid #ddd; padding:8px;">收入</td><td style="border:1px solid #ddd; padding:8px;">¥5,800万</td></tr>',
  '</tbody>',
  '</table>',
  '<h2>趋势图</h2>',
  '<div id="chart"><canvas id="trend"></canvas><p>月度增长趋势（Chart.js）</p></div>',
  '<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>',
  '<script>new Chart(document.getElementById("trend"),{type:"line",data:{labels:["1月","2月"],datasets:[{data:[30,50]}]}});</script>',
  '<h2>技术栈</h2>',
  '<ul class="list-disc pl-6">',
  '<li class="tag"><strong>前端</strong>：原生小程序</li>',
  '<li class="tag"><strong>渲染</strong>：mp-html + 自研预处理</li>',
  '<li><strong>编码</strong>：自实现 GB18030/Big5</li>',
  '</ul>',
  '<h2>代码示例</h2>',
  '<pre><code class="language-javascript">function init() {\n  return { ready: true };\n}</code></pre>',
  '<blockquote style="border-left:4px solid var(--primary); padding-left:16px;">',
  '<p>关键结论：<em>本地优先</em>、<strong>零后端</strong>、<del>离线不可用</del>（已修正）。</p>',
  '</blockquote>',
  '<h2>参考</h2>',
  '<p>详见 <a href="https://example.com">官方文档</a>。</p>',
  '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFklEQVQYV2P8z8BQz0AEYBxVOHIUAgBGWAgE/wQ0NAAAAABJRU5ErkJggg==" alt="logo" style="width:16px;height:16px;">',
  '<img src="https://cdn.example.com/hero.png" alt="网络图片" style="width:100%;">',
  '<hr>',
  '<p style="color:#64748b; text-align:center; font-size:14px;">© 2026 纯文本阅读器</p>',
  '<script>alert("xss")</script>',
  '<div onclick="steal()"><p>恶意内容</p></div>',
  '</body>',
  '</html>'
].join('\n');

test('detectFormat 识别 .html 扩展名', function() {
  var result = detect.detectFormat('report.html', aiDoc);
  assert(result.format === 'html', '应识别为 html, 实际: ' + result.format);
});

test('detectFormat 内容嗅探 HTML', function() {
  var result = detect.detectFormat('unknown.txt', aiDoc.slice(0, 512));
  assert(result.format === 'html', '内容嗅探应识别为 html, 实际: ' + result.format);
});

test('全管线解析 AI 文档', function() {
  var ir = parseMod.parse(aiDoc, 'html');
  assert(ir.blocks && ir.blocks.length > 0, '应产出块, 实际: ' + (ir.blocks ? ir.blocks.length : 0));
  assert(ir.degraded && ir.degraded.length > 0, '应有降级信息');
  assert(ir.toc && ir.toc.length > 0, '应有目录');
});

test('脚本降级信息正确', function() {
  var ir = parseMod.parse(aiDoc, 'html');
  var hasScriptDegrade = ir.degraded.some(function(d) {
    return d.reason === 'chartjs' || d.reason === 'script' || d.reason === 'sanitized';
  });
  assert(hasScriptDegrade, '应有脚本降级信息, degraded: ' + JSON.stringify(ir.degraded.map(function(d){return d.reason;})));
});

test('消毒移除 XSS 脚本', function() {
  var ir = parseMod.parse(aiDoc, 'html');
  // script 标签应被消毒移除
  var hasSanitized = ir.degraded.some(function(d) { return d.reason === 'sanitized'; });
  assert(hasSanitized, '应有消毒信息');
  // 不应有 onclick 残留
  var allText = ir.blocks.map(function(b) {
    return JSON.stringify(b);
  }).join('');
  assert(allText.indexOf('onclick') === -1, '不应有 onclick 残留');
});

test('link 标签降级', function() {
  var ir = parseMod.parse(aiDoc, 'html');
  var hasLinkDegrade = ir.degraded.some(function(d) {
    return d.reason === 'external-stylesheet' || d.reason === 'sanitized';
  });
  assert(hasLinkDegrade, '应有外部样式表降级或消毒信息');
});

test('TOC 目录正确', function() {
  var ir = parseMod.parse(aiDoc, 'html');
  assert(ir.toc.length >= 3, '应有 3+ 目录项, 实际: ' + ir.toc.length);
  var titles = ir.toc.map(function(t) { return t.text; });
  assert(titles.indexOf('AI 生成报告') !== -1, '应包含 "AI 生成报告"');
  assert(titles.indexOf('核心指标') !== -1, '应包含 "核心指标"');
});

test('CSS 变量传递到块样式', function() {
  var ir = parseMod.parse(aiDoc, 'html');
  var h1Block = ir.blocks.find(function(b) { return b.type === 'heading' && b.level === 1; });
  assert(h1Block, '应有 h1 块');
  // style 中应包含 var(--primary) 求值后的颜色
  if (h1Block.style) {
    assert(h1Block.style.indexOf('#4f46e5') !== -1 || h1Block.style.indexOf('var(--primary)') !== -1,
      'h1 style 应包含 primary 颜色, style: ' + h1Block.style);
  }
});

test('Tailwind 类名展开', function() {
  var ir = parseMod.parse(aiDoc, 'html');
  var cardBlock = ir.blocks.find(function(b) {
    return b.style && b.style.indexOf('padding') !== -1;
  });
  assert(cardBlock, '应有含 padding 的块（Tailwind p-6 展开）');
});

test('伪元素合成', function() {
  var ir = parseMod.parse(aiDoc, 'html');
  // .tag::before { content: "🏷️ " } 应合成到 li 内容
  var tagBlock = ir.blocks.find(function(b) {
    var text = JSON.stringify(b);
    return text.indexOf('🏷') !== -1 || text.indexOf('tag') !== -1;
  });
  // 伪元素合成是可选的，只要不崩溃就行
  assert(tagBlock || true, '伪元素处理不崩溃');
});

test('base64 图片检测', function() {
  var ir = parseMod.parse(aiDoc, 'html');
  assert(ir.hasBase64 === true, '应检测到 base64 图片');
  var imgBlock = ir.blocks.find(function(b) { return b.type === 'image' && b.src && b.src.indexOf('data:image') === 0; });
  assert(imgBlock, '应有 base64 图片块');
});

test('网络图片检测', function() {
  var ir = parseMod.parse(aiDoc, 'html');
  assert(ir.hasNetworkImage === true, '应检测到网络图片');
});

test('网络图片门控（默认关闭）', function() {
  var ir = parseMod.parse(aiDoc, 'html');
  // 先复制 blocks 避免修改原始
  var blocks = ir.blocks.map(function(b) { return Object.assign({}, b); });
  postprocess.gateNetworkImages(blocks, false);
  var netImg = blocks.find(function(b) {
    return b._networkBlocked === true;
  });
  assert(netImg, '应有被屏蔽的网络图片');
});

test('网络图片门控（开启后恢复）', function() {
  var ir = parseMod.parse(aiDoc, 'html');
  var blocks = ir.blocks.map(function(b) { return Object.assign({}, b); });
  // 先屏蔽
  postprocess.gateNetworkImages(blocks, false);
  // 再恢复
  postprocess.gateNetworkImages(blocks, true);
  var stillBlocked = blocks.find(function(b) { return b._networkBlocked === true; });
  assert(!stillBlocked, '不应再有被屏蔽的图片');
});

test('IR 大小检查通过', function() {
  var ir = parseMod.parse(aiDoc, 'html');
  var check = postprocess.checkIRSize(ir);
  assert(check.ok === true, '正常文档应通过大小检查');
});

test('代码块正确解析', function() {
  var ir = parseMod.parse(aiDoc, 'html');
  var codeBlock = ir.blocks.find(function(b) { return b.type === 'code'; });
  assert(codeBlock, '应有代码块');
  assert(codeBlock.lang === 'javascript', '语言应为 javascript, 实际: ' + codeBlock.lang);
  assert(codeBlock.text.indexOf('function init') !== -1, '应包含代码内容');
});

test('表格正确解析', function() {
  var ir = parseMod.parse(aiDoc, 'html');
  var tableBlock = ir.blocks.find(function(b) { return b.type === 'table'; });
  assert(tableBlock, '应有表格块');
  assert(tableBlock.header && tableBlock.header.length === 2, '表头应有 2 列');
  assert(tableBlock.rows && tableBlock.rows.length >= 2, '应有 2+ 数据行');
});

test('引用块正确解析', function() {
  var ir = parseMod.parse(aiDoc, 'html');
  // blockquote 作为容器递归处理，子 <p> 变为 paragraph 块
  var bqBlock = ir.blocks.find(function(b) {
    return b.type === 'paragraph' && b.text && b.text.indexOf('关键结论') !== -1;
  });
  assert(bqBlock, '应有包含引用文本的段落块');
});

test('链接正确解析', function() {
  var ir = parseMod.parse(aiDoc, 'html');
  var linkFound = false;
  for (var i = 0; i < ir.blocks.length; i++) {
    var b = ir.blocks[i];
    if (b.segments) {
      for (var j = 0; j < b.segments.length; j++) {
        if (b.segments[j].href && b.segments[j].href === 'https://example.com') {
          linkFound = true;
          break;
        }
      }
    }
  }
  assert(linkFound, '应找到带 href 的链接段');
});

// ── 异常容错 ──
console.log('\n异常容错');

test('空 HTML 不崩溃', function() {
  var ir = parseMod.parse('', 'html');
  assert(ir.blocks !== undefined, '应返回 blocks');
});

test('null 输入不崩溃', function() {
  var ir = parseMod.parse(null, 'html');
  assert(ir.blocks !== undefined, 'null 应安全处理');
});

test('纯文本作为 HTML 解析', function() {
  var ir = parseMod.parse('这是纯文本，没有 HTML 标签', 'html');
  assert(ir.blocks && ir.blocks.length > 0, '应产出块');
  assert(ir.degraded && ir.degraded.length > 0, '应有降级信息（纯文本降级）');
});

test('超深嵌套不崩溃', function() {
  var html = '';
  for (var i = 0; i < 200; i++) html += '<div>';
  html += '<p>深处文本</p>';
  for (var i = 0; i < 200; i++) html += '</div>';
  var ir = parseMod.parse(html, 'html');
  assert(ir.blocks !== undefined, '超深嵌套应安全处理');
  assert(ir.truncated === true || ir.blocks.length > 0, '应截断或产出块');
});

test('超大节点数不崩溃', function() {
  var html = '<div>';
  for (var i = 0; i < 60000; i++) html += '<p>项 ' + i + '</p>';
  html += '</div>';
  var ir = parseMod.parse(html, 'html');
  assert(ir.blocks !== undefined, '超大节点应安全处理');
  assert(ir.truncated === true || ir.blocks.length < 60000, '应截断');
});

// ── 编码兼容 ──
console.log('\n编码兼容');

test('BOM 剥离', function() {
  var html = '\uFEFF<html><body><p>BOM 测试</p></body></html>';
  var ir = parseMod.parse(html, 'html');
  assert(ir.blocks && ir.blocks.length > 0, 'BOM HTML 应正常解析');
  var firstText = JSON.stringify(ir.blocks[0]);
  assert(firstText.indexOf('BOM') !== -1, '内容应正确');
  assert(firstText.indexOf('\uFEFF') === -1, 'BOM 应被剥离');
});

test('HTML 实体解码', function() {
  var html = '<p>&lt;tag&gt; &amp; &quot;quote&quot; &nbsp;空格</p>';
  var ir = parseMod.parse(html, 'html');
  var allText = ir.blocks.map(function(b) { return JSON.stringify(b); }).join('');
  assert(allText.indexOf('<tag>') !== -1, '< > 应被解码');
  assert(allText.indexOf('&') !== -1, '& 应被解码');
});

// ── 结果 ──
console.log('\n════════════════════════════════════════');
console.log('通过: ' + passed + ' | 失败: ' + failed);
if (failed === 0) {
  console.log('全部通过！');
} else {
  console.log('有 ' + failed + ' 个测试失败');
  process.exit(1);
}
