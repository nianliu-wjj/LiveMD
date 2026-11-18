# 移动端打包适配与鸿蒙构建修复记录（2026-11-18 会话）

> 分支：`feat/mobile-packaging`（本地分支，基于 `main` @ `f4d7358`）
> 涉及提交：`69c8888`（移动端打包适配）、`3bca879`（鸿蒙构建修复）、
> `fcabdc7`（复现流程改 git bundle）、`864a8c5`（oxfmt 存量格式修复），
> 以及同日追加的 NSPrintSavePath 弃用告警修复（见第六节）
> 目的：在另一台电脑（装有 SDK）上复现本次全部修复并完成 Android / 鸿蒙打包。

---

## 一、会话背景

LiveMD（Tauri 2 + Vue 3）此前已有一轮移动端适配（`main` 上的 `b58dd84`）：
Rust 侧 `#[cfg]` 门控、`harmony/` ArkTS 壳工程、`scripts/build-harmony.mjs`。

本会话继续完成"**可直接打包**"的最后差距，随后修复了在另一台电脑上
用 DevEco Studio 打开 `harmony/` 目录时**无法构建工程**的问题。

约束：开发机（本机）**不安装任何移动端 SDK**，只产出代码；
所有打包动作在装有 SDK 的电脑上执行。

---

## 二、提交 69c8888：移动端打包适配

### 2.1 `src-tauri/Cargo.toml` — single-instance 插件按平台拆分

**问题**：`tauri-plugin-single-instance` 原在通用 `[dependencies]`，
会被拉进 Android 交叉编译。

**关键踩坑（重要经验）**：最初按 Tauri 官方文档写法移到
`[target.'cfg(desktop)'.dependencies]`，**本机 `cargo check` 直接编译失败**
——`tauri_plugin_single_instance` unresolved。原因：
`desktop` / `mobile` 这两个 cfg 是 `tauri-build` 的 build script 在
**rustc 编译期**注入的（`cargo:rustc-cfg=desktop`），而 Cargo 解析
`[target.'cfg(...)'.dependencies]` 发生在**依赖解析期**，rustc 的
build script 尚未运行，Cargo 对未知 cfg 一律求值为 `false`。

**最终修复**：用 Cargo 标准平台表达式精确列出桌面三平台：

```toml
[target.'cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))'.dependencies]
tauri-plugin-single-instance = "2"
```

- lib.rs 中 `.plugin(tauri_plugin_single_instance::init(...))` 原有的
  `#[cfg(desktop)]` 门控保留（tauri 编译期注入的 cfg，双保险）。
- 该插件的 TLS 相关见同文件 reqwest 平台拆分（上轮已做）：
  Android 走 `rustls`，其余平台 `native-tls`，规避 NDK 无法交叉编译
  openssl。

**复现验证**：`cd src-tauri && cargo check` 必须 0 error（桌面平台）。

### 2.2 前端平台误判修复 — `src/service/platform/tauriElectronCompat.ts`

**问题**：前端 `platform` 用 UA 猜测，判断顺序为
`Mac → Linux → win32`。**Android WebView 的 UA 同时含 "Android" 和
"Linux"**，移动端会被误判为 `linux` 桌面，导致走桌面逻辑。

**修复**：

```ts
type LivePlatform = "win32" | "darwin" | "linux" | "android";

function detectPlatform(): LivePlatform {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return "android"; // 必须先于 Linux 判断
  if (/Mac/i.test(ua)) return "darwin";
  if (/Linux/i.test(ua)) return "linux";
  return "win32";
}

const platform: LivePlatform = detectPlatform();
const isMobile = platform === "android";
```

新增 `window.electronAPI.isMobile` 导出（`electronAPI` 对象内同步导出，
`src/typings/global.d.ts` 中 `platform` 类型从 `NodeJS.Platform` 改为
上述联合类型，并新增 `isMobile: boolean`）。

**复现验证**：`pnpm build:web` 通过即可（该文件参与主包编译）。

### 2.3 `package.json` — 新增脚本

```json
"android:init": "tauri android init",
"android:dev": "tauri android dev",
"dist:android": "tauri android build",
"dist:android-apk": "tauri android build --apk",
"dist:harmony": "pnpm build:web && node scripts/build-harmony.mjs"
```

