<script setup lang="ts">
/**
 * 编辑器内的模态弹窗（对应参考项目 el-dialog）：挂在编辑器根节点内，层级高于画布与面板
 *
 * 用法：
 * <MmDialog v-model="visible" title="超链接" width="420px" @confirm="save">…内容…</MmDialog>
 * 不传 confirm 监听时只显示「关闭」按钮；hideFooter 可完全隐藏底栏。
 */
const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    title: string;
    width?: string;
    confirmText?: string;
    cancelText?: string;
    hideFooter?: boolean;
    /** 是否显示确认按钮 */
    showConfirm?: boolean;
  }>(),
  { width: "480px", confirmText: "确定", cancelText: "取消", hideFooter: false, showConfirm: true }
);

const emit = defineEmits<{
  (e: "update:modelValue", value: boolean): void;
  (e: "confirm"): void;
  (e: "cancel"): void;
}>();

function close(): void {
  emit("update:modelValue", false);
  emit("cancel");
}

function onKeydown(event: KeyboardEvent): void {
  // 弹窗内按键不冒泡到引擎快捷键（如 Delete 删除节点、Tab 新增子节点）
  event.stopPropagation();
  if (event.key === "Escape") close();
}
</script>

<template>
  <div v-if="props.modelValue" class="mm-dialog-mask" @mousedown.self="close" @keydown="onKeydown">
    <div class="mm-dialog" :style="{ width: props.width }" role="dialog" :aria-label="props.title">
      <div class="mm-dialog__header">
        <span class="mm-dialog__title">{{ props.title }}</span>
        <button type="button" class="mm-dialog__close" title="关闭" @click="close">×</button>
      </div>
      <div class="mm-dialog__body">
        <slot />
      </div>
      <div v-if="!props.hideFooter" class="mm-dialog__footer">
        <slot name="footer">
          <button type="button" class="mm-btn" @click="close">{{ props.cancelText }}</button>
          <button
            v-if="props.showConfirm"
            type="button"
            class="mm-btn mm-btn--primary"
            @click="emit('confirm')"
          >
            {{ props.confirmText }}
          </button>
        </slot>
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.mm-dialog-mask {
  position: absolute;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
}

.mm-dialog {
  max-width: calc(100% - 32px);
  max-height: calc(100% - 64px);
  display: flex;
  flex-direction: column;
  border-radius: 8px;
  background: var(--background-color-1, #fff);
  color: var(--text-color, #333);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
}

.mm-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border-color-1, #e1e4e8);
}

.mm-dialog__title {
  font-size: 15px;
  font-weight: 600;
}

.mm-dialog__close {
  border: none;
  background: transparent;
  font-size: 20px;
  line-height: 1;
  color: var(--text-color-3, #999);
  cursor: pointer;
}

.mm-dialog__body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px 18px;
}

.mm-dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 18px 16px;
}
</style>
