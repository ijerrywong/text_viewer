#!/usr/bin/env node
/**
 * Phase 3 HTML 管线集成测试
 *
 * 测试全链路：tokenizer → preprocess → tailwind → degrade → converter
 * 验证 HTML → IR 转换的正确性
 */

var path = require('path');
var converter = require(path.resolve(__dirname, '../miniprogram/core/parse/html/converter.js'));
var tokenizer = require(path.resolve(__dirname, '../miniprogram/core/parse/html/tokenizer.js'));
var preprocess = require(path.resolve(__dirname, '../miniprogram/core/parse/html/preprocess.js'));
var tailwind = require(path.resolve(__dirname, '../miniprogram/core/parse/html/tailwind.js'));
var degrade = require(path.resolve(__dirname, '../miniprogram/core/parse/html/degrade.js'));

var passed = 0;
var failed = 0;
var failures = [];

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(message);
    console.log('  ✗ FAIL: ' + message);
  }
}

function assertEqual(actual, expected, message) {
  var ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
  } else {
    failed++;
    failures.push(message);
    console.log('  ✗ FAIL: ' + message);
    console.log('    expected: ' + JSON.stringify(expected));
    console.log('    actual:   ' + JSON.stringify(actual));
  }
}

function blockTypes(blocks) {
  return blocks.map(function(b) { return b.type; });
}

function findBlock(blocks, type) {
  for (var i = 0; i < blocks.length; i++) {
    if (blocks[i].type === type) return blocks[i];
  }
  return null;
}

function findBlocks(blocks, type) {
  return blocks.filter(function(b) { return b.type === type; });
}

// ═══════════════════════════════════════════════════
// 测试 1：基础 HTML 文档
// ═══════════════════════════════════════════════════
console.log('\n测试 1：基础 HTML 文档');
(function() {
  var html = '<html><body>' +
    '<h1>标题一</h1>' +
    '<p>这是一个段落，包含<strong>加粗</strong>和<em>斜体</em>。</p>' +
    '<h2>子标题</h2>' +
    '<p>另一个段落，带<a href="https://example.com">链接</a>。</p>' +
    '<hr>' +
    '<ul><li>项目一</li><li>项目二</li></ul>' +
    '<ol><li>有序一</li><li>有序二</li></ol>' +
    '</body></html>';

  var result = converter.convert(html);
  var types = blockTypes(result.blocks);

  assert(types.indexOf('heading') >= 0, '应包含 heading 块');
  assert(types.indexOf('paragraph') >= 0, '应包含 paragraph 块');
  assert(types.indexOf('hr') >= 0, '应包含 hr 块');
  assert(types.indexOf('listItem') >= 0, '应包含 listItem 块');

  var headings = findBlocks(result.blocks, 'heading');
  assertEqual(headings.length, 2, '应有 2 个标题');
  assertEqual(headings[0].level, 1, '第一个标题 level=1');
  assertEqual(headings[1].level, 2, '第二个标题 level=2');
  assertEqual(headings[0].text, '标题一', '第一个标题文本');

  var listItems = findBlocks(result.blocks, 'listItem');
  assertEqual(listItems.length, 4, '应有 4 个列表项（2 ul + 2 ol）');
  assertEqual(listItems[0].ordered, false, '第一个列表项无序');
  assertEqual(listItems[2].ordered, true, '第三个列表项有序');
  assertEqual(listItems[2].ordIndex, 1, '有序列表第一项 ordIndex=1');

  assert(result.toc.length === 2, 'TOC 应有 2 项');
  assertEqual(result.toc[0].level, 1, 'TOC 第一项 level=1');

  // 验证段落中的 inline segments
  var paras = findBlocks(result.blocks, 'paragraph');
  var firstPara = paras[0];
  assert(firstPara.segments && firstPara.segments.length > 0, '段落应有 segments');
  // 第一个段落应包含 bold segment
  var hasBold = firstPara.segments.some(function(s) { return s.bold; });
  assert(hasBold, '第一个段落应包含 bold segment');
  // 应包含 italic segment
  var hasItalic = firstPara.segments.some(function(s) { return s.italic; });
  assert(hasItalic, '第一个段落应包含 italic segment');

  // 第二个段落应包含 link
  var secondPara = paras[1];
  var hasLink = secondPara.segments.some(function(s) { return s.href === 'https://example.com'; });
  assert(hasLink, '第二个段落应包含 href 链接');
})();

