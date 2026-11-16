<script setup lang="ts">
/**
 * 节点样式面板（对应参考项目 web/src/pages/Edit/components/Style.vue）
 *
 * 面板名 nodeStyle（右侧触发栏「节点样式」），修改当前激活节点自身的样式：
 * 文字（字体 / 字号 / 对齐 / 加粗 / 斜体 / 划线 / 颜色）、边框、背景（纯色 / 渐变）、形状、
 * 线条（颜色 / 样式 / 宽度 / 箭头位置）、节点内边距、图片布局、标签布局。
 *
 * 与参考项目一致的行为：
 * - 表单回显取第一个激活节点的生效样式（getStyle(prop, false)），修改时逐个 setStyle 应用到
 *   全部激活节点（多选批量修改）；引擎命令会触发 data_change，未保存状态由根组件统一刷新；
 * - 渐变方向在界面上是一个选项，写入时换算成 startDir / endDir 两个样式；
 * - 没有激活节点时显示「请选择一个节点」；只读模式下引擎清空激活节点（显示空态），表单同时整体禁用。
 *
 * 在参考项目基础上的补充：
 * - 挂载时直接取上下文里的激活节点（禅模式退出后重新挂载也能立即回显）；
 * - 面板打开期间每次渲染结束按引擎当前激活节点重新回显，撤销 / 重做、格式刷、
 *   清除自定义样式之后表单不会显示过时的值。
 */
import { computed, reactive, shallowRef, watch } from "vue";
import autotoast from "autotoast.js";
import type { MindMapNodeInstance } from "@/core/mindmap-engine/full";
import { useBusEvent, useMindMapContext } from "../context";
import {
  alignList,
  borderDasharrayList,
  borderRadiusList,
  borderWidthList,
  fontFamilyList,
  fontSizeList,
  linearGradientDirList,
  shapeList,
  shapeListMap,
} from "../config";
import MmPanel from "../ui/MmPanel.vue";
import MmColor from "../ui/MmColor.vue";
import StyleOptionSelect from "./StyleOptionSelect.vue";
import { ensureOption, namedOptions, numberOptions, type StyleSelectOption } from "./styleOptions";

const PANEL_NAME = "nodeStyle";

/** 回显 / 修改的节点样式字段（与参考项目 style 对象一致，去掉引擎未注册 LineFlow 插件的 lineFlow*） */
const NODE_STYLE_KEYS = [
  "shape",
  "paddingX",
  "paddingY",
  "color",
  "fontFamily",
  "fontSize",
  "textDecoration",
  "fontWeight",
  "fontStyle",
  "borderWidth",
  "borderColor",
  "fillColor",
  "borderDasharray",
  "borderRadius",
  "lineColor",
  "lineDasharray",
  "lineWidth",
  "lineMarkerDir",
  "gradientStyle",
  "startColor",
  "endColor",
  "textAlign",
  "imgPlacement",
  "tagPlacement",
] as const;

type NodeStyleKey = (typeof NODE_STYLE_KEYS)[number];
/** linearGradientDir 不是引擎样式字段，修改时换算成 startDir / endDir */
type StyleProp = NodeStyleKey | "linearGradientDir";

const TEXT_DECORATION_OPTIONS: StyleSelectOption[] = [
  { value: "none", label: "无" },
  { value: "underline", label: "下划线" },
  { value: "line-through", label: "中划线" },
  { value: "overline", label: "上划线" },
];

const LINE_MARKER_DIR_OPTIONS: StyleSelectOption[] = [
  { value: "start", label: "头部" },
  { value: "end", label: "尾部" },
];

const IMG_PLACEMENT_OPTIONS = [
  { value: "top", label: "上" },
  { value: "bottom", label: "下" },
  { value: "left", label: "左" },
  { value: "right", label: "右" },
] as const;

const TAG_PLACEMENT_OPTIONS = [
  { value: "right", label: "右" },
  { value: "bottom", label: "下" },
] as const;

