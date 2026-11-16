<script setup lang="ts">
/**
 * 大纲侧边栏（对应参考项目 OutlineSidebar.vue）：右侧「大纲」面板
 *
 * - 顶部「打印」「全屏」按钮：打印大纲（printElement），切换到全屏大纲编辑（收起面板并进入 isOutlineEdit）；
 * - 内容为可编辑大纲树 Outline.vue，仅在面板打开时挂载（与参考项目 v-if="activeSidebar === 'outline'" 一致），
 *   每次打开都按画布当前数据重建。
 *
 * 参考项目把两个按钮放在侧边栏标题栏里；MmPanel 的标题栏没有插槽，这里放在内容顶部，
 * 树区域单独滚动，按钮始终可见。
 */
import { ref } from "vue";
import MmPanel from "../ui/MmPanel.vue";
import { useMindMapContext } from "../context";
import { printElement } from "../utils";
import Outline from "./Outline.vue";

const { activeSidebar, setActiveSidebar, isOutlineEdit } = useMindMapContext();

const outlineRef = ref<InstanceType<typeof Outline> | null>(null);

/** 切换为全屏大纲编辑（对应参考项目 onChangeToOutlineEdit） */
function onChangeToOutlineEdit(): void {
  console.info("[MindMap/OutlineSidebar] 进入全屏大纲编辑");
  setActiveSidebar(null);
  isOutlineEdit.value = true;
}

/** 打印大纲（对应参考项目 onPrint） */
function onPrint(): void {
  const el = outlineRef.value?.getEl();
  if (!el) {
    console.warn("[MindMap/OutlineSidebar] 大纲尚未渲染，无法打印");
    return;
  }
  console.info("[MindMap/OutlineSidebar] 打印大纲");
  printElement(el);
}
</script>

<template>
  <MmPanel name="outline" title="大纲">
    <div class="mm-outline-sidebar">
      <div class="mm-outline-sidebar__btns">
        <button type="button" class="mm-outline-sidebar__btn" title="打印" @click="onPrint">
          <span class="mm-iconfont iconprinting" />
        </button>
        <button
          type="button"
          class="mm-outline-sidebar__btn"
          title="全屏"
          @click="onChangeToOutlineEdit"
        >
          <span class="mm-iconfont iconquanping1" />
        </button>
      </div>
      <div class="mm-outline-sidebar__tree">
        <Outline v-if="activeSidebar === 'outline'" ref="outlineRef" />
      </div>
    </div>
  </MmPanel>
</template>

<style lang="less" scoped>
/* 占满面板内容区：按钮固定在顶部，树区域单独滚动（滚动容器也是新建节点后滚动定位的容器） */
.mm-outline-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.mm-outline-sidebar__btns {
  display: flex;
  flex-shrink: 0;
  justify-content: flex-end;
  gap: 4px;
  margin-bottom: 6px;
}

.mm-outline-sidebar__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-color-1, #333);
  cursor: pointer;

  &:hover {
    background: var(--hover-background-color, rgba(0, 0, 0, 0.04));
    color: var(--primary-color, #409eff);
  }
}

.mm-outline-sidebar__tree {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
</style>
