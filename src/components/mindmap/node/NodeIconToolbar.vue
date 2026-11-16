<script setup lang="ts">
/**
 * 节点图标浮动工具条（移植自参考项目 NodeIconToolbar.vue）
 *
 * 点击节点上的图标（引擎 node_icon_click）时，在节点下方列出同类型的全部图标：点击切换 / 替换，
 * 底部按钮删除当前图标。参考项目挂到 body 上 position: fixed；这里按约定放在编辑器根元素内绝对定位，
 * 坐标由窗口坐标换算，并限制在编辑器可视范围内（下方放不下时翻到节点上方）。
 *
 * 关闭时机与参考项目一致：点击画布、画布按下、双击节点、激活其它节点、总线 close_node_icon_toolbar
 * （工具栏「图标」按钮打开侧边栏前派发）；显示时若图标侧边栏开着则收起它。
 * 与参考项目不同：画布平移、节点重新渲染后也跟随更新位置；只读模式下不显示（避免绕过只读修改图标）。
 */
import { computed, nextTick, onBeforeUnmount, reactive, ref } from "vue";
import type { MindMapNodeInstance } from "@/core/mindmap-engine/full";
import { useBusEvent, useMindMapContext } from "../context";
import NodeIconGrid from "./NodeIconGrid.vue";
import {
  clamp,
  getEditorRect,
  getNodeIconGroups,
  getSvgClientRect,
  toIconKey,
  toggleNodeIcon,
} from "./nodeContentUtils";

const { mindMap, activeSidebar, setActiveSidebar, isReadonly } = useMindMapContext();

const iconGroups = getNodeIconGroups();
const toolbarRef = ref<HTMLElement | null>(null);
const visible = ref(false);
const position = reactive({ left: 0, top: 0 });
/** 被点击图标的分组类型与图标名 */
const iconType = ref("");
const iconName = ref("");
/** 节点当前的图标列表 */
const nodeIconList = ref<string[]>([]);
/** 同类型的全部图标 */
const iconList = computed(
  () => iconGroups.find((group) => group.type === iconType.value)?.list ?? []
);
let currentNode: MindMapNodeInstance | null = null;

/** 显示（引擎事件参数：node, iconKey, event, svgNode） */
function show(node: MindMapNodeInstance, icon: string): void {
  if (isReadonly.value) {
    console.debug("[MindMap/NodeIconToolbar] 只读模式，不显示图标工具条");
    return;
  }
  const [type = "", name = ""] = String(icon).split("_");
  if (!iconGroups.some((group) => group.type === type)) {
    console.warn("[MindMap/NodeIconToolbar] 未知的图标分组，忽略:", icon);
    return;
  }
  currentNode = node;
  iconType.value = type;
  iconName.value = name;
  nodeIconList.value = [...(node.getData("icon") ?? [])];
  visible.value = true;
  void updatePos();
  if (activeSidebar.value === "nodeIconSidebar") setActiveSidebar(null);
  console.debug("[MindMap/NodeIconToolbar] 显示图标工具条:", icon);
}

function close(): void {
  if (!visible.value && !currentNode) return;
  visible.value = false;
  currentNode = null;
  iconType.value = "";
  iconName.value = "";
  nodeIconList.value = [];
}

/** 定位到节点下方（窗口坐标 → 编辑器根元素内坐标） */
async function updatePos(): Promise<void> {
  if (!currentNode || !visible.value) return;
  await nextTick();
  const el = toolbarRef.value;
  const rect = getSvgClientRect(currentNode?.group);
  if (!el || !rect) return;
  const container = getEditorRect(el);
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  let top = rect.bottom - container.top;
  // 下方放不下时翻到节点上方
  if (top + height > container.height && rect.top - container.top - height >= 0) {
    top = rect.top - container.top - height;
  }
  position.left = clamp(rect.left - container.left, 0, container.width - width);
  position.top = clamp(top, 0, container.height - height);
}

/** 激活了其它节点时关闭（对应参考项目 onNodeActive） */
function onNodeActive(node: MindMapNodeInstance | null): void {
  if (node && node === currentNode) return;
  close();
}

/** 点击图标：切换 / 替换 / 追加（对应参考项目 setIcon） */
function setIcon(name: string): void {
  if (!currentNode) return;
  const key = toIconKey(iconType.value, name);
  nodeIconList.value = toggleNodeIcon(nodeIconList.value, iconType.value, name);
  // 替换或重新追加后，当前图标变为新点击的这个（参考项目追加分支漏了这一步，删除按钮会删错）
  if (nodeIconList.value.includes(key)) iconName.value = name;
  currentNode.setIcon([...nodeIconList.value]);
  console.debug("[MindMap/NodeIconToolbar] 设置图标:", nodeIconList.value);
}

/** 删除当前图标 */
function deleteIcon(): void {
  if (currentNode && nodeIconList.value.includes(toIconKey(iconType.value, iconName.value))) {
    setIcon(iconName.value);
  }
  close();
}

useBusEvent("node_icon_click", show);
useBusEvent("draw_click", close);
useBusEvent("svg_mousedown", close);
useBusEvent("node_active", onNodeActive);
useBusEvent("close_node_icon_toolbar", close);
useBusEvent("scale", () => void updatePos());
useBusEvent("translate", () => void updatePos());
useBusEvent("node_tree_render_end", () => void updatePos());

// node_dblclick 不在根组件转发列表里，直接监听引擎（卸载时引擎可能已销毁，用挂载时的实例解绑）
const engine = mindMap.value;
engine?.on("node_dblclick", close);
onBeforeUnmount(() => engine?.off("node_dblclick", close));
</script>

<template>
  <div
    v-show="visible"
    ref="toolbarRef"
    class="node-icon-toolbar"
    :style="{ left: `${position.left}px`, top: `${position.top}px` }"
    @click.stop
    @keydown.stop
  >
    <div class="node-icon-toolbar__list">
      <NodeIconGrid :type="iconType" :list="iconList" :selected="nodeIconList" @select="setIcon" />
    </div>
    <div class="node-icon-toolbar__footer">
      <button type="button" class="node-icon-toolbar__delete" title="删除图标" @click="deleteIcon">
        <span class="mm-iconfont iconshanchu" />
      </button>
    </div>
  </div>
</template>

<style lang="less" scoped>
.node-icon-toolbar {
  position: absolute;
  z-index: 1500;
  width: 210px;
  max-height: 170px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border-color-1, rgba(0, 0, 0, 0.06));
  border-radius: 8px;
  background: var(--background-color-1, #fff);
  box-shadow: 0 2px 16px 0 rgba(0, 0, 0, 0.12);
}

.node-icon-toolbar__list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
}

.node-icon-toolbar__footer {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  height: 30px;
  border-top: 1px solid var(--border-color-1, #eee);
}

.node-icon-toolbar__delete {
  padding: 2px 8px;
  border: none;
  background: transparent;
  color: var(--text-color-2, rgba(26, 26, 26, 0.8));
  cursor: pointer;

  &:hover {
    color: #e53e3e;
  }
}
</style>
