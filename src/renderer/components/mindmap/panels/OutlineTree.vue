<script setup lang="ts">
/**
 * 可编辑大纲树（私有子组件，供 Outline.vue / OutlineEdit.vue 使用，替代参考项目大纲里的 el-tree）
 *
 * 覆盖参考项目对 el-tree 的用法（draggable、default-expand-all、highlight-current、
 * expand-on-click-node=false、allow-drag 排除根节点）：
 * - 默认全部展开，点击三角展开 / 收起（不触发节点点击），叶子节点显示圆点；
 * - 点击节点设为当前节点（v-model:current-uid）并派发 nodeClick；
 * - 节点文字 contenteditable 直接编辑：失焦派发 editBlur；Enter / Tab / Shift+Tab 派发 editAction
 *   （输入法组字中的回车不拦截）；粘贴只保留纯文本；
 * - 拖拽调整层级：目标上 1/4 放到前面、下 1/4 放到后面、中间作为子节点（与 el-tree 一致）；
 *   根节点不能拖拽、只能作为「子节点」的放置目标，不能拖到自身或子孙节点上；
 *   在文字上按下鼠标是选择文字，在节点空白处按下才是拖拽节点；
 * - 树获得焦点（点击节点空白处）时：Delete / Backspace 删除当前节点（remove，与参考项目一致），
 *   ↑ / ↓ 切换当前节点，← / → 收起 / 展开，Enter / F2 编辑当前节点文字。
 *
 * 只负责展示与交互，数据由父组件修改（侧边栏大纲执行引擎命令，全屏大纲修改本地数据）。
 * 行按 uid 复用 DOM：父组件刷新数据时，文字没变的节点不会被重写，正在编辑的内容与光标不受影响。
 */
import { computed, nextTick, reactive, ref } from "vue";
import { handleInputPasteText } from "@/core/mindmap-engine/src/utils/index.js";
import {
  findOutlineAncestors,
  findOutlineNode,
  outlineContains,
  type OutlineDropPosition,
  type OutlineEditAction,
  type OutlineNode,
} from "./outlineModel";

const props = withDefaults(
  defineProps<{
    nodes: OutlineNode[];
    readonly?: boolean;
    currentUid?: string | null;
    /** 全屏大纲：文字最大宽度更大 */
    large?: boolean;
  }>(),
  { readonly: false, currentUid: null, large: false }
);

const emit = defineEmits<{
  (e: "update:currentUid", uid: string | null): void;
  /** 点击节点（含点击文字） */
  (e: "nodeClick", node: OutlineNode): void;
  /** 文字编辑框失焦（父组件比较 textCache 判断是否需要提交） */
  (e: "editBlur", node: OutlineNode, el: HTMLElement): void;
  /** 编辑框内 Enter / Tab / Shift+Tab */
  (e: "editAction", action: OutlineEditAction, node: OutlineNode, el: HTMLElement): void;
  /** 删除当前节点（树获得焦点时按 Delete / Backspace） */
  (e: "remove", node: OutlineNode): void;
  /** 拖拽放置 */
  (e: "drop", dragNode: OutlineNode, targetNode: OutlineNode, position: OutlineDropPosition): void;
}>();

/** 每一级的缩进（与 el-tree 默认 indent 一致） */
const INDENT = 18;
/** 展开图标占位宽度 */
const EXPAND_WIDTH = 24;
/** 拖拽数据类型：只用自定义类型，拖到其它编辑框上时浏览器不会插入文字，根组件也不会当成拖入文件 */
const DRAG_MIME = "application/x-livemd-mindmap-outline";

interface OutlineRow {
  node: OutlineNode;
  depth: number;
}

const rootRef = ref<HTMLElement | null>(null);
/** 已收起的节点 uid（默认全部展开；按 uid 记录，父组件刷新数据后保持） */
const collapsed = reactive(new Set<string>());
/** 正在拖拽的节点（拖拽过程中频繁读取，不需要响应式） */
let dragNode: OutlineNode | null = null;
const dragUid = ref<string | null>(null);
const dropTarget = ref<{ uid: string; position: OutlineDropPosition } | null>(null);

