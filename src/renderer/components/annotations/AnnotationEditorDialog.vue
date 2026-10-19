<script setup lang="ts">
/**
 * 批注输入对话框（独立悬浮，内嵌完整 LivemdEditor 即时渲染）
 *
 * - 两个入口：右键新建（annotation:request-create，content 为空）/ 卡片"编辑"
 *   （annotation:open-editor，回显 entry.content）
 * - 取消语义二分（§8.2）：打开时记录 previouslySaved = (entry.state === "done")；
 *   已保存批注取消 = 回滚状态 + 内容不动；未保存批注取消 = 整条删除
 * - 实例生命周期与对话框严格同步：open() 里 createLivemdEditor，close() 里 destroy()
 *   （§8.3：同一时刻至多一个对话框存活，内存开销可控）
 * - 保存按钮随输入从灰变亮：innerEditor 非响应式，必须经 on("change") 回写 draft ref
 *   （§8.6③，computed 依赖非响应式模块变量不会重算）
 * - 布局三原则（§9.6）：__editor-box 内联单值 height；__editor 普通块级滚动容器；
 *   placeholder 用 top/left 直接偏移
 */
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import AppIcon from "@/renderer/components/ui/AppIcon.vue";
import emitter from "@/renderer/events";
import useAnnotations from "@/renderer/hooks/useAnnotations";
import type { AnnotationEntry } from "@/shared/utils/annotations";
import { createLivemdEditor, type LivemdEditor as LivemdEditorInstance } from "@/core";

const DIALOG_WIDTH = 380;
const HEIGHT_MIN = 160;
const HEIGHT_MAX = 480;
const HEIGHT_DEFAULT = 240;
const HEIGHT_STORAGE_KEY = "livemd-annotation-dialog-height";

// 位置估算用（nextTick 后用真实 offsetHeight 重新夹紧，估算只需防跳变方向正确）
const HEADER_ESTIMATE = 44;
const FOOTER_ESTIMATE = 54;

const {
  annotationMap,
  currentDocKey,
  setBarVisible,
  setActiveAnnotation,
  updateEntry,
  removeEntries,
} = useAnnotations();

const visible = ref(false);
const currentId = ref<string | null>(null);
/** 对话框打开期间批注所属的文档 key（切文档收尾时按该 key 处理，不能用已变化的 currentDocKey） */
let openDocKey = "";
const anchorText = ref("");
const draft = ref("");
const previouslySaved = ref(false);

const left = ref(12);
const top = ref(120);
const height = ref(readStoredHeight());

const innerContainerRef = ref<HTMLElement | null>(null);
const dialogRef = ref<HTMLElement | null>(null);
let innerEditor: LivemdEditorInstance | null = null;
/** 打开令牌：过期续段检测（见 openDialog） */
let openToken = 0;

const canCommit = computed(() => draft.value.trim().length > 0);

// ============ 打开 / 关闭 ============

interface DialogOpenParams {
  id: string;
  docKey: string;
  x: number;
  y: number;
  content: string;
  anchorText: string;
}

async function openDialog(params: DialogOpenParams): Promise<void> {
  // 先按取消语义收尾上一条（§8.2：不留"隐形 editing 态"残留）
  if (visible.value) {
    closeByCancel();
  }

  // 打开令牌：await nextTick 期间若被新的打开/关闭取代，过期续段直接放弃，
  // 防止旧内容编辑器实例残留在容器里
  const token = ++openToken;

  currentId.value = params.id;
  openDocKey = params.docKey;
  anchorText.value = params.anchorText;
  draft.value = params.content;
  previouslySaved.value = findEntry(params.docKey, params.id)?.state === "done";

  applyPosition(params.x, params.y);
  visible.value = true;

  await nextTick();
  if (token !== openToken || !visible.value) return;
  createInnerEditor(params.content);
  clampToViewport();
  armOutsideClose();
}

function close(): void {
  openToken += 1;
  visible.value = false;
  currentId.value = null;
  openDocKey = "";
  draft.value = "";
  anchorText.value = "";
  previouslySaved.value = false;
  if (innerEditor) {
    innerEditor.destroy();
    innerEditor = null;
  }
  disarmOutsideClose();
}

/**
 * 取消语义二分（§8.2 逐字实现）：
 * 已保存 → updateEntry({state:"done"}) 回滚 + emit commit（内容不动，装饰恢复常规高亮）；
 * 未保存 → emit cancel（整条删除）。store 清理按 id 幂等，这里直接清理是
 * "编辑器守卫未命中"场景的兜底（§7.2：重复无害，不需要来源标记）。
 */
