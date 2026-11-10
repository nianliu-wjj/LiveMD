<script setup lang="ts">
/**
 * 思维导图全屏编辑器（根组件，对应参考项目 web/src/pages/Edit/components/Edit.vue）
 *
 * 职责：
 * 1. 解析代码块内容（JSON / 旧版缩进文本）并创建引擎实例，选项与参考项目编辑页一致；
 * 2. 创建并下发共享上下文（context.ts），把引擎事件原样转发到编辑器事件总线；
 * 3. 处理总线上的全局动作：执行命令、导入 / 新建（setData）、导出、文字编辑、关联线、格式刷、加载态；
 * 4. 按界面偏好动态加载富文本 / 滚动条插件（与参考项目一致）；
 * 5. 「保存」把 getData(true) 序列化后通过 save 事件写回 Markdown 代码块，「退出」时有未保存修改则询问；
 * 6. 打开期间标记 <html data-mindmap-editing>，让 LiveMD 全局快捷键让路（Ctrl+S 在这里表示写回思维导图）。
 *
 * 各工具栏 / 面板 / 弹窗组件只依赖上下文，由本组件在引擎就绪后统一挂载。
 */
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import autotoast from "autotoast.js";
import MindMap, { RichText, Scrollbar as ScrollbarPlugin } from "@/core/mindmap-engine/full.js";
import type { MindMapInstance, MindMapNodeInstance } from "@/core/mindmap-engine/full";
import { parseMindMapDocument, serializeMindMapDocument } from "@/core/utils/mindmap-document";
import { setMindMapEditorOpen } from "@/renderer/utils/mindmapEditorState";
import {
  createMindMapContext,
  provideMindMapContext,
  readEngineConfig,
  type MindMapContext,
} from "./context";
import { extraIconList } from "./config";
import { saveExportFile } from "./utils";
import handleClipboardText from "./utils/handleClipboardText";
import defaultNodeImage from "./assets/image-load-failed.svg";
import MmDialog from "./ui/MmDialog.vue";
import "./assets/icon-font/iconfont.css";
import "./ui/mm-common.less";
// 顶部工具栏与导入导出
import Toolbar from "./toolbar/Toolbar.vue";
import Import from "./dialogs/Import.vue";
import Export from "./dialogs/Export.vue";
// 节点内容
import NodeImage from "./node/NodeImage.vue";
import NodeHyperlink from "./node/NodeHyperlink.vue";
import NodeIcon from "./node/NodeIcon.vue";
import NodeNote from "./node/NodeNote.vue";
import NodeTag from "./node/NodeTag.vue";
import NodeIconSidebar from "./node/NodeIconSidebar.vue";
import NodeIconToolbar from "./node/NodeIconToolbar.vue";
import NodeNoteSidebar from "./node/NodeNoteSidebar.vue";
import NodeNoteContentShow from "./node/NodeNoteContentShow.vue";
import NodeTagStyle from "./node/NodeTagStyle.vue";
import NodeImgPreview from "./node/NodeImgPreview.vue";
import FormulaSidebar from "./node/FormulaSidebar.vue";
import NodeOuterFrame from "./node/NodeOuterFrame.vue";
import NodeImgPlacementToolbar from "./node/NodeImgPlacementToolbar.vue";
import AssociativeLineStyle from "./node/AssociativeLineStyle.vue";
import RichTextToolbar from "./node/RichTextToolbar.vue";
// 右侧触发栏与面板
import SidebarTrigger from "./panels/SidebarTrigger.vue";
import Style from "./panels/Style.vue";
import BaseStyle from "./panels/BaseStyle.vue";
import Theme from "./panels/Theme.vue";
import Structure from "./panels/Structure.vue";
import Setting from "./panels/Setting.vue";
import ShortcutKey from "./panels/ShortcutKey.vue";
import OutlineSidebar from "./panels/OutlineSidebar.vue";
import OutlineEdit from "./panels/OutlineEdit.vue";
// 底部栏、小地图、搜索、右键菜单
import NavigatorToolbar from "./navigator/NavigatorToolbar.vue";
import Navigator from "./navigator/Navigator.vue";
import Count from "./navigator/Count.vue";
import Search from "./navigator/Search.vue";
import Contextmenu from "./navigator/Contextmenu.vue";
import Scrollbar from "./navigator/Scrollbar.vue";