/** 按展开状态拍平的可见行：一维列表渲染，缩进由行内样式给出（打印时没有样式也能看出层级） */
const rows = computed<OutlineRow[]>(() => {
  const list: OutlineRow[] = [];
  const walk = (node: OutlineNode, depth: number): void => {
    list.push({ node, depth });
    if (collapsed.has(node.uid)) return;
    for (const child of node.children) walk(child, depth + 1);
  };
  for (const node of props.nodes) walk(node, 0);
  return list;
});

/** 可见行 uid → 节点（拖拽时按行元素快速取节点） */
const rowNodeMap = computed(() => new Map(rows.value.map((row) => [row.node.uid, row.node])));

function rowStyle(depth: number): Record<string, string> {
  const indent = depth * INDENT;
  return { paddingLeft: `${indent}px`, "--mm-outline-line-left": `${indent + EXPAND_WIDTH}px` };
}

function rowClass(node: OutlineNode): Record<string, boolean> {
  const drop = dropTarget.value?.uid === node.uid ? dropTarget.value.position : null;
  return {
    "is-current": node.uid === props.currentUid,
    "is-root": node.root,
    "is-dragging": node.uid === dragUid.value,
    "is-drop-before": drop === "before",
    "is-drop-after": drop === "after",
    "is-drop-inner": drop === "inner",
  };
}

function rowElement(uid: string): HTMLElement | null {
  return rootRef.value?.querySelector<HTMLElement>(`[data-uid="${CSS.escape(uid)}"]`) ?? null;
}

function currentNode(): OutlineNode | null {
  if (!props.currentUid) return null;
  return findOutlineNode(props.nodes, props.currentUid)?.node ?? null;
}

/** 在最近的可滚动祖先内把元素滚动到可见（对应参考项目 scrollTo：超出可视区时滚到中间） */
function scrollIntoContainer(el: HTMLElement): void {
  let container = el.parentElement;
  while (container && container !== document.body) {
    const { overflowY } = getComputedStyle(container);
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      container.scrollHeight > container.clientHeight
    ) {
      break;
    }
    container = container.parentElement;
  }
  if (!container || container === document.body) return;
  const containerRect = container.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  if (rect.top < containerRect.top || rect.bottom > containerRect.bottom) {
    container.scrollTop += rect.top - containerRect.top - (containerRect.height - rect.height) / 2;
  }
}

/** 光标放到编辑框末尾，或选中全部文字（新建节点时，便于直接输入替换默认文字） */
function placeCaret(el: HTMLElement, selectAll: boolean): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  if (!selectAll) range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function expandAncestors(uid: string): void {
  const ancestors = findOutlineAncestors(props.nodes, uid) ?? [];
  for (const ancestor of ancestors) collapsed.delete(ancestor.uid);
}

/** 设为当前节点并让节点行获得焦点（键盘切换节点时使用） */
async function setCurrentRow(uid: string): Promise<void> {
  emit("update:currentUid", uid);
  await nextTick();
  const row = rowElement(uid);
  if (!row) return;
  row.focus({ preventScroll: true });
  scrollIntoContainer(row);
}

function toggleExpand(node: OutlineNode): void {
  if (node.children.length === 0) return;
  if (collapsed.has(node.uid)) {
    collapsed.delete(node.uid);
  } else {
    collapsed.add(node.uid);
  }
}

// ---------------- 点击与键盘 ----------------

function onRowMousedown(event: MouseEvent, node: OutlineNode): void {
  // 在文字上按下是选择 / 编辑文字，在空白处按下才允许拖拽节点（draggable 在拖拽开始时才读取）
  const rowEl = event.currentTarget as HTMLElement;
  const target = event.target as HTMLElement | null;
  const inText = !props.readonly && Boolean(target?.closest?.(".mm-outline-tree__text"));
  rowEl.draggable = !props.readonly && !node.root && !inText;
}

