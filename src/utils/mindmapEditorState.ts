/**
 * 思维导图全屏编辑器的打开状态（跨组件共享，供全局快捷键让路）
 *
 * 编辑器打开时 LiveMD 自身的全局快捷键（Ctrl+S 保存文件、Ctrl+P 快速打开、Ctrl+W 关闭标签页、
 * Ctrl+Tab 切换标签页、Ctrl+K 插入链接等）不应再响应：它们会作用在被遮住的文档上，
 * 而且 Ctrl+S 等键在思维导图编辑器里有自己的含义（写回思维导图）。
 * 用 <html data-mindmap-editing> 标记，各全局监听入口先调用 isMindMapEditorOpen() 判断。
 */

/** 标记思维导图编辑器打开 / 关闭 */
export function setMindMapEditorOpen(open: boolean): void {
  if (typeof document === "undefined") return;
  if (open) {
    document.documentElement.dataset.mindmapEditing = "true";
  } else {
    delete document.documentElement.dataset.mindmapEditing;
  }
}

/** 思维导图编辑器是否打开 */
export function isMindMapEditorOpen(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.mindmapEditing === "true";
}
