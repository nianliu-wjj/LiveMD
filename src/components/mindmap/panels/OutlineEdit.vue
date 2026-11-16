<script setup lang="ts">
/**
 * 全屏大纲编辑（对应参考项目 OutlineEdit.vue）
 *
 * isOutlineEdit 为 true 时覆盖整个编辑器（在编辑器根元素内绝对定位，不挂到 body）：
 * - 进入时按画布当前数据生成大纲；编辑文字、Enter 插入同级、Tab 插入子级、Shift+Tab 上移一个层级、
 *   节点获得焦点时 Delete / Backspace 删除、拖拽调整层级，都只修改大纲本地数据（与参考项目一致）；
 * - 右上角「打印」「关闭」：关闭时退出大纲模式，把大纲数据通过总线 setData 交给根组件写回画布
 *   （根组件重设数据并复位视图，与参考项目一致）。
 *
 * 与参考项目的差异：
 * - 没有任何修改时关闭不再 setData（参考项目总会重设数据，导致视图复位、撤销记录被清空）；
 * - Ctrl+S：先把大纲写回画布（updateData，不复位视图）再「保存到文档」，参考项目在大纲模式下不响应；
 * - 修复参考项目的问题：二级节点 Shift+Tab 会变成和根节点同级（关闭时该分支丢失）；
 *   Enter / Tab 以外的按键也会触发保存与重新定位当前节点；只读时仍可拖拽、删除。
 */
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import type { MindMapNodeData } from "@/core/mindmap-engine/full";
import { useMindMapContext } from "../context";
import { printElement } from "../utils";
import OutlineTree from "./OutlineTree.vue";
import {
  appendOutlineChild,
  buildOutlineTree,
  createOutlineNode,
  findOutlineNode,
  insertOutlineNodeAfter,
  moveOutlineNode,
  moveOutlineNodeUpLevel,
  OUTLINE_NODE_DEFAULT_TEXT,
  outlineToNodeData,
  removeOutlineNode,
  syncOutlineLabel,
  takeEditedText,
  type OutlineDropPosition,
  type OutlineEditAction,
  type OutlineNode,
} from "./outlineModel";

const { mindMap, bus, isReadonly, isOutlineEdit, actions } = useMindMapContext();

const rootRef = ref<HTMLElement | null>(null);
const contentRef = ref<HTMLElement | null>(null);
const treeRef = ref<InstanceType<typeof OutlineTree> | null>(null);
const treeData = ref<OutlineNode[]>([]);
const currentUid = ref<string | null>(null);

/** 进入全屏大纲后是否修改过（对应参考项目各处 save() 调用点） */
let modified = false;

function markModified(reason: string): void {
  modified = true;
  console.debug("[MindMap/OutlineEdit] 大纲已修改:", reason);
}

/** 按画布当前数据生成大纲（对应参考项目 refresh） */
function refresh(): void {
  const instance = mindMap.value;
  treeData.value = instance ? buildOutlineTree(instance.getData()) : [];
}

/** 大纲 → 思维导图节点数据（对应参考项目 getData） */
function getData(): MindMapNodeData | null {
  const root = treeData.value[0];
  return root ? outlineToNodeData(root) : null;
}

/** 进入全屏大纲（对应参考项目 watch isOutlineEdit 为 true 时的处理） */
function enter(): void {
  const instance = mindMap.value;
  try {
    // 画布上可能正处于文字编辑：先结束，避免编辑框（挂在 body 上、层级更高）浮在大纲上面
    instance?.renderer.textEdit.hideEditTextBox();
  } catch (error) {
    console.warn("[MindMap/OutlineEdit] 结束画布文字编辑失败:", error);
  }
  refresh();
  currentUid.value = null;
  modified = false;
  console.info("[MindMap/OutlineEdit] 进入全屏大纲编辑");
  // 焦点放进大纲：后续按键由大纲处理，不会落到 body 上触发画布快捷键
  void nextTick(() => rootRef.value?.focus({ preventScroll: true }));
}

