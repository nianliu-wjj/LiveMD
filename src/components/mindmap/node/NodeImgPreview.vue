<script setup lang="ts">
/**
 * 节点图片预览（移植自参考项目 NodeImgPreview.vue）
 *
 * 双击节点图片（引擎 node_img_dblclick）时全屏预览。参考项目用 v-viewer（viewerjs），这里不引入依赖，
 * 在编辑器根元素内实现一个简化的查看器，交互对齐 viewerjs 常用功能：
 * - 初始按 90% 可视区域等比缩小（不放大超过原图）；滚轮以鼠标位置为中心缩放；拖动平移；
 * - 底部工具栏：放大、缩小、原始大小、适应窗口、左 / 右旋转、水平 / 垂直翻转；双击图片切换原始大小 / 适应窗口；
 * - 键盘：Esc 关闭，↑ / ↓（或 + / -）缩放，Ctrl+0 适应窗口，Ctrl+1 原始大小；
 * - 点击背景或右上角关闭。打开期间焦点在查看器上，按键不会传到引擎快捷键。
 */
import { computed, nextTick, reactive, ref } from "vue";
import type { MindMapNodeInstance } from "@/core/mindmap-engine/full";
import { useBusEvent } from "../context";
import { clamp } from "./nodeContentUtils";

const MIN_SCALE = 0.05;
const MAX_SCALE = 20;
/** 每次缩放的倍率 */
const ZOOM_STEP = 1.2;
/** 读不到 SVG 等图片的原始尺寸时使用的默认尺寸 */
const FALLBACK_SIZE = 300;

const overlayRef = ref<HTMLElement | null>(null);
const stageRef = ref<HTMLElement | null>(null);
const visible = ref(false);
const src = ref("");
const title = ref("");
const status = ref<"loading" | "loaded" | "error">("loading");
const natural = reactive({ width: 0, height: 0 });
/** 变换状态：缩放比例（1 为原始大小）、旋转角度、翻转、相对舞台中心的平移 */
const view = reactive({ scale: 1, rotate: 0, flipX: 1, flipY: 1, x: 0, y: 0 });
/** 适应窗口时的缩放比例 */
const fitScale = ref(1);
/** 缩放比例提示 */
const zoomTip = ref("");
let zoomTipTimer = 0;
let drag: { pointerId: number; startX: number; startY: number; x: number; y: number } | null = null;

const imageStyle = computed(() => ({
  width: `${natural.width}px`,
  height: `${natural.height}px`,
  transform:
    `translate(calc(-50% + ${view.x}px), calc(-50% + ${view.y}px)) rotate(${view.rotate}deg) ` +
    `scale(${view.scale * view.flipX}, ${view.scale * view.flipY})`,
}));

const caption = computed(() => {
  const size = status.value === "loaded" ? `${natural.width} × ${natural.height}` : "";
  return [title.value, size && `(${size})`].filter(Boolean).join(" ");
});

/** 双击节点图片（引擎事件参数：node, event, svgImage） */
function onNodeImgDblclick(node: MindMapNodeInstance, event?: Event): void {
  // 阻止冒泡到节点，避免同时进入节点文字编辑
  event?.stopPropagation();
  event?.preventDefault();
  const url: string = node.getImageUrl?.() || "";
  if (!url) return;
  open(url, node.getData("imageTitle") || "");
}

function open(url: string, imageTitle: string): void {
  console.info("[MindMap/NodeImgPreview] 预览节点图片:", imageTitle || url.slice(0, 60));
  src.value = url;
  title.value = imageTitle;
  status.value = "loading";
  visible.value = true;
  void nextTick(() => overlayRef.value?.focus());
}

function close(): void {
  visible.value = false;
  src.value = "";
  drag = null;
  window.clearTimeout(zoomTipTimer);
  zoomTip.value = "";
}

function onLoad(event: Event): void {
  const img = event.target as HTMLImageElement;
  natural.width = img.naturalWidth || FALLBACK_SIZE;
  natural.height = img.naturalHeight || FALLBACK_SIZE;
  status.value = "loaded";
  fit(false);
}

function onError(): void {
  console.warn("[MindMap/NodeImgPreview] 图片加载失败");
  status.value = "error";
}