// ═══════════════════════════════════════════════════
// 测试 2：片段 HTML（无 html/body，C7 容错）
// ═══════════════════════════════════════════════════
console.log('\n测试 2：片段 HTML（C7 容错）');
(function() {
  var html = '<h1>片段标题</h1><p>片段内容</p>';
  var result = converter.convert(html);
  assert(result.blocks.length >= 2, '片段 HTML 应至少 2 个块');
  assert(result.blocks[0].type === 'heading', '第一个块应为 heading');
  assert(result.blocks[1].type === 'paragraph', '第二个块应为 paragraph');
  assertEqual(result.blocks[0].text, '片段标题', '标题文本');
})();

// ═══════════════════════════════════════════════════
// 测试 3：Tailwind 类名展开（C17）
// ═══════════════════════════════════════════════════
console.log('\n测试 3：Tailwind 类名展开（C17）');
(function() {
  var html = '<div class="p-4 bg-slate-50 rounded-lg">' +
    '<h1 class="text-2xl font-bold text-blue-600">Tailwind 标题</h1>' +
    '<p class="text-gray-700 mt-2">Tailwind 段落</p>' +
    '</div>';
  var result = converter.convert(html);

  var heading = findBlock(result.blocks, 'heading');
  assert(heading !== null, '应包含标题');
  assert(heading.style && heading.style.indexOf('font-weight') >= 0, '标题样式应含 font-weight（来自 font-bold）');
  assert(heading.style && heading.style.indexOf('color') >= 0, '标题样式应含 color（来自 text-blue-600）');

  var para = findBlock(result.blocks, 'paragraph');
  assert(para !== null, '应包含段落');
  assert(para.style && para.style.indexOf('margin-top') >= 0, '段落样式应含 margin-top（来自 mt-2）');
})();

// ═══════════════════════════════════════════════════
// 测试 4：CSS 变量求值（C18）
// ═══════════════════════════════════════════════════
console.log('\n测试 4：CSS 变量求值（C18）');
(function() {
  var html = '<style>' +
    ':root { --primary: #4f46e5; --bg: #f8fafc; }' +
    '.card { color: var(--primary); background-color: var(--bg); }' +
    '</style>' +
    '<div class="card"><p>CSS 变量测试</p></div>';
  var result = converter.convert(html);

  // 验证变量被收集
  var tokenized = tokenizer.tokenize(html);
  var cssCtx = preprocess.preprocess(html, tokenized.styles);
  assert(cssCtx.vars['--primary'] === '#4f46e5', '应收集 --primary 变量');
  assert(cssCtx.vars['--bg'] === '#f8fafc', '应收集 --bg 变量');

  // 验证规则中 var() 被替换
  var cardRule = cssCtx.rules.find(function(r) { return r.selector === '.card'; });
  assert(cardRule !== undefined, '应解析 .card 规则');
  assert(cardRule.declarations['color'] === '#4f46e5', 'color 应被替换为 #4f46e5');
  assert(cardRule.declarations['background-color'] === '#f8fafc', 'background-color 应被替换');
})();

// ═══════════════════════════════════════════════════
// 测试 5：CSS 变量 fallback
// ═══════════════════════════════════════════════════
console.log('\n测试 5：CSS 变量 fallback');
(function() {
  var vars = { '--known': 'red' };
  assertEqual(preprocess.resolveVars('var(--known)', vars), 'red', '已知变量应替换');
  assertEqual(preprocess.resolveVars('var(--unknown, blue)', vars), 'blue', '未知变量应用 fallback');
  assertEqual(preprocess.resolveVars('var(--unknown)', vars), '', '未知变量无 fallback 应为空');
  assertEqual(preprocess.resolveVars('1px solid var(--known)', vars), '1px solid red', '复合值中的变量应替换');
})();

