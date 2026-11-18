# LiveMD 移动端打包指南（Android / HarmonyOS NEXT）

本文档面向**已安装移动端 SDK 的打包电脑**，说明如何从仓库直接产出 Android APK 与鸿蒙 HAP。
日常开发机不需要安装任何移动端 SDK。

## 总体说明

- Android 走 Tauri 2 官方移动端工程（`tauri android`），Rust 后端与桌面端共用。
- HarmonyOS NEXT 没有官方 Tauri 支持，仓库内 `harmony/` 是 ArkTS（Stage 模型）壳工程：
  用 ArkWeb 以虚拟主机 + rawfile 回源承载 `dist/` 的 web 构建产物。
- 鸿蒙壳内的能力边界：依赖 Tauri Rust 后端的功能（本地文件树、文件 watcher、
  原生对话框、系统剪贴板等）不可用，前端会走降级路径。
- 移动端的安全降级已内置：更新检查在 Android 上返回 not-available，
  标题栏在 `platform === "android"` 时不渲染窗口控制按钮。

## 一、Android

### 1.1 环境要求

| 工具 | 版本 / 说明 |
| --- | --- |
| Android Studio | 最新稳定版，安装 Android SDK Platform 与 Build-Tools |
| Android NDK | 与 Tauri 2 当前要求匹配的 LTS 版本（安装后记录 `NDK_HOME`） |
| JDK | 17（Tauri Android 构建要求） |
| Rust | 最新稳定版，并安装 Android 交叉编译 target |
| Node.js / pnpm | 见根目录 `README.md` |

安装 Rust target（按需二选一或都装）：

```bash
rustup target add aarch64-linux-android
rustup target add x86_64-linux-android
```

### 1.2 环境变量

以 Windows 为例（macOS / Linux 换成对应路径）：

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:NDK_HOME = "$env:ANDROID_HOME\ndk\<版本号>"
$env:PATH = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:PATH"
```

确认环境：

```bash
java -version          # 17.x
adb version
```

### 1.3 首次初始化

每台打包电脑只需执行一次：

```bash
pnpm android:init
```

该命令生成 `src-tauri/gen/android/`（不纳入版本管理）。

### 1.4 开发与打包

```bash
# 连接设备/模拟器后热更新调试
pnpm android:dev

# 构建 APK
pnpm dist:android-apk

# 构建 AAB（上架 Google Play 用）
pnpm dist:android
```

APK 产物路径：

```
src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
```

> 未配置签名时 Tauri 会使用调试签名；正式分发前请在
> `src-tauri/gen/android/app/build.gradle.kts` 中配置 release keystore。

### 1.5 常见问题

- **`Android Studio project directory ... doesn't exist`**：先执行 `pnpm android:init`。
- **NDK / OpenSSL 相关链接错误**：Android 的 `reqwest` 已切到 `rustls`；
  若仍报错，确认没有手工把依赖改回 `native-tls`。
- **Gradle 下载缓慢**：为 Gradle 配置国内镜像或代理，首次构建需要联网。
- **`JAVA_HOME` 指向 JRE 而非 JDK**：必须使用 JDK 17（Android Studio 自带 `jbr` 可用）。

## 二、HarmonyOS NEXT

### 2.1 环境要求

| 工具 | 版本 / 说明 |
| --- | --- |
| DevEco Studio | 5.0.5 及以上 |
| HarmonyOS SDK | API 17（与 `harmony/build-profile.json5` 的 `compatibleSdkVersion` 对应） |
| 华为账号 | 用于自动签名 |

### 2.2 同步 web 产物

在仓库根目录执行：

```bash
pnpm dist:harmony
```

该命令等价于 `pnpm build:web` 后把 `dist/` 复制到
`harmony/entry/src/main/resources/rawfile/www/`。**rawfile/www 不入库，打开工程前必须先生成。**

### 2.3 用 DevEco Studio 构建

1. 打开 `harmony/` 目录（不是仓库根目录）。
2. 等待首次 hvigor Sync 完成（需要联网下载依赖）。
3. `File > Project Structure > Signing Configs`，勾选
   *Automatically generate signature information* 并登录华为账号。
4. `Build > Build App(s)/Hap(s) > Build Hap(s)`。
5. 产物：`harmony/entry/build/default/outputs/default/entry-default-signed.hap`。

命令行构建（安装 `command-line-tools` 后）：

```bash
cd harmony
hvigorw assembleHap --mode module -p product=default
```

### 2.4 构建问题排查

| 报错 | 处理 |
| --- | --- |
| 资源缺失（`$media:app_icon`、`$string:*` 等） | 先确认已执行 `pnpm dist:harmony`；仓库已包含 `AppScope/resources/base/media/app_icon.png` 与 entry 资源，若仍缺失，检查文件是否被本地清理 |
| hvigor Sync 卡住 / 依赖下载失败 | 首次 Sync 需要联网，配置内网代理或镜像后重试；删除 `harmony/.hvigor` 缓存再同步 |
| `modelVersion` 相关异常 | 根 `oh-package.json5` 与 `hvigor/hvigor-config.json5` 均应为 `5.0.5`，并与 DevEco Studio 版本匹配 |
| 构建 HAP 提示未签名 | 先完成 2.3 的自动签名配置；未签名只能运行预览，不能产出可安装 HAP |
| ArkTS 编译报 `getContext` 废弃 | 使用 `getContext(this)`（仓库代码已修正，避免回退） |

## 三、验证基线

移动端改动不应破坏桌面端。提交前建议至少执行：

```bash
pnpm lint
pnpm test
pnpm build:web
cd src-tauri && cargo check
```

桌面端 `cargo check` 必须 0 error；`tauri-plugin-single-instance` 仅对
Windows / macOS / Linux 生效，避免被拉入 Android 交叉编译。
