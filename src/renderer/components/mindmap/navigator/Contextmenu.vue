<script setup lang="ts">
/**
 * 右键菜单（对应参考项目 Contextmenu.vue）
 *
 * 两种菜单：
 * - 节点菜单：监听总线 node_contextmenu(e, node)（引擎在节点上右键时派发，只读模式下不派发）；
 * - 画布菜单：总线 svg_mousedown 记录右键按下位置，mouseup 时移动不超过 3px 视为右键单击而显示
 *   （右键拖动画布 / 框选时不弹出，与参考项目一致）。
 * 隐藏时机：node_click、draw_click、expand_btn_click、translate（平移 / 缩放），以及点击菜单外部、按 Esc。
 * 菜单在编辑器根元素内绝对定位（z-index 1500），右侧 / 底部放不下时翻转或贴边，二级菜单放不下时向左展开。
 *
 * 命令统一走 execCommand（根组件执行）；复制 / 剪切 / 粘贴调用 renderer；导出节点图片派发总线 export
 * （根组件导出后走 saveExportFile 原生另存为）；复制到剪贴板用 utils 的 copyText / copyImage。
 * 与参考项目的差异：
 * - 「来自节点的右键按下」按同一个 mousedown 事件对象判断：引擎会阻止非根节点 mouseup 冒泡，
 *   参考项目的 isNodeMousedown 标记会残留，导致点过节点后第一次右键画布不出菜单；
 * - 节点菜单项的禁用 / 显示状态在弹出时计算（节点数据不是响应式的，computed 会缓存旧值）；
 * - 只读模式下画布菜单里会修改数据的「全选」「一键整理布局」「一键去除所有节点自定义样式」置灰；
 * - 画布菜单增加「全选」（参考项目没有，引擎 SELECT_ALL 命令）；不做 AI 续写。
 */
import { nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef } from "vue";
import autotoast from "autotoast.js";
import type { MindMapNodeInstance } from "@/core/mindmap-engine/full";
import { transformToMarkdown } from "@/core/mindmap-engine/src/parse/toMarkdown.js";
import { transformToTxt } from "@/core/mindmap-engine/src/parse/toTxt.js";
import { useBusEvent, useMindMapContext } from "../context";
import { copyImage, copyText, toBytes } from "../utils";
import { getEditorRoot, getNodeText } from "./helpers";
import NavIcon from "./NavIcon.vue";

type MenuType = "" | "node" | "svg";
type CopyType = "smm" | "json" | "md" | "txt" | "png";

const { mindMap, bus, localConfig, setLocalConfig, isReadonly, execCommand } = useMindMapContext();

const contextmenuRef = ref<HTMLElement | null>(null);
const isShow = ref(false);
const left = ref(-9999);
const top = ref(-9999);
const type = ref<MenuType>("");
/** 右键的节点（引擎实例不能被深度代理，用 shallowRef） */
const node = shallowRef<MindMapNodeInstance | null>(null);
/** 二级菜单向左展开 */
const subItemsShowLeft = ref(false);

/** 节点菜单项状态（弹出时计算） */
const nodeState = reactive({
  insertNodeBtnDisabled: true,
  upNodeBtnDisabled: true,
  downNodeBtnDisabled: true,
  isGeneralization: false,
  hasHyperlink: false,
  hasNote: false,
});

/** 画布右键按下状态 */
let isMousedown = false;
let mousedownX = 0;
let mousedownY = 0;
/** 最近一次节点 mousedown 的事件对象（同一事件冒泡到画布时据此识别「按在节点上」） */
let nodeMousedownEvent: MouseEvent | null = null;

/** 展开到指定层级 */
const expandList = ["一级主题", "二级主题", "三级主题", "四级主题", "五级主题", "六级主题"];

/** 复制到剪贴板的格式（支持 Clipboard API 写图片时才提供「图片」） */
const copyList: Array<{ name: string; value: CopyType }> = [
  { name: "SMM", value: "smm" },
  { name: "JSON", value: "json" },
  { name: "Markdown", value: "md" },
  { name: "Txt", value: "txt" },
];
if (
  typeof navigator !== "undefined" &&
  navigator.clipboard &&
  typeof ClipboardItem !== "undefined"
) {
  copyList.push({ name: "图片", value: "png" });
}

