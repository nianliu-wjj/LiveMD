<script setup lang="ts">
/**
 * 小地图（对应参考项目 Navigator.vue，基于引擎 MiniMap 插件）
 *
 * - 监听总线 toggle_mini_map(show)（底部栏派发）显示 / 隐藏；
 * - 数据或视图变化（data_change、view_data_change、node_tree_render_end）后防抖 500ms 重绘缩略图；
 * - 在小地图上拖动平移画布，拖动红色视口框定位（插件计算，视口框移动时派发 mini_map_view_box_position_change）。
 * 与参考项目的差异：容器宽度按编辑器根元素宽度计算（参考项目按窗口宽度），挂载时立即计算一次。
 */
import { nextTick, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { useBusEvent, useMindMapContext } from "../context";
import { getEditorRootSize } from "./helpers";

const { mindMap } = useMindMapContext();
/** 引擎实例（卸载时根组件可能已把 mindMap 置空，解绑要用挂载时的实例） */
const instance = mindMap.value;

const navigatorBox = ref<HTMLElement | null>(null);
const showMiniMap = ref(false);
/** 小地图容器宽度（高度固定 220px，见样式） */
const width = ref(0);
let boxWidth = 0;
let boxHeight = 0;
/** 缩略图的缩放与偏移 */
const svgBoxScale = ref(1);
const svgBoxLeft = ref(0);
const svgBoxTop = ref(0);
/** 视口框位置（插件返回带 px 的字符串） */
const viewBoxStyle = reactive<Record<"left" | "top" | "right" | "bottom", string | number>>({
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
});
/** 缩略图（svg data URL） */
const mindMapImg = ref("");
/** 视口框位移动画（拖动视口框时关闭，避免跟手迟滞） */
const withTransition = ref(true);

let drawTimer: ReturnType<typeof setTimeout> | null = null;
let setSizeTimer: ReturnType<typeof setTimeout> | null = null;
/** 绘制序号：缩略图异步生成，只采用最后一次绘制的结果 */
let drawSeq = 0;

/** 切换显示小地图 */
function toggleMiniMap(show: boolean): void {
  showMiniMap.value = Boolean(show);
  console.info("[MindMap/Navigator] 小地图:", showMiniMap.value ? "显示" : "隐藏");
  void nextTick(() => {
    if (!navigatorBox.value) return;
    init();
    drawMiniMap();
  });
}

/** 思维导图数据或视图改变：防抖更新小地图 */
function onDataChange(): void {
  if (!showMiniMap.value) return;
  if (drawTimer) clearTimeout(drawTimer);
  drawTimer = setTimeout(() => {
    drawTimer = null;
    drawMiniMap();
  }, 500);
}

/** 计算容器宽度：不超过 370px，并给两侧留出 80px */
function computeWidth(): void {
  width.value = Math.max(0, Math.min(getEditorRootSize(instance?.el).width - 80, 370));
}

/** 窗口尺寸变化：防抖重新计算宽度并重绘 */
function setSize(): void {
  if (setSizeTimer) clearTimeout(setSizeTimer);
  setSizeTimer = setTimeout(() => {
    setSizeTimer = null;
    computeWidth();
    void nextTick(() => {
      if (!showMiniMap.value || !navigatorBox.value) return;
      init();
      drawMiniMap();
    });
  }, 300);
}

/** 读取容器实际宽高 */
function init(): void {
  if (!navigatorBox.value) return;
  const rect = navigatorBox.value.getBoundingClientRect();
  boxWidth = rect.width;
  boxHeight = rect.height;
}

/** 渲染小地图 */
function drawMiniMap(): void {
  const miniMap = mindMap.value?.miniMap;
  if (!miniMap || !showMiniMap.value || boxWidth <= 0 || boxHeight <= 0) return;
  try {
    const result = miniMap.calculationMiniMap(boxWidth, boxHeight);
    const seq = ++drawSeq;
    result.getImgUrl((img: string) => {
      if (seq === drawSeq) mindMapImg.value = img;
    });
    Object.assign(viewBoxStyle, result.viewBoxStyle);
    svgBoxScale.value = result.miniMapBoxScale;
    svgBoxLeft.value = result.miniMapBoxLeft;
    svgBoxTop.value = result.miniMapBoxTop;
  } catch (error) {
    console.error("[MindMap/Navigator] 小地图渲染失败:", error);
  }
}

/** 小地图鼠标按下：开始拖动平移画布 */
function onMousedown(e: MouseEvent): void {
  mindMap.value?.miniMap?.onMousedown(e);
}

/** 小地图鼠标移动 */
function onMousemove(e: MouseEvent): void {
  mindMap.value?.miniMap?.onMousemove(e);
}

/** 鼠标松开（绑定在 window 上，鼠标移出小地图后松开也能结束拖动） */
function onMouseup(e: MouseEvent): void {
  if (!withTransition.value) withTransition.value = true;
  mindMap.value?.miniMap?.onMouseup(e);
}

/** 视口框鼠标按下 */
function onViewBoxMousedown(e: MouseEvent): void {
  mindMap.value?.miniMap?.onViewBoxMousedown(e);
}

/** 视口框鼠标移动 */
function onViewBoxMousemove(e: MouseEvent): void {
  mindMap.value?.miniMap?.onViewBoxMousemove(e);
}

/** 拖动视口框时插件派发的新位置 */
function onViewBoxPositionChange(pos: {
  left: string;
  right: string;
  top: string;
  bottom: string;
}): void {
  withTransition.value = false;
  Object.assign(viewBoxStyle, pos);
}

useBusEvent("toggle_mini_map", toggleMiniMap);
useBusEvent("data_change", onDataChange);
useBusEvent("view_data_change", onDataChange);
useBusEvent("node_tree_render_end", onDataChange);
useBusEvent("mini_map_view_box_position_change", onViewBoxPositionChange);

onMounted(() => {
  computeWidth();
  window.addEventListener("resize", setSize);
  window.addEventListener("mouseup", onMouseup);
});

onBeforeUnmount(() => {
  if (drawTimer) clearTimeout(drawTimer);
  if (setSizeTimer) clearTimeout(setSizeTimer);
  window.removeEventListener("resize", setSize);
  window.removeEventListener("mouseup", onMouseup);
});
</script>

<template>
  <div
    v-if="showMiniMap"
    ref="navigatorBox"
    class="mm-navigator"
    :style="{ width: width + 'px' }"
    @mousedown="onMousedown"
    @mousemove="onMousemove"
  >
    <div
      class="mm-navigator__svg-box"
      :style="{
        transform: `scale(${svgBoxScale})`,
        left: svgBoxLeft + 'px',
        top: svgBoxTop + 'px',
      }"
    >
      <img v-if="mindMapImg" :src="mindMapImg" alt="" @mousedown.prevent />
    </div>
    <div
      class="mm-navigator__window"
      :class="{ 'with-transition': withTransition }"
      :style="viewBoxStyle"
      @mousedown.stop="onViewBoxMousedown"
      @mousemove="onViewBoxMousemove"
    />
  </div>
</template>

<style lang="less" scoped>
.mm-navigator {
  position: absolute;
  right: 70px;
  bottom: 80px;
  z-index: 1000;
  height: 220px;
  overflow: hidden;
  border: 1px solid var(--border-color-1, #eee);
  border-radius: 4px;
  background-color: var(--background-color-1, #fff);
  box-shadow: 0 0 16px rgba(0, 0, 0, 0.25);
  cursor: pointer;
  user-select: none;
}

.mm-navigator__svg-box {
  position: absolute;
  left: 0;
  transform-origin: left top;

  img {
    display: block;
    max-width: none;
    pointer-events: none;
  }
}

.mm-navigator__window {
  position: absolute;
  border: 2px solid rgb(238, 69, 69);
  background-color: rgba(238, 69, 69, 0.2);

  &.with-transition {
    transition: all 0.3s;
  }
}
</style>
