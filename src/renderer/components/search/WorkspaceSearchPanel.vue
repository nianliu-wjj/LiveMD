<script setup lang="ts">
/**
 * 工作区全文搜索面板
 *
 * 对应 typora_plugin 的 search_multi / ripgrep：
 * 在整个工作区范围内检索文本，按文件展示匹配行，点击可打开文件并定位。
 */
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import AppIcon from "@/renderer/components/ui/AppIcon.vue";
import emitter from "@/renderer/events";
import useTab from "@/renderer/hooks/useTab";
import useWorkSpace from "@/renderer/hooks/useWorkSpace";
import {
  closeWorkspaceSearch,
  isWorkspaceSearchVisible,
} from "@/renderer/hooks/useWorkspaceSearch";

interface SearchMatch {
  path: string;
  line: number;
  column: number;
  preview: string;
  matchStart: number;
  matchLength: number;
}

interface SearchResponse {
  matches: SearchMatch[];
  truncated: boolean;
  scannedFiles: number;
}

const { currentTab, openFile } = useTab();
const { watchedDirPath } = useWorkSpace();

const query = ref("");
const caseSensitive = ref(false);
const useRegex = ref(false);
const isSearching = ref(false);
const errorMessage = ref("");
const result = ref<SearchResponse | null>(null);
const activeIndex = ref(0);
const inputRef = ref<HTMLInputElement | null>(null);
const listRef = ref<HTMLElement | null>(null);

let searchTimer: ReturnType<typeof setTimeout> | null = null;
let requestSeq = 0;

/** 搜索根目录：优先使用当前工作区，其次使用当前文件所在目录 */
const rootPath = computed(() => {
  if (watchedDirPath.value) return watchedDirPath.value;
  const filePath = currentTab.value?.filePath;
  if (!filePath) return "";
  const parts = filePath.split(/[/\\]/);
  parts.pop();
  return parts.join("\\");
});

const rootLabel = computed(() => {
  if (!rootPath.value) return "未打开工作区";
  const normalized = rootPath.value.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[/\\]/);
  return parts.slice(-2).join("/") || normalized;
});

const matches = computed<SearchMatch[]>(() => result.value?.matches ?? []);
const matchedFileCount = computed(() => new Set(matches.value.map((item) => item.path)).size);

function getFileName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath;
}

function getRelativeDir(filePath: string): string {
  const root = rootPath.value.replace(/[\\/]+$/, "");
  if (root && filePath.startsWith(root)) {
    const relative = filePath.slice(root.length).replace(/^[\\/]+/, "");
    const parts = relative.split(/[/\\]/);
    parts.pop();
    return parts.join("/");
  }
  const parts = filePath.split(/[/\\]/);
  parts.pop();
  return parts.join("/");
}

/** 将预览文本按匹配位置拆分为前 / 中 / 后三段，用于高亮 */
function splitPreview(item: SearchMatch): { before: string; matched: string; after: string } {
  const chars = Array.from(item.preview);
  const start = Math.max(0, Math.min(item.matchStart, chars.length));
  const end = Math.max(start, Math.min(start + item.matchLength, chars.length));
  return {
    before: chars.slice(0, start).join(""),
    matched: chars.slice(start, end).join(""),
    after: chars.slice(end).join(""),
  };
}

/** 打开编辑器内搜索时使用的关键词（正则可以匹配到实际文本） */
function getMatchedText(item: SearchMatch): string {
  const chars = Array.from(item.preview);
  const start = Math.max(0, Math.min(item.matchStart, chars.length));
  const end = Math.max(start, Math.min(start + item.matchLength, chars.length));
  return chars.slice(start, end).join("");
}

async function runSearch(): Promise<void> {
  const keyword = query.value.trim();
  const seq = ++requestSeq;

  if (!keyword) {
    result.value = null;
    errorMessage.value = "";
    isSearching.value = false;
    return;
  }

  if (!rootPath.value) {
    result.value = null;
    errorMessage.value = "请先打开一个文件夹作为工作区";
    isSearching.value = false;
    return;
  }

  isSearching.value = true;
  errorMessage.value = "";

  try {
    const response = await window.electronAPI.searchWorkspace({
      root: rootPath.value,
      query: keyword,
      caseSensitive: caseSensitive.value,
      useRegex: useRegex.value,
      maxResults: 500,
    });
    if (seq !== requestSeq) return;
    result.value = response;
    activeIndex.value = 0;
  } catch (error) {
    if (seq !== requestSeq) return;
    result.value = null;
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    if (seq === requestSeq) {
      isSearching.value = false;
    }
  }
}

