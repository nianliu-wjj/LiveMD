<script setup lang="ts">
/**
 * 编辑器内的模态弹窗（对应参考项目 el-dialog）：挂在编辑器根节点内，层级高于画布与面板
 *
 * 用法：
 * <MmDialog v-model="visible" title="超链接" width="420px" @confirm="save">…内容…</MmDialog>
 * 不传 confirm 监听时只显示「关闭」按钮；hideFooter 可完全隐藏底栏。
 *
 * 焦点管理：打开时把焦点移进弹窗（优先第一个输入控件），关闭时还给 body。
 * 工具栏按钮不抢焦点，若焦点留在 body，按键会穿透到引擎快捷键（Delete 删除节点、Tab 新增子节点等）。
 *
 * 按键兜底：打开期间焦点仍可能掉回 body（获得焦点的元素被移除 / 禁用、点击挂在 body 上的 toast 等），
 * 而引擎在 window 冒泡阶段监听按键（KeyCommand 快捷键；enableAutoEnterTextEditWhenKeydown 开启时
 * TextEdit 按字母 / 数字会在背后节点上打开文字编辑框，不经过快捷键表）。因此在 window 捕获阶段拦截
 * target 为 body 的按键：Esc 关闭弹窗，Tab 把焦点移回弹窗，其它键直接吞掉。
 * 多个弹窗叠加时（如导入 + XMind 画布选择）只由最上层的弹窗处理。
 */
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import { openDialogStack } from "./mmDialogStack";

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

const dialogRef = ref<HTMLElement | null>(null);
/** 本弹窗在打开栈中的标识，用于判断是否为最上层弹窗 */
const stackToken = Symbol("MmDialog");

/** 打开后聚焦：子组件自己已聚焦到弹窗内的控件时不打扰 */
async function focusDialog(): Promise<void> {
  await nextTick();
  const dialog = dialogRef.value;
  if (!dialog || dialog.contains(document.activeElement)) return;
  const field = dialog.querySelector<HTMLElement>(
    "input:not([disabled]):not([type='hidden']), textarea:not([disabled]), select:not([disabled])"
  );
  (field ?? dialog).focus();
}

/** 焦点掉回 body 时的按键兜底（见文件头），只由最上层弹窗处理 */
function onWindowKeydown(event: KeyboardEvent): void {
  if (event.target !== document.body) return;
  if (openDialogStack[openDialogStack.length - 1] !== stackToken) return;
  // 捕获阶段阻止传播，引擎在冒泡阶段的监听收不到该按键
  event.stopPropagation();
  if (event.key === "Escape") {
    console.debug(`[MindMap/MmDialog] 焦点在 body 上按 Esc，关闭弹窗「${props.title}」`);
    close();
  } else if (event.key === "Tab") {
    // 默认行为会把焦点移到弹窗背后的元素
    event.preventDefault();
    void focusDialog();
  }
}

/** 打开：入栈并挂载 window 捕获阶段的按键兜底 */
function activate(): void {
  if (openDialogStack.includes(stackToken)) return;
  openDialogStack.push(stackToken);
  window.addEventListener("keydown", onWindowKeydown, true);
}

/** 关闭或卸载：出栈并解绑 */
function deactivate(): void {
  const index = openDialogStack.indexOf(stackToken);
  if (index === -1) return;
  openDialogStack.splice(index, 1);
  window.removeEventListener("keydown", onWindowKeydown, true);
}

watch(
  () => props.modelValue,
  (visible) => {
    if (visible) {
      activate();
      void focusDialog();
    } else {
      deactivate();
      if (dialogRef.value?.contains(document.activeElement)) {
        // 关闭时焦点归还 body，引擎快捷键恢复可用
        (document.activeElement as HTMLElement | null)?.blur();
      }
    }
  },
  { immediate: true }
);

// 打开状态下被卸载（如退出编辑器）：解绑监听，避免残留的栈顶挡住其它弹窗
onBeforeUnmount(deactivate);

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
    <div
      ref="dialogRef"
      class="mm-dialog"
      :style="{ width: props.width }"
      role="dialog"
      tabindex="-1"
      :aria-label="props.title"
    >
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
  outline: none;
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