function onRowClick(node: OutlineNode): void {
  emit("update:currentUid", node.uid);
  emit("nodeClick", node);
}

function onEditKeydown(event: KeyboardEvent, node: OutlineNode): void {
  // 输入法组字时的回车用于确认候选词，不能当成插入节点
  if (event.isComposing || event.keyCode === 229) return;
  const el = event.currentTarget as HTMLElement;
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    emit("editAction", "insertSibling", node, el);
  } else if (event.key === "Tab") {
    event.preventDefault();
    emit("editAction", event.shiftKey ? "moveUp" : "insertChild", node, el);
  }
}

function onEditBlur(event: FocusEvent, node: OutlineNode): void {
  emit("editBlur", node, event.currentTarget as HTMLElement);
}

/** 粘贴只保留纯文本，换行转为 <br>（与参考项目一致） */
function onPaste(event: ClipboardEvent): void {
  handleInputPasteText(event);
}

/** 树（节点行或空白处）获得焦点时的按键；编辑框里的按键由编辑框自己处理 */
function onTreeKeydown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null;
  if (!target || target.isContentEditable) return;
  const node = currentNode();
  switch (event.key) {
    case "Delete":
    case "Backspace":
      if (!node) return;
      event.preventDefault();
      if (!props.readonly && !node.root) emit("remove", node);
      break;
    case "ArrowUp":
    case "ArrowDown": {
      event.preventDefault();
      const list = rows.value;
      if (list.length === 0) return;
      const index = list.findIndex((row) => row.node.uid === props.currentUid);
      const nextIndex =
        index === -1
          ? 0
          : Math.min(list.length - 1, Math.max(0, index + (event.key === "ArrowUp" ? -1 : 1)));
      void setCurrentRow(list[nextIndex].node.uid);
      break;
    }
    case "ArrowLeft":
      if (!node) return;
      event.preventDefault();
      if (node.children.length > 0 && !collapsed.has(node.uid)) {
        collapsed.add(node.uid);
      } else {
        const parent = findOutlineNode(props.nodes, node.uid)?.parent;
        if (parent) void setCurrentRow(parent.uid);
      }
      break;
    case "ArrowRight":
      if (!node) return;
      event.preventDefault();
      if (collapsed.has(node.uid)) {
        collapsed.delete(node.uid);
      } else if (node.children.length > 0) {
        void setCurrentRow(node.children[0].uid);
      }
      break;
    case "Enter":
    case "F2":
      if (!node || props.readonly) return;
      event.preventDefault();
      void focusNode(node.uid);
      break;
    default:
      break;
  }
}

// ---------------- 拖拽 ----------------

function eventElement(event: Event): Element | null {
  const target = event.target as Node | null;
  if (!target) return null;
  return target instanceof Element ? target : target.parentElement;
}

function rowFromEvent(event: Event): { el: HTMLElement; node: OutlineNode } | null {
  const el = eventElement(event)?.closest<HTMLElement>(".mm-outline-tree__row") ?? null;
  const uid = el?.dataset.uid;
  const node = uid ? rowNodeMap.value.get(uid) : undefined;
  return el && node ? { el, node } : null;
}

/** 计算放置位置（与 el-tree 一致：上 1/4 前面、下 1/4 后面、中间作为子节点） */
function getDropPosition(
  event: DragEvent,
  row: { el: HTMLElement; node: OutlineNode }
): OutlineDropPosition | null {
  if (!dragNode || outlineContains(dragNode, row.node.uid)) return null;
  // 根节点不能有同级节点，只能放进去作为子节点
  if (row.node.root) return "inner";
  const rect = row.el.getBoundingClientRect();
  const offset = event.clientY - rect.top;
  if (offset < rect.height * 0.25) return "before";
  if (offset > rect.height * 0.75) return "after";
  return "inner";
}

function resetDrag(): void {
  dragNode = null;
  dragUid.value = null;
  dropTarget.value = null;
}

