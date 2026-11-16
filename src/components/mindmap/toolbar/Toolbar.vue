<script setup lang="ts">
/**
 * 思维导图编辑器顶部工具栏（移植自参考项目 web/src/pages/Edit/components/Toolbar.vue）
 *
 * 左侧节点操作：ToolbarNodeBtnList。窗口宽度不够时多余按钮收进「更多」弹出层，算法与参考项目一致：
 *   逐个加入按钮并测量工具栏宽度，超出「容器宽度 - 40」即停止，剩余按钮放进弹出层。
 * 右侧文件操作，按「嵌入 Markdown 代码块」的场景改造：
 *   - 最前面新增「保存」（写回代码块，有未保存修改时显示提示点）与「退出」；
 *   - 去掉「目录」与本地文件树（参考项目基于浏览器 File System Access API 直接读写本机文件）；
 *   - 「新建」：当前有内容时确认后载入空白模板（setData）；
 *   - 「打开」：选择 .smm / .json / .xmind / .md，交给导入组件按导入逻辑解析后 setData（importFile）；
 *   - 「另存为」：导出 .smm，走原生「另存为」对话框保存；
 *   - 「导入」「导出」：打开对应弹窗（showImport / showExport）。
 *   - 只读时禁用会替换整份数据的「新建」「打开」「导入」（与根组件只读时不响应拖入导入一致）。
 *
 * 参考项目在工具栏里渲染的 NodeImage / NodeHyperlink / NodeIcon / NodeNote / NodeTag / Export / Import 弹窗
 * 改由根组件统一渲染；参考项目工具栏里「双击节点备注图标 → 打开备注弹窗」的监听也移到了根组件（禅模式下同样可用）。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import autotoast from "autotoast.js";
import type { MindMapNodeData } from "@/core/mindmap-engine/full";
import { DEFAULT_MINDMAP_LAYOUT, DEFAULT_MINDMAP_THEME } from "@/core/utils/mindmap-document";
import { useMindMapContext } from "../context";
import { pickFile, saveExportFile } from "../utils";
import ToolbarBtn from "./ToolbarBtn.vue";
import ToolbarNodeBtnList from "./ToolbarNodeBtnList.vue";

/** 节点按钮默认顺序（参考项目 defaultBtnList，去掉附件、标记与 AI） */
const DEFAULT_BTN_LIST = [
  "back",
  "forward",
  "painter",
  "siblingNode",
  "childNode",
  "deleteNode",
  "image",
  "icon",
  "link",
  "note",
  "tag",
  "summary",
  "associativeLine",
  "formula",
  "outerFrame",
];
/** 「打开」支持的文件类型（与导入弹窗一致） */
const OPEN_FILE_ACCEPT = ".smm,.json,.xmind,.md";
/** 另存为的默认文件名（参考项目 toolbar.defaultFileName） */
const DEFAULT_FILE_NAME = "思维导图";
/** 空白模板的根节点文字（参考项目 edit.root） */
const BLANK_ROOT_TEXT = "根节点";
/** 工具栏左右预留的空白（参考项目 window.innerWidth - 40） */
const TOOLBAR_SIDE_GAP = 40;
/** 重新计算布局的节流间隔（参考项目 throttle(computeToolbarShow, 300)） */
const RELAYOUT_THROTTLE = 300;
/** 「更多」弹出层鼠标移出后的关闭延迟（对应 el-popover 悬停触发的默认关闭延迟） */
const POPOVER_CLOSE_DELAY = 200;
/** 移植图标字体（见 assets/icon-font/iconfont.css），加载完成前测得的按钮宽度不准 */
const ICON_FONT = '16px "mindmap-iconfont"';

const { mindMap, bus, localConfig, isReadonly, isDirty, actions } = useMindMapContext();

const toolbarRef = ref<HTMLElement | null>(null);
/** 直接显示在工具栏上的节点按钮 */
const horizontalList = ref<string[]>([]);
/** 收进「更多」弹出层的节点按钮 */
const verticalList = ref<string[]>([]);
/** 是否显示「更多」 */
const showMoreBtn = ref(true);
/** 「更多」弹出层是否展开 */
const popoverShow = ref(false);

/** 当前可用的节点按钮：关闭节点富文本时不显示「公式」（与参考项目一致） */
const btnList = computed(() =>
  DEFAULT_BTN_LIST.filter((key) => key !== "formula" || localConfig.openNodeRichText)
);

