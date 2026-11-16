<script setup lang="ts">
/**
 * 节点图片位置浮动工具条（对应参考项目 NodeImgPlacementToolbar.vue）
 *
 * 点击节点图片（引擎 node_img_click）时显示在图片正上方，提供图片在文字上 / 下 / 左 / 右四种布局，
 * 选择后 setStyle('imgPlacement')（走 SET_NODE_STYLE 命令，可撤销）并关闭。
 * 关闭时机与参考项目一致：点击画布、画布 mousedown / 平移、双击节点、激活其它节点、
 * 按下图片调整按钮、通过删除按钮删除图片；画布缩放时跟随图片重新定位。
 *
 * 与参考项目的差异：
 * - 参考项目把工具条移到 document.body 并用 position: fixed；这里按移植约定留在编辑器根元素内
 *   （position: absolute，层级 1500），坐标换算为相对定位父元素（编辑器根元素）；
 * - 只读模式下不显示（引擎只读时命令仍会执行，避免在只读状态改数据），切到只读时自动关闭。
 */
import { nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import type { MindMapNodeInstance } from "@/core/mindmap-engine/full";
import { useBusEvent, useMindMapContext } from "../context";

type ImgPlacement = "top" | "bottom" | "left" | "right";

/** 引擎图片元素（SVG.js Image，只用到其 DOM 节点） */
interface SvgImageElement {
  node: Element;
}

/** 布局选项：图标为同一个「图片在左」图标按方向旋转 */
const PLACEMENT_LIST: { value: ImgPlacement; title: string }[] = [
  { value: "top", title: "上" },
  { value: "bottom", title: "下" },
  { value: "left", title: "左" },
  { value: "right", title: "右" },
];

const { mindMap, isReadonly } = useMindMapContext();
/** 引擎实例：setup 时已就绪；根组件卸载时会先把上下文里的引用置空，解绑监听用这里保存的实例 */
const instance = mindMap.value;

const toolbarRef = ref<HTMLElement | null>(null);
const visible = ref(false);
const position = reactive({ left: 0, top: 0 });
/** 当前图片布局（高亮用） */
const imgPlacement = ref("");
/** 当前图片所属节点与图片元素（引擎对象，不放进响应式） */
let currentNode: MindMapNodeInstance | null = null;
let currentImgNode: SvgImageElement | null = null;

/** 点击节点图片：显示工具条（对应参考项目 show） */
function show(node: MindMapNodeInstance, imgNode: SvgImageElement): void {
  if (isReadonly.value) {
    console.debug("[MindMap/NodeImgPlacementToolbar] 只读模式，不显示图片位置工具条");
    return;
  }
  currentNode = node;
  currentImgNode = imgNode;
  imgPlacement.value = node.getStyle("imgPlacement");
  visible.value = true;
  console.debug(
    "[MindMap/NodeImgPlacementToolbar] 显示图片位置工具条，当前布局:",
    imgPlacement.value
  );
  // 等工具条渲染出来后才能量到自身尺寸
  void nextTick(updatePos);
}

/** 关闭并清空状态（对应参考项目 close） */
function close(): void {
  if (!visible.value && !currentNode) return;
  visible.value = false;
  currentNode = null;
  currentImgNode = null;
  imgPlacement.value = "";
  position.left = 0;
  position.top = 0;
}

/** 把工具条放到图片正上方（图片的视口坐标换算为相对定位父元素的坐标） */
function updatePos(): void {
  const el = toolbarRef.value;
  if (!el || !currentImgNode || !visible.value) return;
  const { width, height } = el.getBoundingClientRect();
  const imgRect = currentImgNode.node.getBoundingClientRect();
  const parentRect = (el.offsetParent as HTMLElement | null)?.getBoundingClientRect();
  position.left = imgRect.left + imgRect.width / 2 - width / 2 - (parentRect?.left ?? 0);
  position.top = imgRect.top - height - 5 - (parentRect?.top ?? 0);
}

/** 激活了其它节点时关闭（点击图片本身也会激活所属节点，此时保持显示） */
function onNodeActive(node: MindMapNodeInstance | null): void {
  if (node === currentNode) return;
  close();
}

/** 选择布局：修改节点样式后关闭（对应参考项目 updateImgPlacement） */
function updateImgPlacement(placement: ImgPlacement): void {
  const node = currentNode;
  if (!node) return;
  if (isReadonly.value) {
    close();
    return;
  }
  imgPlacement.value = placement;
  console.info("[MindMap/NodeImgPlacementToolbar] 修改图片布局:", placement);
  node.setStyle("imgPlacement", placement);
  close();
}

// 根组件已转发到总线的引擎事件
useBusEvent("draw_click", close);
useBusEvent("svg_mousedown", close);
useBusEvent("translate", close);
useBusEvent("scale", updatePos);
useBusEvent("node_active", onNodeActive);

// 未转发的引擎事件直接监听，卸载时解绑
const ENGINE_CLOSE_EVENTS = [
  "node_dblclick",
  "node_img_adjust_btn_mousedown",
  "delete_node_img_from_delete_btn",
];
instance?.on("node_img_click", show);
ENGINE_CLOSE_EVENTS.forEach((event) => instance?.on(event, close));

watch(isReadonly, (readonly) => {
  if (readonly) close();
});

onBeforeUnmount(() => {
  instance?.off("node_img_click", show);
  ENGINE_CLOSE_EVENTS.forEach((event) => instance?.off(event, close));
});
</script>

<template>
  <div
    v-show="visible"
    ref="toolbarRef"
    class="node-img-placement-toolbar"
    :style="{ left: `${position.left}px`, top: `${position.top}px` }"
    @click.stop
  >
    <div
      v-for="item in PLACEMENT_LIST"
      :key="item.value"
      class="node-img-placement-toolbar__item mm-iconfont iconcontentleft"
      :class="[`is-${item.value}`, { 'is-selected': imgPlacement === item.value }]"
      :title="item.title"
      @click="updateImgPlacement(item.value)"
    />
  </div>
</template>

<style lang="less" scoped>
.node-img-placement-toolbar {
  position: absolute;
  z-index: 1500;
  height: 40px;
  display: flex;
  align-items: center;
  padding: 0 10px;
  border: 1px solid var(--border-color-1, rgba(0, 0, 0, 0.06));
  border-radius: 8px;
  background: var(--background-color-1, #fff);
  color: var(--text-color-1, #333);
  box-shadow: 0 2px 16px 0 rgba(0, 0, 0, 0.06);
}

.node-img-placement-toolbar__item {
  width: 30px;
  height: 30px;
  margin: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  font-size: 20px;
  cursor: pointer;

  &:hover,
  &.is-selected {
    background: var(--hover-background-color, rgb(237, 237, 237));
  }

  &.is-selected {
    color: var(--primary-color, #409eff);
  }

  /* 图标本身是「图片在左」，其它方向旋转得到 */
  &.is-top {
    transform: rotateZ(90deg);
  }

  &.is-bottom {
    transform: rotateZ(-90deg);
  }

  &.is-right {
    transform: rotateZ(180deg);
  }
}
</style>
