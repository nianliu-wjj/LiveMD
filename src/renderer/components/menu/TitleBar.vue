<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import TabBar from "@/renderer/components/workspace/TabBar.vue";
import MenuDropDown from "./MenuDropDown.vue";

const isWin = window.electronAPI.platform === "win32";
const isMac = window.electronAPI.platform === "darwin"; // 新增

const isFullScreen = ref(false);

/** 最大化/还原按钮字形（Segoe Fluent Icons 私有区编码：0xE923=向下还原，0xE922=最大化） */
const maximizeGlyph = computed(() => String.fromCharCode(isFullScreen.value ? 0xe923 : 0xe922));
function minimize() {
  window.electronAPI?.windowControl?.("minimize");
}
function toggleMaximize() {
  window.electronAPI?.windowControl?.("maximize");
}
async function close() {
  window.electronAPI?.windowControl?.("close");
}
window.electronAPI.on("close", () => {
  close();
});

// 监听主进程的最大化/还原事件，同步按钮状态
function handleMaximizedChange(maximized: boolean) {
  isFullScreen.value = maximized;
}
function handleFullscreenChange(fullscreen: boolean) {
  isFullScreen.value = fullscreen;
}
window.electronAPI.on("window:maximized-change", handleMaximizedChange);
window.electronAPI.on("window:fullscreen-change", handleFullscreenChange);

// 标题栏双击缩放（前端自控路径）：
// mousedown 的 e.detail 即点击计数（2 = 双击），比依赖 dblclick 复合事件更可靠
// （双击序列首次按下已触发 start_dragging，事件流存在竞争）。
// capture 阶段统一处理：命中标题栏空白时直接缩放，并阻断事件继续传播，
// 使 Tauri drag.js 的双击路径（document bubble 监听）收不到该事件，
// 避免 internal_toggle_maximize 双重 toggle；detail=1 放行不影响拖动。
function handleTitlebarDoubleClickCapture(e: MouseEvent) {
  if (e.detail !== 2) return;
  const target = e.target as HTMLElement;
  if (!target.closest(".TitleBarBox")) return;
  // 交互元素（tab、按钮、窗口控制）上的双击放行，不缩放窗口
  if (target.closest(".tabItem, .addTab, button, .window-controls")) return;
  e.stopImmediatePropagation();
  window.electronAPI?.windowControl?.("maximize");
}
document.addEventListener("mousedown", handleTitlebarDoubleClickCapture, true);

onUnmounted(() => {
  window.electronAPI.removeListener?.("window:maximized-change", handleMaximizedChange);
  window.electronAPI.removeListener?.("window:fullscreen-change", handleFullscreenChange);
  document.removeEventListener("mousedown", handleTitlebarDoubleClickCapture, true);
});
</script>

<template>
  <div class="TitleBarBox" data-tauri-drag-region="deep">
    <template v-if="isWin">
      <MenuDropDown />
      <TabBar />

      <div class="window-controls">
        <button class="window-control-btn" title="最小化" @click="minimize">
          <span class="win-control-glyph" aria-hidden="true">&#xE921;</span>
        </button>
        <button
          class="window-control-btn"
          :title="isFullScreen ? '向下还原' : '最大化'"
          @click="toggleMaximize"
        >
          <span class="win-control-glyph" aria-hidden="true">{{ maximizeGlyph }}</span>
        </button>
        <button class="window-control-btn close-btn" title="关闭" @click="close">
          <span class="win-control-glyph" aria-hidden="true">&#xE8BB;</span>
        </button>
      </div>
    </template>
    <template v-else>
      <div v-if="isMac" class="mac-spacer" data-tauri-drag-region></div>
      <TabBar />
      <div class="menu-host">
        <MenuDropDown />
      </div>
    </template>
  </div>
</template>

<style lang="less" scoped>
.TitleBarBox {
  -webkit-app-region: drag;
  height: 40px;
  padding-left: 6px;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--background-color-1) 60%, transparent),
    var(--background-color-2)
  );
  color: var(--text-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  overflow: hidden;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color-1) 82%, transparent);

  .mac-spacer {
    /* macOS Overlay 红绿灯悬浮于左上角（右缘约 x=66px），预留安全间距 */
    width: 78px;
    flex-shrink: 0;
  }

  .menu-host {
    margin-right: 10px;
  }

  // Windows 原生风格窗口控制键：Segoe Fluent Icons 字形、46px 宽、与标题栏同高、关闭键悬停红
  .window-controls {
    display: flex;
    -webkit-app-region: no-drag;
    height: 100%;
    align-items: center;
    justify-content: center;

    .window-control-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 46px;
      height: 100%;
      padding: 0;
      border: none;
      background: transparent;
      color: var(--text-color-1);
      cursor: default;
      transition:
        background-color 0.12s ease,
        color 0.12s ease;

      .win-control-glyph {
        font-family: "Segoe Fluent Icons", "Segoe MDL2 Assets", sans-serif;
        font-size: 10px;
        line-height: 1;
        font-style: normal;
      }

      &:hover {
        background: var(--hover-color);
      }

      &.close-btn:hover {
        background: #c42b1c;
        color: #ffffff;
      }
    }
  }
}
</style>
