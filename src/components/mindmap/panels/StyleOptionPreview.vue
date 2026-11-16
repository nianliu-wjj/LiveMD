<script setup lang="ts">
/**
 * 下拉选项预览（StyleOptionSelect 内部使用，对应参考项目各 el-option 里的 SVG / 线条示意）
 *
 * - dasharray：边框 / 线条 / 关联线的虚线样式（只画线，名称「虚线1」等放在按钮 title 里）；
 * - width：线宽（数字 + 对应粗细的横条，0 只显示数字）；
 * - shape：节点形状（SVG 路径 + 名称，option.path / option.width 由调用方提供）；
 * - lineStyle：连线风格（直线 / 曲线 / 直连示意 + 名称，option.paths 为路径列表）。
 *
 * 线条一律用 currentColor：列表中选中项为主色，其余跟随主题文字色，暗色界面无需单独处理。
 */
import type { StyleSelectOption } from "./styleOptions";

const props = defineProps<{
  type: "dasharray" | "width" | "shape" | "lineStyle";
  option: StyleSelectOption;
}>();
</script>

<template>
  <span class="mm-style-preview">
    <svg
      v-if="props.type === 'dasharray'"
      width="80"
      height="12"
      viewBox="0 0 80 12"
      aria-hidden="true"
    >
      <line
        x1="2"
        y1="6"
        x2="78"
        y2="6"
        stroke="currentColor"
        stroke-width="2"
        :stroke-dasharray="props.option.value"
      />
    </svg>
    <template v-else-if="props.type === 'width'">
      <span class="mm-style-preview__num">{{ props.option.label }}</span>
      <span
        v-if="Number(props.option.value) > 0"
        class="mm-style-preview__bar"
        :style="{ height: `${props.option.value}px` }"
      />
    </template>
    <template v-else-if="props.type === 'shape'">
      <svg
        v-if="props.option.path"
        width="46"
        height="20"
        :viewBox="`0 0 ${props.option.width ?? 60} 26`"
        aria-hidden="true"
      >
        <path :d="props.option.path" fill="none" stroke="currentColor" stroke-width="2" />
      </svg>
      <span>{{ props.option.label }}</span>
    </template>
    <template v-else>
      <svg width="46" height="20" viewBox="0 0 60 26" aria-hidden="true">
        <path
          v-for="(d, index) in props.option.paths ?? []"
          :key="index"
          :d="d"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        />
      </svg>
      <span>{{ props.option.label }}</span>
    </template>
  </span>
</template>

<style lang="less" scoped>
.mm-style-preview {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;

  svg {
    display: block;
    flex-shrink: 0;
  }
}

.mm-style-preview__num {
  min-width: 14px;
  font-variant-numeric: tabular-nums;
}

.mm-style-preview__bar {
  display: inline-block;
  width: 50px;
  background-color: currentColor;
}
</style>