// ═══════════════════════════════════════════════════
// 测试 6：伪元素提取（C19）
// ═══════════════════════════════════════════════════
console.log('\n测试 6：伪元素提取（C19）');
(function() {
  var css = '.quote::before { content: "\\201C"; color: gray; }' +
    '.quote::after { content: "\\201D"; color: gray; }' +
    'h2::before { content: "§ "; font-weight: bold; }';
  var rules = preprocess.parseCSS(css);
  var pseudos = preprocess.extractPseudoElements(rules);

  assertEqual(pseudos.length, 3, '应提取 3 个伪元素');
  assertEqual(pseudos[0].selector, '.quote', '第一个伪元素选择器');
  assertEqual(pseudos[0].pseudo, 'before', '第一个伪元素类型');
  assert(pseudos[0].content.length > 0, 'before 应有 content');
  assertEqual(pseudos[2].selector, 'h2', '第三个伪元素选择器');
})();

// ═══════════════════════════════════════════════════
// 测试 7：fixed/sticky → static 降级（C21）
// ═══════════════════════════════════════════════════
console.log('\n测试 7：fixed/sticky → static 降级（C21）');
(function() {
  var css = '.sidebar { position: fixed; top: 0; } .header { position: sticky; } .normal { position: relative; }';
  var rules = preprocess.parseCSS(css);
  preprocess.degradeFixedSticky(rules);

  var sidebar = rules.find(function(r) { return r.selector === '.sidebar'; });
  assertEqual(sidebar.declarations['position'], 'static', 'fixed 应降级为 static');

  var header = rules.find(function(r) { return r.selector === '.header'; });
  assertEqual(header.declarations['position'], 'static', 'sticky 应降级为 static');

  var normal = rules.find(function(r) { return r.selector === '.normal'; });
  assertEqual(normal.declarations['position'], 'relative', 'relative 不应变');

  // 内联样式降级
  var style = { 'position': 'fixed' };
  preprocess.degradeFixedStickyInline(style);
  assertEqual(style['position'], 'static', '内联 fixed 应降级为 static');
})();

// ═══════════════════════════════════════════════════
// 测试 8：视口钳制（C20）
// ═══════════════════════════════════════════════════
console.log('\n测试 8：视口钳制（C20）');
(function() {
  var guard = preprocess.getViewportGuard();
  assert(guard.indexOf('max-width: 100%') >= 0, '应包含 max-width: 100%');
  assert(guard.indexOf('box-sizing: border-box') >= 0, '应包含 box-sizing: border-box');
  assert(guard.indexOf('overflow-x: hidden') >= 0, '应包含 overflow-x: hidden');
})();

// ═══════════════════════════════════════════════════
// 测试 9：Chart.js 脚本降级（C22）
// ═══════════════════════════════════════════════════
console.log('\n测试 9：Chart.js 脚本降级（C22）');
(function() {
  var html = '<html><body>' +
    '<canvas id="myChart"></canvas>' +
    '<script src="chart.js"></script>' +
    '<script>new Chart(ctx, {type:"bar"});</script>' +
    '<p>图表说明文本</p>' +
    '</body></html>';
  var result = converter.convert(html);

  var degradeBlocks = findBlocks(result.blocks, 'scriptDegrade');
  assert(degradeBlocks.length >= 1, '应生成至少 1 个降级块');
  assertEqual(degradeBlocks[0].degradeType, 'chart', '降级类型应为 chart');
  assert(degradeBlocks[0].title.indexOf('Chart.js') >= 0, '标题应含 Chart.js');
  assert(degradeBlocks[0].message.length > 0, '应有降级说明消息');

  // 正常内容仍应渲染
  var para = findBlock(result.blocks, 'paragraph');
  assert(para !== null, '图表说明文本应正常渲染');
})();

