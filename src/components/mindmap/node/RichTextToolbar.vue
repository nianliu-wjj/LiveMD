<script setup lang="ts">
/**
 * 富文本选区浮动工具条（对应参考项目 RichTextToolbar.vue）
 *
 * 节点处于富文本编辑状态且选中了文字时（引擎 rich_text_selection_change 的 hasRange 为 true），
 * 在选区上方显示：加粗、斜体、下划线、删除线、字体、字号、字体颜色、背景颜色、对齐方式、清除样式
 * （按钮与顺序同参考项目），经引擎 richText.formatText / removeFormat 作用于选中文字。
 *
 * 实现要点（与参考项目的差异及原因）：
 * 1. 用 Teleport 挂到 document.body（position: fixed，z-index 10001）：引擎的富文本编辑框挂在 body 上
 *    （z-index 10000），而编辑器根元素是 z-index 2000 的层叠上下文，留在根元素内的浮层 z-index 再大
 *    也会被编辑框盖住（多行文字选中第二行及以后时工具条与编辑框重叠，按钮点不到）。参考项目同样把
 *    工具条移到了 body 上；
 * 2. 颜色用 MmColor，色板是工具条的子元素（参考项目的 el-popover 是 body 上独立的弹层）。工具条上按下
 *    鼠标时阻止默认行为，编辑框不失焦、选区不丢失，工具条（连同色板）也就不会因选区丢失被隐藏；
 *    取色器里的输入框例外（否则无法输入），聚焦输入框导致选区暂时丢失时保持显示，改色后由引擎用
 *    lastRange 恢复选区；编辑结束（hide_text_edit）时无条件隐藏；
 * 3. 阻止 mousedown / click / keydown 冒泡：引擎在 body 上监听 mousedown + click 判断「点击编辑框外部」
 *    以结束编辑；键盘事件也不应触发引擎或 LiveMD 的快捷键；
 * 4. 不用 transform 居中（会让 MmColor 的 position: fixed 遮罩改为相对工具条定位），量出宽度后计算
 *    left；选区上方放不下时改放到选区下方，水平方向限制在视口内；
 * 5. 工具条在 body 上继承不到编辑器根元素上的明暗覆盖变量（force-dark / force-light），显示时从画布
 *    容器读取主题变量的计算值写到工具条上，保证与编辑器界面配色一致；
 * 6. 每次显示重新创建（v-if），色板等内部状态不会残留到下一次；格式化后从 Quill 读回选区格式刷新
 *    按钮状态（参考项目只在本地取反，选区内格式不一致时会不准）；
 * 7. 字体 / 字号 / 对齐方式为悬停展开的下拉列表（同参考项目 trigger="hover"）。
 */
import { computed, nextTick, onBeforeUnmount, reactive, ref } from "vue";
import MmColor from "../ui/MmColor.vue";
import { alignList, fontFamilyList, fontSizeList } from "../config";
import { useBusEvent, useMindMapContext } from "../context";

/** 引擎派发的选区矩形（视口坐标） */
interface SelectionRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
}

/** Quill getFormat 返回的选区格式（选区内格式不一致时，值类字段为数组） */
interface FormatInfo {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  font?: string | string[];
  size?: string | string[];
  color?: string | string[];
  background?: string | string[];
  align?: string | string[];
  [key: string]: unknown;
}

/** 从编辑器界面同步到工具条上的主题变量（工具条与其中的取色器用到的） */
const THEME_VARS = [
  "--background-color-1",
  "--background-color-2",
  "--text-color",
  "--text-color-1",
  "--text-color-2",
  "--text-color-3",
  "--border-color-1",
  "--border-color-2",
  "--hover-background-color",
  "--primary-color",
];
/** 工具条与选区的间距 */
const SELECTION_GAP = 5;
/** 工具条与视口边缘的最小距离 */
const VIEWPORT_MARGIN = 8;

const { mindMap, isDark } = useMindMapContext();
/** 引擎实例：setup 时已就绪；根组件卸载时会先把上下文里的引用置空，解绑监听用这里保存的实例 */
const instance = mindMap.value;