### 2.4 `MOBILE.md`（新增，仓库根目录）

在有 SDK 电脑上的完整双端打包流程文档：Android 环境变量
（`ANDROID_HOME` / `NDK_HOME` / `JAVA_HOME`）、rustup target 安装、
`tauri android init`、产物路径、鸿蒙 `dist:harmony` + DevEco 构建 HAP。
**另一台电脑照此文档操作即可。**

### 2.5 审计确认无需改动的部分（避免复现时误改）

| 位置                                  | 结论                                                                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `src-tauri/src/commands/update.rs`    | Android 上 `select_asset()` 三个 `#[cfg]` 分支均不命中 → 返回 `None` → 前端只收到 "not-available"，更新弹窗安全降级，**无需门控** |
| `src/components/menu/TitleBar.vue`    | Android `platform === "android"` 走 `v-else` 分支（TabBar + 菜单），**不暴露窗口控制按钮**，无需改                                |
| `src-tauri/tauri.conf.json`           | `identifier` / `version` / `bundle.icon` 供 `tauri android init` 直接生成 Android 工程，`fileAssociations` 移动端自动忽略，无需改 |
| `src-tauri/capabilities/default.json` | 前端未用插件 JS API（走自定义 invoke 命令），无需追加插件权限                                                                     |
| 验证基线                              | `cargo check` 0 error；`pnpm build:web` 通过；`pnpm test` **314/314** 通过                                                        |

---

## 三、提交 3bca879：修复 DevEco 打开 harmony 工程无法构建

**现象**：另一台电脑用 DevEco Studio 打开 `harmony/` 目录，工程无法构建。

### 3.1 根因：AppScope 应用图标从未入库（必然阻断构建）

- `harmony/AppScope/app.json5` 声明 `"icon": "$media:app_icon"`；
- 但 git 中 `AppScope/resources/` 下**只有** `element/string.json`，
  `resources/base/media/app_icon.png` 从未提交（上轮 `b58dd84`
  只把 png 放在了 `entry` 模块下）；
- DevEco 打开工程后 hvigor Sync 运行 **ProfileChecker**，解析不到
  `$media:app_icon` → 资源缺失错误 → 阻断构建。

**修复**：

```bash
mkdir -p harmony/AppScope/resources/base/media
cp harmony/entry/src/main/resources/base/media/app_icon.png \
   harmony/AppScope/resources/base/media/app_icon.png
```

（复用 entry 已入库的同源图标，保证两处引用同名同图。）

### 3.2 根 oh-package.json5 补 `modelVersion` 字段

DevEco 5.x 官方模板的根 `oh-package.json5` 均含
`"modelVersion": "5.0.5"`，缺失时 hvigor 可能按旧模型解释工程导致
sync 异常。补齐：

```json5
{
  "modelVersion": "5.0.5",
  "name": "livemd",
  ...
}
```

（`hvigor/hvigor-config.json5` 中已有 `"modelVersion": "5.0.5"`，
两处保持一致。）

### 3.3 `Index.ets` 废弃 API 修正

`getContext()` 无参写法自 API 12 起废弃，改为：

```ts
const content: Uint8Array = getContext(this).resourceManager.getRawFileContent(`www/${path}`);
```

### 3.4 `harmony/README.md` 增补"构建问题排查"清单

覆盖库外四类常见报错：资源缺失（含先执行 `pnpm dist:harmony` 生成
rawfile/www）、hvigor 首次 Sync 需联网/内网代理、modelVersion 与
DevEco 版本匹配、签名配置（构建 HAP 前必须完成自动签名）。

### 3.5 核实无问题的部分

- `module.json5` 引用的 `$media:app_icon` / `$color:start_window_background`
  / `$string:ability_desc` / `$string:module_desc` 在 entry 资源中齐备；
- `main_pages.json` 路径 `"pages/Index"` 与实际页面文件一致；
- `EntryAbility.ets` / `Index.ets` 的 ArkTS 语法符合规范
  （`WebResourceResponse` 为 ArkWeb 全局类，裸名使用合法）。

---

## 四、在另一台电脑上的复现步骤

