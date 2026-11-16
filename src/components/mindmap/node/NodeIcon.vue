<script setup lang="ts">
/**
 * 节点图标弹窗（移植自参考项目 NodeIcon.vue）
 *
 * - 总线 showNodeIcon 打开；点击图标：已有则删除、同类型则替换、否则追加，
 *   以第一个激活节点的图标为准，结果设置到全部激活节点（与参考项目一致）；
 * - 图标 = 引擎内置图标 MindMap.iconList + 扩展图标 extraIconList。
 *
 * 注：参考项目工具栏的「图标」按钮实际打开的是侧边栏 NodeIconSidebar（setActiveSidebar('nodeIconSidebar')），
 * 本弹窗与参考项目一样保留，响应派发 showNodeIcon 的入口。打开期间暂停引擎快捷键（useNodeDialogGuard）。
 */
import { ref } from "vue";
import autotoast from "autotoast.js";
import type { MindMapNodeInstance } from "@/core/mindmap-engine/full";
import { useBusEvent, useMindMapContext } from "../context";
import MmDialog from "../ui/MmDialog.vue";
import NodeIconGrid from "./NodeIconGrid.vue";
import { getNodeIconGroups, toggleNodeIcon } from "./nodeContentUtils";
import { useNodeDialogGuard } from "./useNodeDialogGuard";

const { activeNodes, isReadonly } = useMindMapContext();

const iconGroups = getNodeIconGroups();
const dialogVisible = ref(false);
const contentRef = ref<HTMLElement | null>(null);
/** 第一个激活节点的图标（回显选中态） */
const iconList = ref<string[]>([]);
/** 当前激活节点（node_active 维护，对应参考项目 data.activeNodes） */
let nodes: MindMapNodeInstance[] = [...activeNodes.value];

useNodeDialogGuard(dialogVisible);

/** 从第一个激活节点回显图标（复制数组，避免直接改动节点数据） */
function syncFromNodes(): void {
  iconList.value = [...(nodes[0]?.getData("icon") ?? [])];
}

syncFromNodes();

useBusEvent("node_active", (_node: unknown, list: MindMapNodeInstance[] = []) => {
  nodes = [...list];
  syncFromNodes();
});

useBusEvent("showNodeIcon", () => {
  if (isReadonly.value) {
    console.info("[MindMap/NodeIcon] 只读模式，不打开图标弹窗");
    return;
  }
  // 节点数据可能已被其它入口（图标浮动工具条、撤销）修改，打开时重新回显
  syncFromNodes();
  dialogVisible.value = true;
  console.debug("[MindMap/NodeIcon] 打开图标弹窗，激活节点数:", nodes.length);
});

function setIcon(type: string, name: string): void {
  if (nodes.length <= 0) {
    autotoast.show("请先选择节点", "info");
    return;
  }
  iconList.value = toggleNodeIcon(iconList.value, type, name);
  console.debug("[MindMap/NodeIcon] 设置图标:", iconList.value);
  nodes.forEach((node) => node.setIcon([...iconList.value]));
}
</script>

<template>
  <MmDialog v-model="dialogVisible" title="图标" width="500px" hide-footer>
    <div ref="contentRef" class="node-icon" tabindex="-1">
      <div v-for="group in iconGroups" :key="group.type" class="node-icon__group">
        <div class="node-icon__title">{{ group.name }}</div>
        <NodeIconGrid
          :type="group.type"
          :list="group.list"
          :selected="iconList"
          @select="(name: string) => setIcon(group.type, name)"
        />
      </div>
    </div>
  </MmDialog>
</template>

<style lang="less" scoped>
.node-icon {
  // 内容容器可聚焦（tabindex="-1"，焦点元素被移除 / 禁用时的兜底落点），不显示焦点框
  outline: none;
}

.node-icon__group {
  margin-bottom: 20px;

  &:last-child {
    margin-bottom: 4px;
  }
}

.node-icon__title {
  margin-bottom: 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color, #333);
}
</style>
