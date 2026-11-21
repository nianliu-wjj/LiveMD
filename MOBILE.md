# LiveMD 移动端打包指南（Android / HarmonyOS NEXT）

本文档面向**已安装移动端 SDK 的打包电脑**，说明如何从仓库直接产出 Android APK 与鸿蒙 HAP。
日常开发机不需要安装任何移动端 SDK。

## 总体说明

- Android 原生工程在根目录 `android/`，使用 Tauri 2 官方移动端工具链，Rust 后端与桌面端共用。
- `src-tauri/gen/android/` 是指向 `android/` 的兼容入口：Windows 使用目录联接，macOS/Linux 使用符号链接。工程源码入库，兼容入口、生成配置、缓存和签名文件不入库。
- HarmonyOS NEXT 没有官方 Tauri 支持，仓库内 `harmony/` 是 ArkTS（Stage 模型）壳工程：
  用 ArkWeb 以虚拟主机 + rawfile 回源承载 `dist/` 的 web 构建产物。
- 鸿蒙壳通过 ArkTS 桥接实现 Markdown 文件导入和应用文档目录的读写、列表、删除；
  依赖 Tauri Rust 后端的桌面文件树、文件 watcher、系统剪贴板等仍走前端降级路径。
- 移动端的安全降级已内置：更新检查在 Android 上返回 not-available，
  标题栏在 `platform === "android"` 时不渲染窗口控制按钮。

## 一、Android

### 1.1 环境要求

| 工具           | 版本 / 说明                                                 |
| -------------- | ----------------------------------------------------------- |
| Android Studio | 最新稳定版，安装 Android SDK Platform 与 Build-Tools        |
| Android NDK    | 与 Tauri 2 当前要求匹配的 LTS 版本（安装后记录 `NDK_HOME`） |
| JDK            | 17 及以上；本项目已使用 JDK 21 验证构建                     |
| Rust           | 最新稳定版，并安装 Android 交叉编译 target                  |
| Node.js / pnpm | 见根目录 `README.md`                                        |

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
java -version          # 17 或更高版本
adb version
```

### 1.3 工程准备与初始化

安装 JavaScript 依赖后，先在仓库根目录准备 Tauri 兼容入口：

```bash
pnpm android:prepare
```

该命令将旧布局中的实际工程迁到根目录 `android/`（如有），并创建 `src-tauri/gen/android/` 的目录联接。重复运行会检查并复用已有入口。

首次配置 Android 工具链或需要补齐本机生成配置时执行：

```bash
pnpm android:init
```

`android:init` 通过项目脚本调用 Tauri 初始化，并将工程保留在根目录 `android/`。完成后在 Android Studio 打开 `android/`，等待 Gradle 同步。

`android/app/` 的 Manifest、Kotlin 宿主、资源和构建配置，以及 `android/buildSrc/`、Gradle Wrapper 纳入 Git。Tauri 生成的 `tauri.settings.gradle`、`tauri.build.gradle.kts`、原生库链接等由本机工具链维护；构建缓存和本地签名配置也不入库。详细目录见 [Android 工程说明](android/README.md)。

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
android/app/build/outputs/apk/universal/release/app-universal-release.apk
```

调试构建可使用 Android 默认调试签名；正式发布需要在本地 `android/keystore.properties` 配置 release keystore，应用构建配置位于 `android/app/build.gradle.kts`。签名配置和密钥不纳入 Git。

### 1.5 常见问题

- **`Android Studio project directory ... doesn't exist`**：先执行 `pnpm android:prepare` 重建兼容入口；首次使用时再执行 `pnpm android:init` 补齐生成配置。
- **Android Studio 同步时找不到 Tauri 生成的 Gradle 配置**：在仓库根目录执行 `pnpm android:init` 后重新同步。
- **根目录 `android/` 与旧路径中同时存在两个实际工程**：保留两边文件并核对内容，准备脚本会拒绝自动合并，以免覆盖工程修改。
- **NDK / OpenSSL 相关链接错误**：Android 的 `reqwest` 已切到 `rustls`；
  若仍报错，确认没有手工把依赖改回 `native-tls`。
- **Gradle 下载缓慢**：为 Gradle 配置国内镜像或代理，首次构建需要联网。
- **`JAVA_HOME` 指向 JRE 而非 JDK**：使用 JDK 17 及以上（Android Studio 自带 `jbr` 可用）。

## 二、HarmonyOS NEXT

### 2.1 环境要求

| 工具          | 版本 / 说明                                            |
| ------------- | ------------------------------------------------------ |
| DevEco Studio | 26.0；与工程配置及本地 SDK 保持一致                    |
| HarmonyOS SDK | 26.0.1 / API 26，以 `harmony/build-profile.json5` 为准 |
| JDK           | 21 及以上（DevEco Studio 自带 `jbr` 可用）             |
| 华为账号      | 用于自动签名                                           |

