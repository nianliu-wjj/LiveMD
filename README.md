# LiveMD

LiveMD 是面向本地文档的 Markdown 编辑器，采用 Tauri 2、Vue 3、TypeScript 与 Rust，编辑内核基于 ProseMirror。提供 Windows、macOS、Linux 桌面版本，以及 Android 和 HarmonyOS NEXT 打包工程。

## 功能

### 写作与内容渲染

- 即时渲染与源码编辑两种模式，语法标记随光标位置显隐。
- 支持标题、列表、引用、任务列表、表格、代码块、图片、链接，以及粗体、斜体、删除线、高亮、上下标等行内格式。
- KaTeX 行内和块级公式，Mermaid 图表与思维导图编辑界面。
- CodeMirror 代码高亮、源码编辑与代码格式化；提供文档格式检查、拼写检查、中英文间距处理等工具。
- 大纲、批注、书签、只读模式、编辑缩放、专注与打字机模式。

### 文档与工作区

- 多标签页、最近文件、工作区文件树、全文搜索和文件变更监听。
- 自动保存、关闭确认、外部修改提示、文件编码与换行特征处理。
- 桌面端原生文件选择、窗口操作、标签页跨窗口管理与文件关联。
- 图片插入规则、相对路径处理、图床配置，以及 PDF、Word 等导出能力。

### 外观与平台

- 内置明暗主题、主题变量编辑与 Typora 主题导入。
- 中文及英语、日语、韩语、俄语、法语界面词典。
- 移动端窄屏布局、触屏菜单与确认面板，通过系统选择器导入 Markdown 文件。
- 各平台应用图标统一来自 `src-tauri/icons/app-icon.svg`。

文档保存在本地。更新检查、远程图片与用户配置的图床等功能会按使用场景访问网络。

| 平台                    | 运行方式与能力边界                                              |
| ----------------------- | --------------------------------------------------------------- |
| Windows / macOS / Linux | Tauri WebView + Rust 后端，提供原生文件、窗口与系统服务         |
| Android                 | Tauri 移动工程；支持导入文件并保存到应用文档目录                |
| HarmonyOS NEXT          | ArkTS + ArkWeb 壳承载前端；文件导入和文档保存由鸿蒙原生桥接提供 |
| 浏览器预览              | 可调试界面与编辑器；依赖原生 IPC 的功能不能完整运行             |

移动端与桌面端的文件监听、导出、窗口和保存能力不完全相同。鸿蒙模拟器已验证文件选择器弹出；完整文件导入与设备适配应继续在目标设备上复验。

移动端阅读时，功能栏默认收起，点击悬浮按钮后展开。顶部保存按钮在阅读与编辑模式下均可用；新文档首次保存时输入文件名，已有文档直接保存。

## 技术栈与架构

| 层次           | 技术                                                   | 职责                                  |
| -------------- | ------------------------------------------------------ | ------------------------------------- |
| 应用界面       | Vue 3 Composition API、TypeScript、Less、VueUse        | 组件、交互、主题与响应式布局          |
| 编辑内核       | ProseMirror schema、state、view、transaction、plugins  | 文档模型、选区、编辑命令与即时渲染    |
| 代码编辑       | CodeMirror 6                                           | 源码模式、代码块编辑与语法高亮        |
| Markdown 管线  | 自研 parser / serializer，remark、rehype、unified      | Markdown 与编辑文档转换、相关渲染处理 |
| 公式与图示     | KaTeX、Mermaid、SVG.js                                 | 数学公式、图表与图形编辑              |
| 文档工具       | markdownlint、nspell、Prettier、sql-formatter          | 文档检查、拼写与格式化                |
| 桌面和安卓宿主 | Tauri 2、Rust、Tokio、notify、reqwest                  | 原生命令、异步 IO、文件监听与网络服务 |
| 鸿蒙宿主       | ArkTS、ArkWeb、DocumentViewPicker、Hvigor              | Web 资源承载、系统文件选择与 HAP 构建 |
| 前端构建       | Vite 7、pnpm                                           | 开发服务、依赖管理与产物打包          |
| 质量检查       | Node test runner、happy-dom、Playwright、oxlint、oxfmt | 回归测试、浏览器验证与静态检查        |

界面通过 hooks 组织文档状态与应用操作，平台服务将调用转发到 Tauri Rust 命令。编辑器通过 parser 将 Markdown 转为 ProseMirror 文档，插件处理输入和渲染，serializer 再将文档写回 Markdown。鸿蒙以虚拟域名 `https://livemd.local/` 加载 rawfile 中的前端资源，并通过 ArkTS 接入系统能力。

`window.electronAPI` 是保留的兼容接口名称，当前桌面构建使用 Tauri；package.json 中仍有历史 Electron 配置，实际打包入口以 Tauri 配置和脚本为准。

## 目录结构与职责

