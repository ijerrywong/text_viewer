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