const props = withDefaults(
  defineProps<{
    /** 代码块内容（JSON 文档或旧版缩进层级文本） */
    source: string;
    /** 以只读方式打开 */
    readonly?: boolean;
  }>(),
  { readonly: false }
);

const emit = defineEmits<{
  /** 写回代码块（编辑器保持打开） */
  (e: "save", source: string): void;
  /** 关闭编辑器 */
  (e: "close"): void;
}>();

/** 引擎转发到总线的事件（参考项目 Edit.vue 的列表 + 面板 / 浮层需要的事件） */
const FORWARDED_EVENTS = [
  "node_active",
  "data_change",
  "view_data_change",
  "back_forward",
  "node_contextmenu",
  "node_click",
  "draw_click",
  "expand_btn_click",
  "svg_mousedown",
  "mouseup",
  "mode_change",
  "node_tree_render_end",
  "rich_text_selection_change",
  "transforming-dom-to-images",
  "generalization_node_contextmenu",
  "painter_start",
  "painter_end",
  "scrollbar_change",
  "scale",
  "translate",
  "node_attachmentClick",
  "node_attachmentContextmenu",
  "demonstrate_jump",
  "exit_demonstrate",
  "node_note_dblclick",
  "node_mousedown",
  "layout_change",
  "view_theme_change",
  "search_info_change",
  "associative_line_click",
  "associative_line_deactivate",
  "outer_frame_active",
  "outer_frame_deactivate",
  "node_img_dblclick",
  "node_icon_click",
  "node_tag_click",
  "mini_map_view_box_position_change",
] as const;

/** 导出类型 → 文件扩展名 */
const EXPORT_EXT: Record<string, string> = { smm: "smm", json: "json" };

/** LiveMD 当前是否为暗色主题（编辑器界面默认跟随） */
const appIsDark = document.documentElement.dataset.themeMode === "dark";

const context: MindMapContext = createMindMapContext({
  isDark: appIsDark,
  isReadonly: props.readonly,
});
provideMindMapContext(context);
const { mindMap, bus, activeNodes, localConfig, isDark, isReadonly, isDirty } = context;

const rootRef = ref<HTMLElement | null>(null);
const containerRef = ref<HTMLElement | null>(null);
/** 引擎实例创建完成（子组件据此挂载） */
const ready = ref(false);
/** 加载遮罩（首屏渲染、导入、导出） */
const loading = ref(true);
/** 加载遮罩上的提示文字 */
const loadingText = ref("思维导图加载中…");
/** 解析或初始化失败的原因 */
const loadError = ref("");
/** 拖入文件导入的遮罩 */
const showDragMask = ref(false);
/** 退出确认弹窗 */
const closeConfirmVisible = ref(false);

/** 上次写回文档时的数据快照（不含视图平移缩放），用于判断是否有未保存修改 */
let savedSnapshot: string | null = null;
let resizeObserver: ResizeObserver | null = null;
let dirtyTimer: ReturnType<typeof setTimeout> | null = null;
const busDisposers: Array<() => void> = [];

/**
 * 编辑器界面配色：与 LiveMD 主题一致时不覆盖变量；用户在底部栏切换明暗后，
 * 用 force-dark / force-light 覆盖背景、文字、边框等变量（主色保持 LiveMD 主题色）
 */
const themeClass = computed(() => {
  if (isDark.value && !appIsDark) return "force-dark";
  if (!isDark.value && appIsDark) return "force-light";
  return "";
});

