# 第三方代码说明

本目录为移植的第三方源码，保持上游代码风格，已从 oxlint / oxfmt 检查范围中排除（见仓库根目录 `.oxlintrc.json`、`.oxfmtrc.json`）。

| 部分 | 上游 | 版本 | 许可 |
| --- | --- | --- | --- |
| `index.js`、`src/**` | [simple-mind-map](https://github.com/wanglin2/mind-map)（The MindMap Team） | 0.14.0-fix.3 | MIT，见 `LICENSE` |
| `themes/**` | simple-mind-map-plugin-themes | 1.0.1 | ISC |

## 本项目的改动

- 删除 `src/plugins/Cooperate.js`（协同编辑，依赖 yjs / y-webrtc），入口 `full.js` 不注册该插件；
- 新增 `full.js`（入口，注册全部插件与扩展主题）、`full.d.ts` 与 `themes/*.d.ts`（类型声明）；
- `themes/` 下的导入路径由 `./src/` 改为相对本目录。

如需同步上游，可直接对比上游同名文件后覆盖，再按上述清单复核。
