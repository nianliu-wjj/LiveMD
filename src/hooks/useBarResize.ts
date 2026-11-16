/**
 * 右缘栏宽度拖拽（大纲/批注/书签三栏共用）
 *
 * - 左缘把手向左拖 → 宽度增大，夹取在 [minWidth, maxWidth]；
 * - 拖拽结束把宽度写回 localStorage，读取时同样做夹取（脏数据兜底）；
 * - 组件卸载时自动清理 window 级监听（拖拽中途取消 pointercancel/blur 也走统一收尾）。
 */

import { onUnmounted, ref } from "vue";

export interface BarResizeOptions {
  /** localStorage 持久化键（各栏独立） */
  storageKey: string;
  /** 默认宽度（无持久化记录时使用） */
  defaultWidth: number;
  minWidth?: number;
  maxWidth?: number;
}

export default function useBarResize(options: BarResizeOptions) {
  const { storageKey, defaultWidth, minWidth = 240, maxWidth = 480 } = options;

  /** 读取持久化宽度（越界 / 脏数据一律夹取到合法范围） */
  function readStoredWidth(): number {
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? Number(raw) : NaN;
      if (Number.isFinite(parsed)) {
        return Math.min(maxWidth, Math.max(minWidth, parsed));
      }
    } catch {
      // 忽略持久化读取失败
    }
    return defaultWidth;
  }

  const barWidth = ref(readStoredWidth());

  let resizeStartX = 0;
  let resizeStartWidth = 0;
  let resizing = false;

  function addResizeListeners(): void {
    window.addEventListener("pointermove", moveResize);
    window.addEventListener("pointerup", finishResize);
    window.addEventListener("pointercancel", finishResize);
    window.addEventListener("blur", finishResize);
  }

  function removeResizeListeners(): void {
    window.removeEventListener("pointermove", moveResize);
    window.removeEventListener("pointerup", finishResize);
    window.removeEventListener("pointercancel", finishResize);
    window.removeEventListener("blur", finishResize);
  }

  function moveResize(event: PointerEvent): void {
    if (!resizing) return;
    event.preventDefault();
    // 左缘把手向左拖 → 宽度增大
    const width = resizeStartWidth - (event.clientX - resizeStartX);
    barWidth.value = Math.min(maxWidth, Math.max(minWidth, width));
  }

  function finishResize(): void {
    if (!resizing) return;
    resizing = false;
    removeResizeListeners();
    try {
      localStorage.setItem(storageKey, String(barWidth.value));
    } catch {
      // 忽略持久化失败
    }
  }

  /** 绑定到左缘把手的 pointerdown */
  function startResize(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    resizing = true;
    resizeStartX = event.clientX;
    resizeStartWidth = barWidth.value;
    addResizeListeners();
  }

  // 组件卸载兜底：拖拽未结束时卸载也能清理监听
  onUnmounted(removeResizeListeners);

  return { barWidth, startResize };
}