/** 数据快照：只比较节点、结构、主题，平移缩放不算修改 */
function snapshotOf(data: { layout: unknown; root: unknown; theme: unknown }): string {
  return JSON.stringify({ layout: data.layout, root: data.root, theme: data.theme });
}

/** 重新计算未保存状态（立即） */
function refreshDirtyNow(): boolean {
  if (!mindMap.value || savedSnapshot === null) return false;
  isDirty.value = snapshotOf(mindMap.value.getData(true)) !== savedSnapshot;
  return isDirty.value;
}

/** 数据变化后延迟重算未保存状态（连续编辑时合并，避免频繁深拷贝整棵树） */
function scheduleDirtyCheck(): void {
  if (dirtyTimer) clearTimeout(dirtyTimer);
  dirtyTimer = setTimeout(() => {
    dirtyTimer = null;
    refreshDirtyNow();
  }, 300);
}

/** 树中是否存在富文本节点（存在时需开启富文本插件才能正确编辑） */
function hasRichTextNode(
  node: { data?: { richText?: unknown }; children?: unknown[] } | null
): boolean {
  if (!node) return false;
  if (node.data?.richText) return true;
  return (node.children ?? []).some((child) =>
    hasRichTextNode(child as { data?: { richText?: unknown }; children?: unknown[] })
  );
}

/** 数据含富文本节点而富文本未开启时自动开启（对应参考项目 setData 中的提示） */
function ensureRichTextFor(root: unknown): void {
  if (localConfig.openNodeRichText || !hasRichTextNode(root as never)) return;
  context.setLocalConfig({ openNodeRichText: true });
  bus.emit("toggleOpenNodeRichText", true);
  autotoast.show("该思维导图包含富文本节点，已自动开启节点富文本编辑", "info");
}

/** 按偏好加载 / 卸载富文本插件 */
function applyRichTextPlugin(enabled: boolean): void {
  const instance = mindMap.value;
  if (!instance) return;
  if (enabled) {
    instance.addPlugin(RichText);
  } else {
    instance.removePlugin(RichText);
  }
  console.info("[MindMap/Editor] 节点富文本:", enabled ? "开启" : "关闭");
}

/** 按偏好加载 / 卸载滚动条插件 */
function applyScrollbarPlugin(enabled: boolean): void {
  const instance = mindMap.value;
  if (!instance) return;
  if (enabled) {
    instance.addPlugin(ScrollbarPlugin);
  } else {
    instance.removePlugin(ScrollbarPlugin);
  }
}

/** 结束可能正在进行的节点文字编辑，保证保存 / 导出拿到最新文字 */
function commitTextEdit(): void {
  try {
    mindMap.value?.renderer?.textEdit?.hideEditTextBox?.();
  } catch (error) {
    console.warn("[MindMap/Editor] 结束文字编辑失败:", error);
  }
}

/** 保存：写回 Markdown 代码块，编辑器保持打开 */
function save(): void {
  const instance = mindMap.value;
  if (!instance) return;
  if (isReadonly.value && !isDirty.value) {
    autotoast.show("只读模式下没有需要保存的修改", "info");
    return;
  }
  commitTextEdit();
  const data = instance.getData(true);
  const source = serializeMindMapDocument(data);
  emit("save", source);
  savedSnapshot = snapshotOf(data);
  isDirty.value = false;
  console.info("[MindMap/Editor] 已写回文档，长度:", source.length);
}

/** 退出：有未保存修改时弹出确认 */
function requestClose(): void {
  commitTextEdit();
  if (refreshDirtyNow()) {
    closeConfirmVisible.value = true;
    return;
  }
  emit("close");
}

function saveAndClose(): void {
  closeConfirmVisible.value = false;
  save();
  emit("close");
}

function discardAndClose(): void {
  closeConfirmVisible.value = false;
  console.info("[MindMap/Editor] 放弃未保存的修改并退出");
  emit("close");
}

context.actions.save = save;
context.actions.close = requestClose;

/** 显示加载遮罩 */
function showLoading(text = "思维导图加载中…"): void {
  loadingText.value = text;
  loading.value = true;
}

