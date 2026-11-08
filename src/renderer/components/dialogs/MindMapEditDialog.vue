<script setup lang="ts">
/**
 * 思维导图编辑弹窗（自研）
 *
 * - 左侧画布：实时渲染当前思维导图（复用 core/nodeviews/mindmap.ts 的布局与 SVG 渲染），点击节点选中；
 * - 右侧面板：编辑选中节点文本、新增子节点 / 同级节点、上移 / 下移、删除；
 * - 快捷键（焦点不在输入框时）：Tab 新增子节点、Enter 新增同级、Delete/Backspace 删除、
 *   方向键在父子 / 兄弟间移动选择；F2 或双击节点进入文本编辑；
 * - 所有操作作用在数据副本上，点「保存」才通过 onClose 回传序列化后的缩进层级文本，取消不影响原文档。
 *
 * 通过 autodialog.show 打开，props.onClose 由 autodialog 注入。
 */
import { computed, nextTick, onMounted, ref } from "vue";
import { layoutMindMap, renderMindMapLayout } from "@/core/nodeviews/mindmap";
import {
  addChild,
  addSibling,
  cloneMindMap,
  countNodes,
  findNode,
  findParent,
  moveNode,
  parseMindMap,
  removeNode,
  serializeMindMap,
  updateNodeText,
  type MindMapNode,
} from "@/core/utils/mindmap-markdown";

const props = defineProps<{
  /** 打开弹窗时的缩进层级源码 */
  source: string;
  onClose: (result: string | null) => void;
}>();

/** 当前编辑中的树（副本） */
const tree = ref<MindMapNode>(cloneMindMap(parseMindMap(props.source)));
/** 当前选中节点 id */
const selectedId = ref<string>("root");
/** 选中节点的文本（与输入框双向绑定） */
const editingText = ref<string>(tree.value.text);
/** 是否有未保存的修改 */
const dirty = ref(false);
/** 画布缩放比例 */
const zoom = ref(1);

const textInput = ref<HTMLInputElement | null>(null);
const canvasRef = ref<HTMLElement | null>(null);
const dialogRef = ref<HTMLElement | null>(null);

/** 渲染用 SVG：树或选中项变化时重新布局（节点规模通常在百级以内，同步计算无压力） */
const svgMarkup = computed(() =>
  renderMindMapLayout(layoutMindMap(tree.value), {
    selectedId: selectedId.value,
    interactive: true,
  })
);

const nodeCount = computed(() => countNodes(tree.value));
const isRootSelected = computed(() => selectedId.value === "root");

onMounted(async () => {
  console.info("[MindMapEditDialog] 打开思维导图编辑，节点数:", nodeCount.value);
  await nextTick();
  dialogRef.value?.focus();
});

/** 选中节点，并把其文本同步到输入框 */
function select(id: string | null): void {
  if (!id) return;
  const node = findNode(tree.value, id);
  if (!node) return;
  selectedId.value = id;
  editingText.value = node.text;
}

/** 修改树之后触发响应式更新（树为深层对象，原地修改后需整体替换引用） */
function commit(nextSelected: string | null): void {
  tree.value = { ...tree.value };
  dirty.value = true;
  select(nextSelected ?? selectedId.value);
}

/** 输入框文本变化：实时写回节点 */
function onTextInput(): void {
  if (updateNodeText(tree.value, selectedId.value, editingText.value)) {
    tree.value = { ...tree.value };
    dirty.value = true;
  }
}

async function focusTextInput(): Promise<void> {
  await nextTick();
  textInput.value?.focus();
  textInput.value?.select();
}

function handleAddChild(): void {
  commit(addChild(tree.value, selectedId.value));
  void focusTextInput();
}

function handleAddSibling(): void {
  commit(addSibling(tree.value, selectedId.value));
  void focusTextInput();
}

function handleRemove(): void {
  if (isRootSelected.value) return;
  commit(removeNode(tree.value, selectedId.value));
}

function handleMove(delta: -1 | 1): void {
  if (isRootSelected.value) return;
  commit(moveNode(tree.value, selectedId.value, delta));
}

/** 画布点击：通过事件委托找到被点击的节点 */
function handleCanvasClick(event: MouseEvent): void {
  const target = (event.target as Element | null)?.closest<SVGGElement>("[data-node-id]");
  if (target?.dataset.nodeId) select(target.dataset.nodeId);
}

function handleCanvasDblClick(event: MouseEvent): void {
  handleCanvasClick(event);
  void focusTextInput();
}

function zoomBy(delta: number): void {
  zoom.value = Math.min(2, Math.max(0.4, Math.round((zoom.value + delta) * 10) / 10));
}

