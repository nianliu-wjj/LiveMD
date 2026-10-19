/**
 * 右缘三栏（大纲/批注/书签）互斥协议工具
 *
 * 三栏同占窗口右缘，任一栏展开前必须先收起另外两栏（互斥协议）：
 * 展开方调用 hideOtherEdgeBars(自己) 向其余两栏发送收起请求，
 * 各栏自行订阅自己的 *:hide-bar 事件完成收起。
 */

import { computed, reactive, watch } from "vue";
import emitter from "@/renderer/events";

/** 右缘栏标识 */
export type RightEdgeBarKind = "outline" | "annotations" | "bookmarks";

/** 各栏的收起请求事件名 */
const HIDE_EVENTS: Record<
  RightEdgeBarKind,
  "outline:hide-bar" | "annotations:hide-bar" | "bookmarks:hide-bar"
> = {
  outline: "outline:hide-bar",
  annotations: "annotations:hide-bar",
  bookmarks: "bookmarks:hide-bar",
};

const ALL_BAR_KINDS = Object.keys(HIDE_EVENTS) as RightEdgeBarKind[];

/** 展开某一栏前调用：向其余两栏发送收起请求（互斥协议） */
export function hideOtherEdgeBars(self: RightEdgeBarKind): void {
  for (const kind of ALL_BAR_KINDS) {
    if (kind !== self) {
      emitter.emit(HIDE_EVENTS[kind]);
    }
  }
}

// ============ 展开宽度登记（未展开栏的贴边便签让位） ============

/** 各栏展开状态与当前宽度（互斥协议保证同一时刻至多一栏展开） */
const barStates = reactive<Record<RightEdgeBarKind, { visible: boolean; width: number }>>({
  outline: { visible: false, width: 0 },
  annotations: { visible: false, width: 0 },
  bookmarks: { visible: false, width: 0 },
});

/** 展开栏的宽度（无展开栏时为 0），供便签定位使用 */
export const rightEdgeOpenWidth = computed(() => {
  for (const kind of ALL_BAR_KINDS) {
    const state = barStates[kind];
    if (state.visible) return state.width;
  }
  return 0;
});

/** 各栏上报自身可见性与宽度（watch 驱动；取实际展开者的宽度，与上报顺序无关） */
export function reportEdgeBarState(kind: RightEdgeBarKind, visible: boolean, width: number): void {
  barStates[kind].visible = visible;
  barStates[kind].width = width;
}

// 同步到根节点 CSS 变量：.right-edge-tab 的 right 偏移据此让位到展开面板左侧
watch(
  rightEdgeOpenWidth,
  (width) => {
    if (typeof document === "undefined") return;
    document.documentElement.style.setProperty("--right-edge-open-width", `${Math.round(width)}px`);
  },
  { immediate: true }
);
