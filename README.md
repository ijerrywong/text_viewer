# 纯文本阅读器

一个**纯本地、零后端**的微信小程序：在微信里打开、阅读 Markdown / HTML / TXT 及各类纯文本文件（JSON、CSV、日志、源码）。

从 AI 那儿复制出来的内容，粘到微信里就变成一堆 `#` 和 `*`。这个小程序把那些符号翻译回它本来该有的样子——标题变回标题，表格变回表格。

**没有服务器，不联网，不登录。** 全部解析渲染都在你手机本地完成，文件内容传不出去。

---

## 特性

| | |
|---|---|
| **编码自动识别** | UTF-8（含 BOM）/ GBK / GB2312 / GB18030 / Big5 / UTF-16 LE·BE，识别误判时可手动切换 |
| **Markdown 渲染** | GFM 子集，按 CommonMark 的 delimiter run + flanking 规则做强调配对（`snake_case`、`$x_1$` 不会被吃字符）；表格、任务列表、代码高亮、目录跳转 |
| **HTML 渲染** | 自研轻量解析器 + Tailwind 类名展开、CSS 变量求值、伪元素合成、视口钳制、脚本降级可见化 |
| **全文搜索** | 确认后先出结果列表，选中才跳正文；命中关键词分两级着色（普通命中 / 当前结果所在块） |
| **阅读体验** | 虚拟滚动、字号行距字体调节、浅色/深色/护眼主题、阅读进度跨冷热启动恢复 |
| **安全消毒** | 剥离 `script` / `iframe` / `on*` 事件；外链点击 → 确认 → 复制，绝不直接跳转 |

三个入口：从聊天选择文件（`wx.chooseMessageFile`）、剪贴板粘贴、内置示例文档。

---

## 跑起来

需要[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)，基础库 **2.32.3+**（隐私保护接口的下限）。

```bash
git clone https://github.com/ijerrywong/text_viewer.git
cd text_viewer
```

然后：

1. **把 AppID 换成你自己的**。编辑 `project.config.json` 的 `appid` 字段——仓库里那个是原作者已上线小程序的 ID，你用它上传不了。没有 AppID 可以填 `touristappid` 用测试号模式，但隐私接口和 `supportedMaterials` 用不了。
2. 微信开发者工具 → 导入项目 → 选这个目录（`miniprogramRoot` 已配好指向 `miniprogram/`）。
3. 直接编译。**无需 npm install**——本项目零第三方依赖，没有 `package.json`，编码码表和解析器全是手写的。

### 跑测试

```bash
node tests/run-all.js
```

560 个断言，10 个测试文件，纯 Node 运行，不需要开发者工具。

核心模块全是**不依赖任何 `wx` API 的纯函数**（`core/detect`、`core/parse`、`core/sanitize` 等文件头都标了），所以能直接 `require` 进 Node 测。页面逻辑靠桩掉 `getApp` / `Page` / `wx` 把页面对象取出来，调真方法。

---

## 目录结构

```
miniprogram/
├── core/                     # 纯函数核心，不碰 wx API，可直接在 Node 里测
│   ├── detect/               # 类型识别 + 编码识别
│   ├── encoding/             # GBK / GB18030 / Big5 手写码表与解码器
│   ├── parse/
│   │   ├── md/               # block.js 块级 + inline.js 行内（CommonMark 配对规则）
│   │   └── html/             # tokenizer → converter → preprocess → postprocess → degrade
│   ├── sanitize/             # HTML 消毒
│   ├── highlight/            # 轻量语法高亮
│   ├── render/               # 渲染数据层（块级 IR → 视图数据）
│   ├── intake/               # 文件接入层（适配器模式，统一多来源）
│   └── store/                # 本地持久化 + LRU 缓存
├── pages/                    # index / reader / settings
├── subpackages/              # pkg-markdown、pkg-html（主包 ≤ 2MB 的硬约束）
├── workers/                  # 解析 Worker
└── components/privacy-dialog/

docs/                         # 设计与验证文档，见下
tests/                        # 10 个测试文件 + 脚本生成的编码语料
scripts/                      # 码表 / 语料 / 示例的生成脚本
samples/                      # 三份内置示例文档
```

---

## 值得一读的文档

这个项目的文档比代码更值得看——大部分坑是真机上踩出来的，模拟器复现不了。

| 文档 | 内容 |
|---|---|
| [`AGENTS.md`](AGENTS.md) | 项目宪法：产品定位、不可违反的硬约束、平台限制表。AI 编码代理和人类接手都先读这个 |
| [`docs/verify-notes.md`](docs/verify-notes.md) | **真机验证笔记，19 条**。每条是「现象 → 原因 → 修法 → 会让效果打折的暗坑」。全项目最有信息量的一份 |
| [`docs/产品架构设计.md`](docs/产品架构设计.md) | 架构决策与反悔成本分析 |
| [`docs/ADR-3-Markdown渲染选型.md`](docs/ADR-3-Markdown渲染选型.md) | 为什么最终自研而不用 mp-html |
| [`docs/Edge-Cases-清单.md`](docs/Edge-Cases-清单.md) | 边缘情况清单（用户会怎么用 + 微信会怎么做） |
| [`docs/代码审计-2026-08-15.md`](docs/代码审计-2026-08-15.md) | 一次完整的自审记录 |
| [`docs/隐私说明.md`](docs/隐私说明.md) | 隐私口径，每条承诺附可核验的代码位置 |
| [`docs/提审说明.md`](docs/提审说明.md) | 微信提审要准备的东西 |

几个可核验的事实（自己 grep 一遍就知道）：

| 承诺 | 核验方式 |
|---|---|
| 无任何网络请求 | 搜 `wx.request` / `uploadFile` / `downloadFile` / `connectSocket` → 零命中 |
| 不获取微信身份 | 搜 `wx.login` / `getUserProfile` / `getUserInfo` → 零命中 |
| 无第三方 SDK | 无 npm 依赖，无 `miniprogram_npm/`，无统计 / 广告 / 崩溃上报 |
| 无 web-view | 搜 `web-view` → 零命中 |

---

## 已知限制

- **HTML 保真度有物理上限**：个人主体不可用 `web-view`，AI 生成 HTML 的还原上限是「结构完整 + 静态样式 70–85%」。所有 JS 行为（图表、Mermaid、翻页）永久不可用——但会明确标一句「这里有一张图表」，不留空白让人以为文件坏了。
- **聊天素材打开（scene 1173）官方仅 Android 支持**，iOS 上入口根本不出现，且要上线后才有。所以 `wx.chooseMessageFile` 是保底主流程。
- **朋友圈分享需要备案 + 微信认证**，未认证的小程序没有这个能力。
- 只读查看器，不支持编辑 / 另存 / 导出。

---

## License

[MIT](LICENSE) © 2026 ijerrywong