/** 动态设置数据（导入 / 新建 / 打开，对应参考项目 Edit.setData） */
function setData(data: any): void {
  const instance = mindMap.value;
  if (!instance || !data) return;
  showLoading("正在载入思维导图…");
  let rootData: unknown;
  if (data.root) {
    instance.setFullData(data);
    rootData = data.root;
  } else {
    instance.setData(data);
    rootData = data;
  }
  instance.view.reset();
  ensureRichTextFor(rootData);
  context.notifyChange();
  console.info("[MindMap/Editor] 已载入新数据");
}

/**
 * 导出（对应参考项目 Edit.export）：统一拿到导出结果后走原生「另存为」，
 * 不使用引擎内置的 <a download>（Tauri WebView 中不可靠）
 */
async function exportFile(type: string, isDownload = true, name = "思维导图", ...args: any[]) {
  const instance = mindMap.value;
  if (!instance) return;
  showLoading("正在导出…");
  try {
    commitTextEdit();
    const result = await instance.export(type, false, name, ...args);
    if (isDownload && result) {
      const saved = await saveExportFile(result, name, EXPORT_EXT[type] ?? type);
      if (saved) autotoast.show("导出成功", "success");
    }
    return result;
  } catch (error) {
    console.error("[MindMap/Editor] 导出失败:", error);
    autotoast.show(`导出失败：${error instanceof Error ? error.message : String(error)}`, "error");
  } finally {
    loading.value = false;
  }
}

/** 订阅总线事件（卸载时统一解绑） */
function onBus(event: string, handler: (...args: any[]) => void): void {
  busDisposers.push(bus.on(event, handler));
}

function bindBusEvents(): void {
  onBus("execCommand", (name: string, ...args: any[]) => context.execCommand(name, ...args));
  onBus("setData", setData);
  onBus("export", exportFile);
  onBus("paddingChange", (data: Record<string, unknown>) => mindMap.value?.updateConfig(data));
  onBus("startTextEdit", () => mindMap.value?.renderer.startTextEdit());
  onBus("endTextEdit", () => mindMap.value?.renderer.endTextEdit());
  onBus("createAssociativeLine", () => mindMap.value?.associativeLine?.createLineFromActiveNode());
  onBus("startPainter", () => mindMap.value?.painter?.startPainter());
  onBus("showLoading", (text?: string) => showLoading(typeof text === "string" ? text : undefined));
  onBus("hideLoading", () => (loading.value = false));
  onBus("node_tree_render_end", () => (loading.value = false));
  onBus("closeSideBar", () => context.setActiveSidebar(""));
  // 双击节点上的备注图标打开备注弹窗（参考项目放在 Toolbar，移到这里后禅模式下同样可用）
  onBus("node_note_dblclick", (node: MindMapNodeInstance, event?: Event) => {
    event?.stopPropagation();
    bus.emit("showNodeNote", node);
  });
  onBus("toggleOpenNodeRichText", (value: boolean) => {
    if (localConfig.openNodeRichText !== value) context.setLocalConfig({ openNodeRichText: value });
  });
  // 数据 / 主题 / 结构变化：刷新未保存状态
  for (const event of ["data_change", "layout_change", "view_theme_change", "mm:change"]) {
    onBus(event, scheduleDirtyCheck);
  }
  onBus("node_active", (_node: unknown, list: MindMapNodeInstance[]) => {
    activeNodes.value = [...(list ?? [])];
  });
  onBus("back_forward", (index: number, length: number) => {
    context.canBack.value = index > 0;
    context.canForward.value = index < length - 1;
  });
  onBus("mode_change", (mode: string) => {
    isReadonly.value = mode === "readonly";
  });
}

