/**
 * core/tokens/limits.js — 工程限额的**唯一真源**
 *
 * 为什么要有这个文件：
 * AGENTS.md §2.4 / §2.6 定下的那些硬约束（节点数上限、嵌套深度、文件大小档位…）
 * 原先在代码里有多个平行的定义处 —— 光 `MAX_BLOCKS = 50000` 就在 5 个文件里
 * 各写了一遍，其中一处还是裸字面量。调一次阈值要改 5 个地方，漏一个就出现
 * 「A 解析器截断了、B 解析器没截断」这种只在特定格式下复现的怪行为。
 *
 * 现在这里是唯一定义处。改阈值只改这里。
 *
 * ⚠️ 纯数据模块：不依赖任何 wx API，Node 里可直接 require，Worker 里也能跑。
 *
 * ⚠️ 一个物理例外：`workers/parser.js` 无法 require 本文件 ——
 * Worker 代码包是独立打包的，只能引用 `workers/` 目录内的文件。
 * 那里的 BATCH_SIZE 只能手工与 `IR_BATCH_SIZE` 保持一致，已在该文件注明。
 */

// ══════════════════════════════════════════════
// 1. 防解析炸弹（AGENTS §2.4）
// ══════════════════════════════════════════════

// 块数上限，超出即截断并向用户明示。
// 消费方：parse/index.js、parse/md/block.js、parse/html/converter.js、
//         parse/html/postprocess.js
var MAX_BLOCKS = 50000;

// HTML DOM 节点数上限。与 MAX_BLOCKS 同量级但语义不同 ——
// 一个 DOM 节点未必产出一个块，这两个数字各自独立可调。
var MAX_NODES = 50000;

// HTML 嵌套深度上限。递归下降解析器的栈保护。
var MAX_DEPTH = 100;

// Markdown 列表嵌套深度上限（C6）
var MAX_LIST_DEPTH = 10;

// 单行字符上限（B13：minified JSON/HTML 一行几 MB，
// 行级正则和 setData 会双双爆炸）
var MAX_LINE_CHARS = 20000;

// 单块字符上限（防止一个巨块把 setData 撑爆）
var MAX_BLOCK_CHARS = 100000;

// 目录条目上限（TXT 启发式标题可能爆量）
var MAX_TOC = 2000;

// HTML 正文总字符上限
var MAX_TOTAL_TEXT = 5 * 1024 * 1024;

// 单文档抽取图片数上限
var MAX_IMAGES = 1000;

// ══════════════════════════════════════════════
// 2. 文件大小档位（AGENTS §2.6）
// ══════════════════════════════════════════════

// 超过这个大小走"纯文本分页"降级，不整份读进内存
var HUGE_FILE_BYTES = 50 * 1024 * 1024;

// 超过这个大小先给用户一个明确提示，而不是闷头卡住
var LARGE_FILE_BYTES = 10 * 1024 * 1024;

// 巨型文件降级模式下实际读取的字节数
var DEGRADED_READ_BYTES = 4 * 1024 * 1024;

// base64 图片抽取阈值：大于此值的 data URI 才落盘，
// 小图留在 IR 里反而更省一次文件读写
var BASE64_EXTRACT_THRESHOLD = 4096;

// 格式嗅探时愿意真的 JSON.parse 一遍的内容上限。
// 调用方一般只传前 2KB，但万一有人传了整份 10MB 文档进来，
// 这里挡住那次白白解析
var JSON_SNIFF_MAX_BYTES = 64 * 1024;

// ══════════════════════════════════════════════
// 3. 存储配额（AGENTS §2.3）
// ══════════════════════════════════════════════

// 最近文件列表长度（环形）
var MAX_RECENT = 50;

/**
 * LRU 清理阈值。
 *
 * ⚠️ 官方口径：**本地缓存文件与本地用户文件加起来，每个小程序共 200MB**。
 * 也就是说 200MB 是**平台配额本身**，不是我们可以用到的量。
 *
 * 原先把阈值直接设成 200MB，等于宣布「永远不清理」：
 * 真正先撞墙的一定是 copyFile 写失败（配额里还躺着微信自己的缓存文件），
 * LRU 这条主动防线从来没有机会生效，只剩 intake 里那个写失败后的补救路径。
 * 而那条路径要先失败一次、清一次、再重试一次，用户实打实地多等一轮。
 *
 * 压到 120MB 留出足够余量，让清理发生在写入之前而不是之后。
 */
var CACHE_THRESHOLD = 120 * 1024 * 1024;

// KV 存储告警线（官方上限 10MB/用户/小程序）
var KV_WARN_THRESHOLD = 8 * 1024 * 1024;

// ══════════════════════════════════════════════
// 4. 分批下发（AGENTS §2.3 setData 单次实践控制在 64KB）
// ══════════════════════════════════════════════

// Worker → 主线程每批回传的 Block 数。
// ⚠️ workers/parser.js 里有一份手工同步的副本，见文件头说明。
var IR_BATCH_SIZE = 50;

// 代码/纯文本按行分块解析时每块的行数
var LINE_CHUNK_SIZE = 50;

module.exports = {
  MAX_BLOCKS: MAX_BLOCKS,
  MAX_NODES: MAX_NODES,
  MAX_DEPTH: MAX_DEPTH,
  MAX_LIST_DEPTH: MAX_LIST_DEPTH,
  MAX_LINE_CHARS: MAX_LINE_CHARS,
  MAX_BLOCK_CHARS: MAX_BLOCK_CHARS,
  MAX_TOC: MAX_TOC,
  MAX_TOTAL_TEXT: MAX_TOTAL_TEXT,
  MAX_IMAGES: MAX_IMAGES,
  HUGE_FILE_BYTES: HUGE_FILE_BYTES,
  LARGE_FILE_BYTES: LARGE_FILE_BYTES,
  DEGRADED_READ_BYTES: DEGRADED_READ_BYTES,
  BASE64_EXTRACT_THRESHOLD: BASE64_EXTRACT_THRESHOLD,
  JSON_SNIFF_MAX_BYTES: JSON_SNIFF_MAX_BYTES,
  MAX_RECENT: MAX_RECENT,
  CACHE_THRESHOLD: CACHE_THRESHOLD,
  KV_WARN_THRESHOLD: KV_WARN_THRESHOLD,
  IR_BATCH_SIZE: IR_BATCH_SIZE,
  LINE_CHUNK_SIZE: LINE_CHUNK_SIZE
};
