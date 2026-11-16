<script setup lang="ts">
/**
 * 基础样式面板（对应参考项目 web/src/pages/Edit/components/BaseStyle.vue）
 *
 * 面板名 baseStyle（右侧触发栏「基础样式」），修改整张思维导图的主题配置：
 * 背景（颜色 / 图片 / 重复 / 位置 / 大小）、连线（颜色 / 粗细 / 风格 / 根节点样式 / 圆角 /
 * 根节点连线起始位置 / 箭头）、彩虹线条、概要的连线、关联线、关联线文字、节点边框风格、
 * 节点内边距、图片、图标、节点外边距（二级 / 三级及以下）、外框内边距。
 *
 * 数据去向（参考项目用 props.data / configData + storeData / storeConfig，这里直接读写引擎）：
 * - 主题配置：getThemeConfig() 回显（主题默认值 + 自定义覆盖）；修改时复制 getCustomThemeConfig()
 *   改动后 setThemeConfig()，再 notifyChange() 刷新未保存状态。自定义主题配置包含在
 *   getData(true).theme.config 里，「保存」时随思维导图写回 Markdown 代码块；
 * - 彩虹线条 rainbowLinesConfig、外框内边距 outerFramePaddingX / Y 属于引擎选项（mindMap.opt），
 *   getData(true) 不包含它们（写进主题配置引擎也不会读取），因此与参考项目的 storeConfig 一样走
 *   setEngineConfig()：立即作用于当前实例并持久化为编辑器偏好，之后打开的思维导图同样生效。
 *
 * 与参考项目一致：打开面板时回显；面板打开期间导入 / 新建（setData）后重新回显；
 * 修改主题配置前派发 showLoading，渲染结束（node_tree_render_end）由根组件关闭加载态。
 */
import { computed, reactive, ref, watch } from "vue";
import autotoast from "autotoast.js";
import { useBusEvent, useMindMapContext } from "../context";
import {
  backgroundPositionList,
  backgroundRepeatList,
  backgroundSizeList,
  borderDasharrayList,
  fontFamilyList,
  fontSizeList,
  lineStyleList,
  lineStyleMap,
  lineWidthList,
  rainbowLinesOptions,
  rootLineKeepSameInCurveList,
  supportLineRadiusLayouts,
  supportLineStyleLayoutsMap,
  supportNodeUseLineStyleLayouts,
  supportRootLineKeepSameInCurveLayouts,
} from "../config";
import MmPanel from "../ui/MmPanel.vue";
import MmColor from "../ui/MmColor.vue";
import StyleOptionSelect from "./StyleOptionSelect.vue";
import BaseStyleImageUpload from "./BaseStyleImageUpload.vue";
import {
  ensureOption,
  linePaths,
  namedOptions,
  numberOptions,
  type StyleSelectOption,
} from "./styleOptions";

const PANEL_NAME = "baseStyle";

/** 顶层主题配置字段（与参考项目 style 对象一致，去掉引擎未注册 LineFlow 插件的 lineFlow*；
 *  marginX / marginY 按层级存放，单独处理） */
const BASE_STYLE_KEYS = [
  "backgroundColor",
  "lineColor",
  "lineWidth",
  "lineStyle",
  "showLineMarker",
  "rootLineKeepSameInCurve",
  "rootLineStartPositionKeepSameInCurve",
  "lineRadius",
  "generalizationLineWidth",
  "generalizationLineColor",
  "associativeLineColor",
  "associativeLineWidth",
  "associativeLineActiveWidth",
  "associativeLineDasharray",
  "associativeLineActiveColor",
  "associativeLineTextFontSize",
  "associativeLineTextColor",
  "associativeLineTextFontFamily",
  "paddingX",
  "paddingY",
  "imgMaxWidth",
  "imgMaxHeight",
  "iconSize",
  "backgroundImage",
  "backgroundRepeat",
  "backgroundPosition",
  "backgroundSize",
  "nodeUseLineStyle",
] as const;

type BaseStyleKey = (typeof BASE_STYLE_KEYS)[number];
type MarginKey = "marginX" | "marginY";
type MarginLevel = "second" | "node";
type OuterFramePaddingKey = "outerFramePaddingX" | "outerFramePaddingY";

const BACKGROUND_TABS = [
  { value: "color", label: "颜色" },
  { value: "image", label: "图片" },
] as const;

const MARGIN_TABS: ReadonlyArray<{ value: MarginLevel; label: string }> = [
  { value: "second", label: "二级节点" },
  { value: "node", label: "三级及以下节点" },
];