/** 创建引擎实例（选项与参考项目 Edit.init 一致，按 LiveMD 场景调整） */
function createEngine(container: HTMLElement): MindMapInstance {
  const doc = parseMindMapDocument(props.source);
  const instance = new MindMap({
    el: container,
    data: doc.root,
    layout: doc.layout,
    theme: doc.theme.template,
    themeConfig: doc.theme.config,
    viewData: doc.view,
    readonly: props.readonly,
    fit: false,
    // 引擎的文字编辑框、备注浮层挂在 body 上，层级需高于全屏编辑器（2000）与 LiveMD 菜单（9000）
    nodeTextEditZIndex: 10000,
    nodeNoteTooltipZIndex: 10000,
    customNoteContentShow: {
      show: (content: string, left: number, top: number, node: MindMapNodeInstance) => {
        bus.emit("showNoteContent", content, left, top, node);
      },
      hide: () => {},
    },
    openRealtimeRenderOnNodeTextEdit: true,
    enableAutoEnterTextEditWhenKeydown: true,
    demonstrateConfig: { openBlankMode: false },
    // 「设置」面板保存的引擎选项
    ...readEngineConfig(),
    iconList: [...extraIconList],
    useLeftKeySelectionRightKeyDrag: localConfig.useLeftKeySelectionRightKeyDrag,
    customInnerElsAppendTo: null,
    customHandleClipboardText: handleClipboardText,
    defaultNodeImage,
    initRootNodePosition: ["center", "center"],
    handleIsSplitByWrapOnPasteCreateNewNode: () =>
      window.confirm("是否按换行自动拆分成多个节点？")
        ? Promise.resolve()
        : Promise.reject(new Error("用户选择不拆分")),
    errorHandler: (code: string, error: unknown) => {
      console.error("[MindMap/Editor] 引擎错误:", code, error);
      if (code === "export_error") autotoast.show("导出失败", "error");
    },
    expandBtnNumHandler: (num: number) => (num >= 100 ? "…" : num),
    // 节点超链接：WebView 中 <a target="_blank"> 不可靠，走 LiveMD 的链接打开逻辑（与文档内链接一致）
    customHyperlinkJump: (link: string) => openHyperlink(link),
    // 返回 true 表示阻止删除（与参考项目一致：确认后才删除）
    beforeDeleteNodeImg: () => Promise.resolve(!window.confirm("确定删除该节点图片吗？")),
  });

  for (const event of FORWARDED_EVENTS) {
    instance.on(event, (...args: any[]) => bus.emit(event, ...args));
  }
  instance.keyCommand.addShortcut("Control+s", save);
  return instance;
}

/** 打开节点超链接：相对路径按当前文档解析，http(s) 等交给系统浏览器 */
function openHyperlink(link: string): void {
  const api = (window as any).electronAPI;
  const currentFilePath = (window as any).__currentFilePath || null;
  console.info("[MindMap/Editor] 打开节点超链接:", link);
  if (api?.openLink) {
    void api.openLink(link, currentFilePath);
  } else if (api?.openExternal) {
    void api.openExternal(link);
  } else {
    window.open(link, "_blank", "noopener,noreferrer");
  }
}

/** 根元素按键：焦点在输入框（面板、弹窗）里时引擎快捷键不生效，Ctrl+S 在这里补上「保存」 */
function onRootKeydown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null;
  const inField = Boolean(target?.closest("input, textarea, select, [contenteditable='true']"));
  if (inField && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    save();
  }
}

/** 可拖入导入的文件类型（与导入弹窗一致） */
const IMPORTABLE_FILE_RE = /\.(smm|json|xmind|md|markdown)$/i;

/** 拖到面板 / 弹窗里时交给它们自己处理（如背景图片、节点图片的拖入上传） */
function isInsideOwnDropZone(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(".mm-panel, .mm-dialog-mask"));
}

/** 是否有弹窗打开：弹窗（如节点图片）自行接管系统拖入 */
function hasOpenDialog(): boolean {
  return Boolean(rootRef.value?.querySelector(".mm-dialog-mask"));
}

