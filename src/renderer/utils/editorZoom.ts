import type { Ref } from "vue";
import type { Tab } from "@/types/tab";
import { computed } from "vue";

export const DEFAULT_ZOOM_PERCENT = 100;
export const MIN_ZOOM_PERCENT = 50;
export const MAX_ZOOM_PERCENT = 300;
export const ZOOM_STEP_PERCENT = 10;

function getZoomPercent(tab: Tab | null | undefined): number {
  return tab?.zoomPercent ?? DEFAULT_ZOOM_PERCENT;
}

function getContentStyle(tab: Tab | null | undefined): { zoom: number } {
  return { zoom: getZoomPercent(tab) / 100 };
}

export function createEditorZoomController(activeTab: Readonly<Ref<Tab | null>>) {
  const hasActiveTab = computed(() => activeTab.value !== null);
  const zoomPercent = computed(() => getZoomPercent(activeTab.value));
  const contentStyle = computed(() => getContentStyle(activeTab.value));
  const canZoomOut = computed(() => hasActiveTab.value && zoomPercent.value > MIN_ZOOM_PERCENT);
  const canZoomIn = computed(() => hasActiveTab.value && zoomPercent.value < MAX_ZOOM_PERCENT);
  const canResetZoom = computed(
    () => hasActiveTab.value && zoomPercent.value !== DEFAULT_ZOOM_PERCENT
  );

  function setZoomPercent(value: number) {
    const tab = activeTab.value;
    if (!tab) return;

    tab.zoomPercent = Math.min(MAX_ZOOM_PERCENT, Math.max(MIN_ZOOM_PERCENT, value));
  }

  function zoomIn() {
    setZoomPercent(zoomPercent.value + ZOOM_STEP_PERCENT);
  }

  function zoomOut() {
    setZoomPercent(zoomPercent.value - ZOOM_STEP_PERCENT);
  }

  function resetZoom() {
    setZoomPercent(DEFAULT_ZOOM_PERCENT);
  }

  return {
    hasActiveTab,
    zoomPercent,
    contentStyle,
    contentStyleFor: getContentStyle,
    canZoomOut,
    canZoomIn,
    canResetZoom,
    zoomIn,
    zoomOut,
    resetZoom,
  };
}
