<script setup lang="ts">
/**
 * 带预览的下拉选择（节点样式 / 基础样式面板专用）
 *
 * 对应参考项目 Style.vue / BaseStyle.vue 里带自定义选项内容的 el-select（边框样式、线宽、形状、
 * 连线风格的 SVG 预览，彩虹线条的配色条）。原生 <option> 无法渲染这些内容，因此自写一个轻量下拉：
 * - 传 preview 时选项用 StyleOptionPreview 渲染预览，否则显示名称；option 插槽可完全自定义；
 * - 触发按钮默认与选项渲染一致，也可用 trigger 插槽自定义（如「U」划线按钮）；
 * - 下拉列表放在组件内部（position: absolute，不挂 body），所在面板内容区下方放不下时向上展开；
 * - 透明遮罩捕获外部点击关闭；Esc 关闭，↑ / ↓ / Home / End 在选项间移动焦点；
 * - disabled 或位于禁用的 <fieldset> 内（只读模式）时触发按钮不可点击。
 *
 * 选中与当前值相同的选项不触发 change（与 el-select 一致）。
 */
import { computed, nextTick, ref, watch } from "vue";
import StyleOptionPreview from "./StyleOptionPreview.vue";
import type { StyleSelectOption } from "./styleOptions";

const props = withDefaults(
  defineProps<{
    modelValue: unknown;
    options: ReadonlyArray<StyleSelectOption>;
    /** 选项预览类型（不传则显示选项名称） */
    preview?: "dasharray" | "width" | "shape" | "lineStyle";
    disabled?: boolean;
    /** 触发按钮提示（默认取当前选项名称） */
    title?: string;
    /** 组件宽度（如 "120px"、"100%"），默认自适应且不小于 110px */
    width?: string;
    /** 下拉列表与触发按钮的对齐方式：面板右侧控件用 right，避免列表超出面板左边界 */
    align?: "left" | "right";
    /** 按钮外观（无下拉箭头、内容居中加粗），用于「U」划线按钮 */
    plain?: boolean;
  }>(),
  { preview: undefined, disabled: false, title: "", width: "", align: "right", plain: false }
);

const emit = defineEmits<{
  (e: "update:modelValue", value: unknown): void;
  (e: "change", value: unknown): void;
}>();

const open = ref(false);
/** 是否向上展开 */
const openUp = ref(false);
const rootRef = ref<HTMLElement | null>(null);
const triggerRef = ref<HTMLButtonElement | null>(null);
const listRef = ref<HTMLElement | null>(null);

const current = computed(
  () => props.options.find((option) => option.value === props.modelValue) ?? null
);

function isSelected(option: StyleSelectOption): boolean {
  return option.value === props.modelValue;
}

function optionButtons(): HTMLButtonElement[] {
  return Array.from(
    listRef.value?.querySelectorAll<HTMLButtonElement>(".mm-style-select__option") ?? []
  );
}

/** 只滚动下拉列表自身，让目标选项可见（不带动面板滚动） */
function revealInList(target: HTMLElement): void {
  const list = listRef.value;
  if (!list) return;
  const top = target.offsetTop;
  const bottom = top + target.offsetHeight;
  if (top < list.scrollTop) {
    list.scrollTop = top;
  } else if (bottom > list.scrollTop + list.clientHeight) {
    list.scrollTop = bottom - list.clientHeight;
  }
}

function focusOption(index: number): void {
  const buttons = optionButtons();
  if (buttons.length === 0) return;
  const target = buttons[Math.max(0, Math.min(index, buttons.length - 1))];
  target.focus({ preventScroll: true });
  revealInList(target);
}

/**
 * 决定展开方向：以所在面板内容区（滚动容器）为边界，
 * 下方放不下且上方放得下时向上展开；上下都放不下时仍向下（内容区可以继续滚动查看）
 */
function adjustPlacement(): void {
  const list = listRef.value;
  const trigger = triggerRef.value;
  if (!list || !trigger) return;
  const boundary = rootRef.value?.closest(".mm-panel__body")?.getBoundingClientRect();
  const boundaryTop = boundary?.top ?? 0;
  const boundaryBottom = boundary?.bottom ?? window.innerHeight;
  const rect = trigger.getBoundingClientRect();
  const needed = list.offsetHeight + 8;
  openUp.value = boundaryBottom - rect.bottom < needed && rect.top - boundaryTop >= needed;
}

async function openList(): Promise<void> {
  // 位于禁用的 fieldset 内时按钮的 disabled 属性为 false，但 :disabled 伪类成立
  if (props.disabled || triggerRef.value?.matches(":disabled")) return;
  open.value = true;
  openUp.value = false;
  await nextTick();
  adjustPlacement();
  const index = props.options.findIndex(isSelected);
  focusOption(index < 0 ? 0 : index);
}

function close(returnFocus = false): void {
  if (!open.value) return;
  open.value = false;
  if (returnFocus) triggerRef.value?.focus({ preventScroll: true });
}

function toggle(): void {
  if (open.value) {
    close();
  } else {
    void openList();
  }
}

