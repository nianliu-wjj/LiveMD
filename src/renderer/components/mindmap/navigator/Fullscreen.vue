<script setup lang="ts">
/**
 * 底部栏全屏按钮（对应参考项目 Fullscreen.vue）
 *
 * - 全屏查看：只让画布（引擎容器 mindMap.el）全屏；
 * - 全屏编辑：让整个编辑器根元素 .mindmap-editor 全屏（参考项目为 document.body），工具栏、面板仍可用；
 *   已处于全屏时再点则退出（toggleFullscreen）。
 * 全屏状态变化后让引擎重新读取画布尺寸与位置（参考项目在 onfullscreenchange 里 resize；
 * 根组件的 ResizeObserver 只在尺寸变化时触发，这里补一次保证 elRect 及时更新）。
 */
import { onBeforeUnmount } from "vue";
import autotoast from "autotoast.js";
import { useMindMapContext } from "../context";
import { toggleFullscreen } from "../utils";
import { getEditorRoot } from "./helpers";

const { mindMap } = useMindMapContext();

/**
 * 切换指定元素的全屏：已是其它元素全屏时直接切到该元素（如从「全屏编辑」切到「全屏查看」），
 * 否则在全屏 / 退出全屏之间切换
 */
async function switchFullscreen(el: HTMLElement | null | undefined, label: string): Promise<void> {
  if (!el) {
    console.warn(`[MindMap/Fullscreen] ${label}：找不到目标元素`);
    return;
  }
  try {
    if (document.fullscreenElement && document.fullscreenElement !== el) {
      await el.requestFullscreen();
    } else {
      await toggleFullscreen(el);
    }
    console.info(
      `[MindMap/Fullscreen] ${label}:`,
      document.fullscreenElement ? "进入全屏" : "退出全屏"
    );
  } catch (error) {
    console.error(`[MindMap/Fullscreen] ${label}失败:`, error);
    autotoast.show("无法切换全屏", "error");
  }
}

/** 全屏查看：画布全屏 */
function toFullscreenShow(): void {
  void switchFullscreen(mindMap.value?.el, "全屏查看");
}

/** 全屏编辑：编辑器根元素全屏 */
function toFullscreenEdit(): void {
  void switchFullscreen(getEditorRoot(mindMap.value?.el), "全屏编辑");
}

/** 全屏状态变化：下一帧（布局完成后）让引擎重新计算画布尺寸 */
function onFullscreenChange(): void {
  requestAnimationFrame(() => {
    try {
      mindMap.value?.resize();
    } catch (error) {
      // 画布被隐藏时宽高为 0，引擎会抛错，忽略即可（下次尺寸变化时根组件会再 resize）
      console.debug("[MindMap/Fullscreen] 全屏切换后 resize 跳过:", error);
    }
  });
}

document.addEventListener("fullscreenchange", onFullscreenChange);
onBeforeUnmount(() => {
  document.removeEventListener("fullscreenchange", onFullscreenChange);
});
</script>

<template>
  <div class="mm-fullscreen">
    <span
      class="mm-fullscreen__btn mm-iconfont iconquanping"
      role="button"
      title="全屏查看"
      @click="toFullscreenShow"
    />
    <span
      class="mm-fullscreen__btn mm-iconfont iconquanping1"
      role="button"
      title="全屏编辑"
      @click="toFullscreenEdit"
    />
  </div>
</template>

<style lang="less" scoped>
.mm-fullscreen {
  display: flex;
  align-items: center;
}

.mm-fullscreen__btn {
  margin-right: 12px;
  cursor: pointer;

  &:last-of-type {
    margin-right: 0;
  }

  &:hover {
    color: var(--primary-color, #409eff);
  }
}
</style>
