<script setup lang="ts">
/**
 * 思维导图编辑器颜色选择：预设色板 + 更多颜色（对应参考项目 Color.vue + el-color-picker）
 *
 * 用法：<MmColor :model-value="color" @update:model-value="onChange" />
 */
import { computed, ref } from "vue";
import { ColorPicker } from "@/renderer/components/ui/color-picker";

const props = defineProps<{
  modelValue: string;
  /** 是否显示「透明」色块 */
  allowTransparent?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
}>();

/** 预设色板（与参考项目 config/constant.js 的 colorList 一致） */
const PRESET_COLORS = [
  "#4D4D4D", "#999999", "#FFFFFF", "#F44E3B", "#FE9200", "#FCDC00", "#DBDF00", "#A4DD00",
  "#68CCCA", "#73D8FF", "#AEA1FF", "#FDA1FF", "#333333", "#808080", "#CCCCCC", "#D33115",
  "#E27300", "#FCC400", "#B0BC00", "#68BC00", "#16A5A5", "#009CE0", "#7B64FF", "#FA28FF",
  "#000000", "#666666", "#B3B3B3", "#9F0500", "#C45100", "#FB9E00", "#808900", "#194D33",
  "#0C797D", "#0062B1", "#653294", "#AB149E",
];

const open = ref(false);
const colors = computed(() =>
  props.allowTransparent === false ? PRESET_COLORS : ["transparent", ...PRESET_COLORS]
);

function select(color: string): void {
  emit("update:modelValue", color);
  open.value = false;
}
</script>

<template>
  <div class="mm-color" @keydown.esc="open = false">
    <button
      type="button"
      class="mm-color__trigger"
      :class="{ 'is-transparent': !modelValue || modelValue === 'transparent' }"
      :style="{ backgroundColor: modelValue && modelValue !== 'transparent' ? modelValue : undefined }"
      :title="modelValue || '无'"
      @click="open = !open"
    />
    <div v-if="open" class="mm-color__mask" @click="open = false" />
    <div v-if="open" class="mm-color__popover">
      <div class="mm-color__list">
        <span
          v-for="item in colors"
          :key="item"
          class="mm-color__item"
          :class="{ 'is-transparent': item === 'transparent', 'is-active': item === modelValue }"
          :style="{ backgroundColor: item === 'transparent' ? undefined : item }"
          :title="item === 'transparent' ? '透明' : item"
          @click="select(item)"
        />
      </div>
      <div class="mm-color__more">
        <span>更多颜色</span>
        <ColorPicker
          :model-value="modelValue && modelValue !== 'transparent' ? modelValue : '#000000'"
          size="small"
          @change="select"
        />
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.mm-color {
  position: relative;
  display: inline-flex;
}

.mm-color__trigger {
  width: 26px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--border-color-2, #ccc);
  border-radius: 4px;
  cursor: pointer;
}

.is-transparent {
  background:
    linear-gradient(45deg, transparent 45%, #f44e3b 45%, #f44e3b 55%, transparent 55%),
    var(--background-color-1, #fff);
}

.mm-color__mask {
  position: fixed;
  inset: 0;
  z-index: 10;
}

.mm-color__popover {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 11;
  width: 228px;
  padding: 10px;
  border: 1px solid var(--border-color-1, #e1e4e8);
  border-radius: 6px;
  background: var(--background-color-1, #fff);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
}

.mm-color__list {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 5px;
}

.mm-color__item {
  width: 20px;
  height: 20px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 3px;
  cursor: pointer;

  &.is-active {
    outline: 2px solid var(--primary-color, #409eff);
    outline-offset: 1px;
  }
}

.mm-color__more {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
  font-size: 12px;
  color: var(--text-color-2, #666);
}
</style>
