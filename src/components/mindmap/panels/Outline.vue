<script setup lang="ts">
/**
 * 大纲树（对应参考项目 Outline.vue）：在右侧「大纲」面板里以可编辑树展示整棵思维导图，修改直接作用于画布
 *
 * 交互与参考项目一致：
 * - 点击节点：在画布上激活该节点并移到画布中间（GO_TARGET_NODE，已激活时不重复定位）；
 * - 直接编辑节点文字，失焦时有修改才 setText 写回（富文本节点转换为富文本结构）；
 * - 编辑框内 Enter 插入同级节点、Tab 插入子节点、Shift+Tab 上移一个层级：文字有修改时先提交，
 *   等画布渲染完成（node_tree_render_end）再执行，插入后高亮、定位新节点并选中其文字；
 * - 节点获得焦点时 Delete / Backspace 删除节点（根节点除外）；拖拽调整层级（INSERT_BEFORE / INSERT_AFTER /
 *   MOVE_NODE_TO）；画布数据变化（data_change）时刷新大纲。
 *
 * 与参考项目的差异（均为加固，不改变行为）：
 * - 插入 / 上移明确作用于正在编辑的节点（参考项目依赖它恰好是画布上的激活节点）；
 * - 大纲行按 uid 复用 DOM，刷新不会打断编辑，因此不再需要 notHandleDataChange 等标记，
 *   画布数据变化后总是刷新，删除 / 拖拽时先就地更新大纲，避免等待刷新时的闪动；
 * - 只读时不能删除、拖拽（参考项目只禁止了编辑文字）；Shift+Tab 之后焦点保留在原节点上。
 */
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { createUid } from "@/core/mindmap-engine/src/utils/index.js";
import type { MindMapNodeInstance } from "@/core/mindmap-engine/full";
import { useBusEvent, useMindMapContext } from "../context";
import OutlineTree from "./OutlineTree.vue";
import {
  buildOutlineTree,
  findOutlineNode,
  moveOutlineNode,
  removeOutlineNode,
  syncOutlineLabel,
  takeEditedText,
  type OutlineDropPosition,
  type OutlineEditAction,
  type OutlineNode,
} from "./outlineModel";

interface PendingAction {
  type: OutlineEditAction;
  uid: string;
}

interface PendingFocus {
  uid: string;
  /** 是否选中全部文字（新建节点时选中默认文字，便于直接输入替换） */
  selectAll: boolean;
}

const { mindMap, isReadonly, execCommand } = useMindMapContext();

const treeRef = ref<InstanceType<typeof OutlineTree> | null>(null);
const treeData = ref<OutlineNode[]>([]);
const currentUid = ref<string | null>(null);

/** 文字修改提交后、等待画布渲染完成再执行的插入 / 上移操作（对应参考项目 insertType） */
let pendingAction: PendingAction | null = null;
/** 插入 / 上移渲染完成后需要聚焦的大纲节点（对应参考项目 beInsertNodeUid） */
let pendingFocus: PendingFocus | null = null;

/** 从画布数据重建大纲（对应参考项目 refresh） */
function refresh(): void {
  const instance = mindMap.value;
  if (!instance) return;
  treeData.value = buildOutlineTree(instance.getData());
}

function findEngineNode(uid: string): MindMapNodeInstance | null {
  return mindMap.value?.renderer.findNodeByUid(uid) ?? null;
}

/**
 * 提交节点文字（对应参考项目 onBlur）：编辑框内容与修改前不同才写回画布
 * @returns 是否调用了 setText（会触发画布渲染与 node_tree_render_end）
 */
function commitText(node: OutlineNode, el: HTMLElement): boolean {
  if (isReadonly.value) return false;
  const previousCache = node.textCache;
  const text = takeEditedText(node, el);
  if (text === null) return false;
  const target = findEngineNode(node.uid);
  if (!target) {
    // 画布上找不到该节点（例如已被删除）：放弃提交，恢复修改前的文本记录
    node.textCache = previousCache;
    console.warn("[MindMap/Outline] 提交文字时找不到画布节点:", node.uid);
    return false;
  }
  console.debug("[MindMap/Outline] 提交节点文字:", node.uid);
  if (node.richText) {
    target.setText(text, true);
  } else {
    target.setText(text);
  }
  return true;
}

function onEditBlur(node: OutlineNode, el: HTMLElement): void {
  commitText(node, el);
  syncOutlineLabel(node);
}

/** 编辑框内 Enter / Tab / Shift+Tab（对应参考项目 onNodeInputKeydown + onBlur 中的 insertType 处理） */
function onEditAction(type: OutlineEditAction, node: OutlineNode, el: HTMLElement): void {
  if (isReadonly.value) return;
  const action: PendingAction = { type, uid: node.uid };
  // 先登记再提交：setText 在节点尺寸不变时会同步派发 node_tree_render_end
  pendingAction = action;
  const committed = commitText(node, el);
  if (!committed) pendingAction = null;
  // 与参考项目一致：结束当前编辑（失焦），文字已提交，失焦时不会重复提交
  el.blur();
  if (!committed) runAction(action);
}