/** Tauri 合成拖放事件里的 File 只有文件名（无内容），按路径读回真实内容 */
async function materializeDroppedFile(file: File): Promise<File> {
  if (file.size > 0) return file;
  const api = (window as any).electronAPI;
  const path: string | undefined = api?.getPathForFile?.(file);
  if (!path || typeof api?.readFileBase64 !== "function") return file;
  const base64: string = await api.readFileBase64(path);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], file.name);
}

/**
 * 拖入文件导入（对应参考项目 onDragenter / onDrop）
 *
 * 桌面端系统拖放由 LiveMD 转成派发在 window 上的合成事件，元素收不到，因此在 window 捕获阶段统一处理；
 * 同时阻止 LiveMD 自身的 window drop 监听把文件插入 / 打开到被遮住的文档里。
 */
function onWindowDragOver(event: DragEvent): void {
  if (!event.dataTransfer?.types.includes("Files")) return;
  if (isInsideOwnDropZone(event.target) || hasOpenDialog()) {
    showDragMask.value = false;
    return;
  }
  event.preventDefault();
  showDragMask.value = localConfig.enableDragImport && !isReadonly.value;
}

function onWindowDragLeave(event: DragEvent): void {
  // 合成事件的 target 是 window；真实拖拽离开窗口时 relatedTarget 为 null
  if (event.target === window || !event.relatedTarget) showDragMask.value = false;
}

async function onWindowDrop(event: DragEvent): Promise<void> {
  showDragMask.value = false;
  if (isInsideOwnDropZone(event.target) || hasOpenDialog()) return;
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (!localConfig.enableDragImport || isReadonly.value) return;
  if (!IMPORTABLE_FILE_RE.test(file.name)) {
    autotoast.show("只支持拖入 .smm / .json / .xmind / .md 文件导入", "info");
    return;
  }
  try {
    bus.emit("importFile", await materializeDroppedFile(file));
    console.info("[MindMap/Editor] 拖入文件导入:", file.name);
  } catch (error) {
    console.error("[MindMap/Editor] 读取拖入的文件失败:", error);
    autotoast.show("读取拖入的文件失败", "error");
  }
}

function onWindowDropCapture(event: DragEvent): void {
  void onWindowDrop(event);
}

watch(
  () => localConfig.openNodeRichText,
  (enabled) => applyRichTextPlugin(enabled)
);
watch(
  () => localConfig.isShowScrollbar,
  (enabled) => applyScrollbarPlugin(enabled)
);
watch(
  () => localConfig.useLeftKeySelectionRightKeyDrag,
  (value) => mindMap.value?.updateConfig({ useLeftKeySelectionRightKeyDrag: value })
);

onMounted(() => {
  setMindMapEditorOpen(true);
  window.addEventListener("dragover", onWindowDragOver, true);
  window.addEventListener("dragleave", onWindowDragLeave, true);
  window.addEventListener("drop", onWindowDropCapture, true);
  // 打开前焦点通常还在被遮住的文档编辑区里，不移走的话按键会继续输入到文档中
  (document.activeElement as HTMLElement | null)?.blur?.();
  bindBusEvents();
  const container = containerRef.value;
  if (!container) return;
  try {
    const instance = createEngine(container);
    mindMap.value = instance;
    if (localConfig.openNodeRichText) applyRichTextPlugin(true);
    if (localConfig.isShowScrollbar) applyScrollbarPlugin(true);
    ensureRichTextFor(instance.getData(false));
    // 基准快照：引擎会规范化数据（补 uid 等），以初始化后的数据为准
    savedSnapshot = snapshotOf(instance.getData(true));
    ready.value = true;
    resizeObserver = new ResizeObserver(() => mindMap.value?.resize());
    resizeObserver.observe(container);
    console.info("[MindMap/Editor] 编辑器已就绪");
  } catch (error) {
    loading.value = false;
    loadError.value =
      error instanceof SyntaxError
        ? "思维导图数据格式错误（JSON 无法解析），请在代码块中修正后重试"
        : String(error instanceof Error ? error.message : error);
    console.error("[MindMap/Editor] 初始化失败:", error);
  }
});

