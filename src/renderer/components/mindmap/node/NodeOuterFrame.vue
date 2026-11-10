<script setup lang="ts">
/**
 * 外框样式面板（对应参考项目 NodeOuterFrame.vue）
 *
 * - 面板名 nodeOuterFrameStyle：点击画布上的外框（引擎 outer_frame_active）时打开，
 *   外框取消激活（outer_frame_deactivate）或被删除（outer_frame_delete）时收起；
 * - 外框样式保存在范围内每个节点的 outerFrame 数据里，面板显示范围内第一个节点的样式
 *   （与引擎渲染外框时取样式的规则一致），修改经 outerFrame.updateActiveOuterFrame 写回
 *   （走 SET_NODE_DATA 命令，可撤销，外框保持激活）；
 * - 外框：边框粗细 / 虚线、边框颜色、圆角、填充颜色；外框文字：字体、颜色、加粗、斜体、行高、
 *   字号、背景填充、背景圆角、显示位置、水平 / 垂直内边距；可删除外框，或只删除外框文字。
 *
 * 与参考项目的差异：
 * - 下拉框为原生 select，选项不显示线宽 / 虚线预览；表单按移植约定用 .mm-row 单列排布；
 * - 只读模式下点击外框不打开面板（引擎只读时禁止激活节点，面板同样不应修改数据）。
 */
import { onBeforeUnmount, reactive } from "vue";
import type { MindMapNodeInstance } from "@/core/mindmap-engine/full";
// 与参考项目一致直接引用插件类取默认样式（类型由 mindmap-engine/modules.d.ts 兜底）
import OuterFrame from "@/core/mindmap-engine/src/plugins/OuterFrame.js";
import MmPanel from "../ui/MmPanel.vue";
import MmColor from "../ui/MmColor.vue";
import {
  borderDasharrayList,
  borderRadiusList,
  fontFamilyList,
  fontSizeList,
  lineHeightList,
  lineWidthList,
} from "../config";
import { useBusEvent, useMindMapContext } from "../context";

/** 外框样式（字段与引擎 OuterFrame 插件的 defaultStyle 一致） */
interface OuterFrameStyle {
  radius: number;
  strokeWidth: number;
  strokeColor: string;
  strokeDasharray: string;
  fill: string;
  fontSize: number;
  fontFamily: string;
  /** normal / bold */
  fontWeight: string;
  /** normal / italic */
  fontStyle: string;
  color: string;
  lineHeight: number;
  textFill: string;
  textFillRadius: number;
  /** 文字背景内边距：左、上、右、下 */
  textFillPadding: number[];
  /** 文字相对外框的水平位置：left / center / right */
  textAlign: string;
}

type OuterFrameStyleKey = keyof OuterFrameStyle;

/** 外框文字显示位置 */
const TEXT_ALIGN_LIST = [
  { name: "左", value: "left" },
  { name: "中", value: "center" },
  { name: "右", value: "right" },
];

const { mindMap, activeSidebar, setActiveSidebar, isReadonly } = useMindMapContext();
/** 引擎实例：setup 时已就绪；根组件卸载时会先把上下文里的引用置空，解绑监听用这里保存的实例 */
const instance = mindMap.value;

/** 引擎默认外框样式（OuterFrame 插件类的静态属性 defaultStyle） */
const defaultStyle = cloneStyle(OuterFrame.defaultStyle);

/** 当前外框样式（面板显示值） */
const styleConfig = reactive<OuterFrameStyle>(cloneStyle(defaultStyle));
/** 文字背景内边距滑块值（对应 textFillPadding 的左 / 上） */
const paddingStyle = reactive({ paddingX: 0, paddingY: 0 });

/** 复制样式对象（数组字段单独复制，避免与引擎节点数据共享同一个数组） */
function cloneStyle(style: Partial<OuterFrameStyle>): OuterFrameStyle {
  return { ...style, textFillPadding: [...(style.textFillPadding ?? [])] } as OuterFrameStyle;
}