```bash
# 1. 同步分支（本项目禁止推送远端仓库，采用 git bundle 离线同步）
#    本机执行：
git bundle create livemd.bundle feat/mobile-packaging
#    拷贝 livemd.bundle 到另一台电脑后执行：
git fetch /path/to/livemd.bundle feat/mobile-packaging:feat/mobile-packaging
git checkout feat/mobile-packaging
# 至少包含 69c8888 + 3bca879 两个提交

# 2. 验证桌面侧未被破坏（可选但建议）
cd src-tauri && cargo check        # 期望 0 error
cd .. && pnpm i && pnpm test       # 期望 314/314 通过

# 3. Android 打包（先决条件：Android Studio + NDK + JDK17 + rustup targets，
#    完整环境变量清单见 MOBILE.md）
pnpm android:init                  # 每台打包电脑仅首次需要，生成 src-tauri/gen/android
pnpm dist:android-apk              # 产物: src-tauri/gen/android/app/build/outputs/apk/

# 4. 鸿蒙打包（先决条件：DevEco Studio 5.0.5+）
pnpm dist:harmony                  # vite build → 同步 dist/ 到 rawfile/www
#    DevEco 打开 harmony/ → 自动签名 → Build Hap(s)
#    产物: harmony/entry/build/default/outputs/default/entry-default-signed.hap
```

**鸿蒙构建复现要点**：打开 `harmony/` 前必须先执行 `pnpm dist:harmony`
（rawfile/www 不入库）；若仍有报错，对照 `harmony/README.md`
"构建问题排查"一节，并把 DevEco Build 窗口的具体错误信息回传。

---

## 六、同日追加修复

### 6.1 oxfmt 全量格式化（修复 106 个存量文件偏差）

**问题**：`pnpm lint` 的 oxfmt `--check` 阶段报 106 个存量文件格式偏差
（仓库既有问题，非移动端适配引入），lint 无法通过。

**修复**（提交 `864a8c5`）：

1. 执行 `pnpm oxfmt .` 全量格式化，再单独补跑 `pnpm oxfmt lang/index.json`
   （该文件键序重排产生 2.3 万行 diff，语义不变为键排序）。
2. **关键决策——`.oxfmtrc.json` 的 `ignorePatterns` 追加三类路径**：

   ```
   harmony/**                                    # DevEco 鸿蒙工程
   public/typora-themes/**                        # Typora 主题导入脚本产物
   src/assets/iconfont/**                          # iconfont 平台下载产物
   src/components/mindmap/assets/icon-font/**      # iconfont 平台下载产物
   ```

   原因（复现时不要改回去）：
   - oxfmt 会把 JSON5 的 key 引号去掉（`"name":` → `name:`）并加尾逗号。
     `harmony/` 下的 `.json5` 是 hvigor/DevEco 的构建配置文件，
     **官方模板风格均为带引号 key**；虽然 JSON5 规范允许无引号 key，
     但 hvigor 解析器的兼容性无法在无 SDK 的开发机上验证——不能拿打包
     电脑当试验场，故排除格式化并还原；
   - 产物目录（typora 主题、iconfont）由脚本/平台再生成，格式化后下次
     重新生成会回到未格式化状态，`lint` 将反复报偏差，正确做法是忽略
     而非格式化。

3. 全部格式化后验证：`pnpm lint` 0 偏差（390 个受管文件全合规），
   `Cargo.toml` 数组被 oxfmt 重排后 `cargo check` 亦无恙。

**复现验证**：`pnpm lint` exit 0；`pnpm test` 314/314；
`pnpm build:web` 通过；`cd src-tauri && cargo check` 0 error
（Cargo.toml 被 oxfmt 重排过数组换行，需确认编译无恙）。

### 6.2 macOS PDF 导出弃用告警修复（NSPrintSavePath）

**问题**（`cargo check` 告警 2 处，均在 `src-tauri/src/commands/export.rs`）：

```
use of deprecated static `objc2_app_kit::NSPrintSavePath`:
Use NSPrintJobSavingURL instead
```

**修复**（同追随提交）：打印字典的 key 由 `NSPrintSavePath` 迁移为
`NSPrintJobSavingURL`。注意 **key 换名的同时 value 类型也要变**：
旧 key 对应 `NSString`（文件系统路径），新 key 对应 **`NSURL` 对象**——
只换常量名不换值类型会导致导出 PDF 静默失败。

