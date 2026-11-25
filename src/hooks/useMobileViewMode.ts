import { computed, ref } from "vue";

/**
 * 移动端编辑器视图模式
 *
 * - instant：即时渲染（默认；光标附近的 Markdown 标记可见）
 * - split：左编辑 / 右预览
 * - wysiwyg：所见即所得（隐藏源码标记）
 */
export type MobileViewMode = "instant" | "split" | "wysiwyg";

interface MobileEditorPresentationTarget {
  isSourceViewEnabled(): boolean;
  setInstantRenderEnabled(enabled: boolean): void;
}

/** 阅读临时隐藏源码，不覆盖用户为编辑选择的视图模式。每个编辑器实例独立保存状态。 */
export function createMobileEditorPresentation(isMobile: boolean) {
  let sourceViewBeforeReading: boolean | undefined;

  return {
    initialConfig(readOnly: boolean, sourceView: boolean, instantRender: boolean) {
      const reading = isMobile && readOnly;
      if (reading) sourceViewBeforeReading ??= sourceView;
      return {
        sourceView: reading ? false : sourceView,
        instantRender: !isMobile || (!readOnly && instantRender),
      };
    },

    sync(
      editor: MobileEditorPresentationTarget,
      readOnly: boolean,
      instantRender: boolean,
      setSourceView: (enabled: boolean) => void
    ): void {
      if (!isMobile) return;
      if (readOnly) {
        sourceViewBeforeReading ??= editor.isSourceViewEnabled();
        editor.setInstantRenderEnabled(false);
        if (editor.isSourceViewEnabled()) setSourceView(false);
        return;
      }

      const sourceView = sourceViewBeforeReading;
      sourceViewBeforeReading = undefined;
      editor.setInstantRenderEnabled(instantRender);
      if (sourceView !== undefined && editor.isSourceViewEnabled() !== sourceView) {
        setSourceView(sourceView);
      }
    },
  };
}

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