/** 外框激活：读取范围内第一个节点的外框样式并打开面板（对应参考项目 onOuterFrameActive） */
function onOuterFrameActive(_el: unknown, parentNode: MindMapNodeInstance, range: number[]): void {
  if (isReadonly.value) {
    console.debug("[MindMap/NodeOuterFrame] 只读模式，不打开外框样式面板");
    return;
  }
  const firstNode = parentNode?.children?.[range?.[0]];
  const outerFrame: Partial<OuterFrameStyle> = firstNode?.getData("outerFrame") ?? {};
  for (const key of Object.keys(styleConfig) as OuterFrameStyleKey[]) {
    const value = outerFrame[key] !== undefined ? outerFrame[key] : defaultStyle[key];
    (styleConfig as Record<string, unknown>)[key] = Array.isArray(value) ? [...value] : value;
  }
  const [paddingX = 0, paddingY = 0] = styleConfig.textFillPadding;
  paddingStyle.paddingX = paddingX;
  paddingStyle.paddingY = paddingY;
  console.info("[MindMap/NodeOuterFrame] 外框已激活，打开外框样式面板，范围:", range);
  setActiveSidebar("nodeOuterFrameStyle");
}

/** 修改当前激活外框的某项样式（对应参考项目 updateOuterFrame） */
function updateOuterFrame<K extends OuterFrameStyleKey>(key: K, value: OuterFrameStyle[K]): void {
  (styleConfig as OuterFrameStyle)[key] = value;
  const outerFrame = mindMap.value?.outerFrame;
  if (!outerFrame) {
    console.warn("[MindMap/NodeOuterFrame] OuterFrame 插件不可用，忽略样式修改:", key);
    return;
  }
  console.debug("[MindMap/NodeOuterFrame] 修改外框样式:", key, value);
  // 数组复制一份再交给引擎，避免面板状态与节点数据共用同一个数组
  outerFrame.updateActiveOuterFrame({ [key]: Array.isArray(value) ? [...value] : value });
}

/** 修改下拉框后写回（v-model 已先更新 styleConfig） */
function onSelectChange(key: OuterFrameStyleKey): void {
  updateOuterFrame(key, styleConfig[key]);
}

/** 切换加粗 */
function toggleFontWeight(): void {
  updateOuterFrame("fontWeight", styleConfig.fontWeight === "bold" ? "normal" : "bold");
}

/** 切换斜体 */
function toggleFontStyle(): void {
  updateOuterFrame("fontStyle", styleConfig.fontStyle === "italic" ? "normal" : "italic");
}

/** 修改文字背景内边距：水平方向同时改左右，垂直方向同时改上下（对应参考项目 updatePadding） */
function updatePadding(dir: "x" | "y", value: number): void {
  const [left = 0, top = 0] = styleConfig.textFillPadding;
  updateOuterFrame(
    "textFillPadding",
    dir === "x" ? [value, top, value, top] : [left, value, left, value]
  );
}

/** 删除当前激活的外框（引擎随后派发 outer_frame_delete，面板收起） */
function deleteOuterFrame(): void {
  console.info("[MindMap/NodeOuterFrame] 删除外框");
  mindMap.value?.outerFrame?.removeActiveOuterFrame();
}

/** 只删除外框文字 */
function deleteOuterFrameText(): void {
  console.info("[MindMap/NodeOuterFrame] 删除外框文字");
  mindMap.value?.outerFrame?.removeActiveOuterFrameText();
}

/** 外框取消激活 / 被删除：收起面板（只收起自己，不影响其它面板） */
function hide(): void {
  if (activeSidebar.value !== "nodeOuterFrameStyle") return;
  console.debug("[MindMap/NodeOuterFrame] 外框已取消激活，收起外框样式面板");
  setActiveSidebar(null);
}

useBusEvent("outer_frame_active", onOuterFrameActive);
useBusEvent("outer_frame_deactivate", hide);
// outer_frame_delete 不在根组件的转发列表里，直接监听引擎
instance?.on("outer_frame_delete", hide);

onBeforeUnmount(() => {
  instance?.off("outer_frame_delete", hide);
});
</script>