const saveTitle = computed(() =>
  isDirty.value ? "有未保存到文档的修改，点击保存（Ctrl+S）" : "保存到文档（Ctrl+S）"
);

// ---------------------------------------------------------------------------
// 按宽度分配按钮（参考项目 computeToolbarShow）
// ---------------------------------------------------------------------------

/** 布局计算序号：开始新一轮计算或组件卸载时递增，进行中的旧循环检测到后立即退出 */
let layoutToken = 0;
let relayoutTimer: ReturnType<typeof setTimeout> | null = null;
let resizeObserver: ResizeObserver | null = null;
let disposed = false;

/**
 * 计算哪些按钮直接显示、哪些收进「更多」
 *
 * 逐个加入按钮并在 DOM 更新后测量工具栏宽度（nextTick 走微任务，整个循环在浏览器绘制前完成，不会闪烁）。
 */
async function computeToolbarShow(): Promise<void> {
  const toolbarEl = toolbarRef.value;
  if (!toolbarEl) return;
  const token = ++layoutToken;
  // 工具栏绝对定位在编辑器根元素内，按根元素宽度计算（编辑器全屏时即窗口宽度）
  const container = toolbarEl.offsetParent as HTMLElement | null;
  const maxWidth = (container?.clientWidth || window.innerWidth) - TOOLBAR_SIDE_GAP;
  const all = [...btnList.value];
  // 测量期间始终显示「更多」，保证测得的宽度把它算在内，避免收起按钮后「更多」出现又把工具栏撑出可用宽度
  showMoreBtn.value = true;
  let fitCount = 0;
  for (let index = 1; index <= all.length; index += 1) {
    horizontalList.value = all.slice(0, index);
    await nextTick();
    // 期间开始了新一轮计算或组件已卸载：放弃本轮结果
    if (token !== layoutToken || !toolbarRef.value) return;
    if (toolbarRef.value.getBoundingClientRect().width > maxWidth) break;
    fitCount = index;
  }
  horizontalList.value = all.slice(0, fitCount);
  verticalList.value = all.slice(fitCount);
  showMoreBtn.value = verticalList.value.length > 0;
  console.debug(
    `[MindMap/Toolbar] 工具栏布局：可用宽度 ${maxWidth}px，直接显示 ${fitCount} 个按钮，「更多」${all.length - fitCount} 个`
  );
}

/** 节流后重新计算布局（尺寸变化、字体加载完成时调用） */
function scheduleRelayout(): void {
  if (disposed || relayoutTimer) return;
  relayoutTimer = setTimeout(() => {
    relayoutTimer = null;
    void computeToolbarShow();
  }, RELAYOUT_THROTTLE);
}

// 关闭 / 开启节点富文本会增减「公式」按钮，按钮列表变化后立即重算
watch(btnList, () => {
  void computeToolbarShow();
});

// ---------------------------------------------------------------------------
// 「更多」弹出层（参考项目 el-popover trigger="hover" placement="bottom-end"）
// ---------------------------------------------------------------------------

let popoverTimer: ReturnType<typeof setTimeout> | null = null;

function clearPopoverTimer(): void {
  if (popoverTimer) {
    clearTimeout(popoverTimer);
    popoverTimer = null;
  }
}

function openPopover(): void {
  clearPopoverTimer();
  popoverShow.value = true;
}

/** 鼠标移出后延迟关闭，留出从「更多」移入弹出层的时间 */
function closePopoverLater(): void {
  clearPopoverTimer();
  popoverTimer = setTimeout(() => {
    popoverTimer = null;
    popoverShow.value = false;
  }, POPOVER_CLOSE_DELAY);
}

/** 点击弹出层里的按钮后关闭（参考项目 @click.native="popoverShow = false"） */
function closePopover(): void {
  clearPopoverTimer();
  popoverShow.value = false;
}

// ---------------------------------------------------------------------------
// 文件操作
// ---------------------------------------------------------------------------

/** 「保存」：写回 Markdown 代码块（根组件动作，编辑器保持打开） */
function onSave(): void {
  console.info("[MindMap/Toolbar] 点击保存，存在未保存修改:", isDirty.value);
  actions.save();
}

/** 「退出」：根组件在有未保存修改时询问 */
function onClose(): void {
  console.info("[MindMap/Toolbar] 点击退出");
  actions.close();
}

