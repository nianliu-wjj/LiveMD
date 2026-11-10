<script setup lang="ts">
/**
 * 关联线样式面板（对应参考项目 AssociativeLineStyle.vue）
 *
 * - 面板名 associativeLineStyle：点击画布上的关联线（引擎 associative_line_click）时打开，
 *   关联线取消激活（associative_line_deactivate）时收起；
 * - 显示值取引擎 associativeLine.getStyleConfig(node, toNode)（优先级：该关联线自定义样式 >
 *   节点自定义样式 > 主题）；修改时把整组样式写进起始节点 associativeLineStyle[目标节点 uid]
 *   （setData 走 SET_NODE_DATA 命令，可撤销），再调用 updateActiveLineStyle 原地刷新，
 *   这样关联线保持激活、面板不会被重新渲染关掉；
 * - 关联线：颜色、粗细、激活颜色、激活粗细、虚线样式；关联线文字：字体、颜色、字号。
 *
 * 与参考项目的差异：下拉框为原生 select（选项不显示线宽 / 虚线预览），表单按移植约定用
 * .mm-row 单列排布；只读模式下点击关联线不打开面板；参考项目没有解绑监听，这里随组件卸载解绑。
 */
import { reactive } from "vue";
import type { MindMapNodeInstance } from "@/core/mindmap-engine/full";
import MmPanel from "../ui/MmPanel.vue";
import MmColor from "../ui/MmColor.vue";
import { borderDasharrayList, fontFamilyList, fontSizeList, lineWidthList } from "../config";
import { useBusEvent, useMindMapContext } from "../context";

/** 面板可编辑的关联线样式（字段名与主题 / 节点样式一致） */
interface AssociativeLineStyleConfig {
  associativeLineColor: string;
  associativeLineWidth: number;
  associativeLineActiveWidth: number;
  associativeLineDasharray: string;
  associativeLineActiveColor: string;
  associativeLineTextFontSize: number;
  associativeLineTextColor: string;
  associativeLineTextFontFamily: string;
}

type StyleKey = keyof AssociativeLineStyleConfig;

const DEFAULT_STYLE: AssociativeLineStyleConfig = {
  associativeLineColor: "",
  associativeLineWidth: 0,
  associativeLineActiveWidth: 0,
  associativeLineDasharray: "",
  associativeLineActiveColor: "",
  associativeLineTextFontSize: 0,
  associativeLineTextColor: "",
  associativeLineTextFontFamily: "",
};

const { mindMap, activeSidebar, setActiveSidebar, isReadonly } = useMindMapContext();

/** 当前关联线样式（面板显示值） */
const style = reactive<AssociativeLineStyleConfig>({ ...DEFAULT_STYLE });
/** 当前激活关联线的起始 / 目标节点（引擎对象，不放进响应式） */
let activeLineNode: MindMapNodeInstance | null = null;
let activeLineToNode: MindMapNodeInstance | null = null;

/** 关联线被点击激活：读取样式并打开面板（对应参考项目 onAssociativeLineClick） */
function onAssociativeLineClick(
  _path: unknown,
  _clickPath: unknown,
  node: MindMapNodeInstance,
  toNode: MindMapNodeInstance
): void {
  if (isReadonly.value) {
    console.debug("[MindMap/AssociativeLineStyle] 只读模式，不打开关联线样式面板");
    return;
  }
  const associativeLine = mindMap.value?.associativeLine;
  if (!associativeLine || !node || !toNode) {
    console.warn("[MindMap/AssociativeLineStyle] 关联线插件或节点缺失，无法读取样式");
    return;
  }
  activeLineNode = node;
  activeLineToNode = toNode;
  const styleConfig: Partial<AssociativeLineStyleConfig> = associativeLine.getStyleConfig(
    node,
    toNode
  );
  for (const key of Object.keys(style) as StyleKey[]) {
    (style as Record<string, unknown>)[key] = styleConfig[key];
  }
  console.info("[MindMap/AssociativeLineStyle] 关联线已激活，打开关联线样式面板");
  setActiveSidebar("associativeLineStyle");
}

