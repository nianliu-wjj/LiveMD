/**
 * 标题对齐配置：读写 config.heading.align，并同步为 CSS 变量
 *
 * 变量写在 <html> 上（--livemd-heading-align-h1 … h6），由 core/styles/livemd.css 的
 * `.livemd-editor:not(.source-view) hN { text-align: var(...) }` 消费；
 * 写在根元素上而不是 #fontRoot，保证所有编辑器实例（多标签页）与导出预览一致生效，且不依赖挂载时机。
 */
import { computed, watch } from "vue";
import {
  HEADING_LEVEL_KEYS,
  useConfig,
  type HeadingAlign,
  type HeadingAlignConfig,
  type HeadingLevelKey,
} from "./useConfig";

const { config, setConf } = useConfig();

/** 当前各级标题对齐方式 */
const headingAlign = computed<HeadingAlignConfig>(() => config.value.heading.align);

/** 把对齐配置写入根元素 CSS 变量 */
function applyHeadingAlign(align: HeadingAlignConfig): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const level of HEADING_LEVEL_KEYS) {
    root.style.setProperty(`--livemd-heading-align-${level}`, align[level]);
  }
}

/** 设置单个标题级别的对齐方式 */
function setHeadingAlign(level: HeadingLevelKey, align: HeadingAlign): void {
  console.info("[useHeadingAlign] 设置标题对齐:", level, align);
  setConf("heading", { align: { ...config.value.heading.align, [level]: align } });
}

/** 一键把所有标题级别设为同一对齐方式 */
function setAllHeadingAlign(align: HeadingAlign): void {
  console.info("[useHeadingAlign] 全部标题对齐设为:", align);
  const next = Object.fromEntries(HEADING_LEVEL_KEYS.map((level) => [level, align]));
  setConf("heading", { align: next as HeadingAlignConfig });
}

// 配置变化（含设置页修改、其他窗口同步、重置配置）立即生效；immediate 保证启动即应用
watch(headingAlign, (align) => applyHeadingAlign(align), { immediate: true, deep: true });

export default function useHeadingAlign() {
  return {
    headingAlign,
    setHeadingAlign,
    setAllHeadingAlign,
  };
}
