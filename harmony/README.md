# LiveMD HarmonyOS NEXT（鸿蒙）壳工程

Tauri 2 官方不支持 HarmonyOS。本目录是一个 **ArkTS（Stage 模型）壳工程**：
用 ArkWeb `Web` 组件以虚拟主机 + rawfile 回源的方式承载 LiveMD 的 web 构建
产物（`dist/`），交付可在 DevEco Studio 直接构建/运行的 HAP。

> 能力边界：此方式运行的是 **web 版 LiveMD**——编辑器渲染、解析、导出等
> 前端能力完整；依赖 Tauri Rust 后端的能力（本地文件树、文件 watcher、
> 原生对话框、剪贴板系统调用等）在壳内走前端降级路径，不可用。
> 这是当前生态下鸿蒙运行 Tauri 应用的务实路径（等 Tauri 官方或社区
> OpenHarmony runtime 成熟后可替换为原生承载）。

## 目录

```
harmony/
├─ AppScope/                 应用级配置（bundleName / 版本 / 图标）
├─ build-profile.json5       工程级构建配置（SDK 版本 / 签名占位）
├─ hvigorfile.ts             工程级 hvigor 脚本
├─ hvigor/hvigor-config.json5
└─ entry/
   ├─ src/main/ets/pages/Index.ets        虚拟主机 + rawfile 拦截承载
   ├─ src/main/ets/entryability/EntryAbility.ets
   ├─ src/main/module.json5               设备类型 / 权限（INTERNET）
   └─ src/main/resources/rawfile/www/     ← web 构建产物（勿手改）
```

## 构建

1. 同步 web 产物（仓库根目录执行）：

   ```
   node scripts/build-harmony.mjs
   ```

   （等价于 `pnpm build:web` 后把 `dist/` 复制到
   `harmony/entry/src/main/resources/rawfile/www/`）

2. 用 **DevEco Studio 5.0.5+** 打开 `harmony/` 目录；
3. 首次打开按提示等待 hvigor Sync 完成（自动下载依赖）；
4. 调试签名：`File > Project Structure > Signing Configs` 勾选
   *Automatically generate signature information*（登录华为账号，自动回填
   `build-profile.json5` 的 `signingConfigs`）；
5. 菜单 `Build > Build App(s)/Hap(s) > Build Hap(s)`，
   产物：`entry/build/default/outputs/default/entry-default-signed.hap`。

### 命令行构建（可选）

装好 DevEco 的 `command-line-tools` 后：

```
cd harmony
hvigorw assembleHap --mode module -p product=default
```

## 构建问题排查

| 现象 | 处理 |
| --- | --- |
| 资源缺失（`$media:app_icon`、`$string:*`、`$color:*`） | 先确认已执行 `pnpm dist:harmony` 生成 `entry/src/main/resources/rawfile/www`；仓库已包含 `AppScope/resources/base/media/app_icon.png` 与 entry 侧资源，若仍报缺失，检查本地是否误删文件 |
| 首次 hvigor Sync 卡住或依赖下载失败 | Sync 需要联网，配置内网代理或镜像后重试；可删除 `harmony/.hvigor` 缓存后重新打开工程 |
| `modelVersion` 相关异常 | 根 `oh-package.json5` 与 `hvigor/hvigor-config.json5` 均应保持 `5.0.5`，且与 DevEco Studio 版本匹配 |
| 构建 HAP 提示未签名 | 先完成上文的自动签名配置；未签名工程只能预览，无法产出可安装 HAP |
| ArkTS 报 `getContext` 已废弃 | 页面内应使用 `getContext(this)`；仓库代码已修正，避免回退为无参调用 |

## 版本对应

- `compatibleSdkVersion`: 5.0.5(17) —— HarmonyOS NEXT 5.0.5 / API 17
- 设备类型：phone / tablet
