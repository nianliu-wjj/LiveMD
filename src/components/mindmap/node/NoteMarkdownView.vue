<script setup lang="ts">
/**
 * 备注 Markdown 渲染视图（替代参考项目的 @toast-ui/editor Viewer；NodeNote 预览、NodeNoteSidebar、
 * NodeNoteContentShow 共用）
 *
 * - 用 utils 的 markdownToHtml 渲染：remark-rehype 默认丢弃原始 HTML，结果可安全 v-html；
 * - 渲染是异步的：带序号，内容快速变化时只采用最后一次结果，DOM 更新后派发 rendered（浮层据此测量定位）；
 * - 渲染失败时退回纯文本显示；
 * - 链接一律拦截：http(s) / mailto 交给系统浏览器打开，其它协议（含 javascript:）不跳转
 *   （参考项目是给 a 标签加 target="_blank"，WebView 内不适用）。
 */
import { nextTick, ref, watch } from "vue";
import { markdownToHtml } from "../utils";
import { openNoteLink } from "./nodeContentUtils";

const props = defineProps<{
  markdown: string;
}>();

const emit = defineEmits<{
  /** 渲染结果已更新到 DOM（参数为本次渲染的 Markdown 原文） */
  (e: "rendered", markdown: string): void;
}>();

const html = ref("");
/** 渲染失败时显示的原文 */
const plainText = ref("");
let renderSeq = 0;

async function render(markdown: string): Promise<void> {
  const seq = ++renderSeq;
  let nextHtml = "";
  let nextPlain = "";
  try {
    nextHtml = markdown.trim() ? await markdownToHtml(markdown) : "";
  } catch (error) {
    console.error("[MindMap/NoteMarkdownView] 备注渲染失败，改为纯文本显示:", error);
    nextPlain = markdown;
  }
  // 渲染期间内容又变了：丢弃过期结果
  if (seq !== renderSeq) return;
  html.value = nextHtml;
  plainText.value = nextPlain;
  await nextTick();
  if (seq === renderSeq) emit("rendered", markdown);
}

watch(
  () => props.markdown,
  (markdown) => void render(markdown),
  { immediate: true }
);

function onClick(event: MouseEvent): void {
  const anchor = (event.target as Element | null)?.closest?.("a");
  if (!anchor) return;
  event.preventDefault();
  openNoteLink(anchor.getAttribute("href") ?? "");
}

/** 中键点击链接默认会尝试新开窗口，同样拦截 */
function onAuxClick(event: MouseEvent): void {
  if ((event.target as Element | null)?.closest?.("a")) event.preventDefault();
}
</script>

<template>
  <div class="note-markdown" @click="onClick" @auxclick="onAuxClick">
    <div v-if="plainText" class="note-markdown__plain">{{ plainText }}</div>
    <div v-else class="note-markdown__body" v-html="html" />
  </div>
</template>

<style lang="less" scoped>
.note-markdown {
  color: var(--text-color, #333);
  font-size: 13px;
  line-height: 1.7;
  word-break: break-word;
  // 编辑器根元素禁用了文字选择，备注内容允许选中复制
  user-select: text;
}

.note-markdown__plain {
  white-space: pre-wrap;
}

.note-markdown__body {
  > :deep(:first-child) {
    margin-top: 0;
  }

  > :deep(:last-child) {
    margin-bottom: 0;
  }

  :deep(h1),
  :deep(h2),
  :deep(h3),
  :deep(h4),
  :deep(h5),
  :deep(h6) {
    margin: 1em 0 0.5em;
    font-weight: 600;
    line-height: 1.4;
  }

  :deep(h1) {
    font-size: 1.6em;
  }

  :deep(h2) {
    font-size: 1.4em;
  }

  :deep(h3) {
    font-size: 1.2em;
  }

  :deep(h4),
  :deep(h5),
  :deep(h6) {
    font-size: 1em;
  }

  :deep(p),
  :deep(ul),
  :deep(ol),
  :deep(blockquote),
  :deep(pre),
  :deep(table) {
    margin: 0 0 0.8em;
  }

  :deep(ul),
  :deep(ol) {
    padding-left: 1.6em;
  }

  :deep(li + li) {
    margin-top: 0.2em;
  }

  :deep(blockquote) {
    padding: 0 0 0 12px;
    border-left: 3px solid var(--border-color-2, #dcdfe6);
    color: var(--text-color-2, #666);
  }

  :deep(code) {
    padding: 1px 4px;
    border-radius: 3px;
    background: var(--background-color-2, #f5f7fa);
    font-family: Consolas, Monaco, "Courier New", monospace;
    font-size: 0.92em;
  }

  :deep(pre) {
    padding: 8px 10px;
    overflow-x: auto;
    border-radius: 4px;
    background: var(--background-color-2, #f5f7fa);

    code {
      padding: 0;
      background: transparent;
    }
  }

  :deep(a) {
    color: var(--primary-color, #409eff);
    text-decoration: none;
    cursor: pointer;

    &:hover {
      text-decoration: underline;
    }
  }

  :deep(hr) {
    margin: 1em 0;
    border: none;
    border-top: 1px solid var(--border-color-1, #e4e7ed);
  }

  :deep(img) {
    max-width: 100%;
  }

  :deep(table) {
    border-collapse: collapse;
  }

  :deep(th),
  :deep(td) {
    padding: 4px 8px;
    border: 1px solid var(--border-color-1, #e4e7ed);
  }
}
</style>
