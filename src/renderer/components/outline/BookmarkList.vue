<script setup lang="ts">
/**
 * 书签列表
 *
 * 对应 typora_plugin 的 bookmark：展示所有文档中的块书签，
 * 点击可打开对应文件并滚动到书签块。
 *
 * 左栏书签页签迁出后，本组件作为右缘书签栏（BookmarkBar）的内容区使用。
 */
import { computed, nextTick } from "vue";
import AppIcon from "@/renderer/components/ui/AppIcon.vue";
import emitter from "@/renderer/events";
import useBookmarks from "@/renderer/hooks/useBookmarks";
import useTab from "@/renderer/hooks/useTab";
import type { BookmarkEntry } from "@/renderer/utils/bookmarks";

interface BookmarkGroup {
  filePath: string;
  fileName: string;
  isCurrent: boolean;
  entries: BookmarkEntry[];
}

const { bookmarks, removeFileBookmark } = useBookmarks();
const { currentTab, openFile } = useTab();

function getFileName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath;
}

const groups = computed<BookmarkGroup[]>(() => {
  const currentPath = currentTab.value?.filePath;
  const map = new Map<string, BookmarkGroup>();

  for (const [filePath, entries] of Object.entries(bookmarks.value)) {
    map.set(filePath, {
      filePath,
      fileName: getFileName(filePath),
      isCurrent: filePath === currentPath,
      entries: [...entries],
    });
  }

  return [...map.values()].sort((left, right) => {
    if (left.isCurrent !== right.isCurrent) return left.isCurrent ? -1 : 1;
    return left.fileName.localeCompare(right.fileName);
  });
});

const totalCount = computed(() =>
  groups.value.reduce((count, group) => count + group.entries.length, 0)
);

const TYPE_LABELS: Record<string, string> = {
  paragraph: "段落",
  heading: "标题",
  bullet_list: "列表",
  ordered_list: "列表",
  list_item: "列表",
  code_block: "代码块",
  blockquote: "引用",
  table: "表格",
  image: "图片",
  horizontal_rule: "分隔线",
  math_block: "公式",
  html_block: "HTML",
};

function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

async function jumpTo(group: BookmarkGroup, entry: BookmarkEntry): Promise<void> {
  const tab = await openFile(group.filePath);
  if (!tab) return;

  await nextTick();
  setTimeout(() => {
    emitter.emit("editor:reveal-block", { index: entry.index, text: entry.text });
  }, 80);
}

function remove(group: BookmarkGroup, entry: BookmarkEntry, event: MouseEvent): void {
  event.stopPropagation();
  removeFileBookmark(group.filePath, entry.index);
}
</script>

<template>
  <div class="bookmarkList">
    <template v-if="totalCount > 0">
      <div v-for="group in groups" :key="group.filePath" class="bookmarkGroup">
        <div class="bookmarkFile" :class="{ current: group.isCurrent }" :title="group.filePath">
          <AppIcon name="markdown" class="bookmarkFile-icon" />
          <span class="bookmarkFile-name">{{ group.fileName }}</span>
          <span v-if="group.isCurrent" class="bookmarkFile-badge">当前</span>
        </div>

        <div
          v-for="entry in group.entries"
          :key="`${group.filePath}:${entry.index}`"
          class="bookmarkItem"
          :title="entry.text"
          @click="jumpTo(group, entry)"
        >
          <span class="bookmarkItem-dot"></span>
          <span class="bookmarkItem-text">{{ entry.text }}</span>
          <span class="bookmarkItem-type">{{ typeLabel(entry.type) }}</span>
          <button
            type="button"
            class="bookmarkItem-delete"
            title="删除书签"
            @click="remove(group, entry, $event)"
          >
            <AppIcon name="trash" />
          </button>
        </div>
      </div>
    </template>

    <div v-else class="right-edge-bar__empty">
      <AppIcon name="bookmark" class="right-edge-bar__empty-icon" />
      <p class="right-edge-bar__empty-text">暂无书签</p>
      <p class="right-edge-bar__empty-hint">按住 Alt 点击编辑器中的任意段落即可添加</p>
    </div>
  </div>
</template>

<style lang="less" scoped>
.bookmarkList {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.bookmarkGroup {
  margin-bottom: 6px;
}

.bookmarkFile {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 6px 4px;
  font-size: 12px;
  color: var(--text-color-2);

  &.current .bookmarkFile-name {
    color: var(--primary-color, #4a9eff);
  }

  .bookmarkFile-icon {
    flex-shrink: 0;
    font-size: 13px;
    color: var(--text-color-3);
  }

  .bookmarkFile-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }

  .bookmarkFile-badge {
    flex-shrink: 0;
    padding: 0 4px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--primary-color, #4a9eff) 14%, transparent);
    color: var(--primary-color, #4a9eff);
    font-size: 10px;
    line-height: 15px;
  }
}

.bookmarkItem {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 5px;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-color-2);

  &:hover {
    background: var(--background-color-1);

    .bookmarkItem-delete {
      opacity: 1;
    }
  }

  .bookmarkItem-dot {
    flex-shrink: 0;
    width: 6px;
    height: 6px;
    border-radius: 1px 3px 3px 1px;
    background: var(--primary-color, #4a9eff);
  }

  .bookmarkItem-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bookmarkItem-type {
    flex-shrink: 0;
    font-size: 10px;
    color: var(--text-color-3);
    opacity: 0.8;
  }

  .bookmarkItem-delete {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text-color-3);
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.12s ease;

    &:hover {
      color: #e5484d;
      background: color-mix(in srgb, #e5484d 12%, transparent);
    }
  }
}
</style>