/** 适应窗口：等比缩小到舞台的 90%，小图保持原始大小（与 viewerjs 一致） */
function fit(showTip = true): void {
  const stage = stageRef.value;
  if (!stage || !natural.width || !natural.height) return;
  const { width, height } = stage.getBoundingClientRect();
  fitScale.value = Math.min(1, (width * 0.9) / natural.width, (height * 0.9) / natural.height);
  Object.assign(view, { scale: fitScale.value, rotate: 0, flipX: 1, flipY: 1, x: 0, y: 0 });
  if (showTip) showZoomTip();
}

/**
 * 缩放到指定比例
 * @param origin 缩放中心（相对舞台中心的坐标）；不传时以图片中心缩放
 */
function zoomTo(scale: number, origin?: { x: number; y: number }): void {
  const next = clamp(scale, MIN_SCALE, MAX_SCALE);
  if (origin) {
    // 保持缩放中心下的图片内容不动：p - (p - t) * (s' / s)
    const ratio = next / view.scale;
    view.x = origin.x - (origin.x - view.x) * ratio;
    view.y = origin.y - (origin.y - view.y) * ratio;
  }
  view.scale = next;
  showZoomTip();
}

function zoomBy(factor: number, origin?: { x: number; y: number }): void {
  zoomTo(view.scale * factor, origin);
}

function oneToOne(): void {
  view.x = 0;
  view.y = 0;
  zoomTo(1);
}

/** 双击图片：原始大小与适应窗口之间切换 */
function toggleOneToOne(): void {
  if (Math.abs(view.scale - 1) < 0.001) fit();
  else oneToOne();
}

function rotate(deg: number): void {
  view.rotate += deg;
}

function showZoomTip(): void {
  zoomTip.value = `${Math.round(view.scale * 100)}%`;
  window.clearTimeout(zoomTipTimer);
  zoomTipTimer = window.setTimeout(() => (zoomTip.value = ""), 1000);
}

function onWheel(event: WheelEvent): void {
  if (status.value !== "loaded" || !stageRef.value) return;
  const rect = stageRef.value.getBoundingClientRect();
  const origin = {
    x: event.clientX - (rect.left + rect.width / 2),
    y: event.clientY - (rect.top + rect.height / 2),
  };
  zoomBy(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, origin);
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  event.preventDefault();
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  drag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    x: view.x,
    y: view.y,
  };
}

function onPointerMove(event: PointerEvent): void {
  if (!drag || event.pointerId !== drag.pointerId) return;
  view.x = drag.x + event.clientX - drag.startX;
  view.y = drag.y + event.clientY - drag.startY;
}

function onPointerUp(event: PointerEvent): void {
  if (drag?.pointerId === event.pointerId) drag = null;
}

/** 查看器内的按键一律不再冒泡（避免触发引擎快捷键，如 Delete 删除节点） */
function onKeydown(event: KeyboardEvent): void {
  event.stopPropagation();
  const mod = event.ctrlKey || event.metaKey;
  if (event.key === "Escape") {
    close();
  } else if (mod && event.key === "0") {
    event.preventDefault();
    fit();
  } else if (mod && event.key === "1") {
    event.preventDefault();
    oneToOne();
  } else if (event.key === "ArrowUp" || event.key === "+" || event.key === "=") {
    event.preventDefault();
    zoomBy(ZOOM_STEP);
  } else if (event.key === "ArrowDown" || event.key === "-") {
    event.preventDefault();
    zoomBy(1 / ZOOM_STEP);
  }
}

