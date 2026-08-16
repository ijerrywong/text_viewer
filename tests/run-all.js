#!/usr/bin/env node
/**
 * tests/run-all.js — 跑完整测试套件
 *
 * 解析层是纯函数（不依赖任何 wx API），所以整套可以直接在 Node 里跑，
 * 比每次进小程序开发者工具调试快一个数量级。
 *
 *   node tests/run-all.js
 */

'use strict';

var fs = require('fs');
var path = require('path');
var childProcess = require('child_process');

var dir = __dirname;
var files = fs.readdirSync(dir)
  .filter(function (f) { return /^test-.*\.js$/.test(f); })
  .sort();

var failed = [];
var totals = { pass: 0, fail: 0 };

files.forEach(function (f) {
  var res = childProcess.spawnSync(process.execPath, [path.join(dir, f)], {
    encoding: 'utf-8'
  });
  var out = (res.stdout || '') + (res.stderr || '');
  var m = /通过:\s*(\d+)\s*\|\s*失败:\s*(\d+)/.exec(out);
  var p = m ? parseInt(m[1], 10) : 0;
  var q = m ? parseInt(m[2], 10) : 0;
  totals.pass += p;
  totals.fail += q;

  var bad = res.status !== 0 || q > 0 || !m;
  console.log((bad ? '✗ ' : '✓ ') + f.padEnd(30) +
    (m ? '通过 ' + p + '，失败 ' + q : '未产出结果'));

  if (bad) {
    failed.push(f);
    // 只回显失败明细，成功的噪音不打印
    out.split('\n').filter(function (line) {
      return line.indexOf('✗') >= 0;
    }).forEach(function (line) {
      console.log('    ' + line.trim());
    });
    if (!m && out.trim()) {
      console.log('    ' + out.trim().split('\n').slice(-5).join('\n    '));
    }
  }
});

console.log('\n' + '='.repeat(50));
console.log('合计 通过 ' + totals.pass + '，失败 ' + totals.fail +
  '（' + files.length + ' 个测试文件）');

if (failed.length > 0) {
  console.log('失败文件：' + failed.join(', '));
  process.exit(1);
}
console.log('全部通过');