/** 内置形状 + 预览路径（扩展形状在回显时从引擎读取） */
const BUILT_IN_SHAPE_OPTIONS: StyleSelectOption[] = shapeList.map((item) => ({
  value: item.value,
  label: item.name,
  path: shapeListMap[item.value as keyof typeof shapeListMap],
  width: 60,
}));

const DASHARRAY_OPTIONS = namedOptions(borderDasharrayList);
const GRADIENT_DIR_OPTIONS = namedOptions(linearGradientDirList);

const { mindMap, activeNodes, activeSidebar, isReadonly } = useMindMapContext();

/** 当前激活节点（回显取第一个，修改应用到全部） */
const nodes = shallowRef<MindMapNodeInstance[]>([...activeNodes.value]);
/** 引擎扩展形状（extendShapeList 不是响应式数据，回显时读取一次） */
const extendShapeOptions = shallowRef<StyleSelectOption[]>([]);

const style = reactive<Record<StyleProp, any>>({
  shape: "",
  paddingX: 0,
  paddingY: 0,
  color: "",
  fontFamily: "",
  fontSize: "",
  textDecoration: "",
  fontWeight: "",
  fontStyle: "",
  borderWidth: "",
  borderColor: "",
  fillColor: "",
  borderDasharray: "",
  borderRadius: "",
  lineColor: "",
  lineDasharray: "",
  lineWidth: "",
  lineMarkerDir: "",
  gradientStyle: false,
  startColor: "",
  endColor: "",
  linearGradientDir: "",
  textAlign: "",
  imgPlacement: "",
  tagPlacement: "",
});

// 选项列表：当前值不在列表里（主题或旧数据用了列表外的值）时追加，保证下拉框能回显
const fontFamilyOptions = computed(() =>
  ensureOption(namedOptions(fontFamilyList), style.fontFamily)
);
const fontSizeOptions = computed(() => ensureOption(numberOptions(fontSizeList), style.fontSize));
const alignOptions = computed(() => ensureOption(namedOptions(alignList), style.textAlign));
const textDecorationOptions = computed(() =>
  ensureOption(TEXT_DECORATION_OPTIONS, style.textDecoration)
);
const borderDasharrayOptions = computed(() =>
  ensureOption(DASHARRAY_OPTIONS, style.borderDasharray)
);
const lineDasharrayOptions = computed(() => ensureOption(DASHARRAY_OPTIONS, style.lineDasharray));
const borderWidthOptions = computed(() =>
  ensureOption(numberOptions(borderWidthList), style.borderWidth)
);
// 与参考项目一致：线条宽度同样使用 borderWidthList
const lineWidthOptions = computed(() =>
  ensureOption(numberOptions(borderWidthList), style.lineWidth)
);
const borderRadiusOptions = computed(() =>
  ensureOption(numberOptions(borderRadiusList), style.borderRadius)
);
const lineMarkerDirOptions = computed(() =>
  ensureOption(LINE_MARKER_DIR_OPTIONS, style.lineMarkerDir)
);
const shapeOptions = computed(() =>
  ensureOption([...BUILT_IN_SHAPE_OPTIONS, ...extendShapeOptions.value], style.shape)
);

/** 读取引擎扩展形状（与参考项目一致排除鱼骨图专用的 fishHead） */
function readExtendShapeOptions(): StyleSelectOption[] {
  const list: any[] = mindMap.value?.extendShapeList ?? [];
  return list
    .filter((item) => item.name !== "fishHead")
    .map((item) => ({
      value: item.name,
      label: item.nameShow ?? item.name,
      path: item.path ?? "",
      width: 40,
    }));
}

function isSameDir(a: unknown, b: unknown): boolean {
  return Array.isArray(a) && Array.isArray(b) && a[0] === b[0] && a[1] === b[1];
}