/** 执行插入同级 / 插入子级 / 上移层级（对应参考项目 insertNode / insertChildNode / moveUp） */
function runAction(action: PendingAction): void {
  const target = findEngineNode(action.uid);
  if (!target) {
    console.warn("[MindMap/Outline] 执行操作时找不到画布节点:", action.type, action.uid);
    return;
  }
  switch (action.type) {
    case "insertSibling": {
      // 根节点不能插入同级节点（引擎同样会跳过）
      if (target.isRoot) return;
      const uid = String(createUid());
      pendingFocus = { uid, selectAll: true };
      console.info("[MindMap/Outline] 插入同级节点:", action.uid, "→", uid);
      execCommand("INSERT_NODE", false, [target], { uid });
      break;
    }
    case "insertChild": {
      const uid = String(createUid());
      pendingFocus = { uid, selectAll: true };
      console.info("[MindMap/Outline] 插入子节点:", action.uid, "→", uid);
      execCommand("INSERT_CHILD_NODE", false, [target], { uid });
      break;
    }
    case "moveUp":
      // 二级节点不能再上移（会和根节点同级），引擎同样会跳过，这里提前返回避免等待一次不会发生的渲染
      if (target.isRoot || target.layerIndex <= 1) return;
      pendingFocus = { uid: action.uid, selectAll: false };
      console.info("[MindMap/Outline] 节点上移一个层级:", action.uid);
      execCommand("MOVE_UP_ONE_LEVEL", target);
      break;
    default:
      break;
  }
}

/** 画布渲染完成（对应参考项目 handleNodeTreeRenderEnd） */
function onNodeTreeRenderEnd(): void {
  // 文字修改已渲染：继续执行等待中的插入 / 上移（放到微任务里，避免嵌套在引擎设置文本的命令中执行）
  if (pendingAction) {
    const action = pendingAction;
    pendingAction = null;
    void Promise.resolve().then(() => runAction(action));
    return;
  }
  // 插入 / 上移已渲染：刷新大纲，高亮、定位并聚焦目标节点（对应参考项目 afterCreateNewNode）
  if (pendingFocus) {
    const focus = pendingFocus;
    pendingFocus = null;
    refresh();
    void nextTick(async () => {
      const focused = await treeRef.value?.focusNode(focus.uid, { selectAll: focus.selectAll });
      if (focused) locateNode(focus.uid);
    });
  }
}

/** 在画布上激活节点并移到画布中间（对应参考项目 onClick，节点已激活时不重复定位） */
function locateNode(uid: string): void {
  const target = findEngineNode(uid);
  if (target?.getData("isActive")) return;
  execCommand("GO_TARGET_NODE", uid);
}

function onNodeClick(node: OutlineNode): void {
  locateNode(node.uid);
}

/** 删除节点（对应参考项目 onKeyDown 中的删除） */
function onRemove(node: OutlineNode): void {
  const instance = mindMap.value;
  if (!instance || isReadonly.value || node.root) return;
  instance.renderer.textEdit.hideEditTextBox();
  const target = findEngineNode(node.uid);
  if (!target || target.isRoot) {
    console.warn("[MindMap/Outline] 删除时找不到画布节点:", node.uid);
    return;
  }
  console.info("[MindMap/Outline] 删除节点:", node.uid);
  removeOutlineNode(treeData.value, node.uid);
  currentUid.value = null;
  execCommand("REMOVE_NODE", [target]);
  treeRef.value?.focusTree();
}

/** 拖拽结束（对应参考项目 onNodeDrop） */
function onDrop(
  dragNode: OutlineNode,
  targetNode: OutlineNode,
  position: OutlineDropPosition
): void {
  if (isReadonly.value) return;
  const node = findEngineNode(dragNode.uid);
  const target = findEngineNode(targetNode.uid);
  if (!node || !target) {
    console.warn("[MindMap/Outline] 拖拽时找不到画布节点:", dragNode.uid, targetNode.uid);
    return;
  }
  // 先就地更新大纲，画布数据变化后的刷新会得到同样的结构
  moveOutlineNode(treeData.value, dragNode.uid, targetNode.uid, position);
  if (position === "inner") treeRef.value?.expandNode(targetNode.uid);
  console.info("[MindMap/Outline] 移动节点:", dragNode.uid, position, targetNode.uid);
  switch (position) {
    case "before":
      execCommand("INSERT_BEFORE", node, target);
      break;
    case "after":
      execCommand("INSERT_AFTER", node, target);
      break;
    case "inner":
      execCommand("MOVE_NODE_TO", node, target);
      break;
    default:
      break;
  }
}

useBusEvent("data_change", refresh);
useBusEvent("node_tree_render_end", onNodeTreeRenderEnd);

onMounted(() => {
  refresh();
  console.debug("[MindMap/Outline] 大纲已挂载，根节点数:", treeData.value.length);
});

onBeforeUnmount(() => {
  // 面板被直接收起（如切换为只读、其它组件收起面板）时编辑框随 DOM 移除，不会触发失焦，这里补一次提交
  const el = document.activeElement;
  if (!(el instanceof HTMLElement) || !el.isContentEditable) return;
  if (!treeRef.value?.getEl()?.contains(el)) return;
  const uid = el.closest<HTMLElement>("[data-uid]")?.dataset.uid;
  const node = uid ? findOutlineNode(treeData.value, uid)?.node : null;
  if (node && commitText(node, el))
    console.info("[MindMap/Outline] 面板收起前提交了正在编辑的文字");
});

defineExpose({
  /** 打印用的大纲元素 */
  getEl: (): HTMLElement | null => treeRef.value?.getEl() ?? null,
});
</script>

<template>
  <OutlineTree
    ref="treeRef"
    v-model:current-uid="currentUid"
    :nodes="treeData"
    :readonly="isReadonly"
    @node-click="onNodeClick"
    @edit-blur="onEditBlur"
    @edit-action="onEditAction"
    @remove="onRemove"
    @drop="onDrop"
  />
</template>
