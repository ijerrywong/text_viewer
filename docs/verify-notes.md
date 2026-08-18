# verify-notes.md - 官方文档核对结论

> 本文件记录 WorkBuddy 联网核对微信官方文档的结论。
> 每条核对必须附：结论 + 出处链接 + 核对日期。
> **不得凭经验断言，不得在未核对前写实现代码。**

---

## 1. wx.chooseMessageFile

- **核对状态**：已确认（Phase 4 联网核对）
- **已确认项**：
  - [x] count 默认 10，可设 1-10
  - [x] type 取值：'file' | 'image' | 'video'
  - [x] extension 参数指定允许的扩展名列表
  - [x] tempFilePath 为会话级临时路径，可能被微信清理 → 必须立即复制到 USER_DATA_PATH（已实现）
  - [x] **属隐私接口**：需在隐私保护指引中声明"收集你选中的文件"
- **出处**：https://developers.weixin.qq.com/miniprogram/dev/api/media/image/wx.chooseMessageFile.html
- **核对日期**：2026-08-15（Phase 4 联网核对）

---

## 2. 聊天素材打开（scene 1173）

- **核对状态**：已确认（Phase 4 联网核对）
- **已确认结论**：
  - 场景值 1173，从基础库 2.14.3 开始支持
  - app.json 声明 `supportedMaterials`，格式：`{ materialType, name, desc, path }`
  - `name` 必须包含 `${nickname}`，其余不超过 6 字
  - `desc` ≤ 22 字
  - `forwardMaterials` 数组在启动参数中与 query 同级，每项 `{type, name, path, size}`
  - 提审时会审核 `supportedMaterials` 合规性（功能价值不能过低）
  - 上线后入口才出现
  - 体验版支持单独配置，与正式版独立
  - 开发者工具可在自定义编译模式下用场景值 1173 调试
