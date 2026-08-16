# Markdown 示例文档

> 这是一份展示 Markdown 渲染能力的示例文档。所有内容均在你的手机本地解析渲染，不上传任何服务器。

## 基础语法

### 标题

以上是一级和二级标题，这是三级标题。

### 文本样式

支持 **粗体**、*斜体*、~~删除线~~、`行内代码` 等文本样式。

### 列表

无序列表：
- 第一项
- 第二项
  - 嵌套项 A
  - 嵌套项 B
- 第三项

有序列表：
1. 第一步
2. 第二步
3. 第三步

任务列表：
- [x] 已完成项
- [ ] 未完成项
- [ ] 另一个未完成项

### 引用

> 这是一段引用文本。
>
> 引用可以包含多行，也可以包含 **格式化** 文本。

### 代码块

```javascript
function fibonacci(n) {
  if (n <= 1) return n;
  let a = 0, b = 1;
  for (let i = 2; i <= n; i++) {
    [a, b] = [b, a + b];
  }
  return b;
}

console.log(fibonacci(10)); // 55
```

```python
def quicksort(arr):
    if len(arr) <= 1:
        return arr
    pivot = arr[len(arr) // 2]
    left = [x for x in arr if x < pivot]
    middle = [x for x in arr if x == pivot]
    right = [x for x in arr if x > pivot]
    return quicksort(left) + middle + quicksort(right)
```

### 表格

| 功能 | 支持状态 | 说明 |
|------|---------|------|
| 标题 | ✅ | 1-6 级标题 |
| 列表 | ✅ | 有序/无序/嵌套 |
| 代码 | ✅ | 行内 + 代码块 |
| 表格 | ✅ | GFM 风格 |
| 图片 | ✅ | 本地 + base64 |
| 链接 | ✅ | 点击复制 URL |

### 分割线

---

## 链接

这是一个 [外链示例](https://example.com)，点击会弹出确认框并复制链接到剪贴板。

## 结语

这份示例文档展示了纯文本阅读器的 Markdown 渲染能力。更多功能正在开发中，包括代码高亮、数学公式、目录导航等。

> 提示：在设置中可以切换浅色/深色/护眼主题，调节字号和行距。
