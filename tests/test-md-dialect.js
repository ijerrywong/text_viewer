/**
 * tests/test-md-dialect.js — Markdown 方言边界
 *
 * Markdown 没有单一规范，每个实现对歧义写法的消解规则都不同（CommonMark /
 * GFM / Pandoc / Obsidian…）。我们只实现 GFM 子集，纪律写在 AGENTS 里：
 * **不支持的语法降级为纯文本，但内容零丢失**。
 *
 * 所以这份测试分两类断言：
 *   1. 该识别的要识别对（强调、列表、表格、脚注…）；
 *   2. 不支持的写法要**原样留着**——尤其是那些看起来像标记、
 *      其实是内容的字符（snake_case 的下划线、公式里的下标）。
 *      第 2 类才是方言最贵的坑：丢的不是样式，是字符。
 *
 *   node tests/test-md-dialect.js
 */

'use strict';

var path = require('path');
var md = require(path.join(__dirname, '..', 'miniprogram', 'core', 'parse', 'md', 'block.js'));
var inline = require(path.join(__dirname, '..', 'miniprogram', 'core', 'parse', 'md', 'inline.js'));

var pass = 0;
var fail = 0;

function ok(label, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + label); return; }
  fail++;
  console.log('  ✗ ' + label + (detail !== undefined ? ' — ' + detail : ''));
}

function eq(label, actual, expected) {
  ok(label, actual === expected,
    '期望 ' + JSON.stringify(expected) + '，实得 ' + JSON.stringify(actual));
}

function parse(src) { return md.parseMarkdownBlocks(src); }

/** 段落的行内段：把样式压成可读标记，"粗"{B} / "斜"{I} / "删"{S} / "码"{`} */
function segsOf(block) {
  return inline.flattenInline(block.children).map(function (s) {
    var f = '';
    if (s.bold) f += 'B';
    if (s.italic) f += 'I';
    if (s.strike) f += 'S';
    if (s.code) f += '`';
    if (s.href) f += '→';
    return JSON.stringify(s.text) + (f ? '{' + f + '}' : '');
  }).join(' ');
}

/** 一段 Markdown 渲染后，屏幕上出现的字符（用于「零丢失」断言） */
function visibleText(src) {
  return parse(src).blocks.map(function (b) {
    if (b.type === 'table') {
      var cells = [];
      (b.header || []).forEach(function (c) { cells.push(c.text); });
      (b.rows || []).forEach(function (r) { r.forEach(function (c) { cells.push(c.text); }); });
      return cells.join(' ');
    }
    return b.text || '';
  }).join('\n');
}

// ═══ 1. 强调：CommonMark flanking 规则 ═══
//
// 这一组全是「看起来像标记、其实是内容」的写法。
// 判据是字符不能少 —— 样式判错还能忍，字符没了是数据损坏。

console.log('\n强调与 flanking 规则');

var p = parse('调用 some_var_name 方法').blocks[0];
eq('snake_case 的下划线不成强调', segsOf(p), '"调用 some_var_name 方法"');

eq('文件名里的下划线原样保留',
  visibleText('见 my_file_name.md 一节'), '见 my_file_name.md 一节');

eq('多段蛇形命名互不配对',
  visibleText('a_b_c 与 d_e_f'), 'a_b_c 与 d_e_f');

// __init__ 两侧都贴着空白，CommonMark（和 GitHub）都渲染成粗体 —— 不是 bug
p = parse('__init__ 方法').blocks[0];
eq('两侧留空的 __x__ 仍是粗体（与 CommonMark 一致）', segsOf(p), '"init"{B} " 方法"');

p = parse('*斜* 与 **粗** 与 ~~删~~').blocks[0];
eq('基本强调仍然正常', segsOf(p), '"斜"{I} " 与 " "粗"{B} " 与 " "删"{S}');

p = parse('***又粗又斜***').blocks[0];
eq('三重强调 = 粗 + 斜（星号不许泄漏到正文）', segsOf(p), '"又粗又斜"{BI}');

p = parse('中文**重点**，后面').blocks[0];
eq('中文标点旁的强调（CJK 标点参与 flanking 判定）',
  segsOf(p), '"中文" "重点"{B} "，后面"');

eq('单个波浪号不是删除线（~/path 要活下来）',
  visibleText('路径 ~/project 与 ~约等于~'), '路径 ~/project 与 ~约等于~');

p = parse('公式 `a * b * c` 不该被斜体').blocks[0];
eq('行内代码里的星号不参与强调',
  segsOf(p), '"公式 " "a * b * c"{`} " 不该被斜体"');

eq('落单的标记原样显示', visibleText('a * b 与 c ** d'), 'a * b 与 c ** d');

// ═══ 2. 数学公式：不渲染，但必须原样 ═══

console.log('\n数学公式（原样保护）');

