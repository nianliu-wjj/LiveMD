<script setup lang="ts">
/**
 * 备注侧边栏（移植自参考项目 NodeNoteSidebar.vue，面板名 noteSidebar）
 *
 * - 点击节点上的备注图标（引擎 node_note_click）时打开，渲染该节点的备注 Markdown
 *   （参考项目用 toast-ui Viewer，这里用 markdownToHtml，见 NoteMarkdownView）；
 * - 面板打开期间激活了其它节点或取消激活时收起（与参考项目一致）；
 * 与参考项目不同：备注被修改（编辑弹窗、撤销）后同步刷新；非只读时提供「编辑备注」入口（派发 showNodeNote(node)）。
 */
import { onBeforeUnmount, ref, shallowRef } from "vue";
import type { MindMapNodeInstance } from "@/core/mindmap-engine/full";
import { useBusEvent, useMindMapContext } from "../context";
import MmPanel from "../ui/MmPanel.vue";
import NoteMarkdownView from "./NoteMarkdownView.vue";

const PANEL_NAME = "noteSidebar";

const { mindMap, bus, activeSidebar, setActiveSidebar, isReadonly } = useMindMapContext();

/** 正在查看备注的节点 */
const node = shallowRef<MindMapNodeInstance | null>(null);
const content = ref("");

/** 点击备注图标（引擎事件参数：node, event, svgNode） */
function onNodeNoteClick(target: MindMapNodeInstance): void {
  node.value = target;
  content.value = target.getData("note") || "";
  setActiveSidebar(PANEL_NAME);
  console.debug("[MindMap/NodeNoteSidebar] 查看节点备注，长度:", content.value.length);
}

useBusEvent("node_active", (_node: unknown, list: MindMapNodeInstance[] = []) => {
  if (activeSidebar.value !== PANEL_NAME) return;
  if (list.length <= 0 || list[0] !== node.value) setActiveSidebar(null);
});

useBusEvent("data_change", () => {
  if (activeSidebar.value === PANEL_NAME && node.value) {
    content.value = node.value.getData("note") || "";
  }
});

function editNote(): void {
  if (node.value) bus.emit("showNodeNote", node.value);
}

// node_note_click 不在根组件转发列表里，直接监听引擎（卸载时引擎可能已销毁，用挂载时的实例解绑）
const engine = mindMap.value;
engine?.on("node_note_click", onNodeNoteClick);
onBeforeUnmount(() => engine?.off("node_note_click", onNodeNoteClick));
</script>

<template>
  <MmPanel name="noteSidebar" title="备注">
    <div class="node-note-sidebar">
      <div v-if="node && !isReadonly" class="node-note-sidebar__actions">
        <button type="button" class="mm-btn mm-btn--small" @click="editNote">编辑备注</button>
      </div>
      <NoteMarkdownView v-if="content.trim()" :markdown="content" />
      <div v-else class="node-note-sidebar__empty">暂无备注</div>
    </div>
  </MmPanel>
</template>

<style lang="less" scoped>
.node-note-sidebar__actions {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 10px;
}

.node-note-sidebar__empty {
  padding: 20px 0;
  text-align: center;
  color: var(--text-color-3, #999);
}
</style>
