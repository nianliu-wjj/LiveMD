<script setup lang="ts">
/**
 * 节点备注悬浮展示（移植自参考项目 NodeNoteContentShow.vue）
 *
 * 根组件把引擎 customNoteContentShow.show 回调转成总线事件 showNoteContent(content, left, top, node)
 * （坐标为窗口坐标，即备注图标左下角）。这里渲染备注 Markdown（NoteMarkdownView），并按参考项目规则定位：
 * 超出画布右 / 下边界时向内收。参考项目把浮层挂进画布容器、position: fixed；这里按约定放在编辑器根元素内
 * 绝对定位，坐标换算到根元素。
 *
 * 隐藏时机与参考项目一致：点击页面其它位置、画布按下、展开收起按钮、激活其它节点；缩放 / 平移时跟随图标。
 * 参考项目的 customNoteContentShow.hide 不派发 hideNoteContent（鼠标可以移进浮层滚动、点链接）；
 * 若根组件改为派发，这里延迟隐藏，鼠标移入浮层时保持显示、移出后再隐藏。
 */
import { onBeforeUnmount, onMounted, reactive, ref } from "vue";
import type { MindMapNodeInstance } from "@/core/mindmap-engine/full";
import { useBusEvent, useMindMapContext } from "../context";
import NoteMarkdownView from "./NoteMarkdownView.vue";
import { getEditorRect } from "./nodeContentUtils";

/** 收到 hideNoteContent 后延迟多久隐藏（留时间让鼠标从图标移进浮层） */
const HIDE_DELAY = 300;

const { mindMap } = useMindMapContext();

const boxRef = ref<HTMLElement | null>(null);
const visible = ref(false);
const content = ref("");
const position = reactive({ left: 0, top: 0 });
let node: MindMapNodeInstance | null = null;
/** 等待渲染完成后显示的位置（窗口坐标） */
let pendingPosition: { left: number; top: number } | null = null;
/** NoteMarkdownView 最近一次渲染完成的内容 */
let renderedContent: string | null = null;
let hideTimer = 0;
let isHovering = false;
/** 鼠标在浮层内时收到了隐藏请求：移出后再隐藏 */
let hideOnLeave = false;

/** 显示备注浮层（对应参考项目 onShowNoteContent） */
function onShowNoteContent(
  noteContent: string,
  left: number,
  top: number,
  target: MindMapNodeInstance
): void {
  cancelPendingHide();
  node = target;
  pendingPosition = { left, top };
  if (content.value === noteContent && renderedContent === noteContent) {
    placeAndShow();
  } else {
    // 等 NoteMarkdownView 渲染完（rendered 事件）再测量尺寸定位；
    // 内容相同但上一次渲染尚未完成时不必重设，渲染完成同样会触发 rendered
    content.value = noteContent;
  }
}

function onRendered(markdown: string): void {
  renderedContent = markdown;
  if (pendingPosition && markdown === content.value) placeAndShow();
}

function placeAndShow(): void {
  const target = pendingPosition;
  pendingPosition = null;
  if (!target) return;
  updatePosition(target.left, target.top);
  visible.value = true;
}

/** 更新位置（对应参考项目 updateNoteContentPosition）：超出画布右 / 下边界时向内收 */
function updatePosition(left: number, top: number): void {
  const box = boxRef.value;
  const engine = mindMap.value;
  if (!box || !engine) return;
  const container = getEditorRect(box);
  const canvas = engine.el.getBoundingClientRect();
  const width = box.offsetWidth;
  const height = box.offsetHeight;
  const clientLeft = left + width > canvas.right ? canvas.right - width : left;
  const clientTop = top + height > canvas.bottom ? canvas.bottom - height : top;
  position.left = clientLeft - container.left;
  position.top = clientTop - container.top;
}

/** 画布缩放 / 平移时跟随备注图标（对应参考项目 onScale） */
function onViewChange(): void {
  if (!node || !visible.value) return;
  try {
    const { left, top } = node.getNoteContentPosition();
    updatePosition(left, top);
  } catch (error) {
    // 备注已被删除或节点未渲染时取不到图标位置
    console.debug("[MindMap/NodeNoteContentShow] 获取备注图标位置失败，隐藏浮层:", error);
    hideNoteContent();
  }
}

/** 隐藏备注浮层（对应参考项目 hideNoteContent） */
function hideNoteContent(): void {
  cancelPendingHide();
  pendingPosition = null;
  hideOnLeave = false;
  visible.value = false;
}

function cancelPendingHide(): void {
  window.clearTimeout(hideTimer);
  hideTimer = 0;
}

/** 总线 hideNoteContent：延迟隐藏，鼠标停在浮层内时推迟到移出 */
function requestHide(): void {
  cancelPendingHide();
  hideTimer = window.setTimeout(() => {
    hideTimer = 0;
    if (isHovering) hideOnLeave = true;
    else hideNoteContent();
  }, HIDE_DELAY);
}

function onMouseEnter(): void {
  isHovering = true;
  cancelPendingHide();
}

function onMouseLeave(): void {
  isHovering = false;
  if (hideOnLeave) requestHide();
}

/** 激活了其它节点或取消激活时隐藏（对应参考项目 onNodeActive） */
function onNodeActive(_node: unknown, list: MindMapNodeInstance[] = []): void {
  if (list.length <= 0 || list[0] !== node) hideNoteContent();
}

useBusEvent("showNoteContent", onShowNoteContent);
useBusEvent("hideNoteContent", requestHide);
useBusEvent("node_active", onNodeActive);
useBusEvent("scale", onViewChange);
useBusEvent("translate", onViewChange);
useBusEvent("svg_mousedown", hideNoteContent);
useBusEvent("expand_btn_click", hideNoteContent);

// 点击页面其它位置隐藏（浮层自身的点击已 stop，不会触发）
onMounted(() => document.addEventListener("click", hideNoteContent));
onBeforeUnmount(() => {
  document.removeEventListener("click", hideNoteContent);
  cancelPendingHide();
});
</script>

<template>
  <!-- 始终渲染、用 visibility 控制显示：隐藏状态下也能测量尺寸，用于定位 -->
  <div
    ref="boxRef"
    class="node-note-content"
    :class="{ 'is-visible': visible }"
    :style="{ left: `${position.left}px`, top: `${position.top}px` }"
    @click.stop
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
  >
    <div class="node-note-content__wrap">
      <NoteMarkdownView :markdown="content" @rendered="onRendered" />
    </div>
  </div>
</template>

<style lang="less" scoped>
.node-note-content {
  position: absolute;
  z-index: 1500;
  padding: 10px;
  border: 1px solid var(--border-color-1, rgba(0, 0, 0, 0.06));
  border-radius: 5px;
  background: var(--background-color-1, #fff);
  box-shadow: 0 2px 16px 0 rgba(0, 0, 0, 0.12);
  visibility: hidden;
  pointer-events: none;

  &.is-visible {
    visibility: visible;
    pointer-events: auto;
  }
}

.node-note-content__wrap {
  max-width: 250px;
  max-height: 300px;
  overflow-y: auto;
}
</style>
