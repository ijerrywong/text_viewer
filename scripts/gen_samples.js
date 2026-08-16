#!/usr/bin/env node
/**
 * scripts/gen_samples.js — 把 samples/ 下的示例文档打成一个 JS 模块
 *
 * 为什么要生成而不是直接读文件：
 * 小程序运行时读不到代码包里的 .md/.html/.txt 资源文件，
 * 只能 require JS 模块。但示例文档本身是给人编辑的（提审时审核员看的就是它，
 * F7 是 P0 门禁），所以源文件留在 samples/ 里保持可读可改，
 * 由本脚本生成 miniprogram/assets/samples.js。
 *
 * 改完 samples/ 下的文件后跑：node scripts/gen_samples.js
 */

'use strict';

var fs = require('fs');
var path = require('path');

var SRC = path.join(__dirname, '..', 'samples');
var OUT = path.join(__dirname, '..', 'miniprogram', 'assets', 'samples.js');

var FILES = [
  { key: 'sample.md', label: 'Markdown 示例', format: 'markdown' },
  { key: 'sample.html', label: 'HTML 示例', format: 'html' },
  { key: 'sample.txt', label: 'TXT 示例', format: 'txt' }
];

var entries = FILES.map(function (f) {
  var content = fs.readFileSync(path.join(SRC, f.key), 'utf-8');
  return '  ' + JSON.stringify(f.key) + ': {\n' +
    '    label: ' + JSON.stringify(f.label) + ',\n' +
    '    format: ' + JSON.stringify(f.format) + ',\n' +
    '    text: ' + JSON.stringify(content) + '\n' +
    '  }';
});

var body = '/**\n' +
  ' * miniprogram/assets/samples.js\n' +
  ' * 由 scripts/gen_samples.js 从 samples/ 生成，请勿直接编辑。\n' +
  ' *\n' +
  ' * 内置示例文档是提审的 P0 门禁（Edge F7）：\n' +
  ' * 审核员的微信里没有可选文件，没有示例就无法测试，会被直接驳回。\n' +
  ' */\n\n' +
  'module.exports = {\n' + entries.join(',\n') + '\n};\n';

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, body, 'utf-8');

console.log('wrote ' + path.relative(process.cwd(), OUT) +
  ' — ' + FILES.length + ' samples, ' +
  (fs.statSync(OUT).size / 1024).toFixed(1) + ' KB');