/** 渐变方向：由 startDir / endDir 反查选项（不匹配任何预设时留空） */
function initLinearGradientDir(node: MindMapNodeInstance): void {
  const startDir = node.getStyle("startDir", false);
  const endDir = node.getStyle("endDir", false);
  const target = linearGradientDirList.find(
    (item) => isSameDir(item.start, startDir) && isSameDir(item.end, endDir)
  );
  style.linearGradientDir = target ? target.value : "";
}

/** 按第一个激活节点回显样式 */
function initNodeStyle(): void {
  const node = nodes.value[0];
  if (!node) return;
  try {
    for (const key of NODE_STYLE_KEYS) {
      style[key] = node.getStyle(key, false);
    }
    initLinearGradientDir(node);
    // 扩展形状通常不变，名称一致时不替换，避免形状下拉无谓地重新渲染
    const shapes = readExtendShapeOptions();
    const current = extendShapeOptions.value;
    if (
      shapes.length !== current.length ||
      shapes.some((shape, index) => shape.value !== current[index].value)
    ) {
      extendShapeOptions.value = shapes;
    }
  } catch (error) {
    console.error("[MindMap/Style] 读取节点样式失败:", error);
  }
}

/** 两组激活节点是否相同（同一批实例、同样顺序） */
function isSameNodeList(
  a: readonly MindMapNodeInstance[],
  b: readonly MindMapNodeInstance[]
): boolean {
  return a.length === b.length && a.every((node, index) => node === b[index]);
}

/**
 * 按引擎当前的激活节点刷新（面板打开、渲染结束时）。
 * 开启实时渲染时文字编辑每次按键都会渲染，激活节点未变时不替换列表，避免面板整体重新渲染
 */
function refreshFromEngine(): void {
  const instance = mindMap.value;
  if (!instance) return;
  const list: MindMapNodeInstance[] = instance.renderer.activeNodeList ?? [];
  if (!isSameNodeList(nodes.value, list)) nodes.value = [...list];
  initNodeStyle();
}

/** 把表单中的某个样式写入全部激活节点 */
function update(prop: StyleProp): void {
  const list = nodes.value;
  if (list.length === 0) {
    console.warn("[MindMap/Style] 没有激活节点，忽略样式修改:", prop);
    return;
  }
  if (isReadonly.value) {
    console.warn("[MindMap/Style] 只读模式下忽略样式修改:", prop);
    return;
  }
  try {
    if (prop === "linearGradientDir") {
      const target = linearGradientDirList.find((item) => item.value === style.linearGradientDir);
      if (!target) return;
      // 每个节点各自一份数组，避免多个节点数据共享同一引用
      list.forEach((node) => {
        node.setStyles({ startDir: [...target.start], endDir: [...target.end] });
      });
      console.info("[MindMap/Style] 修改渐变方向:", target.name, "节点数:", list.length);
    } else {
      const value = style[prop];
      list.forEach((node) => {
        node.setStyle(prop, value);
      });
      console.info("[MindMap/Style] 修改节点样式:", prop, "=", value, "节点数:", list.length);
    }
  } catch (error) {
    console.error("[MindMap/Style] 修改节点样式失败:", prop, error);
    autotoast.show("修改节点样式失败", "error");
  }
}

/** 设置值并立即应用（颜色、布局按钮等不经过 v-model 的控件） */
function setStyleValue(prop: StyleProp, value: unknown): void {
  style[prop] = value;
  update(prop);
}

function toggleFontWeight(): void {
  setStyleValue("fontWeight", style.fontWeight === "bold" ? "normal" : "bold");
}

function toggleFontStyle(): void {
  setStyleValue("fontStyle", style.fontStyle === "italic" ? "normal" : "italic");
}

// 节点激活变化（对应参考项目 created 里监听 node_active）
useBusEvent("node_active", (_node: unknown, list: MindMapNodeInstance[] | undefined) => {
  nodes.value = [...(list ?? [])];
  console.debug("[MindMap/Style] 激活节点变化，数量:", nodes.value.length);
  initNodeStyle();
});

