<script lang="ts">
/**
 * 小地图开关状态按编辑器实例（事件总线）记录：禅模式会卸载底部栏而小地图仍在显示，
 * 退出禅模式重新挂载时据此恢复按钮状态（参考项目重新挂载后状态归零，需要点两次才能关闭小地图）
 */
const miniMapOpenStates = new WeakMap<object, boolean>();
</script>

<script setup lang="ts">
/**
 * 右下角底部栏（对应参考项目 NavigatorToolbar.vue）
 *
 * 从左到右：回到根节点、搜索、鼠标行为、小地图开关、只读 / 编辑、全屏（查看 / 编辑）、缩放、
 * 暗色界面切换、演示模式、更多（快捷键、引擎版本）。
 * 派发总线事件：toggle_mini_map(open)（Navigator 监听）、show_search（Search 监听）；
 * 「快捷键」打开 shortcutKey 面板；只读切换同时改上下文 isReadonly 并调用引擎 setMode；
 * 暗色切换改上下文 isDark（根组件据此给根元素加 .is-dark 并覆盖配色变量）。
 * 与参考项目的差异：不做语言切换；「更多」里的 AI 对话、下载客户端、GitHub、官网链接不做。
 */
import { onBeforeUnmount, ref } from "vue";
import { useBusEvent, useMindMapContext } from "../context";
import Scale from "./Scale.vue";
import Fullscreen from "./Fullscreen.vue";
import MouseAction from "./MouseAction.vue";
import Demonstrate from "./Demonstrate.vue";
import NavIcon from "./NavIcon.vue";

const { mindMap, bus, isReadonly, isDark, setActiveSidebar } = useMindMapContext();

/** 小地图是否开启 */
const openMiniMap = ref(miniMapOpenStates.get(bus) ?? false);
/** 引擎版本（full.js 挂在引擎类上的 MindMap.version） */
const version = String(
  (mindMap.value?.constructor as unknown as { version?: string } | undefined)?.version ?? ""
);

/** 「更多」下拉菜单（与 el-dropdown 默认的悬停触发一致，同时支持点击） */
const moreOpen = ref(false);
let moreTimer: ReturnType<typeof setTimeout> | null = null;

function clearMoreTimer(): void {
  if (moreTimer) {
    clearTimeout(moreTimer);
    moreTimer = null;
  }
}

function scheduleMore(open: boolean): void {
  clearMoreTimer();
  moreTimer = setTimeout(() => {
    moreOpen.value = open;
    moreTimer = null;
  }, 150);
}

/** 点击立即打开（悬停已打开时不再切换为关闭，关闭交给移出与选择菜单项） */
function openMore(): void {
  clearMoreTimer();
  moreOpen.value = true;
}

function handleCommand(command: "shortcutKey"): void {
  clearMoreTimer();
  moreOpen.value = false;
  if (command === "shortcutKey") {
    setActiveSidebar("shortcutKey");
  }
}

/** 回到根节点 */
function backToRoot(): void {
  mindMap.value?.renderer.setRootNodeCenter();
}

/** 打开搜索替换 */
function showSearch(): void {
  bus.emit("show_search");
}

/** 小地图开关 */
function toggleMiniMap(): void {
  openMiniMap.value = !openMiniMap.value;
  miniMapOpenStates.set(bus, openMiniMap.value);
  console.info("[MindMap/NavigatorToolbar] 小地图:", openMiniMap.value ? "开启" : "关闭");
  bus.emit("toggle_mini_map", openMiniMap.value);
}

/** 只读 / 编辑切换 */
function readonlyChange(): void {
  isReadonly.value = !isReadonly.value;
  mindMap.value?.setMode(isReadonly.value ? "readonly" : "edit");
  console.info("[MindMap/NavigatorToolbar] 切换为", isReadonly.value ? "只读模式" : "编辑模式");
}

/** 暗色界面切换 */
function toggleDark(): void {
  isDark.value = !isDark.value;
  console.info("[MindMap/NavigatorToolbar] 界面:", isDark.value ? "暗色" : "亮色");
}

// 其它地方派发 toggle_mini_map 时同步按钮状态
useBusEvent("toggle_mini_map", (open: boolean) => {
  openMiniMap.value = Boolean(open);
  miniMapOpenStates.set(bus, openMiniMap.value);
});

onBeforeUnmount(clearMoreTimer);
</script>