function onDragStart(event: DragEvent): void {
  const row = rowFromEvent(event);
  // 拖动的是选中的文字（目标不是行本身）也取消：避免把文字拖进别的节点而绕过文本提交
  if (!row || event.target !== row.el || props.readonly || row.node.root || !event.dataTransfer) {
    event.preventDefault();
    return;
  }
  dragNode = row.node;
  dragUid.value = row.node.uid;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData(DRAG_MIME, row.node.uid);
  console.debug("[MindMap/OutlineTree] 开始拖拽节点:", row.node.uid);
}

function onDragOver(event: DragEvent): void {
  // 大纲区域内由这里决定能否放置：根组件的 dragover 会无条件允许放置，外部拖入的文字也不允许落进编辑框
  event.stopPropagation();
  event.preventDefault();
  const row = dragNode ? rowFromEvent(event) : null;
  const position = row ? getDropPosition(event, row) : null;
  if (event.dataTransfer) event.dataTransfer.dropEffect = position ? "move" : "none";
  if (!row || !position) {
    dropTarget.value = null;
    return;
  }
  if (dropTarget.value?.uid !== row.node.uid || dropTarget.value.position !== position) {
    dropTarget.value = { uid: row.node.uid, position };
  }
}

function onDragLeave(event: DragEvent): void {
  const related = event.relatedTarget as Node | null;
  if (!related || !rootRef.value?.contains(related)) dropTarget.value = null;
}

function onDrop(event: DragEvent): void {
  event.stopPropagation();
  event.preventDefault();
  const dragging = dragNode;
  const row = dragging ? rowFromEvent(event) : null;
  const position = row ? getDropPosition(event, row) : null;
  resetDrag();
  if (!dragging || !row || !position) return;
  console.info("[MindMap/OutlineTree] 拖拽放置:", dragging.uid, position, row.node.uid);
  emit("drop", dragging, row.node, position);
}

// ---------------- 对父组件暴露 ----------------

/**
 * 聚焦节点：展开祖先、设为当前节点、滚动到可见；可编辑时把光标放进文字（selectAll 选中全部文字），
 * 只读时聚焦节点行。对应参考项目 afterCreateNewNode 里的高亮、选中与 scrollTo。
 */
async function focusNode(uid: string, options: { selectAll?: boolean } = {}): Promise<boolean> {
  expandAncestors(uid);
  emit("update:currentUid", uid);
  await nextTick();
  const row = rowElement(uid);
  if (!row) {
    console.warn("[MindMap/OutlineTree] 要聚焦的节点不存在:", uid);
    return false;
  }
  const text = row.querySelector<HTMLElement>(".mm-outline-tree__text");
  if (text && !props.readonly) {
    text.focus({ preventScroll: true });
    placeCaret(text, options.selectAll === true);
  } else {
    row.focus({ preventScroll: true });
  }
  scrollIntoContainer(row);
  return true;
}

/** 展开节点（插入子节点、拖入节点后让新内容可见） */
function expandNode(uid: string): void {
  collapsed.delete(uid);
}

/** 焦点移回树本身（删除节点后，让后续按键仍由大纲处理，而不是落到 body 触发画布快捷键） */
function focusTree(): void {
  rootRef.value?.focus({ preventScroll: true });
}

function getEl(): HTMLElement | null {
  return rootRef.value;
}

defineExpose({ focusNode, expandNode, focusTree, getEl });
</script>

