<script setup lang="ts">
/**
 * 图标网格（NodeIcon / NodeIconSidebar / NodeIconToolbar 共用，对应参考项目三处相同的 .list > .icon 结构）
 *
 * 选中态与参考项目一致：图标外画一个主色圆环。SVG 图标直接插入（内置 / 扩展图标都是受信任的配置数据），
 * 其它按图片地址渲染。
 */
import { isSvgIcon, toIconKey, type NodeIconItem } from "./nodeContentUtils";

const props = defineProps<{
  /** 分组类型 */
  type: string;
  list: NodeIconItem[];
  /** 已选中的图标 key 列表（「类型_图标名」） */
  selected: readonly string[];
}>();

const emit = defineEmits<{
  (e: "select", name: string): void;
}>();
</script>

<template>
  <div class="node-icon-grid">
    <span
      v-for="icon in props.list"
      :key="icon.name"
      class="node-icon-grid__item"
      :class="{ 'is-selected': props.selected.includes(toIconKey(props.type, icon.name)) }"
      @click="emit('select', icon.name)"
    >
      <span v-if="isSvgIcon(icon.icon)" class="node-icon-grid__svg" v-html="icon.icon" />
      <img v-else :src="icon.icon" alt="" draggable="false" />
    </span>
  </div>
</template>

<style lang="less" scoped>
.node-icon-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.node-icon-grid__item {
  position: relative;
  width: 24px;
  height: 24px;
  cursor: pointer;

  img,
  .node-icon-grid__svg,
  .node-icon-grid__svg :deep(svg) {
    display: block;
    width: 100%;
    height: 100%;
  }

  &.is-selected::after {
    content: "";
    position: absolute;
    inset: -4px;
    box-sizing: border-box;
    border: 2px solid var(--primary-color, #409eff);
    border-radius: 50%;
    pointer-events: none;
  }
}
</style>
