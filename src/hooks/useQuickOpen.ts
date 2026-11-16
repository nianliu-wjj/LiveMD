import { ref } from "vue";

/**
 * 快速打开 / 命令面板的全局开关状态
 *
 * - files：Ctrl+P，在工作区文件、最近文件、已打开标签页中快速跳转（对应 Typora 快速打开）
 * - commands：Ctrl+Shift+P，搜索并执行应用/编辑器命令（对应 typora_plugin 命令面板）
 */
export type QuickOpenMode = "files" | "commands";

export const isQuickOpenVisible = ref(false);
export const quickOpenMode = ref<QuickOpenMode>("files");

/** 打开面板；未指定模式时沿用上次模式 */
export function openQuickOpen(mode?: QuickOpenMode): void {
  if (mode) {
    quickOpenMode.value = mode;
  }
  isQuickOpenVisible.value = true;
}

export function closeQuickOpen(): void {
  isQuickOpenVisible.value = false;
}

export function toggleQuickOpen(mode: QuickOpenMode): void {
  if (isQuickOpenVisible.value && quickOpenMode.value === mode) {
    closeQuickOpen();
    return;
  }
  openQuickOpen(mode);
}

export default function useQuickOpen() {
  return {
    isQuickOpenVisible,
    quickOpenMode,
    openQuickOpen,
    closeQuickOpen,
    toggleQuickOpen,
  };
}