function scheduleSearch(): void {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    searchTimer = null;
    void runSearch();
  }, 250);
}

watch([query, caseSensitive, useRegex], scheduleSearch);

watch(isWorkspaceSearchVisible, async (visible) => {
  if (!visible) {
    requestSeq += 1;
    if (searchTimer) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
    isSearching.value = false;
    return;
  }
  await nextTick();
  inputRef.value?.focus();
  inputRef.value?.select();
  if (query.value.trim()) {
    void runSearch();
  }
});

onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer);
});

function setActiveIndex(index: number): void {
  if (matches.value.length === 0) return;
  activeIndex.value = (index + matches.value.length) % matches.value.length;
  nextTick(() => {
    const element = listRef.value?.querySelector<HTMLElement>(".ws-result.active");
    element?.scrollIntoView({ block: "nearest" });
  });
}

function onInputKeydown(event: KeyboardEvent): void {
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
      void openMatch(matches.value[activeIndex.value]);
      break;
    case "Escape":
      event.preventDefault();
      closeWorkspaceSearch();
      break;
  }
}

async function openMatch(item: SearchMatch | undefined): Promise<void> {
  if (!item) return;
  const keyword = getMatchedText(item) || query.value.trim();
  closeWorkspaceSearch();

  const tab = await openFile(item.path);
  if (!tab) return;
  await nextTick();
  // 等待标签页切换完成后再打开编辑器内查找
  setTimeout(() => {
    emitter.emit("editor:search", { replace: false, query: keyword });
  }, 60);
}
</script>

<template>
  <Teleport to="body">
    <Transition name="ws-search-fade">
      <div
        v-if="isWorkspaceSearchVisible"
        class="ws-search-overlay"
        @click.self="closeWorkspaceSearch"
        @contextmenu.prevent
      >
        <div class="ws-search-panel" role="dialog" aria-label="在工作区中搜索">
          <div class="ws-search-header">
            <AppIcon name="search" class="ws-search-icon" />
            <input
              ref="inputRef"
              v-model="query"
              class="ws-search-input"
              type="text"
              placeholder="在工作区中搜索文本…"
              spellcheck="false"
              @keydown="onInputKeydown"
            />
            <button type="button" class="ws-close-btn" title="关闭" @click="closeWorkspaceSearch">
              <AppIcon name="close" />
            </button>
          </div>

          <div class="ws-search-options">
            <button
              type="button"
              class="ws-option-btn"
              :class="{ active: caseSensitive }"
              title="区分大小写"
              @click="caseSensitive = !caseSensitive"
            >
              Aa
            </button>
            <button
              type="button"
              class="ws-option-btn"
              :class="{ active: useRegex }"
              title="使用正则表达式"
              @click="useRegex = !useRegex"
            >
              .*
            </button>
            <span class="ws-root" :title="rootPath">{{ rootLabel }}</span>
          </div>

          <div class="ws-search-status">
            <template v-if="isSearching">正在搜索…</template>
            <template v-else-if="errorMessage">{{ errorMessage }}</template>
            <template v-else-if="result">
              在 {{ matchedFileCount }} 个文件中找到 {{ matches.length }} 处
              <span class="ws-scanned">（扫描 {{ result.scannedFiles }} 个文件）</span>
              <span v-if="result.truncated" class="ws-truncated">结果过多，已截断</span>
            </template>
            <template v-else>输入关键词开始搜索</template>
          </div>

          <div ref="listRef" class="ws-search-results">
            <template v-if="matches.length > 0">
              <template v-for="(item, index) in matches" :key="`${item.path}:${item.line}:${item.column}`">
                <div
                  v-if="index === 0 || matches[index - 1].path !== item.path"
                  class="ws-file-header"
                >
                  <AppIcon name="markdown" class="ws-file-icon" />
                  <span class="ws-file-name">{{ getFileName(item.path) }}</span>
                  <span class="ws-file-dir">{{ getRelativeDir(item.path) }}</span>
                </div>
                <div
                  class="ws-result"
                  :class="{ active: index === activeIndex }"
                  @mouseenter="activeIndex = index"
                  @click="openMatch(item)"
                >
                  <span class="ws-line-number">{{ item.line }}</span>
                  <span class="ws-preview">
                    <span>{{ splitPreview(item).before }}</span
                    ><mark>{{ splitPreview(item).matched }}</mark
                    ><span>{{ splitPreview(item).after }}</span>
                  </span>
                </div>
              </template>
            </template>
            <div v-else-if="!isSearching && !errorMessage" class="ws-empty">
              {{
                query.trim()
                  ? "未找到匹配内容"
                  : rootPath
                    ? "输入关键词搜索工作区内的文本文件"
                    : "请先打开一个文件夹作为工作区"
              }}
            </div>
          </div>

          <div class="ws-search-footer">
            <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
            <span><kbd>Enter</kbd> 打开</span>
            <span><kbd>Esc</kbd> 关闭</span>
            <span class="ws-footer-hint">Ctrl+Shift+F</span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped lang="less">
