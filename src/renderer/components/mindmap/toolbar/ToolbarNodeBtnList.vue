<script setup lang="ts">
/**
 * 工具栏节点操作按钮列表（移植自参考项目 web/src/pages/Edit/components/ToolbarNodeBtnList.vue）
 *
 * - props 与参考项目一致：list 为要显示的按钮 key（顺序即显示顺序），dir 为排列方向
 *   （h：工具栏里水平排列；v：「更多」弹出层里竖排）；
 * - 按钮及禁用条件与参考项目一致（去掉 AI、附件、标记）：未选中节点时节点类按钮禁用，
 *   选中根节点时不能加同级 / 概要，选中概要节点时多数按钮禁用，只读或无历史时回退 / 前进禁用；
 * - 参考项目在组件内监听 mode_change / node_active / back_forward 维护只读、激活节点与历史状态，
 *   本项目由根组件统一维护到上下文（isReadonly / activeNodes / canBack / canForward），这里直接读取；
 *   格式刷状态仍按参考项目监听 painter_start / painter_end。
 *
 * 派发：execCommand（BACK / FORWARD / INSERT_NODE / INSERT_CHILD_NODE / REMOVE_NODE / ADD_GENERALIZATION /
 * ADD_OUTER_FRAME）、startPainter、showNodeImage、showNodeLink、showNodeNote、showNodeTag、
 * createAssociativeLine、close_node_icon_toolbar；面板：nodeIconSidebar（图标）、formulaSidebar（公式）。
 */
import { computed, ref } from "vue";
import { useBusEvent, useMindMapContext } from "../context";
import ToolbarBtn from "./ToolbarBtn.vue";

const props = withDefaults(
  defineProps<{
    /** 要显示的按钮 key，取值见下方 NODE_BTN_MAP（未知 key 忽略，与参考项目一致） */
    list?: string[];
    /** 排列方向：h 水平、v 垂直 */
    dir?: "h" | "v";
  }>(),
  { list: () => [], dir: "h" }
);

const { bus, activeNodes, isReadonly, canBack, canForward, execCommand, setActiveSidebar } =
  useMindMapContext();

/** 是否处于格式刷状态（参考项目 isInPainter） */
const isInPainter = ref(false);

useBusEvent("painter_start", () => {
  isInPainter.value = true;
});
useBusEvent("painter_end", () => {
  isInPainter.value = false;
});

/** 未选中任何节点 */
const noActiveNode = computed(() => activeNodes.value.length <= 0);
/** 选中节点里包含根节点（参考项目 hasRoot） */
const hasRoot = computed(() => activeNodes.value.some((node) => node.isRoot));
/** 选中节点里包含概要节点（参考项目 hasGeneralization） */
const hasGeneralization = computed(() => activeNodes.value.some((node) => node.isGeneralization));

interface NodeBtnDef {
  icon: string;
  text: string;
  /** 禁用条件（在渲染时求值，依赖的响应式状态会被自动追踪） */
  disabled: () => boolean;
  /** 激活态（仅格式刷） */
  active?: () => boolean;
  onClick: () => void;
}