// ═══════════════════════════════════════════════════
// 测试 10：Mermaid 降级
// ═══════════════════════════════════════════════════
console.log('\n测试 10：Mermaid 降级');
(function() {
  var html = '<div class="mermaid">graph TD; A-->B; B-->C;</div>' +
    '<script src="mermaid.js"></script>';
  var result = converter.convert(html);

  var codeBlocks = findBlocks(result.blocks, 'code');
  var mermaidBlock = codeBlocks.find(function(b) { return b.lang === 'mermaid'; });
  assert(mermaidBlock !== undefined, '应生成 mermaid 代码块');
  assert(mermaidBlock.text.indexOf('graph TD') >= 0, '代码块应含 Mermaid 源码');
})();

// ═══════════════════════════════════════════════════
// 测试 11：reveal.js 幻灯片降级（C23）
// ═══════════════════════════════════════════════════
console.log('\n测试 11：reveal.js 幻灯片降级（C23）');
(function() {
  var html = '<div class="reveal"><div class="slides">' +
    '<section><h1>第一页</h1><p>内容一</p></section>' +
    '<section><h2>第二页</h2><p>内容二</p></section>' +
    '</div></div>' +
    '<script src="reveal.js"></script>';
  var result = converter.convert(html);

  var slideBlocks = findBlocks(result.blocks, 'scriptDegrade').filter(function(b) {
    return b.degradeType === 'slide';
  });
  assert(slideBlocks.length >= 2, '应生成至少 2 个幻灯片降级块');
  assert(slideBlocks[0].title.indexOf('幻灯片 1') >= 0, '第一个幻灯片标题');
  assert(slideBlocks[1].title.indexOf('幻灯片 2') >= 0, '第二个幻灯片标题');
  assert(slideBlocks[0].message.indexOf('第一页') >= 0, '第一个幻灯片含内容');
})();

// ═══════════════════════════════════════════════════
// 测试 12：表格解析
// ═══════════════════════════════════════════════════
console.log('\n测试 12：表格解析');
(function() {
  var html = '<table>' +
    '<thead><tr><th>姓名</th><th>年龄</th></tr></thead>' +
    '<tbody>' +
    '<tr><td>张三</td><td>25</td></tr>' +
    '<tr><td>李四</td><td>30</td></tr>' +
    '</tbody>' +
    '</table>';
  var result = converter.convert(html);

  var table = findBlock(result.blocks, 'table');
  assert(table !== null, '应生成 table 块');
  assertEqual(table.header.length, 2, '表头 2 列');
  assertEqual(table.header[0].text, '姓名', '表头第一列');
  assertEqual(table.rows.length, 2, '2 行数据');
  assertEqual(table.rows[0][0].text, '张三', '第一行第一列');
  assertEqual(table.rows[1][1].text, '30', '第二行第二列');
})();

// ═══════════════════════════════════════════════════
// 测试 13：代码块
// ═══════════════════════════════════════════════════
console.log('\n测试 13：代码块');
(function() {
  var html = '<pre><code class="language-javascript">function hello() {\n  return "world";\n}</code></pre>';
  var result = converter.convert(html);

  var code = findBlock(result.blocks, 'code');
  assert(code !== null, '应生成 code 块');
  assertEqual(code.lang, 'javascript', '语言应为 javascript');
  assert(code.text.indexOf('function hello') >= 0, '代码文本应正确');
})();

// ═══════════════════════════════════════════════════
// 测试 14：base64 图片检测
// ═══════════════════════════════════════════════════
console.log('\n测试 14：base64 图片检测');
(function() {
  var html = '<img src="data:image/png;base64,iVBORw0KGgo=" alt="测试图">';
  var result = converter.convert(html);

  var img = findBlock(result.blocks, 'image');
  assert(img !== null, '应生成 image 块');
  assert(img.src.indexOf('data:image/png') === 0, 'src 应为 data URI');
  assertEqual(result.hasBase64, true, '应标记 hasBase64');
  assertEqual(result.images.length, 1, 'images 数组应有 1 项');
})();

// ═══════════════════════════════════════════════════
// 测试 15：网络图片检测
// ═══════════════════════════════════════════════════
console.log('\n测试 15：网络图片检测');
(function() {
  var html = '<img src="https://example.com/image.png" alt="网络图">';
  var result = converter.convert(html);

  assertEqual(result.hasNetworkImage, true, '应标记 hasNetworkImage');
  var img = findBlock(result.blocks, 'image');
  assert(img !== null, '应生成 image 块');
})();