.ws-search-overlay {
  position: fixed;
  inset: 0;
  z-index: 120000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 10vh;
  background: rgba(10, 14, 24, 0.28);
  backdrop-filter: blur(3px);
  -webkit-app-region: no-drag;
}

.ws-search-panel {
  width: min(760px, 94vw);
  max-height: min(600px, 80vh);
  display: flex;
  flex-direction: column;
  border: 1px solid color-mix(in srgb, var(--border-color-1) 84%, transparent);
  border-radius: 12px;
  background: color-mix(in srgb, var(--background-color-1) 97%, transparent);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.32);
  overflow: hidden;
  color: var(--text-color-1);
}

.ws-search-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-color-1);

  .ws-search-icon {
    color: var(--text-color-3);
    font-size: 16px;
    flex-shrink: 0;
  }

  .ws-search-input {
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

  .ws-close-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-color-3);
    cursor: pointer;

    &:hover {
      background: var(--hover-color);
      color: var(--text-color-1);
    }
  }
}

.ws-search-options {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-bottom: 1px solid var(--border-color-1);

  .ws-option-btn {
    min-width: 30px;
    height: 22px;
    padding: 0 6px;
    border: 1px solid var(--border-color-1);
    border-radius: 5px;
    background: transparent;
    color: var(--text-color-3);
    font-size: 11px;
    cursor: pointer;

    &:hover {
      background: var(--hover-color);
    }

    &.active {
      color: var(--primary-color);
      border-color: var(--primary-color);
      background: color-mix(in srgb, var(--primary-color) 10%, transparent);
    }
  }

  .ws-root {
    margin-left: auto;
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    color: var(--text-color-3);
  }
}

.ws-search-status {
  padding: 6px 14px;
  font-size: 12px;
  color: var(--text-color-3);

  .ws-scanned,
  .ws-truncated {
    margin-left: 6px;
    opacity: 0.8;
  }

  .ws-truncated {
    color: #d97706;
  }
}

.ws-search-results {
  flex: 1;
  overflow-y: auto;
  padding: 4px 6px 8px;
}

.ws-file-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 8px 4px;
  font-size: 12px;
  color: var(--text-color-2);

  .ws-file-icon {
    font-size: 13px;
    color: var(--text-color-3);
  }

  .ws-file-name {
    font-weight: 600;
  }

  .ws-file-dir {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-color-3);
    font-size: 11px;
  }
}

.ws-result {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  line-height: 1.5;

  .ws-line-number {
    min-width: 34px;
    flex-shrink: 0;
    text-align: right;
    color: var(--text-color-3);
    font-variant-numeric: tabular-nums;
  }

  .ws-preview {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: pre;
    text-overflow: ellipsis;
    font-family:
      ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;

    mark {
      background: color-mix(in srgb, var(--primary-color, #4a9eff) 28%, transparent);
      color: inherit;
      border-radius: 2px;
      padding: 0 1px;
    }
  }

  &.active {
    background: var(--hover-color);

    .ws-line-number {
      color: var(--primary-color);
    }
  }
}

.ws-empty {
  padding: 36px 0;
  text-align: center;
  color: var(--text-color-3);
  font-size: 13px;
}

.ws-search-footer {
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

  .ws-footer-hint {
    margin-left: auto;
  }
}

.ws-search-fade-enter-active,
.ws-search-fade-leave-active {
  transition: opacity 0.14s ease;
}

.ws-search-fade-enter-from,
.ws-search-fade-leave-to {
  opacity: 0;
}
</style>