/** 直线连线的圆角可选值（与参考项目一致） */
const LINE_RADIUS_LIST = [0, 2, 5, 7, 10, 12, 15];

const ROOT_LINE_START_POSITION_OPTIONS: StyleSelectOption[] = [
  { value: false, label: "中心" },
  { value: true, label: "边缘" },
];

const LINE_WIDTH_OPTIONS = numberOptions(lineWidthList);
const DASHARRAY_OPTIONS = namedOptions(borderDasharrayList);
const FONT_FAMILY_OPTIONS = namedOptions(fontFamilyList);
const FONT_SIZE_OPTIONS = numberOptions(fontSizeList);

/** 连线风格 + 示意路径 */
const LINE_STYLE_OPTIONS: StyleSelectOption[] = lineStyleList.map((item) => ({
  value: item.value,
  label: item.name,
  paths: linePaths(lineStyleMap[item.value as keyof typeof lineStyleMap]),
}));

/** 彩虹线条选项（value 为预设名，list 为配色；close 表示不使用） */
const RAINBOW_OPTIONS: StyleSelectOption[] = rainbowLinesOptions.map((item, index) => ({
  value: item.value,
  label: item.list ? "彩虹线条配色" + index : "不使用彩虹线条",
  list: item.list ?? null,
}));

/**
 * 内置背景图片（图片地址列表，对应参考项目 store.bgList）。
 * 参考项目网页版里该列表始终为空（setBgList 只是留给客户端注入的口子，没有调用方），
 * 这里同样默认为空：为空时「内置背景图片」分组不显示，填入地址即可启用
 */
const BUILT_IN_BACKGROUND_LIST: readonly string[] = [];

const { mindMap, bus, activeSidebar, isReadonly, setEngineConfig, notifyChange } =
  useMindMapContext();

/** 背景页签 */
const activeTab = ref<"color" | "image">("color");
/** 内置背景图片列表是否展开（收起时只显示第一行，与参考项目一致默认展开） */
const bgListExpand = ref(true);
/** 节点外边距页签：二级节点 / 三级及以下节点 */
const marginActiveTab = ref<MarginLevel>("second");
/** 当前结构（决定连线风格、圆角、底边框风格等选项是否可用） */
const currentLayout = ref<string>(mindMap.value?.getLayout() ?? "");
/** 当前彩虹线条配色，null 表示未开启 */
const curRainbowLineColorList = ref<string[] | null>(null);

const style = reactive<Record<BaseStyleKey, any>>({
  backgroundColor: "",
  lineColor: "",
  lineWidth: "",
  lineStyle: "",
  showLineMarker: false,
  rootLineKeepSameInCurve: "",
  rootLineStartPositionKeepSameInCurve: "",
  lineRadius: 0,
  generalizationLineWidth: "",
  generalizationLineColor: "",
  associativeLineColor: "",
  associativeLineWidth: 0,
  associativeLineActiveWidth: 0,
  associativeLineDasharray: "",
  associativeLineActiveColor: "",
  associativeLineTextFontSize: 0,
  associativeLineTextColor: "",
  associativeLineTextFontFamily: "",
  paddingX: 0,
  paddingY: 0,
  imgMaxWidth: 0,
  imgMaxHeight: 0,
  iconSize: 0,
  backgroundImage: "",
  backgroundRepeat: "no-repeat",
  backgroundPosition: "",
  backgroundSize: "",
  nodeUseLineStyle: false,
});

/** 当前页签层级的节点外边距 */
const margin = reactive<Record<MarginKey, number>>({ marginX: 0, marginY: 0 });

const outerFramePadding = reactive<Record<OuterFramePaddingKey, number>>({
  outerFramePaddingX: 0,
  outerFramePaddingY: 0,
});