```text
LiveMD/
├─ src/
│  ├─ App.vue                 应用入口、会话恢复与全局事件协调
│  ├─ components/             编辑器、首页、工作区、菜单、设置、对话框等界面
│  ├─ core/                   Markdown 编辑内核
│  │  ├─ schema/              文档节点与 mark 定义
│  │  ├─ parser/              Markdown → ProseMirror 文档
│  │  ├─ serializer/          ProseMirror 文档 → Markdown
│  │  ├─ plugins/             即时渲染、语法同步与编辑行为
│  │  ├─ commands/ keymap/    编辑命令与键盘绑定
│  │  ├─ nodeviews/           代码、图片、公式等节点视图
│  │  ├─ scheduler/           渲染调度
│  │  └─ mindmap-engine/      移植的思维导图引擎
│  ├─ hooks/                  文件、标签、主题、配置、书签等状态与操作
│  ├─ service/                文件服务、API 与平台兼容层
│  ├─ shared/                 类型、通道与通用工具
│  ├─ events/ context/        事件分发与应用上下文
│  ├─ styles/ assets/         全局样式、主题与静态资源
│  └─ typings/ utils/         全局类型与辅助函数
├─ src-tauri/
│  ├─ src/commands/           Rust 原生命令
│  ├─ src/lib.rs              插件与命令注册
│  ├─ src/file_format.rs      文本归一化和文件特征恢复
│  ├─ src/watcher.rs          文件监听
│  ├─ icons/                  图标母版与桌面图标
│  ├─ gen/android/            指向根目录 android/ 的 Tauri 兼容入口（忽略入库）
│  └─ tauri.conf.json         应用标识、构建、权限与打包配置
├─ android/                   Android 原生工程源码
│  ├─ app/                   Manifest、Kotlin 宿主、资源与应用构建配置
│  ├─ buildSrc/              Gradle 与 Rust 构建桥接
│  └─ gradle/                Gradle Wrapper
├─ harmony/                   ArkTS 壳、资源与 Hvigor 工程
├─ lang/                      国际化词典与生成的翻译函数
├─ public/                    公共资源与导入的主题素材
├─ scripts/                   图标生成、鸿蒙同步、发布与维护工具
├─ test/                      Node 回归测试
├─ vite.config.mts            前端入口、别名、Worker 与国际化配置
├─ MOBILE.md                  移动端环境与打包说明
└─ pnpm-lock.yaml             锁定 JavaScript 依赖
```

`android/` 和 `harmony/` 中的工程源码纳入 Git。`dist/`、`node_modules/`、Rust target、移动端构建缓存、Tauri 自动生成的 Android 依赖配置与签名文件为本地产物。鸿蒙 `rawfile/www` 由脚本同步，不应手工修改。

Tauri CLI 固定使用 `src-tauri/gen/android/`。脚本会在该路径创建指向根目录 `android/` 的目录联接（Windows junction，macOS/Linux 符号链接）；兼容入口不入库，重新克隆后由 `pnpm android:prepare` 建立。

## 开发环境与启动

推荐 Node.js 22.18+ 或 24 LTS，以支持项目测试脚本中的 TypeScript 类型剥离。package.json 当前指定 pnpm 12.21.0；Rust 使用稳定版（Cargo 声明最低 1.77.2，实际要求还受 Tauri 依赖影响）。

| 系统    | 原生开发依赖                                            |
| ------- | ------------------------------------------------------- |
| Windows | Visual Studio C++ Build Tools、Windows SDK、WebView2    |
| macOS   | Xcode Command Line Tools                                |
| Linux   | C/C++ 工具链、GTK 3、WebKitGTK 4.1、相关 Tauri 系统依赖 |
| Android | Android SDK、NDK、JDK 和 Rust Android targets           |
| 鸿蒙    | DevEco Studio 与工程配置匹配的 HarmonyOS SDK            |

```bash
git clone https://github.com/nianliu-wjj/LiveMD.git
cd LiveMD
pnpm install
pnpm dev
```

只调试前端时：

```bash
pnpm dev:web
```

Vite 默认使用 5173 端口，Tauri 的 `devUrl` 也指向该端口。改动端口时需同步调整 `src-tauri/tauri.conf.json`。

当前 pnpm-workspace.yaml 中的 allowBuilds 值仍为占位文本，pnpm 12 安装前应将 esbuild、sharp、simple-git-hooks 设置为布尔值；pnpm 12 的 overrides 等配置也应放到工作区配置中，而非依赖旧 package.json.pnpm 字段。

## 二次开发

### 修改界面与业务行为

从 `src/components/` 找到对应页面，在 `src/hooks/` 中调整状态和业务操作。新增跨组件通知时检查 `src/events/` 与相关事件监听，避免组件重复订阅。通用控件放入 `src/components/ui/`，应用主题与窄屏规则分别查看全局样式和 `src/styles/responsive.less`。

### 扩展 Markdown 编辑能力

新增语法应同时处理 schema、parser 和 serializer；需要交互节点时增加 nodeview，再接入 plugins、commands 或 keymap。至少验证解析、编辑、序列化和重新打开的往返结果，特别关注选区位置、嵌套语法、空内容和行内图片等场景。

### 增加原生或移动能力