<template>
  <MmPanel name="nodeOuterFrameStyle" title="外框样式">
    <div class="outer-frame">
      <div class="outer-frame__header">
        <span class="outer-frame__title">外框</span>
        <span class="outer-frame__delete" @click="deleteOuterFrame">
          删除外框
          <span class="mm-iconfont iconshanchu" />
        </span>
      </div>
      <div class="mm-row">
        <span class="mm-row__label">边框样式</span>
        <div class="mm-row__control">
          <select
            v-model="styleConfig.strokeWidth"
            class="mm-select outer-frame__select"
            @change="onSelectChange('strokeWidth')"
          >
            <option v-for="item in lineWidthList" :key="item" :value="item">{{ item }}</option>
          </select>
          <select
            v-model="styleConfig.strokeDasharray"
            class="mm-select outer-frame__select"
            @change="onSelectChange('strokeDasharray')"
          >
            <option v-for="item in borderDasharrayList" :key="item.value" :value="item.value">
              {{ item.name }}
            </option>
          </select>
        </div>
      </div>
      <div class="mm-row">
        <span class="mm-row__label">边框颜色</span>
        <div class="mm-row__control">
          <MmColor
            :model-value="styleConfig.strokeColor"
            @update:model-value="updateOuterFrame('strokeColor', $event)"
          />
        </div>
      </div>
      <div class="mm-row">
        <span class="mm-row__label">圆角</span>
        <div class="mm-row__control">
          <select
            v-model="styleConfig.radius"
            class="mm-select outer-frame__select"
            @change="onSelectChange('radius')"
          >
            <option v-for="item in borderRadiusList" :key="item" :value="item">{{ item }}</option>
          </select>
        </div>
      </div>
      <div class="mm-row">
        <span class="mm-row__label">填充颜色</span>
        <div class="mm-row__control">
          <MmColor
            :model-value="styleConfig.fill"
            @update:model-value="updateOuterFrame('fill', $event)"
          />
        </div>
      </div>

      <div class="outer-frame__header outer-frame__header--text">
        <span class="outer-frame__title">外框文字</span>
        <span class="outer-frame__delete" @click="deleteOuterFrameText">
          删除文字
          <span class="mm-iconfont iconshanchu" />
        </span>
      </div>
      <div class="mm-row">
        <span class="mm-row__label">字体</span>
        <div class="mm-row__control">
          <select
            v-model="styleConfig.fontFamily"
            class="mm-select outer-frame__font-select"
            @change="onSelectChange('fontFamily')"
          >
            <option
              v-for="item in fontFamilyList"
              :key="item.value"
              :value="item.value"
              :style="{ fontFamily: item.value }"
            >
              {{ item.name }}
            </option>
          </select>
        </div>
      </div>
      <div class="outer-frame__btn-group">
        <!-- 文字颜色：取色器的触发按钮透明铺满「A」按钮，点击「A」即打开色板 -->
        <div class="outer-frame__style-btn outer-frame__style-btn--color" title="颜色">
          A
          <span class="outer-frame__color-bar" :style="{ backgroundColor: styleConfig.color }" />
          <MmColor
            :model-value="styleConfig.color"
            @update:model-value="updateOuterFrame('color', $event)"
          />
        </div>
        <div
          class="outer-frame__style-btn"
          :class="{ 'is-active': styleConfig.fontWeight === 'bold' }"
          title="加粗"
          @click="toggleFontWeight"
        >
          B
        </div>
        <div
          class="outer-frame__style-btn outer-frame__style-btn--italic"
          :class="{ 'is-active': styleConfig.fontStyle === 'italic' }"
          title="斜体"
          @click="toggleFontStyle"
        >
          I
        </div>
      </div>
      <div class="mm-row">
        <span class="mm-row__label">行高</span>
        <div class="mm-row__control">
          <select
            v-model="styleConfig.lineHeight"
            class="mm-select outer-frame__select"
            @change="onSelectChange('lineHeight')"
          >
            <option v-for="item in lineHeightList" :key="item" :value="item">{{ item }}</option>
          </select>
        </div>
      </div>
      <div class="mm-row">
        <span class="mm-row__label">字号</span>
        <div class="mm-row__control">
          <select
            v-model="styleConfig.fontSize"
            class="mm-select outer-frame__select"
            @change="onSelectChange('fontSize')"
          >
            <option v-for="item in fontSizeList" :key="item" :value="item">{{ item }}</option>
          </select>
        </div>
      </div>
      <div class="mm-row">
        <span class="mm-row__label">背景填充</span>
        <div class="mm-row__control">
          <MmColor
            :model-value="styleConfig.textFill"
            @update:model-value="updateOuterFrame('textFill', $event)"
          />
        </div>
      </div>
      <div class="mm-row">
        <span class="mm-row__label">背景圆角</span>
        <div class="mm-row__control">
          <select
            v-model="styleConfig.textFillRadius"
            class="mm-select outer-frame__select"
            @change="onSelectChange('textFillRadius')"
          >
            <option v-for="item in borderRadiusList" :key="item" :value="item">{{ item }}</option>
          </select>
        </div>
      </div>
      <div class="mm-row">
        <span class="mm-row__label">显示位置</span>
        <div class="mm-row__control">
          <div class="mm-segment">
            <span
              v-for="item in TEXT_ALIGN_LIST"
              :key="item.value"
              class="mm-segment__item"
              :class="{ 'is-active': styleConfig.textAlign === item.value }"
              @click="updateOuterFrame('textAlign', item.value)"
            >
              {{ item.name }}
            </span>
          </div>
        </div>
      </div>
      <div class="mm-row">
        <span class="mm-row__label">水平内边距</span>
        <div class="mm-row__control">
          <input
            v-model.number="paddingStyle.paddingX"
            type="range"
            min="0"
            max="100"
            class="outer-frame__slider"
            @change="updatePadding('x', paddingStyle.paddingX)"
          />
          <span class="outer-frame__slider-value">{{ paddingStyle.paddingX }}</span>
        </div>
      </div>
      <div class="mm-row">
        <span class="mm-row__label">垂直内边距</span>
        <div class="mm-row__control">
          <input
            v-model.number="paddingStyle.paddingY"
            type="range"
            min="0"
            max="100"
            class="outer-frame__slider"
            @change="updatePadding('y', paddingStyle.paddingY)"
          />
          <span class="outer-frame__slider-value">{{ paddingStyle.paddingY }}</span>
        </div>
      </div>
    </div>
  </MmPanel>
