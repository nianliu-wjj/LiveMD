<script setup lang="ts">
/**
 * 单条批注卡片（纯展示 + 操作入口）
 *
 * - 折叠态：单行省略内容 + 锚文本小字 + 底部行（时间左 / 定位·编辑·删除图标按钮右）
 * - 展开态：Markdown 渲染正文（复用主编辑器的 parseMarkdown + DOMSerializer，所见即所得）
 * - 输入职责完全在 AnnotationEditorDialog（v1.1 起），本组件无编辑态 UI
 */
import { computed, ref, watch } from "vue";
import { nextTick } from "vue";
import AppIcon from "@/renderer/components/ui/AppIcon.vue";
import emitter from "@/renderer/events";
import { DOMSerializer, Node as ProsemirrorNode } from "prosemirror-model";
import { livemdSchema, parseMarkdown } from "@/core";
import type { AnnotationEntry } from "@/shared/utils/annotations";

const props = defineProps<{
  entry: AnnotationEntry;
  active: boolean;
}>();

const expanded = ref(false);

// 激活态（点击文档高亮 / 提交后）驱动自动展开并滚动到可见区
watch(
  () => props.active,
  (active) => {
    if (!active) return;
    expanded.value = true;
    void nextTick().then(() => {
      rootRef.value?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  },
  { immediate: true }
);

function toggleExpand() {
  expanded.value = !expanded.value;
}

const rootRef = ref<HTMLElement | null>(null);

// Markdown 渲染管道：serializer 在模块级只建一次（与主编辑器同 schema 同解析器）
const annotationSerializer = DOMSerializer.fromSchema(livemdSchema);

const contentHtml = computed(() => renderAnnotationHtml(props.entry.content));

function renderAnnotationHtml(content: string): string {
  if (!content.trim()) return "";
  try {
    const { doc } = parseMarkdown(content);
    const fragment = annotationSerializer.serializeFragment(doc.content as ProsemirrorNode);
    const container = document.createElement("div");
    container.appendChild(fragment);
    return container.innerHTML; // v-html 注入
  } catch {
    return ""; // 渲染异常时退化为空，不让一条批注炸掉整个面板
  }
}

const displayTime = computed(() => formatRelativeTime(props.entry.updatedAt));

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function handleReveal() {
  emitter.emit("editor:annotation-reveal", { id: props.entry.id });
}

function handleEdit() {
  emitter.emit("editor:annotation-edit", { id: props.entry.id });
}

function handleRemove() {
  emitter.emit("editor:annotation-remove", { id: props.entry.id });
}
</script>

<template>
  <div ref="rootRef" class="annotation-card" :class="{ active }">
    <div class="annotation-card__content-row" @click="toggleExpand">
      <button
        type="button"
        class="annotation-card__toggle"
        :aria-label="expanded ? '收起批注' : '展开批注'"
        @click.stop="toggleExpand"
      >
        <AppIcon :name="expanded ? 'chevron-down' : 'arrow-right'" />
      </button>
      <span class="annotation-card__summary">{{ entry.content || "（空批注）" }}</span>
    </div>
    <div class="annotation-card__anchor" :title="entry.anchor.anchorText">
      {{ entry.anchor.anchorText }}
    </div>
    <div v-if="expanded && contentHtml" class="annotation-card__body" v-html="contentHtml"></div>
    <div class="annotation-card__footer">
      <span class="annotation-card__time" :title="new Date(entry.updatedAt).toLocaleString()">
        {{ displayTime }}
      </span>
      <div class="annotation-card__actions">
        <button type="button" title="定位到文档" @click="handleReveal">
          <AppIcon name="locate" />
        </button>
        <button type="button" title="编辑批注" @click="handleEdit">
          <AppIcon name="edit" />
        </button>
        <button type="button" title="删除批注" @click="handleRemove">
          <AppIcon name="trash" />
        </button>
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.annotation-card {
  padding: 8px 10px;
  border: 1px solid var(--border-color-1, #e7eaed);
  border-radius: 8px;
  background: var(--background-color-1, #fff);
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;

  &.active {
    border-color: color-mix(in srgb, var(--annotation-color, #f5a623) 55%, transparent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--annotation-color, #f5a623) 28%, transparent);
  }

  &__content-row {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    cursor: pointer;
  }

  &__toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text-color-3, #999);
    cursor: pointer;
    font-size: 13px;

    &:hover {
      background: var(--hover-color, rgba(0, 0, 0, 0.06));
      color: var(--text-color-1, #333);
    }
  }

  &__summary {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-color-1, #333);
  }

  &__anchor {
    padding-left: 24px;
    font-size: 11px;
    color: var(--text-color-3, #999);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__body {
    padding: 6px 2px 2px 24px;
    color: var(--text-color-2, #555);
    line-height: 1.55;
    word-break: break-word;

    :deep(p) {
      margin: 0.4em 0;

      &:first-child {
        margin-top: 0;
      }
      &:last-child {
        margin-bottom: 0;
      }
    }

    :deep(code) {
      font-family: var(--livemd-font-code), Consolas, monospace;
      font-size: 0.9em;
      background: var(--background-color-3, #f3f4f4);
      border-radius: 3px;
      padding: 0.05em 0.3em;
    }

    :deep(pre) {
      margin: 0.4em 0;
      padding: 6px 8px;
      border-radius: 5px;
      background: var(--background-color-3, #f3f4f4);
      overflow-x: auto;
      font-size: 12px;
    }
  }

  &__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  &__time {
    flex-shrink: 0;
    font-size: 11px;
    color: var(--text-color-3, #999);
  }

  &__actions {
    display: flex;
    align-items: center;
    gap: 2px;

    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      padding: 0;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: var(--text-color-3, #999);
      cursor: pointer;
      font-size: 13px;

      &:hover {
        background: var(--hover-color, rgba(0, 0, 0, 0.06));
        color: var(--text-color-1, #333);
      }
    }
  }
}
</style>