const toolbarRef = ref<HTMLElement | null>(null);
const visible = ref(false);
const position = reactive({ left: 0, top: 0 });
/** 当前选区格式（按钮高亮） */
const formatInfo = ref<FormatInfo>({});
/** 最近一次选区矩形 */
let selectionRect: SelectionRect | null = null;

/** 字体颜色 / 背景颜色的当前值（选区内颜色不一致时为空） */
const fontColor = computed(() => toText(formatInfo.value.color));
const fontBackgroundColor = computed(() => toText(formatInfo.value.background));

function toText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 选区变化：有选中文字时显示并定位，否则隐藏（对应参考项目 onRichTextSelectionChange） */
function onRichTextSelectionChange(
  hasRange: boolean,
  rect?: SelectionRect | null,
  info?: FormatInfo | null
): void {
  if (!hasRange || !rect) {
    // 焦点在工具条内的输入框（取色器）时选区会暂时丢失，此时保持显示
    if (visible.value && toolbarRef.value?.contains(document.activeElement)) {
      console.debug("[MindMap/RichTextToolbar] 焦点在工具条输入框内，保持显示");
      return;
    }
    hide();
    return;
  }
  selectionRect = rect;
  formatInfo.value = { ...info };
  const wasVisible = visible.value;
  visible.value = true;
  if (!wasVisible) console.debug("[MindMap/RichTextToolbar] 显示富文本工具条");
  // 工具条渲染出来后才能量到尺寸
  void nextTick(() => {
    if (!wasVisible) syncThemeVars();
    updatePosition();
  });
}

/** 隐藏工具条 */
function hide(): void {
  if (!visible.value) return;
  visible.value = false;
  selectionRect = null;
  console.debug("[MindMap/RichTextToolbar] 隐藏富文本工具条");
}

/** 把编辑器界面上主题变量的计算值写到工具条上（工具条挂在 body 上，继承不到根元素的覆盖变量） */
function syncThemeVars(): void {
  const el = toolbarRef.value;
  const source = mindMap.value?.el;
  if (!el || !source) return;
  const computedStyle = getComputedStyle(source);
  for (const name of THEME_VARS) {
    const value = computedStyle.getPropertyValue(name).trim();
    if (value) {
      el.style.setProperty(name, value);
    } else {
      el.style.removeProperty(name);
    }
  }
}

/** 定位：水平居中于选区并限制在视口内；选区上方放不下时放到选区下方 */
function updatePosition(): void {
  const el = toolbarRef.value;
  const rect = selectionRect;
  if (!el || !rect) return;
  const { width, height } = el.getBoundingClientRect();
  const centerLeft = rect.left + rect.width / 2 - width / 2;
  const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN;
  position.left = Math.max(VIEWPORT_MARGIN, Math.min(centerLeft, maxLeft));
  const aboveTop = rect.top - height - SELECTION_GAP;
  position.top = aboveTop >= VIEWPORT_MARGIN ? aboveTop : rect.bottom + SELECTION_GAP;
}

/**
 * 工具条上按下鼠标：阻止冒泡（避免引擎判定为点击编辑框外部而结束编辑）；
 * 除输入框外阻止默认行为，保持编辑框焦点与选区
 */
function onToolbarMousedown(event: MouseEvent): void {
  event.stopPropagation();
  const target = event.target as Element | null;
  if (target?.closest("input, textarea, select")) return;
  event.preventDefault();
}

/** 从 Quill 读回当前选区的格式，刷新按钮状态 */
function syncFormatInfo(): void {
  const richText = mindMap.value?.richText;
  const range = richText?.range ?? richText?.lastRange;
  if (!richText?.quill || !range) return;
  try {
    formatInfo.value = { ...richText.quill.getFormat(range.index, range.length) };
  } catch (error) {
    console.warn("[MindMap/RichTextToolbar] 读取选区格式失败:", error);
  }
}

/** 格式化选中文字（选区丢失时引擎会用 lastRange 并恢复选区） */
function format(config: Record<string, unknown>): void {
  const richText = mindMap.value?.richText;
  if (!richText) {
    console.warn("[MindMap/RichTextToolbar] 富文本插件不可用，忽略格式化:", config);
    return;
  }
  console.debug("[MindMap/RichTextToolbar] 格式化选中文字:", config);
  richText.formatText(config);
  syncFormatInfo();
}