```rust
use objc2_app_kit::{
    NSPaperOrientation, NSPrintInfo, NSPrintJobSavingURL, NSPrintSaveJob, NSPrintingPaginationMode,
};
use objc2_foundation::{NSSize, NSString, NSURL};

let ns_path = NSString::from_str(path);
let ns_url = NSURL::fileURLWithPath(&ns_path);   // 新 key 要求 NSURL 值
let _: () = msg_send![&*dictionary, setObject: &*ns_url, forKey: NSPrintJobSavingURL];
```

依赖确认：`NSURL` 已在 `objc2-foundation 0.3` 的 default feature 中，
`NSPrintJobSavingURL` 常量与旧常量同属 `objc2-app-kit` 的 `NSPrintInfo`
feature（Cargo.toml 已启用），**无需改动依赖声明**。

**行为验证说明**：开发机仅能验证 `cargo check` 0 warning；实际 macOS
端"导出 PDF（Rust 打印管线）"需在打包电脑（或本机运行桌面版）上人工
导出一次确认落盘正常。

### 6.3 oxlint 告警清零（54 → 0）（提交 `1751c2e`）

**问题**：`oxlint .` 尚存 54 个 warning（未使用变量/参数类为主）。

**修复分四类**：

1. **正则行为 bug（本轮最重要的发现）**：strong 语法 `__text__` 分支的反向
   引用 `\1` 指向的是**另一 alternate**（`**` 分支）的组——该组未参与
   匹配时 JS 反向引用命中**空串**，导致**未闭合的 `__text` 也被误识别为
   粗体**（node 实验证实）。改为本分支组号 `\3` 即与 `**` 分支对称。
   三处同源（`src/core/parser/index.ts:53`、
   `src/core/plugins/syntax-detector.ts:180`、
   `src/core/plugins/input-rules.ts:523`）。
2. **死代码删除**：`tauriElectronCompat.ts` 的 `fileUrlToPath`/
   `resolveLivemdUrl`（`livemd://` 解析已由 `src/core/utils/image-path.ts`
   承担，前端无任何引用）、`table-format.ts` `isFenceLine`、
   `source-view-transform.ts` `CodeBlockMarker`、各文件未使用 import 与
   解构残留（注意级联：删 `language` 后 `firstPara` 也变为未使用）。
3. **保留签名参数加 `_` 前缀**：ProseMirror `view(editorView)` 回调、
   `decorations/index.ts` 兼容旧接口的 `doc` 参数、
   `source-view-transform.ts` 公共签名 `schema` 参数。
4. **有意设计的行级 disable 注释**：`markdownFormat.ts` NUL 占位符正则
   （no-control-regex）、`intlSegmenterPolyfill.ts` UAX #29 Extend 字符类
   （no-misleading-character-class，正则带 `u` 标志码点语义无歧义）。

另：`.oxlintrc.json` 原有 `"iconfont/**"` glob 匹配不到
`src/assets/iconfont/`，修正为完整路径并与 `.oxfmtrc.json` 产物忽略保持
对称；补上 6.1 漏格式化的 `lang/index.js`（曾两次被外部进程写回原始
版本，格式化后需**立即 `git add`** 防止被还原再漏提交）。

**复现验证**：`pnpm oxlint .` 输出 0 warning；`pnpm lint` 完整 exit 0；
`pnpm test` 314/314（正则行为修复受测试回归保护）；`pnpm build:web` 通过。

---

### 6.4 补全 lang/index.json 五语言翻译（提交 `07327b8`）

**任务**：`lang/index.json` 共 **1453 个 i18n key**，zh-cn 之外五种语言
（en / ja / ko / ru / fr）**全部为空**。目标：补至六语言零空值。

**流程**（复现时按此走）：

1. **提取去重**：node 脚本把所有 key 的 zh-cn 去重导出
   （`/tmp/unique_zh.txt`，`idx\t中文` 格式），1453 条全部唯一；
2. **分批翻译**（batch 0-7，每批 100-300 条）以
   `[idx, en, ja, ko, ru, fr]` 六元组逐条生成；
3. **回填**：按 zh 文案匹配（同文案复用同一条翻译），六语言写入
   `lang/index.json`；
4. **格式归一**：`pnpm oxfmt lang/index.json` 恢复键序合规。