/** 失焦提交正在编辑的文字（退出前调用，失焦事件会走 onEditBlur） */
function flushActiveEdit(): void {
  const el = document.activeElement;
  if (el instanceof HTMLElement && el.isContentEditable && rootRef.value?.contains(el)) el.blur();
}

/** 退出全屏大纲：有修改时把大纲交给根组件写回画布（对应参考项目 onClose 中的 setData） */
function leave(): void {
  flushActiveEdit();
  const data = modified ? getData() : null;
  if (data) {
    console.info("[MindMap/OutlineEdit] 退出全屏大纲，写回画布");
    bus.emit("setData", data);
  } else {
    console.info("[MindMap/OutlineEdit] 退出全屏大纲（无修改）");
  }
  modified = false;
  treeData.value = [];
  currentUid.value = null;
}

/** 提交节点文字（对应参考项目 onBlur）：只修改本地数据 */
function commitText(node: OutlineNode, el: HTMLElement): boolean {
  if (isReadonly.value) return false;
  const text = takeEditedText(node, el);
  if (text === null) return false;
  node.data.text = text;
  markModified(`修改文字 ${node.uid}`);
  return true;
}

function onEditBlur(node: OutlineNode, el: HTMLElement): void {
  commitText(node, el);
  syncOutlineLabel(node);
}

/** 编辑框内 Enter / Tab / Shift+Tab（对应参考项目 onNodeInputKeydown） */
function onEditAction(type: OutlineEditAction, node: OutlineNode, el: HTMLElement): void {
  if (isReadonly.value) return;
  commitText(node, el);
  let focusUid: string | null = null;
  let selectAll = true;
  switch (type) {
    case "insertSibling": {
      // 根节点不能插入同级节点
      if (node.root) return;
      const newNode = createOutlineNode(OUTLINE_NODE_DEFAULT_TEXT, node.richText);
      if (insertOutlineNodeAfter(treeData.value, node.uid, newNode)) focusUid = newNode.uid;
      break;
    }
    case "insertChild": {
      const newNode = createOutlineNode(OUTLINE_NODE_DEFAULT_TEXT, node.richText);
      if (appendOutlineChild(treeData.value, node.uid, newNode)) {
        treeRef.value?.expandNode(node.uid);
        focusUid = newNode.uid;
      }
      break;
    }
    case "moveUp":
      // 二级节点不能再上移（参考项目会把它移到与根节点同级，关闭时该分支丢失）
      if (moveOutlineNodeUpLevel(treeData.value, node.uid)) {
        focusUid = node.uid;
        selectAll = false;
      }
      break;
    default:
      break;
  }
  if (!focusUid) return;
  markModified(`${type} ${node.uid}`);
  const uid = focusUid;
  // 新节点选中全部文字（便于直接输入替换默认文字），上移的节点光标放到末尾
  void nextTick(() => treeRef.value?.focusNode(uid, { selectAll }));
}

/** 删除节点（对应参考项目 onKeyDown） */
function onRemove(node: OutlineNode): void {
  if (isReadonly.value || node.root) return;
  if (!removeOutlineNode(treeData.value, node.uid)) return;
  currentUid.value = null;
  markModified(`删除节点 ${node.uid}`);
  treeRef.value?.focusTree();
}

/** 拖拽调整层级（对应参考项目 onNodeDrop） */
function onDrop(
  dragNode: OutlineNode,
  targetNode: OutlineNode,
  position: OutlineDropPosition
): void {
  if (isReadonly.value) return;
  if (!moveOutlineNode(treeData.value, dragNode.uid, targetNode.uid, position)) return;
  if (position === "inner") treeRef.value?.expandNode(targetNode.uid);
  markModified(`拖拽 ${dragNode.uid} ${position} ${targetNode.uid}`);
}

/** 打印大纲（对应参考项目 onPrint） */
function onPrint(): void {
  if (!contentRef.value) return;
  console.info("[MindMap/OutlineEdit] 打印大纲");
  printElement(contentRef.value);
}

