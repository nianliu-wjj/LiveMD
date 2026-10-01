# LiveMD

简洁高效的即时渲染 Markdown 编辑器，支持 Windows / macOS / Linux。

LiveMD 基于 Tauri 2 + Vue 3 构建，编辑内核为自研的 LiveMD 引擎（ProseMirror），采用「语法标记即真实文本」的即时渲染方案，目标是在本地隐私优先的前提下提供媲美 Typora 的书写体验。

> [!TIP]
> LiveMD 是纯本地应用，文档内容只保存在你的设备上；除可选的更新检查与用户自行配置的图床上传外，无任何网络行为。

## ✨ 特性

### 书写与渲染

- **📥 即时渲染** - 自研引擎，语法标记随光标动态显隐，所见即所得（支持嵌套语法与转义字符）
- **📝 双模式编辑** - 即时渲染模式与高级源码模式一键切换，源码模式自带行号与长行折行
- **✍️ 丰富行内样式** - 粗体、斜体、删除线、高亮、上下标、行内代码、链接与行内 LaTeX 公式
- **🧮 公式与图示** - KaTeX 数学公式（行内/块级）、Mermaid 图表（代码 / 混合 / 图表三种显示模式，配色随主题自动派生）
- **💻 代码块** - 30+ 种语言语法高亮（CodeMirror 6）、一键复制、长代码块自动折叠预览（`Ctrl+[`），围栏语言可下拉切换
- **📋 表格** - 所见即所得的表格编辑、行列快捷操作、一键对齐格式化
- **🧩 容器语法** - `:::` 自定义容器与 `[!NOTE]` / `[!TIP]` 等引用提示块
- **🧷 HTML 块与行内 HTML** - `<br />`、`<sub>` 等直接渲染，未知块级 HTML 以块视图呈现

### 外观与主题

- **🎨 多主题** - 内置 17 套主题：normal / crepe / frame 三族明暗六套经典主题，Dracula、Atom One、Solarized 三族明暗六套，以及源自 Typora 官方的 GitHub / 新闻纸 / 夜晚 / Pixyll / 素白五套
- **🖌 主题编辑器** - 可视化编辑全部 38 个主题变量（21 个应用变量 + 17 个编辑器变量），支持草稿恢复、基于现有主题派生、导入导出
- **🧬 Typora 主题导入** - 一键把 Typora 官方主题的排版与配色转换为 LiveMD 适配样式（详见下文「主题系统」）
- **🧘 专注 / 打字机模式** - 当前段落保持高亮适中，其余段落自动淡出

### 文件与窗口

- **🗂 多标签页** - 标签拖拽重排；拖出窗口即撕离为独立窗口，拖到其他窗口自动合并（含全部竞态修复的回归测试）；关闭最后一个标签页回到首页，不关闭窗口
- **🖥 原生窗口交互** - Windows 拖动与双击缩放标题栏，macOS 原生红绿灯与圆角外观
- **🔒 只读模式** - 状态栏右侧一键锁定：编辑器不可编辑，右键菜单的修改项置灰（仅当前会话生效，不写入配置）
- **📤 导出** - PDF（Rust 打印管线，Windows / macOS / Linux 全平台）与 Word 文档（.docx）导出
- **🖼 图片插入规则** - Typora 式规则：复制到 ./assets、当前文件夹、./${filename}.assets 或自定义目录；本地位置与网络位置的图片可分别决定是否应用；可按 YAML front matter 自动上传；图片语法偏好（相对路径、./ 前缀、插入时 URL 转义）可调，图床可自定义
- **📁 本地文件管理** - 打开文件夹作为工作区，Windows 下支持 WSL UNC 路径编辑与变更监听
- **🔖 书签** - `Alt` + 点击任意段落添加书签，跨文件快速跳转
- **🔎 工作区搜索** - 全工作区全文检索（支持大小写敏感与正则），列表式结果定位
- **📑 大纲导航** - 自动生成文档大纲，快速跳转与定位
- **🛠 文档工具** - 标题升降级、选区提取为新文件、中英文间自动补空格、拼写检查
- **🔢 文件名自然排序** - 文件树中的数字按数值排序（1, 2, 3, …, 10, 11），章节文件不再乱序

## 🚀 快速开始

### 环境要求

| 工具 | 版本 |
| --- | --- |
| Node.js | ≥ 20.17.0 |
| pnpm | ≥ 10.0.0 |
| Rust | 最新稳定版（Tauri 2 要求） |
| 系统依赖 | Windows：WebView2；Linux：`libgtk-3` `libwebkit2gtk-4.1` 等；macOS：Xcode Command Line Tools |

