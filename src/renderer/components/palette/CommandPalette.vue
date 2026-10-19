<script setup lang="ts">
/**
 * 命令面板 / 快速打开面板
 *
 * - Ctrl+P：在工作区文件、最近文件、已打开标签页之间快速跳转（Typora 快速打开）
 * - Ctrl+Shift+P：搜索并执行应用与编辑器命令（typora_plugin 命令面板）
 */
import { computed, nextTick, ref, watch } from "vue";
import AppIcon from "@/renderer/components/ui/AppIcon.vue";
import useAppCommands from "@/renderer/hooks/useAppCommands";
import {
  closeQuickOpen,
  quickOpenMode,
  isQuickOpenVisible,
  openQuickOpen,
} from "@/renderer/hooks/useQuickOpen";
import useRecentFiles from "@/renderer/hooks/useRecentFiles";
import useTab from "@/renderer/hooks/useTab";
import useWorkSpace from "@/renderer/hooks/useWorkSpace";

interface PaletteItem {
  key: string;
  title: string;
  subtitle?: string;
  category?: string;
  keywords?: string[];
  shortcut?: string;
  disabled?: boolean;
  run: () => void | Promise<void>;
}

const { commands } = useAppCommands();
const { tabs, activeTabId, switchToTab, openFile } = useTab();
const { rawWorkSpace } = useWorkSpace();
const { recentFiles } = useRecentFiles();

const keyword = ref("");
const activeIndex = ref(0);
const inputRef = ref<HTMLInputElement | null>(null);
const listRef = ref<HTMLElement | null>(null);

const modeLabel = computed(() => (quickOpenMode.value === "files" ? "快速打开" : "命令面板"));
const placeholder = computed(() =>
  quickOpenMode.value === "files"
    ? "输入文件名搜索工作区文件、最近文件…"
    : "输入命令名称或关键词…"
);

function getDirname(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  parts.pop();
  return parts.join("/");
}

function getFileName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath;
}

/** 是否是可被打开的文本类文件 */
function isSupportedFile(filePath: string): boolean {
  return /\.(md|markdown|mdown|mkd|txt|json|ya?ml|html?|css|js|ts|tsx|vue|py|rs|go|java|c|cpp|h|sh|toml|ini|log|csv)$/i.test(
    filePath
  );
}

function isMarkdownFile(filePath: string): boolean {
  return /\.(md|markdown|mdown|mkd)$/i.test(filePath);
}

const fileItems = computed<PaletteItem[]>(() => {
  const items: PaletteItem[] = [];
  const seen = new Set<string>();

  const pushFile = (filePath: string, name: string, isRecent = false) => {
    if (!filePath || seen.has(filePath)) return;
    seen.add(filePath);
    const dirname = getDirname(filePath);
    items.push({
      key: `file:${filePath}`,
      title: name || getFileName(filePath),
      subtitle: isRecent ? `${dirname}（最近打开）` : dirname,
      category: "文件",
      keywords: [filePath],
      run: () => void openFile(filePath),
    });
  };

  // 已打开的标签页优先展示
  for (const tab of tabs.value) {
    if (!tab.filePath) continue;
    if (seen.has(tab.filePath)) continue;
    seen.add(tab.filePath);
    items.push({
      key: `tab:${tab.id}`,
      title: tab.name,
      subtitle: `${getDirname(tab.filePath)}（已打开）`,
      category: "标签页",
      keywords: [tab.filePath],
      disabled: tab.id === activeTabId.value,
      run: () => void switchToTab(tab.id),
    });
  }

  // 最近打开的文件
  for (const recent of recentFiles.value) {
    pushFile(recent.path, recent.name, true);
  }

  // 工作区文件
  const walk = (nodes: Array<{ name: string; path: string; isDirectory: boolean; children?: any[] }>) => {
    if (!nodes || items.length > 5000) return;
    for (const node of nodes) {
      if (node.isDirectory) {
        if (node.children) walk(node.children);
        continue;
      }
      if (!isSupportedFile(node.path)) continue;
      pushFile(node.path, node.name);
    }
  };
  if (rawWorkSpace.value) {
    walk(rawWorkSpace.value as any);
  }

  return items;
});

