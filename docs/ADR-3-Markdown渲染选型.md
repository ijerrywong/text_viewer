# ADR-3（Markdown 部分）：Markdown 渲染方案定案

> 状态：已定案（2026-08-15）
> 关联：docs/产品架构设计.md ADR-3、构建说明书 Phase 2 任务 2

## 决策

**自研 GFM 子集块级解析器 → 统一 IR → 每块原生 WXML 渲染（复用 TXT 虚拟滚动管线）。**
否决 towxml 与 mp-html markdown 插件作为 Markdown 主渲染路径。

## 背景（实测调研，2026-08-15 联网核对）

| 候选 | 体积 | 渲染模式 | GFM | 维护 |
|---|---|---|---|---|
| towxml 3.0 | 按需构建约 100KB+ | `app.towxml(md,'markdown')` 返回**整棵节点树** → towxml 组件一次性渲染 | 全（含 latex/echarts/yuml） | 放缓（原仓库 sbfkcel/towxml，issue 积压） |
| mp-html v2.5.2 + markdown 插件 | 组件 ~25KB gzip + marked.js 插件 | md → marked → **整段 HTML 字符串** → mp-html 组件一次性渲染 | 表格/高亮可用，marked 转译 | 活跃（2025-12 仍有发版） |
| **自研块级解析 + 每块渲染** | 0 外部依赖，解析器 ~20KB | **块级 IR + 虚拟滚动**，与 TXT 共用管线 | GFM 子集（够用） | 自控 |

## 否决理由

1. **架构冲突（决定性）**：两个库都是整文档一次性渲染。towxml 的节点树、mp-html 的 HTML 字符串都无块边界，无法接入 Phase 1 已建成的虚拟滚动 + 高度补偿管线。
2. **10MB 验收要求**：构建说明书要求「搜索在 10MB md 上可用」。10MB md 整文档渲染必然崩溃——单次 setData 1MB 上限（实践 64KB）、节点数超限、无法虚拟滚动。
3. **绕路**：mp-html markdown 插件是 md → marked → HTML → 再解析 HTML，块边界信息在 marked 转换时丢失，拾回来成本高于自研。
4. **towxml 需要额外构建流程**（clone + config + npm build），与我们的纯函数 Node 可测架构不兼容。

## 采用的渲染技术

- **块级**：解析器输出扁平块列表（heading/paragraph/listItem/table/code/quote/hr/image），与 TXT IR 同构，直接复用虚拟滚动。
- **行内**：嵌套 `<text>` span 渲染（小程序 text 支持嵌套与样式继承、user-select 长按选择），链接为 bindtap span → 确认弹窗 → 复制剪贴板（F1）。**不用 rich-text**（不支持节点级事件、选择体验差）。
- **代码高亮**：自研轻量正则分词器（`core/highlight/index.js`，~15KB），覆盖 Top 15 语言（JS/TS/Python/Java/C/C++/Go/Rust/PHP/Ruby/HTML/CSS/JSON/Bash/SQL），输出 token 数组供 WXML 着色。否决 highlight.js：全量 900KB 不可接受，裁剪版仍需 npm 构建+进分包，且其输出 HTML 字符串无法直接在原生 WXML 渲染。自研方案零依赖、零构建、体积更小、三主题适配。不支持的语言降级等宽纯文本（C4）。
- **表格**：scroll-view 横向滚动 + 最小列宽（C5）。

## 保留的出口

- ~~Phase 3 HTML 路线仍按 ADR-3 原计划用 mp-html 打底 + 预处理层（HTML 无块边界问题可先切块）。~~ **已变更，见下方 Phase 3 补充决策。**
- 若 Phase 2 后发现 GFM 子集覆盖不足（如脚注/公式诉求强烈），评估在**小块文档**场景（<200 块）引入 towxml 作可选增强，不作为主路径。

---

## Phase 3 补充决策：HTML 渲染方案定案

> 状态：已定案（2026-08-15）
> 关联：构建说明书 Phase 3 任务 0/1、Edge-Cases C7–C26

### 决策

**自研轻量 HTML tokenizer → DOM 树 → CSS 预处理 → 块级 IR → 复用 Phase 1/2 虚拟滚动管线。**
否决 mp-html 作为 HTML 主渲染路径。

### 否决 mp-html 的理由

1. **架构冲突（与 Phase 2 同因）**：mp-html 是整文档一次性渲染组件，无块边界，无法接入虚拟滚动 + 高度补偿管线。HTML 文档可达数 MB，整文档渲染必撞 setData 上限。
2. **npm 构建负担**：mp-html 需 `npm install` + 微信开发者工具「构建 npm」+ 生成 `miniprogram_npm/`，与纯函数 Node 可测架构不兼容。
3. **CSS 能力有限**：mp-html 内置 CSS 解析器仅支持标签/class/id 选择器，无法处理 Tailwind 类名展开、CSS 变量求值、伪元素合成——这些恰好是 AI 生成 HTML 的最高频失败模式（C17/C18/C19）。
4. **"阅读模式" 更合适**：AGENTS.md 风险提示已明示"复杂 CSS 还原有限，以文档语义优先"。自研解析器天然走"提取语义结构 → 块级渲染"路线，与"阅读模式"降级（ADR-2）无缝衔接。

### 采用的技术方案

| 层 | 实现 | 说明 |
|---|---|---|
| HTML tokenizer | `core/parse/html/tokenizer.js` | 轻量 HTML→DOM 树解析器，处理标签/属性/实体/容错 |
| Tailwind 展开 | `core/parse/html/tailwind.js` | 正则模式匹配类名→CSS 声明（C17 P0），~20KB |
| CSS 预处理 | `core/parse/html/preprocess.js` | CSS 变量求值(C18) + 伪元素合成(C19) + 视口钳制(C20) + fixed→static(C21) |
| 脚本降级 | `core/parse/html/degrade.js` | Chart.js/ECharts→占位卡片(C22)，Mermaid→代码块，reveal.js→竖排卡片(C23) |
| HTML→IR | `core/parse/html/converter.js` | DOM 树→块级 IR，复用现有块类型 + 新增 container/scriptDegrade |
| 消毒 | `core/sanitize/index.js`（已有） | 剥 script/iframe/on*/javascript:，Phase 1 已实现 |

### 容错纪律（C7/C12，P0）

- HTML 片段（无 `<html>/<body>`）自动容错解析（C7）
- 未闭合标签、畸形嵌套按"最接近的合法结构"容错，不抛错
- 坏块降级为纯文本段落，内容零丢失（C12）
- 整体 try/catch：异常降级 parseTxt

### 防解析炸弹（F2）

- 节点数上限 50,000、嵌套深度上限 100
- 超限截断并提示，不崩溃

## 容错纪律（C2，P0）

解析器整体 try/catch：任何未预期异常 → 降级 `parseTxt`（纯文本渲染，内容零丢失）。畸形 Markdown（未闭合加粗、嵌套错乱、裸 HTML 内嵌）一律按「最接近的合法结构」容错解析，不抛错。