// 选项列表：当前值不在列表里（主题或旧数据用了列表外的值）时追加，保证下拉框能回显
const lineWidthOptions = computed(() => ensureOption(LINE_WIDTH_OPTIONS, style.lineWidth));
const generalizationLineWidthOptions = computed(() =>
  ensureOption(LINE_WIDTH_OPTIONS, style.generalizationLineWidth)
);
const associativeLineWidthOptions = computed(() =>
  ensureOption(LINE_WIDTH_OPTIONS, style.associativeLineWidth)
);
const associativeLineActiveWidthOptions = computed(() =>
  ensureOption(LINE_WIDTH_OPTIONS, style.associativeLineActiveWidth)
);
const associativeLineDasharrayOptions = computed(() =>
  ensureOption(DASHARRAY_OPTIONS, style.associativeLineDasharray)
);
const associativeLineFontFamilyOptions = computed(() =>
  ensureOption(FONT_FAMILY_OPTIONS, style.associativeLineTextFontFamily)
);
const associativeLineFontSizeOptions = computed(() =>
  ensureOption(FONT_SIZE_OPTIONS, style.associativeLineTextFontSize)
);
const rootLineKeepSameOptions = computed(() =>
  ensureOption(namedOptions(rootLineKeepSameInCurveList), style.rootLineKeepSameInCurve)
);
const rootLineStartPositionOptions = computed(() =>
  ensureOption(ROOT_LINE_START_POSITION_OPTIONS, style.rootLineStartPositionKeepSameInCurve)
);
const lineRadiusOptions = computed(() =>
  ensureOption(numberOptions(LINE_RADIUS_LIST), style.lineRadius)
);
const backgroundRepeatOptions = computed(() =>
  ensureOption(namedOptions(backgroundRepeatList), style.backgroundRepeat)
);
const backgroundPositionOptions = computed(() =>
  ensureOption(namedOptions(backgroundPositionList), style.backgroundPosition)
);
const backgroundSizeOptions = computed(() =>
  ensureOption(namedOptions(backgroundSizeList), style.backgroundSize)
);

/** 当前结构支持「只有底边框」的节点风格 */
const showNodeUseLineStyle = computed(() =>
  supportNodeUseLineStyleLayouts.includes(currentLayout.value)
);

/** 直线风格且结构支持时才可设置连线圆角 */
const showLineRadius = computed(
  () => style.lineStyle === "straight" && supportLineRadiusLayouts.includes(currentLayout.value)
);

/** 当前结构可用的连线风格（曲线、直连只有部分结构支持） */
const lineStyleListShow = computed(() =>
  LINE_STYLE_OPTIONS.filter((item) => {
    const layouts = (supportLineStyleLayoutsMap as Record<string, string[] | undefined>)[
      item.value
    ];
    return !layouts || layouts.includes(currentLayout.value);
  })
);

/** 曲线风格且结构支持时显示「根节点」样式与「根节点连线起始位置」 */
const showRootLineOptions = computed(
  () =>
    style.lineStyle === "curve" &&
    supportRootLineKeepSameInCurveLayouts.includes(currentLayout.value)
);

/** 彩虹线条当前选中的预设（自定义配色不匹配任何预设时为 null） */
const rainbowValue = computed(() => {
  const current = curRainbowLineColorList.value;
  if (!current) return "close";
  const key = current.join("|");
  return RAINBOW_OPTIONS.find((item) => item.list?.join("|") === key)?.value ?? null;
});

// 与参考项目一致：结构变化后当前连线风格不再可用时，表单回落到第一个可用风格（不写入配置）
watch(lineStyleListShow, (list) => {
  if (list.length > 0 && !list.some((item) => item.value === style.lineStyle)) {
    style.lineStyle = list[0].value;
  }
});

/** 日志里截断过长的值（背景图片 data URL 可能有几 MB） */
function describeValue(value: unknown): unknown {
  return typeof value === "string" && value.length > 80
    ? `${value.slice(0, 48)}…（共 ${value.length} 字符）`
    : value;
}

/** 回显当前层级的节点外边距 */
function initMarginStyle(): void {
  const levelConfig = mindMap.value?.getThemeConfig()?.[marginActiveTab.value] ?? {};
  margin.marginX = levelConfig.marginX ?? 0;
  margin.marginY = levelConfig.marginY ?? 0;
}

/** 回显主题配置（背景图片 none 显示为空） */
function initStyle(): void {
  const instance = mindMap.value;
  if (!instance) return;
  for (const key of BASE_STYLE_KEYS) {
    const value = instance.getThemeConfig(key);
    style[key] = key === "backgroundImage" && value === "none" ? "" : value;
  }
  initMarginStyle();
}

/** 回显彩虹线条（开启时取插件实际使用的配色，未指定配色时为默认配色） */
function initRainbowLines(): void {
  const instance = mindMap.value;
  if (!instance) return;
  const config = instance.getConfig("rainbowLinesConfig") || {};
  curRainbowLineColorList.value =
    config.open && instance.rainbowLines ? [...instance.rainbowLines.getColorsList()] : null;
}

/** 回显外框内边距（参考项目垂直方向误读了 outerFramePaddingX，这里按各自字段读取） */
function initOuterFramePadding(): void {
  const instance = mindMap.value;
  if (!instance) return;
  outerFramePadding.outerFramePaddingX = instance.getConfig("outerFramePaddingX");
  outerFramePadding.outerFramePaddingY = instance.getConfig("outerFramePaddingY");
}