function closeByCancel(): void {
  const id = currentId.value;
  const docKey = openDocKey;
  if (id && docKey) {
    if (previouslySaved.value) {
      updateEntry(docKey, id, { state: "done" });
      emitter.emit("editor:annotation-commit", { id });
    } else {
      removeEntries(docKey, [id]);
      emitter.emit("editor:annotation-cancel", { id });
    }
  }
  close();
}

// ============ 提交 ============

function handleCommit(): void {
  const id = currentId.value;
  const docKey = openDocKey;
  if (!id || !docKey || !canCommit.value) return;

  // 双通道顺序"先 store 后编辑器"：持久化是唯一事实来源（§7.8）
  updateEntry(docKey, id, { content: draft.value, state: "done" });
  emitter.emit("editor:annotation-commit", { id });

  // 提交后卡片入列：展开批注栏（带互斥协议）并激活新卡片
  setBarVisible(true);
  emitter.emit("outline:hide-bar");
  emitter.emit("bookmarks:hide-bar");
  setActiveAnnotation(id);

  close();
}

// ============ 内嵌编辑器 ============

function createInnerEditor(content: string): void {
  const container = innerContainerRef.value;
  if (!container) return;

  // pasteConfig 缺省：粘贴插件有默认兜底（§8.3）
  innerEditor = createLivemdEditor(container, {
    content,
    placeholder: "输入批注内容，支持 Markdown",
  });

  // change → draft ref：canCommit 链路全程响应式（§8.6③）
  innerEditor.on("change", ({ markdown }: { markdown: string }) => {
    draft.value = markdown;
  });

  // 光标置于文档末尾后聚焦（§8.3）
  innerEditor.setCursorOffset(innerEditor.getDoc().content.size);
  innerEditor.focus();
}

function findEntry(docKey: string, id: string): AnnotationEntry | undefined {
  return (annotationMap.value[docKey] ?? []).find((entry) => entry.id === id);
}

// ============ 位置（§8.3 定位公式）============

function applyPosition(x: number, y: number): void {
  // x 取选区右缘（coordsAtPos().right ?? left + 20），y 取选区垂直中点（桥接层 selectionScreenPoint）
  const rawLeft = x + 12;
  const maxLeft = window.innerWidth - DIALOG_WIDTH - 12;
  left.value =
    rawLeft > maxLeft
      ? Math.max(12, Math.min(x - DIALOG_WIDTH - 12, maxLeft)) // 右侧空间不足 → 翻到选区左侧
      : Math.max(12, rawLeft);
  top.value = Math.max(40, Math.min(y - 32, window.innerHeight - estimateHeight() - 12));
}

function estimateHeight(): number {
  return HEADER_ESTIMATE + height.value + FOOTER_ESTIMATE;
}

/** 打开后用真实 offsetHeight 重新夹紧（估算值只防首帧越界） */
function clampToViewport(): void {
  const el = dialogRef.value;
  if (!el) return;
  const totalHeight = el.offsetHeight;
  top.value = Math.max(40, Math.min(top.value, window.innerHeight - totalHeight - 12));
  left.value = Math.max(12, Math.min(left.value, window.innerWidth - el.offsetWidth - 12));
}

// ============ 头部拖动（§8.7④）============

let dragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragStartLeft = 0;
let dragStartTop = 0;

function startHeaderDrag(event: PointerEvent): void {
  if (event.button !== 0) return;
  // 事件委托排除关闭按钮
  const target = event.target as HTMLElement | null;
  if (target?.closest("button")) return;
  event.preventDefault();
  dragging = true;
  dragStartX = event.clientX;
  dragStartY = event.clientY;
  dragStartLeft = left.value;
  dragStartTop = top.value;
  window.addEventListener("pointermove", moveHeaderDrag);
  window.addEventListener("pointerup", finishHeaderDrag);
  window.addEventListener("pointercancel", finishHeaderDrag);
}

function moveHeaderDrag(event: PointerEvent): void {
  if (!dragging) return;
  event.preventDefault();
  const el = dialogRef.value;
  const width = el?.offsetWidth ?? DIALOG_WIDTH;
  const totalHeight = el?.offsetHeight ?? estimateHeight();
  left.value = Math.min(
    Math.max(0, dragStartLeft + event.clientX - dragStartX),
    Math.max(0, window.innerWidth - width)
  );
  top.value = Math.min(
    Math.max(40, dragStartTop + event.clientY - dragStartY),
    Math.max(40, window.innerHeight - totalHeight)
  );
}

function finishHeaderDrag(): void {
  if (!dragging) return;
  dragging = false;
  window.removeEventListener("pointermove", moveHeaderDrag);
  window.removeEventListener("pointerup", finishHeaderDrag);
  window.removeEventListener("pointercancel", finishHeaderDrag);
}

// ============ 高度把手（160–480，livemd-annotation-dialog-height 持久化）============

let heightResizing = false;
let heightStartY = 0;
let heightStartValue = 0;

