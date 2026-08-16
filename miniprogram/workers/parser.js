/**
 * workers/parser.js - 解析 Worker
 *
 * Phase 2+ 实现：
 * - 接收主线程 postMessage 的文本字符串
 * - 执行纯计算解析（Markdown/HTML/TXT → IR）
 * - 分批回传 IR（每批约 50 个 Block）
 *
 * ⚠️ Worker 内无 wx.getFileSystemManager()，只做纯计算
 * 解析层代码必须是不依赖任何 wx API 的纯函数
 *
 * 数据流：
 * 主线程读文件+解码 → postMessage(字符串) → Worker 解析 → 分批 postMessage(IR)
 */

// Worker 通信
worker.onMessage(function(message) {
  const { type, text, format, jobId } = message;

  if (type === 'parse') {
    try {
      // Phase 2: 引入解析器
      // const { parse } = require('../core/parse/index.js');
      // const result = parse(text, format);

      // Phase 0: 临时占位
      const result = {
        blocks: [{
          type: 'paragraph',
          children: [{ text: 'Worker 解析待 Phase 2 实现' }]
        }],
        toc: [],
        images: [],
        degraded: []
      };

      // 分批回传
      const BATCH_SIZE = 50;
      const total = result.blocks.length;
      const batches = Math.ceil(total / BATCH_SIZE);

      for (let i = 0; i < batches; i++) {
        const start = i * BATCH_SIZE;
        const end = Math.min(start + BATCH_SIZE, total);
        const batch = result.blocks.slice(start, end);

        worker.postMessage({
          type: 'batch',
          jobId,
          batchIndex: i,
          totalBatches: batches,
          blocks: batch,
          isLast: i === batches - 1
        });
      }

      // 回传 TOC 和元数据
      if (result.toc.length > 0) {
        worker.postMessage({
          type: 'toc',
          jobId,
          toc: result.toc
        });
      }
    } catch (err) {
      worker.postMessage({
        type: 'error',
        jobId,
        error: err.message || '解析失败'
      });
    }
  }
});