// 面板打开期间，渲染结束后重新回显（节点数据可能被撤销 / 重做、格式刷等修改）
useBusEvent("node_tree_render_end", () => {
  if (activeSidebar.value === PANEL_NAME) refreshFromEngine();
});

watch(activeSidebar, (name) => {
  if (name === PANEL_NAME) refreshFromEngine();
});

initNodeStyle();
</script>

<template>
  <MmPanel name="nodeStyle" title="节点样式">
    <div v-if="nodes.length > 0" class="mm-node-style">
      <fieldset class="mm-sp-fieldset" :disabled="isReadonly">
        <p v-if="nodes.length > 1" class="mm-node-style__tip">
          已选中 {{ nodes.length }} 个节点，修改会同时应用到所有选中节点
        </p>

        <!-- 文字 -->
        <div class="mm-section-title">文字</div>
        <div class="mm-node-style__text-row">
          <select
            v-model="style.fontFamily"
            class="mm-select mm-node-style__font-family"
            title="字体"
            @change="update('fontFamily')"
          >
            <option
              v-for="item in fontFamilyOptions"
              :key="item.value"
              :value="item.value"
              :style="{ fontFamily: item.value }"
            >
              {{ item.label }}
            </option>
          </select>
          <select
            v-model="style.fontSize"
            class="mm-select mm-node-style__font-size"
            title="字号"
            @change="update('fontSize')"
          >
            <option v-for="item in fontSizeOptions" :key="item.value" :value="item.value">
              {{ item.label }}
            </option>
          </select>
          <select
            v-model="style.textAlign"
            class="mm-select mm-node-style__align"
            title="对齐方式"
            @change="update('textAlign')"
          >
            <option v-for="item in alignOptions" :key="item.value" :value="item.value">
              {{ item.label }}
            </option>
          </select>
        </div>
        <div class="mm-node-style__btn-group">
          <button
            type="button"
            class="mm-node-style__btn"
            :class="{ 'is-active': style.fontWeight === 'bold' }"
            :aria-pressed="style.fontWeight === 'bold'"
            title="加粗"
            @click="toggleFontWeight"
          >
            B
          </button>
          <button
            type="button"
            class="mm-node-style__btn mm-node-style__btn--italic"
            :class="{ 'is-active': style.fontStyle === 'italic' }"
            :aria-pressed="style.fontStyle === 'italic'"
            title="斜体"
            @click="toggleFontStyle"
          >
            I
          </button>
          <StyleOptionSelect
            v-model="style.textDecoration"
            :options="textDecorationOptions"
            plain
            title="划线"
            @change="update('textDecoration')"
          >
            <template #trigger>
              <span :style="{ textDecoration: style.textDecoration || 'none' }">U</span>
            </template>
            <template #option="{ option }">
              <span :style="{ textDecoration: option.value }">{{ option.label }}</span>
            </template>
          </StyleOptionSelect>
          <!-- 颜色放在最右侧：MmColor 的弹层右对齐，放在左侧会超出面板 -->
          <div class="mm-node-style__btn mm-node-style__btn--color" title="颜色">
            <span>A</span>
            <MmColor
              :model-value="style.color"
              @update:model-value="setStyleValue('color', $event)"
            />
          </div>
        </div>

        <!-- 边框 -->
        <div class="mm-section-title">边框</div>
        <div class="mm-row">
          <span class="mm-row__label">颜色</span>
          <div class="mm-row__control">
            <MmColor
              :model-value="style.borderColor"
              @update:model-value="setStyleValue('borderColor', $event)"
            />
          </div>
        </div>
        <div class="mm-row">
          <span class="mm-row__label">样式</span>
          <div class="mm-row__control">
            <StyleOptionSelect
              v-model="style.borderDasharray"
              :options="borderDasharrayOptions"
              preview="dasharray"
              @change="update('borderDasharray')"
            />
          </div>
        </div>
        <div class="mm-row">
          <span class="mm-row__label">宽度</span>
          <div class="mm-row__control">
            <StyleOptionSelect
              v-model="style.borderWidth"
              :options="borderWidthOptions"
              preview="width"
              @change="update('borderWidth')"
            />
          </div>
        </div>
        <div v-show="style.shape === 'rectangle'" class="mm-row">
          <span class="mm-row__label">圆角</span>
          <div class="mm-row__control">
            <select v-model="style.borderRadius" class="mm-select" @change="update('borderRadius')">
              <option v-for="item in borderRadiusOptions" :key="item.value" :value="item.value">
                {{ item.label }}
              </option>
            </select>
          </div>
        </div>

        <!-- 背景 -->
        <div class="mm-section-title">背景</div>
        <div class="mm-row">
          <span class="mm-row__label">颜色</span>
          <div class="mm-row__control">
            <MmColor
              :model-value="style.fillColor"
              @update:model-value="setStyleValue('fillColor', $event)"
            />
          </div>
        </div>
        <div class="mm-row">
          <span class="mm-row__label">渐变</span>
          <div class="mm-row__control">
            <label class="mm-sp-check">
              <input
                v-model="style.gradientStyle"
                type="checkbox"
                aria-label="渐变"
                @change="update('gradientStyle')"
              />
            </label>
          </div>
        </div>
        <template v-if="style.gradientStyle">
          <div class="mm-row">
            <span class="mm-row__label">起始</span>
            <div class="mm-row__control">
              <MmColor
                :model-value="style.startColor"
                @update:model-value="setStyleValue('startColor', $event)"
              />
            </div>
          </div>
          <div class="mm-row">
            <span class="mm-row__label">结束</span>
            <div class="mm-row__control">
              <MmColor
                :model-value="style.endColor"
                @update:model-value="setStyleValue('endColor', $event)"
              />
            </div>
          </div>
          <div class="mm-row">
            <span class="mm-row__label">方向</span>
            <div class="mm-row__control">
              <select
                v-model="style.linearGradientDir"
                class="mm-select"
                @change="update('linearGradientDir')"
              >
                <option v-for="item in GRADIENT_DIR_OPTIONS" :key="item.value" :value="item.value">
                  {{ item.label }}
                </option>
              </select>
            </div>
          </div>
        </template>

        <!-- 形状 -->
        <div class="mm-section-title">形状</div>
        <div class="mm-row">
          <span class="mm-row__label">形状</span>
          <div class="mm-row__control">
            <StyleOptionSelect
              v-model="style.shape"
              :options="shapeOptions"
              preview="shape"
              width="150px"
              @change="update('shape')"
            />
          </div>
        </div>

        <!-- 线条 -->
        <div class="mm-section-title">线条</div>
        <div class="mm-row">
          <span class="mm-row__label">颜色</span>
          <div class="mm-row__control">
            <MmColor
              :model-value="style.lineColor"
              @update:model-value="setStyleValue('lineColor', $event)"
            />
          </div>
        </div>
        <div class="mm-row">
          <span class="mm-row__label">样式</span>
          <div class="mm-row__control">
            <StyleOptionSelect
              v-model="style.lineDasharray"
              :options="lineDasharrayOptions"
              preview="dasharray"
              @change="update('lineDasharray')"
            />
          </div>
        </div>
        <div class="mm-row">
          <span class="mm-row__label">宽度</span>
          <div class="mm-row__control">
            <StyleOptionSelect
              v-model="style.lineWidth"
              :options="lineWidthOptions"
              preview="width"
              @change="update('lineWidth')"
            />
          </div>
        </div>
        <div class="mm-row">
          <span class="mm-row__label">箭头位置</span>
          <div class="mm-row__control">
            <select
              v-model="style.lineMarkerDir"
              class="mm-select"
              @change="update('lineMarkerDir')"
            >
              <option v-for="item in lineMarkerDirOptions" :key="item.value" :value="item.value">
                {{ item.label }}
              </option>
            </select>
          </div>
        </div>

        <!-- 节点内边距 -->
        <div class="mm-section-title">节点内边距</div>
        <div class="mm-row">
          <span class="mm-row__label">水平</span>
          <div class="mm-sp-range">
            <input
              v-model.number="style.paddingX"
              type="range"
              min="0"
              max="100"
              @change="update('paddingX')"
            />
            <span class="mm-sp-range__value">{{ style.paddingX }}</span>
          </div>
        </div>
        <div class="mm-row">
          <span class="mm-row__label">垂直</span>
          <div class="mm-sp-range">
            <input
              v-model.number="style.paddingY"
              type="range"
              min="0"
              max="100"
              @change="update('paddingY')"
            />
            <span class="mm-sp-range__value">{{ style.paddingY }}</span>
          </div>
        </div>

        <!-- 节点图片布局 -->
        <div class="mm-section-title">图片</div>
        <div class="mm-row">
          <span class="mm-row__label">布局</span>
          <div class="mm-row__control">
            <div class="mm-segment" role="radiogroup" aria-label="图片布局">
              <button
                v-for="item in IMG_PLACEMENT_OPTIONS"
                :key="item.value"
                type="button"
                role="radio"
                class="mm-segment__item mm-sp-segment-btn"
                :class="{ 'is-active': style.imgPlacement === item.value }"
                :aria-checked="style.imgPlacement === item.value"
                @click="setStyleValue('imgPlacement', item.value)"
              >
                {{ item.label }}
              </button>
            </div>
          </div>
        </div>

        <!-- 节点标签布局 -->
        <div class="mm-section-title">标签</div>
        <div class="mm-row">
          <span class="mm-row__label">布局</span>
          <div class="mm-row__control">
            <div class="mm-segment" role="radiogroup" aria-label="标签布局">
              <button
                v-for="item in TAG_PLACEMENT_OPTIONS"
                :key="item.value"
                type="button"
                role="radio"
                class="mm-segment__item mm-sp-segment-btn"
                :class="{ 'is-active': style.tagPlacement === item.value }"
                :aria-checked="style.tagPlacement === item.value"
                @click="setStyleValue('tagPlacement', item.value)"
              >
                {{ item.label }}
              </button>
            </div>
          </div>
        </div>
      </fieldset>
    </div>
    <div v-else class="mm-node-style__empty">
      <span class="mm-iconfont icontianjiazijiedian mm-node-style__empty-icon" aria-hidden="true" />
      <span>请选择一个节点</span>
    </div>
  </MmPanel>
