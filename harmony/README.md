# LiveMD HarmonyOS NEXT（鸿蒙）壳工程

Tauri 2 官方不支持 HarmonyOS。本目录是一个 **ArkTS（Stage 模型）壳工程**：
用 ArkWeb `Web` 组件以虚拟主机 + rawfile 回源的方式承载 LiveMD 的 web 构建
产物（`dist/`），交付可在 DevEco Studio 直接构建/运行的 HAP。

> 能力边界：此方式运行的是 **web 版 LiveMD**——编辑器渲染、解析、导出等
> 前端能力完整；ArkTS 桥接支持 Markdown 文件导入，以及应用文档目录的读写、列表、删除。
> 依赖 Tauri Rust 后端的桌面能力（本地文件树、文件 watcher、剪贴板系统调用等）
> 在壳内走前端降级路径。
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
   pnpm dist:harmony
   ```

   （等价于 `pnpm build:web` 后把 `dist/` 复制到
   `harmony/entry/src/main/resources/rawfile/www/`）

2. 用 **DevEco Studio 26.0** 打开 `harmony/` 目录，安装与 `build-profile.json5` 一致的 SDK；
3. 首次打开按提示等待 hvigor Sync 完成（自动下载依赖）；
4. 调试签名：`File > Project Structure > Project > Signing Configs` 勾选
   *Automatically generate signature information*，登录华为账号并为目标设备生成签名；
   本机签名材料可保存在 `.sign/sign-config.json5`，Hvigor 会自动读取。
   `build-profile.json5` 的 `default` 产品通过 `"signingConfig": "default"` 选择同名配置；
5. 菜单 `Build > Build App(s)/Hap(s) > Build Hap(s)`，
   产物：`entry/build/default/outputs/default/entry-default-signed.hap`。

### 命令行构建（可选）

装好 DevEco 的 `command-line-tools` 后：

```
cd harmony
hvigorw assembleHap --mode module -p product=default -p module=entry@default
```

DevEco 26.0 的命令行环境需使用 JDK 21 及以上，并设置 `DEVECO_SDK_HOME` 为
DevEco 安装目录下的 `sdk`。本机须有名为 `default` 的签名配置；私有证书、
描述文件、密钥库与密码不进入版本库。仅验证未签名构建时，可临时移除产品的
`signingConfig` 字段，产物为 `entry-default-unsigned.hap`。

## 构建问题排查

| 现象 | 处理 |
| --- | --- |
| 资源缺失（`$media:app_icon`、`$string:*`、`$color:*`） | 先确认已执行 `pnpm dist:harmony` 生成 `entry/src/main/resources/rawfile/www`；仓库已包含 `AppScope/resources/base/media/app_icon.png` 与 entry 侧资源，若仍报缺失，检查本地是否误删文件 |
| 首次 hvigor Sync 卡住或依赖下载失败 | Sync 需要联网，配置内网代理或镜像后重试；可删除 `harmony/.hvigor` 缓存后重新打开工程 |
| `modelVersion` 相关异常 | 根 `oh-package.json5` 与 `hvigor/hvigor-config.json5` 均应保持 `5.0.5`，且与 DevEco Studio 版本匹配 |
| 构建 HAP 提示未签名 | 未签名 HAP 可用于编译验证；安装前完成上文的自动签名配置并重新构建 |
| `9568320: no signature file` | 安装的是 `unsigned.hap`；检查产品的 `signingConfig` 是否与 `.sign/sign-config.json5` 中的配置名称一致，再重新构建 `signed.hap` |
| SDK 版本号校验失败 | 当前 SDK 使用纯点分字符串 `"26.0.1"`，不要写成 `"26.0.1(26)"`；以本地 SDK 可用列表为准 |
| ArkTS 报 `getContext` 已废弃 | 页面内应使用 `getContext(this)`；仓库代码已修正，避免回退为无参调用 |

## 版本对应

- `compatibleSdkVersion` / `targetSdkVersion`: `"26.0.1"` —— HarmonyOS 26.0.1 / API 26
- `modelVersion`: `"5.0.5"`，根 `oh-package.json5` 与 `hvigor/hvigor-config.json5` 必须一致
- 设备类型：phone / tablet


## DevEco 直接运行的前端资源同步

entry/hvigorfile.ts 在构建配置加载时调用 scripts/build-harmony.mjs --prepare。
脚本对 src/、public/、lang/ 和前端构建配置计算 SHA-256；指纹变化时先运行 Vite 构建，再同步 dist 到 rawfile/www。
指纹缓存位于 harmony/.hvigor/，不纳入版本管理。安装 JavaScript 依赖后即可从 DevEco 直接运行，避免将旧前端资源打入 HAP。

2026-11-18 模拟器排查确认：原安装包仍使用旧资源，点击打开文件触发缺失的 Tauri invoke；同步最新资源、重新构建安装后，按钮已弹出 DocumentViewPicker 原生文件选择器。HAP 编译、模拟器安装及选择器弹出均验证通过；模拟器暂无 Markdown 文件，选中文件后的完整读取仍待验证。

## 文档目录

文档保存到应用 `filesDir/documents`，新文档首次保存输入文件名，之后直接覆盖。
导入文件复制到该目录；文档列表从磁盘读取，重启后保留。卸载应用会清除这些文件。
浏览器移动预览的 localStorage 保存只用于界面验证，设备上的保存由 ArkTS 桥接执行。
