<script setup lang="ts">
/**
 * 节点超链接弹窗（移植自参考项目 NodeHyperlink.vue）
 *
 * - 总线 showNodeLink 打开，回显第一个激活节点的链接与名称；确定后设置到全部激活节点；
 * - 协议下拉（https / http / 无）+ 地址输入：失焦时把地址里的协议拆到下拉框（handleUrl），
 *   已有链接不是 http(s) 时协议显示「无」，保留原样。
 * 与参考项目不同：地址留空确定时清除链接（参考项目会写入 "https://"）；打开时按节点最新数据回显；
 * 输入框回车即确定；打开时聚焦地址输入框（MmDialog 默认会聚焦排在前面的协议下拉框）；
 * 打开期间暂停引擎快捷键（useNodeDialogGuard），焦点掉回 body 的按键由 MmDialog 拦截
 * （参考项目在弹窗里按 Delete 会删除背后的节点）。
 */
import { ref } from "vue";
import type { MindMapNodeInstance } from "@/core/mindmap-engine/full";
import { useBusEvent, useMindMapContext } from "../context";
import MmDialog from "../ui/MmDialog.vue";
import { isImeComposing } from "./nodeContentUtils";
import { useNodeDialogGuard } from "./useNodeDialogGuard";

type LinkProtocol = "https" | "http" | "none";

const { activeNodes, isReadonly } = useMindMapContext();

const dialogVisible = ref(false);
const link = ref("");
const linkTitle = ref("");
const protocol = ref<LinkProtocol>("https");
const contentRef = ref<HTMLElement | null>(null);
const linkInputRef = ref<HTMLInputElement | null>(null);
let nodes: MindMapNodeInstance[] = [...activeNodes.value];

useNodeDialogGuard(dialogVisible, { initialFocus: () => linkInputRef.value });

/**
 * 拆分地址中的协议（对应参考项目 handleUrl）
 * @param setProtocolNoneIfNotExist 地址没有 http(s) 协议时把下拉框设为「无」（回显已有链接时使用）
 */
function handleUrl(setProtocolNoneIfNotExist = false): void {
  const value = link.value.trim();
  const match = /^(https?):\/\//i.exec(value);
  if (match) {
    protocol.value = match[1].toLowerCase() as LinkProtocol;
  } else if (!value) {
    protocol.value = "https";
  } else if (setProtocolNoneIfNotExist) {
    protocol.value = "none";
  }
  link.value = value.replace(/^https?:\/\//i, "");
}

/** 回显第一个激活节点的超链接（对应参考项目 handleNodeActive） */
function syncFromNodes(): void {
  const first = nodes[0];
  if (first) {
    link.value = first.getData("hyperlink") || "";
    handleUrl(true);
    linkTitle.value = first.getData("hyperlinkTitle") || "";
  } else {
    link.value = "";
    linkTitle.value = "";
  }
}

syncFromNodes();

useBusEvent("node_active", (_node: unknown, list: MindMapNodeInstance[] = []) => {
  nodes = [...list];
  // 弹窗打开期间不覆盖正在编辑的内容
  if (!dialogVisible.value) syncFromNodes();
});

useBusEvent("showNodeLink", () => {
  if (isReadonly.value) {
    console.info("[MindMap/NodeHyperlink] 只读模式，不打开超链接弹窗");
    return;
  }
  syncFromNodes();
  dialogVisible.value = true;
  console.debug("[MindMap/NodeHyperlink] 打开超链接弹窗，激活节点数:", nodes.length);
});

function confirm(): void {
  // 直接回车确定时输入框还没失焦，先拆分一次协议
  handleUrl();
  const url = link.value
    ? (protocol.value === "none" ? "" : `${protocol.value}://`) + link.value
    : "";
  const title = linkTitle.value.trim();
  nodes.forEach((node) => node.setHyperlink(url, title));
  console.info("[MindMap/NodeHyperlink] 设置超链接:", url || "（清除）", "节点数:", nodes.length);
  dialogVisible.value = false;
}

/** 输入框回车即确定（输入法组字时的回车除外） */
function onEnter(event: KeyboardEvent): void {
  if (isImeComposing(event)) return;
  event.preventDefault();
  confirm();
}
</script>

<template>
  <MmDialog v-model="dialogVisible" title="超链接" width="520px" @confirm="confirm">
    <div ref="contentRef" class="node-hyperlink" tabindex="-1">
      <div class="node-hyperlink__item">
        <span class="node-hyperlink__name">链接</span>
        <div class="node-hyperlink__link">
          <select v-model="protocol" class="mm-select node-hyperlink__protocol">
            <option value="https">https</option>
            <option value="http">http</option>
            <option value="none">无</option>
          </select>
          <input
            ref="linkInputRef"
            v-model="link"
            class="mm-input"
            placeholder="http://xxxx.com/"
            spellcheck="false"
            @blur="handleUrl()"
            @keydown.enter="onEnter"
          />
        </div>
      </div>
      <div class="node-hyperlink__item">
        <span class="node-hyperlink__name">名称</span>
        <input v-model="linkTitle" class="mm-input" @keydown.enter="onEnter" />
      </div>
    </div>
  </MmDialog>
</template>

<style lang="less" scoped>
.node-hyperlink {
  // 内容容器可聚焦（tabindex="-1"，焦点元素被移除 / 禁用时的兜底落点），不显示焦点框
  outline: none;
}

.node-hyperlink__item {
  display: flex;
  align-items: center;
  margin-bottom: 12px;

  &:last-child {
    margin-bottom: 0;
  }
}

.node-hyperlink__name {
  flex-shrink: 0;
  width: 50px;
  color: var(--text-color-2, #666);
}

.node-hyperlink__link {
  display: flex;
  flex: 1;
  min-width: 0;

  // 选择器带上父级，保证优先级高于全局的 .mindmap-editor .mm-input / .mm-select
  .mm-input {
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }

  .node-hyperlink__protocol {
    flex-shrink: 0;
    width: 80px;
    min-width: 80px;
    margin-right: -1px;
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
    background: var(--background-color-2, #f5f7fa);
  }
}
</style>
