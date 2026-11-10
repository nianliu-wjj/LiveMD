<script setup lang="ts">
/**
 * 画布滚动条（对应参考项目 Scrollbar.vue，基于引擎 Scrollbar 插件）
 *
 * 根组件只在 localConfig.isShowScrollbar 开启时动态加载插件并渲染本组件。
 * - 挂载后把两条轨道的长度告诉插件（setScrollBarWrapSize），窗口尺寸变化时防抖 300ms 重新告知；
 * - 监听总线 scrollbar_change（插件派发的滑块位置与大小，百分比）更新样式；
 * - 拖动滑块 / 点击轨道调用插件的 onMousedown / onClick。
 * 与参考项目的差异：挂载时主动计算一次滑块（插件刚加载时要等下一次渲染才派发）；
 * 挂载时插件若还没加载，收到第一次 scrollbar_change 时再补设轨道尺寸。
 */
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useBusEvent, useMindMapContext } from "../context";

interface ScrollbarData {
  vertical: { top: number; height: number };
  horizontal: { left: number; width: number };
}

const { mindMap } = useMindMapContext();

const verticalScrollbarRef = ref<HTMLElement | null>(null);
const horizontalScrollbarRef = ref<HTMLElement | null>(null);
const verticalScrollbarStyle = ref<Record<string, string>>({});
const horizontalScrollbarStyle = ref<Record<string, string>>({});
/** 是否已把轨道尺寸告诉插件 */
let wrapSizeReady = false;
let resizeTimer: ReturnType<typeof setTimeout> | null = null;

/** 向插件传递滚动条轨道的宽高 */
function setScrollBarWrapSize(): boolean {
  const plugin = mindMap.value?.scrollbar;
  if (!plugin || !horizontalScrollbarRef.value || !verticalScrollbarRef.value) return false;
  const { width } = horizontalScrollbarRef.value.getBoundingClientRect();
  const { height } = verticalScrollbarRef.value.getBoundingClientRect();
  plugin.setScrollBarWrapSize(width, height);
  console.debug("[MindMap/Scrollbar] 轨道尺寸:", width, height);
  return true;
}

/** 窗口尺寸变化 */
function onResize(): void {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    resizeTimer = null;
    wrapSizeReady = setScrollBarWrapSize();
  }, 300);
}

/** 按插件数据更新滑块位置和大小 */
function updateScrollbar({ vertical, horizontal }: ScrollbarData): void {
  if (!wrapSizeReady) wrapSizeReady = setScrollBarWrapSize();
  verticalScrollbarStyle.value = {
    top: `${vertical.top}%`,
    height: `${vertical.height}%`,
  };
  horizontalScrollbarStyle.value = {
    left: `${horizontal.left}%`,
    width: `${horizontal.width}%`,
  };
}

function onVerticalScrollbarMousedown(e: MouseEvent): void {
  mindMap.value?.scrollbar?.onMousedown(e, "vertical");
}

function onVerticalScrollbarClick(e: MouseEvent): void {
  mindMap.value?.scrollbar?.onClick(e, "vertical");
}

function onHorizontalScrollbarMousedown(e: MouseEvent): void {
  mindMap.value?.scrollbar?.onMousedown(e, "horizontal");
}

function onHorizontalScrollbarClick(e: MouseEvent): void {
  mindMap.value?.scrollbar?.onClick(e, "horizontal");
}

useBusEvent("scrollbar_change", updateScrollbar);

onMounted(() => {
  wrapSizeReady = setScrollBarWrapSize();
  const plugin = mindMap.value?.scrollbar;
  if (plugin) {
    try {
      updateScrollbar(plugin.calculationScrollbar());
    } catch (error) {
      // 首次渲染尚未完成时画布尺寸可能为 0，等插件下一次派发 scrollbar_change 即可
      console.debug("[MindMap/Scrollbar] 初始计算跳过:", error);
    }
  } else {
    console.warn("[MindMap/Scrollbar] 滚动条插件尚未加载，等待 scrollbar_change");
  }
  window.addEventListener("resize", onResize);
});

onBeforeUnmount(() => {
  if (resizeTimer) clearTimeout(resizeTimer);
  window.removeEventListener("resize", onResize);
});
</script>

<template>
  <div class="mm-scrollbar">
    <!-- 竖向 -->
    <div
      ref="verticalScrollbarRef"
      class="mm-scrollbar__track mm-scrollbar__track--vertical"
      @click="onVerticalScrollbarClick"
    >
      <div
        class="mm-scrollbar__thumb"
        :style="verticalScrollbarStyle"
        @click.stop
        @mousedown="onVerticalScrollbarMousedown"
      />
    </div>
    <!-- 横向 -->
    <div
      ref="horizontalScrollbarRef"
      class="mm-scrollbar__track mm-scrollbar__track--horizontal"
      @click="onHorizontalScrollbarClick"
    >
      <div
        class="mm-scrollbar__thumb"
        :style="horizontalScrollbarStyle"
        @click.stop
        @mousedown="onHorizontalScrollbarMousedown"
      />
    </div>
  </div>
</template>

<style lang="less" scoped>
.mm-scrollbar__track {
  position: absolute;
  z-index: 1000;
  overflow: hidden;
  border-radius: 10px;
  background-color: var(--background-color-2, #f5f5f5);

  &--vertical {
    top: 100px;
    bottom: 100px;
    left: 20px;
    width: 10px;

    .mm-scrollbar__thumb {
      left: 0;
      width: 10px;
    }
  }

  &--horizontal {
    left: 100px;
    right: 100px;
    bottom: 70px;
    height: 10px;

    .mm-scrollbar__thumb {
      top: 0;
      height: 10px;
    }
  }
}

.mm-scrollbar__thumb {
  position: absolute;
  border-radius: 10px;
  background-color: color-mix(in srgb, var(--text-color-3, #999) 55%, transparent);
  cursor: pointer;

  &:hover {
    background-color: color-mix(in srgb, var(--text-color-3, #999) 80%, transparent);
  }
}
</style>