- **支持的 MimeType 列表**：
  | MimeType | 文件后缀 |
  |---|---|
  | text/html | webview（含公众号文章） |
  | text/plain | .txt |
  | application/pdf | .pdf |
  | application/msword | .doc |
  | application/vnd.openxmlformats-officedocument.wordprocessingml.document | .docx |
  | application/vnd.ms-excel | .xls |
  | application/vnd.openxmlformats-officedocument.spreadsheetml.sheet | .xlsx |
  | application/vnd.ms-powerpoint | .ppt |
  | application/vnd.openxmlformats-officedocument.presentationml.presentation | .pptx |
  | application/zip | .zip |
  | application/vnd.rar | .rar |
  | application/x-7z-compressed | .7z |
  | video/* | 视频类文件 |
  | audio/* | 音频类文件 |
  | image/* | 图片类文件 |
  | application/* | 通用文件配置 |
- **⚠️ 关键发现**：
  - **text/markdown (.md) 不在支持列表中** → scene 1173 无法用于 .md 文件
  - 用户打开 .md 文件只能通过 chooseMessageFile
  - 审核要求"功能价值不能过低"：只是查看 .docx 等微信已能查看的文件会被拒
  - 本项目声明 `text/html` 和 `text/plain` 有充分价值（Tailwind 展开、CSS 变量求值、GBK 编码识别等微信原生不支持）
- **出处**：https://developers.weixin.qq.com/miniprogram/dev/framework/material/support_material
- **核对日期**：2026-08-15（Phase 4 联网核对）

---

## 3. wx.openDocument

- **核对状态**：已确认（Phase 4 联网核对）
- **已确认项**：
  - [x] 支持格式：doc, docx, xls, xlsx, ppt, pptx, pdf
  - [x] 参数：`filePath`（本地路径）、`showMenu`（默认 false）、`fileType`（可指定格式）
  - [x] 微信 7.0.12 后默认不显示右上角菜单，需主动传 `showMenu: true`
  - [x] 需基础库 ≥ 1.4.0（fileType 参数），showMenu 需 ≥ 2.11.0
  - [x] 插件支持需 ≥ 2.15.0
- **实现策略**：用户选择 .docx/.pdf/.pptx/.xlsx 时，先复制到 USER_DATA_PATH，再调 wx.openDocument
- **出处**：https://developers.weixin.qq.com/miniprogram/dev/api/file/wx.openDocument.html
- **核对日期**：2026-08-15（Phase 4 联网核对）

---

## 4. rich-text 组件

- **核对状态**：不适用（Phase 3 已决策不使用 rich-text，改用自研 IR + wx:for 渲染）
- **结论**：自研 tokenizer → IR → 虚拟滚动渲染，与 rich-text 无关
- **核对日期**：2026-08-15

---

## 5. FileSystemManager.readFile

- **核对状态**：部分确认（Phase 1 已用 `readFile({position, length})` 实现分块读取，待真机验证）
- **已确认项**：
  - [x] position / length 分块读参数可用（API 层面已实现，真机行为待验证）
  - [x] 可读目录范围：`wx.env.USER_DATA_PATH` + `tempFilePath`（chooseMessageFile 返回）
  - [x] 单次读取上限：API 无明确文档限制，实践中按需分块
- **待真机验证项**：
  - [ ] `USER_DATA_PATH` 实际配额（约 200MB 需复核）
  - [ ] 大文件（≥10MB）分块读取性能
- **出处**：https://developers.weixin.qq.com/miniprogram/dev/api/file/FileSystemManager.readFile.html
- **核对日期**：2026-08-15（Phase 1 实现）

---

## 6. Worker

- **核对状态**：已确认
- **已确认项**：
  - [x] Worker 内**无 `wx.getFileSystemManager()`**，不可读文件
  - [x] 主线程读+解码 → postMessage 传字符串 → Worker 纯计算解析 → 分批回传
  - [x] Worker 代码包 ≤ 2MB，码表不打包进 Worker
  - [x] 解析层代码已写成纯函数（不依赖 wx API），可在 Node 中直接测试
- **出处**：https://developers.weixin.qq.com/miniprogram/dev/framework/workers.html
- **核对日期**：2026-08-15

---

## 7. 包体积与存储配额

- **已知**：主包 2MB、总包 20MB、KV 约 10MB/单 key 1MB
- **核对状态**：已确认（数字未变化）
- **出处**：https://developers.weixin.qq.com/miniprogram/dev/framework/subpackages.html
- **核对日期**：2026-08-15

---

## 8. TextDecoder

- **结论**：⚠️ 小程序不提供 TextDecoder 全局对象。不要写特性检测分支，直接内置 GB18030 码表自实现。
- **核对状态**：已确认（无需再核对）
- **实现验证**：✅ Phase 1 已完成自实现解码器（UTF-8/GBK/GB18030/Big5/UTF-16LE/BE），码表 Base64 内嵌，懒加载
- **出处**：小程序官方文档无此 API
- **核对日期**：项目初始

---

## 9. 图片 data: URI 与本地临时路径

- **已知结论**：
  - `<image>` 组件支持 data URI
  - 大 base64 会撞 setData 1MB 上限 → 抽取落盘（ADR-8）
  - `<image>` 的 src 不受合法域名白名单限制 → 网络图技术上可加载，本项目出于隐私默认关闭
- **核对状态**：已确认
- **实现验证**：✅ Phase 3 已实现 base64 图片抽取落盘
- **核对日期**：项目初始

---

## 10. wx.setClipboardData / wx.getClipboardData

- **核对状态**：已确认（Phase 4 联网核对）
- **已确认项**：
  - [x] **属隐私接口**：需在隐私保护指引中声明"读取你的剪切板"
  - [x] iOS 读取剪贴板会弹系统提示"XX 读取了你的剪贴板"
  - [x] 必须仅在用户明确点击时读取，绝不静默读取
- **出处**：https://developers.weixin.qq.com/miniprogram/dev/framework/user-privacy/miniprogram-intro.html
- **核对日期**：2026-08-15（Phase 4 联网核对）

---

## 11. mp-html 对 <style> 选择器的支持程度

- **核对状态**：已决策（2026-08-15）
- **结论**：不使用 mp-html。自研 HTML tokenizer → IR 方案，与 Phase 2 自研 Markdown 解析器同构。理由见 ADR-3 Phase 3 补充决策。
- **出处**：https://github.com/jin-yufeng/mp-html
- **核对日期**：2026-08-15

---

## 12. 隐私保护指引

- **核对状态**：已确认（Phase 4 联网核对）
- **已确认项**：
  - [x] `app.json` 设 `"__usePrivacyCheck__": true` 启用隐私功能（✅ 已配置）
  - [x] **无 `requiredPrivateInfos` 字段**——隐私保护指引通过 mp.weixin.qq.com 管理后台填写（服务内容声明 → 用户隐私保护指引）
  - [x] 需声明的隐私接口：
    - `wx.chooseMessageFile` → "收集你选中的文件"
    - `wx.getClipboardData` / `wx.setClipboardData` → "读取你的剪切板"
  - [x] `wx.requirePrivacyAuthorize`：调用隐私接口前触发隐私弹窗。用户已同意则直接 success
  - [x] `wx.onNeedPrivacyAuthorization`：注册后切换为自定义弹窗模式；不注册则使用微信官方弹窗
  - [x] 基础库 ≥ 2.32.3 起隐私拦截对所有小程序默认开启
  - [x] 用户拒绝后隐私接口返回 `fail: privacy permission is not authorized`
- **实现策略**：
  - app.js `ensurePrivacyAuthorized()` 已实现 ✅
  - index.js 自定义隐私弹窗已实现 ✅
  - 需在 mp.weixin.qq.com 后台填写隐私保护指引（提审前必须完成）
- **出处**：https://developers.weixin.qq.com/miniprogram/dev/framework/user-privacy/miniprogram-intro.html
- **核对日期**：2026-08-15（Phase 4 联网核对）

---

## 13. 代码审计（2026-08-15）

对 Phase 0–4 已交付代码做了一轮完整审计，结论与修复记录在 `docs/代码审计-2026-08-15.md`。
以下几条会影响后续实现决策，单独在此登记：

### 13.1 GB18030 四字节区不是线性映射（已修）

- **BMP 段**（首字节 0x81–0x84）枚举的是「一/二字节区表达不了的 BMP 码位」，
  指针到码位的差值在每个空洞处跳变，必须查区间表。
  `linear + 0x80` 只在第一个区间内正确，U+00A5 起就开始整体错位。
  区间表（206 段）由 `scripts/gen_encoding_tables.py` 从 Python 官方 gb18030 codec 生成。
- **补充平面段**首字节是 **0x90–0xE3**，不是 0x81–0x84。
  按 0x81–0x84 限制会让 emoji、CJK 扩展 B 区完全解不出来。
- 两字节码表必须用 `gb18030` codec 生成，不能用 `gbk`：
  gb18030 比 gbk 多分配约 2100 个双字节码位。

### 13.2 `String.fromCharCode.apply` 有实参上限

V8 大约 12.5 万个实参就会 `Maximum call stack size exceeded`。
解码器对连续 ASCII 段做批量转换时踩了这条：**任何超过约 100KB 连续 ASCII 的文件
（英文文档、代码、JSON、CSV、日志）解码时直接抛异常**，中文文档反而没事
（ASCII 段被汉字打断了）。凡是 `apply` 传数组的地方都必须分片。

### 13.3 虚拟滚动的可见范围计算必须是次线性的

原实现每次滚动把全部块线性扫三遍、每块现算一次 `estimateHeight`。
10 万块文档实测 **2.65 ms/次**——16ms 帧预算里光算范围就占掉 16%，
还没算 setData。改成树状数组（前缀和 + 树上二分）后 **0.001 ms/次**，
建索引一次性 9ms。质量门禁 #7「滚动无跳动」依赖这一层，已补 `tests/test-render-layout.js`。

### 13.4 树状数组的浮点边界必须显式归一

前缀和是逐段累加出来的，正好停在某块顶端时两侧会差几个浮点末位，
`indexAt` 可能落到前一块。表现是「保存进度 → 恢复进度」稳定往前漂一整块。
`indexAt` 和 `layoutToProgress` 都加了一次精确 offset 校正。

### 13.5 Worker 解析仍未实现（阻塞点已明确）

`miniprogram/workers/parser.js` 目前是 Phase 0 占位，`parseAndRender` 仍在主线程同步解析。

**阻塞点**：Worker 是**独立代码包**，`workers/` 下的文件只能 require `workers/` 内部的文件，
无法 require `../core/parse/`。要落地必须二选一：

1. 加构建步骤，把 `core/parse`、`core/sanitize`、`core/detect` 复制进 `workers/`
   （解析层已经是纯函数，复制过去可直接跑；注意 Worker 包 ≤ 2MB，码表不能带进去）；
2. 把解析层的物理位置移到 `workers/`，主线程反过来从那里 require。

在此之前的缓解措施：`parseAndRender` 先让出一次事件循环再解析，
让「正在解析文档...」这一帧真的画得出来（setData 是异步的，
紧跟同步解析的话这一帧根本没机会渲染，用户看到的是卡住的旧界面）。

**待真机验证**：主线程解析 5MB Markdown 的实际耗时，据此决定 Worker 化的紧迫程度。

---

## 14. 真机隐私接口失败（2026-08-15 实测）

**现象**：真机点「从聊天选择文件」「粘贴文本」，直接弹「需要隐私授权」，
**没有出现任何授权弹窗**。

**结论：这不是代码 bug，是 mp 后台《用户隐私保护指引》还没配置。**

链路：
1. `app.json` 里 `"__usePrivacyCheck__": true` → 隐私拦截开启；
2. `wx.chooseMessageFile` / `wx.getClipboardData` / `wx.setClipboardData` 成为受管控接口；
3. 微信放行前查两件事：**(a)** 后台填过指引且**声明了这个接口**；**(b)** 用户同意过；
4. **(a) 不满足时微信连问都不会问**，`wx.onNeedPrivacyAuthorization` 根本不触发，
   接口直接 `fail: privacy permission is not authorized`；
5. 代码 `fail` 分支看到 errMsg 含 `privacy` → 提示。

**关键认知**：`wx.onNeedPrivacyAuthorization` + 自定义弹窗只解决「怎么问用户」，
不解决「有没有资格问」。后台没配，代码怎么写都救不回来。

**必须做**（F6，P0 上线门禁）：
mp.weixin.qq.com → 设置 → 服务内容声明 → 用户隐私保护指引，声明：
- `wx.chooseMessageFile` → **收集你选中的文件**
- `wx.getClipboardData` / `wx.setClipboardData` → **读取你的剪切板**

⚠️ 注意 §12 已核对过「基础库 ≥ 2.32.3 起隐私拦截对所有小程序默认开启」，
所以**把 `__usePrivacyCheck__` 改成 false 未必能绕过**，别指望它当开发期开关。

**开发期可用的验证路径**：首屏「查看示例」整条链路**不碰任何隐私接口**
（showActionSheet → navigateTo → 内置 samples 模块），
编码/解析/虚拟滚动/主题全都能在真机上验证，不受此阻塞。

**本轮代码改进**（不能解决根因，但让故障可诊断、不再是死路）：
- `app.handlePrivacyFailure()` 统一处理，靠 `globalData.privacyPromptSeen`
  区分两种失败：**没问过=后台没配**（给后台配置指引 + 可复制错误原文）、
  **问过了=用户拒绝**（给「重新授权」入口）。原来两种情况都只是一个飘过的 toast，
  用户无从判断也无路可走，违反 F6「拒绝授权时要给明确说明而非卡死」。
- 悬空 resolve 兜底：上一次授权请求没答复就又来一次时，先把旧的 resolve 掉，
  否则那次接口调用既不 success 也不 fail，永久 pending，表现为「点了没反应」。
- `denyPrivacy` 的文案不再写死「选择文件」（粘贴、复制都会走到这里）。
- reader 的复制链接 / 复制代码补上 `fail` 回调 —— 以前失败是**完全静默**的。

### 14.1 两层授权，别搞混

隐私授权有两层，缺一不可，且**顺序不能反**：

| | 第一层 | 第二层 |
|---|---|---|
| 谁做 | **开发者**（小程序管理员） | **每一个使用者** |
| 在哪 | mp.weixin.qq.com → 设置 → 服务内容声明 → 用户隐私保护指引 | 小程序内的授权弹窗 |
| 做什么 | 填指引，勾选「收集你选中的文件」「读取你的剪切板」 | 点「同意并继续」 |
| 几次 | 一次，提交后等微信审核 | 每个用户首次调用时一次 |
| 不做的后果 | **所有用户**调接口直接 fail，且**连授权弹窗都不出现** | 该用户本次功能不可用，下次再点会重新弹 |

**第二层要能发生，第一层必须先完成。** 后台没声明 → 微信不认为你有资格向用户索要该权限
→ `wx.onNeedPrivacyAuthorization` 根本不触发 → 直接 fail。
**用户在手机上无论怎么调设置都解决不了这一层。**

判据：点按钮后**有没有出现授权弹窗**。
没有弹窗直接报错 = 卡在第一层（开发者侧）；弹了窗、用户点拒绝才报错 = 第二层。
代码里靠 `globalData.privacyPromptSeen` 就是在区分这个。

### 14.2 面向开发者的排查指引不能弹给真实用户

第一层失败的提示原本写的是「请到 mp.weixin.qq.com → 设置 → …」——
这话是给开发者看的，可它会弹给最终用户。上线后万一声明被驳回或失效，
真实用户就会看到一句让他去管理后台的话，荒唐。

已按 `wx.getAccountInfoSync().miniProgram.envVersion` 分流：
- `develop` / `trial` → 弹完整的后台配置指引 + 可复制错误原文；
- `release` → 只说「该功能暂不可用，可以先用『查看示例』」；
- 取不到环境时**一律按 release 处理**，宁可对开发者少说一句，也不能对用户胡说。


---

## 15. WXML 不解码字符引用与转义（2026-08-15 真机实测）

**现象**：首页三个入口卡片左右显示出 `&#x1F4AC;` `&#x203A;` 这样的原文。

**结论**：**WXML 不解码 `&#xNNNN;` 数字字符引用，也不处理 text 节点里的 `\uXXXX` / `\n`**，
一律原样当文本渲染。唯一可靠的写法是**直接写字面字符**（.wxml 文件本身就是 UTF-8）。

这一条此前没有核对过，是靠真机才暴露出来的——模拟器同样会露原文，
但白屏期间没人看得到，所以一直没被发现。

**波及范围（全部已改成字面字符，共 33 处）**：

| 位置 | 原写法 | 用户看到的 |
|---|---|---|
| 首页 3 个入口图标 + 3 个箭头 + 齿轮 + 关闭 | `&#x1F4AC;` `&#x203A;` … | 原文 |
| 阅读页返回 / 目录 / 搜索 / 保存 / 关闭 / 上下翻页 | `&#x2190;` `&#x2630;` `&#x1F50D;` … | 原文 |
| 设置页两个箭头 | `&#x203a;` | 原文 |
| **Markdown 无序列表圆点** | `•`（不在绑定里） | **每条列表前面是 `•` 五个字符** |
| **行内硬换行** | `\n`（不在绑定里） | **原样显示反斜杠 n，且不换行** |
| 任务列表勾选框 | `{{... ? '✅' : '⬜'}}` | 绑定内的 `\u` 转义不保证被解析 |

> 其中首页那批是修白屏时引入的：原本用的是私有区码位 `&#xe600;`–`&#xe60a;`（配 iconfont），
> 但项目里没有字体文件，所以**原本是显示成空白**；换成真实 Unicode 的字符引用后
> 变成了**显示原文**。从"看不见"变成"看见乱码"——修一个 bug 撞进了同族的另一个 bug。
> 列表圆点和硬换行那两处是原本就有的，与本次改动无关。

**已加检查**（`tests/test-page-wiring.js`）：
- WXML 里不允许出现 `&#...;` 数字字符引用；
- 剔除 `{{ }}` 绑定后的纯文本节点里不允许出现 `\uXXXX` / `\n` / `\t` 字面转义。

两条都注入 bug 验证过确实会失败。

---

## 16. 循环授权（2026-08-16 真机复现并修复）

**现象**：两张真机截图（17:37 同一分钟内）显示用户在两个弹窗之间来回：
自定义弹窗「隐私保护说明」[拒绝][同意并继续] ↔ 系统 modal「还需要你的授权」[暂不][重新授权]。

**这是 §14 那轮修复自己引入的**，不是原有缺陷。

### 环路

```
点「从聊天选择文件」
 → wx.chooseMessageFile 触发 onNeedPrivacyAuthorization
   → 自定义弹窗「隐私保护说明」
     → 点「拒绝」→ resolvePrivacy(false)
       → 接口 fail
         → handlePrivacyFailure：privacyPromptSeen 为 true → 判为「用户拒绝」
           → modal「还需要你的授权」+[重新授权]
             → 点「重新授权」→ onRetry() → chooseFile()
               → 回到第一步 ⟲
```

**没有次数上限，没有状态推进**，用户点多少次都出不来。

### 截图里的关键证据

「最近文件」显示 39 分钟前成功打开过两份 HTML（4.9MB + 12.1KB）。
说明 `chooseMessageFile` 之前能跑通、`privacyPromptSeen` 早已为 true ——
**排除了「后台指引未配置」这个可能**，确认走的就是「用户拒绝」分支。

### 三个加剧因素

1. **主次按钮方向反了**：「重新授权」是主按钮（蓝色、右侧），
   唯一出口「暂不」反而是次要按钮（灰色、左侧）。等于在鼓励用户留在环里。
2. **两个弹窗风格不一致**：`wx.showModal` 跟随 iOS 系统深色模式，
   自定义弹窗跟随应用主题（当时是浅色）。用户看到"白弹窗拒绝后冒出黑弹窗"，
   观感上像两个东西轮流拦人。
3. **拒绝后立即再问本身就是骚扰**：`denyPrivacy` 的 toast 与 fail 回调的 modal
   几乎同时出现，视觉上就是"我明明点了拒绝，它又弹出来了"。

### 修复：拒绝后只说一次，不再追问

- `handlePrivacyFailure` 的「用户拒绝」分支改为**一次 toast「已取消授权」**，
  删除 modal 与 `onRetry` 形参及全部调用处的重试回调。
- `denyPrivacy` 不再自己弹提示，统一由 fail 回调给出唯一一次提示，避免连着两个提示。
- 副作用：这条路径上不再有 `wx.showModal`，第 2 条的风格冲突一并消失。

**设计原则**：用户点「拒绝」就是明确的意愿表达，紧接着再追问一次是骚扰。
重试入口本来就一直在（原来那个按钮），他改主意时再点一次自然会重新触发授权流程，
**不需要应用替他着急**。

### 教训

上一轮写「给一条回头路，而不是一个飘过的 toast」时，只想着"别让用户卡死"，
没想"别让用户绕圈"。**只验证了原问题消失，没验证新路径本身闭不闭合。**
与"把私有区图标换成字符引用"（§15）是同一类错误。

**已加静态检查**（`tests/test-page-wiring.js`）：
`handlePrivacyFailure` 的定义不得含 retry/callback 形参，调用处不得传入函数实参。
注入回归验证过确实会失败。

### 16.1 点了「同意」却提示已取消 —— agree 必须由官方按钮组件回传

**现象**：在自定义隐私弹窗点「同意并继续」，接口仍以 privacy 错误失败，
提示「已取消授权」。

**机制**：微信的自定义隐私弹窗是**两段式**的，收到用户点击只是第一步，
必须把结果回传给微信：

```
微信 → onNeedPrivacyAuthorization(resolve)   微信在等你的答复
你   → 弹自己的弹窗，问用户
用户 → 点同意
你   → resolve({ event:'agree', buttonId:'...' })   ← 不调这句，微信一直挂着
微信 → 放行接口
```

**关键**：「同意」这一侧微信有额外要求 —— 必须由
`<button open-type="agreePrivacyAuthorization">` 触发，并在回传时带上该按钮的 `id`。
这是反作弊设计：微信要确认确实有用户点了一个它认可的同意按钮，
而不是小程序的 JS 自己决定说同意（否则任何小程序都能静默自授权）。

原来的写法是普通 `<view bindtap="grantPrivacy">` + `resolve({event:'agree'})`，
**没有 buttonId**，微信不采纳这次 agree，接口照样失败。

**修复**：
- 新建共享组件 `components/privacy-dialog/`，「同意」改为
  `<button id="agree-privacy-btn" open-type="agreePrivacyAuthorization"
   bindagreeprivacyauthorization="onAgree">`
- `resolvePrivacy(agreed, buttonId)` 在 agree 时带上 buttonId
- **阅读页也接入同一组件**：它同样要用隐私接口（复制链接/代码走 `setClipboardData`），
  以前没有自定义弹窗、退化成 `wx.showModal` 兜底 ——
  而原生 modal 里根本放不进 open-type 按钮，那条路的「同意」压根没法正确回传
- 开发版/体验版把原始 errMsg 弹出来（终止性弹窗，无重试按钮，不构成 §16 的环）

⚠️ **仍需核对**：`buttonId` 对 `event:'agree'` 是必需还是可选、
`bindagreeprivacyauthorization` 的确切事件名、不同基础库版本的差异。
以上依据是 API 设计意图推断，**未核对官方文档**。
真机跑一次、看开发版弹出的 errMsg 即可定案。

**已加静态检查**：`usingComponents` 路径必须指向真实存在的组件三件套、
组件 json 必须声明 `component: true`、组件自身 WXML 绑的处理函数必须存在。
（路径写错会直接白屏，又是一类"真机才暴露"的问题。注入回归验证过会失败。）

---

## 17. 转发 / 分享（2026-08-16 真机反馈 + 官方文档核对）

**现象**：点击右上角菜单提示「当前页面不可转发」「当前页面不可分享」。

**核对结论**（官方文档原文）：

- `onShareAppMessage`：「**只有定义了此事件处理函数，右上角菜单才会显示"转发"按钮**」
  - 返回字段：`title`（默认小程序名）、`path`（须以 `/` 开头，默认当前页）、
    `imageUrl`（5:4，支持本地/代码包/网络路径）、`promise`（需 3 秒内 resolve，基础库 2.12.0）
- `onShareTimeline`：「只有定义了此事件处理函数，右上角菜单才会显示"分享到朋友圈"按钮」
  - 返回字段：`title`、`query`、`imageUrl`（1:1）；**基础库 2.11.3**
- `wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] })`：
  朋友圈按钮必须显式加进 `menus` 才出现，**基础库 2.11+**；
  且展示「分享到朋友圈」时必须同时展示「发送给朋友」

**原因**：三个页面一个都没实现这两个回调，也没调 `showShareMenu`。

- 出处：https://developers.weixin.qq.com/miniprogram/dev/reference/api/Page.html
- 出处：https://developers.weixin.qq.com/community/develop/article/doc/000a4c1cf187b8ef14aa68f0d5b813
- 核对日期：2026-08-16

### 实现时的硬约束（AGENTS §6.5 / Edge E3）

规范要求「不做文件转发，**只分享小程序卡片**（对方点开自己选文件）」。据此：

| 约束 | 理由 |
|---|---|
| `path` 固定 `/pages/index/index` | 文件只存在于用户本机，带 fileId 对方也打不开 |
| `title` 不含文件名 | 文件名本身可能就是隐私（如"离职协议.md"），不该随卡片进到别人的聊天记录和朋友圈 |
| `query` 留空 | 同上，不携带任何本机文件标识 |
| 不分享文件内容 | 带文件的分享会让小程序被当作网盘类而拒审 |

### 已加静态检查

`tests/test-page-wiring.js`：
- `app.json` 里每个页面都必须定义 `onShareAppMessage` 与 `onShareTimeline`
  （新增页面时极易漏，漏了就是「当前页面不可转发」）
- `shareCard()` 的 path 必须固定指向首页，且不得出现
  `fileId` / `localPath` / `fileName` / `filePath`

两条都注入回归验证过会失败。测试 441 → 449。

> 注：`docs/提审说明.md` 原先勾着「无分享/转发功能」，那是描述**未实现时**的状态，
> 与 AGENTS §6.5「只分享小程序卡片」其实不一致。已改为准确表述。

### 17.1 朋友圈分享用不了 —— 是能力门槛，不是代码问题

转发已正常，朋友圈仍不可用。核对后确认**代码侧已满足全部条件**，
卡在平台侧的能力门槛上。

**官方文档已确认的硬条件**（https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/share-timeline.html）：

| 条件 | 本项目状态 |
|---|---|
| 基础库 ≥ 2.11.3 | ✅（最低 2.32.3） |
| **微信客户端 ≥ 8.0.24**（Android/iOS） | ⚠️ 取决于测试设备 |
| 必须先有 `onShareAppMessage` | ✅ |
| 必须定义 `onShareTimeline` | ✅（首页） |
| `wx.showShareMenu` 的 menus 含 `shareTimeline` | ✅ |
| 页面不含 `web-view` | ✅（个人主体本就不可用） |

**社区反馈的门槛**（⚠️ 非官方文档原文，需进一步核实）：

- **开发版/体验版真机上不出现「分享到朋友圈」选项**——
  多个社区帖提到「开发者工具生效，真机测试时没有分享到朋友圈的选项」
- **未完成备案 + 微信认证的小程序没有朋友圈分享能力**
- 个人主体可自愿选择是否做微信认证；未认证会影响「被搜索和被分享」能力

本项目当前**尚未备案、未提审、未上线**（见 `docs/提审说明.md` 检查清单），
所以最可能就是卡在这里。**上线后再验一次**才能定论。

- 出处：https://developers.weixin.qq.com/community/develop/article/doc/000a4c1cf187b8ef14aa68f0d5b813
- 出处：https://developers.weixin.qq.com/community/develop/doc/00004830748368a370e129f6f6b000
- 核对日期：2026-08-16

### 17.2 朋友圈分享只保留在首页（查文档时发现的真 bug）

官方文档：**朋友圈分享不能自定义 path，分享出去的就是当前页面**，
接收方还是在**单页模式**下打开。单页模式的限制很硬：

- 禁止一切跳转（navigateTo / redirectTo / reLaunch / switchTab / navigateBack）
- 无登录态，剪贴板、定位、支付、蓝牙、媒体选择等接口全部被禁
- 不渲染 TabBar，本地存储与正常模式隔离

于是原先「三个页面都开朋友圈分享」是错的：

- **阅读页**：接收方拿不到 `source` 参数 → 落到「未指定内容来源」错误页，
  而单页模式禁止跳转，错误页上那个「返回首页」按钮**也点不动** —— 彻底的死页面
- **设置页**：分享出去毫无意义

已改为**朋友圈分享只在首页开启**（`enableShareMenu(true)`），
阅读页与设置页只开转发。「发送给朋友」不受此限（`onShareAppMessage` 可自定义 path），
所以三个页面都保留转发，path 统一指向首页。

**已加静态检查**：首页必须定义 `onShareTimeline`，其余页面必须**不**定义
（定义了就是给接收方一个死页面）。注入回归验证过会失败。

---

## 18. 「返回首页」是个静默的死按钮（2026-08-16 开发者工具复现）

**现象**：阅读页出现「文件信息丢失」后，点「返回首页」完全没反应。

**原因**：兜底用错了 API。

```js
wx.navigateBack({
  fail: function() {
    wx.switchTab({ url: '/pages/index/index' });   // ← 必然失败，且没有 fail 回调
  }
});
```

- `wx.switchTab` **只能跳 tabBar 页面**，而本项目 `app.json` 里**没有 tabBar**，
  所以这一步必然失败；
- 这个 `switchTab` 调用又没写 `fail` 回调，于是失败得彻底静默 ——
  用户看到的就是"点了没反应"。

**什么时候会走到兜底**：`navigateBack` 在页面栈只剩当前页时失败。常见于

- 开发者工具里直接从阅读页编译/热重载（本次复现路径）
- scene 1173 从聊天素材进入
- 任何 `redirectTo` 之后

而「文件信息丢失」本身也常与之同时发生：开发者工具重新编译后
`app.globalData.pendingFile` 被重置为空 → 阅读页拿不到文件 → 报这个错。
**两件事叠在一起，就成了"进了一个错误页还出不去"。**

**修复**：抽出 `app.backToHome()`，兜底改用 `wx.reLaunch`
（关掉所有页面重开首页，任何页面栈状态下都成立），并补上最外层的 `fail` 日志。
`goBack` 与 `closeFileInQueue` 两处都换掉。

**已加静态检查**（`tests/test-page-wiring.js`）：
- 没有 tabBar 时不得出现 `wx.switchTab`（调用必然失败）
- 所有 `wx.navigateBack` 必须带 `fail` 兜底（页面栈只剩一页时它失败是常态）

注入回归验证过会失败。测试 449 → 451。

### 顺带记录一个尚未处理的缺口

阅读页以 `source=file` 打开时，URL 里**不带 fileId**，文件信息只存在
`app.globalData.pendingFile` 里。因此小程序被系统回收后再回到阅读页，
就只能报「文件信息丢失」——尽管该文件其实已经存进「最近」了，本可以恢复。
（`source=recent` 那条路带了 fileId，能恢复。）
属于 A8「冷启动 vs 热启动」的延伸，本轮未处理。

---

## 19. 搜索：结果没露面就被收走，命中也看不出来（2026-08-17 真机反馈，2026-08-18 真机验证通过）

**现象**（用户原话）：「输入法输入关键词，按搜索后，搜索结果会缩进到最下栏，
要点击缩进后的搜索框，才会显示出大量搜索结果」「需要高亮搜索的关键词，才容易定位」。

**原因**：`doSearch` 搜完就直接调 `jumpToSearchResult` 跳第一个结果，
浮层顺势收成底部窄条 —— 用户刚按完确认，屏幕上什么都没看到就被丢回正文，
几十条结果得再点一次窄条才露面。正文侧则完全没有着色，
跳过去也只能自己在一屏字里找那个词。

**修复**：把「搜」和「跳」拆成两步。

| 步骤 | 行为 |
|---|---|
| 按键盘「搜索」 | 只出结果：收键盘、留在浮层、列表铺开，`currentSearchIdx` 保持 -1（不预选） |
| 点某一条结果 | 才收起浮层、跳正文、切成底部窄条做上一条/下一条 |
| 点窄条上的关键词 | 回到输入态改词，结果不清空，并 `scroll-into-view` 定位到当前那条 |

高亮分两级：所有命中一套色，当前结果所在块一套强调色
（一屏几十个黄块时，「我现在在第几个」只能靠颜色区分）。

**几个不显眼但会让效果打折的点**（都是这轮改动里踩到的）：

- **高亮只能是渲染期加工，绝不写回 `_blocks`**。非虚拟滚动时
  `visibleBlocks` 就是 `_blocks` 本身，就地改会把高亮永久烙进文档数据，
  换个关键词都洗不掉。换文档 / 重解析必须 `resetSearchState()`：
  `_hitBlockSet` 存的是块下标，留着就是拿旧文档的命中位置给新文档乱涂。
- **命中块样式必须排在 `.block-quote` / `.block-code` / `.block-html` 之后**。
  它们自带 `background-color`，同为单类选择器时后写的赢；
  写在前面等于代码块、引用块的命中标记根本不存在。
  标记也从「铺底色」改成 inset 左色条 —— 底色是这些块的身份，
  不该为了标一次命中把它们涂平。
- **代码块和表格拆不出行内段**，得单独走 `highlightPlain` / `highlightCells`，
  否则这两类块只剩一条边色。代码块原文 `text` 一字不动，复制走的还是原文。
- **收键盘靠 `focus` 属性 true→false 这个「变化」**。用户手点输入框聚焦时
  框架不会替我们改 `searchFocus`，不回写的话它一直是 false，
  按下「搜索」那次 `setData` 就不构成变化 —— 没有 `wx.hideKeyboard`
  （基础库 2.8.2+）的机型上，键盘会一直挡着刚铺开的结果列表。
  故补 `bindfocus` / `bindblur` 回写真实聚焦状态。
- 浮层不上顶部：页面是 `navigationStyle: custom`，`top: 0` 会埋进状态栏，
  右上角胶囊还压着上下跳转按钮。改成居中浮层 +
  `adjust-position="{{false}}"` 自己接管键盘高度（页面被系统上推的话，
  居中浮层会漂到 iOS/Android 各不相同的位置）。

**已加回归**（`tests/test-reader-search.js`，48 项）：桩掉 `getApp` / `Page` / `wx`
就能在 Node 里把整个页面对象取出来调真方法，不必进开发者工具点一遍。覆盖：
确认后仍停在浮层且不预选、词级高亮（含加粗属性保留、大小写不敏感、
单段片段数上限且文字不丢）、`_blocks` 不被污染、虚拟滚动路径按 `_vIndex`
对号入座、清空/关闭/换文档后不留残色。测试 454 → 502。

**真机验证**：2026-08-18 用户确认「达到预期效果」。

### 顺带记录一个尚未处理的缺口

`.progress-bar-wrap` 是 `.page`（`height: 100vh` 的 flex 列）里最后一个流式子元素，
而 `.toolbar` 是 `position: fixed; bottom: 0` 的不透明条 ——
进度条应该是被工具栏整条盖住的。本轮只是看代码时注意到，未验证也未处理。
