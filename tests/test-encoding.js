/**
 * tests/test-encoding.js — 编码解码器 + 编码识别测试
 *
 * 语料 tests/fixtures/encoding-cases.json 由 Python 官方 codec 生成
 * （见 scripts/gen_encoding_tables.py 的思路），因此这里是与权威实现对拍，
 * 不是自证。重新生成语料请看文件末尾的说明。
 *
 * 直接跑：node tests/test-encoding.js
 */

'use strict';

var fs = require('fs');
var path = require('path');
var decoder = require('../miniprogram/core/encoding/decoder.js');
var detect = require('../miniprogram/core/detect/index.js');

var pass = 0;
var fail = 0;

function ok(label, cond, detail) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log('  ✗ ' + label + (detail ? ' — ' + detail : ''));
    return;
  }
  console.log('  ✓ ' + label);
}

function eq(label, actual, expected) {
  if (actual === expected) {
    pass++;
    console.log('  ✓ ' + label);
    return;
  }
  fail++;
  // 找第一个不同的位置，便于定位
  var at = -1;
  var n = Math.min(actual.length, expected.length);
  for (var i = 0; i < n; i++) {
    if (actual[i] !== expected[i]) { at = i; break; }
  }
  if (at < 0) at = n;
  console.log('  ✗ ' + label +
    ' — 长度 ' + actual.length + ' vs ' + expected.length +
    '，首个差异 @' + at +
    ' 得到 ' + JSON.stringify(actual.slice(at, at + 8)) +
    ' 期望 ' + JSON.stringify(expected.slice(at, at + 8)));
}

// ─── 与 Python 官方 codec 对拍 ───

console.log('\n与官方 codec 对拍（tests/fixtures/encoding-cases.json）');

var fixturePath = path.join(__dirname, 'fixtures', 'encoding-cases.json');
if (!fs.existsSync(fixturePath)) {
  console.log('  ! 语料缺失，跳过对拍。重新生成见文件末尾说明。');
} else {
  var cases = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
  var ENC_MAP = {
    'gb18030': 'GB18030',
    'big5': 'Big5',
    'utf-16-le': 'UTF-16LE',
    'utf-16-be': 'UTF-16BE',
    'utf-8': 'UTF-8'
  };
  cases.forEach(function (c) {
    var bytes = new Uint8Array(c.bytes);
    var bom = detect.detectBOM(bytes);
    var text = decoder.decode(bytes, ENC_MAP[c.encoding], bom.bomLength);
    // 带 BOM 的 UTF-8 语料，期望值本身不含 BOM
    eq(c.name, text, c.text);
  });
}

// ─── 回归：曾经真实存在的缺陷 ───

console.log('\n回归用例');

// 纯 ASCII 大文件：String.fromCharCode.apply 实参上限导致爆栈
var bigAscii = new Uint8Array(3 * 1000 * 1000);
bigAscii.fill(0x61);
var decodedBig;
var threw = null;
try {
  decodedBig = decoder.decodeUtf8(bigAscii);
} catch (e) {
  threw = e;
}
ok('3MB 纯 ASCII 不爆栈', threw === null, threw && threw.message);
ok('3MB 纯 ASCII 长度正确', decodedBig && decodedBig.length === 3000000);

// UTF-16 BOM 多吞一个码元
var le = new Uint8Array([0xFF, 0xFE, 0x2D, 0x4E, 0x87, 0x65]); // BOM + 中文
eq('UTF-16LE 不丢首字符', decoder.decode(le, 'UTF-16LE', 2), '中文');
var be = new Uint8Array([0xFE, 0xFF, 0x4E, 0x2D, 0x65, 0x87]);
eq('UTF-16BE 不丢首字符', decoder.decode(be, 'UTF-16BE', 2), '中文');