// 在 onUnmounted 中销毁引擎：父组件的 onBeforeUnmount 先于子组件执行，若在那里置空实例，
// 子组件卸载时就无法再对引擎 off 自己注册的监听；onUnmounted 时子组件已全部卸载完毕
onUnmounted(() => {
  setMindMapEditorOpen(false);
  window.removeEventListener("dragover", onWindowDragOver, true);
  window.removeEventListener("dragleave", onWindowDragLeave, true);
  window.removeEventListener("drop", onWindowDropCapture, true);
  if (dirtyTimer) clearTimeout(dirtyTimer);
  resizeObserver?.disconnect();
  busDisposers.forEach((dispose) => dispose());
  const instance = mindMap.value;
  if (instance) {
    commitTextEdit();
    // 先销毁实例（各插件走 beforePluginDestroy 清理），再把动态插件从引擎类的插件列表摘掉，
    // 避免影响之后的代码块离屏预览。不要用 removePlugin：RichText 的 beforePluginRemove
    // 会把全部节点转成普通文本并触发重新渲染，对即将销毁的实例毫无意义
    instance.destroy();
    for (const plugin of [RichText, ScrollbarPlugin]) {
      const index = MindMap.hasPlugin(plugin);
      if (index !== -1) MindMap.pluginList.splice(index, 1);
    }
  }
  mindMap.value = null;
  bus.clear();
  console.info("[MindMap/Editor] 编辑器已关闭");
});
</script>

<template>
  <div
    ref="rootRef"
    class="mindmap-editor"
    :class="[themeClass, { 'is-dark': isDark, 'is-zen': localConfig.isZenMode }]"
    @keydown.capture="onRootKeydown"
  >
    <div ref="containerRef" class="mindmap-editor__canvas" />

    <template v-if="ready">
      <template v-if="!localConfig.isZenMode">
        <Toolbar />
        <Count />
        <NavigatorToolbar />
        <SidebarTrigger />
        <Style />
      </template>
      <Navigator />
      <OutlineSidebar />
      <BaseStyle />
      <AssociativeLineStyle />
      <Theme />
      <Structure />
      <ShortcutKey />
      <Setting />
      <Contextmenu />
      <RichTextToolbar />
      <NodeNoteContentShow />
      <NodeImgPreview />
      <Search />
      <NodeIconSidebar />
      <NodeIconToolbar />
      <OutlineEdit />
      <Scrollbar v-if="localConfig.isShowScrollbar" />
      <FormulaSidebar />
      <NodeOuterFrame />
      <NodeTagStyle />
      <NodeImgPlacementToolbar />
      <NodeNoteSidebar />
      <NodeImage />
      <NodeHyperlink />
      <NodeIcon />
      <NodeNote />
      <NodeTag />
      <Import />
      <Export />

      <!-- 禅模式隐藏了工具栏，保留一个退出入口 -->
      <button
        v-if="localConfig.isZenMode"
        type="button"
        class="mindmap-editor__zen-exit mm-btn mm-btn--small"
        @click="context.setLocalConfig({ isZenMode: false })"
      >
        退出禅模式
      </button>
    </template>

    <div v-if="loading && !loadError" class="mindmap-editor__loading">
      <span class="mindmap-editor__spinner" />
      <span>{{ loadingText }}</span>
    </div>

    <div v-if="loadError" class="mindmap-editor__error">
      <p>{{ loadError }}</p>
      <button type="button" class="mm-btn mm-btn--primary" @click="emit('close')">返回文档</button>
    </div>

    <!-- 拖入导入提示（纯视觉，不拦截指针：拖到面板里的上传区时交给面板处理） -->
    <div v-if="showDragMask" class="mindmap-editor__drag-mask">
      <div class="mindmap-editor__drag-tip">将 .smm / .json / .xmind / .md 文件拖到这里导入</div>
    </div>

    <MmDialog v-model="closeConfirmVisible" title="退出思维导图编辑" width="420px">
      <p class="mindmap-editor__confirm-text">思维导图有未保存到文档的修改，是否保存？</p>
      <template #footer>
        <button type="button" class="mm-btn" @click="closeConfirmVisible = false">取消</button>
        <button type="button" class="mm-btn mm-btn--danger" @click="discardAndClose">不保存</button>
        <button type="button" class="mm-btn mm-btn--primary" @click="saveAndClose">
          保存并退出
        </button>
      </template>
    </MmDialog>
  </div>
