<script setup lang="ts">
/**
 * 工具栏单个按钮：上方图标、下方文字（对应参考项目 Toolbar.vue / ToolbarNodeBtnList.vue 中的 .toolbarBtn 结构）
 *
 * 抽成子组件供 ToolbarNodeBtnList（节点按钮）与 Toolbar（文件按钮）共用，保证两处外观一致：
 * - disabled：禁用（参考项目 .disabled，置灰且不响应点击）；
 * - active：激活态（格式刷进行中，参考项目 .active）；
 * - dot：图标右上角提示点（「保存」按钮的未保存提示，本项目新增）；
 * - vertical：图标与文字横排（「更多」弹出层里的竖排列表，参考项目 dir="v"）。
 *
 * 与参考项目一样用 div 而不是 button：按钮不可获得焦点，点击后焦点回到 body，
 * 引擎快捷键（只在焦点位于 body / 节点编辑框时响应，见引擎 KeyCommand.defaultEnableCheck）继续可用。
 */
const props = withDefaults(
  defineProps<{
    /** 图标类名（移植图标字体，如 iconhoutui-shi） */
    icon: string;
    /** 按钮文字 */
    text: string;
    /** 悬停提示 */
    title?: string;
    disabled?: boolean;
    active?: boolean;
    dot?: boolean;
    vertical?: boolean;
  }>(),
  { title: "", disabled: false, active: false, dot: false, vertical: false }
);

const emit = defineEmits<{
  (e: "click", event: MouseEvent): void;
}>();

function onClick(event: MouseEvent): void {
  // 禁用态在样式上已屏蔽指针事件，这里再兜底一次，避免脚本触发的点击绕过禁用
  if (props.disabled) return;
  emit("click", event);
}
</script>

<template>
  <div
    class="mm-toolbar-btn"
    :class="{
      'is-disabled': props.disabled,
      'is-active': props.active,
      'is-vertical': props.vertical,
    }"
    role="button"
    :aria-disabled="props.disabled ? 'true' : undefined"
    :aria-pressed="props.active ? 'true' : undefined"
    :title="props.title || undefined"
    @click="onClick"
  >
    <span class="mm-toolbar-btn__icon mm-iconfont" :class="props.icon">
      <span v-if="props.dot" class="mm-toolbar-btn__dot" />
    </span>
    <span class="mm-toolbar-btn__text">{{ props.text }}</span>
  </div>
</template>

<style lang="less" scoped>
.mm-toolbar-btn {
  display: flex;
  flex-direction: column;
  justify-content: center;
  flex-shrink: 0;
  cursor: pointer;
  user-select: none;

  &:hover:not(.is-disabled) .mm-toolbar-btn__icon,
  &.is-active .mm-toolbar-btn__icon {
    background: var(--hover-background-color, #f5f5f5);
  }

  &.is-disabled {
    color: var(--text-color-3, #bcbcbc);
    opacity: 0.6;
    cursor: not-allowed;
    pointer-events: none;
  }
}

.mm-toolbar-btn__icon {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: center;
  height: 26px;
  padding: 0 5px;
  border: 1px solid var(--border-color-1, #e9e9e9);
  border-radius: 4px;
  background: var(--background-color-1, #fff);
  text-align: center;
}

/*
 * 暗色界面与参考项目一致：图标去掉边框与底色，仅悬停时显示底色。
 * 编辑器根元素暗色时带 .is-dark；scoped 样式只给最后一段选择器加作用域属性，祖先类名可直接写
 * （不能用 :global(.is-dark) .xxx，Vue 会把整个选择器替换成 .is-dark）
 */
.mindmap-editor.is-dark .mm-toolbar-btn__icon {
  border-color: transparent;
  background: transparent;
}

.mindmap-editor.is-dark .mm-toolbar-btn:hover:not(.is-disabled) .mm-toolbar-btn__icon,
.mindmap-editor.is-dark .mm-toolbar-btn.is-active .mm-toolbar-btn__icon {
  background: var(--hover-background-color, rgba(255, 255, 255, 0.05));
}

.mm-toolbar-btn__dot {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 8px;
  height: 8px;
  border: 1px solid var(--background-color-1, #fff);
  border-radius: 50%;
  background: #f56c6c;
}

.mm-toolbar-btn__text {
  margin-top: 3px;
  text-align: center;
  white-space: nowrap;
}

/* 「更多」弹出层：图标在左、文字在右 */
.mm-toolbar-btn.is-vertical {
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  width: 100%;

  .mm-toolbar-btn__icon {
    flex-shrink: 0;
    margin-right: 10px;
  }

  .mm-toolbar-btn__text {
    min-width: 0;
    margin-top: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}
</style>