function select(option: StyleSelectOption): void {
  close(true);
  if (isSelected(option)) return;
  emit("update:modelValue", option.value);
  emit("change", option.value);
}

function onTriggerKeydown(event: KeyboardEvent): void {
  if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !open.value) {
    event.preventDefault();
    void openList();
  } else if (event.key === "Escape" && open.value) {
    event.preventDefault();
    close();
  }
}

function onListKeydown(event: KeyboardEvent): void {
  const buttons = optionButtons();
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      focusOption(index + 1);
      break;
    case "ArrowUp":
      event.preventDefault();
      focusOption(index - 1);
      break;
    case "Home":
      event.preventDefault();
      focusOption(0);
      break;
    case "End":
      event.preventDefault();
      focusOption(buttons.length - 1);
      break;
    case "Escape":
      event.preventDefault();
      close(true);
      break;
    case "Tab":
      close();
      break;
    default:
      break;
  }
}

// 切换为只读等外部禁用时收起列表
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) close();
  }
);
</script>

<template>
  <div
    ref="rootRef"
    class="mm-style-select"
    :class="{ 'is-plain': props.plain, 'has-width': !!props.width }"
    :style="props.width ? { width: props.width } : undefined"
  >
    <button
      ref="triggerRef"
      type="button"
      class="mm-style-select__trigger"
      :class="{ 'is-open': open }"
      :disabled="props.disabled"
      :title="props.title || current?.label || ''"
      aria-haspopup="listbox"
      :aria-expanded="open"
      @click="toggle"
      @keydown="onTriggerKeydown"
    >
      <span class="mm-style-select__value">
        <slot name="trigger" :option="current">
          <slot v-if="current" name="option" :option="current" :selected="false">
            <StyleOptionPreview v-if="props.preview" :type="props.preview" :option="current" />
            <template v-else>{{ current.label }}</template>
          </slot>
        </slot>
      </span>
      <span v-if="!props.plain" class="mm-style-select__caret" aria-hidden="true" />
    </button>
    <div v-if="open" class="mm-style-select__mask" @mousedown.prevent="close()" />
    <ul
      v-if="open"
      ref="listRef"
      class="mm-style-select__list"
      :class="[`is-${props.align}`, { 'is-up': openUp }]"
      role="listbox"
      @keydown="onListKeydown"
    >
      <li v-for="option in props.options" :key="String(option.value)" role="presentation">
        <button
          type="button"
          role="option"
          class="mm-style-select__option"
          :class="{ 'is-selected': isSelected(option) }"
          :aria-selected="isSelected(option)"
          :title="option.label"
          @click="select(option)"
        >
          <slot name="option" :option="option" :selected="isSelected(option)">
            <StyleOptionPreview v-if="props.preview" :type="props.preview" :option="option" />
            <template v-else>{{ option.label }}</template>
          </slot>
        </button>
      </li>
    </ul>
  </div>
</template>

<style lang="less" scoped>
.mm-style-select {
  position: relative;
  display: inline-flex;
  min-width: 110px;
  max-width: 100%;

  &.has-width,
  &.is-plain {
    min-width: 0;
  }

  &.is-plain {
    display: flex;
    width: 100%;
  }
}

.mm-style-select__trigger {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  width: 100%;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border-color-1, #dcdfe6);
  border-radius: 4px;
  background: var(--background-color-1, #fff);
  color: var(--text-color, #333);
  font-size: 12px;
  cursor: pointer;

  &:hover:not(:disabled),
  &.is-open {
    border-color: var(--primary-color, #409eff);
  }

  &:focus-visible {
    outline: 2px solid var(--primary-color, #409eff);
    outline-offset: 1px;
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .is-plain & {
    justify-content: center;
    height: 30px;
    font-size: 14px;
    font-weight: bold;
  }
}

.mm-style-select__value {
  display: flex;
  flex: 1;
  align-items: center;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;

  .is-plain & {
    flex: 0 1 auto;
  }
}

.mm-style-select__caret {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  margin-top: -3px;
  border-right: 1.5px solid var(--text-color-3, #999);
  border-bottom: 1.5px solid var(--text-color-3, #999);
  transform: rotate(45deg);
}

.mm-style-select__mask {
  position: fixed;
  inset: 0;
  z-index: 20;
}

.mm-style-select__list {
  position: absolute;
  top: calc(100% + 4px);
  z-index: 21;
  box-sizing: border-box;
  min-width: 100%;
  max-height: 240px;
  margin: 0;
  padding: 4px;
  overflow-y: auto;
  list-style: none;
  border: 1px solid var(--border-color-1, #e1e4e8);
  border-radius: 6px;
  background: var(--background-color-1, #fff);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);

  &.is-right {
    right: 0;
  }

  &.is-left {
    left: 0;
  }

  &.is-up {
    top: auto;
    bottom: calc(100% + 4px);
  }
}

.mm-style-select__option {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 28px;
  padding: 4px 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-color-1, #333);
  font-size: 12px;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    outline: none;
    background: var(--hover-background-color, rgba(0, 0, 0, 0.04));
  }

  &.is-selected {
    color: var(--primary-color, #409eff);
    font-weight: 600;
  }
}
</style>
