/**
 * tests/test-page-wiring.js — 页面装配静态检查
 *
 * 白屏 / 点了没反应 这两类故障，绝大多数不是逻辑写错，而是"接线"断了：
 * WXML 里绑的方法 JS 里没有、用到的数据字段 data 里没声明、
 * app.json 里的页面文件缺失。这些在 Node 里就能查出来，
 * 不必等真机复现——而真机复现一次的代价是几分钟。
 *
 * 直接跑：node tests/test-page-wiring.js
 */

'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..', 'miniprogram');

var pass = 0;
var fail = 0;

function ok(label, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + label); return; }
  fail++;
  console.log('  ✗ ' + label + (detail !== undefined ? ' — ' + detail : ''));
}

function read(p) {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null;
}

// ─── app.json 完整性 ───

console.log('\napp.json');

var appJsonRaw = read(path.join(ROOT, 'app.json'));
ok('app.json 存在', appJsonRaw !== null);

var appJson = {};
try {
  appJson = JSON.parse(appJsonRaw);
  pass++; console.log('  ✓ app.json 是合法 JSON');
} catch (e) {
  fail++; console.log('  ✗ app.json 不是合法 JSON — ' + e.message);
}

var pages = appJson.pages || [];
ok('声明了页面', pages.length > 0);

pages.forEach(function (p) {
  ['js', 'wxml', 'json'].forEach(function (ext) {
    var f = path.join(ROOT, p + '.' + ext);
    ok('存在 ' + p + '.' + ext, fs.existsSync(f));
  });
});

(appJson.subPackages || []).forEach(function (sp) {
  (sp.pages || []).forEach(function (p) {
    var base = path.join(ROOT, sp.root, p);
    ok('分包页面存在 ' + sp.root + '/' + p, fs.existsSync(base + '.js'));
  });
});

// supportedMaterials.path 必须是已声明的页面，否则真机启动会因配置非法白屏
(appJson.supportedMaterials || []).forEach(function (m, i) {
  ok('supportedMaterials[' + i + '].path 指向已声明页面',
    pages.indexOf(m.path) >= 0,
    JSON.stringify(m.path) + ' 不在 pages 中');
  ok('supportedMaterials[' + i + '].name 含 ${nickname}',
    String(m.name || '').indexOf('${nickname}') >= 0, m.name);
  ok('supportedMaterials[' + i + '].desc ≤ 22 字',
    String(m.desc || '').length <= 22, String(m.desc || '').length + ' 字');
});

if (appJson.sitemapLocation) {
  ok('sitemap 文件存在', fs.existsSync(path.join(ROOT, appJson.sitemapLocation)));
}

if (appJson.workers) {
  ok('workers 目录存在', fs.existsSync(path.join(ROOT, appJson.workers)));
}

// ─── WXML ↔ JS 接线 ───

console.log('\nWXML ↔ JS 接线');

// 事件绑定：bindtap / catchtap / bindinput / bindconfirm / binderror / bindload ...
var BIND_RE = /\b(?:bind|catch|capture-bind|capture-catch):?([a-zA-Z]+)\s*=\s*"([^"{}]+)"/g;
// {{ }} 里出现的顶层标识符
var MUSTACHE_RE = /\{\{([^}]*)\}\}/g;

// WXML 内置的、不需要在 data 里声明的标识符
var BUILTIN = {
  'true': 1, 'false': 1, 'null': 1, 'undefined': 1,
  'item': 1, 'index': 1
};

/**
 * 收集 WXML 里的局部作用域名字：
 * wx:for-item / wx:for-index 起的别名、以及 <template> 通过 data 传进去的字段。
 * 这些不该要求在 data 里声明。
 */
function localScopeNames(wxml) {
  var names = {};
  var re = /wx:for-(?:item|index)\s*=\s*"([^"]+)"/g;
  var m;
  while ((m = re.exec(wxml)) !== null) names[m[1].trim()] = 1;

  // <template is="x" data="{{...a, b: c}}"> 里冒号左边的名字是模板内的作用域
  var tpl = /<template\b[^>]*\bdata\s*=\s*"\{\{([^"]*)\}\}"/g;
  while ((m = tpl.exec(wxml)) !== null) {
    var inner = m[1];
    var kv = /([a-zA-Z_$][\w$]*)\s*:/g;
    var k;
    while ((k = kv.exec(inner)) !== null) names[k[1]] = 1;
    // {{...obj}} 展开进模板的字段无法静态得知，退一步：模板内引用一律放行
    var spread = /\.\.\.\s*([a-zA-Z_$][\w$.]*)/g;
    while ((k = spread.exec(inner)) !== null) names['*spread*'] = 1;
  }

  // <template name="x"> 定义体内用到的名字来自调用方传入的 data，无法静态校验
  var def = /<template\b[^>]*\bname\s*=\s*"[^"]*"[\s\S]*?<\/template>/g;
  while ((m = def.exec(wxml)) !== null) {
    var idRe = /([a-zA-Z_$][\w$]*)/g;
    var id;
    while ((id = idRe.exec(m[0])) !== null) names[id[1]] = 1;
  }
  return names;
}