eq('行内公式的下标不被吃掉',
  visibleText('当 $x_1 + x_2 = y_1$ 时成立'), '当 $x_1 + x_2 = y_1$ 时成立');

eq('公式里的星号不被当强调',
  visibleText('$a*b*c$ 是乘积'), '$a*b*c$ 是乘积');

eq('块级公式整块保留（含换行与花括号）',
  visibleText('$$\n\\sum_{i=1}^{n} a_i\n$$'), '$$\n\\sum_{i=1}^{n} a_i\n$$');

eq('货币金额不被误认成公式',
  visibleText('从 $5 涨到 $10 了'), '从 $5 涨到 $10 了');

eq('代码段优先于公式',
  segsOf(parse('写作 `$x$` 形式').blocks[0]), '"写作 " "$x$"{`} " 形式"');

// ═══ 3. 列表：有序/无序逐项判定 ═══

console.log('\n列表');

var bs = parse('- 外层\n  1. 内层一\n  2. 内层二').blocks;
ok('无序列表里嵌套有序，序号不丢',
  bs[1].ordered === true && bs[1].ordIndex === 1 &&
  bs[2].ordered === true && bs[2].ordIndex === 2,
  JSON.stringify(bs.map(function (b) { return b.ordered + ':' + b.ordIndex; })));

bs = parse('3. 第三项\n4. 第四项\n   - 子项\n   - 子项2').blocks;
ok('有序列表里嵌套无序，子项不被编号',
  bs[2].ordered === false && bs[3].ordered === false,
  JSON.stringify(bs.map(function (b) { return b.ordered + ':' + b.ordIndex; })));

ok('有序列表认作者写的起始号',
  bs[0].ordIndex === 3 && bs[1].ordIndex === 4,
  bs[0].ordIndex + ',' + bs[1].ordIndex);

bs = parse('1. 一\n1. 二\n1. 三').blocks;
ok('全写 1. 时按顺序递增（与 CommonMark 一致）',
  bs[0].ordIndex === 1 && bs[1].ordIndex === 2 && bs[2].ordIndex === 3,
  JSON.stringify(bs.map(function (b) { return b.ordIndex; })));

bs = parse('- a\n- b\n\n1. x\n2. y').blocks;
ok('无序段落之后另起有序列表，编号从头开始',
  bs[2].ordIndex === 1 && bs[3].ordIndex === 2,
  JSON.stringify(bs.map(function (b) { return b.ordered + ':' + b.ordIndex; })));

bs = parse('- [ ] 待办\n- [x] 已办').blocks;
ok('任务列表',
  bs[0].task === true && bs[0].checked === false && bs[1].checked === true);

bs = parse('- 第一步：\n\n  ```js\n  const a = 1;\n  ```\n\n- 第二步').blocks;
ok('列表项之间的围栏代码块不被吞',
  bs[1].type === 'code' && bs[1].text === 'const a = 1;',
  bs[1].type + ' ' + JSON.stringify(bs[1].text));

eq('4 空格缩进的续行内容不丢失',
  visibleText('- 一项\n  续行内容').indexOf('续行内容') >= 0, true);

// ═══ 4. 不支持的方言：降级但零丢失 ═══

console.log('\n不支持的方言（降级，但内容零丢失）');

// 引用内的软换行按 CommonMark 折成空格，所以是一行 —— 标记与内容都在
eq('GFM 警告块降级为普通引用，标记原样',
  visibleText('> [!NOTE]\n> 提示内容'), '[!NOTE] 提示内容');

eq('Obsidian 双链原样保留', visibleText('见 [[某页面]] 一节'), '见 [[某页面]] 一节');

eq('==高亮== 原样保留', visibleText('这是 ==重点== 内容'), '这是 ==重点== 内容');

eq('HTML 注释原样保留（不静默吃掉）',
  visibleText('<!-- 待补充 -->').indexOf('待补充') >= 0, true);

eq('裸 URL 不成链接但字符完整',
  visibleText('访问 https://example.com 查看'), '访问 https://example.com 查看');

eq('emoji 短码原样保留', visibleText('完成 :tada: 了'), '完成 :tada: 了');

eq('4 空格缩进代码块降级为段落，代码字符不丢',
  visibleText('段落\n\n    const a = 1;\n\n结束').indexOf('const a = 1;') >= 0, true);

// ═══ 5. 已经做对的：加锁防回归 ═══

console.log('\n已支持语法（防回归）');

var r = parse('| 语法 | 说明 |\n|---|---|\n| `a\\|b` | 或 |');
ok('表格：单元格里转义的竖线',
  r.blocks[0].type === 'table' && r.blocks[0].rows[0][0].text === '`a|b`',
  JSON.stringify(r.blocks[0].rows[0][0].text));

r = parse('| 左 | 中 | 右 |\n|:---|:---:|---:|\n| a | b | c |');
eq('表格：对齐方式', r.blocks[0].aligns.join(','), 'left,center,right');