### 2.2 同步 web 产物

在仓库根目录执行：

```bash
pnpm dist:harmony
```

该命令等价于 `pnpm build:web` 后把 `dist/` 复制到
`harmony/entry/src/main/resources/rawfile/www/`。**rawfile/www 不入库。**
DevEco 构建时也会检查前端源码指纹，变化时自动重新构建并同步资源。

### 2.3 用 DevEco Studio 构建

1. 打开 `harmony/` 目录（不是仓库根目录）。
2. 等待首次 hvigor Sync 完成（需要联网下载依赖）。
3. `File > Project Structure > Project > Signing Configs`，勾选
   _Automatically generate signature information_ 并登录华为账号，为目标设备生成签名。
   Hvigor 会读取本机 `.sign/sign-config.json5`；`default` 产品的 `signingConfig`
   须与其中的配置名称一致，项目使用 `"signingConfig": "default"`。
4. `Build > Build App(s)/Hap(s) > Build Hap(s)`。
5. 产物：`harmony/entry/build/default/outputs/default/entry-default-signed.hap`。

命令行构建（安装 `command-line-tools` 后）：

```bash
cd harmony
hvigorw assembleHap --mode module -p product=default -p module=entry@default
```

`.sign/` 中的签名材料保留在本机，不进入版本库。新电脑须先创建本地 `default`
签名配置；仅验证未签名编译时，可临时移除产品的 `signingConfig` 字段，产物为
`harmony/entry/build/default/outputs/default/entry-default-unsigned.hap`。
安装到设备前需要选择签名配置并重新构建。

### 2.4 构建问题排查

| 报错                                          | 处理                                                                                                                                      |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 资源缺失（`$media:app_icon`、`$string:*` 等） | 先确认已执行 `pnpm dist:harmony`；仓库已包含 `AppScope/resources/base/media/app_icon.png` 与 entry 资源，若仍缺失，检查文件是否被本地清理 |
| hvigor Sync 卡住 / 依赖下载失败               | 首次 Sync 需要联网，配置内网代理或镜像后重试；删除 `harmony/.hvigor` 缓存再同步                                                           |
| `modelVersion` 相关异常                       | 根 `oh-package.json5` 与 `hvigor/hvigor-config.json5` 均应为 `5.0.5`，并与 DevEco Studio 版本匹配                                         |
| 构建 HAP 提示未签名                           | 未签名 HAP 可用于编译验证；安装前完成 2.3 的自动签名配置并重新构建                                                                        |
| `9568320: no signature file`                  | 产品没有选择签名配置，或运行时选择了 `unsigned.hap`；关联本地签名配置并重新构建 `signed.hap`                                              |
| SDK 版本号校验失败                            | 当前 SDK 使用纯点分字符串 `"26.0.1"`，不要改成 `"26.0.1(26)"`；兼容版本和目标版本都须在本地 SDK 可用列表中                                |
| ArkTS 编译报 `getContext` 废弃                | 使用 `getContext(this)`（仓库代码已修正，避免回退）                                                                                       |

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

### Windows 符号链接权限

`android:prepare` 创建的目录兼容入口使用 Windows junction。Tauri Android 构建还会将 Rust .so 链接到 jniLibs，这一步需要文件符号链接权限。出现 Creation symbolic link is not allowed 时，需要在 Windows 设置中启用开发者模式，或使用管理员终端打包。复制 .so 不能替代 Tauri 后续的符号链接步骤。安卓脚本会在编译前检查权限，避免完成 Rust 编译后才失败。

### 安卓构建自动提权

`pnpm dist:android-apk`、`pnpm dist:android` 和 `pnpm android:dev` 会先检测符号链接权限。Windows 缺少权限时自动弹出 UAC 管理员确认窗口，确认后在管理员进程中执行原命令；取消则返回失败。已启用开发者模式、已有权限或非 Windows 系统会直接执行。管理员进程保留 SDK、JDK、Rust 和代理环境变量；完成后退出码返回原终端。

## 四、移动端文档保存

- Android 文档保存到 Tauri 的应用文档目录，鸿蒙保存到应用 `filesDir/documents`。
- 新文档首次保存时输入文件名；已有文档直接覆盖保存。导入文件复制到应用文档目录。
- 文档列表从磁盘加载，重启后可继续打开；卸载应用会清除应用目录中的文档。
- 浏览器 `?mobile=1` 预览使用 localStorage，原生保存链路需在设备或模拟器上验证。