pages.forEach(function (p) {
  var wxml = read(path.join(ROOT, p + '.wxml'));
  var js = read(path.join(ROOT, p + '.js'));
  if (!wxml || !js) return;

  var name = p.split('/').pop();

  // 1) 每个绑定的方法都必须在 JS 里定义
  var handlers = {};
  var m;
  BIND_RE.lastIndex = 0;
  while ((m = BIND_RE.exec(wxml)) !== null) {
    handlers[m[2].trim()] = true;
  }
  var missing = Object.keys(handlers).filter(function (h) {
    // 匹配 `h: function(` / `h(` / `h: (` 三种写法
    var re = new RegExp('(^|[\\s,{])' + h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
      '\\s*[:(]', 'm');
    return !re.test(js);
  });
  ok(name + '：所有事件处理函数都已定义',
    missing.length === 0, '缺少 ' + JSON.stringify(missing));

  // 2) wx:for 的列表、wx:if 的条件等引用的顶层字段应在 data 里声明
  var dataBlock = /data\s*:\s*\{([\s\S]*?)\n  \}/.exec(js);
  if (dataBlock) {
    var declared = {};
    var keyRe = /^\s{4}([a-zA-Z_$][\w$]*)\s*:/gm;
    var k;
    while ((k = keyRe.exec(dataBlock[1])) !== null) declared[k[1]] = true;

    var referenced = {};
    MUSTACHE_RE.lastIndex = 0;
    while ((m = MUSTACHE_RE.exec(wxml)) !== null) {
      var expr = m[1];
      // 去掉字符串字面量，避免把 {{"\n"}} 里的内容当成标识符
      expr = expr.replace(/'[^']*'|"[^"]*"/g, ' ');
      var idRe = /([a-zA-Z_$][\w$]*)/g;
      var id;
      while ((id = idRe.exec(expr)) !== null) {
        var before = expr[id.index - 1];
        if (before === '.') continue;           // 属性访问
        referenced[id[1]] = true;
      }
    }

    var locals = localScopeNames(wxml);
    var undeclared = Object.keys(referenced).filter(function (r) {
      return !BUILTIN[r] && !declared[r] && !handlers[r] && !locals[r];
    });
    ok(name + '：WXML 引用的数据字段都已在 data 中声明',
      undeclared.length === 0, '未声明 ' + JSON.stringify(undeclared));
  }
});

// ─── WXML 里的字符写法 ───

console.log('\nWXML 字符写法');

/**
 * WXML 不解码 &#xNNNN; 这类数字字符引用，也不处理 text 节点里的 \uXXXX / \n ——
 * 一律原样当文本渲染。写了就是在界面上直接露出 "&#x1F4AC;" "•" 这种原文。
 * 唯一可靠的写法是直接写字面字符（wxml 文件本身就是 UTF-8）。
 */
var charRefs = [];
var escapeLiterals = [];
function scanChars(dir) {
  fs.readdirSync(dir).forEach(function (f) {
    var full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) return scanChars(full);
    if (!/\.wxml$/.test(f)) return;
    var src = read(full) || '';
    var rel = path.relative(ROOT, full);

    var m;
    var refRe = /&#x?[0-9a-fA-F]+;/g;
    while ((m = refRe.exec(src)) !== null) charRefs.push(rel + ' → ' + m[0]);

    // 去掉 {{ }} 绑定表达式后，剩下的是纯文本节点；
    // 那里出现的 \uXXXX / \n 都是字面反斜杠，不是转义
    var textOnly = src.replace(/\{\{[^}]*\}\}/g, ' ');
    var escRe = /\\(u[0-9a-fA-F]{4}|n|t)/g;
    while ((m = escRe.exec(textOnly)) !== null) {
      escapeLiterals.push(rel + ' → ' + m[0]);
    }
  });
}
scanChars(ROOT);