**翻译分类策略**（决定翻译质量的关键约定）：

| 类别                                                       | 处理方式                                                   | 示例                             |
| ---------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------- |
| UI 文案                                                    | 各语言酌情翻译                                             | 最小化/取消/保存                 |
| 开发日志（`[MindMap/…]` 前缀）                             | **保留前缀**，仅翻译中文描述部分                           | `[MindMap/Export] 打开导出弹窗`  |
| 拼接片段                                                   | **严格保留首尾空格**与模板语义，翻译前先 grep 出代码上下文 | `Document "`、` 个`、`正在下载 ` |
| 代码类内容（CSS / XMind XML / 字体名 / Markdown 演示文本） | **原样复制原文**（无翻译价值，硬翻反而破坏内容）           | idx 545/755/897/898/912/922      |

**执行过程中的坑（重要，防止再次踩坑）**：

1. **heredoc 直写 JSONL 极易翻车**：文案含 `"`/`«` 等引号时，
   bash heredoc 里手写 JSON 转义几乎必然产生 unterminated string
   （批次 0 的 `Document \"` 行、批次 7 整批失败均因此）。
   **正确姿势**：用 Write 工具产出 **TSV（tab 分隔）中间文件**，再由
   python 转成 JSONL——tab 分隔彻底免疫引号转义问题。
2. **长文案在提取清单中被拆行**：HTML 占位符（idx 545）、Markdown
   演示文本（755）等含换行的内容在 `unique_zh.txt` 里被拆成多行；
   解析器必须按 `idx\t...` 开新记录、**无 idx 行合并为上一条的续行**，
   否则 5 个 key 解析错乱。
3. **量词拼接连翻译前必须先定位代码**：如 `" 个"`（key `g7e2`）字典
   查不到（键是内容 hash），要 `grep -rFn '激活节点'` 找到
   `NodeNote.vue` 的 `` `激活节点 ${n} 个` `` 模板字符串才能确定语境，
   直接臆翻会破坏拼接显示。
4. **`lang/index.js` 会被外部进程写回**（IDE 保存/监视）：格式化后
   **立即 `git add`** 暂存，不给还原窗口，否则反复"格式化→被还原→
   lint 再报偏差"（本会话出现过两次）。
5. **oxlint 对纯 JSON 目标集合报 `No files found to lint`**：当前版本
   oxlint 的 `--fix` 不接受纯 json 文件集合（lint-staged 把 staged 的
   json 传给它即失败）——**任何只含 json 的提交都会被 pre-commit 钩子
   挡下**。修复：`lint-staged` 配置把 `*.json` 从 oxlint 剥离
   （json 仅跑 `oxfmt`）。该"修复钩子的提交"本身也是纯 json 集合，故用
   `git commit --no-verify` 并在提交信息中说明（全量 `pnpm lint` 已
   通过保证该次提交本体合规）。
6. **忽略目录与单文件提交的冲突**：`.oxlintrc.json` 若按整目录忽略
   （`lang/**`），单独提交该目录下文件时钩子同样报 No files found；
   应精确到文件（`lang/index.js`）。

**验证基线**：

- 六语言零空值（node 统计脚本）；
- `pnpm lint` 完整通过（oxfmt 键序合规 + oxlint 0 warning）；
- `pnpm test` 314/314；`pnpm build:web` 通过。

> 翻译充实过程中产物批文件位于 `/tmp/tr_*.jsonl`（会话级，未入库）；
> 如需复查个别词条可从 `lang/index.json` 直接检索。

### 6.5 修复无序列表行"焦点离开后整行隐藏"（提交 `bc24353`）

**症状**（用户报障 2026-11-18）：把普通文本行改成无序列表（`- ` 前缀）后，
光标在该行内时正常显示；**光标移开后该行整行数据被隐藏**；切到源码视图
内容完好。

**排查路线（值得复用的方法论）**：

1. **headless 复现尝试（六个场景均未直接复现）**：借 caret-smoke 的
   vite+CDP 无头基建（`debug-dom.html` + `__debugEditor` 探针）依次模拟：
   结构化解析列表、行首 raw 插入 `- `、真实键入（`Input.dispatchKeyEvent`
   触发 InputRule 转换）、双行先后键入转换、源码模式往返切换、保存-回读
   （restoreDoc 局部 diff 替换）——文档与 DOM 全部正常。
   _教训：复杂视觉/渲染 bug 的 headless 复现成本极高，应及时转向
   "同症状历史考据"。_
