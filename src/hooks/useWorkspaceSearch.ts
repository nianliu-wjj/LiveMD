import { ref } from "vue";
import { closeQuickOpen } from "./useQuickOpen";

/**
 * 工作区全文搜索面板的全局开关
 *
 * 对应 typora_plugin 的 search_multi / ripgrep：在整个工作区中检索文本，
 * 结果可直接打开对应文件并定位到匹配内容。
 */
export const isWorkspaceSearchVisible = ref(false);

export function openWorkspaceSearch(): void {
  closeQuickOpen();
  isWorkspaceSearchVisible.value = true;
}

export function closeWorkspaceSearch(): void {
  isWorkspaceSearchVisible.value = false;
}

export function toggleWorkspaceSearch(): void {
  isWorkspaceSearchVisible.value = !isWorkspaceSearchVisible.value;
}

export default function useWorkspaceSearch() {
  return {
    isWorkspaceSearchVisible,
    openWorkspaceSearch,
    closeWorkspaceSearch,
    toggleWorkspaceSearch,
  };
}