function startHeightResize(event: PointerEvent): void {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  heightResizing = true;
  heightStartY = event.clientY;
  heightStartValue = height.value;
  window.addEventListener("pointermove", moveHeightResize);
  window.addEventListener("pointerup", finishHeightResize);
  window.addEventListener("pointercancel", finishHeightResize);
}

function moveHeightResize(event: PointerEvent): void {
  if (!heightResizing) return;
  event.preventDefault();
  height.value = Math.min(
    HEIGHT_MAX,
    Math.max(HEIGHT_MIN, heightStartValue + (event.clientY - heightStartY))
  );
}

function finishHeightResize(): void {
  if (!heightResizing) return;
  heightResizing = false;
  window.removeEventListener("pointermove", moveHeightResize);
  window.removeEventListener("pointerup", finishHeightResize);
  window.removeEventListener("pointercancel", finishHeightResize);
  try {
    localStorage.setItem(HEIGHT_STORAGE_KEY, String(height.value));
  } catch {
    // localStorage 不可用时仅保留内存状态
  }
}

function readStoredHeight(): number {
  try {
    const raw = localStorage.getItem(HEIGHT_STORAGE_KEY);
    const parsed = raw ? Number(raw) : NaN;
    if (Number.isFinite(parsed)) {
      return Math.min(HEIGHT_MAX, Math.max(HEIGHT_MIN, parsed));
    }
  } catch {
    // 忽略持久化读取失败
  }
  return HEIGHT_DEFAULT;
}

// ============ 外点关闭 + Esc 关闭 ============

function handleOutsidePointerDown(event: PointerEvent): void {
  const target = event.target as HTMLElement | null;
  if (!target) return;
  if (dialogRef.value?.contains(target)) return;
  closeByCancel();
}

function handleDialogKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  event.stopPropagation();
  closeByCancel();
}

function armOutsideClose(): void {
  document.addEventListener("pointerdown", handleOutsidePointerDown, true);
  window.addEventListener("keydown", handleDialogKeydown, true);
}

function disarmOutsideClose(): void {
  document.removeEventListener("pointerdown", handleOutsidePointerDown, true);
  window.removeEventListener("keydown", handleDialogKeydown, true);
}

// ============ 事件订阅 ============

function handleRequestCreate(payload?: {
  id?: string;
  anchorText?: string;
  docKey?: string;
  x?: number;
  y?: number;
}): void {
  if (
    !payload?.id ||
    !payload.docKey ||
    typeof payload.x !== "number" ||
    typeof payload.y !== "number"
  ) {
    return;
  }
  void openDialog({
    id: payload.id,
    docKey: payload.docKey,
    x: payload.x,
    y: payload.y,
    content: "",
    anchorText: payload.anchorText ?? "",
  });
}

function handleOpenEditor(payload?: {
  id?: string;
  docKey?: string;
  x?: number;
  y?: number;
}): void {
  if (
    !payload?.id ||
    !payload.docKey ||
    typeof payload.x !== "number" ||
    typeof payload.y !== "number"
  ) {
    return;
  }
  const entry = findEntry(payload.docKey, payload.id);
  void openDialog({
    id: payload.id,
    docKey: payload.docKey,
    x: payload.x,
    y: payload.y,
    content: entry?.content ?? "",
    anchorText: entry?.anchor.anchorText ?? "",
  });
}

emitter.on("annotation:request-create", handleRequestCreate);
emitter.on("annotation:open-editor", handleOpenEditor);

/**
 * 对话框开着切文档 → 按取消语义收尾（§8.2）。
 * flush: "sync" 是正确性的关键：在 tab 切换的响应式传播里，
 * currentDocKey 变化时旧编辑器的 isActive prop 尚未更新，
 * closeByCancel 发出的 commit/cancel 事件才能命中旧编辑器的桥接处理器。
 */
watch(
  currentDocKey,
  (docKey) => {
    if (!visible.value || !openDocKey) return;
    if (docKey !== openDocKey) {
      closeByCancel();
    }
  },
  { flush: "sync" }
);