interface DisplayItem extends PaletteItem {
  /** 显示用图标类型 */
  iconName: string;
}

const filteredItems = computed<DisplayItem[]>(() => {
  const query = keyword.value.trim().toLowerCase();
  const source = quickOpenMode.value === "files" ? fileItems.value : commands.value;

  const filtered = source.filter((item) => {
    if (!query) return true;
    const haystack = [item.title, item.subtitle ?? "", item.category ?? "", ...(item.keywords ?? [])]
      .join("\n")
      .toLowerCase();
    return query.split(/\s+/).every((part) => haystack.includes(part));
  });

  return filtered.map((item) => ({
    ...item,
    iconName:
      quickOpenMode.value === "commands"
        ? "script"
        : isMarkdownFile((item.keywords ?? []).join(" "))
          ? "markdown"
          : "document",
  }));
});

watch(keyword, () => {
  activeIndex.value = 0;
});

watch(isQuickOpenVisible, async (visible) => {
  if (!visible) return;
  keyword.value = "";
  activeIndex.value = 0;
  await nextTick();
  inputRef.value?.focus();
});

function setActiveIndex(index: number) {
  const items = filteredItems.value;
  if (items.length === 0) return;
  activeIndex.value = (index + items.length) % items.length;
  nextTick(() => {
    const el = listRef.value?.querySelector<HTMLElement>(".palette-item.active");
    el?.scrollIntoView({ block: "nearest" });
  });
}

function onInputKeydown(event: KeyboardEvent) {
  if (event.isComposing) return;
  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      setActiveIndex(activeIndex.value + 1);
      break;
    case "ArrowUp":
      event.preventDefault();
      setActiveIndex(activeIndex.value - 1);
      break;
    case "Enter":
      event.preventDefault();
      void runActive();
      break;
    case "Escape":
      event.preventDefault();
      closeQuickOpen();
      break;
  }
}

async function runActive() {
  const item = filteredItems.value[activeIndex.value];
  if (!item || item.disabled) return;
  closeQuickOpen();
  await item.run();
}

function onItemClick(index: number) {
  activeIndex.value = index;
  void runActive();
}

function switchMode(mode: "files" | "commands") {
  if (quickOpenMode.value === mode) return;
  keyword.value = "";
  activeIndex.value = 0;
  openQuickOpen(mode);
  nextTick(() => inputRef.value?.focus());
}
</script>

<template>
  <Teleport to="body">
    <Transition name="palette-fade">
      <div
        v-if="isQuickOpenVisible"
        class="palette-overlay"
        @click.self="closeQuickOpen"
        @contextmenu.prevent
      >
        <div class="palette-panel" role="dialog" :aria-label="modeLabel">
          <div class="palette-search">
            <AppIcon name="search" class="palette-search-icon" />
            <input
              ref="inputRef"
              v-model="keyword"
              class="palette-input"
              type="text"
              :placeholder="placeholder"
              spellcheck="false"
              @keydown="onInputKeydown"
            />
            <div class="palette-modes">
              <button
                type="button"
                :class="{ active: quickOpenMode === 'files' }"
                @click="switchMode('files')"
              >
                文件
              </button>
              <button
                type="button"
                :class="{ active: quickOpenMode === 'commands' }"
                @click="switchMode('commands')"
              >
                命令
              </button>
            </div>
          </div>

          <div ref="listRef" class="palette-list">
            <div
              v-for="(item, index) in filteredItems"
              :key="item.key"
              class="palette-item"
              :class="{ active: index === activeIndex, disabled: item.disabled }"
              @mouseenter="activeIndex = index"
              @click="onItemClick(index)"
            >
              <span class="item-icon">
                <AppIcon :name="item.iconName as any" />
              </span>
              <span class="item-main">
                <span class="item-title">{{ item.title }}</span>
                <span v-if="item.subtitle" class="item-subtitle">{{ item.subtitle }}</span>
              </span>
              <span v-if="item.category" class="item-category">{{ item.category }}</span>
              <span v-if="item.shortcut" class="item-shortcut">{{ item.shortcut }}</span>
            </div>
            <div v-if="filteredItems.length === 0" class="palette-empty">
              {{ quickOpenMode === "files" ? "没有匹配的文件" : "没有匹配的命令" }}
            </div>
          </div>

          <div class="palette-footer">
            <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
            <span><kbd>Enter</kbd> 执行</span>
            <span><kbd>Esc</kbd> 关闭</span>
            <span class="footer-hint">Ctrl+P 文件 · Ctrl+Shift+P 命令</span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped lang="less">
