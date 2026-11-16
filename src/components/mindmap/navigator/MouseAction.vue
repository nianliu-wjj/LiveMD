<script setup lang="ts">
/**
 * 底部栏鼠标行为切换（对应参考项目 MouseAction.vue）
 *
 * 在「左键拖动画布、右键框选节点」与「左键框选节点、右键拖动画布」之间切换：
 * 立即更新引擎选项 useLeftKeySelectionRightKeyDrag，并写入界面偏好（持久化，下次打开沿用）。
 */
import { useMindMapContext } from "../context";

const { mindMap, localConfig, setLocalConfig } = useMindMapContext();

function toggleAction(): void {
  const value = !localConfig.useLeftKeySelectionRightKeyDrag;
  mindMap.value?.updateConfig({ useLeftKeySelectionRightKeyDrag: value });
  setLocalConfig({ useLeftKeySelectionRightKeyDrag: value });
  console.info(
    "[MindMap/MouseAction] 鼠标行为:",
    value ? "左键框选、右键拖动" : "左键拖动、右键框选"
  );
}
</script>

<template>
  <div class="mm-mouse-action">
    <span
      class="mm-mouse-action__btn mm-iconfont"
      :class="localConfig.useLeftKeySelectionRightKeyDrag ? 'iconmouseR' : 'iconmouseL'"
      role="button"
      :title="
        localConfig.useLeftKeySelectionRightKeyDrag
          ? '当前：左键框选节点，右键拖动画布'
          : '当前：左键拖动画布，右键框选节点'
      "
      @click="toggleAction"
    />
  </div>
</template>

<style lang="less" scoped>
.mm-mouse-action {
  display: flex;
  align-items: center;
}

.mm-mouse-action__btn {
  font-size: 18px;
  cursor: pointer;

  &:hover {
    color: var(--primary-color, #409eff);
  }
}
</style>