/** 打开面板时整体回显（对应参考项目 watch activeSidebar） */
function initPanel(): void {
  const instance = mindMap.value;
  if (!instance) return;
  currentLayout.value = instance.getLayout();
  initStyle();
  initRainbowLines();
  initOuterFramePadding();
  console.info("[MindMap/BaseStyle] 打开面板，当前结构:", currentLayout.value);
}

/** 修改顶层主题配置 */
function update(key: BaseStyleKey, value: unknown): void {
  const instance = mindMap.value;
  if (!instance) return;
  if (isReadonly.value) {
    console.warn("[MindMap/BaseStyle] 只读模式下忽略主题配置修改:", key);
    return;
  }
  style[key] = key === "backgroundImage" && value === "none" ? "" : value;
  // 在副本上修改，不直接改动引擎持有的自定义配置对象
  const config = { ...instance.getCustomThemeConfig(), [key]: value };
  console.info("[MindMap/BaseStyle] 修改主题配置:", key, "=", describeValue(value));
  bus.emit("showLoading");
  try {
    instance.setThemeConfig(config);
    notifyChange();
  } catch (error) {
    bus.emit("hideLoading");
    console.error("[MindMap/BaseStyle] 修改主题配置失败:", key, error);
    autotoast.show("修改基础样式失败", "error");
  }
}

/** 修改当前页签层级（second / node）的节点外边距 */
function updateMargin(type: MarginKey, value: number): void {
  const instance = mindMap.value;
  if (!instance || isReadonly.value) return;
  margin[type] = value;
  const level = marginActiveTab.value;
  const custom: Record<string, any> = instance.getCustomThemeConfig() ?? {};
  const config = { ...custom, [level]: { ...custom[level], [type]: value } };
  console.info("[MindMap/BaseStyle] 修改节点外边距:", level, type, "=", value);
  try {
    instance.setThemeConfig(config);
    notifyChange();
  } catch (error) {
    console.error("[MindMap/BaseStyle] 修改节点外边距失败:", error);
    autotoast.show("修改节点外边距失败", "error");
  }
}

function switchMarginTab(level: MarginLevel): void {
  marginActiveTab.value = level;
  initMarginStyle();
}

/** 使用内置背景图片（对应参考项目 useBg；已在使用时不再重复渲染） */
function useBuiltInBackground(url: string): void {
  if (style.backgroundImage === url) return;
  update("backgroundImage", url);
}

/** 修改彩虹线条（list 为 null 表示关闭） */
function updateRainbowLinesConfig(list: string[] | null): void {
  const instance = mindMap.value;
  if (!instance || isReadonly.value) return;
  curRainbowLineColorList.value = list ? [...list] : null;
  try {
    // 先持久化并合并进引擎选项，再交给插件更新：updateConfig 的深合并会把新旧 colorsList 数组拼接，
    // updateRainLinesConfig 随后用传入的配色覆盖 opt.rainbowLinesConfig.colorsList，结果才正确。
    // 开启时插件会清除所有节点自定义的连线颜色（会产生一条历史记录），与参考项目一致
    setEngineConfig({
      rainbowLinesConfig: list ? { open: true, colorsList: [...list] } : { open: false },
    });
    instance.rainbowLines?.updateRainLinesConfig({
      open: !!list,
      colorsList: list ? [...list] : [],
    });
    console.info("[MindMap/BaseStyle] 修改彩虹线条:", list ? list.join(", ") : "关闭");
  } catch (error) {
    console.error("[MindMap/BaseStyle] 修改彩虹线条失败:", error);
    autotoast.show("修改彩虹线条失败", "error");
  }
}

function onRainbowChange(value: unknown): void {
  const option = RAINBOW_OPTIONS.find((item) => item.value === value);
  if (option) updateRainbowLinesConfig(option.list);
}

/** 修改外框内边距（引擎选项，修改后重新渲染外框） */
function updateOuterFramePadding(prop: OuterFramePaddingKey, value: number): void {
  const instance = mindMap.value;
  if (!instance || isReadonly.value) return;
  outerFramePadding[prop] = value;
  try {
    setEngineConfig({ [prop]: value });
    instance.render();
    console.info("[MindMap/BaseStyle] 修改外框内边距:", prop, "=", value);
  } catch (error) {
    console.error("[MindMap/BaseStyle] 修改外框内边距失败:", error);
    autotoast.show("修改外框内边距失败", "error");
  }
}

