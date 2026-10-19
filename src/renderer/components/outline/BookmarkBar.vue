<script setup lang="ts">
/**
 * 书签栏容器：贴窗口右缘悬浮列（右缘三栏结构，第 3 槽，§2/§5）
 *
 * - 布局与 OutlineBar/AnnotationBar 同构：position: fixed 贴右缘，不进 editorArea 的 flex 布局；
 * - 宽度拖拽（240–480，livemd-bookmark-bar-width 持久化）与贴边便签、栏骨架
 *   复用 useBarResize 与右缘公共样式（styles/right-edge.less）；
 * - 可见性持久化：livemd-bookmark-bar-visible；
 * - 右缘三栏互斥协议：展开前收起大纲栏与批注栏（hideOtherEdgeBars）；
 * - 外部展开入口：emitter bookmarks:show-bar（命令面板「打开书签列表」）；
 * - 列表内容复用 BookmarkList（左栏书签页签迁出后，此处为唯一使用方）。
 */
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import AppIcon from "@/renderer/components/ui/AppIcon.vue";
import emitter from "@/renderer/events";
import useBarResize from "@/renderer/hooks/useBarResize";
import useBookmarks from "@/renderer/hooks/useBookmarks";
import { hideOtherEdgeBars, reportEdgeBarState } from "@/renderer/utils/rightEdgeBars";
import BookmarkList from "./BookmarkList.vue";

const BAR_VISIBLE_KEY = "livemd-bookmark-bar-visible";

// 启动一律折叠（首页需求）：不读取上次的展开状态；会话内展开/收起仍写入该键
const barVisible = ref(false);

function setBarVisible(visible: boolean): void {
  barVisible.value = visible;
  try {
    localStorage.setItem(BAR_VISIBLE_KEY, String(visible));
  } catch {
    // 忽略持久化失败
  }
}

/** 打开书签栏（贴边便签/命令面板入口），并收起大纲栏与批注栏（互斥协议） */
function showBar(): void {
  setBarVisible(true);
  hideOtherEdgeBars("bookmarks");
}

/** 大纲栏/批注栏请求收起书签栏（互斥协议） */
function handleHideBar(): void {
  setBarVisible(false);
}

// 宽度拖拽（240–480 夹取 + livemd-bookmark-bar-width 持久化）：与大纲/批注栏共用
const { barWidth, startResize } = useBarResize({
  storageKey: "livemd-bookmark-bar-width",
  defaultWidth: 300,
});

// 上报展开状态与宽度：其余两栏便签让位到本面板左侧（右缘互斥协议工具）
watch(
  [barVisible, barWidth],
  ([visible, width]) => reportEdgeBarState("bookmarks", visible, width),
  { immediate: true }
);

const { bookmarks } = useBookmarks();
const totalCount = computed(() =>
  Object.values(bookmarks.value).reduce((count, entries) => count + entries.length, 0)
);

onMounted(() => {
  emitter.on("bookmarks:hide-bar", handleHideBar);
  emitter.on("bookmarks:show-bar", showBar);
});

onUnmounted(() => {
  emitter.off("bookmarks:hide-bar", handleHideBar);
  emitter.off("bookmarks:show-bar", showBar);
});
</script>

<template>
  <!-- 贴边收起态：第 3 槽竖排便签（大纲 → 批注 → 书签 自上而下） -->
  <button
    v-if="!barVisible"
    type="button"
    class="right-edge-tab right-edge-tab--slot-3"
    title="展开书签栏"
    @click="showBar"
  >
    书签
  </button>

  <!-- 展开态：右缘悬浮栏 -->
  <div v-else class="right-edge-bar" :style="{ width: `${barWidth}px` }">
    <div class="right-edge-bar__resize-handle" @pointerdown="startResize" />
    <div class="right-edge-bar__header">
      <span class="bookmark-bar__heading">
        <span class="right-edge-bar__title">书签</span>
        <span v-if="totalCount > 0" class="bookmark-bar__count">{{ totalCount }}</span>
      </span>
    </div>

    <!-- 折叠把手：吸附左边框垂直中点 -->
    <button
      type="button"
      class="right-edge-bar__fold"
      title="收起书签栏"
      @click="setBarVisible(false)"
    >
      <AppIcon name="arrow-right" />
    </button>

    <div class="right-edge-bar__list">
      <BookmarkList />
    </div>
  </div>
</template>

<style lang="less" scoped>
.bookmark-bar__heading {
  display: flex;
  align-items: center;
  gap: 6px;
}

.bookmark-bar__count {
  min-width: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--background-color-1);
  color: var(--text-color-3);
  font-size: 11px;
  line-height: 16px;
  text-align: center;
}
</style>