/** 关闭（对应参考项目 onClose），写回画布在 isOutlineEdit 的监听里统一处理 */
function onClose(): void {
  isOutlineEdit.value = false;
}

/** 不失焦地提交正在编辑的文字（Ctrl+S 时使用，保留光标位置） */
function commitFocusedEdit(): void {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement) || !el.isContentEditable || !rootRef.value?.contains(el)) return;
  const uid = el.closest<HTMLElement>("[data-uid]")?.dataset.uid;
  const node = uid ? findOutlineNode(treeData.value, uid)?.node : null;
  if (node) commitText(node, el);
}

/** Ctrl+S：大纲写回画布后保存到文档 */
function saveToDocument(): void {
  const instance = mindMap.value;
  if (!instance) return;
  commitFocusedEdit();
  const data = modified ? getData() : null;
  if (data) {
    instance.updateData(data);
    console.info("[MindMap/OutlineEdit] Ctrl+S：大纲已同步到画布");
  }
  actions.save();
}

function onKeydown(event: KeyboardEvent): void {
  // 按键不冒泡到编辑器根元素与引擎快捷键（参考项目的大纲挂在 body 上，同样不会触发画布快捷键）
  event.stopPropagation();
  const isSave =
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === "s";
  if (isSave) {
    event.preventDefault();
    saveToDocument();
  }
}

// 进入 / 退出全屏大纲（pre 时机执行：退出时 DOM 还在，能先提交正在编辑的文字）
watch(
  isOutlineEdit,
  (value, oldValue) => {
    if (value) {
      enter();
    } else if (oldValue) {
      leave();
    }
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  // 编辑器关闭时引擎已先销毁，大纲修改无法写回（界面上无法在大纲模式下直接关闭编辑器，这里只做记录）
  if (isOutlineEdit.value && modified) {
    console.warn("[MindMap/OutlineEdit] 编辑器关闭时仍处于大纲模式，未写回的大纲修改已丢弃");
  }
});
</script>

<template>
  <div
    v-if="isOutlineEdit"
    ref="rootRef"
    class="mm-outline-edit"
    tabindex="-1"
    @keydown="onKeydown"
  >
    <div class="mm-outline-edit__btns">
      <button type="button" class="mm-outline-edit__btn" title="打印" @click="onPrint">
        <span class="mm-iconfont iconprinting" />
      </button>
      <button type="button" class="mm-outline-edit__btn" title="关闭" @click="onClose">
        <span class="mm-iconfont iconguanbi" />
      </button>
    </div>
    <div class="mm-outline-edit__box">
      <div ref="contentRef" class="mm-outline-edit__content">
        <OutlineTree
          ref="treeRef"
          v-model:current-uid="currentUid"
          :nodes="treeData"
          :readonly="isReadonly"
          large
          @edit-blur="onEditBlur"
          @edit-action="onEditAction"
          @remove="onRemove"
          @drop="onDrop"
        />
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
/* 覆盖整个编辑器：高于工具栏 / 面板 / 右键菜单，低于加载遮罩与 MmDialog */
.mm-outline-edit {
  position: absolute;
  inset: 0;
  z-index: 2000;
  overflow: hidden;
  outline: none;
  background: var(--background-color-1, #fff);
  color: var(--text-color, #333);
}

.mm-outline-edit__btns {
  position: absolute;
  top: 20px;
  right: 40px;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 12px;
}

.mm-outline-edit__btn {
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-color-1, #333);
  line-height: 1;
  cursor: pointer;

  &:hover {
    color: var(--primary-color, #409eff);
  }

  .mm-iconfont {
    font-size: 28px;
  }
}

.mm-outline-edit__box {
  box-sizing: border-box;
  height: 100%;
  overflow-y: auto;
  padding: 50px 0;
}

.mm-outline-edit__content {
  width: 1000px;
  max-width: calc(100% - 48px);
  margin: 0 auto;
}
</style>