// GB18030 四字节
eq('GB18030 补充平面（emoji）', decoder.decodeGb18030(new Uint8Array([0x94, 0x39, 0xFC, 0x36])), '😀');
eq("GB18030 四字节 BMP（U+00A5）", decoder.decodeGb18030(new Uint8Array([0x81, 0x30, 0x84, 0x36])), "¥");
eq('GB18030 四字节 BMP（U+0452）', decoder.decodeGb18030(new Uint8Array([0x81, 0x30, 0xD3, 0x30])), 'ђ');
eq('GB18030 双字节', decoder.decodeGb18030(new Uint8Array([0xD6, 0xD0, 0xCE, 0xC4])), '中文');

// 截断字节不崩溃
ok('GB18030 尾部截断不崩溃', typeof decoder.decodeGb18030(new Uint8Array([0xD6])) === 'string');
ok('Big5 尾部截断不崩溃', typeof decoder.decodeBig5(new Uint8Array([0xA4])) === 'string');
ok('UTF-8 尾部截断不崩溃', typeof decoder.decodeUtf8(new Uint8Array([0xE4, 0xB8])) === 'string');
ok('UTF-16 奇数字节不崩溃', typeof decoder.decodeUtf16LE(new Uint8Array([0x2D, 0x4E, 0x87])) === 'string');
eq('空输入', decoder.decode(new Uint8Array(0), 'GB18030', 0), '');

// ─── 编码识别 ───

console.log('\n编码识别');

function bytesOf(str, enc) {
  var b = Buffer.from(str, enc);
  return new Uint8Array(b);
}

eq('BOM: UTF-8', detect.detectBOM(new Uint8Array([0xEF, 0xBB, 0xBF, 0x61])).encoding, 'UTF-8');
eq('BOM: UTF-16LE', detect.detectBOM(new Uint8Array([0xFF, 0xFE, 0x61, 0x00])).encoding, 'UTF-16LE');
eq('BOM: UTF-16BE', detect.detectBOM(new Uint8Array([0xFE, 0xFF, 0x00, 0x61])).encoding, 'UTF-16BE');
ok('无 BOM', detect.detectBOM(new Uint8Array([0x61, 0x62])).encoding === null);

eq('识别 UTF-8 中文', detect.detectEncodingDetailed(bytesOf('这是一段中文测试文本，用于验证编码识别。', 'utf-8')).encoding, 'UTF-8');
eq('识别纯 ASCII', detect.detectEncodingDetailed(bytesOf('plain ascii text', 'utf-8')).encoding, 'UTF-8');

if (fs.existsSync(fixturePath)) {
  var all = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
  var gbCase = all.filter(function (c) { return c.name === 'gb18030-2byte-sample'; })[0];
  var bigCase = all.filter(function (c) { return c.name === 'big5-full'; })[0];
  if (gbCase) {
    eq('识别 GB18030', detect.detectEncodingDetailed(new Uint8Array(gbCase.bytes)).encoding, 'GB18030');
  }
  if (bigCase) {
    var r = detect.detectEncodingDetailed(new Uint8Array(bigCase.bytes));
    // Big5 与 GBK 字节范围高度重叠，允许落到 GB18030（用户可手动切换兜底）
    ok('识别 Big5 或退回 GB18030', r.encoding === 'Big5' || r.encoding === 'GB18030', r.encoding);
  }
}

eq('meta charset gbk', detect.detectMetaCharset('<meta charset="gbk">'), 'GB18030');
eq('meta charset http-equiv', detect.detectMetaCharset('<meta http-equiv="Content-Type" content="text/html; charset=big5">'), 'Big5');
ok('无 meta charset', detect.detectMetaCharset('<html><body>hi') === null);

// 二进制检测
var bin = new Uint8Array(1000);
for (var bi = 0; bi < 1000; bi += 3) bin[bi] = 0;
ok('二进制检出', detect.isBinary(bin) === true);
ok('文本不误判为二进制', detect.isBinary(bytesOf('normal text 中文', 'utf-8')) === false);

// ─── 汇总 ───

console.log('\n' + '='.repeat(40));
console.log('通过: ' + pass + ' | 失败: ' + fail);
if (fail > 0) {
  process.exitCode = 1;
} else {
  console.log('全部通过！');
}

/*
 * 重新生成语料（需要 python3）：
 *   python3 scripts/gen_encoding_fixtures.py
 */
