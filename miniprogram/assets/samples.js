/**
 * miniprogram/assets/samples.js
 * 由 scripts/gen_samples.js 从 samples/ 生成，请勿直接编辑。
 *
 * 内置示例文档是提审的 P0 门禁（Edge F7）：
 * 审核员的微信里没有可选文件，没有示例就无法测试，会被直接驳回。
 */

module.exports = {
  "sample.md": {
    label: "Markdown 示例",
    format: "markdown",
    text: "# Markdown 示例文档\n\n> 这是一份展示 Markdown 渲染能力的示例文档。所有内容均在你的手机本地解析渲染，不上传任何服务器。\n\n## 基础语法\n\n### 标题\n\n以上是一级和二级标题，这是三级标题。\n\n### 文本样式\n\n支持 **粗体**、*斜体*、~~删除线~~、`行内代码` 等文本样式。\n\n### 列表\n\n无序列表：\n- 第一项\n- 第二项\n  - 嵌套项 A\n  - 嵌套项 B\n- 第三项\n\n有序列表：\n1. 第一步\n2. 第二步\n3. 第三步\n\n任务列表：\n- [x] 已完成项\n- [ ] 未完成项\n- [ ] 另一个未完成项\n\n### 引用\n\n> 这是一段引用文本。\n>\n> 引用可以包含多行，也可以包含 **格式化** 文本。\n\n### 代码块\n\n```javascript\nfunction fibonacci(n) {\n  if (n <= 1) return n;\n  let a = 0, b = 1;\n  for (let i = 2; i <= n; i++) {\n    [a, b] = [b, a + b];\n  }\n  return b;\n}\n\nconsole.log(fibonacci(10)); // 55\n```\n\n```python\ndef quicksort(arr):\n    if len(arr) <= 1:\n        return arr\n    pivot = arr[len(arr) // 2]\n    left = [x for x in arr if x < pivot]\n    middle = [x for x in arr if x == pivot]\n    right = [x for x in arr if x > pivot]\n    return quicksort(left) + middle + quicksort(right)\n```\n\n### 表格\n\n| 功能 | 支持状态 | 说明 |\n|------|---------|------|\n| 标题 | ✅ | 1-6 级标题 |\n| 列表 | ✅ | 有序/无序/嵌套 |\n| 代码 | ✅ | 行内 + 代码块 |\n| 表格 | ✅ | GFM 风格 |\n| 图片 | ✅ | 本地 + base64 |\n| 链接 | ✅ | 点击复制 URL |\n\n### 分割线\n\n---\n\n## 链接\n\n这是一个 [外链示例](https://example.com)，点击会弹出确认框并复制链接到剪贴板。\n\n## 结语\n\n这份示例文档展示了纯文本阅读器的 Markdown 渲染能力。更多功能正在开发中，包括代码高亮、数学公式、目录导航等。\n\n> 提示：在设置中可以切换浅色/深色/护眼主题，调节字号和行距。\n"
  },
  "sample.html": {
    label: "HTML 示例",
    format: "html",
    text: "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n<title>HTML 示例文档</title>\n<style>\n  body {\n    font-family: -apple-system, \"PingFang SC\", sans-serif;\n    max-width: 100%;\n    margin: 0;\n    padding: 20px;\n    line-height: 1.8;\n    color: #333;\n  }\n  h1 { color: #576b95; border-bottom: 2px solid #576b95; padding-bottom: 10px; }\n  h2 { color: #333; margin-top: 30px; }\n  .card {\n    background: #f5f5f5;\n    border-radius: 12px;\n    padding: 16px;\n    margin: 16px 0;\n  }\n  .tag {\n    display: inline-block;\n    padding: 2px 8px;\n    border-radius: 4px;\n    background: #576b95;\n    color: #fff;\n    font-size: 12px;\n  }\n  table { width: 100%; border-collapse: collapse; margin: 16px 0; }\n  th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }\n  th { background: #f5f5f5; }\n  code { background: #f6f8fa; padding: 2px 6px; border-radius: 4px; font-family: monospace; }\n</style>\n</head>\n<body>\n\n<h1>HTML 示例文档</h1>\n\n<p>这是一份展示 HTML 渲染能力的示例文档。所有内容均在你的手机本地解析渲染，<strong>不上传任何服务器</strong>。</p>\n\n<div class=\"card\">\n  <span class=\"tag\">提示</span>\n  <p>HTML 文档中的 <code>&lt;style&gt;</code> 标签内的 CSS 会被解析并应用。</p>\n</div>\n\n<h2>特性列表</h2>\n\n<table>\n  <thead>\n    <tr>\n      <th>功能</th>\n      <th>状态</th>\n      <th>说明</th>\n    </tr>\n  </thead>\n  <tbody>\n    <tr>\n      <td>内联 CSS</td>\n      <td>支持</td>\n      <td>style 标签和属性</td>\n    </tr>\n    <tr>\n      <td>base64 图片</td>\n      <td>支持</td>\n      <td>自动抽取落盘</td>\n    </tr>\n    <tr>\n      <td>表格</td>\n      <td>支持</td>\n      <td>含表头和单元格</td>\n    </tr>\n    <tr>\n      <td>代码块</td>\n      <td>支持</td>\n      <td>等宽字体渲染</td>\n    </tr>\n  </tbody>\n</table>\n\n<h2>代码示例</h2>\n\n<pre><code>function greet(name) {\n  return `Hello, ${name}!`;\n}\n\nconsole.log(greet(\"World\"));</code></pre>\n\n<h2>安全说明</h2>\n\n<p>所有 <code>&lt;script&gt;</code> 标签、事件属性（如 <code>onclick</code>）和危险链接（如 <code>javascript:</code>）都会被自动剥离。</p>\n\n<h2>结语</h2>\n\n<p>这份示例文档展示了纯文本阅读器的 HTML 渲染能力。复杂 CSS 布局会降级为「阅读模式」提取正文。</p>\n\n</body>\n</html>\n"
  },
  "sample.txt": {
    label: "TXT 示例",
    format: "txt",
    text: "纯文本示例文档\n\n这是一份展示纯文本渲染能力的示例文档。所有内容均在你的手机本地解析渲染，不上传任何服务器。\n\n纯文本阅读器支持以下特性：\n\n1. 编码自动识别\n   - UTF-8（含 BOM）\n   - GBK / GB2312 / GB18030（大陆常见编码）\n   - Big5（繁体中文）\n   - UTF-16 LE/BE\n   - 手动编码切换（识别误判时的兜底）\n\n2. 大文件支持\n   - 分块读取，不一次性加载到内存\n   - 虚拟滚动，只渲染可见区域\n   - 超大文件（>50MB）降级为纯文本分页阅读\n\n3. 阅读体验\n   - 浅色 / 深色 / 护眼三种主题\n   - 字号、行距、字体可自定义\n   - 阅读进度自动保存\n\n4. 隐私安全\n   - 零后端，文件不出本机\n   - 无网络请求\n   - 无账号、无云端存储\n\n使用方法：\n- 从首页点击「从聊天选择文件」选取文件\n- 或点击「粘贴文本」从剪贴板粘贴内容\n- 在阅读器中可以切换编码、调整设置\n\n提示：如果遇到乱码，请尝试点击右上角的编码标签手动切换编码。\n"
  }
};