/** 空白模板：结构与参考项目 exampleData 一致，结构 / 主题取 LiveMD 新建思维导图的默认值 */
function createBlankData(): Record<string, unknown> {
  return {
    layout: DEFAULT_MINDMAP_LAYOUT,
    root: { data: { text: BLANK_ROOT_TEXT }, children: [] },
    theme: { template: DEFAULT_MINDMAP_THEME, config: {} },
    view: null,
  };
}

/** 当前是否有内容：根节点有子节点，或根节点文字不是空白模板的默认文字 */
function hasContent(): boolean {
  const root = mindMap.value?.getData(false) as MindMapNodeData | null | undefined;
  if (!root) return false;
  if (root.children?.length) return true;
  // 富文本节点的 text 为 HTML，比较前去掉标签
  const text = String(root.data?.text ?? "")
    .replace(/<[^>]+>/g, "")
    .trim();
  return text !== "" && text !== BLANK_ROOT_TEXT;
}

/** 「新建」：有内容时先确认，再载入空白模板（setData 会清空撤销记录，但保存前不会写回文档） */
function createNewFile(): void {
  if (
    hasContent() &&
    !window.confirm("新建将清空当前思维导图（点击「保存」前不会写回文档），确定继续吗？")
  ) {
    console.info("[MindMap/Toolbar] 用户取消新建");
    return;
  }
  console.info("[MindMap/Toolbar] 新建空白思维导图");
  bus.emit("setData", createBlankData());
}

/** 「打开」：选择文件后交给导入组件（Import.vue 监听 importFile），解析逻辑与「导入」完全一致 */
async function openLocalFile(): Promise<void> {
  const file = await pickFile(OPEN_FILE_ACCEPT);
  if (!file) {
    console.debug("[MindMap/Toolbar] 打开：未选择文件");
    return;
  }
  console.info("[MindMap/Toolbar] 打开文件:", file.name);
  bus.emit("importFile", file);
}

/** 结束可能正在进行的节点文字编辑，保证导出拿到最新文字 */
function commitTextEdit(): void {
  try {
    mindMap.value?.renderer?.textEdit?.hideEditTextBox?.();
  } catch (error) {
    console.warn("[MindMap/Toolbar] 结束文字编辑失败:", error);
  }
}

/** 从保存路径中取文件名（提示用） */
function getBaseName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

/** 另存为进行中（防止连续点击重复弹出保存对话框） */
let isSavingAs = false;

/** 「另存为」：导出 .smm（含结构、主题等配置），交给原生「另存为」对话框保存 */
async function saveLocalFile(): Promise<void> {
  const instance = mindMap.value;
  if (!instance || isSavingAs) return;
  isSavingAs = true;
  console.info("[MindMap/Toolbar] 另存为 .smm 开始");
  try {
    commitTextEdit();
    const result = await instance.export("smm", false, DEFAULT_FILE_NAME);
    if (!result) {
      // 引擎 export 内部捕获异常后已通过 errorHandler 上报（根组件提示「导出失败」），这里不重复提示
      console.warn("[MindMap/Toolbar] 另存为：导出结果为空");
      return;
    }
    const savedPath = await saveExportFile(result, DEFAULT_FILE_NAME, "smm", "思绪文件");
    if (savedPath) {
      console.info("[MindMap/Toolbar] 另存为完成:", savedPath);
      autotoast.show(`已另存为：${getBaseName(savedPath)}`, "success");
    } else {
      console.info("[MindMap/Toolbar] 另存为：用户取消");
    }
  } catch (error) {
    console.error("[MindMap/Toolbar] 另存为失败:", error);
    autotoast.show("另存为失败", "error");
  } finally {
    isSavingAs = false;
  }
}

function showImport(): void {
  console.debug("[MindMap/Toolbar] 打开导入弹窗");
  bus.emit("showImport");
}

function showExport(): void {
  console.debug("[MindMap/Toolbar] 打开导出弹窗");
  bus.emit("showExport");
}

// 双击备注图标打开备注弹窗（参考项目 Toolbar.onNodeNoteDblclick）已移到根组件 MindMapEditor.vue，
// 禅模式下工具栏不挂载时同样可用