// ═══════════════════════════════════════════════════
// 测试 16：内联 SVG → base64（C26）
// ═══════════════════════════════════════════════════
console.log('\n测试 16：内联 SVG → base64（C26）');
(function() {
  var html = '<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">' +
    '<circle cx="50" cy="50" r="40" fill="red" />' +
    '</svg>';
  var result = converter.convert(html);

  var img = findBlock(result.blocks, 'image');
  assert(img !== null, 'SVG 应转为 image 块');
  assert(img.src.indexOf('data:image/svg+xml;base64,') === 0, 'src 应为 SVG base64 data URI');
  assertEqual(result.images.length, 1, 'images 数组应有 1 项');
})();

// ═══════════════════════════════════════════════════
// 测试 17：畸形 HTML 容错
// ═══════════════════════════════════════════════════
console.log('\n测试 17：畸形 HTML 容错');
(function() {
  var html = '<h1>未闭合标题<p>段落</p>';
  var result = converter.convert(html);
  assert(result.blocks.length >= 2, '畸形 HTML 仍应产出块');
  assert(result.blocks[0].type === 'heading' || result.blocks[0].type === 'paragraph', '第一个块类型合理');

  // 未闭合的 <p>
  var html2 = '<p>段落一<p>段落二';
  var result2 = converter.convert(html2);
  assert(result2.blocks.length >= 2, '两个未闭合 <p> 应产出 2 个块');
})();

// ═══════════════════════════════════════════════════
// 测试 18：嵌套容器递归
// ═══════════════════════════════════════════════════
console.log('\n测试 18：嵌套容器递归');
(function() {
  var html = '<div><section><article>' +
    '<h1>深层标题</h1>' +
    '<p>深层段落</p>' +
    '</article></section></div>';
  var result = converter.convert(html);

  assert(result.blocks.length >= 2, '嵌套容器应递归提取子元素');
  var heading = findBlock(result.blocks, 'heading');
  assert(heading !== null && heading.text === '深层标题', '应找到深层标题');
})();

// ═══════════════════════════════════════════════════
// 测试 19：<style> 提权（C8）
// ═══════════════════════════════════════════════════
console.log('\n测试 19：<style> 提权（C8）');
(function() {
  var html = '<style>' +
    'h1 { color: red; font-size: 36px; }' +
    '.highlight { background-color: yellow; }' +
    '</style>' +
    '<h1 class="highlight">样式测试</h1>';
  var result = converter.convert(html);

  var heading = findBlock(result.blocks, 'heading');
  assert(heading !== null, '应生成标题');
  assert(heading.style && heading.style.indexOf('color: red') >= 0, '标题样式应含 color: red（来自 CSS 规则）');
  assert(heading.style && heading.style.indexOf('background-color: yellow') >= 0, '标题样式应含 background-color: yellow（来自 .highlight）');
})();

// ═══════════════════════════════════════════════════
// 测试 20：内联样式优先级
// ═══════════════════════════════════════════════════
console.log('\n测试 20：内联样式优先级');
(function() {
  var html = '<style>p { color: blue; }</style>' +
    '<p style="color: red; font-size: 18px;">内联样式优先</p>';
  var result = converter.convert(html);

  var para = findBlock(result.blocks, 'paragraph');
  assert(para !== null, '应生成段落');
  // 内联 style 应覆盖 CSS 规则
  assert(para.style.indexOf('color: red') >= 0, '内联 color: red 应覆盖 CSS 的 blue');
  assert(para.style.indexOf('font-size: 18px') >= 0, '应包含内联 font-size');
})();

// ═══════════════════════════════════════════════════
// 测试 21：blockquote 递归
// ═══════════════════════════════════════════════════
console.log('\n测试 21：blockquote 递归');
(function() {
  var html = '<blockquote><p>引用段落</p><p>第二段引用</p></blockquote>';
  var result = converter.convert(html);

  var paras = findBlocks(result.blocks, 'paragraph');
  assert(paras.length >= 2, 'blockquote 内应有 2 个段落');
})();