function toggleBold(): void {
  formatInfo.value.bold = !formatInfo.value.bold;
  format({ bold: formatInfo.value.bold });
}

function toggleItalic(): void {
  formatInfo.value.italic = !formatInfo.value.italic;
  format({ italic: formatInfo.value.italic });
}

function toggleUnderline(): void {
  formatInfo.value.underline = !formatInfo.value.underline;
  format({ underline: formatInfo.value.underline });
}

function toggleStrike(): void {
  formatInfo.value.strike = !formatInfo.value.strike;
  format({ strike: formatInfo.value.strike });
}

function changeFontFamily(font: string): void {
  formatInfo.value.font = font;
  format({ font });
}

function changeFontSize(size: number): void {
  // Quill 字号格式带单位，高亮比较也按 "14px" 形式
  formatInfo.value.size = `${size}px`;
  format({ size: `${size}px` });
}

function changeFontColor(color: string): void {
  formatInfo.value.color = color;
  format({ color });
}

function changeFontBackgroundColor(background: string): void {
  formatInfo.value.background = background;
  format({ background });
}

function changeTextAlign(align: string): void {
  formatInfo.value.align = align;
  format({ align });
}

/** 清除选中文字的全部格式 */
function removeFormat(): void {
  const richText = mindMap.value?.richText;
  if (!richText) return;
  console.debug("[MindMap/RichTextToolbar] 清除选中文字格式");
  richText.removeFormat();
  syncFormatInfo();
}

useBusEvent("rich_text_selection_change", onRichTextSelectionChange);
// 结束编辑（hide_text_edit 不在根组件转发列表里，直接监听引擎）：无条件隐藏
instance?.on("hide_text_edit", hide);

