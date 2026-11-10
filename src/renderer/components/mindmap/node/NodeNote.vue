<script setup lang="ts">
/**
 * 节点备注弹窗（移植自参考项目 NodeNote.vue）
 *
 * - 总线 showNodeNote 打开：不带参数时编辑激活节点（确定后写入全部激活节点）；
 *   带节点参数时只编辑该节点（appointNode，双击备注图标时由根组件转发 node_note_dblclick 为 showNodeNote(node)）；
 * - 打开期间派发 startTextEdit / endTextEdit 暂停引擎快捷键（与参考项目一致），由 useNodeDialogGuard 处理；
 *   焦点掉回 body 时穿透到引擎的按键由 MmDialog 拦截）；打开时聚焦文本框（新建的文本框赋值后光标在末尾）；
 * - 参考项目用 @toast-ui/editor（Markdown 模式 + 右侧预览），这里不引入依赖，改为「Markdown 文本框 +
 *   实时预览」：工具栏插入常用语法（用 insertText 修改，保留文本框自身的撤销记录），
 *   Tab / Shift+Tab 缩进，Ctrl+B / Ctrl+I 加粗 / 斜体，Ctrl+Enter 确定；预览用 utils 的 markdownToHtml。
 */
import { onBeforeUnmount, ref, watch } from "vue";
import type { MindMapNodeInstance } from "@/core/mindmap-engine/full";
import { useBusEvent, useMindMapContext } from "../context";
import MmDialog from "../ui/MmDialog.vue";
import NoteMarkdownView from "./NoteMarkdownView.vue";
import { useNodeDialogGuard } from "./useNodeDialogGuard";

const { activeNodes, isReadonly } = useMindMapContext();

const dialogVisible = ref(false);
const note = ref("");
/** 预览内容（输入停顿后再渲染，避免每次按键都解析 Markdown） */
const previewSource = ref("");
const contentRef = ref<HTMLElement | null>(null);
const textareaRef = ref<HTMLTextAreaElement | null>(null);
let nodes: MindMapNodeInstance[] = [...activeNodes.value];
/** 指定编辑的节点（对应参考项目 appointNode） */
let appointNode: MindMapNodeInstance | null = null;
let previewTimer = 0;

/** 回显第一个激活节点的备注（对应参考项目 updateNoteInfo） */
function updateNoteInfo(): void {
  note.value = nodes[0]?.getData("note") || "";
}

useBusEvent("node_active", (_node: unknown, list: MindMapNodeInstance[] = []) => {
  nodes = [...list];
  // 弹窗打开期间不覆盖正在编辑的内容
  if (!dialogVisible.value) updateNoteInfo();
});

useBusEvent("showNodeNote", (node?: MindMapNodeInstance) => {
  if (isReadonly.value) {
    console.info("[MindMap/NodeNote] 只读模式，不打开备注编辑");
    return;
  }
  if (node && typeof node.getData === "function") {
    appointNode = node;
    note.value = node.getData("note") || "";
  } else {
    appointNode = null;
    updateNoteInfo();
  }
  window.clearTimeout(previewTimer);
  previewSource.value = note.value;
  dialogVisible.value = true;
  console.debug(
    "[MindMap/NodeNote] 打开备注编辑:",
    appointNode ? "指定节点" : `激活节点 ${nodes.length} 个`
  );
});

watch(note, (value) => {
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => (previewSource.value = value), 150);
});

onBeforeUnmount(() => window.clearTimeout(previewTimer));

function cancel(): void {
  dialogVisible.value = false;
  if (appointNode) {
    appointNode = null;
    updateNoteInfo();
  }
}

useNodeDialogGuard(dialogVisible, { initialFocus: () => textareaRef.value });

function confirm(): void {
  const value = note.value;
  if (appointNode) {
    appointNode.setNote(value);
  } else {
    nodes.forEach((node) => node.setNote(value));
  }
  console.info("[MindMap/NodeNote] 已保存备注，长度:", value.length);
  cancel();
}

/* ------------------------------ 文本框编辑 ------------------------------ */

/**
 * 替换文本框中的一段文字并设置新选区
 * 优先用 execCommand("insertText")：会触发 input 事件同步 v-model，且保留文本框的撤销记录；
 * 不支持时退回 setRangeText 并手动同步。
 */
function replaceRange(
  start: number,
  end: number,
  text: string,
  selectStart: number,
  selectEnd: number
): void {
  const el = textareaRef.value;
  if (!el) return;
  el.focus();
  el.setSelectionRange(start, end);
  if (!document.execCommand("insertText", false, text)) {
    el.setRangeText(text, start, end, "end");
    note.value = el.value;
  }
  el.setSelectionRange(selectStart, selectEnd);
}