桌面与安卓命令在 `src-tauri/src/commands/` 实现，在 `src-tauri/src/lib.rs` 注册，随后更新 `src/service/platform/tauriElectronCompat.ts` 与共享类型。检查平台 cfg 和权限，避免桌面专用依赖进入移动构建。

鸿蒙能力在 `harmony/entry/src/main/ets/` 实现。ArkWeb 文件选择器由 `pages/Index.ets` 接入；需要后端能力时应明确设计 ArkTS 与前端通信，而不能直接调用 Tauri invoke。

### 调整主题、国际化与品牌

- 主题：检查 `useTheme`、主题编辑组件和样式变量；可用 `pnpm import:typora-themes` 更新导入主题。
- 国际化：词典为 `lang/index.json`，构建插件会更新生成文件。设置 `LIVEMD_ENABLE_TRANSLATE=1` 才启用在线翻译；默认使用空翻译器，新增词条应人工补齐语言。
- 品牌：修改 `src-tauri/icons/app-icon.svg` 后运行 `pnpm generate-tauri-icons`、`pnpm generate-icons` 和 `pnpm generate-mobile-icons`。
- 应用标识与版本：同时检查 package.json、Cargo.toml、Tauri 配置和鸿蒙 AppScope，避免平台间版本信息不一致。

### 验证改动

```bash
pnpm test
pnpm lint
pnpm build:web
cargo check --manifest-path src-tauri/Cargo.toml
```

按任务运行相关测试文件也可使用 `node --experimental-strip-types --test test/mobile-file.test.mjs`。涉及文件选择器、软键盘、剪贴板和原生导出时，还需使用对应平台模拟器或设备验证。

提交钩子会运行 lint-staged。生成的 `lang/index.js` 被 oxlint 忽略，单独将它交给 oxlint 可能报 No files found；可先完成项目级检查，再修正钩子的文件匹配配置。

## 构建与打包

### 前端与桌面

```bash
pnpm build:web    # 输出 dist/
pnpm build        # 当前系统的 Tauri 安装包
```

Tauri beforeBuildCommand 会自动构建前端。桌面打包产物位于 `src-tauri/target/release/bundle/`，显式指定 target 时位于对应 target 子目录。跨平台命令需要匹配的工具链、系统库和签名环境，通常在目标系统或 CI 中运行。

| 目标                | 命令                    |
| ------------------- | ----------------------- |
| Windows x64         | `pnpm dist:win-x64`     |
| macOS Intel         | `pnpm dist:mac-x64`     |
| macOS Apple Silicon | `pnpm dist:mac-arm64`   |
| Linux x64           | `pnpm dist:linux-x64`   |
| Linux ARM64         | `pnpm dist:linux-arm64` |

### Android

安装 Android SDK、NDK 和匹配 JDK，配置 JAVA_HOME、ANDROID_HOME、NDK_HOME；按需要添加 Rust target：

```bash
rustup target add aarch64-linux-android
pnpm android:prepare
pnpm android:init
pnpm android:dev
pnpm dist:android-apk
pnpm dist:android
```

`android:prepare` 准备兼容入口；首次使用本机工具链时执行 `android:init` 补齐 Tauri 生成配置。初始化、开发与打包命令均使用项目脚本，并更新 Android launcher 图标。Android Studio 打开根目录 `android/`；APK/AAB 输出在 `android/app/build/outputs/`，正式发布需要配置签名。完整步骤见 [MOBILE.md](MOBILE.md) 和 [Android 工程说明](android/README.md)。

### HarmonyOS NEXT

```bash
pnpm install
pnpm dist:harmony
```

在 DevEco Studio 打开 `harmony/`，使用与 build-profile.json5 一致的 SDK，配置签名并运行或构建 HAP。也可在配置好的 Hvigor 环境中执行：

```bash
cd harmony
hvigorw assembleHap --mode module -p product=default -p module=entry@default
```

模块构建入口会检查前端源码指纹，变化时重新构建 Vite 并同步到 `entry/src/main/resources/rawfile/www`，同时更新项目图标。HAP 输出位于 `harmony/entry/build/default/outputs/default/`。未签名包的安装能力取决于调试环境，正式分发需要签名。详见 [鸿蒙工程说明](harmony/README.md)。

## 常用维护命令

| 命令                         | 用途                     |
| ---------------------------- | ------------------------ |
| `pnpm format`                | 静态问题自动修复与格式化 |
| `pnpm generate-icons`        | 文件关联与兼容图标生成   |
| `pnpm generate-tauri-icons`  | 桌面 Tauri 图标生成      |
| `pnpm generate-mobile-icons` | Android 与鸿蒙图标生成   |
| `pnpm import:typora-themes`  | 更新导入主题             |
| `pnpm release`               | 生成发布日志             |

## 贡献与许可证

提交信息采用 `type(scope): 中文描述`，例如 `fix(editor): 修复行末回车格式丢失`。提交前运行相关测试、静态检查与构建，并说明平台验证范围。

项目仓库与问题反馈：[GitHub / LiveMD](https://github.com/nianliu-wjj/LiveMD)。

MIT © nianliu-wjj