onBeforeUnmount(() => {
  instance?.off("hide_text_edit", hide);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="toolbarRef"
      class="mm-rich-text-toolbar"
      :class="{ 'is-dark': isDark }"
      :style="{ left: `${position.left}px`, top: `${position.top}px` }"
      @mousedown="onToolbarMousedown"
      @click.stop
      @keydown.stop
    >
      <div
        class="mm-rich-text-toolbar__btn"
        :class="{ 'is-active': formatInfo.bold }"
        title="加粗"
        @click="toggleBold"
      >
        <span class="mm-iconfont iconzitijiacu" />
      </div>
      <div
        class="mm-rich-text-toolbar__btn"
        :class="{ 'is-active': formatInfo.italic }"
        title="斜体"
        @click="toggleItalic"
      >
        <span class="mm-iconfont iconzitixieti" />
      </div>
      <div
        class="mm-rich-text-toolbar__btn"
        :class="{ 'is-active': formatInfo.underline }"
        title="下划线"
        @click="toggleUnderline"
      >
        <span class="mm-iconfont iconzitixiahuaxian" />
      </div>
      <div
        class="mm-rich-text-toolbar__btn"
        :class="{ 'is-active': formatInfo.strike }"
        title="删除线"
        @click="toggleStrike"
      >
        <span class="mm-iconfont iconshanchuxian" />
      </div>

      <div class="mm-rich-text-toolbar__dropdown">
        <div class="mm-rich-text-toolbar__btn" title="字体">
          <span class="mm-iconfont iconxingzhuang-wenzi" />
        </div>
        <div class="mm-rich-text-toolbar__options">
          <div
            v-for="item in fontFamilyList"
            :key="item.value"
            class="mm-rich-text-toolbar__option"
            :class="{ 'is-active': formatInfo.font === item.value }"
            :style="{ fontFamily: item.value }"
            @click="changeFontFamily(item.value)"
          >
            {{ item.name }}
          </div>
        </div>
      </div>

      <div class="mm-rich-text-toolbar__dropdown">
        <div class="mm-rich-text-toolbar__btn" title="字号">
          <span class="mm-iconfont iconcase mm-rich-text-toolbar__icon-large" />
        </div>
        <div class="mm-rich-text-toolbar__options">
          <div
            v-for="item in fontSizeList"
            :key="item"
            class="mm-rich-text-toolbar__option"
            :class="{ 'is-active': formatInfo.size === `${item}px` }"
            :style="{ fontSize: `${item}px`, height: `${item < 30 ? 30 : item + 10}px` }"
            @click="changeFontSize(item)"
          >
            {{ item }}px
          </div>
        </div>
      </div>

      <!-- 取色器的触发按钮透明铺满图标按钮，点击按钮即打开色板 -->
      <div class="mm-rich-text-toolbar__btn mm-rich-text-toolbar__color" title="字体颜色">
        <span class="mm-iconfont iconzitiyanse" :style="{ color: fontColor || undefined }" />
        <MmColor :model-value="fontColor" @update:model-value="changeFontColor" />
      </div>
      <div class="mm-rich-text-toolbar__btn mm-rich-text-toolbar__color" title="背景颜色">
        <span class="mm-iconfont iconbeijingyanse" />
        <MmColor
          :model-value="fontBackgroundColor"
          @update:model-value="changeFontBackgroundColor"
        />
      </div>

      <div class="mm-rich-text-toolbar__dropdown">
        <div class="mm-rich-text-toolbar__btn" title="对齐方式">
          <span class="mm-iconfont iconjuzhongduiqi" />
        </div>
        <div class="mm-rich-text-toolbar__options">
          <div
            v-for="item in alignList"
            :key="item.value"
            class="mm-rich-text-toolbar__option"
            :class="{ 'is-active': formatInfo.align === item.value }"
            @click="changeTextAlign(item.value)"
          >
            {{ item.name }}
          </div>
        </div>
      </div>

      <div class="mm-rich-text-toolbar__btn" title="清除样式" @click="removeFormat">
        <span class="mm-iconfont iconqingchu" />
      </div>
    </div>
  </Teleport>
</template>

<style lang="less" scoped>
/* 挂在 body 上：层级高于引擎富文本编辑框（10000）；宽度按内容计算，避免贴近视口右缘时被压缩 */
.mm-rich-text-toolbar {
  position: fixed;
  z-index: 10001;
  width: max-content;
  height: 52px;
  display: flex;
  align-items: center;
  padding: 0 4px;
  box-sizing: border-box;
  border: 1px solid var(--border-color-1, rgba(0, 0, 0, 0.06));
  border-radius: 8px;
  background: var(--background-color-1, #fff);
  color: var(--text-color-1, #333);
  box-shadow: 0 2px 16px 0 rgba(0, 0, 0, 0.12);
  font-size: 13px;
  user-select: none;

  &.is-dark {
    box-shadow: 0 2px 16px 0 rgba(0, 0, 0, 0.45);
  }
}

.mm-rich-text-toolbar__btn {
  position: relative;
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  margin: 0 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  cursor: pointer;

  &:hover {
    background: var(--hover-background-color, #eefbed);
  }

  &.is-active {
    color: var(--primary-color, #12bb37);
  }

  .mm-iconfont {
    font-size: 20px;
  }

  .mm-rich-text-toolbar__icon-large {
    font-size: 26px;
  }
}

/* 悬停展开的下拉列表：列表紧贴按钮区域下缘，鼠标移入列表时仍处于悬停状态 */
.mm-rich-text-toolbar__dropdown {
  position: relative;
  height: 100%;
  display: flex;
  align-items: center;

  &:hover .mm-rich-text-toolbar__options {
    display: block;
  }
}

.mm-rich-text-toolbar__options {
  display: none;
  position: absolute;
  top: 100%;
  left: 50%;
  z-index: 1;
  width: 150px;
  max-height: 320px;
  margin-left: -75px;
  padding: 6px 0;
  overflow-y: auto;
  border: 1px solid var(--border-color-1, #e4e7ed);
  border-radius: 6px;
  background: var(--background-color-1, #fff);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
}

.mm-rich-text-toolbar__option {
  height: 30px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  white-space: nowrap;
  color: var(--text-color-1, #333);
  cursor: pointer;

  &:hover {
    background: var(--hover-background-color, #f7f7f7);
  }

  &.is-active {
    color: var(--primary-color, #12bb37);
  }
}

/* 取色器铺满按钮：触发按钮透明，色板在按钮下方展开 */
.mm-rich-text-toolbar__color {
  :deep(.mm-color) {
    position: absolute;
    inset: 0;
  }

  :deep(.mm-color__trigger) {
    width: 100%;
    height: 100%;
    border: none;
    opacity: 0;
  }
}
</style>