<template>
  <div class="mm-navigator-toolbar">
    <div class="mm-navigator-toolbar__bar">
      <div class="mm-navigator-toolbar__item">
        <span
          class="mm-navigator-toolbar__btn mm-iconfont icondingwei"
          role="button"
          title="回到根节点"
          @click="backToRoot"
        />
      </div>
      <div class="mm-navigator-toolbar__item">
        <span
          class="mm-navigator-toolbar__btn mm-iconfont iconsousuo"
          role="button"
          title="搜索和替换"
          @click="showSearch"
        />
      </div>
      <div class="mm-navigator-toolbar__item">
        <MouseAction />
      </div>
      <div class="mm-navigator-toolbar__item">
        <span
          class="mm-navigator-toolbar__btn mm-iconfont icondaohang1"
          role="button"
          :title="openMiniMap ? '关闭小地图' : '开启小地图'"
          @click="toggleMiniMap"
        />
      </div>
      <div class="mm-navigator-toolbar__item">
        <span
          class="mm-navigator-toolbar__btn mm-iconfont"
          :class="isReadonly ? 'iconyanjing' : 'iconbianji1'"
          role="button"
          :title="isReadonly ? '切换为编辑模式' : '切换为只读模式'"
          @click="readonlyChange"
        />
      </div>
      <div class="mm-navigator-toolbar__item">
        <Fullscreen />
      </div>
      <div class="mm-navigator-toolbar__item">
        <Scale />
      </div>
      <div class="mm-navigator-toolbar__item">
        <span
          class="mm-navigator-toolbar__btn mm-iconfont"
          :class="isDark ? 'iconmoon_line' : 'iconlieri'"
          role="button"
          :title="isDark ? '切换为亮色界面' : '切换为暗色界面'"
          @click="toggleDark"
        />
      </div>
      <div class="mm-navigator-toolbar__item">
        <Demonstrate />
      </div>
      <div
        class="mm-navigator-toolbar__item"
        @mouseenter="scheduleMore(true)"
        @mouseleave="scheduleMore(false)"
      >
        <span class="mm-navigator-toolbar__btn" role="button" title="更多" @click="openMore">
          <NavIcon name="more" />
        </span>
      </div>
    </div>
    <!-- 下拉菜单放在可横向滚动的栏外面，窄窗口下不会被裁剪 -->
    <div
      v-if="moreOpen"
      class="mm-navigator-toolbar__menu"
      @mouseenter="scheduleMore(true)"
      @mouseleave="scheduleMore(false)"
    >
      <div class="mm-navigator-toolbar__menu-item" @click="handleCommand('shortcutKey')">
        <span class="mm-iconfont iconjianpan" />
        快捷键
      </div>
      <div v-if="version" class="mm-navigator-toolbar__menu-item is-disabled">
        引擎版本：v{{ version }}
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.mm-navigator-toolbar {
  position: absolute;
  right: 20px;
  bottom: 20px;
  z-index: 1000;
  color: var(--text-color-1, #303133);
}

.mm-navigator-toolbar__bar {
  display: flex;
  align-items: center;
  height: 44px;
  padding: 0 12px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--background-color-1, #fff) 80%, transparent);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06);
  font-size: 12px;
  opacity: 0.9;
}

.mm-navigator-toolbar__item {
  flex-shrink: 0;
  margin-right: 20px;

  &:last-of-type {
    margin-right: 0;
  }
}

.mm-navigator-toolbar__btn {
  display: inline-flex;
  align-items: center;
  font-size: 18px;
  cursor: pointer;

  &:hover {
    color: var(--primary-color, #409eff);
  }
}

.mm-navigator-toolbar__menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  min-width: 160px;
  padding: 6px 0;
  border: 1px solid var(--border-color-1, #e4e7ed);
  border-radius: 4px;
  background: var(--background-color-1, #fff);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  font-size: 14px;
}

.mm-navigator-toolbar__menu-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 16px;
  line-height: 32px;
  white-space: nowrap;
  cursor: pointer;

  &:hover {
    background: var(--hover-background-color, #ecf5ff);
    color: var(--primary-color, #409eff);
  }

  &.is-disabled {
    color: var(--text-color-3, #bbb);
    cursor: default;

    &:hover {
      background: transparent;
    }
  }
}

@media screen and (max-width: 700px) {
  .mm-navigator-toolbar {
    left: 20px;
  }

  .mm-navigator-toolbar__bar {
    height: 60px;
    overflow-x: auto;
    overflow-y: hidden;
  }
}
</style>