</template>

<style lang="less">
/* 全屏覆盖层：层级高于 LiveMD 界面（标题栏 / 右缘栏 / 检查面板 ≤ 900），低于应用级确认弹窗（9999） */
.mindmap-editor {
  position: fixed;
  inset: 0;
  z-index: 2000;
  /*
   * clip 不形成滚动容器：hidden 仍会被浮层里的 focus() / scrollIntoView 程序滚动，
   * 导致画布与所有浮层整体错位（右键菜单偏移、右侧画布点不中）。hidden 作为旧 WebKit 的回退。
   */
  overflow: hidden;
  overflow: clip;
  background: var(--background-color-1, #fff);
  color: var(--text-color, #333);
  font-size: 13px;
  user-select: none;

  /* 用户在底部栏切换明暗后覆盖界面配色（主色沿用 LiveMD 主题） */
  &.force-dark {
    --background-color: #1f2226;
    --background-color-1: #262a2e;
    --background-color-2: #2d3136;
    --background-color-3: #363b41;
    --text-color: #e6e6e6;
    --text-color-1: #dcdcdc;
    --text-color-2: #b5b5b5;
    --text-color-3: #8c8c8c;
    --border-color: rgba(255, 255, 255, 0.12);
    --border-color-1: rgba(255, 255, 255, 0.12);
    --border-color-2: rgba(255, 255, 255, 0.22);
    --hover-color: rgba(255, 255, 255, 0.1);
    --hover-background-color: rgba(255, 255, 255, 0.08);
  }

  &.force-light {
    --background-color: #f5f7fa;
    --background-color-1: #ffffff;
    --background-color-2: #f5f7fa;
    --background-color-3: #ebeef2;
    --text-color: #303133;
    --text-color-1: #333333;
    --text-color-2: #606266;
    --text-color-3: #909399;
    --border-color: #e4e7ed;
    --border-color-1: #e4e7ed;
    --border-color-2: #d3d7de;
    --hover-color: rgba(0, 0, 0, 0.06);
    --hover-background-color: rgba(0, 0, 0, 0.04);
  }
}

.mindmap-editor__canvas {
  position: absolute;
  inset: 0;
}

.mindmap-editor__loading {
  position: absolute;
  inset: 0;
  z-index: 2500;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: color-mix(in srgb, var(--background-color-1, #fff) 60%, transparent);
  color: var(--text-color-2, #666);
  font-size: 14px;
}

.mindmap-editor__spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--border-color-2, #ccc);
  border-top-color: var(--primary-color, #409eff);
  border-radius: 50%;
  animation: mindmap-editor-spin 0.8s linear infinite;
}

@keyframes mindmap-editor-spin {
  to {
    transform: rotate(360deg);
  }
}

.mindmap-editor__error {
  position: absolute;
  inset: 0;
  z-index: 2600;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 24px;
  text-align: center;
  font-size: 14px;
  color: var(--text-color-1, #333);
  background: var(--background-color-1, #fff);
}

.mindmap-editor__drag-mask {
  position: absolute;
  inset: 0;
  z-index: 2800;
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
}

.mindmap-editor__drag-tip {
  padding: 24px 36px;
  border: 2px dashed #fff;
  border-radius: 10px;
  color: #fff;
  font-size: 16px;
  pointer-events: none;
}

.mindmap-editor__zen-exit {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 1000;
}

.mindmap-editor__confirm-text {
  margin: 0;
  line-height: 1.7;
}
</style>
