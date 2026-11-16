<script setup lang="ts">
/**
 * 节点标签弹窗（移植自参考项目 NodeTag.vue）
 *
 * - 总线 showNodeTag 打开，回显第一个激活节点的标签；打开期间派发 startTextEdit / endTextEdit 暂停引擎
 *   快捷键（与参考项目一致，由 useNodeDialogGuard 处理）；焦点掉回 body 时穿透到引擎的按键由 MmDialog 拦截；
 * - 输入框回车添加标签，达到上限（引擎 maxTag，默认 5）后禁用输入；悬停标签显示删除按钮；
 * - 确定后把标签列表设置到全部激活节点。
 * 与参考项目不同：编辑的是副本（参考项目直接 push / splice 节点数据，取消后修改仍残留在数据里）；
 * 标签颜色按引擎规则取（对象标签优先用自身颜色）；输入法组字时的回车不会误添加；
 * 点「确定」时输入框里未回车的文字也一并添加。
 */
import { computed, nextTick, ref } from "vue";
import type { MindMapNodeInstance } from "@/core/mindmap-engine/full";
import { useBusEvent, useMindMapContext } from "../context";
import MmDialog from "../ui/MmDialog.vue";
import {
  cloneTag,
  getTagColor,
  getTagText,
  isImeComposing,
  type NodeTagItem,
} from "./nodeContentUtils";
import { useNodeDialogGuard } from "./useNodeDialogGuard";

const { mindMap, activeNodes, isReadonly } = useMindMapContext();

const dialogVisible = ref(false);
/** 编辑中的标签（副本） */
const tagArr = ref<NodeTagItem[]>([]);
const tag = ref("");
const contentRef = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);
/** 标签数量上限：与引擎渲染时截取的数量一致 */
const max = computed(() => Number(mindMap.value?.opt.maxTag) || 5);
let nodes: MindMapNodeInstance[] = [...activeNodes.value];

/** 回显第一个激活节点的标签（对应参考项目 handleNodeActive） */
function syncFromNodes(): void {
  const first = nodes[0];
  tagArr.value = ((first?.getData("tag") as NodeTagItem[] | undefined) ?? []).map(cloneTag);
  if (!first) tag.value = "";
}

syncFromNodes();

useBusEvent("node_active", (_node: unknown, list: MindMapNodeInstance[] = []) => {
  nodes = [...list];
  // 弹窗打开期间不覆盖正在编辑的内容
  if (!dialogVisible.value) syncFromNodes();
});

useBusEvent("showNodeTag", () => {
  if (isReadonly.value) {
    console.info("[MindMap/NodeTag] 只读模式，不打开标签弹窗");
    return;
  }
  syncFromNodes();
  tag.value = "";
  dialogVisible.value = true;
  console.debug("[MindMap/NodeTag] 打开标签弹窗，激活节点数:", nodes.length);
});

function tagColor(item: NodeTagItem): string {
  return getTagColor(item, mindMap.value?.opt.tagsColorMap);
}

function onInputKeydown(event: KeyboardEvent): void {
  // 输入法组字时的回车用于上屏，不添加标签
  if (event.key !== "Enter" || isImeComposing(event)) return;
  event.preventDefault();
  add();
  // 达到上限后输入框会被禁用并失去焦点，先把焦点移到内容容器，Esc 等弹窗按键仍然有效
  if (tagArr.value.length >= max.value) contentRef.value?.focus();
}

function add(): void {
  const text = tag.value.trim();
  if (!text || tagArr.value.length >= max.value) return;
  tagArr.value.push(text);
  tag.value = "";
}

function del(index: number): void {
  tagArr.value.splice(index, 1);
  // 删除后输入框可能从禁用恢复，焦点回到输入框便于继续添加
  void nextTick(() => inputRef.value?.focus());
}

function cancel(): void {
  dialogVisible.value = false;
}

useNodeDialogGuard(dialogVisible, { initialFocus: () => inputRef.value });

function confirm(): void {
  // 输入框里还有未回车的文字时一并添加，避免用户以为已添加
  add();
  nodes.forEach((node) => node.setTag(tagArr.value.map(cloneTag)));
  console.info(
    "[MindMap/NodeTag] 已设置标签:",
    tagArr.value.map(getTagText),
    "节点数:",
    nodes.length
  );
  cancel();
}
</script>

<template>
  <MmDialog v-model="dialogVisible" title="标签" width="520px" @confirm="confirm">
    <div ref="contentRef" class="node-tag" tabindex="-1">
      <input
        ref="inputRef"
        v-model="tag"
        class="mm-input node-tag__input"
        :disabled="tagArr.length >= max"
        :placeholder="tagArr.length >= max ? `最多 ${max} 个标签` : '请按回车键添加'"
        @keydown="onInputKeydown"
      />
      <div class="node-tag__list">
        <div
          v-for="(item, index) in tagArr"
          :key="index"
          class="node-tag__item"
          :style="{ backgroundColor: tagColor(item) }"
        >
          {{ getTagText(item) }}
          <div class="node-tag__delete" title="删除" @click="del(index)">
            <span class="mm-iconfont iconshanchu" />
          </div>
        </div>
      </div>
    </div>
  </MmDialog>
</template>

<style lang="less" scoped>
.node-tag {
  // 内容容器可聚焦（tabindex="-1"，焦点元素被移除 / 禁用时的兜底落点），不显示焦点框
  outline: none;
}

// 选择器带上父级，保证优先级高于全局的 .mindmap-editor .mm-input
.node-tag__input.mm-input {
  height: 32px;
  font-size: 13px;
}

.node-tag__list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.node-tag__item {
  position: relative;
  padding: 3px 8px;
  border-radius: 3px;
  color: #fff;
  font-size: 12px;
  line-height: 18px;

  &:hover .node-tag__delete {
    visibility: visible;
  }
}

.node-tag__delete {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: inherit;
  background: rgba(0, 0, 0, 0.4);
  color: #fff;
  cursor: pointer;
  visibility: hidden;

  .mm-iconfont {
    font-size: 13px;
  }
}
</style>