/** 方向键导航：左右在父子间移动（按节点所在侧），上下在兄弟间移动 */
function navigate(key: string): void {
  const current = findNode(tree.value, selectedId.value);
  if (!current) return;
  const parent = findParent(tree.value, selectedId.value);
  if (key === "ArrowUp" || key === "ArrowDown") {
    if (!parent) return;
    const index = parent.children.findIndex((child) => child.id === current.id);
    const next = parent.children[index + (key === "ArrowUp" ? -1 : 1)];
    if (next) select(next.id);
    return;
  }
  // 左右：有子节点则进入第一个子节点，否则回到父节点
  if (key === "ArrowRight" && current.children.length > 0) select(current.children[0].id);
  else if (key === "ArrowLeft" && parent) select(parent.id);
}

function handleKeydown(event: KeyboardEvent): void {
  const inInput = event.target instanceof HTMLInputElement;

  if (event.key === "Escape") {
    event.preventDefault();
    if (inInput) {
      dialogRef.value?.focus();
      return;
    }
    cancel();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    save();
    return;
  }

  if (inInput) {
    // 输入框内：Enter 确认后新增同级，Tab 新增子节点，方便连续录入
    if (event.key === "Enter") {
      event.preventDefault();
      handleAddSibling();
    } else if (event.key === "Tab") {
      event.preventDefault();
      handleAddChild();
    }
    return;
  }

  switch (event.key) {
    case "Tab":
      event.preventDefault();
      handleAddChild();
      break;
    case "Enter":
      event.preventDefault();
      handleAddSibling();
      break;
    case "Delete":
    case "Backspace":
      event.preventDefault();
      handleRemove();
      break;
    case "F2":
      event.preventDefault();
      void focusTextInput();
      break;
    case "ArrowUp":
    case "ArrowDown":
    case "ArrowLeft":
    case "ArrowRight":
      event.preventDefault();
      navigate(event.key);
      break;
  }
}

function cancel(): void {
  if (dirty.value && !window.confirm("思维导图有未保存的修改，确定放弃吗？")) return;
  console.info("[MindMapEditDialog] 取消编辑");
  props.onClose(null);
}

function save(): void {
  const result = serializeMindMap(tree.value);
  console.info("[MindMapEditDialog] 保存思维导图，节点数:", nodeCount.value);
  props.onClose(result);
}
</script>

<template>
  <div ref="dialogRef" class="mindmap-dialog" tabindex="-1" @keydown="handleKeydown">
    <div class="mindmap-dialog-header">
      <h3>编辑思维导图</h3>
      <span class="mindmap-dialog-meta">{{ nodeCount }} 个节点</span>
      <div class="mindmap-dialog-zoom">
        <button type="button" title="缩小" @click="zoomBy(-0.1)">−</button>
        <span>{{ Math.round(zoom * 100) }}%</span>
        <button type="button" title="放大" @click="zoomBy(0.1)">+</button>
      </div>
    </div>

    <div class="mindmap-dialog-body">
      <!-- 画布：点击选中、双击编辑文本 -->
      <div
        ref="canvasRef"
        class="mindmap-dialog-canvas"
        @click="handleCanvasClick"
        @dblclick="handleCanvasDblClick"
      >
        <!-- svgMarkup 由自研渲染器生成，节点文本已做 XML 转义 -->
        <div
          class="mindmap-dialog-canvas-inner"
          :style="{ transform: `scale(${zoom})` }"
          v-html="svgMarkup"
        />
      </div>

      <!-- 节点操作面板 -->
      <div class="mindmap-dialog-panel">
        <label class="mindmap-field">
          <span>{{ isRootSelected ? "中心主题" : "节点文本" }}</span>
          <input
            ref="textInput"
            v-model="editingText"
            type="text"
            autocomplete="off"
            spellcheck="false"
            placeholder="输入主题文本"
            @input="onTextInput"
          />
        </label>

        <div class="mindmap-actions">
          <button type="button" title="Tab" @click="handleAddChild">＋ 子主题</button>
          <button type="button" title="Enter" @click="handleAddSibling">＋ 同级主题</button>
          <button type="button" :disabled="isRootSelected" @click="handleMove(-1)">↑ 上移</button>
          <button type="button" :disabled="isRootSelected" @click="handleMove(1)">↓ 下移</button>
          <button
            type="button"
            class="danger"
            title="Delete"
            :disabled="isRootSelected"
            @click="handleRemove"
          >
            删除主题
          </button>
        </div>

        <ul class="mindmap-shortcuts">
          <li><kbd>Tab</kbd> 新增子主题</li>
          <li><kbd>Enter</kbd> 新增同级主题</li>
          <li><kbd>Delete</kbd> 删除选中主题</li>
          <li><kbd>↑↓←→</kbd> 切换选中</li>
          <li><kbd>F2</kbd> / 双击 编辑文本</li>
          <li><kbd>Ctrl</kbd>+<kbd>S</kbd> 保存</li>
        </ul>
      </div>
    </div>

    <div class="mindmap-dialog-footer">
      <button type="button" class="btn btn-secondary" @click="cancel">取消</button>
      <button type="button" class="btn btn-primary" @click="save">保存</button>
    </div>
  </div>
