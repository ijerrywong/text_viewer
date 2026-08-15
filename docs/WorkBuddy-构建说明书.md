# WorkBuddy 构建说明书（微信「纯文本阅读器」小程序）

> 本文件是喂给 **腾讯 WorkBuddy**（[WorkBuddy 快速开始](https://www.codebuddy.cn/docs/workbuddy/Quickstart)；腾讯云代码助手 CodeBuddy 桌面工作台）的**构建指令**，也是人工验收清单。
> 构建代理必须同时阅读：`../AGENTS.md`（项目宪法）与 `产品架构设计.md`、`Edge-Cases-清单.md`。

---

## 0. 使用方式（给人类操作者）

1. 把本仓库作为 WorkBuddy 工作目录打开（`.vmark`/`AGENTS.md`/`docs/` 都在）。
2. 让 WorkBuddy **先读 `AGENTS.md`**，再进入**计划模式**，按本文件逐 Phase 执行。
3. 每个 Phase 结束前，让 WorkBuddy 跑一次「阶段验收清单」，**真机**验证后才进入下一 Phase。
4. 关键不确定点（§5 官方文档核对清单）要求 WorkBuddy 先联网核对微信官方文档，再实现。

> 已知参考：用 WorkBuddy + CodeBuddy 从零做小程序的公开实战（[两周做出「爱入眠」小程序](https://cloud.tencent.com.cn/developer/article/2681887)、[复制指令就能用的保姆级教程](https://cloud.tencent.cn/developer/article/2656192)）。本项目照此模式，但用本文件约束范围与质量。

---

## 1. 目标与范围（给 WorkBuddy 的上下文）

- **做什么**：一个**原生微信小程序**，纯本地、零后端，在微信里查看 HTML / Markdown / TXT / 其它纯文本。
- **HTML 的含义**：AI 生成的**自包含长文档**（书/文章/PDF/PPT 转写），无 JS、无后端、CSS 内联、图片 base64 或相对路径。**不是网页**。
- **不做什么**：不做服务端/云函数/数据库；不做编辑器；不做 Office/PDF 原生渲染（交给 `wx.openDocument`）；不加载任何外部网络资源。

---

## 2. 交付物与目录结构

```
text-viewer/
├── AGENTS.md
├── project.config.json            # appid 由用户填入
├── miniprogram/
│   ├── app.js / app.json / app.wxss
│   ├── pages/
│   │   ├── index/                 # 首页：选择文件 / 最近文件 / 引导
│   │   ├── reader/                # 阅读器：唯一核心页
│   │   └── settings/              # 设置：主题/字号/字体/清缓存
│   ├── components/
│   │   ├── virtual-list/          # 虚拟滚动容器
│   │   ├── block-renderer/        # IR 块渲染器（段落/标题/代码/表格/图片/公式）
│   │   ├── code-block/            # 代码块 + 高亮
│   │   ├── toc-panel/             # 目录抽屉
│   │   ├── image-block/           # 图片懒加载/占位
│   │   └── link-handler/          # 外链确认/复制
│   ├── core/
│   │   ├── intake/                # chooseMessageFile + 启动场景 + 分享
│   │   ├── detect/                # 类型识别 + 编码识别
│   │   ├── parse/                 # txt / md / html → IR（含 sanitize）
│   │   ├── render/                # IR 分片 + 虚拟滚动数据
│   │   └── store/                 # 文件落盘 / 进度 / 设置 / LRU
│   └── libs/                      # 第三方（mp-html / gbk 解码 / highlight）
└── subpackages/
    ├── pkg-markdown/
    └── pkg-html/
```

---

## 3. 技术栈（已定，无需重新选型）

| 层           | 选型                                      | 说明                        |
| ----------- | --------------------------------------- | ------------------------- |
| 框架          | 原生 WXML/WXSS/JS                         | 不用 Taro/uni-app           |
| HTML 渲染     | `mp-html` **打底 + 自研预处理层**               | 进 `pkg-html`，预处理见 §3.1    |
| Markdown 渲染 | `mp-html` markdown 插件 **或** `towxml`    | Phase 2 用样例集实测定案（见 ADR-3） |
| GB18030/Big5 解码 | **精简码表自实现** | ⚠️ 小程序无 `TextDecoder`，不要找 polyfill 绕，直接内置码表。进按需分包 |
| Tailwind 类名 | **自研规则生成器（~20KB）**                      | 进 `pkg-html`，检测到才异步加载。**优先级高于代码高亮** |
| 代码高亮        | `highlight.js` **按语言裁剪** Top 20         | 全量 900KB 不可接受，裁剪后 ~80KB，进 `pkg-markdown` |
| 数学公式        | **降级为等宽块 + 复制按钮**                       | KaTeX 依赖 DOM 与字体测量，小程序内不可行。诚实降级优于错位公式 |

### 3.1 HTML 预处理层（送入 mp-html 之前执行）

`mp-html` 内置简易 CSS 解析器（标签/class/id 选择器），基础场景已覆盖。以下几类是它处理不了、而 AI 生成文档高频出现的，必须自己补：

| 预处理 | 不做的后果 |
|---|---|
| **Tailwind 类名展开** | ⚠️ **样式全部归零，文档塌成裸文本**——AI 生成 HTML 的最高频失败模式 |
| **CSS 变量求值** | `:root{--primary:…}` + `var()` 是 AI 高频写法，不求值则配色全丢 |
| **`::before`/`::after` 合成为真实节点** | 图标、引号、序号装饰全丢 |
| **视口钳制** | `max-width:1200px` 桌面假设导致手机横向溢出 |
| **`position:fixed`/`sticky` → `static`** | 固定侧边栏遮挡正文 |
| **脚本模式识别降级** | Chart.js/Mermaid/reveal.js 处留下空白，用户以为文件坏了 |

> **纪律：Phase 3 开始前必须用真实 AI 文档样例集实测 `mp-html` 的实际能力**，把结论写进 `docs/verify-notes.md`，据此确定自研层边界。**不得凭想象决定全自研或全依赖。**

---

## 4. 分阶段构建计划

> 每个 Phase 都含：**任务 → 产出 → 验收标准 → 关联 Edge-Cases**。

### Phase 0 — 脚手架与核对（前置）

**任务**：

1. 初始化原生小程序项目（`project.config.json` + `app.json` 分包配置）。
2. 建立 `core/`、`components/`、`pages/` 骨架，空实现可跑通。
3. **先完成 §5 官方文档核对清单**（联网核对），把结论写进 `docs/verify-notes.md`。

**验收**：开发者工具可预览；分包配置生效（主包体积留出余量）；核对笔记落盘。

### Phase 1 — M1：可用的 TXT 阅读器（MVP 闭环）

**任务**：

1. Intake：`wx.chooseMessageFile({type:'file'})`；**在 success 回调内立即** temp → `USER_DATA_PATH` 落盘（不可延迟到用户点开时）；文件名清洗，磁盘上一律以 `stableId` 命名（Edge A3/A7）。
2. **剪贴板入口**：仅用户点击「粘贴」时 `wx.getClipboardData`，内容嗅探后走同一管线，默认不落盘 + 显式「保存到最近」（E8/E9/E10）。
3. Detect：扩展名 + 魔数 + 内容嗅探（A4/A5）；编码识别 **BOM → `<meta charset>` → UTF-8 状态机 → GB18030/Big5 打分 → UTF-8**（B1–B6/B14/B15）。
4. GB18030 解码自实现 + **手动编码切换入口**（B3/B10/B17）。⚠️ 无 `TextDecoder`，别绕路。
5. TXT 解析 → IR → 渲染（换行归一化含老 Mac 单 `\r`，B12；剥 BOM 在解析之前，B2）。
6. **虚拟滚动容器**：预估高度占位 + `createSelectorQuery` 回填 + **改动上方块高时反向补偿 `scrollTop`**（D13，最容易做砸的一点）；单次 setData < 64KB（D12）；**节点树扁平化**避免递归组件（G9）。
7. 阅读体验：字号/行高/字体、浅色/深色/护眼主题（D4/E7）。
8. 阅读进度保存/恢复：存 **`{fileId, blockIndex, ratio}`，不存 `scrollTop`**（E1/E1b/D11）；最近文件（E6）。

**验收**：GBK 中文 txt 真机正确显示；空文件不崩溃（B8）；10MB txt 滚动**无跳动**；进度跨冷热启动、跨字号变更恢复；主题持久化。
**关联**：A1–A10、B1–B17、D4/D12/D13、E1/E6/E7/E8–E10、G9。

### Phase 2 — M2：完整 Markdown

**任务**：

1. md 解析器 → IR：标题/段落/列表/表格/代码块/引用/图片/链接/任务列表（C1–C6）。
2. **定案渲染库**：用含 GFM 表格/公式/高亮/内嵌 HTML 的样例集，跑 `mp-html` vs `towxml`，选真机表现更稳者，写 ADR。
3. 目录 TOC + 锚点跳转 + 当前标题高亮（D7）。
4. 代码高亮（裁剪 `highlight.js`）进分包，未知语言降级（C4）。
5. 全文搜索 + 高亮（D8，大文档性能可用）。
6. 多文件队列 + 每文件独立进度（A2/E6）。

**验收**：GFM 表格/任务列表/代码块/图片真机正确；目录跳转可用；搜索在 10MB md 上可用。
**关联**：C1–C6、D5/D6/D7/D8。

### Phase 3 — M3：完整 HTML（自包含文档）+ 安全

**任务**：

0. **前置：用真实 AI 文档样例集实测 `mp-html` 的 `<style>` 支持程度**，结论写入 `docs/verify-notes.md`，据此确定自研预处理层边界（ADR-3）。**这一步不做完不许写实现代码。**
1. `mp-html` 接入进 `pkg-html`；消毒策略落地（ADR-6）：剥 script/iframe/object/embed/form/base/on\*/`javascript:`（C11/F1）。
2. **预处理层**（§3.1，送入 mp-html 之前）：
   - **Tailwind 类名规则生成器**（C17）——⚠️ 本 Phase 最高优先级，不做则大量文档塌成裸文本
   - CSS 变量求值（C18）· `::before`/`::after` 合成真实节点（C19）
   - 视口钳制注入 `*{max-width:100%;box-sizing:border-box}`（C20）· `fixed`/`sticky` → `static`（C21）
3. HTML → IR：`<style>` 提权内联、片段容错（无 html/body）、坏块降级（C7/C8/C12）。
4. base64 图片**抽取落盘**换本地路径 + 懒加载 + 阈值 + 占位（ADR-8 / C9/C10/D3）。⚠️ 直接把 base64 塞 setData 会撞 1MB 上限（D12）。
5. **脚本降级可见化**：Chart.js/ECharts → 占位卡片；Mermaid → 等宽代码块；reveal.js → 每个 `<section>` 一张竖排卡片（C22/C23）。**不留空白。**
6. 外链处理：点击 → 确认弹窗 → 复制剪贴板，绝不静默跳转（F1/E12）。网络图片默认关闭、设置可开（F9）。
7. 大文件策略落地：分块读、**Worker 解析（主线程读+解码 → postMessage 传字符串，Worker 内无 FileSystemManager，D14）**、虚拟滚动、>50MB 降级分页（ADR-5 / D1/D2）。
8. 「阅读模式」降级：复杂 CSS 布局失败时提取正文 → IR（ADR-2）。
9. 防解析炸弹：节点数 50,000 / 深度 100 / 超时 10s，超限截断提示（F2）。

**验收**：
- **3 份使用 Tailwind CDN 的真实 AI 文档，布局与配色基本还原**（C17）——**不过关则 Phase 3 不算完成**
- 自包含 HTML 长文档（含 base64 图、表格、代码）真机可读
- 含 Chart.js 的文档显示降级卡片而非空白；reveal.js 幻灯片流式化为竖排卡片
- 恶意 HTML 无执行面、外链不跳转；畸形/片段 HTML 不崩溃
- 10MB 文件不崩溃可滚动，滚动无跳动

**关联**：C7–C26、D1–D3/D12–D19、F1/F2/F9。

### Phase 4 — M4：加固、兼容与提审

**任务**：

1. 兼容性：`wx.canIUse` 探测 + 降级；基础库 `minimum` 声明（G5）。
2. 低端机性能回归 + iOS/Android 双端回归（D9/D10）。
3. 存储治理：key-value 精简 + LRU 清理 + 配额告警（G3/G4）。
4. 非目标格式引导：`.docx/.pdf/.pptx` → `wx.openDocument`；压缩包/二进制 → 明确提示（C14/C15/B14）。
5. 包体积门禁：主包 < 2MB（目标 < 800KB），总包 < 20MB（G1/G2）。
6. **合规硬要求**（会卡上线，非可选）：
   - **《小程序用户隐私保护指引》**：`app.json` 设 `"__usePrivacyCheck__": true`，首次调用前 `wx.requirePrivacyAuthorize`。`chooseMessageFile` 与剪贴板**都属需声明接口**，不配置接口直接调用失败（F6）。
   - **内置 3 份示例文档**（md/html/txt 各一，自有版权）+ 首屏「查看示例」入口（F7）。
     > ⚠️ 审核员的微信里没有可选文件，无法测试会直接驳回。这条极易遗漏。
   - 提审说明写明："文件仅在用户手机本地解析渲染，全程不上传任何服务器，无云端存储、无文件分享功能。"（F8）
   - 类目：工具 → 文档处理 / 效率（个人主体可选类目有限，需确认实际可选项）。
7. **验证 scene 1173 入口**（§5 清单第 2 项）：`supportedMaterials` 声明后提审，确认 `.md` 是否受支持、个人主体是否有限制。**验证不通不影响主流程**。

**验收**：§7 验收清单全绿；提交体验版。

---

## 5. 官方文档核对清单（WorkBuddy 实现前必须联网确认）

> 这些点平台行为随版本变化，**不要凭经验硬编码**，逐个核对并在 `docs/verify-notes.md` 记录结论与出处链接。

1. **`wx.chooseMessageFile`**：`count` 上限、单文件大小上限、`type` 取值、返回的 `tempFilePath` 生命周期。→ [官方文档](https://developers.weixin.qq.com/miniprogram/dev/api/media/image/wx.chooseMessageFile.html)
2. **「聊天素材打开」场景** —— **能力已确认存在，以下为已核实结论，仅剩三项待验证**：
   - 场景值 **1173**；`app.json` 声明 `supportedMaterials`，格式为
     `{ "materialType": "text/html", "name": "用${nickname}打开", "desc": "…", "path": "pages/index/" }`
     （`materialType` 用 MIME 类型可带通配符；`name` **必须包含 `${nickname}`** 且其余不超过 6 字；`desc` ≤ 22 字）
   - 启动参数中与 `query` **同级**的 `forwardMaterials` 数组，每项 `{type, name, path, size}`；用 `wx.getLaunchOptionsSync()` 或 `onLaunch`/`onShow` 取得
   - 官方列举支持的文档类型含 `.txt` `.csv` `.html` `.pdf` `.docx` `.xlsx` `.pptx` 等
   - 提审时**会审核声明的 `supportedMaterials` 是否合规**（"处理功能价值过低或与素材无关"会被拒）；**小程序上线后对应文件类型的打开入口才会出现**
   - ⚠️ **待验证**：① 是否支持 `text/markdown`（`.md` 未在官方列举中出现，而 md 是核心场景）② **个人主体是否有限制** ③ 开发版/体验版能否验证，还是必须等正式上线
   - ⚠️ **纪律**：此入口是体验上限，但**不得作为主流程依赖**。M1 用 `chooseMessageFile` 打通闭环，此处验证不通不影响可用性。
3. **`wx.openDocument`**：支持格式清单、单文件大小上限、`showMenu`/`fileType` 参数。→ [官方文档](https://developers.weixin.qq.com/miniprogram/dev/api/file/wx.openDocument.html)
4. **`rich-text`**：支持标签/属性白名单、`nodes` 字符串 vs 数组的差异与限制、图片 src 域名校验规则。→ [官方文档](https://developers.weixin.qq.com/miniprogram/dev/component/rich-text.html)
5. **`FileSystemManager.readFile`**：`position`/`length` 分块读的参数与限制、可读目录范围、单次读取上限。→ [官方文档](https://developers.weixin.qq.com/miniprogram/dev/api/file/FileSystemManager.readFile.html)
6. **`Worker`**：支持范围、与主线程通信限制、文件系统访问能力。
7. **包体积与存储配额**：主包/分包/独立分包限制、`setStorage` 总量与单 key 上限、`USER_DATA_PATH` 配额。（当前已知：主包 2MB、总包 20MB、KV 约 10MB/单 key 1MB，需复核最新数字）
8. ~~**`TextDecoder`**~~ —— **已确认：小程序不提供 `TextDecoder` 全局对象**（不是"支持不稳定"，是根本没有）。**不要写特性检测分支，直接内置 GB18030 码表自实现。** 此项无需再核对。
9. **图片 `data:` URI 与本地临时路径** 在 `rich-text`/`image` 组件中的可用性。
   > 已知：`<image>` 支持 data URI，但**大 base64 会撞 setData 1MB 上限**，故 ADR-8 决定抽取落盘。另已知 **`<image>` 的 src 不受合法域名白名单限制**（只有 `request`/`downloadFile` 受限），网络图技术上可加载——本项目出于隐私默认关闭。
10. **`wx.setClipboardData` / `wx.getClipboardData`** 限制与最佳实践（含 iOS 读剪贴板的系统提示行为）。
11. **`mp-html` 对 `<style>` 选择器的实际支持程度** —— 决定自研预处理层的工作量边界（ADR-3）。用真实 AI 文档样例集实测，**Phase 3 前必须有结论**。
12. **隐私保护指引**：`__usePrivacyCheck__` 配置方式、`wx.requirePrivacyAuthorize` 调用时机、`chooseMessageFile` 与剪贴板是否都在需声明接口清单内。

---

## 6. 给 WorkBuddy 的提示词模板（计划模式）

> ⚠️ **不要一次把全部文档丢给 WorkBuddy。** 每次会话先喂 `AGENTS.md`（尤其 §3.5 禁止清单——AI 写小程序最大的失败模式是写出 Web 代码），并在长会话中定期重申；然后一次只交付一个 Phase。

```text
你是这个微信小程序项目的构建代理。请先完整阅读 AGENTS.md（项目宪法，硬约束不可违反），
特别注意 §3.5 的禁止清单：这是小程序不是网页，没有 DOM、没有 document/window、
没有 localStorage、没有 TextDecoder，标签是 <view>/<text> 不是 <div>/<span>，
个人主体不可用 web-view。写出 Web 代码是本项目最常见的失败模式。

再阅读 docs/产品架构设计.md 与 docs/Edge-Cases-清单.md。

现在进入【计划模式】，按 docs/WorkBuddy-构建说明书.md 第 4 节的分阶段计划，
只实现 Phase {N}，不得越界实现后续 Phase 的功能。

实现前，先按第 5 节官方文档核对清单联网核对与 Phase {N} 相关 API 的当前行为，
把结论写入 docs/verify-notes.md，再动手写代码。

完成后，逐条对照 Phase {N} 的验收标准自检，并输出：
1) 改动的文件清单
2) 每个验收项的自检结果
3) 遗留风险与下一步建议
不要声称未验证的结论为真；凡无法本地验证的，标记为「待真机验证」。
```

---

## 7. 总验收清单（提审前必须全绿）

- [ ] 主包 < 2MB（目标 < 800KB），总包 < 20MB（构建产物实测）。
- [ ] GBK 中文 txt、UTF-8 txt、UTF-8 BOM、空文件、二进制伪装 → 全部不崩溃、不乱码（B3/B2/B8/B14）。
- [ ] 手动编码切换可用，切换后重解析正确（B10）。
- [ ] Markdown：GFM 表格/任务列表/代码块/图片/嵌套列表 真机正确（C1/C5/C6）。
- [ ] **Tailwind CDN 的 3 份真实 AI 文档，布局与配色基本还原（C17）** ← Phase 3 核心门禁
- [ ] HTML：自包含长文档（内联 CSS + base64 图）真机可读（C8/C10）。
- [ ] 图表 / Mermaid / 公式显示**可见降级卡片**而非空白（C22/C23）。
- [ ] 恶意 HTML（script/iframe/on\*/外链）被消毒，外链不静默跳转（C11/F1）。
- [ ] ≥10MB 文件真机可滚动、不崩溃、可搜索（D1/D2/D8）。
- [ ] **长文档上下滚动无位置突跳（D13）**。
- [ ] **含数 MB base64 图的 HTML 正常渲染，无 setData 超限（D12）**。
- [ ] 阅读进度跨冷热启动恢复、**跨字号变更不丢失**、多文件进度隔离（E1/E1b/E6）。
- [ ] 剪贴板粘贴长文本可渲染，空剪贴板有明确提示（E8/E9）。
- [ ] iOS + Android 真机核心路径一致通过（D10/G6）。
- [ ] **隐私保护指引已配置，拒绝授权时有明确说明而非卡死（F6）**。
- [ ] **内置示例文档可用，无聊天文件时也能完整体验（F7）**。
- [ ] 隐私声明与提审材料齐备（F3/F5/F8）。

---

## 8. 风险提示（给人类）

- **保真度有物理上限，且反悔成本极高**：个人主体 + 无 `web-view`，AI 生成 HTML 的还原上限是**结构完整 + 静态样式 70–85%**，所有 JS 行为（图表、Mermaid、翻页）永久不可用。若对保真度期待更高，唯一出路是升级为企业主体 + 备案域名 + `web-view`；而**小程序主体不可变更**，必须重注册 AppID，用户/数据/评价全部不迁移。**这个决定要在写第一行代码前做，不是 Phase 3 验收时才发现。**（ADR-3.1）
- **「聊天素材打开」入口**是产品体验上限，能力已确认存在（scene 1173），但 `.md` 支持与个人主体限制待验证，且上线后才出现入口：M1 先以 `chooseMessageFile` 保证可用闭环，验证不通不影响主流程。
- **Tailwind CDN 是最大的技术意外**：AI 生成的 HTML 并不总是"CSS 内联"，相当高比例只写类名靠 CDN。不处理则文档塌成裸文本。这一层的优先级高于代码高亮，别排到最后。
- **GBK 探测不可能 100% 准**：手动编码切换是产品刚需，不是可选项。
- **复杂 CSS 还原有限**：以"文档语义优先、像素级还原其次"为原则，复杂 HTML 走阅读模式。
- **大文件是真机内存战**：性能门禁必须跑真机，开发者工具结果不具代表性。
- **三处不要完全交给 AI 自动生成后直接采信**：
  | 任务 | 为什么危险 |
  |---|---|
  | 编码识别（Phase 1） | 无 `TextDecoder` 可依赖，码表、状态机、打分阈值全自研。错了的表现是"能跑但偶尔乱码"，最难发现 |
  | 虚拟滚动高度补偿（Phase 1） | 回填与 `scrollTop` 补偿的时序极易出错，症状是"偶尔跳一下"，难复现难定位 |
  | HTML 预处理层（Phase 3） | 最容易失控。**先在 Node 里用真实样例把它调通，再移植进小程序**——解析层是纯函数，这样调试快一个数量级 |