watch(
  activeSidebar,
  (name) => {
    if (name === PANEL_NAME) initPanel();
  },
  { immediate: true }
);

// 导入 / 新建会整体替换主题配置：面板打开时重新回显（对应参考项目 onSetData）
useBusEvent("setData", () => {
  if (activeSidebar.value !== PANEL_NAME) return;
  setTimeout(() => {
    console.debug("[MindMap/BaseStyle] 数据已替换，重新回显");
    initStyle();
  }, 0);
});

useBusEvent("layout_change", (layout: string) => {
  currentLayout.value = layout;
});
</script>

<template>
  <MmPanel name="baseStyle" title="基础样式">
    <fieldset class="mm-sp-fieldset" :disabled="isReadonly">
      <!-- 背景 -->
      <div class="mm-section-title">背景</div>
      <div class="mm-sp-tabs" role="tablist">
        <button
          v-for="tab in BACKGROUND_TABS"
          :key="tab.value"
          type="button"
          role="tab"
          class="mm-sp-tab"
          :class="{ 'is-active': activeTab === tab.value }"
          :aria-selected="activeTab === tab.value"
          @click="activeTab = tab.value"
        >
          {{ tab.label }}
        </button>
      </div>
      <div v-if="activeTab === 'color'" class="mm-row">
        <span class="mm-row__label">颜色</span>
        <div class="mm-row__control">
          <MmColor
            :model-value="style.backgroundColor"
            @update:model-value="update('backgroundColor', $event)"
          />
        </div>
      </div>
      <template v-else>
        <BaseStyleImageUpload
          :model-value="style.backgroundImage"
          :disabled="isReadonly"
          @update:model-value="update('backgroundImage', $event)"
        />
        <div class="mm-row">
          <span class="mm-row__label">图片重复</span>
          <div class="mm-row__control">
            <select
              v-model="style.backgroundRepeat"
              class="mm-select"
              @change="update('backgroundRepeat', style.backgroundRepeat)"
            >
              <option v-for="item in backgroundRepeatOptions" :key="item.value" :value="item.value">
                {{ item.label }}
              </option>
            </select>
          </div>
        </div>
        <div class="mm-row">
          <span class="mm-row__label">图片位置</span>
          <div class="mm-row__control">
            <select
              v-model="style.backgroundPosition"
              class="mm-select"
              @change="update('backgroundPosition', style.backgroundPosition)"
            >
              <option
                v-for="item in backgroundPositionOptions"
                :key="item.value"
                :value="item.value"
              >
                {{ item.label }}
              </option>
            </select>
          </div>
        </div>
        <div class="mm-row">
          <span class="mm-row__label">图片大小</span>
          <div class="mm-row__control">
            <select
              v-model="style.backgroundSize"
              class="mm-select"
              @change="update('backgroundSize', style.backgroundSize)"
            >
              <option v-for="item in backgroundSizeOptions" :key="item.value" :value="item.value">
                {{ item.label }}
              </option>
            </select>
          </div>
        </div>
        <!-- 内置背景图片（列表为空时不显示，与参考项目一致） -->
        <template v-if="BUILT_IN_BACKGROUND_LIST.length > 0">
          <div class="mm-row">
            <span class="mm-row__label">内置背景图片</span>
            <div class="mm-row__control">
              <button
                type="button"
                class="mm-base-style__expand"
                :class="{ 'is-expanded': bgListExpand }"
                :aria-expanded="bgListExpand"
                :title="bgListExpand ? '收起' : '展开'"
                @click="bgListExpand = !bgListExpand"
              />
            </div>
          </div>
          <div class="mm-base-style__bg-list" :class="{ 'is-expanded': bgListExpand }">
            <button
              v-for="(item, index) in BUILT_IN_BACKGROUND_LIST"
              :key="index"
              type="button"
              class="mm-base-style__bg-item"
              :class="{ 'is-active': style.backgroundImage === item }"
              :aria-pressed="style.backgroundImage === item"
              title="使用该背景图片"
              @click="useBuiltInBackground(item)"
            >
              <img :src="item" alt="" />
            </button>
          </div>
        </template>
      </template>

      <!-- 连线 -->
      <div class="mm-section-title">连线</div>
      <div class="mm-row">
        <span class="mm-row__label">颜色</span>
        <div class="mm-row__control">
          <MmColor
            :model-value="style.lineColor"
            @update:model-value="update('lineColor', $event)"
          />
        </div>
      </div>
      <div class="mm-row">
        <span class="mm-row__label">粗细</span>
        <div class="mm-row__control">
          <StyleOptionSelect
            :model-value="style.lineWidth"
            :options="lineWidthOptions"
            preview="width"
            @change="update('lineWidth', $event)"
          />
        </div>
      </div>
      <div v-if="lineStyleListShow.length > 1" class="mm-row">
        <span class="mm-row__label">风格</span>
        <div class="mm-row__control">
          <StyleOptionSelect
            :model-value="style.lineStyle"
            :options="lineStyleListShow"
            preview="lineStyle"
            @change="update('lineStyle', $event)"
          />
        </div>
      </div>
      <div v-if="showRootLineOptions" class="mm-row">
        <span class="mm-row__label">根节点</span>
        <div class="mm-row__control">
          <select
            v-model="style.rootLineKeepSameInCurve"
            class="mm-select"
            @change="update('rootLineKeepSameInCurve', style.rootLineKeepSameInCurve)"
          >
            <option
              v-for="item in rootLineKeepSameOptions"
              :key="String(item.value)"
              :value="item.value"
            >
              {{ item.label }}
            </option>
          </select>
        </div>
      </div>
      <div v-if="showLineRadius" class="mm-row">
        <span class="mm-row__label">圆角大小</span>
        <div class="mm-row__control">
          <select
            v-model="style.lineRadius"
            class="mm-select"
            @change="update('lineRadius', style.lineRadius)"
          >
            <option v-for="item in lineRadiusOptions" :key="item.value" :value="item.value">
              {{ item.label }}
            </option>
          </select>
        </div>
      </div>
      <div v-if="showRootLineOptions" class="mm-row">
        <span class="mm-row__label">根节点连线起始位置</span>
        <div class="mm-row__control">
          <select
            v-model="style.rootLineStartPositionKeepSameInCurve"
            class="mm-select"
            @change="
              update(
                'rootLineStartPositionKeepSameInCurve',
                style.rootLineStartPositionKeepSameInCurve
              )
            "
          >
            <option
              v-for="item in rootLineStartPositionOptions"
              :key="String(item.value)"
              :value="item.value"
            >
              {{ item.label }}
            </option>
          </select>
        </div>
      </div>
      <div class="mm-row">
        <label class="mm-sp-check">
          <input
            v-model="style.showLineMarker"
            type="checkbox"
            @change="update('showLineMarker', style.showLineMarker)"
          />
          <span>是否显示箭头</span>
        </label>
      </div>

      <!-- 彩虹线条 -->
      <div class="mm-section-title">彩虹线条</div>
      <div class="mm-row">
        <StyleOptionSelect
          :model-value="rainbowValue"
          :options="RAINBOW_OPTIONS"
          width="100%"
          align="left"
          title="彩虹线条"
          @change="onRainbowChange"
        >
          <template #trigger>
            <span v-if="curRainbowLineColorList" class="mm-base-style__colors-bar">
              <span
                v-for="(color, index) in curRainbowLineColorList"
                :key="index"
                :style="{ backgroundColor: color }"
              />
            </span>
            <span v-else class="mm-base-style__no-rainbow">不使用彩虹线条</span>
          </template>
          <template #option="{ option }">
            <span v-if="option.list" class="mm-base-style__colors-bar">
              <span
                v-for="(color, index) in option.list"
                :key="index"
                :style="{ backgroundColor: color }"
              />
            </span>
            <span v-else class="mm-base-style__no-rainbow">不使用彩虹线条</span>
          </template>
        </StyleOptionSelect>
      </div>

      <!-- 概要的连线 -->
      <div class="mm-section-title">概要的连线</div>
      <div class="mm-row">
        <span class="mm-row__label">颜色</span>
        <div class="mm-row__control">
          <MmColor
            :model-value="style.generalizationLineColor"
            @update:model-value="update('generalizationLineColor', $event)"
          />
        </div>
      </div>
      <div class="mm-row">
        <span class="mm-row__label">粗细</span>
        <div class="mm-row__control">
          <StyleOptionSelect
            :model-value="style.generalizationLineWidth"
            :options="generalizationLineWidthOptions"
            preview="width"
            @change="update('generalizationLineWidth', $event)"
          />
        </div>
      </div>

      <!-- 关联线 -->
      <div class="mm-section-title">关联线</div>
      <div class="mm-row">
        <span class="mm-row__label">颜色</span>
        <div class="mm-row__control">
          <MmColor
            :model-value="style.associativeLineColor"
            @update:model-value="update('associativeLineColor', $event)"
          />
        </div>
      </div>
      <div class="mm-row">
        <span class="mm-row__label">粗细</span>
        <div class="mm-row__control">
          <StyleOptionSelect
            :model-value="style.associativeLineWidth"
            :options="associativeLineWidthOptions"
            preview="width"
            @change="update('associativeLineWidth', $event)"
          />
        </div>
      </div>
      <div class="mm-row">
        <span class="mm-row__label">激活颜色</span>
        <div class="mm-row__control">
          <MmColor
            :model-value="style.associativeLineActiveColor"
            @update:model-value="update('associativeLineActiveColor', $event)"
          />
        </div>
      </div>
      <div class="mm-row">
        <span class="mm-row__label">激活粗细</span>
        <div class="mm-row__control">
          <StyleOptionSelect
            :model-value="style.associativeLineActiveWidth"
            :options="associativeLineActiveWidthOptions"
            preview="width"
            @change="update('associativeLineActiveWidth', $event)"
          />
        </div>
      </div>
      <div class="mm-row">
        <span class="mm-row__label">样式</span>
        <div class="mm-row__control">
          <StyleOptionSelect
            :model-value="style.associativeLineDasharray"
            :options="associativeLineDasharrayOptions"
            preview="dasharray"
            @change="update('associativeLineDasharray', $event)"
          />
        </div>
      </div>

      <!-- 关联线文字 -->
      <div class="mm-section-title">关联线文字</div>
      <div class="mm-row">
        <span class="mm-row__label">字体</span>
        <div class="mm-row__control">
          <select
            v-model="style.associativeLineTextFontFamily"
            class="mm-select"
            @change="update('associativeLineTextFontFamily', style.associativeLineTextFontFamily)"
          >
            <option
              v-for="item in associativeLineFontFamilyOptions"
              :key="item.value"
              :value="item.value"
              :style="{ fontFamily: item.value }"
            >
              {{ item.label }}
            </option>
          </select>
        </div>
      </div>
      <div class="mm-row">
        <span class="mm-row__label">颜色</span>
        <div class="mm-row__control">
          <MmColor
            :model-value="style.associativeLineTextColor"
            @update:model-value="update('associativeLineTextColor', $event)"
          />
        </div>
      </div>
      <div class="mm-row">
        <span class="mm-row__label">字号</span>
        <div class="mm-row__control">
          <select
            v-model="style.associativeLineTextFontSize"
            class="mm-select"
            @change="update('associativeLineTextFontSize', style.associativeLineTextFontSize)"
          >
            <option
              v-for="item in associativeLineFontSizeOptions"
              :key="item.value"
              :value="item.value"
            >
              {{ item.label }}
            </option>
          </select>
        </div>
      </div>

      <!-- 节点边框风格 -->
      <template v-if="showNodeUseLineStyle">
        <div class="mm-section-title">节点边框风格</div>
        <div class="mm-row">
          <label class="mm-sp-check">
            <input
              v-model="style.nodeUseLineStyle"
              type="checkbox"
              @change="update('nodeUseLineStyle', style.nodeUseLineStyle)"
            />
            <span>是否使用只有底边框的风格</span>
          </label>
        </div>
      </template>

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
            @change="update('paddingX', style.paddingX)"
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
            @change="update('paddingY', style.paddingY)"
          />
          <span class="mm-sp-range__value">{{ style.paddingY }}</span>
        </div>
      </div>

      <!-- 图片 -->
      <div class="mm-section-title">图片</div>
      <div class="mm-row">
        <span class="mm-row__label">显示的最大宽度</span>
        <div class="mm-sp-range">
          <input
            v-model.number="style.imgMaxWidth"
            type="range"
            min="10"
            max="500"
            @change="update('imgMaxWidth', style.imgMaxWidth)"
          />
          <span class="mm-sp-range__value">{{ style.imgMaxWidth }}</span>
        </div>
      </div>
      <div class="mm-row">
        <span class="mm-row__label">显示的最大高度</span>
        <div class="mm-sp-range">
          <input
            v-model.number="style.imgMaxHeight"
            type="range"
            min="10"
            max="500"
            @change="update('imgMaxHeight', style.imgMaxHeight)"
          />
          <span class="mm-sp-range__value">{{ style.imgMaxHeight }}</span>
        </div>
      </div>

      <!-- 图标 -->
      <div class="mm-section-title">图标</div>
      <div class="mm-row">
        <span class="mm-row__label">大小</span>
        <div class="mm-sp-range">
          <input
            v-model.number="style.iconSize"
            type="range"
            min="12"
            max="50"
            @change="update('iconSize', style.iconSize)"
          />
          <span class="mm-sp-range__value">{{ style.iconSize }}</span>
        </div>
      </div>

      <!-- 节点外边距 -->
      <div class="mm-section-title">节点外边距</div>
      <div class="mm-sp-tabs" role="tablist">
        <button
          v-for="tab in MARGIN_TABS"
          :key="tab.value"
          type="button"
          role="tab"
          class="mm-sp-tab"
          :class="{ 'is-active': marginActiveTab === tab.value }"
          :aria-selected="marginActiveTab === tab.value"
          @click="switchMarginTab(tab.value)"
        >
          {{ tab.label }}
        </button>
      </div>
      <div class="mm-row">
        <span class="mm-row__label">水平</span>
        <div class="mm-sp-range">
          <input
            v-model.number="margin.marginX"
            type="range"
            min="0"
            max="200"
            @change="updateMargin('marginX', margin.marginX)"
          />
          <span class="mm-sp-range__value">{{ margin.marginX }}</span>
        </div>
      </div>
      <div class="mm-row">
        <span class="mm-row__label">垂直</span>
        <div class="mm-sp-range">
          <input
            v-model.number="margin.marginY"
            type="range"
            min="0"
            max="200"
            @change="updateMargin('marginY', margin.marginY)"
          />
          <span class="mm-sp-range__value">{{ margin.marginY }}</span>
        </div>
      </div>

      <!-- 外框内边距 -->
      <div class="mm-section-title">外框内边距</div>
      <div class="mm-row">
        <span class="mm-row__label">水平</span>
        <div class="mm-sp-range">
          <input
            v-model.number="outerFramePadding.outerFramePaddingX"
            type="range"
            min="0"
            max="100"
            @change="
              updateOuterFramePadding('outerFramePaddingX', outerFramePadding.outerFramePaddingX)
            "
          />
          <span class="mm-sp-range__value">{{ outerFramePadding.outerFramePaddingX }}</span>
        </div>
      </div>
      <div class="mm-row">
        <span class="mm-row__label">垂直</span>
        <div class="mm-sp-range">
          <input
            v-model.number="outerFramePadding.outerFramePaddingY"
            type="range"
            min="0"
            max="100"
            @change="
              updateOuterFramePadding('outerFramePaddingY', outerFramePadding.outerFramePaddingY)
            "
          />
          <span class="mm-sp-range__value">{{ outerFramePadding.outerFramePaddingY }}</span>
        </div>
      </div>
    </fieldset>
  </MmPanel>
