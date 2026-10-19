<script setup lang="ts">
/**
 * 左侧边栏容器（工作区文件树）
 *
 * 大纲与书签已迁移至窗口右缘的 OutlineBar / BookmarkBar（右缘三栏结构，
 * 见 docs/2026-10-28-feature-implementation-guide.md 第 2 节），本组件只保留文件树与侧栏外观。
 */
import { onMounted, onUnmounted } from "vue";
import WorkSpace from "@/renderer/components/workspace/WorkSpace.vue";
import { toggleShowOutline } from "@/renderer/hooks/useOutline";
import emitter from "@/renderer/events";

/** sidebar:set-tab（页签已迁出，这里仅保留“展开左侧边栏”的入口语义） */
function handleSidebarSetTab(payload?: { tab?: "file" | "outline"; show?: boolean }): void {
  if (payload?.show) {
    toggleShowOutline(true);
  }
}

onMounted(() => {
  emitter.on("sidebar:set-tab", handleSidebarSetTab);
});
onUnmounted(() => {
  emitter.off("sidebar:set-tab", handleSidebarSetTab);
});
</script>

<template>
  <div class="OutlineBox">
    <svg viewBox="0 0 5 5" fill="none" xmlns="http://www.w3.org/2000/svg" class="OutlineBoxBefore">
      <path d="M0 -1.31134e-07L3 0C1 -8.74228e-08 -4.37114e-08 1 -1.31134e-07 3L0 -1.31134e-07Z" />
    </svg>

    <svg viewBox="0 0 5 5" fill="none" xmlns="http://www.w3.org/2000/svg" class="OutlineBoxAfter">
      <path d="M0 5L5 5C1.66667 5 7.28523e-08 3.33333 2.18557e-07 -2.18557e-07L0 5Z" />
    </svg>

    <div class="content-container">
      <WorkSpace />
    </div>
  </div>
</template>

<style lang="less" scoped>
.OutlineBox {
  width: 100%;
  height: 100%;
  background: var(--background-color-2);
  display: flex;
  flex-direction: column;
  position: relative;

  &::-webkit-scrollbar {
    display: none;
  }

  .OutlineBoxBefore {
    height: 10px;
    width: 10px;
    position: absolute;
    right: -10px;
    top: 0;
    fill: var(--background-color-2);
    z-index: 999;
  }
  .OutlineBoxAfter {
    height: 10px;
    width: 10px;
    position: absolute;
    right: -10px;
    bottom: 0;
    fill: var(--background-color-2);
    z-index: 999;
  }

  .content-container {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: thin;
    scrollbar-color: color-mix(in srgb, var(--text-color-3) 34%, transparent) transparent;

    &::-webkit-scrollbar {
      width: 8px;
    }

    &::-webkit-scrollbar-track {
      background: transparent;
    }

    &::-webkit-scrollbar-thumb {
      background: color-mix(in srgb, var(--text-color-3) 28%, transparent);
      border: 2px solid transparent;
      border-radius: 999px;
      background-clip: content-box;
    }

    &::-webkit-scrollbar-thumb:hover {
      background: color-mix(in srgb, var(--text-color-3) 45%, transparent);
      background-clip: content-box;
    }
  }
}
</style>