<template>
  <div
    ref="rootRef"
    class="mm-outline-tree"
    :class="{ 'is-large': large, 'is-readonly': readonly }"
    role="tree"
    tabindex="-1"
    @keydown="onTreeKeydown"
    @dragstart="onDragStart"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
    @dragend="resetDrag"
  >
    <div
      v-for="row in rows"
      :key="row.node.uid"
      class="mm-outline-tree__row"
      :class="rowClass(row.node)"
      :data-uid="row.node.uid"
      :style="rowStyle(row.depth)"
      role="treeitem"
      :aria-expanded="row.node.children.length > 0 ? !collapsed.has(row.node.uid) : undefined"
      tabindex="-1"
      @mousedown="onRowMousedown($event, row.node)"
      @click="onRowClick(row.node)"
    >
      <span
        class="mm-outline-tree__expand"
        :class="{
          'is-leaf': row.node.children.length === 0,
          'is-expanded': !collapsed.has(row.node.uid),
        }"
        @click.stop="toggleExpand(row.node)"
      />
      <!-- label 已在 outlineModel 中做过 HTML 转义，可以直接作为编辑框内容 -->
      <span
        class="mm-outline-tree__text"
        :contenteditable="!readonly"
        spellcheck="false"
        @keydown="onEditKeydown($event, row.node)"
        @keyup.stop
        @blur="onEditBlur($event, row.node)"
        @paste="onPaste"
        v-html="row.node.label"
      />
    </div>
  </div>
</template>

<style lang="less" scoped>
.mm-outline-tree {
  outline: none;
  font-size: 14px;
  color: var(--text-color, #333);
}

.mm-outline-tree__row {
  position: relative;
  display: flex;
  align-items: flex-start;
  margin: 2px 0;
  padding-top: 3px;
  padding-right: 6px;
  padding-bottom: 3px;
  border-radius: 4px;
  outline: none;
  cursor: pointer;

  &:hover {
    background: var(--hover-background-color, rgba(0, 0, 0, 0.04));
  }

  &:focus-visible {
    box-shadow: inset 0 0 0 1px var(--primary-color, #409eff);
  }

  &.is-current {
    background: color-mix(in srgb, var(--primary-color, #409eff) 12%, transparent);
  }

  &.is-dragging {
    opacity: 0.45;
  }

  &.is-drop-inner {
    background: color-mix(in srgb, var(--primary-color, #409eff) 22%, transparent);
    box-shadow: inset 0 0 0 1px var(--primary-color, #409eff);
  }

  /* 放到前面 / 后面的指示线，从文字起始位置开始 */
  &.is-drop-before::before,
  &.is-drop-after::after {
    content: "";
    position: absolute;
    left: var(--mm-outline-line-left, 24px);
    right: 0;
    height: 2px;
    border-radius: 1px;
    background: var(--primary-color, #409eff);
    pointer-events: none;
  }

  &.is-drop-before::before {
    top: -2px;
  }

  &.is-drop-after::after {
    bottom: -2px;
  }
}

/* 展开三角（展开时旋转 90°），叶子节点显示圆点（对应参考项目 outlineTree.less） */
.mm-outline-tree__expand {
  position: relative;
  flex-shrink: 0;
  width: 24px;
  height: 22px;
  color: var(--text-color-2, #666);
  cursor: pointer;

  &::before {
    content: "";
    position: absolute;
    top: 7px;
    left: 9px;
    border-top: 4px solid transparent;
    border-bottom: 4px solid transparent;
    border-left: 6px solid currentColor;
    transition: transform 0.15s;
  }

  &.is-expanded::before {
    transform: rotate(90deg);
  }

  &.is-leaf {
    cursor: default;

    &::before {
      top: 9px;
      left: 10px;
      width: 5px;
      height: 5px;
      border: none;
      border-radius: 50%;
      background: currentColor;
      transform: none;
    }
  }
}

.mm-outline-tree__text {
  min-width: 20px;
  min-height: 22px;
  padding-right: 20px;
  line-height: 22px;
  font-weight: bold;
  white-space: normal;
  overflow-wrap: anywhere;
  outline: none;
  cursor: text;
  /* 编辑器根元素禁止了选择文字，编辑框需要恢复 */
  user-select: text;
}

.mm-outline-tree.is-readonly .mm-outline-tree__text {
  cursor: pointer;
}

.mm-outline-tree.is-large .mm-outline-tree__text {
  max-width: 800px;
}
</style>