/** 计算节点菜单项状态（对应参考项目的 insertNodeBtnDisabled / upNodeBtnDisabled 等计算属性） */
function updateNodeState(target: MindMapNodeInstance): void {
  const isRootOrGeneralization = Boolean(target.isRoot || target.isGeneralization);
  const siblings = target.parent?.children ?? [];
  const index = siblings.indexOf(target);
  nodeState.insertNodeBtnDisabled = isRootOrGeneralization;
  nodeState.upNodeBtnDisabled = isRootOrGeneralization || index === 0;
  nodeState.downNodeBtnDisabled = isRootOrGeneralization || index === siblings.length - 1;
  nodeState.isGeneralization = Boolean(target.isGeneralization);
  nodeState.hasHyperlink = Boolean(target.getData("hyperlink"));
  nodeState.hasNote = Boolean(target.getData("note"));
}

/**
 * 计算显示位置：换算成相对编辑器根元素的坐标；右侧放不下翻到鼠标左边，底部放不下贴着底边向上，
 * 二级菜单（宽 150px）右侧放不下时向左展开
 */
function updatePosition(clientX: number, clientY: number): void {
  const el = contextmenuRef.value;
  if (!el) return;
  const root = getEditorRoot(el);
  const rootRect = root
    ? root.getBoundingClientRect()
    : new DOMRect(0, 0, window.innerWidth, window.innerHeight);
  const rect = el.getBoundingClientRect();
  let x = clientX - rootRect.left + 10;
  let y = clientY - rootRect.top + 10;
  if (x + rect.width > rootRect.width) {
    x = x - rect.width - 20;
  }
  subItemsShowLeft.value = x + rect.width + 150 > rootRect.width;
  if (y + rect.height > rootRect.height) {
    y = rootRect.height - rect.height - 10;
  }
  left.value = Math.max(0, x);
  top.value = Math.max(0, y);
}

/** 节点右键显示 */
function show(e: MouseEvent, target: MindMapNodeInstance): void {
  if (!target) return;
  type.value = "node";
  node.value = target;
  updateNodeState(target);
  isShow.value = true;
  console.debug("[MindMap/Contextmenu] 显示节点菜单:", target.uid);
  // 先渲染出菜单才能量尺寸（渲染时位于 -9999，不会闪烁）
  void nextTick(() => updatePosition(e.clientX, e.clientY));
}

/** 画布右键显示 */
function show2(e: MouseEvent): void {
  type.value = "svg";
  node.value = null;
  isShow.value = true;
  console.debug("[MindMap/Contextmenu] 显示画布菜单");
  void nextTick(() => updatePosition(e.clientX, e.clientY));
}

/** 隐藏 */
function hide(): void {
  if (!isShow.value && !node.value) return;
  isShow.value = false;
  left.value = -9999;
  top.value = -9999;
  type.value = "";
  node.value = null;
}

/** 节点上按下鼠标（任意键）：记录事件对象，并结束之前未完成的画布右键 */
function onNodeMousedown(_node: MindMapNodeInstance, e: MouseEvent): void {
  nodeMousedownEvent = e;
  isMousedown = false;
}

/** 画布上按下鼠标：只记录不在节点上的右键按下 */
function onMousedown(e: MouseEvent): void {
  const fromNode = e === nodeMousedownEvent;
  nodeMousedownEvent = null;
  if (e.button !== 2 || fromNode) {
    isMousedown = false;
    return;
  }
  mousedownX = e.clientX;
  mousedownY = e.clientY;
  isMousedown = true;
}

/** 鼠标松开：右键按下后移动不超过 3px 视为右键单击，显示画布菜单 */
function onMouseup(e: MouseEvent): void {
  if (!isMousedown) return;
  isMousedown = false;
  if (Math.abs(mousedownX - e.clientX) > 3 || Math.abs(mousedownY - e.clientY) > 3) {
    hide();
    return;
  }
  show2(e);
}

