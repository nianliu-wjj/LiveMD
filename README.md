# LiveMD

LiveMD 是基于 Tauri 2、Vue 3 和 ProseMirror 的本地 Markdown 编辑器，支持 Windows、macOS、Linux，并提供 Android 与 HarmonyOS NEXT 打包工程。

## 编辑与文档管理

- 即时渲染与源码编辑，支持粗体、链接、表格、图片、KaTeX 公式和 Mermaid 图表。
- 多标签页、工作区文件树、全文搜索、大纲、书签、自动保存与只读模式。
- 代码高亮、代码格式化、文档检查、拼写检查与中英文自动补空格。
- 桌面端支持 PDF、Word 导出、窗口交互与更新检查。
- 内置明暗主题、主题编辑器与 Typora 主题导入。
- 界面提供中文及英语、日语、韩语、俄语、法语翻译；译文仍欢迎实际使用反馈。

文档保存在本地。更新检查、远程图片、图床上传等功能按使用场景访问网络。

## 开发

需要 Node.js ≥ 20.17、pnpm，以及桌面开发所需的 Rust 与系统依赖。Windows 需要 WebView2；macOS 需要 Xcode Command Line Tools；Linux 需要 GTK 3、WebKitGTK 4.1 等 Tauri 系统依赖。

```bash
pnpm install
pnpm dev          # 桌面开发
pnpm dev:web      # 浏览器预览
pnpm build:web    # 前端构建，输出 dist/
pnpm test
pnpm lint
```

纯浏览器预览和鸿蒙 ArkWeb 壳不具备 Tauri Rust 后端，原生文件管理、监听、系统对话框等功能存在限制。当前 package.json 的 pnpm 配置采用 pnpm 10 格式；pnpm 12 用户需迁移配置到 pnpm-workspace.yaml 后安装依赖。

## 打包

| 平台                        | 命令                                            |
| --------------------------- | ----------------------------------------------- |
| 当前桌面平台                | `pnpm build`                                    |
| Windows x64                 | `pnpm dist:win-x64`                             |
| macOS Intel / Apple Silicon | `pnpm dist:mac-x64` / `pnpm dist:mac-arm64`     |
| Linux x64 / ARM64           | `pnpm dist:linux-x64` / `pnpm dist:linux-arm64` |
| Android 初始化 / 开发       | `pnpm android:init` / `pnpm android:dev`        |
| Android APK / AAB           | `pnpm dist:android-apk` / `pnpm dist:android`   |
| 鸿蒙前端资源同步            | `pnpm dist:harmony`                             |

Android 需要 Android SDK、NDK、JDK 和 Rust 交叉编译目标。鸿蒙需要 DevEco Studio 与匹配 SDK：资源同步后打开 harmony/ 构建 HAP。签名与实际设备验证需在相应平台进行。

完整步骤见 [移动端打包指南](MOBILE.md) 和 [鸿蒙工程说明](harmony/README.md)。

## 移动端界面

窄屏设置页采用顶部导航，菜单支持点击展开子菜单；标签栏、状态栏、链接输入与确认面板提供触屏布局。移动端关闭桌面应用内更新入口。打开 Markdown 时通过系统选择器导入内容作为未保存副本，不直接覆盖原文件。鸿蒙采用 ArkWeb 承载前端，能力边界与桌面版有所不同。

## 项目结构

| 路径            | 内容                          |
| --------------- | ----------------------------- |
| src/core/       | Markdown 编辑内核、解析与插件 |
| src/components/ | Vue 界面组件                  |
| src/service/    | 平台兼容与应用服务            |
| src-tauri/      | Rust 后端与桌面、Android 配置 |
| harmony/        | HarmonyOS NEXT ArkTS 壳       |
| lang/           | 界面语言词典                  |
| test/           | 回归测试                      |
| scripts/        | 打包与维护脚本                |

## 贡献

提交前运行测试与静态检查。提交信息使用 `type(scope): 中文描述`，例如 `fix(editor): 修复行末回车格式丢失`。

问题与贡献：[GitHub](https://github.com/nianliu-wjj/LiveMD)。

MIT © nianliu-wjj