</template>

<style lang="less" scoped>
@import "./style-panel.less";

/* 彩虹线条配色条（触发按钮与选项共用） */
.mm-base-style__colors-bar {
  display: flex;
  flex: 1;
  align-items: center;
  min-width: 0;
  height: 15px;

  span {
    flex: 1;
    height: 100%;
  }
}

.mm-base-style__no-rainbow {
  flex: 1;
  text-align: center;
}

/* 内置背景图片：展开 / 收起箭头（展开时朝上，表示点击收起） */
.mm-base-style__expand {
  position: relative;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;

  &::before {
    content: "";
    position: absolute;
    top: 50%;
    left: 50%;
    width: 6px;
    height: 6px;
    margin: -5px 0 0 -3px;
    border-right: 1.5px solid var(--text-color-3, #999);
    border-bottom: 1.5px solid var(--text-color-3, #999);
    transform: rotate(45deg);
    transition: transform 0.2s;
  }

  &.is-expanded::before {
    margin-top: -1px;
    transform: rotate(-135deg);
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
}

/* 内置背景图片列表：两列缩略图，收起时只露出第一行 */
.mm-base-style__bg-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  max-height: 73px;
  margin-bottom: 10px;
  overflow: hidden;

  &.is-expanded {
    max-height: none;
  }
}

.mm-base-style__bg-item {
  box-sizing: border-box;
  height: 73px;
  padding: 4px;
  overflow: hidden;
  border: 1px solid var(--border-color-1, #e1e4e8);
  border-radius: 5px;
  background: var(--background-color-2, #f5f7fa);
  cursor: pointer;

  &:hover:not(:disabled) {
    border-color: var(--primary-color, #409eff);
  }

  &.is-active {
    border-color: var(--primary-color, #409eff);
    box-shadow: 0 0 0 1px var(--primary-color, #409eff);
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  img {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: 3px;
    object-fit: cover;
  }
}
</style>
