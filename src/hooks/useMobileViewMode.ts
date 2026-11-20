import { computed, ref } from "vue";

/**
 * 移动端编辑器视图模式
 *
 * - instant：即时渲染（默认；光标附近的 Markdown 标记可见）
 * - split：左编辑 / 右预览
 * - wysiwyg：所见即所得（隐藏源码标记）
 */
export type MobileViewMode = "instant" | "split" | "wysiwyg";

const STORAGE_KEY = "livemd-mobile-view-mode";
const MODES: MobileViewMode[] = ["instant", "split", "wysiwyg"];

function readStoredMode(): MobileViewMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (MODES as string[]).includes(stored)) return stored as MobileViewMode;
  } catch {
    // localStorage 不可用时使用默认值
  }
  return "instant";
}

const mobileViewMode = ref<MobileViewMode>(readStoredMode());

/** 当前视图模式是否要求编辑器显示即时渲染标记 */
const mobileInstantRenderEnabled = computed(() => mobileViewMode.value === "instant");

function setMobileViewMode(mode: MobileViewMode): void {
  mobileViewMode.value = mode;
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}

export default function useMobileViewMode() {
  return {
    mobileViewMode,
    mobileInstantRenderEnabled,
    setMobileViewMode,
  };
}

export { mobileViewMode, mobileInstantRenderEnabled, setMobileViewMode };
