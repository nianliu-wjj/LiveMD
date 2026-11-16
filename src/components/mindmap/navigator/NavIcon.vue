<script setup lang="ts">
/**
 * Element UI 字体图标的内联 SVG 替代（仅 navigator/ 目录内使用）
 *
 * 参考项目底部栏、搜索、演示、右键菜单用到 el-icon-minus / plus / close / search / edit / back / right /
 * arrow-right / more，这里用同名 SVG 绘制，颜色跟随文字（currentColor），尺寸默认跟随字号（1em）。
 */
import { computed } from "vue";

type NavIconName =
  | "minus"
  | "plus"
  | "close"
  | "search"
  | "edit"
  | "back"
  | "right"
  | "arrow-right"
  | "more";

const props = withDefaults(defineProps<{ name: NavIconName; size?: string }>(), { size: "1em" });

/** 线条图标路径（24×24 视窗） */
const PATHS: Record<Exclude<NavIconName, "more">, string> = {
  minus: "M5 12h14",
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M18 6L6 18",
  search: "M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 0 0 0-13zM20 20l-4.6-4.6",
  edit: "M4 20h4L18.5 9.5l-4-4L4 16v4zM13 7l4 4",
  back: "M19 12H5M11 6l-6 6 6 6",
  right: "M5 12h14M13 6l6 6-6 6",
  "arrow-right": "M9 6l6 6-6 6",
};

/** 当前图标的线条路径（「更多」用三个圆点绘制，没有路径） */
const path = computed(() => (props.name === "more" ? "" : PATHS[props.name]));
</script>

<template>
  <svg
    class="mm-nav-icon"
    :width="props.size"
    :height="props.size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-if="props.name === 'more'">
      <circle cx="5" cy="12" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.8" fill="currentColor" stroke="none" />
    </template>
    <path v-else :d="path" />
  </svg>
</template>

<style scoped>
.mm-nav-icon {
  display: inline-block;
  flex-shrink: 0;
  vertical-align: middle;
}
</style>