/** 选区覆盖的整行范围（选区恰好止于行首时不算下一行） */
function getLineRange(el: HTMLTextAreaElement): { lineStart: number; lineEnd: number } {
  const { selectionStart, value } = el;
  let { selectionEnd } = el;
  if (selectionEnd > selectionStart && value[selectionEnd - 1] === "\n") selectionEnd -= 1;
  const lineStart = selectionStart > 0 ? value.lastIndexOf("\n", selectionStart - 1) + 1 : 0;
  const nextBreak = value.indexOf("\n", selectionEnd);
  return { lineStart, lineEnd: nextBreak === -1 ? value.length : nextBreak };
}

/** 用前后缀包裹选中文字；没有选中时插入占位文字并选中它 */
function wrapSelection(prefix: string, suffix: string, placeholder: string): void {
  const el = textareaRef.value;
  if (!el) return;
  const { selectionStart: start, selectionEnd: end, value } = el;
  const selected = value.slice(start, end) || placeholder;
  const selectStart = start + prefix.length;
  replaceRange(start, end, prefix + selected + suffix, selectStart, selectStart + selected.length);
}

/** 给选区覆盖的每一行加前缀（标题、引用、列表、缩进） */
function prefixLines(getPrefix: (index: number) => string): void {
  const el = textareaRef.value;
  if (!el) return;
  const { lineStart, lineEnd } = getLineRange(el);
  const text = el.value
    .slice(lineStart, lineEnd)
    .split("\n")
    .map((line, index) => getPrefix(index) + line)
    .join("\n");
  replaceRange(lineStart, lineEnd, text, lineStart, lineStart + text.length);
}

/** 插入独占行的块（代码块、分割线）：前后不是换行时补换行 */
function insertBlock(open: string, close: string, placeholder: string): void {
  const el = textareaRef.value;
  if (!el) return;
  const { selectionStart: start, selectionEnd: end, value } = el;
  const selected = value.slice(start, end) || placeholder;
  const before = start > 0 && value[start - 1] !== "\n" ? "\n" : "";
  const after = end < value.length && value[end] !== "\n" ? "\n" : "";
  const selectStart = start + before.length + open.length;
  replaceRange(
    start,
    end,
    before + open + selected + close + after,
    selectStart,
    selectStart + selected.length
  );
}

/**
 * 在选区末尾插入分割线：前面必须空一行，否则「文字\n---」会被解析成二级标题
 */
function insertHorizontalRule(): void {
  const el = textareaRef.value;
  if (!el) return;
  const { selectionEnd: end, value } = el;
  let before = "";
  if (end > 0 && !value.slice(0, end).endsWith("\n\n")) {
    before = value[end - 1] === "\n" ? "\n" : "\n\n";
  }
  const after = end < value.length && value[end] !== "\n" ? "\n" : "";
  const text = `${before}---${after}`;
  replaceRange(end, end, text, end + text.length, end + text.length);
}

/** Tab：无选区插入两个空格，有选区整行缩进 */
function indent(): void {
  const el = textareaRef.value;
  if (!el) return;
  const { selectionStart: start, selectionEnd: end } = el;
  if (start === end) replaceRange(start, end, "  ", start + 2, start + 2);
  else prefixLines(() => "  ");
}

/** Shift+Tab：选区覆盖的每一行去掉最多两个前导空格（或一个制表符） */
function outdent(): void {
  const el = textareaRef.value;
  if (!el) return;
  const { selectionStart: start, selectionEnd: end, value } = el;
  const { lineStart, lineEnd } = getLineRange(el);
  const original = value.slice(lineStart, lineEnd);
  const text = original
    .split("\n")
    .map((line) => line.replace(/^( {1,2}|\t)/, ""))
    .join("\n");
  if (text === original) return;
  if (start === end) {
    // 光标所在行：光标随文字左移
    const cursor = Math.max(lineStart, start - (original.length - text.length));
    replaceRange(lineStart, lineEnd, text, cursor, cursor);
  } else {
    replaceRange(lineStart, lineEnd, text, lineStart, lineStart + text.length);
  }
}

/**
 * 工具栏按钮（覆盖 Markdown 常用语法；预览不支持 GFM 扩展，所以不提供表格 / 任务列表）
 * icon 为移植图标字体的类名，没有合适图标的用文字
 */
