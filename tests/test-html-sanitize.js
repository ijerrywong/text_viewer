/**
 * test-html-sanitize.js — HTML 消毒模块测试
 *
 * 覆盖 ADR-6 安全规则：
 * - script/iframe/object/embed/form/base/link/meta/noscript/applet 标签剥离
 * - on* 事件属性移除
 * - javascript:/vbscript:/data:text/html 链接清洗
 * - style 中 expression()/url(javascript:) 清洗
 * - meta refresh 移除
 * - IE 条件注释移除
 * - 安全内容保留
 */

var assert = require('assert');
var sanitizeMod = require('../miniprogram/core/sanitize/index.js');

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

console.log('\n═══ HTML 消毒模块测试 ═══\n');

// ── script 标签 ──
console.log('script 标签移除');

test('移除 <script> 及内容', function() {
  var html = '<p>安全</p><script>alert("xss")</script><p>内容</p>';
  var result = sanitizeMod.sanitize(html);
  assert(result.html.indexOf('<script') === -1, 'script 标签应被移除');
  assert(result.html.indexOf('alert') === -1, 'script 内容应被移除');
  assert(result.removed.indexOf('script') !== -1, 'removed 应记录 script');
  assert(result.html.indexOf('安全') !== -1, '安全内容应保留');
  assert(result.html.indexOf('内容') !== -1, '安全内容应保留');
});

test('移除带属性的 <script>', function() {
  var html = '<script type="text/javascript" src="evil.js"></script><p>ok</p>';
  var result = sanitizeMod.sanitize(html);
  assert(result.html.indexOf('<script') === -1, '带属性的 script 应被移除');
  assert(result.html.indexOf('evil.js') === -1, 'src 应被移除');
});

test('移除多个 <script> 标签', function() {
  var html = '<script>a()</script><p>1</p><script>b()</script><p>2</p>';
  var result = sanitizeMod.sanitize(html);
  assert(result.html.indexOf('<script') === -1, '所有 script 应被移除');
  var scriptCount = result.removed.filter(function(r) { return r === 'script'; }).length;
  assert(scriptCount === 2, '应有 2 个 script 记录, 实际: ' + scriptCount);
});

// ── 危险标签 ──
console.log('\n危险标签移除');

test('移除 iframe', function() {
  var html = '<iframe src="evil.com"></iframe><p>ok</p>';
  var result = sanitizeMod.sanitize(html);
  assert(result.html.indexOf('<iframe') === -1, 'iframe 应被移除');
  assert(result.removed.indexOf('iframe') !== -1, '应记录 iframe');
});

test('移除 object/embed', function() {
  var html = '<object data="evil.swf"></object><embed src="evil.swf">';
  var result = sanitizeMod.sanitize(html);
  assert(result.html.indexOf('<object') === -1, 'object 应被移除');
  assert(result.html.indexOf('<embed') === -1, 'embed 应被移除');
});

test('移除 form', function() {
  var html = '<form action="evil.com"><input name="pw"></form><p>ok</p>';
  var result = sanitizeMod.sanitize(html);
  assert(result.html.indexOf('<form') === -1, 'form 应被移除');
  assert(result.html.indexOf('input') === -1, 'form 内容应被移除');
});

test('移除 base 标签', function() {
  var html = '<base href="evil.com/"><p>ok</p>';
  var result = sanitizeMod.sanitize(html);
  assert(result.html.indexOf('<base') === -1, 'base 应被移除');
});

test('移除 link 标签', function() {
  var html = '<link rel="stylesheet" href="evil.css"><p>ok</p>';
  var result = sanitizeMod.sanitize(html);
  assert(result.html.indexOf('<link') === -1, 'link 应被移除');
  assert(result.removed.indexOf('link') !== -1, '应记录 link');
});

test('移除 noscript', function() {
  var html = '<noscript><meta http-equiv="refresh" content="0;url=evil.com"></noscript>';
  var result = sanitizeMod.sanitize(html);
  assert(result.html.indexOf('<noscript') === -1, 'noscript 应被移除');
});

test('移除 applet', function() {
  var html = '<applet code="evil.class"></applet><p>ok</p>';
  var result = sanitizeMod.sanitize(html);
  assert(result.html.indexOf('<applet') === -1, 'applet 应被移除');
});

// ── 事件属性 ──
console.log('\n事件属性移除');

