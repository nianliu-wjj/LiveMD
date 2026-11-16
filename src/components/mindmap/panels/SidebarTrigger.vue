<script setup lang="ts">
/**
 * 右侧触发栏（对应参考项目 SidebarTrigger.vue）
 *
 * - 固定在编辑器右边缘、垂直居中的竖向按钮栏：节点样式 / 基础样式 / 主题 / 结构 / 大纲 / 设置 / 快捷键，
 *   点击打开对应面板（setActiveSidebar，面板 MmPanel 位于触发栏左侧）；
 * - 左侧的箭头把手可收起 / 展开触发栏（收起后滑出编辑器右边缘，只露出把手）；
 * - 只读时只保留大纲、快捷键，切换为只读时收起已打开的面板（与参考项目一致）。
 *
 * 与参考项目的差异：
 * - 快捷键在参考项目里从底部栏「更多」菜单打开（共享配置里该项被注释），LiveMD 放进触发栏，这里补上；
 * - 参考项目按窗口高度计算 maxHeight，这里由容器的 top / bottom 约束、列表超出时滚动，不再监听 resize；
 * - 容器本身不拦截鼠标（pointer-events: none），不挡住触发栏上下方的画布。
 */
import { computed, ref, watch } from "vue";
import { useMindMapContext, type MindMapSidebarName } from "../context";
import { sidebarTriggerList } from "../config";

interface TriggerItem {
  name: string;
  value: MindMapSidebarName;
  icon: string;
}

/** 快捷键入口（共享配置 sidebarTriggerList 中该项被注释，与参考项目相同） */
const SHORTCUT_KEY_TRIGGER: TriggerItem = {
  name: "快捷键",
  value: "shortcutKey",
  icon: "iconjianpan",
};
/** 只读时保留的面板（参考项目另有 AI，LiveMD 不做） */
const READONLY_TRIGGERS: MindMapSidebarName[] = ["outline", "shortcutKey"];

const { activeSidebar, setActiveSidebar, isReadonly } = useMindMapContext();

/** 触发栏是否展开 */
const show = ref(true);

const allTriggers: TriggerItem[] = (() => {
  const list = sidebarTriggerList.map((item) => ({
    name: item.name,
    value: item.value as MindMapSidebarName,
    icon: item.icon,
  }));
  if (!list.some((item) => item.value === SHORTCUT_KEY_TRIGGER.value)) {
    list.push(SHORTCUT_KEY_TRIGGER);
  }
  return list;
})();

const triggerList = computed(() =>
  isReadonly.value
    ? allTriggers.filter((item) => READONLY_TRIGGERS.includes(item.value))
    : allTriggers
);

watch(isReadonly, (value) => {
  if (value) {
    console.info("[MindMap/SidebarTrigger] 切换为只读，收起面板");
    setActiveSidebar(null);
  }
});

function trigger(item: TriggerItem): void {
  console.debug("[MindMap/SidebarTrigger] 打开面板:", item.value);
  setActiveSidebar(item.value);
}

function toggleShow(): void {
  show.value = !show.value;
  console.debug("[MindMap/SidebarTrigger] 触发栏", show.value ? "展开" : "收起");
}
</script>

<template>
  <div class="mm-sidebar-trigger" :class="{ 'is-show': show }" @click.stop>
    <div
      class="mm-sidebar-trigger__toggle"
      :class="{ 'is-hide': !show }"
      :title="show ? '收起' : '展开'"
      @click="toggleShow"
    >
      <span class="mm-iconfont iconjiantouyou" />
    </div>
    <div class="mm-sidebar-trigger__list">
      <div
        v-for="item in triggerList"
        :key="item.value"
        class="mm-sidebar-trigger__item"
        :class="{ 'is-active': activeSidebar === item.value }"
        @click="trigger(item)"
      >
        <div class="mm-iconfont mm-sidebar-trigger__icon" :class="item.icon" />
        <div class="mm-sidebar-trigger__name">{{ item.name }}</div>
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
/* 编辑器右边缘、垂直居中；收起时整体滑出右边缘（编辑器根元素 overflow: hidden），只露出把手 */
.mm-sidebar-trigger {
  position: absolute;
  top: 110px;
  right: -60px;
  bottom: 80px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  justify-content: center;
  width: 60px;
  pointer-events: none;
  transition: right 0.3s;

  &.is-show {
    right: 0;
  }
}

/* 收起 / 展开把手：位于列表左侧，平时只露出一条边，悬停时伸出 */
.mm-sidebar-trigger__toggle {
  position: absolute;
  top: 50%;
  left: -6px;
  z-index: 0;
  display: flex;
  align-items: center;
  box-sizing: border-box;
  width: 35px;
  height: 60px;
  padding-left: 4px;
  border-radius: 10px 0 0 10px;
  background: var(--primary-color, #409eff);
  transform: translateY(-50%);
  cursor: pointer;
  pointer-events: auto;
  transition: left 0.1s linear;

  &.is-hide {
    left: -8px;

    .mm-iconfont {
      transform: rotate(180deg);
    }
  }

  &:hover {
    left: -18px;
  }

  .mm-iconfont {
    color: #fff;
    transition: transform 0.1s;
  }
}

.mm-sidebar-trigger__list {
  position: relative;
  min-height: 0;
  max-height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  border-radius: 6px;
  background: var(--background-color-1, #fff);
  box-shadow: 0 2px 16px 0 rgba(0, 0, 0, 0.06);
  pointer-events: auto;
}

.mm-sidebar-trigger__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 60px;
  color: var(--text-color-1, #464646);
  white-space: nowrap;
  cursor: pointer;
  user-select: none;

  &:hover {
    background: var(--hover-background-color, #ededed);
  }

  &.is-active {
    color: var(--primary-color, #409eff);
    font-weight: bold;
  }
}

.mm-sidebar-trigger__icon {
  margin-bottom: 5px;
  font-size: 18px;
}

.mm-sidebar-trigger__name {
  font-size: 13px;
}
</style>
