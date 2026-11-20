# LiveMD Android 工程

本目录维护 LiveMD 的 Android 原生工程，与根目录 `harmony/` 并列。Android 宿主使用 Tauri 2，编辑器前端来自 `src/`，Rust 后端仍在 `src-tauri/`。

Tauri CLI 默认查找 `src-tauri/gen/android/`。项目脚本在该位置创建指向本目录的兼容入口：Windows 使用 junction，macOS/Linux 使用符号链接。实际工程只有一份；开发时在 Android Studio 打开根目录 `android/`。

## 目录

```text
android/
├─ app/
│  ├─ src/main/AndroidManifest.xml  应用与 Activity 配置
│  ├─ src/main/java/               Kotlin 宿主代码
│  ├─ src/main/res/                Android 资源与 launcher 图标
│  └─ build.gradle.kts             SDK、依赖、构建类型与签名配置
├─ buildSrc/                       Gradle 与 Rust 构建桥接
├─ gradle/wrapper/                 Gradle Wrapper
├─ settings.gradle                工程入口
├─ build.gradle.kts               工程级 Gradle 配置
└─ gradlew / gradlew.bat           Gradle 启动脚本
```

工程源码、Gradle 配置和 Wrapper 纳入 Git。以下文件由本机工具链生成或配置，已通过 `.gitignore` 排除：

- `.gradle/`、`.kotlin/`、各级 `build/` 等构建缓存与产物。
- `.tauri/`、`tauri.settings.gradle`、`app/tauri.build.gradle.kts`、Tauri 属性及生成的宿主代码。
- `app/src/main/jniLibs/` 中的 Rust 原生库链接。
- `local.properties`、`keystore.properties`、密钥和签名文件。

## 准备与运行

先按 [移动端打包指南](../MOBILE.md) 配置 Android SDK、NDK、JDK 和 Rust Android targets，然后在仓库根目录执行：

```bash
pnpm install
pnpm android:prepare
pnpm android:init
```

`android:prepare` 创建或检查兼容入口；`android:init` 通过项目脚本初始化 Tauri 生成配置。首次克隆后完成这两步，再在 Android Studio 打开本目录并同步 Gradle。

在仓库根目录开发或打包：

```bash
pnpm android:dev       # 设备或模拟器上调试
pnpm dist:android-apk  # 构建 APK
pnpm dist:android     # 构建 AAB
```

APK 默认输出：

```text
android/app/build/outputs/apk/universal/release/app-universal-release.apk
```

正式发布时在本机 `android/keystore.properties` 配置签名，密钥和签名配置保留在本机。完整环境、签名和构建故障处理见 [移动端打包指南](../MOBILE.md)。

## 目录迁移

已有 `src-tauri/gen/android/` 实际工程时，`android:prepare` 会将其迁入本目录，再建立兼容入口。若两处同时存在实际工程，脚本会停止并保留两边文件，避免自动合并覆盖修改。

Gradle 的 Rust 构建任务使用工程的实际路径定位 `src-tauri/`，因此从根目录工程或 Tauri 兼容入口启动时都能找到同一份 Rust 后端。