</template>

<style scoped lang="less">
.mindmap-dialog {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: min(1080px, calc(100vw - 48px));
  height: min(720px, calc(100vh - 48px));
  background: var(--background-color-1, #fff);
  color: var(--text-color, #333);
  border: 1px solid var(--border-color-1, #e1e4e8);
  border-radius: 8px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
  overflow: hidden;
  outline: none;
}

.mindmap-dialog-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--border-color-1, #e1e4e8);

  h3 {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
  }
}

.mindmap-dialog-meta {
  font-size: 12px;
  color: var(--text-color-3, #999);
}

.mindmap-dialog-zoom {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-color-2, #666);

  button {
    width: 26px;
    height: 26px;
    border: 1px solid var(--border-color-1, #e1e4e8);
    border-radius: 4px;
    background: var(--background-color-2, #f6f8fa);
    color: inherit;
    cursor: pointer;
  }

  span {
    min-width: 40px;
    text-align: center;
  }
}

.mindmap-dialog-body {
  flex: 1;
  min-height: 0;
  display: flex;
}

.mindmap-dialog-canvas {
  flex: 1;
  min-width: 0;
  overflow: auto;
  padding: 16px;
  background:
    radial-gradient(circle, var(--border-color-1, #e1e4e8) 1px, transparent 1px) 0 0 / 18px 18px,
    var(--background-color-1, #fff);
}

.mindmap-dialog-canvas-inner {
  display: inline-block;
  min-width: 100%;
  text-align: center;
  transform-origin: top center;
}

.mindmap-dialog-panel {
  flex-shrink: 0;
  width: 260px;
  padding: 16px;
  border-left: 1px solid var(--border-color-1, #e1e4e8);
  background: var(--background-color-2, #f7f8fa);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.mindmap-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--text-color-2, #666);

  input {
    box-sizing: border-box;
    width: 100%;
    height: 34px;
    padding: 0 10px;
    border: 1px solid var(--border-color-1, #d9dce1);
    border-radius: 6px;
    background: var(--background-color-1, #fff);
    color: var(--text-color, #333);
    font-size: 13px;
    outline: none;

    &:focus {
      border-color: var(--primary-color, #3b82f6);
    }
  }
}

.mindmap-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;

  button {
    padding: 7px 8px;
    border: 1px solid var(--border-color-1, #e1e4e8);
    border-radius: 6px;
    background: var(--background-color-1, #fff);
    color: var(--text-color-1, #333);
    font-size: 12px;
    cursor: pointer;

    &:hover:not(:disabled) {
      border-color: var(--primary-color, #3b82f6);
      color: var(--primary-color, #3b82f6);
    }

    &:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    &.danger:hover:not(:disabled) {
      border-color: #e53e3e;
      color: #e53e3e;
    }
  }
}

.mindmap-shortcuts {
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 12px;
  line-height: 2;
  color: var(--text-color-3, #999);

  kbd {
    padding: 1px 5px;
    border: 1px solid var(--border-color-1, #e1e4e8);
    border-radius: 3px;
    background: var(--background-color-1, #fff);
    font-family: inherit;
    font-size: 11px;
  }
}

.mindmap-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 20px 16px;
  border-top: 1px solid var(--border-color-1, #e1e4e8);
}

.btn {
  padding: 8px 18px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.btn-secondary {
  background: var(--background-color-2, #f1f3f5);
  color: var(--text-color-3, #666);
  border: 1px solid var(--border-color-1, #e1e4e8);
}

.btn-primary {
  background: var(--primary-color, #3b82f6);
  color: #fff;

  &:hover {
    opacity: 0.88;
  }
}

// 窄屏（手机 / 平板竖屏）：操作面板移到画布下方
@media (max-width: 760px) {
  .mindmap-dialog {
    width: 100vw;
    height: 100vh;
    max-width: 100vw;
    border-radius: 0;
  }

  .mindmap-dialog-body {
    flex-direction: column;
  }

  .mindmap-dialog-panel {
    width: auto;
    max-height: 45%;
    border-left: none;
    border-top: 1px solid var(--border-color-1, #e1e4e8);
  }

  .mindmap-shortcuts {
    display: none;
  }
}
</style>