/** 节点文本作为导出文件名：去掉标签与 Windows 文件名非法字符 */
function getExportFileName(target: MindMapNodeInstance): string {
  const text = getNodeText({ text: target.getData("text"), richText: target.getData("richText") });
  const name = text
    .replace(/[\\/:*?"<>|\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return name || "思维导图";
}

/** 执行菜单命令 */
function exec(key: string, disabled = false, ...args: unknown[]): void {
  if (disabled) return;
  const instance = mindMap.value;
  if (!instance) return;
  const target = node.value;
  console.info("[MindMap/Contextmenu] 执行:", key, ...args);
  switch (key) {
    case "COPY_NODE":
      instance.renderer.copy();
      break;
    case "CUT_NODE":
      instance.renderer.cut();
      break;
    case "PASTE_NODE":
      Promise.resolve(instance.renderer.paste()).catch((error: unknown) =>
        console.error("[MindMap/Contextmenu] 粘贴失败:", error)
      );
      break;
    case "RETURN_CENTER":
      instance.renderer.setRootNodeCenter();
      break;
    case "TOGGLE_ZEN_MODE":
      setLocalConfig({ isZenMode: !localConfig.isZenMode });
      break;
    case "FIT_CANVAS":
      instance.view.fit();
      break;
    case "REMOVE_HYPERLINK":
      target?.setHyperlink("", "");
      break;
    case "REMOVE_NOTE":
      target?.setNote("");
      break;
    case "EXPORT_CUR_NODE_TO_PNG":
      // 根组件处理 export：引擎导出 data URL 后走 saveExportFile 原生另存为（带加载态与结果提示）
      if (target) bus.emit("export", "png", true, getExportFileName(target), false, target);
      break;
    case "UNEXPAND_ALL": {
      const uid = target ? target.uid : "";
      execCommand(key, !uid, uid);
      break;
    }
    case "EXPAND_ALL":
      execCommand(key, target ? target.uid : "");
      break;
    default:
      execCommand(key, ...args);
      break;
  }
  hide();
}

/** 复制到剪贴板 */
async function copyToClipboard(copyType: CopyType): Promise<void> {
  hide();
  const instance = mindMap.value;
  if (!instance) return;
  console.info("[MindMap/Contextmenu] 复制到剪贴板:", copyType);
  try {
    let ok = false;
    switch (copyType) {
      case "smm":
      case "json":
        ok = await copyText(JSON.stringify(instance.getData(true)));
        break;
      case "md":
        ok = await copyText(transformToMarkdown(instance.getData()));
        break;
      case "txt":
        ok = await copyText(transformToTxt(instance.getData()));
        break;
      case "png": {
        bus.emit("showLoading");
        try {
          const png = await instance.export("png", false);
          if (!png) {
            // 导出失败时引擎已通过 errorHandler 提示，这里不再重复提示
            console.warn("[MindMap/Contextmenu] 导出图片失败，未复制");
            return;
          }
          const bytes = new Uint8Array(await toBytes(png));
          ok = await copyImage(new Blob([bytes], { type: "image/png" }));
        } finally {
          bus.emit("hideLoading");
        }
        break;
      }
    }
    autotoast.show(ok ? "复制成功" : "复制失败", ok ? "success" : "error");
  } catch (error) {
    console.error("[MindMap/Contextmenu] 复制失败:", error);
    autotoast.show("复制失败", "error");
  }
}

/** 点击菜单外部时隐藏（捕获阶段：引擎会阻止节点上 mousedown 冒泡） */
function onDocumentMousedown(e: MouseEvent): void {
  if (!isShow.value) return;
  const el = contextmenuRef.value;
  if (el && e.target instanceof Node && el.contains(e.target)) return;
  hide();
}

function onWindowKeydown(e: KeyboardEvent): void {
  if (isShow.value && e.key === "Escape") hide();
}

useBusEvent("node_contextmenu", show);
useBusEvent("node_click", hide);
useBusEvent("draw_click", hide);
useBusEvent("expand_btn_click", hide);
useBusEvent("svg_mousedown", onMousedown);
useBusEvent("mouseup", onMouseup);
useBusEvent("translate", hide);
useBusEvent("node_mousedown", onNodeMousedown);

onMounted(() => {
  document.addEventListener("mousedown", onDocumentMousedown, true);
  window.addEventListener("keydown", onWindowKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onDocumentMousedown, true);
  window.removeEventListener("keydown", onWindowKeydown);
});
</script>

<template>
  <div
    v-if="isShow"
    ref="contextmenuRef"
    class="mm-cm mm-cm-list"
    :style="{ left: left + 'px', top: top + 'px' }"
    @contextmenu.prevent
  >
    <template v-if="type === 'node'">
      <div
        class="mm-cm-item"
        :class="{ 'is-disabled': nodeState.insertNodeBtnDisabled }"
        @click="exec('INSERT_NODE', nodeState.insertNodeBtnDisabled)"
      >
        <span class="mm-cm-name">插入同级节点</span>
        <span class="mm-cm-desc">Enter</span>
      </div>
      <div
        class="mm-cm-item"
        :class="{ 'is-disabled': nodeState.isGeneralization }"
        @click="exec('INSERT_CHILD_NODE', nodeState.isGeneralization)"
      >
        <span class="mm-cm-name">插入子级节点</span>
        <span class="mm-cm-desc">Tab</span>
      </div>
      <div
        class="mm-cm-item"
        :class="{ 'is-disabled': nodeState.insertNodeBtnDisabled }"
        @click="exec('INSERT_PARENT_NODE', nodeState.insertNodeBtnDisabled)"
      >
        <span class="mm-cm-name">插入父节点</span>
        <span class="mm-cm-desc">Shift + Tab</span>
      </div>
      <div
        class="mm-cm-item"
        :class="{ 'is-disabled': nodeState.insertNodeBtnDisabled }"
        @click="exec('ADD_GENERALIZATION', nodeState.insertNodeBtnDisabled)"
      >
        <span class="mm-cm-name">插入概要</span>
        <span class="mm-cm-desc">Ctrl + G</span>
      </div>
      <div class="mm-cm-split" />
      <div
        class="mm-cm-item"
        :class="{ 'is-disabled': nodeState.upNodeBtnDisabled }"
        @click="exec('UP_NODE', nodeState.upNodeBtnDisabled)"
      >
        <span class="mm-cm-name">上移节点</span>
        <span class="mm-cm-desc">Ctrl + ↑</span>
      </div>
      <div
        class="mm-cm-item"
        :class="{ 'is-disabled': nodeState.downNodeBtnDisabled }"
        @click="exec('DOWN_NODE', nodeState.downNodeBtnDisabled)"
      >
        <span class="mm-cm-name">下移节点</span>
        <span class="mm-cm-desc">Ctrl + ↓</span>
      </div>
      <div class="mm-cm-item" @click="exec('UNEXPAND_ALL')">
        <span class="mm-cm-name">收起所有下级节点</span>
      </div>
      <div class="mm-cm-item" @click="exec('EXPAND_ALL')">
        <span class="mm-cm-name">展开所有下级节点</span>
      </div>
      <div class="mm-cm-split" />
      <div class="mm-cm-item is-danger" @click="exec('REMOVE_NODE')">
        <span class="mm-cm-name">删除节点</span>
        <span class="mm-cm-desc">Delete</span>
      </div>
      <div class="mm-cm-item is-danger" @click="exec('REMOVE_CURRENT_NODE')">
        <span class="mm-cm-name">仅删除当前节点</span>
        <span class="mm-cm-desc">Shift + Backspace</span>
      </div>
      <div class="mm-cm-split" />
      <div
        class="mm-cm-item"
        :class="{ 'is-disabled': nodeState.isGeneralization }"
        @click="exec('COPY_NODE', nodeState.isGeneralization)"
      >
        <span class="mm-cm-name">复制节点</span>
        <span class="mm-cm-desc">Ctrl + C</span>
      </div>
      <div
        class="mm-cm-item"
        :class="{ 'is-disabled': nodeState.isGeneralization }"
        @click="exec('CUT_NODE', nodeState.isGeneralization)"
      >
        <span class="mm-cm-name">剪切节点</span>
        <span class="mm-cm-desc">Ctrl + X</span>
      </div>
      <div class="mm-cm-item" @click="exec('PASTE_NODE')">
        <span class="mm-cm-name">粘贴节点</span>
        <span class="mm-cm-desc">Ctrl + V</span>
      </div>
      <div class="mm-cm-split" />
      <div v-if="nodeState.hasHyperlink" class="mm-cm-item" @click="exec('REMOVE_HYPERLINK')">
        <span class="mm-cm-name">移除超链接</span>
      </div>
      <div v-if="nodeState.hasNote" class="mm-cm-item" @click="exec('REMOVE_NOTE')">
        <span class="mm-cm-name">移除备注</span>
      </div>
      <div class="mm-cm-item" @click="exec('REMOVE_CUSTOM_STYLES')">
        <span class="mm-cm-name">一键去除自定义样式</span>
      </div>
      <div class="mm-cm-item" @click="exec('EXPORT_CUR_NODE_TO_PNG')">
        <span class="mm-cm-name">导出该节点为图片</span>
      </div>
    </template>

    <template v-if="type === 'svg'">
      <div class="mm-cm-item" @click="exec('RETURN_CENTER')">
        <span class="mm-cm-name">回到根节点</span>
        <span class="mm-cm-desc">Ctrl + Enter</span>
      </div>
      <div
        class="mm-cm-item"
        :class="{ 'is-disabled': isReadonly }"
        @click="exec('SELECT_ALL', isReadonly)"
      >
        <span class="mm-cm-name">全选</span>
        <span class="mm-cm-desc">Ctrl + A</span>
      </div>
      <div class="mm-cm-split" />
      <div class="mm-cm-item" @click="exec('EXPAND_ALL')">
        <span class="mm-cm-name">展开所有</span>
      </div>
      <div class="mm-cm-item" @click="exec('UNEXPAND_ALL')">
        <span class="mm-cm-name">收起所有</span>
      </div>
      <div class="mm-cm-item">
        <span class="mm-cm-name">展开到</span>
        <NavIcon name="arrow-right" />
        <div
          class="mm-cm-sub mm-cm-list"
          :class="{ 'is-left': subItemsShowLeft }"
          style="top: -10px"
        >
          <div
            v-for="(item, index) in expandList"
            :key="item"
            class="mm-cm-item"
            @click="exec('UNEXPAND_TO_LEVEL', false, index + 1)"
          >
            {{ item }}
          </div>
        </div>
      </div>
      <div class="mm-cm-split" />
      <div
        class="mm-cm-item"
        :class="{ 'is-disabled': isReadonly }"
        @click="exec('RESET_LAYOUT', isReadonly)"
      >
        <span class="mm-cm-name">一键整理布局</span>
        <span class="mm-cm-desc">Ctrl + L</span>
      </div>
      <div class="mm-cm-item" @click="exec('FIT_CANVAS')">
        <span class="mm-cm-name">适应画布</span>
        <span class="mm-cm-desc">Ctrl + i</span>
      </div>
      <div class="mm-cm-item" @click="exec('TOGGLE_ZEN_MODE')">
        <span class="mm-cm-name">禅模式</span>
        {{ localConfig.isZenMode ? "√" : "" }}
      </div>
      <div class="mm-cm-split" />
      <div
        class="mm-cm-item"
        :class="{ 'is-disabled': isReadonly }"
        @click="exec('REMOVE_ALL_NODE_CUSTOM_STYLES', isReadonly)"
      >
        <span class="mm-cm-name">一键去除所有节点自定义样式</span>
      </div>
      <div class="mm-cm-item">
        <span class="mm-cm-name">复制到剪贴板</span>
        <NavIcon name="arrow-right" />
        <div
          class="mm-cm-sub mm-cm-list"
          :class="{ 'is-left': subItemsShowLeft }"
          style="top: -130px"
        >
          <div
            v-for="item in copyList"
            :key="item.value"
            class="mm-cm-item"
            @click="copyToClipboard(item.value)"
          >
            {{ item.name }}
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style lang="less" scoped>
.mm-cm-list {
  width: 250px;
  padding: 16px 0;
  border: 1px solid var(--border-color-1, #ebeef5);
  border-radius: 4px;
  background: var(--background-color-1, #fff);
  box-shadow: 0 4px 12px 0 rgba(0, 0, 0, 0.15);
}

.mm-cm {
  position: absolute;
  z-index: 1500;
  font-size: 14px;
  font-weight: 400;
  color: var(--text-color, #1a1a1a);
}

.mm-cm-split {
  width: 95%;
  height: 1px;
  margin: 2px auto;
  background-color: var(--border-color-1, #e9edf2);
}

.mm-cm-item {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 28px;
  padding: 0 16px;
  cursor: pointer;

  &:hover {
    background: var(--hover-background-color, #f5f5f5);

    > .mm-cm-sub {
      visibility: visible;
    }
  }

  &.is-danger {
    color: #f56c6c;
  }

  &.is-disabled {
    color: var(--text-color-3, grey);
    opacity: 0.7;
    cursor: not-allowed;
    pointer-events: none;
  }
}

.mm-cm-name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.mm-cm-desc {
  flex-shrink: 0;
  margin-left: 8px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--text-color-3, #999);
}

.mm-cm-sub {
  position: absolute;
  left: 100%;
  width: 150px;
  visibility: hidden;
  cursor: auto;

  &.is-left {
    left: -150px;
  }
}
</style>