### 开发运行

```bash
# 安装依赖
pnpm install

# 启动桌面开发环境（Tauri 窗口 + Vite 热更新）
pnpm dev

# 仅启动前端（纯 Web 预览，无 Tauri 外壳）
pnpm dev:web
```

### 构建

```bash
# 构建当前平台安装包
pnpm build

# 指定平台
pnpm dist:win-x64
pnpm dist:mac-x64
pnpm dist:mac-arm64
pnpm dist:linux-x64
pnpm dist:linux-arm64
```

## 🎨 主题系统

内置主题由 `src/themes/` 下的 Less 变量定义与 `src/themes/builtin-themes.json` 目录共同驱动，切换主题无需重启。

### 内置主题

| 主题族 | 亮色 | 暗色 |
| --- | --- | --- |
| 经典 | normal / crepe / frame | normal-dark / crepe-dark / frame-dark |
| Dracula | dracula | dracula-dark |
| Atom One | one | one-dark |
| Solarized | solarized | solarized-dark |
| Typora 官方 | github / newsprint / pixyll / whitey | night |

### 导入 Typora 官方主题

项目自带导入脚本，可将 Typora 官方主题转换为适配 LiveMD 编辑器的 CSS 与调色板：

```bash
# 默认读取 third-party/typora-official/themes
pnpm import:typora-themes

# 也可以指定目录
pnpm import:typora-themes <主题目录>
```

脚本产物会写入：

- `src/renderer/public/typora-themes/` - 转换后的 CSS 与随附字体资源
- `src/themes/builtin-themes.json` - 内置主题目录
- `src/renderer/public/theme-bootstrap.js` - 渲染前注入的主题兜底脚本

> [!NOTE]
> Windows 版 Typora 发行包仅自带 5 套官方主题（github / newsprint / night / pixyll / whitey）。若本地没有该目录，可从本机 Typora 安装路径（如 `resources/style/themes`）拷贝至 `third-party/typora-official/themes` 后再执行导入。

## 🧭 项目结构

```
├── src/
│   ├── core/               # LiveMD 编辑器内核（解析器/序列化器/NodeView/插件/样式）
│   ├── renderer/           # 主界面（组件、hooks、平台适配层、i18n）
│   ├── themes/             # 主题 Less 定义与内置主题目录
│   ├── config/ ui/ shared/ types/ directives/ plugins/ main/
│   └── assets/             # 图标等静态资源
├── src-tauri/              # Tauri/Rust 后端（窗口、文件、搜索、导出、更新等命令）
├── test/                   # node:test 单元测试（标签页合并竞态、WSL 监听、表格格式化等）
├── scripts/                # 图标生成、Typora 主题导入、发布等脚本
└── docs/                   # 功能实现说明文档
```

## 🛠 开发命令

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 桌面端开发（Tauri + Vite 热更新） |
| `pnpm dev:web` | 仅前端 Web 预览 |
| `pnpm test` | 运行 `test/` 全部单元测试 |
| `pnpm lint` | oxlint 静态检查 + oxfmt 格式校验 |
| `pnpm format` | 自动修复 lint 问题并统一格式 |
| `pnpm build` | 当前平台构建 |
| `pnpm import:typora-themes` | 重新生成 Typora 主题产物 |
| `pnpm generate-icons` / `pnpm generate-tauri-icons` | 由 SVG 生成应用图标 |

## 📖 提交规范

提交信息遵循 `type(scope): 标题` 格式（由 `scripts/verify-commit.js` 自动校验），支持 `feat` / `fix` / `docs` / `refactor` / `perf` / `test` / `chore` 等类型，标题建议使用中文，例如：

```
feat(标签页): 支持拖拽撕离窗口与跨窗口合并
fix(界面): 修复标题栏与标签栏拖动失效，支持双击缩放
```

pre-commit 钩子会自动对暂存的 JS/TS/Vue/JSON 执行 oxlint 修复与 oxfmt 格式化。

## 🤝 参与贡献

欢迎提交 Issue 与 Pull Request：

1. Fork 并创建功能分支（`git checkout -b feature/xxx`）
2. 保证 `pnpm test` 与 `pnpm lint` 通过
3. 按上述规范提交，并发起 MR

## 📄 许可证

MIT © nianliu-wjj

## 维护者

当前维护者：nianliu-wjj <fire-phenix@foxmail.com>