onUnmounted(() => {
  emitter.off("annotation:request-create", handleRequestCreate);
  emitter.off("annotation:open-editor", handleOpenEditor);
  disarmOutsideClose();
  finishHeaderDrag();
  finishHeightResize();
  if (innerEditor) {
    innerEditor.destroy();
    innerEditor = null;
  }
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="dialogRef"
      class="annotation-editor-dialog"
      :style="{ left: `${left}px`, top: `${top}px` }"
    >
      <div class="annotation-editor-dialog__header" @pointerdown="startHeaderDrag">
        <span class="annotation-editor-dialog__anchor" :title="anchorText">
          {{ anchorText || "批注" }}
        </span>
        <button
          type="button"
          class="annotation-editor-dialog__close"
          title="关闭"
          @click="closeByCancel"
        >
          <AppIcon name="close" />
        </button>
      </div>

      <!-- §9.6 原则 1：高度唯一权威 = __editor-box 的内联单值 height -->
      <div class="annotation-editor-dialog__editor-box" :style="{ height: `${height}px` }">
        <div ref="innerContainerRef" class="annotation-editor-dialog__editor" />
      </div>

      <div class="annotation-editor-dialog__footer">
        <button type="button" class="annotation-editor-dialog__cancel" @click="closeByCancel">
          取消
        </button>
        <button
          type="button"
          class="annotation-editor-dialog__commit"
          :disabled="!canCommit"
          @click="handleCommit"
        >
          评论
        </button>
      </div>

      <!-- 右下角高度把手：拖拽调整编辑区高度 -->
      <div class="annotation-editor-dialog__height-handle" @pointerdown="startHeightResize" />
    </div>
  </Teleport>
</template>

<style lang="less" scoped>
.annotation-editor-dialog {
  --annotation-padding: 14px;
  position: fixed;
  z-index: 80;
  width: 380px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-color-1, #e7eaed);
  border-radius: 10px;
  background: var(--background-color-1, #fff);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);

  &__header {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px 8px 14px;
    border-bottom: 1px solid var(--border-color-1, #e7eaed);
    cursor: grab;
    touch-action: none; // 防浏览器接管手势（§8.7④）
    user-select: none;

    &:active {
      cursor: grabbing;
    }
  }

  &__anchor {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 500;
    color: color-mix(in srgb, var(--annotation-color, #f5a623) 72%, var(--text-color-1, #333));
  }

  &__close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text-color-3, #999);
    cursor: pointer;
    font-size: 14px;

    &:hover {
      background: var(--hover-color, rgba(0, 0, 0, 0.06));
      color: var(--text-color-1, #333);
    }
  }

  // §9.6 原则 1：height 由内联样式声明（拖拽把手设置 160–480），唯一高度权威
  &__editor-box {
    position: relative;
    display: flex;
    flex-direction: column;
  }

  // §9.6 原则 2：普通块级滚动容器——刻意不做 flex 容器
  //（.livemd-editor 若成 flex 子项，核心样式的 min-height:100% 会覆盖
  //  min-height:auto 把盒子锁死，内容溢出白背景断层）
  &__editor {
    flex: 1; // 拉伸占满设置高度（空态也占满）
    min-height: 0; // 允许在截断下收缩（滚动容器前提）
    overflow-y: auto; // 滚动由本层承担
    scrollbar-width: thin;
  }

  &__footer {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 12px;
    border-top: 1px solid var(--border-color-1, #e7eaed);
  }

  &__cancel {
    height: 28px;
    padding: 0 14px;
    border: 1px solid var(--border-color-1, #e7eaed);
    border-radius: 6px;
    background: transparent;
    color: var(--text-color-2, #555);
    font-size: 12px;
    cursor: pointer;

    &:hover {
      background: var(--hover-color, rgba(0, 0, 0, 0.06));
      color: var(--text-color-1, #333);
    }
  }

  &__commit {
    height: 28px;
    padding: 0 14px;
    border: none;
    border-radius: 6px;
    background: var(--primary-color, #3b82f6);
    color: #fff;
    font-size: 12px;
    cursor: pointer;

    &:hover:not(:disabled) {
      opacity: 0.9;
    }

    &:disabled {
      opacity: 0.45;
      cursor: default;
    }
  }

  &__height-handle {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 14px;
    height: 14px;
    cursor: nwse-resize;
    touch-action: none;
    z-index: 2;

    // 斜线纹样标识可拖拽
    &::after {
      content: "";
      position: absolute;
      right: 3px;
      bottom: 3px;
      width: 6px;
      height: 6px;
      border-right: 2px solid var(--text-color-3, #999);
      border-bottom: 2px solid var(--text-color-3, #999);
      border-bottom-right-radius: 2px;
      opacity: 0.6;
    }

    &:hover::after {
      opacity: 1;
    }
  }

  // 内嵌编辑器：内边距统一走 --annotation-padding（§8.6②，与占位符上下文一致）
  :deep(.livemd-editor) {
    padding: var(--annotation-padding);
  }

  // §9.6 原则 3：占位符用 top/left 直接偏移——::before 的 padding 定位与
  // 段落缩进 --livemd-paragraph-indent 语义不同源（绝对定位 padding 相对
  // 包含块 padding box），必差一字
  :deep(.livemd-editor.livemd-empty::before) {
    padding: 0 !important;
    top: var(--annotation-padding);
    left: calc(var(--annotation-padding) + var(--livemd-paragraph-indent));
    font-size: inherit;
  }
}
</style>