/** 工具栏按钮（图标为 24×24 描边路径） */
const toolbarActions: ReadonlyArray<{
  title: string;
  paths?: string[];
  text?: string;
  run: () => void;
}> = [
  {
    title: "放大",
    paths: ["M18 11a7 7 0 1 1-14 0a7 7 0 1 1 14 0", "M11 8v6M8 11h6", "M21 21l-5-5"],
    run: () => zoomBy(ZOOM_STEP),
  },
  {
    title: "缩小",
    paths: ["M18 11a7 7 0 1 1-14 0a7 7 0 1 1 14 0", "M8 11h6", "M21 21l-5-5"],
    run: () => zoomBy(1 / ZOOM_STEP),
  },
  { title: "原始大小", text: "1:1", run: oneToOne },
  {
    title: "适应窗口",
    paths: ["M4 9V4h5", "M20 9V4h-5", "M4 15v5h5", "M20 15v5h-5"],
    run: () => fit(),
  },
  { title: "向左旋转", paths: ["M3 12a9 9 0 1 0 3-6.7", "M3 4v5h5"], run: () => rotate(-90) },
  { title: "向右旋转", paths: ["M21 12a9 9 0 1 1-3-6.7", "M21 4v5h-5"], run: () => rotate(90) },
  {
    title: "水平翻转",
    paths: ["M12 3v18", "M9 7l-6 5 6 5z", "M15 7l6 5-6 5z"],
    run: () => (view.flipX *= -1),
  },
  {
    title: "垂直翻转",
    paths: ["M3 12h18", "M7 9l5-6 5 6z", "M7 15l5 6 5-6z"],
    run: () => (view.flipY *= -1),
  },
];

useBusEvent("node_img_dblclick", onNodeImgDblclick);
</script>

<template>
  <div
    v-if="visible"
    ref="overlayRef"
    class="node-img-preview"
    tabindex="-1"
    role="dialog"
    aria-label="图片预览"
    @keydown="onKeydown"
    @wheel.prevent="onWheel"
  >
    <div ref="stageRef" class="node-img-preview__stage" @click.self="close">
      <img
        v-show="status === 'loaded'"
        :src="src"
        class="node-img-preview__img"
        :style="imageStyle"
        alt=""
        draggable="false"
        @load="onLoad"
        @error="onError"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @dblclick="toggleOneToOne"
      />
      <div v-if="status === 'loading'" class="node-img-preview__status">图片加载中…</div>
      <div v-else-if="status === 'error'" class="node-img-preview__status">图片加载失败</div>
      <div v-if="zoomTip" class="node-img-preview__zoom-tip">{{ zoomTip }}</div>
    </div>

    <button type="button" class="node-img-preview__close" title="关闭（Esc）" @click="close">
      ×
    </button>

    <div class="node-img-preview__footer">
      <div v-if="caption" class="node-img-preview__caption">{{ caption }}</div>
      <div v-if="status === 'loaded'" class="node-img-preview__toolbar">
        <button
          v-for="action in toolbarActions"
          :key="action.title"
          type="button"
          class="node-img-preview__tool"
          :title="action.title"
          @click="action.run"
        >
          <svg
            v-if="action.paths"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path v-for="d in action.paths" :key="d" :d="d" />
          </svg>
          <span v-else>{{ action.text }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.node-img-preview {
  position: absolute;
  inset: 0;
  z-index: 3000;
  background: rgba(0, 0, 0, 0.6);
  outline: none;
}

.node-img-preview__stage {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.node-img-preview__img {
  position: absolute;
  left: 50%;
  top: 50%;
  max-width: none;
  transform-origin: center;
  cursor: grab;
  user-select: none;
  touch-action: none;

  &:active {
    cursor: grabbing;
  }
}

.node-img-preview__status {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  color: rgba(255, 255, 255, 0.85);
  font-size: 14px;
  pointer-events: none;
}

.node-img-preview__zoom-tip {
  position: absolute;
  left: 50%;
  top: 50%;
  padding: 4px 10px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 12px;
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.node-img-preview__close {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  font-size: 22px;
  line-height: 36px;
  cursor: pointer;

  &:hover {
    background: rgba(0, 0, 0, 0.8);
  }
}

.node-img-preview__footer {
  position: absolute;
  left: 50%;
  bottom: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  max-width: calc(100% - 40px);
  transform: translateX(-50%);
  pointer-events: none;
}

.node-img-preview__caption {
  max-width: 100%;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.85);
  font-size: 13px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.node-img-preview__toolbar {
  display: flex;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 20px;
  background: rgba(0, 0, 0, 0.5);
  pointer-events: auto;
}

.node-img-preview__tool {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;

  &:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  svg {
    width: 18px;
    height: 18px;
  }
}
</style>