// ═══════════════════════════════════════════════════
// 测试 22：任务列表
// ═══════════════════════════════════════════════════
console.log('\n测试 22：任务列表');
(function() {
  var html = '<ul>' +
    '<li class="task-list-item"><input type="checkbox" checked>已完成</li>' +
    '<li class="task-list-item"><input type="checkbox">未完成</li>' +
    '</ul>';
  var result = converter.convert(html);

  var items = findBlocks(result.blocks, 'listItem');
  assert(items.length >= 2, '应有 2 个列表项');
  assertEqual(items[0].task, true, '第一项应为任务');
  assertEqual(items[0].checked, true, '第一项应已勾选');
  assertEqual(items[1].task, true, '第二项应为任务');
  // checked 可能是 false 或 undefined
  assert(!items[1].checked, '第二项应未勾选');
})();

// ═══════════════════════════════════════════════════
// 测试 23：HTML 实体解码
// ═══════════════════════════════════════════════════
console.log('\n测试 23：HTML 实体解码');
(function() {
  var html = '<p>符号 &amp; &lt; &gt; &quot; &#65; &copy;</p>';
  var result = converter.convert(html);
  var para = findBlock(result.blocks, 'paragraph');
  assert(para !== null, '应生成段落');
  assert(para.text.indexOf('&') >= 0, '应解码 &amp;');
  assert(para.text.indexOf('<') >= 0, '应解码 &lt;');
  assert(para.text.indexOf('>') >= 0, '应解码 &gt;');
  assert(para.text.indexOf('A') >= 0, '应解码 &#65;');
  assert(para.text.indexOf('©') >= 0, '应解码 &copy;');
})();

// ═══════════════════════════════════════════════════
// 测试 24：空 HTML / 纯空白
// ═══════════════════════════════════════════════════
console.log('\n测试 24：空 HTML / 纯空白');
(function() {
  var result1 = converter.convert('');
  assertEqual(result1.blocks.length, 0, '空字符串应无块');

  var result2 = converter.convert('   \n\n  ');
  assertEqual(result2.blocks.length, 0, '纯空白应无块');

  var result3 = converter.convert(null);
  assertEqual(result3.blocks.length, 0, 'null 应无块');
})();

// ═══════════════════════════════════════════════════
// 测试 25：坏块降级纯文本（C12）
// ═══════════════════════════════════════════════════
console.log('\n测试 25：坏块降级纯文本（C12）');
(function() {
  // 纯文本（无 HTML 标签）
  var html = '这是一段纯文本，没有 HTML 标签。\n第二行文本。';
  var result = converter.convert(html);
  assert(result.blocks.length >= 1, '纯文本应降级为段落');
  var para = result.blocks[0];
  assertEqual(para.type, 'paragraph', '应为 paragraph 类型');
  assert(para.text.indexOf('纯文本') >= 0, '应包含原始文本');
  assert(result.degraded.length > 0, '应记录降级信息');
})();

// ═══════════════════════════════════════════════════
// 测试 26：嵌套内联元素
// ═══════════════════════════════════════════════════
console.log('\n测试 26：嵌套内联元素');
(function() {
  var html = '<p>这是<strong>加粗中含<em>加粗斜体</em></strong>文本</p>';
  var result = converter.convert(html);
  var para = findBlock(result.blocks, 'paragraph');
  assert(para !== null, '应生成段落');
  assert(para.segments.length > 0, '应有 segments');

  // 应有同时 bold 和 italic 的 segment
  var hasBoldItalic = para.segments.some(function(s) {
    return s.bold && s.italic;
  });
  assert(hasBoldItalic, '应存在 bold+italic 的 segment');
})();

// ═══════════════════════════════════════════════════
// 测试 27：Tailwind 检测
// ═══════════════════════════════════════════════════
console.log('\n测试 27：Tailwind 检测');
(function() {
  assert(tailwind.hasTailwind('<script src="cdn.tailwindcss.com"></script>'), '应检测到 Tailwind CDN');
  assert(!tailwind.hasTailwind('<p>普通 HTML</p>'), '无 Tailwind 不应误报');
})();