2. **git 考古命中**：`git log --grep="content-visibility"` 找到基线提交
   `667331c fix(editor): 列表项取消 content-visibility 裁剪`，其提交信息
   描述的症状与本次报障**逐字吻合**——"content-visibility:auto 在
   WKWebView 下对类名变化不恢复绘制，**列表行出现光标进可见、移开不可见
   的幽灵态**"。
3. **差距定位**：667331c 只把 `li` 移出了大文档模式（`≥20 万字符或
≥4 千行` 触发）的 content-visibility 选择器集合，但 `> ul`/`> ol`
   **仍在集合**。ul/ol 是列表项的直接宿主——光标穿梭列表行时的
   `livemd-focus-block` 类增/摘发生在其子树内，WKWebView 不恢复绘制的
   机理与 li 完全同源。

**修复**：把 `> ul`/`> ol` 一并移出大文档模式的 content-visibility
集合（提交 `bc24353`，`src/components/editor/LivemdEditor.vue`
large-document-mode 块）；caret-smoke 新增断言 **9b**：li 与其宿主 ul/ol
全族的 `content-visibility` 必须保持 `visible`（防止将来被改回）。

**真实文档确认与第二轮补修（提交 `73473fb`）**：用户提供真实复现文档
`/Users/nianjiu/Worksapce/Documents/docs/八股文/组件篇/数据库篇/
01_SQL基础与数据检索.md`——**4762 行，超过 4 千行阈值，大文档模式必然
启用**（触发条件实锤）。用户截图显示报障发生地是**表格行**（正在编辑
`| BETWEEN x AND y | ...` 一行的区域）：`> table` 仍在 cv:auto 集合，
机理与 ul/ol 完全同源（表格行编辑时 focus-block 类变化落在 table 子树
内）。补修：`> table` 一并移出集合；冒烟文档加表格样本，断言 9b 覆盖族
扩展为 **li / ul / ol / table**。

**验证与边界（如实说明）**：

- caret-smoke **10/10 全通过**（9b 已覆盖 li/ul/ol/table 全族）；
- 本 bug 为 **WKWebView 引擎特性**（macOS Tauri），headless Chrome 无此
  引擎 bug 故无法在本地直接观测差异——修复以机理与历史同症状提交为依据，
  **需在 macOS 真机（Tauri 桌面版）复验**：打开该 4762 行 SQL 笔记文档，
  在列表行与表格行上反复光标进出，确认不再出现整行隐藏；
- 排查期间顺带实锤的另一处待办（本节未修）：行内图片
  `text ![img](x.png) text` 经序列化会被拆成三个顶层块
  （`second line with \n\n![alt](x.png)\n\n tail`），保存回读后行结构
  与用户所见不一致——与主诉"行隐藏"无关，建议另开任务跟进。

### 6.6 修复行末语法标记后按 Enter 破坏上一行格式（提交 `02dfee3`）

**症状**（用户报障 2026-11-18）：光标在行末粗体闭标记后
（如 `3、**mmBeacon子系统**|`）按 Enter，期望下方新增空白行；实际
**上一行的粗体语法代码被带进新行**，上行格式破坏、新行也不为空。

**headless 复现（这次一次命中）**：`enter-repro`（后升格为随库回归
`enter-smoke.mjs`）注入 `head **boldword**`、光标置块末、
`Input.dispatchKeyEvent` 发送 Enter，实测序列化输出
`"head **boldword\n\n**\n"`——文档内容确实被破坏。

**根因链路（完整闭环）**：

1. `src/core/keymap/index.ts` 的 `findSafeEnterPos`：光标处
   `nodeBefore` 是 syntax_marker（闭标记）→ 无差别**回拨到连续标记组
   之前**（内容末尾、闭标记之前）；
2. split 发生在回拨点 → **闭标记 `**` 被甩进新行\*\*；
3. syntax-fixer 检测上行开标记不成对 → **剥掉上行全部 strong /
   syntax_marker marks** → 上行退化为 `head **boldword` 明文
   （报障中"上一行格式被破坏"的视觉）。