/** 按钮定义：图标、文案、禁用条件、点击动作均与参考项目模板一一对应 */
const NODE_BTN_MAP: Record<string, NodeBtnDef> = {
  back: {
    icon: "iconhoutui-shi",
    text: "回退",
    disabled: () => isReadonly.value || !canBack.value,
    onClick: () => execCommand("BACK"),
  },
  forward: {
    icon: "iconqianjin1",
    text: "前进",
    disabled: () => isReadonly.value || !canForward.value,
    onClick: () => execCommand("FORWARD"),
  },
  painter: {
    icon: "iconjiedian",
    text: "格式刷",
    disabled: () => noActiveNode.value || hasGeneralization.value,
    active: () => isInPainter.value,
    onClick: () => bus.emit("startPainter"),
  },
  siblingNode: {
    icon: "iconjiedian",
    text: "同级节点",
    disabled: () => noActiveNode.value || hasRoot.value || hasGeneralization.value,
    onClick: () => execCommand("INSERT_NODE"),
  },
  childNode: {
    icon: "icontianjiazijiedian",
    text: "子节点",
    disabled: () => noActiveNode.value || hasGeneralization.value,
    onClick: () => execCommand("INSERT_CHILD_NODE"),
  },
  deleteNode: {
    icon: "iconshanchu",
    text: "删除节点",
    // 与参考项目一致只要求选中节点：选中根节点时引擎 REMOVE_NODE 只清空其子节点，不会删除根节点
    disabled: () => noActiveNode.value,
    onClick: () => execCommand("REMOVE_NODE"),
  },
  image: {
    icon: "iconimage",
    text: "图片",
    disabled: () => noActiveNode.value,
    onClick: () => bus.emit("showNodeImage"),
  },
  icon: {
    icon: "iconxiaolian",
    text: "图标",
    disabled: () => noActiveNode.value,
    onClick: () => {
      // 先关闭节点上的图标快捷切换条，再打开图标侧边栏（参考项目 showNodeIcon）
      bus.emit("close_node_icon_toolbar");
      setActiveSidebar("nodeIconSidebar");
    },
  },
  link: {
    icon: "iconchaolianjie",
    text: "超链接",
    disabled: () => noActiveNode.value,
    onClick: () => bus.emit("showNodeLink"),
  },
  note: {
    icon: "iconflow-Mark",
    text: "备注",
    disabled: () => noActiveNode.value,
    onClick: () => bus.emit("showNodeNote"),
  },
  tag: {
    icon: "iconbiaoqian",
    text: "标签",
    disabled: () => noActiveNode.value,
    onClick: () => bus.emit("showNodeTag"),
  },
  summary: {
    icon: "icongaikuozonglan",
    text: "概要",
    disabled: () => noActiveNode.value || hasRoot.value || hasGeneralization.value,
    onClick: () => execCommand("ADD_GENERALIZATION"),
  },
  associativeLine: {
    icon: "iconlianjiexian",
    text: "关联线",
    disabled: () => noActiveNode.value || hasGeneralization.value,
    onClick: () => bus.emit("createAssociativeLine"),
  },
  formula: {
    icon: "icongongshi",
    text: "公式",
    disabled: () => noActiveNode.value || hasGeneralization.value,
    onClick: () => setActiveSidebar("formulaSidebar"),
  },
  outerFrame: {
    icon: "iconwaikuang",
    text: "外框",
    disabled: () => noActiveNode.value || hasGeneralization.value,
    onClick: () => execCommand("ADD_OUTER_FRAME"),
  },
};

/** 实际渲染的按钮（过滤掉本项目不支持的 key，如 ai / attachment） */
const btnList = computed(() =>
  props.list
    .filter((key: string) => Object.hasOwn(NODE_BTN_MAP, key))
    .map((key: string) => ({ key, ...NODE_BTN_MAP[key] }))
);

function onBtnClick(key: string, def: NodeBtnDef): void {
  console.debug("[MindMap/ToolbarNodeBtnList] 点击节点按钮:", key);
  def.onClick();
}
</script>

<template>
  <div class="mm-toolbar-node-btns" :class="`is-${props.dir}`">
    <ToolbarBtn
      v-for="btn in btnList"
      :key="btn.key"
      :icon="btn.icon"
      :text="btn.text"
      :disabled="btn.disabled()"
      :active="btn.active ? btn.active() : false"
      :vertical="props.dir === 'v'"
      @click="onBtnClick(btn.key, btn)"
    />
  </div>
</template>

<style lang="less" scoped>
.mm-toolbar-node-btns {
  display: flex;
  gap: 20px;

  &.is-v {
    flex-direction: column;
    gap: 10px;
    width: 120px;
  }
}
</style>
