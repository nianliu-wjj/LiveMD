<script setup lang="ts">
/**
 * 批注栏容器：贴窗口右缘悬浮列
 *
 * - 布局位置：position: fixed 贴右缘（不进 editorArea 的 flex 布局——现有 outline-*
 *   状态机是"侧栏动画期间用 transform、结束后切 flex"的精细两段式切换，参与该布局
 *   需要复制整套状态机且有回归风险。代价是窄窗口时可能遮住文档右缘文字，用"贴边收起"缓解）
 * - 宽度拖拽（240–480，livemd-annotation-bar-width 持久化）
 * - 贴边收起/展开：收起态在右缘渲染竖排便签按钮，**无条件渲染**（无批注也可展开，
 *   空态提示输入方式，§8.6①）
 * - 列表只展示 done 态条目（编辑中的批注在对话框内，§8.4）
 * - 右缘三栏互斥协议：展开前收起大纲栏与书签栏
 */
import { onMounted, onUnmounted, watch } from "vue";
import AppIcon from "@/renderer/components/ui/AppIcon.vue";
import emitter from "@/renderer/events";
import useBarResize from "@/renderer/hooks/useBarResize";
import useAnnotations from "@/renderer/hooks/useAnnotations";
import { hideOtherEdgeBars, reportEdgeBarState } from "@/renderer/utils/rightEdgeBars";
import AnnotationCard from "./AnnotationCard.vue";

const { doneEntries, activeAnnotationId, barVisible, setBarVisible } = useAnnotations();

// 宽度拖拽（240–480 夹取 + livemd-annotation-bar-width 持久化）：与大纲/书签栏共用 useBarResize
const { barWidth, startResize } = useBarResize({
  storageKey: "livemd-annotation-bar-width",
  defaultWidth: 320,
});

// 上报展开状态与宽度：其余两栏便签让位到本面板左侧（右缘互斥协议工具）
watch(
  [barVisible, barWidth],
  ([visible, width]) => reportEdgeBarState("annotations", visible, width),
  { immediate: true }
);

/** 打开批注栏，并收起大纲栏与书签栏（右缘三栏互斥协议） */
function showBar(): void {
  setBarVisible(true);
  hideOtherEdgeBars("annotations");
}

/** 大纲栏/书签栏请求收起批注栏（互斥协议） */
function handleHideBar(): void {
  setBarVisible(false);
}

// 激活卡片变化时自动展开批注栏（点击文档高亮联动）
watch(activeAnnotationId, (id) => {
  if (id && !barVisible.value) {
    // 自动展开同样遵守右缘互斥协议：走 showBar 以收起另外两栏
    showBar();
  }
});

onMounted(() => {
  emitter.on("annotations:hide-bar", handleHideBar);
});

onUnmounted(() => {
  emitter.off("annotations:hide-bar", handleHideBar);
});
</script>

<template>
  <!-- 贴边收起态：竖排便签按钮（始终渲染，无批注也可展开） -->
  <button
    v-if="!barVisible"
    type="button"
    class="right-edge-tab right-edge-tab--slot-2"
    title="展开批注栏"
    @click="showBar"
  >
    批注
  </button>

  <!-- 展开态：右缘悬浮栏 -->
  <div v-else class="right-edge-bar" :style="{ width: `${barWidth}px` }">
    <div class="right-edge-bar__resize-handle" @pointerdown="startResize" />
    <div class="right-edge-bar__header">
      <span class="right-edge-bar__title">批注</span>
    </div>

    <!-- 折叠把手：吸附左边框垂直中点 -->
    <button
      type="button"
      class="right-edge-bar__fold"
      title="收起批注栏"
      @click="setBarVisible(false)"
    >
      <AppIcon name="arrow-right" />
    </button>
    <div class="right-edge-bar__list annotation-bar__list">
      <template v-if="doneEntries.length > 0">
        <div v-for="entry in doneEntries" :key="entry.id" class="annotation-bar__item">
          <AnnotationCard :entry="entry" :active="activeAnnotationId === entry.id" />
        </div>
      </template>
      <div v-else class="right-edge-bar__empty">
        <AppIcon name="edit" class="right-edge-bar__empty-icon" />
        <p class="right-edge-bar__empty-text">暂无批注</p>
        <p class="right-edge-bar__empty-hint">选中文字后右键选择「批注」即可添加</p>
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
// 卡片列表间距：卡片场景需要更大的内边距与间距（覆盖共享列表骨架的默认值）
.annotation-bar__list {
  padding: 10px;
  gap: 8px;
}

// 条目过多时不随 flex 容器压缩（否则行高被压扁导致文字互相叠压），改为容器滚动
.annotation-bar__item {
  flex-shrink: 0;
}
</style>