// ═══════════════════════════════════════════════════
// 测试 28：CSS 选择器匹配
// ═══════════════════════════════════════════════════
console.log('\n测试 28：CSS 选择器匹配');
(function() {
  var node = { type: 'element', tag: 'div', attrs: { class: 'card active', id: 'main' } };

  assert(preprocess.matchesSimpleSelector(node, 'div'), '应匹配 tag');
  assert(preprocess.matchesSimpleSelector(node, '.card'), '应匹配 class');
  assert(preprocess.matchesSimpleSelector(node, '#main'), '应匹配 id');
  assert(preprocess.matchesSimpleSelector(node, 'div.card'), '应匹配 tag.class');
  assert(preprocess.matchesSimpleSelector(node, '.card.active'), '应匹配多 class');
  assert(!preprocess.matchesSimpleSelector(node, 'span'), '不应匹配错误 tag');
  assert(!preprocess.matchesSimpleSelector(node, '.missing'), '不应匹配错误 class');

  // 后代选择器
  var parent = { type: 'element', tag: 'section', attrs: { class: 'container' } };
  var ancestors = [parent];
  assert(preprocess.matchesSelector(node, 'section div', ancestors), '应匹配后代选择器');
  assert(preprocess.matchesSelector(node, '.container .card', ancestors), '应匹配 class 后代选择器');
  assert(!preprocess.matchesSelector(node, 'nav div', ancestors), '不应匹配错误后代');
})();

// ═══════════════════════════════════════════════════
// 测试 29：内联图片
// ═══════════════════════════════════════════════════
console.log('\n测试 29：内联图片');
(function() {
  var html = '<p>文本<img src="data:image/png;base64,abc">后续文本</p>';
  var result = converter.convert(html);
  var para = findBlock(result.blocks, 'paragraph');
  assert(para !== null, '应生成段落');
  assert(para.segments.length >= 3, '应有 3+ segments（文本+图片+文本）');

  var hasImgSeg = para.segments.some(function(s) { return s.image; });
  assert(hasImgSeg, '应有 image segment');
  assertEqual(result.hasBase64, true, '应标记 hasBase64');
})();

// ═══════════════════════════════════════════════════
// 测试 30：Math 降级
// ═══════════════════════════════════════════════════
console.log('\n测试 30：Math 降级');
(function() {
  var html = '<p>公式 \\(E=mc^2\\) 测试</p><script src="katex.js"></script>';
  var result = converter.convert(html);

  var mathDegrade = findBlocks(result.blocks, 'scriptDegrade').find(function(b) {
    return b.degradeType === 'math';
  });
  assert(mathDegrade !== undefined, '应生成 math 降级块');
  assert(mathDegrade.message.indexOf('数学公式') >= 0, '降级消息应含数学公式');
})();

// ═══════════════════════════════════════════════════
// 测试 31：@media 规则解析
// ═══════════════════════════════════════════════════
console.log('\n测试 31：@media 规则解析');
(function() {
  var css = '@media (max-width: 768px) { .card { padding: 8px; } } .card { padding: 16px; }';
  var rules = preprocess.parseCSS(css);
  var cardRules = rules.filter(function(r) { return r.selector === '.card'; });
  assert(cardRules.length >= 2, '应解析出 2 条 .card 规则（含 @media 内的）');
})();

// ═══════════════════════════════════════════════════
// 测试 32：ECharts 降级
// ═══════════════════════════════════════════════════
console.log('\n测试 32：ECharts 降级');
(function() {
  var html = '<div id="chart-container"></div>' +
    '<script>echarts.init(document.getElementById("chart-container")).setOption({});</script>';
  var result = converter.convert(html);

  var chartDegrade = findBlocks(result.blocks, 'scriptDegrade').find(function(b) {
    return b.degradeType === 'chart';
  });
  assert(chartDegrade !== undefined, '应生成 ECharts 降级块');
  assert(chartDegrade.title.indexOf('ECharts') >= 0, '标题应含 ECharts');
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