ok('WXML 里没有 &#...; 数字字符引用（会原样显示）',
  charRefs.length === 0,
  charRefs.length + ' 处：' + charRefs.slice(0, 4).join(', '));

ok('WXML 文本节点里没有 \\uXXXX / \\n 字面转义（会原样显示）',
  escapeLiterals.length === 0,
  escapeLiterals.length + ' 处：' + escapeLiterals.slice(0, 4).join(', '));

// ─── 图标字符 ───

console.log('\n图标字符');

// 私有使用区（U+E000–U+F8FF）需要自带字体，项目里没有 @font-face 就渲染成空白/豆腐
var hasFontFace = false;
function walk(dir) {
  fs.readdirSync(dir).forEach(function (f) {
    var full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) return walk(full);
    if (/\.wxss$/.test(f) && /@font-face/.test(read(full) || '')) hasFontFace = true;
  });
}
walk(ROOT);

var puaOffenders = [];
function scanWxml(dir) {
  fs.readdirSync(dir).forEach(function (f) {
    var full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) return scanWxml(full);
    if (!/\.wxml$/.test(f)) return;
    var src = read(full) || '';
    var re = /&#x(e[0-9a-f]{3}|f[0-8][0-9a-f]{2});/gi;
    var hit;
    while ((hit = re.exec(src)) !== null) {
      puaOffenders.push(path.relative(ROOT, full) + ' → &#x' + hit[1] + ';');
    }
  });
}
scanWxml(ROOT);

ok('没有在缺字体的情况下使用私有区图标字符',
  hasFontFace || puaOffenders.length === 0,
  puaOffenders.length + ' 处：' + puaOffenders.slice(0, 5).join(', '));

// ─── 主题选择器 ───

console.log('\n主题');

var appWxss = read(path.join(ROOT, 'app.wxss')) || '';
// 注释里会提到这个反例，先去掉注释再查
var appWxssCode = appWxss.replace(/\/\*[\s\S]*?\*\//g, ' ');
// 主题 class 是 setData 到页面里的子 view 上的，
// 写成 `page.theme-x` 永远匹配不上（page 指的是页面根元素本身）
ok('主题选择器不是 page.theme-*（那样永远匹配不上）',
  !/\bpage\.theme-/.test(appWxssCode));
['theme-dark', 'theme-sepia'].forEach(function (t) {
  ok('定义了 .' + t, new RegExp('\\.' + t + '\\s*\\{').test(appWxss));
});

// ─── 全屏 flex 布局 ───

console.log('\n全屏布局');

// `flex:1; height:0` 的滚动容器，要求父级高度是确定值。
// 父级只有 min-height 时，部分 WebView 会把它算成 0 高 —— 正文整块不显示。
['pages/index/index', 'pages/reader/reader'].forEach(function (p) {
  var wxss = read(path.join(ROOT, p + '.wxss')) || '';
  var pageRule = /\.page\s*\{([^}]*)\}/.exec(wxss);
  if (!pageRule) return;
  var body = pageRule[1];
  var isFlexColumn = /display\s*:\s*flex/.test(body);
  if (!isFlexColumn) return;
  ok(p.split('/').pop() + '：.page 有确定高度而非仅 min-height',
    /(^|[;\s])height\s*:\s*100vh/.test(body),
    body.replace(/\s+/g, ' ').trim());
});

// ─── 现代语法 ───

console.log('\n运行时语法');

var risky = [];
function scanJs(dir) {
  fs.readdirSync(dir).forEach(function (f) {
    var full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) return scanJs(full);
    if (!/\.js$/.test(f)) return;
    var src = read(full) || '';
    // 去掉注释和字符串，避免误报
    var code = src.replace(/\/\*[\s\S]*?\*\//g, ' ')
                  .replace(/\/\/[^\n]*/g, ' ')
                  .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, "''");
    if (/\?\./.test(code)) risky.push(path.relative(ROOT, full) + ' 可选链 ?.');
    if (/\?\?/.test(code)) risky.push(path.relative(ROOT, full) + ' 空值合并 ??');
    if (/\{\s*\.\.\.[a-zA-Z_$]/.test(code)) risky.push(path.relative(ROOT, full) + ' 对象展开');
  });
}
scanJs(ROOT);

ok('没有使用需要转译的新语法（可选链 / 空值合并 / 对象展开）',
  risky.length === 0, risky.join('; '));

// ─── 汇总 ───

console.log('\n' + '='.repeat(40));
console.log('通过: ' + pass + ' | 失败: ' + fail);
if (fail > 0) process.exitCode = 1;
else console.log('全部通过！');