r = parse('正文[^1]引用。\n\n[^1]: 脚注内容');
ok('脚注：引用留在正文，定义归到文末',
  r.blocks[0].text === '正文[1]引用。' &&
  r.blocks[1].type === 'footnote' && r.blocks[1].text === '脚注内容',
  JSON.stringify(r.blocks.map(function (b) { return b.type + ':' + b.text; })));

r = parse('```md\n[foo]: http://example.com\n[^1]: 不是脚注\n```');
ok('围栏代码块里的定义行不被抽走',
  r.blocks[0].type === 'code' &&
  r.blocks[0].text.indexOf('[foo]: http://example.com') >= 0 &&
  r.blocks[0].text.indexOf('[^1]: 不是脚注') >= 0,
  JSON.stringify(r.blocks[0].text));

r = parse('---\ntitle: 标题\nauthor: 某人\n---\n\n正文');
ok('front-matter 被剥离且解析出元数据',
  r.frontMeta && r.frontMeta.title === '标题' && r.blocks[0].text === '正文',
  JSON.stringify(r.frontMeta));

r = parse('标题\n===\n\n副标题\n---');
ok('Setext 标题',
  r.blocks[0].type === 'heading' && r.blocks[0].level === 1 &&
  r.blocks[1].type === 'heading' && r.blocks[1].level === 2,
  JSON.stringify(r.blocks.map(function (b) { return b.type + b.level; })));

r = parse('[链接][ref] 与 ![图][img]\n\n[ref]: http://a.com\n[img]: http://b.com/x.png');
var segs = inline.flattenInline(r.blocks[0].children);
ok('引用式链接与图片',
  segs.some(function (s) { return s.href === 'http://a.com'; }) &&
  segs.some(function (s) { return s.image && s.src === 'http://b.com/x.png'; }),
  JSON.stringify(segs));

r = parse('```js\nconst a = 1;\n没有闭合围栏');
ok('未闭合围栏按 CommonMark 走到文末',
  r.blocks[0].type === 'code' && r.blocks[0].text.indexOf('没有闭合围栏') >= 0);

eq('转义字符：\\* 不成强调', visibleText('a \\* b \\* c'), 'a * b * c');

eq('HTML 实体解码', visibleText('A &amp; B &lt; C'), 'A & B < C');

// ═══ 6. 交错标记：不追 CommonMark 的逐例一致，但守住零丢失 ═══
//
// `*a **b* c**` 这类交错写法本身就是病句，各家实现结果都不一样，
// 我们不保证与 CommonMark 逐字节相同 —— 只保证**非标记字符一个不少**。
// 星号本身作为语法被吃掉可以接受，正文字符被吃掉不行。

console.log('\n交错标记（只保证内容不丢）');

function stripMarks(s) { return s.replace(/[*_~]/g, ''); }

[
  '*a **b* c**',
  '**a *b** c*',
  '*foo**bar*',
  '****',
  '*a*b*c*',
  '**a**b**c**',
  '*未闭合',
  '**半开 *的 组合'
].forEach(function (src) {
  eq('交错标记不吃正文：' + JSON.stringify(src),
    stripMarks(visibleText(src)), stripMarks(src));
});

// 解析炸弹：全是「只能关、配不上」的标记。
// 没有 openers_bottom 记忆时这里是 O(n²)，16000 个 run 要 147ms，
// 再翻几倍就能把 10MB 文档卡死。
var bombStart = Date.now();
var bomb = new Array(20000).join('a* ');
var bombOut = visibleText(bomb);
var bombMs = Date.now() - bombStart;
ok('两万个配不上的标记不退化成二次复杂度（' + bombMs + 'ms）', bombMs < 1000, bombMs + 'ms');
ok('炸弹输入的正文照样一个不少', stripMarks(bombOut) === stripMarks(bomb).trim());

// ═══ 7. 兜底：整份混排文档，字符一个不少 ═══

console.log('\n混排文档的零丢失兜底');

var mixed = [
  '# 标题',
  '',
  '段落里有 some_var_name、公式 $x_1$、`代码`、**粗体**。',
  '',
  '- 无序项',
  '  1. 有序子项',
  '',
  '| a | b |',
  '|---|---|',
  '| 1 | 2 |',
  '',
  '> 引用',
  '',
  '```py',
  'x = 1',
  '```'
].join('\n');

var out = visibleText(mixed);
['some_var_name', '$x_1$', '代码', '粗体', '无序项', '有序子项', '引用', 'x = 1']
  .forEach(function (frag) {
    ok('混排文档里没丢「' + frag + '」', out.indexOf(frag) >= 0);
  });

// ─── 汇总 ───

console.log('\n' + '='.repeat(40));
console.log('通过: ' + pass + ' | 失败: ' + fail);
if (fail > 0) process.exitCode = 1;
else console.log('全部通过！');