</template>

<style lang="less" scoped>
@import "./style-panel.less";

.mm-node-style__tip {
  margin: 0 0 12px;
  padding: 6px 8px;
  border-radius: 4px;
  background: var(--background-color-2, #f5f7fa);
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-color-2, #666);
}

.mm-node-style__text-row {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;

  .mm-select {
    min-width: 0;
  }
}

.mm-node-style__font-family {
  flex: 1;
}

.mm-node-style__font-size {
  width: 62px;
}

.mm-node-style__align {
  width: 88px;
}

.mm-node-style__btn-group {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  margin-bottom: 8px;
}

.mm-node-style__btn {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 30px;
  padding: 0;
  border: 1px solid var(--border-color-1, #dcdfe6);
  border-radius: 4px;
  background: var(--background-color-1, #fff);
  color: var(--text-color-1, #333);
  font-family: inherit;
  font-size: 14px;
  font-weight: bold;
  cursor: pointer;

  &:hover:not(:disabled) {
    border-color: var(--primary-color, #409eff);
  }

  &.is-active {
    border-color: var(--primary-color, #409eff);
    background: var(--hover-background-color, rgba(0, 0, 0, 0.04));
    color: var(--primary-color, #409eff);
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
}

.mm-node-style__btn--italic {
  font-style: italic;
}

.mm-node-style__btn--color {
  cursor: default;
}

.mm-node-style__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 100%;
  color: var(--text-color-3, #999);
  font-size: 13px;
}

.mm-node-style__empty-icon {
  font-size: 72px;
  line-height: 1;
}
</style>
