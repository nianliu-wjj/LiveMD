<script setup lang="ts">
/**
 * 设置页「外观 → 标题位置」：逐级设置 H1~H6 的对齐方式，并支持一键统一
 */
import { computed } from "vue";
import useHeadingAlign from "@/renderer/hooks/useHeadingAlign";
import { HEADING_LEVEL_KEYS, type HeadingAlign } from "@/renderer/hooks/useConfig";

const { headingAlign, setHeadingAlign, setAllHeadingAlign } = useHeadingAlign();

const alignOptions: { value: HeadingAlign; label: string }[] = [
  { value: "left", label: "靠左" },
  { value: "center", label: "居中" },
  { value: "right", label: "靠右" },
];

/** 所有级别取值一致时，高亮「一键设置」中对应的按钮 */
const unifiedAlign = computed<HeadingAlign | null>(() => {
  const values = new Set(HEADING_LEVEL_KEYS.map((level) => headingAlign.value[level]));
  return values.size === 1 ? ([...values][0] as HeadingAlign) : null;
});
</script>

<template>
  <div class="heading-align-setting">
    <div class="setting-item setting-item--all">
      <label class="setting-label">一键设置</label>
      <div class="mode-select">
        <span
          v-for="opt in alignOptions"
          :key="opt.value"
          class="mode-option"
          :class="{ active: unifiedAlign === opt.value }"
          @click="setAllHeadingAlign(opt.value)"
        >
          全部{{ opt.label }}
        </span>
      </div>
    </div>

    <div v-for="(level, index) in HEADING_LEVEL_KEYS" :key="level" class="setting-item">
      <label class="setting-label">
        <span class="level-badge">H{{ index + 1 }}</span>
        {{ index + 1 }} 级标题
      </label>
      <div class="mode-select">
        <span
          v-for="opt in alignOptions"
          :key="opt.value"
          class="mode-option"
          :class="{ active: headingAlign[level] === opt.value }"
          @click="setHeadingAlign(level, opt.value)"
        >
          {{ opt.label }}
        </span>
      </div>
    </div>

    <p class="setting-hint">仅即时渲染模式生效，源码模式中标题始终靠左，便于编辑。</p>
  </div>
</template>

<style lang="less" scoped>
.heading-align-setting {
  padding: 8px 20px 16px;
  background: var(--background-color-2);
  border: 1px solid var(--border-color-1);
  border-radius: 8px;
}

.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-color-1);

  &--all {
    padding-bottom: 14px;
  }
}

.setting-label {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 120px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-color-3);
}

.level-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 20px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
  color: var(--primary-color);
  background: color-mix(in srgb, var(--primary-color) 14%, transparent);
}

.mode-select {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.mode-option {
  padding: 5px 14px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid var(--border-color-1);
  color: var(--text-color-3);
  transition: all 0.2s ease;
  user-select: none;

  &:hover {
    border-color: var(--border-color-2);
    background: var(--background-color-3);
  }

  &.active {
    background: var(--primary-color, #4a9eff);
    color: #fff;
    border-color: var(--primary-color, #4a9eff);
  }
}

.setting-hint {
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--text-color-3);
}

// 窄屏：标签与按钮上下排列
@media (max-width: 640px) {
  .heading-align-setting {
    padding: 8px 12px 12px;
  }

  .setting-item {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
}
</style>