**修复**：`findSafeEnterPos` 增加**块末守卫**——光标已在块内容末尾
（`parentOffset >= parent.content.size`）时，块末本身就是理想分割点
（标记组留在上行尾部、新行为空），直接返回 null 不回拨。原有回拨
保护（行中段、标记组之后还有内容的场景，防"兄弟项吸入新 item"）
保持不变。

**回归冒烟**（随库新增 `enter-smoke.mjs`，`node enter-smoke.mjs`）：

| #   | 断言                                               | 结果 |
| --- | -------------------------------------------------- | ---- |
| 1   | 行末粗体闭标记 Enter：上行 marks 完整 + 新行空     | PASS |
| 2   | 同场景序列化无损（`head **mk**\n\n`）              | PASS |
| 3   | 行中闭标记后 Enter：split 正常完成（回拨现状固化） | PASS |
| 4   | 行末行内代码闭标记（`` ` ``）：同断言 1 口径       | PASS |

同轮验证：caret-smoke 10/10 无回归、`pnpm test` 314/314、
`pnpm lint` 通过。实测修复后序列化输出恢复为 `"head **mk**\n\n"`。

### 6.7 大文档 content-visibility 系统性收口（提交 `da733c4`）

**症状**（用户报障 2026-11-18 幽灵态第四击）：在一段文本的**开头位置**
按 Enter（上方插入空行正确），随后**焦点移开原段，原段内容被隐藏**。

**排查与实锤**：

1. **headless 逻辑层排除**（enter-smoke 新增断言 5）：注入三段文档、
   光标置中段段首、真实键入 Enter、焦点移到文档末——模型/段落 DOM/
   序列化/全部段落 `visibility: visible` **全部健康**。隐藏仅存在于
   WKWebView 引擎层。
2. **系列考据**（与 6.5 同族第四击）：`> p` 仍在 cv:auto 集合，且
   `livemd-focus-block` 类变化发生在 cv:auto 元素**自身**上（比前三击
   li/ul/ol/table 的"子树内类变化"更直接）。
3. **系统性收口决策**：四轮个案修复后，cv:auto 集合中每个可承载光标的
   textblock 宿主都可能成为下一击。一次性把 `> p`、`> h1-h6`、
   `> blockquote`、`blockquote > *` 全部移出集合，**只保留无 PM 类变化
   交互的纯静态长块**（代码块/math/html/image/hr——代码块是 CodeMirror
   独立结构不挂焦点类）。段落型块数量最多但被迫放弃裁剪收益，长块
   裁剪兜底滚动性能。

**回归防护**：

- caret-smoke 新增断言 **9c**：段落/标题/引用族（p/h/blockquote）
  `content-visibility` 必须全 visible——至此 9b+9c 覆盖全部曾躺枪的
  元素族（li/ul/ol/table + p/h/blockquote），代码注释明确警告
  "不要把任何可承载光标的 textblock 宿主加回本列表"。
- enter-smoke 新增断言 **5**：段首 Enter + 焦点移开的模型/DOM 健康基线。

**验证**：caret-smoke **11/11**（含新 9c）、enter-smoke **5/5**、
`pnpm test` 314/314、`pnpm lint` 通过。仍需 macOS 真机复验四击场景。

> **流程规则确立**（用户 2026-11-18 指示）：本会话**所有**修复内容
> （功能修改、优化、bug 修复）都必须写入本文档，含排查过程与踩坑，
> 防止在其他环境复现时重蹈。

### 6.8 修复行内图片序列化拆块（提交 `a981a09`）

**症状**（6.5 节登记的遗留待办）：混排行 `text ![img](x.png) text`
在编辑器中打开/键入后即被拆成「文字段 / 顶层图片 / 文字段」三块，
序列化输出 `text \n\n![img](x.png) \n\n tail`——保存回读后行结构与
用户所见不一致。

**排查闭环（三层实验）**：

1. **SSR 裸管线排除**：`defaultParser.parse` + `MarkdownSerializer` 直连，
   混合行/纯图行/纯文本行三种输入**全部无损**——排除解析器与序列化器
   本身；
2. **headless 编辑器管线变体矩阵**：同样的混合行在编辑器内**全部拆块**
   （单行/多行/无空行/双图混排四变体一致）——差异锁定在**插件链**；
3. **元凶**：`syntax-detector.ts`（即时渲染插件）的 `appendTransaction`
   用全局正则在**段落文本内任意** `![alt](src)` 处做
   `tr.replaceWith(img.from, img.to, imageNode)`——image 是块级节点，
   ProseMirror 的块级 replaceWith 会把所在段落劈开。原设计意图是"
   纯图片行键入后即时成块"，但混排行同样命中。

**修复**：新增 `PURE_IMAGE_LINE_PATTERNS`（trim 后整行恰好一个链接图片
或普通图片 token），仅纯图片行做节点替换——与 parser 块级分支
（`BLOCK_PATTERNS.image` 整行匹配）的语义对齐；混排行保持文本原样。
连续组图分支（`parseConsecutiveImages`，全行图片序列）在纯图判定之前
处理，不受影响。

**兼容回归**（enter-smoke 断言 6/7）：

| #   | 断言                                       | 结果 |
| --- | ------------------------------------------ | ---- |
| 6   | 行内图片无损往返（不拆块、序列化等原文）   | PASS |
| 7   | 纯图片行兼容（独立成图、roundtrip 等原文） | PASS |

同轮验证：enter-smoke 7/7、caret-smoke 11/11、`pnpm test` 314/314、
`pnpm lint` 通过。

**如实边界**：若此前曾在含混排图的文件上保存过（该行已被拆成三段），
磁盘上的数据不会自动愈合——需手工合并回原行；本修复阻断的只是
**新的拆分发生**。

---

## 七、遗留事项

- **未做**：移动端深度 UI/触屏适配（本次范围仅"可打包 + 安全降级"，
  例如移动端隐藏更新入口、触屏专属布局均未做）；
- `pnpm lint` oxfmt 报 106 个存量文件格式偏差 → 已修复（6.1）；
- macOS NSPrintSavePath 弃用告警 → 已修复（6.2）；
- oxlint 尚存 54 个 warning → 已清零（6.3，含一处真实正则 bug 修复）；
- lang/index.json 五语言全空 → 已补全 1453 条（6.4）；
- 段首 Enter 后焦点移开原段隐藏（幽灵态第四击） → 已系统性收口
  真机复验 WKWebView 侧效果）；
- 行末粗体闭标记后按 Enter 破坏上一行格式 → 已修复并有随库回归
  冒烟（6.6，headless 直接复现验证）；
- 段首 Enter 后焦点移开原段隐藏（幽灵态第四击） → 已系统性收口
  cv 裁剪集合至纯静态块（6.7，需 macOS 真机复验四击场景）；
- 行内图片序列化拆块问题 → 已修复（6.8，双层实验闭环定位到
  语法插件的块级 replaceWith）；
- 译文为一次性机翻基线，**未经母语校对**；建议后续在实际使用中收集
  不准确词条迭代修正；

## 八、接续 OpenCode 会话（2026-11-18）

读取 ses_e1160441bffe4xEFWEUubse9Q1 的 313 条消息。会话完成了打包、格式化、编辑器与五语言翻译提交，停在移动端 UI 回归测试创建后，README 尚未更新。

接续完成窄屏设置导航、触屏子菜单、标题栏/状态栏/标签与确认面板适配，关闭移动端应用内更新入口。排查发现模拟 mouseenter 会使触屏点击反向关闭菜单，已让悬停事件仅在支持 hover 的设备生效。README 按当前功能与移动平台限制重新生成。

移动打开文件失败的原因：安卓原生选择器返回 content URI，原 open_file 用 into_path 转换并静默丢弃失败结果；鸿蒙没有 Tauri 后端却调用 Rust 命令。移动端改用文件输入读取 File 内容，鸿蒙 ArkWeb 增加 DocumentViewPicker 回调。内容直接创建标签，不再按路径重读，保留 BOM/换行信息。导入作为未保存副本，原文件不会直接覆盖；保存能力与相对图片访问仍需要平台文件系统支持。

验证：移动 UI 4 项、移动文件解码 2 项回归；前端构建与静态检查。Android/HarmonyOS 文件选择器及 macOS 光标场景仍需真机验证，母语翻译校对仍需语言使用者反馈。当前 pnpm 12 与旧 pnpm 配置不兼容，使用已安装工具直接运行验证。