onMounted(async () => {
  const container = toolbarRef.value?.offsetParent ?? document.documentElement;
  // 编辑器根元素尺寸变化（窗口缩放）时重新分配按钮（参考项目监听 window resize）
  resizeObserver = new ResizeObserver(scheduleRelayout);
  resizeObserver.observe(container);
  await computeToolbarShow();
  // 图标字体首次使用时才开始加载，加载完成后按真实宽度再算一次
  if (!document.fonts.check(ICON_FONT)) {
    document.fonts
      .load(ICON_FONT)
      .then(scheduleRelayout)
      .catch((error) => console.warn("[MindMap/Toolbar] 图标字体加载失败:", error));
  }
  console.info("[MindMap/Toolbar] 工具栏已挂载");
});

onBeforeUnmount(() => {
  disposed = true;
  // 让进行中的布局循环退出
  layoutToken += 1;
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (relayoutTimer) clearTimeout(relayoutTimer);
  relayoutTimer = null;
  clearPopoverTimer();
});
</script>

<template>
  <div ref="toolbarRef" class="mm-toolbar" :class="{ 'is-popover-open': popoverShow }">
    <!-- 节点操作 -->
    <div class="mm-toolbar__block">
      <ToolbarNodeBtnList v-if="horizontalList.length > 0" :list="horizontalList" />
      <!-- 更多：悬停展开 -->
      <div
        v-if="showMoreBtn"
        class="mm-toolbar__more"
        @mouseenter="openPopover"
        @mouseleave="closePopoverLater"
      >
        <ToolbarBtn icon="icongongshi" text="更多" @click="openPopover" />
        <div v-if="popoverShow" class="mm-toolbar__popover" @click="closePopover">
          <ToolbarNodeBtnList dir="v" :list="verticalList" />
        </div>
      </div>
    </div>
    <!-- 文件操作 -->
    <div class="mm-toolbar__block">
      <ToolbarBtn icon="iconxiazai" text="保存" :dot="isDirty" :title="saveTitle" @click="onSave" />
      <ToolbarBtn icon="iconguanbi" text="退出" title="退出思维导图编辑" @click="onClose" />
      <ToolbarBtn
        icon="iconxinjian"
        text="新建"
        title="新建空白思维导图（替换当前内容，点击「保存」后才写回文档）"
        :disabled="isReadonly"
        @click="createNewFile"
      />
      <ToolbarBtn
        icon="iconwenjian1"
        text="打开"
        title="打开 .smm / .json / .xmind / .md 文件（替换当前内容，点击「保存」后才写回文档）"
        :disabled="isReadonly"
        @click="openLocalFile"
      />
      <ToolbarBtn
        icon="iconlingcunwei"
        text="另存为"
        title="另存为 .smm 文件"
        @click="saveLocalFile"
      />
      <ToolbarBtn icon="icondaoru" text="导入" :disabled="isReadonly" @click="showImport" />
      <ToolbarBtn icon="iconexport" text="导出" @click="showExport" />
    </div>
  </div>
</template>

<style lang="less" scoped>
.mm-toolbar {
  position: absolute;
  top: 20px;
  left: 50%;
  z-index: 1000;
  display: flex;
  gap: 20px;
  width: max-content;
  transform: translateX(-50%);
  font-size: 12px;
  font-weight: 400;
  color: var(--text-color-1, rgba(26, 26, 26, 0.8));

  /* 「更多」弹出层展开时提到浮层层级，避免被右侧面板（1100）遮住 */
  &.is-popover-open {
    z-index: 1500;
  }
}

.mm-toolbar__block {
  position: relative;
  display: flex;
  flex-shrink: 0;
  gap: 20px;
  padding: 10px 20px;
  border: 1px solid var(--border-color-1, rgba(0, 0, 0, 0.06));
  border-radius: 6px;
  background: var(--background-color-1, #fff);
  box-shadow: 0 2px 16px 0 rgba(0, 0, 0, 0.06);
}

.mm-toolbar__more {
  position: relative;
  display: flex;
}

.mm-toolbar__popover {
  position: absolute;
  top: calc(100% + 12px);
  right: 0;
  box-sizing: border-box;
  min-width: 150px;
  padding: 12px;
  border: 1px solid var(--border-color-1, #ebeef5);
  border-radius: 4px;
  background: var(--background-color-1, #fff);
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);

  /* 透明桥接区：鼠标从「更多」移向弹出层的途中不会离开悬停区域 */
  &::before {
    content: "";
    position: absolute;
    top: -13px;
    right: 0;
    left: 0;
    height: 13px;
  }
}
</style>
