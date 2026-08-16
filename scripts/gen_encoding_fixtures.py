#!/usr/bin/env python3
"""
Generate tests/fixtures/encoding-cases.json.

Each case is (bytes, expected text) produced by Python's own codecs, so
tests/test-encoding.js compares our hand-written decoders against an
authoritative implementation rather than against themselves.

Run:  python3 scripts/gen_encoding_fixtures.py
"""

import json
import os
import random

random.seed(42)

OUT = os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures',
                   'encoding-cases.json')

cases = []


def add(name, encoding, text, raw=None):
    cases.append({
        'name': name,
        'encoding': encoding,
        'text': text,
        'bytes': list(raw if raw is not None else text.encode(encoding)),
    })


def two_byte_chars(codec, lead_range, trail_ranges):
    out = []
    for b1 in lead_range:
        for b2 in trail_ranges:
            try:
                ch = bytes([b1, b2]).decode(codec)
            except (UnicodeDecodeError, ValueError):
                continue
            if len(ch) == 1 and ord(ch) <= 0xFFFF:
                out.append(ch)
    return out


# ── GB18030 ──
gb_trail = list(range(0x40, 0x7F)) + list(range(0x80, 0xFF))
gb_chars = two_byte_chars('gb18030', range(0x81, 0xFF), gb_trail)
add('gb18030-2byte-sample', 'gb18030', ''.join(random.sample(gb_chars, 3000)))

# Every BMP code point that gb18030 encodes as four bytes — this is the region
# the naive "pointer + 0x80" formula got wrong, so sweep all of it.
four_byte_bmp = []
for cp in range(0x80, 0x10000):
    if 0xD800 <= cp <= 0xDFFF:
        continue
    try:
        if len(chr(cp).encode('gb18030')) == 4:
            four_byte_bmp.append(chr(cp))
    except (UnicodeEncodeError, ValueError):
        continue
add('gb18030-4byte-bmp-full', 'gb18030', ''.join(four_byte_bmp))

add('gb18030-supplementary', 'gb18030',
    ''.join(chr(cp) for cp in
            [0x1F600, 0x1F4A9, 0x20000, 0x2A6D6, 0x10000, 0x10FFF, 0x2F81A]))
add('gb18030-mixed', 'gb18030', 'Hello 世界！2024年 ¥100 😀 ђ')

# ── Big5 ──
big5_trail = list(range(0x40, 0x7F)) + list(range(0xA1, 0xFF))
add('big5-full', 'big5',
    ''.join(two_byte_chars('big5', range(0xA1, 0xFA), big5_trail)))
add('big5-mixed', 'big5', 'Big5 繁體中文測試 abc 123')

# ── UTF-16 ──
t16 = '中文 UTF-16 测试 A😀B ђ'
add('utf16le-bom', 'utf-16-le', t16, b'\xff\xfe' + t16.encode('utf-16-le'))
add('utf16be-bom', 'utf-16-be', t16, b'\xfe\xff' + t16.encode('utf-16-be'))

# ── UTF-8 ──
# A long ASCII run: String.fromCharCode.apply blew the stack past ~125k args.
add('utf8-long-ascii-run', 'utf-8', 'UTF-8 中文 😀 ђ ¥ ' + 'a' * 30000)
add('utf8-bom', 'utf-8', '# 标题\n正文',
    b'\xef\xbb\xbf' + '# 标题\n正文'.encode('utf-8'))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(cases, f, ensure_ascii=False)

print('wrote %s — %d cases, %.1f KB'
      % (OUT, len(cases), os.path.getsize(OUT) / 1024))
