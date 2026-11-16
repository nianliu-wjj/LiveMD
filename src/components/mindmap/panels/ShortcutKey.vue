<script setup lang="ts">
/**
 * 快捷键面板（对应参考项目 ShortcutKey.vue），面板名 shortcutKey
 *
 * 按「节点操作 / 画布操作 / 大纲操作」分组列出快捷键（shortcutKeyList，Mac 下自动显示 ⌘ 等按键名）。
 */
import MmPanel from "../ui/MmPanel.vue";
import { shortcutKeyList } from "../config";
</script>

<template>
  <MmPanel name="shortcutKey" title="快捷键">
    <div class="mm-shortcut">
      <div v-for="group in shortcutKeyList" :key="group.type" class="mm-shortcut__group">
        <div class="mm-shortcut__title">{{ group.type }}</div>
        <div
          v-for="item in group.list"
          :key="`${item.name}-${item.value}`"
          class="mm-shortcut__item"
        >
          <span v-if="item.icon" class="mm-iconfont mm-shortcut__icon" :class="item.icon" />
          <span class="mm-shortcut__name" :title="item.name">{{ item.name }}</span>
          <span class="mm-shortcut__value" :title="item.value">{{ item.value }}</span>
        </div>
      </div>
    </div>
  </MmPanel>
</template>

<style lang="less" scoped>
.mm-shortcut__group + .mm-shortcut__group {
  margin-top: 22px;
}

.mm-shortcut__title {
  margin-bottom: 14px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color, #333);
}

.mm-shortcut__item {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  font-size: 13px;
}

.mm-shortcut__icon {
  flex-shrink: 0;
  width: 18px;
  font-size: 16px;
  text-align: center;
  color: var(--text-color-2, #666);
}

.mm-shortcut__name {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--text-color-1, #333);
}

.mm-shortcut__value {
  flex-shrink: 0;
  max-width: 55%;
  margin-left: auto;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--text-color-3, #909090);
}
</style>
