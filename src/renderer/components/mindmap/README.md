# 思维导图编辑器（`src/renderer/components/mindmap`）

Markdown 中 ` ```mindmap ` 代码块的全屏编辑器。编辑界面参照思绪思维导图演示站（`D:\参考项目\mind-map\web\src\pages\Edit`，Vue 2 + Element UI）用 Vue 3 重写；引擎为移植进 `src/core/mindmap-engine` 的 simple-mind-map 源码（见该目录 `NOTICE.md`）。

## 数据流

1. 代码块（`core/nodeviews/code-block.ts`）显示引擎离屏渲染的预览图（`core/nodeviews/mindmap-preview.ts`），点击「编辑思维导图」/ 双击预览时派发 `livemd:mindmap-edit` 事件；
2. `LivemdEditor.vue` 打开全屏编辑器 `MindMapEditor.vue`，传入代码块内容；
3. 代码块内容为 JSON（与 `.smm` 文件结构一致，见 `core/utils/mindmap-document.ts`），旧版「缩进层级文本」自动兼容；
4. 编辑器「保存」时 `mindMap.getData(true)` 序列化后写回代码块（可撤销），「退出」时如有未保存修改会询问。

## 目录

| 路径 | 说明 | 对应参考项目 |
| --- | --- | --- |
| `MindMapEditor.vue` | 根组件：创建引擎、转发事件、保存 / 退出、全局快捷键 | `Edit.vue` |
| `context.ts` | 共享上下文（事件总线、激活节点、面板、偏好） | `$bus` + Vuex store + `api/index.js` |
| `config/` | 中文下拉列表、结构图、公式、扩展图标、贴纸 | `config/*` |
| `utils/` | 文件保存 / 读取、剪贴板、全屏、备注 Markdown 渲染 | `utils/*` |
| `ui/` | 通用小部件：`MmPanel`（右侧面板）、`MmDialog`（弹窗）、`MmColor`（取色）、`mm-common.less`（按钮 / 表单样式） | `Sidebar.vue`、el-dialog、`Color.vue`、Element UI |
| `toolbar/` | 顶部工具栏、节点按钮 | `Toolbar.vue`、`ToolbarNodeBtnList.vue` |
| `dialogs/` | 导入、导出 | `Import.vue`、`Export.vue` |
| `node/` | 节点内容：图片、图标、超链接、备注、标签、公式、外框、关联线样式、富文本工具栏 | `Node*.vue`、`FormulaSidebar.vue`、`AssociativeLineStyle.vue`、`RichTextToolbar.vue` |
| `panels/` | 右侧触发栏与面板：节点样式、基础样式、主题、结构、大纲、设置、快捷键 | `SidebarTrigger.vue`、`Style.vue`、`BaseStyle.vue`、`Theme.vue`、`Structure.vue`、`Outline*.vue`、`Setting.vue`、`ShortcutKey.vue` |
| `navigator/` | 底部栏（字数、定位、搜索、鼠标行为、小地图、只读、全屏、缩放、暗色、演示）、右键菜单 | `NavigatorToolbar.vue` 等 |
| `assets/` | 图标字体（已改名，见下）、结构预览图、导出格式图、贴纸、默认图片 | `assets/*` |

## 移植约定（新增 / 修改组件时遵守）

### 组件写法

- `<script setup lang="ts">` + 组合式 API；中文注释，关键节点 `console.info/debug/warn/error("[MindMap/组件名] …")`。
- 不接收引擎相关 props，统一从上下文取：
  ```ts
  const { mindMap, bus, activeNodes, activeSidebar, setActiveSidebar, localConfig, setLocalConfig,
          engineConfig, setEngineConfig, isDark, isReadonly, isOutlineEdit, execCommand, notifyChange, actions } =
    useMindMapContext();
  ```
  `mindMap.value` 在引擎就绪前为 `null`，使用前判空。
- 参考项目写法对照：

  | 参考项目（Vue 2） | 本项目 |
  | --- | --- |
  | `this.$bus.$on('x', fn)` / `$off` | `useBusEvent('x', fn)`（卸载自动解绑） |
  | `this.$bus.$emit('x', ...)` | `bus.emit('x', ...)` |
  | `this.$bus.$emit('execCommand', 'BACK')` | `execCommand('BACK')` |
  | `mapState(['activeSidebar'])` / `setActiveSidebar(v)` | `activeSidebar` / `setActiveSidebar(v)`（`""` 或 `null` 收起） |
  | `state.localConfig.xxx` / `setLocalConfig({...})` | `localConfig.xxx` / `setLocalConfig({...})` |
  | `state.isReadonly` / `state.localConfig.isDark` / `state.isOutlineEdit` | `isReadonly` / `isDark` / `isOutlineEdit`（ref） |
  | `storeData({...})`（主题 / 结构 / 样式改动后） | `notifyChange()`（数据随「保存」写回，不单独持久化） |
  | `storeConfig(config)` + `mindMap.updateConfig` | `setEngineConfig({ key: value })` |
  | `this.$t('xxx.yyy')` | 直接写中文（查 `D:\参考项目\mind-map\web\src\lang\zh_cn.js`），LiveMD 的 i18n 插件会自动处理 |
  | `this.$message.success(msg)` / `$notify` | `autotoast.show(msg, "success" \| "error" \| "info")`（`import autotoast from "autotoast.js"`） |
  | `this.$confirm(...)` | `window.confirm(...)` 或 `MmDialog` |
  | `require('...')` 资源 | `import x from "../assets/..."` |

- **禁止使用 `autodialog`**：它是全局单例，打开新弹窗会关掉其它弹窗；弹窗一律用 `ui/MmDialog.vue`。
- 文件保存用 `utils` 的 `saveExportFile`（Tauri 下走原生「另存为」），不要用 `<a download>`；选文件用 `pickFile`。

### 界面

- Element UI 替换：`el-button` → `<button class="mm-btn">`（`mm-btn--primary` / `mm-btn--small`）、`el-input` → `<input class="mm-input">`、`el-input-number` → `<input type="number" class="mm-number">`、`el-select` → `<select class="mm-select">`、`el-radio-group` → `.mm-segment`、`el-switch` → `@/renderer/components/ui/switch`、`el-slider` → `<input type="range">`、`el-color-picker` / `Color.vue` → `ui/MmColor.vue`、`el-dialog` → `ui/MmDialog.vue`、`el-tooltip` → `title` 属性、`el-tabs` → 自写简单页签；表单行用 `.mm-row` / `.mm-row__label` / `.mm-row__control`，分组标题用 `.mm-section-title`（见 `ui/mm-common.less`，根组件全局引入）。
- 右侧面板用 `<MmPanel name="theme" title="主题">`，仅在 `activeSidebar === name` 时显示。
- 颜色只用 LiveMD 主题变量（`--background-color-1/2/3`、`--text-color/-1/-2/-3`、`--border-color-1/2`、`--primary-color`、`--hover-background-color`），暗色界面自动适配；根元素在暗色时带 `.is-dark`。
- 图标用移植的图标字体：`<span class="mm-iconfont iconzhuti"></span>`（参考项目的 `iconfont iconxxx` 把 `iconfont` 换成 `mm-iconfont` 即可，字体已改名避免与 LiveMD 自身 iconfont 冲突）。
- 浮层都放在编辑器根元素内（`position: absolute`），不要挂到 `document.body`；层级约定：画布浮动按钮 / 底部栏 / 工具栏 1000，右侧面板 1100，右键菜单 / 浮动工具条 1500，`MmDialog` 3000。引擎自身的文字编辑框挂在 body 上（z-index 由根组件设为 10000）。
- 面板、弹窗内的输入框按键已由 `MmPanel` / `MmDialog` 阻止冒泡；自建的其它浮层若含输入框，同样在根元素加 `@keydown.stop`，避免触发引擎快捷键。
- `MmDialog` 打开期间焦点若掉回 body（焦点元素被移除 / 禁用、点击 toast 等），它在 window 捕获阶段拦截落在 body 上的按键（Esc 关闭、Tab 回到弹窗、其它键吞掉），叠加弹窗只由最上层处理；弹窗组件无需自行处理。需要暂停引擎快捷键表的节点弹窗用 `node/useNodeDialogGuard.ts`。
- 浮层聚焦一律 `focus({ preventScroll: true })`；根元素已改为 `overflow: clip`，但仍应避免 `scrollIntoView` 滚动编辑器根元素。

### 引擎事件

根组件把以下引擎事件原样转发到 `bus`（参数与引擎一致）：`node_active`、`data_change`、`view_data_change`、`back_forward`、`node_contextmenu`、`node_click`、`draw_click`、`expand_btn_click`、`svg_mousedown`、`mouseup`、`mode_change`、`node_tree_render_end`、`rich_text_selection_change`、`transforming-dom-to-images`、`generalization_node_contextmenu`、`painter_start`、`painter_end`、`scrollbar_change`、`scale`、`translate`、`node_attachmentClick`、`node_attachmentContextmenu`、`demonstrate_jump`、`exit_demonstrate`、`node_note_dblclick`、`node_mousedown`、`layout_change`、`view_theme_change`、`search_info_change`、`associative_line_click`、`associative_line_deactivate`、`outer_frame_active`、`outer_frame_deactivate`、`node_img_dblclick`、`node_icon_click`、`node_tag_click`、`mini_map_view_box_position_change`。其它事件可直接 `mindMap.value.on(...)`（记得卸载时 `off`）。

根组件还处理这些总线事件（与参考项目 `Edit.vue` 一致）：`execCommand`、`setData`（导入 / 新建 / 打开）、`export`（`(type, isDownload, name, ...args)`）、`startTextEdit`、`endTextEdit`、`createAssociativeLine`、`startPainter`、`showLoading`、`hideLoading`。

### 检查

改动文件跑 `npx oxlint <文件>` 与 `npx oxfmt <文件>`；`.vue` 文件的类型由 `pnpm build:web` 兜底。
