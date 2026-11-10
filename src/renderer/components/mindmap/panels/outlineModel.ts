/**
 * 大纲树数据模型（私有模块，供 Outline.vue、OutlineEdit.vue、OutlineTree.vue 共用）
 *
 * 对应参考项目 Outline.vue / OutlineEdit.vue 里的 refresh()、getData()，以及 el-tree 的
 * remove / insertAfter / append / 拖拽移动等节点操作：
 * - buildOutlineTree：引擎节点数据 → 大纲树（文本 HTML 转义、换行转 <br>，并记录修改前的文本）；
 * - outlineToNodeData：大纲树 → 引擎节点数据（全屏大纲写回画布时使用，原样保留节点的样式、图片等字段）；
 * - takeEditedText：读取编辑框内容，判断是否修改并换算成写回引擎的文本（富文本节点转为 <p><span> 结构）；
 * - 查找 / 删除 / 插入 / 移动 / 上移层级：纯数据操作，界面由 OutlineTree 按 uid 复用 DOM 增量更新。
 */
import { markRaw } from "vue";
import {
  createUid,
  htmlEscape,
  nodeRichTextToTextWithWrap,
  simpleDeepClone,
  textToNodeRichTextWithWrap,
} from "@/core/mindmap-engine/src/utils/index.js";
import type { MindMapNodeData } from "@/core/mindmap-engine/full";

/** 大纲树节点 */
export interface OutlineNode {
  /** 节点 uid（与引擎节点一致，侧边栏大纲据此找到画布节点） */
  uid: string;
  /** 显示用 HTML：转义后的纯文本，换行转为 <br> */
  label: string;
  /** 已提交的文本 HTML，失焦时与编辑框内容比较判断是否修改（对应参考项目 textCache） */
  textCache: string;
  /** 是否根节点（根节点不能拖拽、删除，也不能插入同级节点） */
  root: boolean;
  /** 是否富文本节点（写回时需要转换为富文本结构） */
  richText: boolean;
  /** 引擎节点的 data 字段（markRaw：可能含大体积图片等数据，不需要深度响应式） */
  data: MindMapNodeData["data"];
  children: OutlineNode[];
}

/** 拖拽放置位置：目标前面 / 目标后面 / 作为目标的子节点（与 el-tree 的 before / after / inner 一致） */
export type OutlineDropPosition = "before" | "after" | "inner";

/** 编辑框内的快捷操作：Enter 插入同级、Tab 插入子级、Shift+Tab 上移一个层级 */
export type OutlineEditAction = "insertSibling" | "insertChild" | "moveUp";

/** 节点在树中的位置 */
export interface OutlineNodeLocation {
  node: OutlineNode;
  parent: OutlineNode | null;
  /** 所在的兄弟数组（顶层为树的根数组） */
  siblings: OutlineNode[];
  index: number;
}

/** 全屏大纲新建节点的默认文本（参考项目 outline.nodeDefaultText） */
export const OUTLINE_NODE_DEFAULT_TEXT = "分支节点";

/** 节点数据中的文本 → 大纲显示 HTML（富文本先转成带换行的纯文本，再转义并把换行换成 <br>） */
export function nodeTextToLabel(data: { text?: unknown; richText?: unknown }): string {
  const raw = data.text === undefined || data.text === null ? "" : String(data.text);
  const text: string = data.richText ? nodeRichTextToTextWithWrap(raw) : raw;
  return htmlEscape(text).replace(/\n/g, "<br>");
}

function toOutlineNode(nodeData: MindMapNodeData, isRoot: boolean): OutlineNode {
  const data = nodeData.data ?? { text: "" };
  const label = nodeTextToLabel(data);
  return {
    uid: String(data.uid ?? ""),
    label,
    textCache: label,
    root: isRoot,
    richText: Boolean(data.richText),
    data: markRaw(data),
    children: (nodeData.children ?? []).map((child) => toOutlineNode(child, false)),
  };
}

/** 引擎节点数据（mindMap.getData()）→ 大纲树（顶层数组只有根节点一项，与参考项目 this.data = [data] 一致） */
export function buildOutlineTree(rootData: MindMapNodeData | null | undefined): OutlineNode[] {
  if (!rootData?.data) return [];
  return [toOutlineNode(rootData, true)];
}

/** 大纲树 → 引擎节点数据（只保留 data 与 children，深拷贝，对应参考项目 OutlineEdit.getData） */
export function outlineToNodeData(node: OutlineNode): MindMapNodeData {
  const walk = (item: OutlineNode): MindMapNodeData => ({
    data: item.data,
    children: item.children.map(walk),
  });
  return simpleDeepClone(walk(node)) as MindMapNodeData;
}

/**
 * 读取编辑框内容（对应参考项目 onBlur 的比较逻辑）
 *
 * @returns 未修改返回 null；修改了则更新 textCache，并返回写回引擎的文本：
 *          富文本节点为 <p><span> 结构的 HTML，普通节点为 innerText（<br> 转为换行）
 */