const toolbarActions: ReadonlyArray<{
  title: string;
  icon?: string;
  label?: string;
  run: () => void;
}> = [
  { title: "标题", label: "H", run: () => prefixLines(() => "## ") },
  {
    title: "粗体（Ctrl+B）",
    icon: "iconzitijiacu",
    run: () => wrapSelection("**", "**", "粗体文字"),
  },
  {
    title: "斜体（Ctrl+I）",
    icon: "iconzitixieti",
    run: () => wrapSelection("*", "*", "斜体文字"),
  },
  { title: "引用", label: "“", run: () => prefixLines(() => "> ") },
  { title: "无序列表", label: "•", run: () => prefixLines(() => "- ") },
  { title: "有序列表", label: "1.", run: () => prefixLines((index) => `${index + 1}. `) },
  { title: "行内代码", label: "</>", run: () => wrapSelection("`", "`", "代码") },
  { title: "代码块", icon: "iconyuanma", run: () => insertBlock("```\n", "\n```", "代码") },
  {
    title: "链接",
    icon: "iconchaolianjie",
    run: () => wrapSelection("[", "](https://)", "链接文字"),
  },
  { title: "分割线", label: "—", run: insertHorizontalRule },
];

function onEditorKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return;
  if (event.key === "Tab" && !event.ctrlKey && !event.altKey && !event.metaKey) {
    event.preventDefault();
    if (event.shiftKey) outdent();
    else indent();
    return;
  }
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
  const key = event.key.toLowerCase();
  if (key === "enter") {
    event.preventDefault();
    confirm();
  } else if (key === "b") {
    event.preventDefault();
    wrapSelection("**", "**", "粗体文字");
  } else if (key === "i") {
    event.preventDefault();
    wrapSelection("*", "*", "斜体文字");
  }
}
</script>

<template>
  <MmDialog v-model="dialogVisible" title="备注" width="900px" @confirm="confirm" @cancel="cancel">
    <div ref="contentRef" class="node-note" tabindex="-1">
      <div class="node-note__toolbar">
        <button
          v-for="action in toolbarActions"
          :key="action.title"
          type="button"
          class="node-note__tool"
          :title="action.title"
          @mousedown.prevent
          @click="action.run"
        >
          <span v-if="action.icon" class="mm-iconfont" :class="action.icon" />
          <template v-else>{{ action.label }}</template>
        </button>
        <span class="node-note__hint">支持 Markdown 语法，Ctrl+Enter 确定</span>
      </div>
      <div class="node-note__body">
        <textarea
          ref="textareaRef"
          v-model="note"
          class="node-note__editor"
          placeholder="请输入备注内容"
          spellcheck="false"
          @keydown="onEditorKeydown"
        />
        <div class="node-note__preview">
          <NoteMarkdownView v-if="previewSource.trim()" :markdown="previewSource" />
          <div v-else class="node-note__empty">预览</div>
        </div>
      </div>
    </div>
  </MmDialog>
</template>

<style lang="less" scoped>
.node-note {
  // 内容容器可聚焦（tabindex="-1"，焦点元素被移除 / 禁用时的兜底落点），不显示焦点框
  outline: none;
}

.node-note__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-bottom: 8px;
}

.node-note__tool {
  min-width: 30px;
  height: 28px;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--text-color-1, #333);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;

  &:hover {
    border-color: var(--border-color-1, #e4e7ed);
    background: var(--hover-background-color, rgba(0, 0, 0, 0.04));
  }
}

.node-note__hint {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-color-3, #999);
}

.node-note__body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  height: min(460px, calc(100vh - 280px));
  min-height: 240px;
  border: 1px solid var(--border-color-1, #e4e7ed);
  border-radius: 6px;
  overflow: hidden;
}

.node-note__editor {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: 10px 12px;
  border: none;
  border-right: 1px solid var(--border-color-1, #e4e7ed);
  outline: none;
  resize: none;
  background: var(--background-color-1, #fff);
  color: var(--text-color, #333);
  font-family: Consolas, Monaco, "Courier New", monospace;
  font-size: 13px;
  line-height: 1.7;
  tab-size: 2;
}

.node-note__preview {
  min-width: 0;
  padding: 10px 14px;
  overflow: auto;
  background: var(--background-color-2, #fafafa);
}

.node-note__empty {
  color: var(--text-color-3, #999);
}

@media (max-width: 760px) {
  .node-note__body {
    grid-template-columns: none;
    grid-template-rows: 1fr 1fr;
  }

  .node-note__editor {
    border-right: none;
    border-bottom: 1px solid var(--border-color-1, #e4e7ed);
  }
}
</style>