test('移除 onclick', function() {
  var html = '<p onclick="alert(1)">点击</p>';
  var result = sanitizeMod.sanitize(html);
  assert(result.html.indexOf('onclick') === -1, 'onclick 应被移除');
  assert(result.html.indexOf('点击') !== -1, '内容应保留');
});

test('移除多种事件属性', function() {
  var html = '<div onmouseover="a()" onmouseout="b()" onload="c()">内容</div>';
  var result = sanitizeMod.sanitize(html);
  assert(result.html.indexOf('onmouseover') === -1, 'onmouseover 应被移除');
  assert(result.html.indexOf('onmouseout') === -1, 'onmouseout 应被移除');
  assert(result.html.indexOf('onload') === -1, 'onload 应被移除');
  assert(result.html.indexOf('内容') !== -1, '内容应保留');
});

test('事件属性用单引号', function() {
  var html = "<p onclick='alert(1)'>文本</p>";
  var result = sanitizeMod.sanitize(html);
  assert(result.html.indexOf('onclick') === -1, '单引号 onclick 应被移除');
});

test('事件属性无引号', function() {
  var html = '<p onclick=alert(1)>文本</p>';
  var result = sanitizeMod.sanitize(html);
  assert(result.html.indexOf('onclick') === -1, '无引号 onclick 应被移除');
});

// ── 危险 URL ──
console.log('\n危险 URL 清洗');

test('移除 javascript: 链接', function() {
  var html = '<a href="javascript:alert(1)">点击</a>';
  var result = sanitizeMod.sanitize(html);
  assert(result.html.indexOf('javascript:') === -1, 'javascript: 应被移除');
  assert(result.removed.some(function(r) { return r.indexOf('dangerous-url') !== -1; }), '应记录 dangerous-url');
});

test('移除 vbscript: 链接', function() {
  var html = '<a href="vbscript:msgbox(1)">点击</a>';
  var result = sanitizeMod.sanitize(html);
  assert(result.html.indexOf('vbscript:') === -1, 'vbscript: 应被移除');
});

test('移除 data:text/html 链接', function() {
  var html = '<a href="data:text/html,<script>alert(1)</script>">点击</a>';
  var result = sanitizeMod.sanitize(html);
  assert(result.html.indexOf('data:text/html') === -1, 'data:text/html 应被移除');
});

test('保留 data:image/ 链接', function() {
  var html = '<img src="data:image/png;base64,iVBORw0KGgo=" alt="img">';
  var result = sanitizeMod.sanitize(html);
  assert(result.html.indexOf('data:image/png') !== -1, 'data:image/ 应保留');
});

test('保留正常 http 链接', function() {
  var html = '<a href="https://example.com">链接</a>';
  var result = sanitizeMod.sanitize(html);
  assert(result.html.indexOf('https://example.com') !== -1, '正常链接应保留');
});

// ── style 清洗 ──
console.log('\nstyle 属性清洗');

test('移除 expression()', function() {
  var html = '<p style="width: expression(alert(1)); color: red;">文本</p>';
  var result = sanitizeMod.sanitize(html);
  assert(result.html.indexOf('expression') === -1, 'expression() 应被移除');
  assert(result.html.indexOf('color: red') !== -1, '安全样式应保留');
});

test('移除 url(javascript:)', function() {
  var html = '<p style="background: url(javascript:alert(1));">文本</p>';
  var result = sanitizeMod.sanitize(html);
  assert(result.html.indexOf('javascript:') === -1, 'url(javascript:) 应被移除');
});

// ── meta refresh ──
console.log('\nmeta refresh 移除');

test('移除 meta refresh', function() {
  var html = '<meta http-equiv="refresh" content="0;url=evil.com"><p>ok</p>';
  var result = sanitizeMod.sanitize(html);
  assert(result.html.indexOf('refresh') === -1, 'meta refresh 应被移除');
  assert(result.removed.indexOf('meta-refresh') !== -1, '应记录 meta-refresh');
});

// ── IE 条件注释 ──
console.log('\nIE 条件注释移除');

test('移除 IE 条件注释', function() {
  var html = '<!--[if IE]><script>alert(1)</script><![endif]--><p>ok</p>';
  var result = sanitizeMod.sanitize(html);
  assert(result.html.indexOf('[if IE]') === -1, 'IE 条件注释应被移除');
  assert(result.html.indexOf('alert') === -1, '条件注释内的 script 应被移除');
});

// ── 安全内容保留 ──
console.log('\n安全内容保留');