export function takeEditedText(node: OutlineNode, el: HTMLElement): string | null {
  const html = el.innerHTML;
  if (html === node.textCache) return null;
  node.textCache = html;
  return node.richText ? textToNodeRichTextWithWrap(html) : el.innerText;
}

/**
 * 编辑框失焦后把显示内容同步为已提交的文本
 *
 * 编辑过程中不改 label（改了会触发 v-html 重写编辑框、丢失光标），失焦后再同步；
 * 否则节点所在分支被收起再展开、行重新挂载时会显示修改前的文本。
 */
export function syncOutlineLabel(node: OutlineNode): void {
  if (node.label !== node.textCache) node.label = node.textCache;
}

/** 按 uid 查找节点及其位置 */
export function findOutlineNode(
  nodes: OutlineNode[],
  uid: string,
  parent: OutlineNode | null = null
): OutlineNodeLocation | null {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node.uid === uid) return { node, parent, siblings: nodes, index };
    const found = findOutlineNode(node.children, uid, node);
    if (found) return found;
  }
  return null;
}

/** 查找节点的全部祖先（从根到父节点），节点不存在时返回 null */
export function findOutlineAncestors(nodes: OutlineNode[], uid: string): OutlineNode[] | null {
  for (const node of nodes) {
    if (node.uid === uid) return [];
    const found = findOutlineAncestors(node.children, uid);
    if (found) return [node, ...found];
  }
  return null;
}

/** uid 是否为 ancestor 本身或其子孙（拖拽时不能放到自身或子孙节点上） */
export function outlineContains(ancestor: OutlineNode, uid: string): boolean {
  if (ancestor.uid === uid) return true;
  return ancestor.children.some((child) => outlineContains(child, uid));
}

/** 删除节点（对应 el-tree remove），返回被删除的节点 */
export function removeOutlineNode(nodes: OutlineNode[], uid: string): OutlineNode | null {
  const location = findOutlineNode(nodes, uid);
  if (!location) return null;
  location.siblings.splice(location.index, 1);
  return location.node;
}

/** 在参考节点后面插入同级节点（对应 el-tree insertAfter），根节点不能有同级节点 */
export function insertOutlineNodeAfter(
  nodes: OutlineNode[],
  refUid: string,
  newNode: OutlineNode
): boolean {
  const location = findOutlineNode(nodes, refUid);
  if (!location || location.node.root) return false;
  location.siblings.splice(location.index + 1, 0, newNode);
  return true;
}

/** 追加为最后一个子节点（对应 el-tree append） */
export function appendOutlineChild(
  nodes: OutlineNode[],
  parentUid: string,
  newNode: OutlineNode
): boolean {
  const location = findOutlineNode(nodes, parentUid);
  if (!location) return false;
  location.node.children.push(newNode);
  return true;
}

/**
 * 节点上移一个层级：成为原父节点后面的同级节点（对应参考项目 Shift+Tab）
 * 父节点是根节点时不能再上移（否则会和根节点同级，导出数据时丢失），返回 false
 */
export function moveOutlineNodeUpLevel(nodes: OutlineNode[], uid: string): boolean {
  const location = findOutlineNode(nodes, uid);
  if (!location?.parent || location.parent.root) return false;
  const parentLocation = findOutlineNode(nodes, location.parent.uid);
  if (!parentLocation) return false;
  location.siblings.splice(location.index, 1);
  parentLocation.siblings.splice(parentLocation.index + 1, 0, location.node);
  return true;
}

/**
 * 拖拽移动节点（对应 el-tree 拖拽结束后的数据移动）
 * 根节点不能移动；不能移到自身或子孙节点上；根节点只能作为放置目标的 inner 位置
 */
export function moveOutlineNode(
  nodes: OutlineNode[],
  dragUid: string,
  targetUid: string,
  position: OutlineDropPosition
): boolean {
  const dragLocation = findOutlineNode(nodes, dragUid);
  if (!dragLocation || dragLocation.node.root) return false;
  if (outlineContains(dragLocation.node, targetUid)) return false;
  const target = findOutlineNode(nodes, targetUid);
  if (!target || (target.node.root && position !== "inner")) return false;
  // 先移除再重新定位目标：同一父节点下移动时，移除会改变目标的下标
  dragLocation.siblings.splice(dragLocation.index, 1);
  const targetLocation = findOutlineNode(nodes, targetUid);
  if (!targetLocation) {
    dragLocation.siblings.splice(dragLocation.index, 0, dragLocation.node);
    return false;
  }
  if (position === "inner") {
    targetLocation.node.children.push(dragLocation.node);
  } else {
    const offset = position === "after" ? 1 : 0;
    targetLocation.siblings.splice(targetLocation.index + offset, 0, dragLocation.node);
  }
  return true;
}

/** 新建大纲节点（对应参考项目 OutlineEdit 中 Enter / Tab 创建的节点数据） */
export function createOutlineNode(text: string, richText: boolean): OutlineNode {
  const uid = String(createUid());
  const label = htmlEscape(text);
  return {
    uid,
    label,
    textCache: label,
    root: false,
    richText,
    data: markRaw({ text: richText ? textToNodeRichTextWithWrap(text) : text, uid, richText }),
    children: [],
  };
}