</template>

<style lang="less" scoped>
.outer-frame__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;

  &--text {
    margin-top: 18px;
  }
}

.outer-frame__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color, #333);
}

.outer-frame__delete {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 12px;
  color: var(--text-color-3, #909090);
  cursor: pointer;
  user-select: none;

  &:hover {
    color: #e53e3e;
  }

  .mm-iconfont {
    font-size: 13px;
  }
}

/* 覆盖 .mm-select 的最小宽度（两级类名保证优先级高于全局 .mindmap-editor .mm-select） */
.outer-frame .outer-frame__select {
  min-width: 0;
  width: 80px;
}

.outer-frame .outer-frame__font-select {
  width: 170px;
}

.outer-frame__btn-group {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.outer-frame__style-btn {
  position: relative;
  flex: 1;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-color-1, #dcdfe6);
  border-radius: 4px;
  background: var(--background-color-1, #fff);
  color: var(--text-color-1, #333);
  font-weight: bold;
  cursor: pointer;
  user-select: none;

  &:hover {
    border-color: var(--primary-color, #409eff);
  }

  &.is-active {
    border-color: var(--primary-color, #409eff);
    background: var(--hover-background-color, #eee);
    color: var(--primary-color, #409eff);
  }

  &--italic {
    font-style: italic;
  }

  /* 取色器铺满按钮：触发按钮透明，色板从按钮左侧向右展开（按钮在面板最左，向左展开会被裁切） */
  &--color {
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

    :deep(.mm-color__popover) {
      left: 0;
      right: auto;
    }
  }
}

.outer-frame__color-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  border-radius: 0 0 3px 3px;
}

.outer-frame__slider {
  width: 150px;
  accent-color: var(--primary-color, #409eff);
  cursor: pointer;
}

.outer-frame__slider-value {
  min-width: 24px;
  font-size: 12px;
  text-align: right;
  color: var(--text-color-2, #666);
}
</style>
