<script setup lang="ts">
/**
 * 右侧面板容器（对应参考项目 Sidebar.vue）：标题 + 关闭按钮 + 可滚动内容区
 *
 * 用法：<MmPanel name="theme" title="主题">…</MmPanel>，仅当 activeSidebar === name 时显示。
 */
import { useMindMapContext, type MindMapSidebarName } from "../context";

const props = defineProps<{
  name: MindMapSidebarName;
  title: string;
}>();

const { activeSidebar } = useMindMapContext();

function close(): void {
  activeSidebar.value = "";
}
</script>

<template>
  <aside v-if="activeSidebar === props.name" class="mm-panel" @keydown.stop>
    <div class="mm-panel__header">
      <span class="mm-panel__title">{{ props.title }}</span>
      <button type="button" class="mm-panel__close" title="关闭" @click="close">×</button>
    </div>
    <div class="mm-panel__body">
      <slot />
    </div>
  </aside>
</template>

<style lang="less" scoped>
.mm-panel {
  position: absolute;
  top: 110px;
  right: 72px;
  bottom: 70px;
  z-index: 1100;
  width: 320px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-color-1, #e1e4e8);
  border-radius: 8px;
  background: var(--background-color-1, #fff);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
}

.mm-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color-1, #e1e4e8);
}

.mm-panel__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color, #333);
}

.mm-panel__close {
  border: none;
  background: transparent;
  font-size: 18px;
  line-height: 1;
  color: var(--text-color-3, #999);
  cursor: pointer;
}

.mm-panel__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 16px 20px;
  font-size: 13px;
  color: var(--text-color-1, #333);
}

@media (max-width: 760px) {
  .mm-panel {
    top: auto;
    left: 0;
    right: 0;
    bottom: 0;
    width: auto;
    height: 55%;
    border-radius: 12px 12px 0 0;
  }
}
</style>
