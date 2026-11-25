# 两份修复记录的项目落地与验收

依据 `mobile-packaging-fix-2026-11-23.md` 和 `mobile-packaging-fix-2026-11-25.md`，按最终方案实施；文档中的失败路线没有重复引入。

## 阶段与提交

| 阶段 | 落地内容                                                                              | 提交    |
| ---- | ------------------------------------------------------------------------------------- | ------- |
| 1    | Cargo 默认并行度为 4，TypeScript 只检查、不输出产物                                   | e33f5aa |
| 2    | HTML 内配对代码栅栏抽离、实体保真、静态高亮、代码卡片样式、双击源码编辑               | b6a00ed |
| 3    | details/summary 结构化节点、内部 Markdown 原地编辑、展开状态同步与序列化              | 33c2e91 |
| 4    | HTML 文件只读整页查看、桌面独立 HTTP origin、移动端文档库、跨窗口 kind 透传与保存守卫 | 3fb073e |
| 5    | 桌面 PTY 终端、工作区 cwd、快捷键、最大化、保活、主题、关窗与退出清理                 | bc0081f |
| 6    | 存量类型错误、核心测试加载超时、终端退出时尾部输出顺序、生成语言文案                  | 本提交  |

项目已有未提交的移动端、语言包、鸿蒙签名及文档删除改动予以保留，阶段提交只纳入新增工作。

## 自动验证

- `pnpm test`：371 个用例全部通过。
- `cargo test --manifest-path src-tauri/Cargo.toml`：19 个用例全部通过，包含真实 Windows ConPTY 命令执行、HTTP GET/HEAD/非法方法及路径穿越校验。
- `cargo check --manifest-path src-tauri/Cargo.toml`：通过；现有 Windows 平台的 macOS 菜单入口死代码警告保留。
- `pnpm exec tsc -p tsconfig.json`：通过，已清理 ProseMirror Node 与 DOM Node 类型混淆，以及主题类型导入路径。
- `pnpm build:web`：通过；TerminalPanel 独立分包，约 336 KB。
- 修改的前端代码通过 oxlint 和 oxfmt；修改的 Rust 代码通过 rustfmt。

原先通过 Vite SSR 加载核心模块的测试反复出现 60 秒消息通道超时，改为 esbuild 打包后加载；多入口共享 chunk，保留模块实例一致性；CSS 在测试加载时忽略，测试内容与断言保留。

pnpm 12 不再读取 package.json 的旧 pnpm 配置，原有依赖构建许可与 overrides 已迁移至 pnpm-workspace.yaml，依赖安装成功。

## 浏览器验收与平台边界

Playwright 驱动 Chromium 验证：移动端 HTML 导入、文档库持久化后重新打开、页面脚本执行、隐藏保存按钮和编辑工具；srcdoc sandbox 不包含 allow-same-origin；details 点击展开后显示正文及主编辑器代码块，再次点击可折叠。

此次环境为 Windows，尚未进行 macOS 打包、Android/鸿蒙真机及原生桌面终端完整交互验收。浏览器预览没有 Tauri 宿主，原生 IPC 报错不能代替真机验收。

移动端 HTML 保留文档约定的 srcdoc 方案：相对资源不可用，Android 子 frame 的命令注入残余风险仍存在。非 details HTML 预览的 legacy 流式语言高亮、现场键入 details 输入规则和折叠状态跨块键盘导航，仍属原文列出的可选后续事项。