test('安全 HTML 不受影响', function() {
  var html = '<h1>标题</h1><p>段落</p><ul><li>项</li></ul>';
  var result = sanitizeMod.sanitize(html);
  assert(result.html.indexOf('<h1>') !== -1, 'h1 应保留');
  assert(result.html.indexOf('<p>') !== -1, 'p 应保留');
  assert(result.html.indexOf('<ul>') !== -1, 'ul 应保留');
  assert(result.removed.length === 0, '无移除记录');
});

test('class 和 id 属性保留', function() {
  var html = '<div class="container" id="main">内容</div>';
  var result = sanitizeMod.sanitize(html);
  assert(result.html.indexOf('class="container"') !== -1, 'class 应保留');
  assert(result.html.indexOf('id="main"') !== -1, 'id 应保留');
});

test('style 属性中的安全值保留', function() {
  var html = '<p style="color: blue; font-size: 16px;">文本</p>';
  var result = sanitizeMod.sanitize(html);
  assert(result.html.indexOf('color: blue') !== -1, '安全 color 应保留');
  assert(result.html.indexOf('font-size: 16px') !== -1, '安全 font-size 应保留');
});

// ── checkSafety ──
console.log('\ncheckSafety 检测');

test('检测 script 威胁', function() {
  var check = sanitizeMod.checkSafety('<script>alert(1)</script>');
  assert(check.isDangerous === true, '应检测为危险');
  assert(check.threats.indexOf('script') !== -1, '应检测 script');
});

test('检测事件处理器威胁', function() {
  var check = sanitizeMod.checkSafety('<p onclick="a()">文本</p>');
  assert(check.isDangerous === true, '应检测为危险');
  assert(check.threats.indexOf('event-handler') !== -1, '应检测 event-handler');
});

test('安全内容不报警', function() {
  var check = sanitizeMod.checkSafety('<p>安全文本</p>');
  assert(check.isDangerous === false, '应检测为安全');
  assert(check.threats.length === 0, '无威胁');
});

test('检测多种威胁', function() {
  var html = '<script>a()</script><iframe src="x"></iframe><p onclick="b()">c</p>';
  var check = sanitizeMod.checkSafety(html);
  assert(check.isDangerous === true, '应检测为危险');
  assert(check.threats.length >= 3, '应检测 3+ 种威胁, 实际: ' + check.threats.length);
});

// ── 综合测试 ──
console.log('\n综合测试');

test('复杂恶意文档全部清洗', function() {
  var html = [
    '<!DOCTYPE html>',
    '<html><head>',
    '<meta http-equiv="refresh" content="0;url=evil.com">',
    '<link rel="stylesheet" href="evil.css">',
    '<base href="evil.com/">',
    '<script src="track.js"></script>',
    '</head><body>',
    '<iframe src="evil.com" style="display:none"></iframe>',
    '<div onclick="steal()" onmouseover="track()">',
    '<a href="javascript:alert(1)">点击</a>',
    '<img src="x" onerror="alert(1)">',
    '</div>',
    '<p>正常内容</p>',
    '</body></html>'
  ].join('');
  var result = sanitizeMod.sanitize(html);
  assert(result.html.indexOf('<script') === -1, 'script 应被移除');
  assert(result.html.indexOf('<iframe') === -1, 'iframe 应被移除');
  assert(result.html.indexOf('<base') === -1, 'base 应被移除');
  assert(result.html.indexOf('<link') === -1, 'link 应被移除');
  assert(result.html.indexOf('refresh') === -1, 'meta refresh 应被移除');
  assert(result.html.indexOf('onclick') === -1, 'onclick 应被移除');
  assert(result.html.indexOf('onmouseover') === -1, 'onmouseover 应被移除');
  assert(result.html.indexOf('onerror') === -1, 'onerror 应被移除');
  assert(result.html.indexOf('javascript:') === -1, 'javascript: 应被移除');
  assert(result.html.indexOf('正常内容') !== -1, '安全内容应保留');
  assert(result.removed.length >= 5, '应有 5+ 移除记录, 实际: ' + result.removed.length);
});

test('空输入安全处理', function() {
  var result = sanitizeMod.sanitize('');
  assert(result.html === '', '空输入返回空');
  assert(result.removed.length === 0, '无移除记录');
});

test('纯文本安全处理', function() {
  var result = sanitizeMod.sanitize('这是纯文本，没有 HTML 标签');
  assert(result.html.indexOf('纯文本') !== -1, '纯文本应保留');
  assert(result.removed.length === 0, '无移除记录');
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