/** 关联线取消激活：收起面板并清空状态（对应参考项目 associativeLineDeactivate） */
function onAssociativeLineDeactivate(): void {
  if (activeSidebar.value === "associativeLineStyle") {
    console.debug("[MindMap/AssociativeLineStyle] 关联线已取消激活，收起关联线样式面板");
    setActiveSidebar(null);
  }
  activeLineNode = null;
  activeLineToNode = null;
  Object.assign(style, DEFAULT_STYLE);
}

/** 修改样式：写入该关联线的自定义样式并原地刷新（对应参考项目 update） */
function update<K extends StyleKey>(prop: K, value: AssociativeLineStyleConfig[K]): void {
  (style as AssociativeLineStyleConfig)[prop] = value;
  const node = activeLineNode;
  const toNode = activeLineToNode;
  if (!node || !toNode) {
    console.warn("[MindMap/AssociativeLineStyle] 没有激活的关联线，忽略样式修改:", prop);
    return;
  }
  const associativeLineStyle = node.getData("associativeLineStyle") || {};
  const toNodeUid = toNode.getData("uid");
  const lineStyle = associativeLineStyle[toNodeUid] || {};
  console.debug("[MindMap/AssociativeLineStyle] 修改关联线样式:", prop, value);
  node.setData({
    associativeLineStyle: {
      ...associativeLineStyle,
      // 与参考项目一致：写入面板上的整组样式（展开为普通对象，不把响应式代理交给引擎）
      [toNodeUid]: { ...lineStyle, ...style },
    },
  });
  mindMap.value?.associativeLine?.updateActiveLineStyle();
}

/** 修改下拉框后写回（v-model 已先更新 style） */
function onSelectChange(prop: StyleKey): void {
  update(prop, style[prop]);
}

useBusEvent("associative_line_click", onAssociativeLineClick);
useBusEvent("associative_line_deactivate", onAssociativeLineDeactivate);
</script>

<template>
  <MmPanel name="associativeLineStyle" title="关联线样式">
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
        <select
          v-model="style.associativeLineWidth"
          class="mm-select"
          @change="onSelectChange('associativeLineWidth')"
        >
          <option v-for="item in lineWidthList" :key="item" :value="item">{{ item }}</option>
        </select>
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
        <select
          v-model="style.associativeLineActiveWidth"
          class="mm-select"
          @change="onSelectChange('associativeLineActiveWidth')"
        >
          <option v-for="item in lineWidthList" :key="item" :value="item">{{ item }}</option>
        </select>
      </div>
    </div>
    <div class="mm-row">
      <span class="mm-row__label">样式</span>
      <div class="mm-row__control">
        <select
          v-model="style.associativeLineDasharray"
          class="mm-select"
          @change="onSelectChange('associativeLineDasharray')"
        >
          <option v-for="item in borderDasharrayList" :key="item.value" :value="item.value">
            {{ item.name }}
          </option>
        </select>
      </div>
    </div>

    <div class="mm-section-title">关联线文字</div>
    <div class="mm-row">
      <span class="mm-row__label">字体</span>
      <div class="mm-row__control">
        <select
          v-model="style.associativeLineTextFontFamily"
          class="mm-select associative-line-style__font-select"
          @change="onSelectChange('associativeLineTextFontFamily')"
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
          @change="onSelectChange('associativeLineTextFontSize')"
        >
          <option v-for="item in fontSizeList" :key="item" :value="item">{{ item }}</option>
        </select>
      </div>
    </div>
  </MmPanel>
</template>

<style lang="less" scoped>
/* 字体名称较长，加宽下拉框（两级类名保证优先级高于全局 .mindmap-editor .mm-select） */
.mm-row .associative-line-style__font-select {
  width: 170px;
}
</style>
