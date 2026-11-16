<script setup lang="ts">
/**
 * 节点标签样式浮层（移植自参考项目 NodeTagStyle.vue）
 *
 * 点击节点上的标签（引擎 node_tag_click）时在标签下方显示：修改标签文字（回车或失焦生效）、
 * 设置标签背景色、删除此标签；通过 SET_NODE_TAG 命令写回（字符串标签会转成 { text, style } 对象）。
 * 参考项目挂到 body 上 position: fixed；这里按约定放在编辑器根元素内绝对定位，坐标换算到根元素，
 * 并限制在编辑器可视范围内。缩放、平移、画布按下、展开收起按钮时隐藏（与参考项目一致）。
 * 与参考项目不同：隐藏前提交未回车的文字修改（参考项目点画布时会丢失）；文字未变化时不写历史记录；
 * 修改时复制标签对象（参考项目原地修改，多个节点共享同一对象时会互相影响）；只读模式下不显示。
 */
import { nextTick, reactive, ref } from "vue";
import type { MindMapNodeInstance } from "@/core/mindmap-engine/full";
import { useBusEvent, useMindMapContext } from "../context";
import MmColor from "../ui/MmColor.vue";
import {
  clamp,
  cloneTag,
  getEditorRect,
  getSvgClientRect,
  getTagText,
  isImeComposing,
  type NodeTagItem,
} from "./nodeContentUtils";

const { mindMap, isReadonly } = useMindMapContext();

const boxRef = ref<HTMLElement | null>(null);
const visible = ref(false);
const position = reactive({ left: 0, top: 0 });
const text = ref("");
const fill = ref("");
let node: MindMapNodeInstance | null = null;
let index = 0;

/** 点击标签（引擎事件参数：node, tag, index, svg 标签元素） */
async function onNodeTagClick(
  target: MindMapNodeInstance,
  tag: NodeTagItem,
  tagIndex: number,
  el: { node?: Element }
): Promise<void> {
  if (isReadonly.value) {
    console.debug("[MindMap/NodeTagStyle] 只读模式，不显示标签样式");
    return;
  }
  node = target;
  index = tagIndex;
  text.value = getTagText(tag);
  fill.value = typeof tag === "string" ? "" : tag?.style?.fill || "";
  visible.value = true;
  console.debug("[MindMap/NodeTagStyle] 编辑标签:", text.value, "序号:", tagIndex);
  await nextTick();
  placeBox(el);
}

/** 定位到标签正下方并居中（窗口坐标 → 编辑器根元素内坐标） */
function placeBox(el: { node?: Element }): void {
  const box = boxRef.value;
  const rect = getSvgClientRect(el);
  if (!box || !rect) return;
  const container = getEditorRect(box);
  const boxWidth = box.offsetWidth;
  const boxHeight = box.offsetHeight;
  const left = rect.left - container.left + rect.width / 2 - boxWidth / 2;
  const top = rect.bottom - container.top + 5;
  position.left = clamp(left, 0, container.width - boxWidth);
  position.top = clamp(top, 0, container.height - boxHeight);
}

/** 当前编辑的标签数据（复制，不修改节点上的原数组 / 对象） */
function getTagData(): NodeTagItem[] | null {
  const list = node?.getData("tag");
  if (!Array.isArray(list) || index >= list.length) return null;
  return list.map(cloneTag);
}

/** 合并修改并写回（对应参考项目 updateTagInfo） */
function updateTagInfo(patch: { text?: string; style?: Record<string, unknown> }): void {
  const tagData = getTagData();
  if (!node || !tagData) return;
  const current = tagData[index];
  const item = typeof current === "string" ? { text: current, style: {} } : { ...current };
  item.style = { ...item.style, ...patch.style };
  if (patch.text) item.text = patch.text;
  tagData[index] = item;
  mindMap.value?.execCommand("SET_NODE_TAG", node, tagData);
}

/** 提交文字修改：为空或未变化时忽略 */
function updateTagText(): void {
  const value = text.value.trim();
  const tagData = getTagData();
  if (!value || !tagData || getTagText(tagData[index]) === value) return;
  console.debug("[MindMap/NodeTagStyle] 修改标签文字:", value);
  updateTagInfo({ text: value });
}

/** 回车提交文字（输入法组字时的回车除外） */
function onTextEnter(event: KeyboardEvent): void {
  if (isImeComposing(event)) return;
  event.preventDefault();
  updateTagText();
}

function updateTagFill(color: string): void {
  console.debug("[MindMap/NodeTagStyle] 修改标签颜色:", color);
  updateTagInfo({ style: { fill: color } });
  fill.value = color;
}

function deleteTag(): void {
  const tagData = getTagData();
  if (node && tagData) {
    tagData.splice(index, 1);
    mindMap.value?.execCommand("SET_NODE_TAG", node, tagData);
    console.debug("[MindMap/NodeTagStyle] 已删除标签，序号:", index);
  }
  hide(false);
}

/**
 * 隐藏
 * @param commit 是否先提交未回车的文字修改（删除标签后不能再提交）
 */
function hide(commit = true): void {
  if (!visible.value && !node) return;
  if (commit) updateTagText();
  visible.value = false;
  node = null;
  index = 0;
  text.value = "";
  fill.value = "";
}

useBusEvent("node_tag_click", onNodeTagClick);
useBusEvent("scale", () => hide());
useBusEvent("translate", () => hide());
useBusEvent("svg_mousedown", () => hide());
useBusEvent("expand_btn_click", () => hide());
</script>

<template>
  <div
    v-show="visible"
    ref="boxRef"
    class="node-tag-style"
    :style="{ left: `${position.left}px`, top: `${position.top}px` }"
    @click.stop
    @keydown.stop
  >
    <div class="node-tag-style__row">
      <input
        v-model="text"
        class="mm-input"
        placeholder="请输入标签内容"
        @blur="updateTagText"
        @keydown.enter="onTextEnter"
      />
      <button type="button" class="node-tag-style__delete" @click.stop="deleteTag">
        <span class="mm-iconfont iconshanchu" />
        <span>删除此标签</span>
      </button>
    </div>
    <div class="node-tag-style__row">
      <span class="node-tag-style__label">标签颜色</span>
      <MmColor :model-value="fill" @update:model-value="updateTagFill" />
    </div>
  </div>
</template>

<style lang="less" scoped>
.node-tag-style {
  position: absolute;
  z-index: 1500;
  box-sizing: border-box;
  width: 260px;
  padding: 12px;
  border: 1px solid var(--border-color-1, rgba(0, 0, 0, 0.06));
  border-radius: 5px;
  background: var(--background-color-1, #fff);
  box-shadow: 0 2px 16px 0 rgba(0, 0, 0, 0.12);
}

.node-tag-style__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;

  &:last-child {
    margin-bottom: 0;
  }
}

.node-tag-style__label {
  font-size: 12px;
  color: var(--text-color-2, #666);
}

.node-tag-style__delete {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 2px;
  margin-left: 6px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-color-3, #9aa5b8);
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;

  &:hover {
    color: #eb5555;
  }

  .mm-iconfont {
    font-size: 12px;
  }
}
</style>
