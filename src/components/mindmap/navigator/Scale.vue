<script setup lang="ts">
/**
 * 底部栏缩放控件（对应参考项目 Scale.vue）：缩小 / 当前百分比输入框 / 放大
 *
 * - 监听总线 scale（引擎缩放后同步百分比）、draw_click（点击画布时让输入框失焦，恢复引擎快捷键）；
 * - 输入框只允许数字，回车或失焦后以画布中心为原点缩放，非法值恢复为聚焦前的值。
 * 与参考项目的差异：手动输入的比例按引擎 minZoomRatio / maxZoomRatio 限制（与滚轮、按钮缩放的范围一致），
 * 回车后输入框自动失焦，避免焦点停在输入框里导致节点快捷键失效。
 */
import { ref } from "vue";
import { useBusEvent, useMindMapContext } from "../context";
import NavIcon from "./NavIcon.vue";

const { mindMap } = useMindMapContext();

/** 缩放比例 → 百分比字符串 */
function toPer(scale: number): string {
  return (scale * 100).toFixed(0);
}

const inputRef = ref<HTMLInputElement | null>(null);
/** 输入框中的百分比 */
const scaleNum = ref(toPer(mindMap.value?.view.scale ?? 1));
/** 聚焦时缓存的百分比，输入非法时恢复 */
let cacheScaleNum = scaleNum.value;

function narrow(): void {
  mindMap.value?.view.narrow();
}

function enlarge(): void {
  mindMap.value?.view.enlarge();
}

function onScaleNumInputFocus(): void {
  cacheScaleNum = scaleNum.value;
}

/** 禁止输入非数字 */
function onScaleNumInput(): void {
  scaleNum.value = scaleNum.value.replace(/[^0-9]+/g, "");
}

/** 手动输入缩放比例 */
function onScaleNumChange(): void {
  const instance = mindMap.value;
  const value = Number(scaleNum.value);
  if (!instance || !scaleNum.value || Number.isNaN(value) || value <= 0) {
    scaleNum.value = cacheScaleNum;
    return;
  }
  const { minZoomRatio, maxZoomRatio } = instance.opt;
  let percent = Math.max(value, Number(minZoomRatio) || 0);
  if (Number(maxZoomRatio) > 0) percent = Math.min(percent, Number(maxZoomRatio));
  console.debug("[MindMap/Scale] 手动设置缩放:", value, "→", percent);
  instance.view.setScale(percent / 100, instance.width / 2, instance.height / 2);
  // 限制后数值可能不变（不触发 scale 事件），这里直接同步一次
  scaleNum.value = toPer(instance.view.scale);
}

useBusEvent("scale", (scale: number) => {
  scaleNum.value = toPer(scale);
});

useBusEvent("draw_click", () => {
  inputRef.value?.blur();
});
</script>

<template>
  <div class="mm-scale">
    <span class="mm-scale__btn" role="button" title="缩小" @click="narrow">
      <NavIcon name="minus" />
    </span>
    <div class="mm-scale__info">
      <input
        ref="inputRef"
        v-model="scaleNum"
        type="text"
        @input="onScaleNumInput"
        @change="onScaleNumChange"
        @focus="onScaleNumInputFocus"
        @keydown.stop
        @keyup.stop
        @keyup.enter="inputRef?.blur()"
      />%
    </div>
    <span class="mm-scale__btn" role="button" title="放大" @click="enlarge">
      <NavIcon name="plus" />
    </span>
  </div>
</template>

<style lang="less" scoped>
.mm-scale {
  display: flex;
  align-items: center;
}

.mm-scale__btn {
  display: inline-flex;
  align-items: center;
  font-size: 14px;
  cursor: pointer;

  &:hover {
    color: var(--primary-color, #409eff);
  }
}

.mm-scale__info {
  display: flex;
  align-items: center;
  margin: 0 20px;

  input {
    width: 35px;
    padding: 0;
    border: none;
    outline: none;
    background-color: transparent;
    color: inherit;
    font-size: inherit;
    text-align: center;
  }
}
</style>
