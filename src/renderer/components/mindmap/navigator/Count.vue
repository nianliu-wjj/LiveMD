<script setup lang="ts">
/**
 * 左下角字数 / 节点数统计（对应参考项目 Count.vue）
 *
 * 挂载时统计一次，之后监听总线 data_change（根组件转发的引擎事件，参数为根节点数据）重新统计。
 * 字数 = 所有节点纯文本长度之和（富文本节点先去标签），节点数不含概要。
 * 与参考项目的差异：参考项目把全部文本拼成一段 HTML 再取 textContent，纯文本节点里的「<b>」之类会被误当成标签；
 * 这里逐个节点处理，只对富文本节点去标签。撤销 / 重做到历史尽头时引擎派发的 data_change 不带数据，
 * 参考项目会统计成 0，这里改为读取当前数据。
 */
import { ref } from "vue";
import type { MindMapNodeData } from "@/core/mindmap-engine/full";
import { useBusEvent, useMindMapContext } from "../context";
import { getNodeText } from "./helpers";

const { mindMap } = useMindMapContext();

/** 字数 */
const words = ref(0);
/** 节点数量 */
const num = ref(0);

/** 遍历节点树统计（用显式栈代替递归，层级很深时也不会爆栈） */
function onDataChange(data?: MindMapNodeData | null): void {
  let tree = data;
  if (!tree) {
    try {
      tree = mindMap.value?.getData() as MindMapNodeData | null;
    } catch (error) {
      console.warn("[MindMap/Count] 读取数据失败:", error);
      return;
    }
  }
  let nodeCount = 0;
  let wordCount = 0;
  const stack: MindMapNodeData[] = tree ? [tree] : [];
  while (stack.length > 0) {
    const node = stack.pop() as MindMapNodeData;
    nodeCount += 1;
    wordCount += getNodeText(node.data).length;
    if (node.children?.length) stack.push(...node.children);
  }
  words.value = wordCount;
  num.value = nodeCount;
  console.debug("[MindMap/Count] 统计完成，节点:", nodeCount, "字数:", wordCount);
}

useBusEvent("data_change", onDataChange);

// 初始统计（setup 时引擎已就绪）
onDataChange();
</script>

<template>
  <div class="mm-count">
    <div class="mm-count__item">
      <span class="mm-count__name">字数</span>
      <span>{{ words }}</span>
    </div>
    <div class="mm-count__item">
      <span class="mm-count__name">节点</span>
      <span>{{ num }}</span>
    </div>
  </div>
</template>

<style lang="less" scoped>
.mm-count {
  position: absolute;
  left: 20px;
  bottom: 20px;
  z-index: 1000;
  display: flex;
  height: 22px;
  padding: 0 12px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--background-color-1, #fff) 80%, transparent);
  opacity: 0.8;
  font-size: 12px;
  line-height: 22px;
  color: var(--text-color-2, #555);
}

.mm-count__item {
  margin-right: 15px;

  &:last-of-type {
    margin-right: 0;
  }
}

.mm-count__name {
  margin-right: 5px;
}

@media screen and (max-width: 900px) {
  .mm-count {
    display: none;
  }
}
</style>