.palette-overlay {
  position: fixed;
  inset: 0;
  z-index: 120000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
  background: rgba(10, 14, 24, 0.28);
  backdrop-filter: blur(3px);
  -webkit-app-region: no-drag;
}

.palette-panel {
  width: min(640px, 92vw);
  max-height: min(520px, 76vh);
  display: flex;
  flex-direction: column;
  border: 1px solid color-mix(in srgb, var(--border-color-1) 84%, transparent);
  border-radius: 12px;
  background: color-mix(in srgb, var(--background-color-1) 97%, transparent);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.32);
  overflow: hidden;
  color: var(--text-color-1);
}

.palette-search {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-color-1);

  .palette-search-icon {
    color: var(--text-color-3);
    font-size: 16px;
    flex-shrink: 0;
  }

  .palette-input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    color: var(--text-color-1);
    font-size: 15px;
    line-height: 1.4;

    &::placeholder {
      color: var(--text-color-3);
    }
  }

  .palette-modes {
    display: flex;
    gap: 4px;
    flex-shrink: 0;

    button {
      border: none;
      border-radius: 6px;
      padding: 3px 8px;
      font-size: 12px;
      color: var(--text-color-3);
      background: transparent;
      cursor: pointer;

      &:hover {
        background: var(--hover-color);
      }

      &.active {
        color: var(--primary-color);
        background: color-mix(in srgb, var(--primary-color) 14%, transparent);
      }
    }
  }
}

.palette-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
}

.palette-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  user-select: none;

  .item-icon {
    display: inline-flex;
    align-items: center;
    color: var(--text-color-3);
    font-size: 16px;
    flex-shrink: 0;
  }

  .item-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .item-title {
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .item-subtitle {
    font-size: 12px;
    color: var(--text-color-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .item-category {
    font-size: 11px;
    color: var(--text-color-3);
    background: var(--background-color-2);
    border-radius: 4px;
    padding: 1px 6px;
    flex-shrink: 0;
  }

  .item-shortcut {
    font-size: 11px;
    color: var(--text-color-3);
    border: 1px solid var(--border-color-1);
    border-radius: 4px;
    padding: 1px 6px;
    flex-shrink: 0;
  }

  &.active {
    background: var(--hover-color);

    .item-icon,
    .item-title {
      color: var(--primary-color);
    }
  }

  &.disabled {
    opacity: 0.45;
  }
}

.palette-empty {
  padding: 28px 0;
  text-align: center;
  color: var(--text-color-3);
  font-size: 13px;
}

.palette-footer {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px 14px;
  border-top: 1px solid var(--border-color-1);
  font-size: 12px;
  color: var(--text-color-3);

  kbd {
    display: inline-block;
    min-width: 16px;
    padding: 0 4px;
    margin-right: 2px;
    border: 1px solid var(--border-color-1);
    border-radius: 4px;
    background: var(--background-color-2);
    font-family: inherit;
    font-size: 11px;
    text-align: center;
  }

  .footer-hint {
    margin-left: auto;
  }
}

.palette-fade-enter-active,
.palette-fade-leave-active {
  transition: opacity 0.14s ease;
}

.palette-fade-enter-from,
.palette-fade-leave-to {
  opacity: 0;
}
</style>
