<script setup lang="ts">
/**
 * 公式侧边栏（对应参考项目 FormulaSidebar.vue）
 *
 * - 面板名 formulaSidebar，由顶部工具栏「公式」按钮 setActiveSidebar('formulaSidebar') 打开；
 * - 输入 LaTeX 后点「完成」，执行引擎 INSERT_FORMULA 命令插入到当前激活节点。
 *   引擎 Formula 插件依赖节点富文本模式（公式以 Quill 嵌入格式写进富文本），
 *   未开启节点富文本时给出提示（与参考项目一致）；
 * - 常用公式列表用 KaTeX 渲染预览，配置取引擎 Formula 插件的 getKatexConfig()，
 *   保证预览与节点内的渲染方式（mathml / html）一致；点击右侧源码填入输入框；
 * - 激活节点被清空时自动收起面板（插入目标消失）。
 */
import { ref } from "vue";
import katex from "katex";
import autotoast from "autotoast.js";
import type { MindMapNodeInstance } from "@/core/mindmap-engine/full";
import MmPanel from "../ui/MmPanel.vue";
import { formulaList } from "../config";
import { useBusEvent, useMindMapContext } from "../context";

interface FormulaItem {
  /** KaTeX 渲染后的 HTML（静态公式列表，可安全 v-html） */
  overview: string;
  /** LaTeX 源码 */
  text: string;
}

const { mindMap, activeSidebar, setActiveSidebar, localConfig, execCommand } = useMindMapContext();

/** 输入框中的 LaTeX 源码 */
const formulaText = ref("");
/** 常用公式（预览只需生成一次） */
const list: FormulaItem[] = createFormulaList();

/** 取引擎 Formula 插件的 KaTeX 配置（插件缺失或异常时退回与插件一致的默认值） */
function getKatexConfig(): Record<string, unknown> {
  try {
    const config = mindMap.value?.formula?.getKatexConfig?.();
    if (config) return config;
    console.warn("[MindMap/FormulaSidebar] 引擎未注册 Formula 插件，公式预览使用默认 KaTeX 配置");
  } catch (error) {
    console.warn("[MindMap/FormulaSidebar] 读取引擎 KaTeX 配置失败，使用默认配置:", error);
  }
  return { throwOnError: false, errorColor: "#f00", output: "mathml" };
}

/** 渲染常用公式预览（对应参考项目 init） */
function createFormulaList(): FormulaItem[] {
  const config = getKatexConfig();
  const items = formulaList.map((text) => {
    let overview = "";
    try {
      overview = katex.renderToString(text, config);
    } catch (error) {
      // throwOnError 为 false 时语法错误不会抛出，这里兜底其它异常：只显示源码
      console.warn("[MindMap/FormulaSidebar] 公式预览渲染失败:", text, error);
    }
    return { overview, text };
  });
  console.debug("[MindMap/FormulaSidebar] 常用公式预览已生成:", items.length);
  return items;
}

/** 激活节点清空时收起面板（对应参考项目 handleNodeActive） */
useBusEvent(
  "node_active",
  (_node: MindMapNodeInstance | null, nodeList?: MindMapNodeInstance[]) => {
    if ((nodeList?.length ?? 0) > 0 || activeSidebar.value !== "formulaSidebar") return;
    console.debug("[MindMap/FormulaSidebar] 激活节点已清空，收起公式面板");
    setActiveSidebar(null);
  }
);

/** 点击常用公式：源码填入输入框 */
function pickFormula(item: FormulaItem): void {
  formulaText.value = item.text;
}

/** 完成：把公式插入当前激活节点（对应参考项目 confirm） */
function confirm(): void {
  if (!localConfig.openNodeRichText) {
    console.warn("[MindMap/FormulaSidebar] 未开启节点富文本，不能插入公式");
    autotoast.show("非富文本模式下不支持插入公式", "warn");
    return;
  }
  const formula = formulaText.value.trim();
  if (!formula) return;
  console.info("[MindMap/FormulaSidebar] 插入公式:", formula);
  execCommand("INSERT_FORMULA", formula);
}
</script>

<template>
  <MmPanel name="formulaSidebar" title="公式">
    <div class="formula-sidebar">
      <textarea
        v-model="formulaText"
        class="mm-textarea formula-sidebar__input"
        rows="4"
        placeholder="请输入 LaTeX 语法"
        spellcheck="false"
      />
      <button type="button" class="mm-btn formula-sidebar__confirm" @click="confirm">完成</button>
      <div class="mm-section-title formula-sidebar__title">常用公式</div>
      <div class="formula-sidebar__list">
        <div v-for="item in list" :key="item.text" class="formula-sidebar__item">
          <!-- 预览来自 KaTeX 对内置静态公式的渲染结果，不含用户输入 -->
          <div class="formula-sidebar__overview" v-html="item.overview" />
          <div class="formula-sidebar__text" :title="item.text" @click="pickFormula(item)">
            <span class="formula-sidebar__source">{{ item.text }}</span>
          </div>
        </div>
      </div>
    </div>
  </MmPanel>
</template>

<style lang="less" scoped>
.formula-sidebar {
  display: flex;
  flex-direction: column;

  .formula-sidebar__input {
    min-height: 0;
    resize: none;
    font-family: Consolas, "Courier New", monospace;
  }
}

.formula-sidebar__confirm {
  width: 100%;
  margin-top: 12px;
}

.formula-sidebar__title {
  margin-top: 18px;
}

.formula-sidebar__list {
  border: 1px solid var(--border-color-1, #dcdfe6);
  border-radius: 4px;
  overflow: hidden;
}

.formula-sidebar__item {
  display: flex;
  align-items: stretch;
  min-height: 44px;

  & + & {
    border-top: 1px solid var(--border-color-1, #dcdfe6);
  }
}

.formula-sidebar__overview,
.formula-sidebar__text {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 50%;
  min-width: 0;
  overflow: hidden;
}

.formula-sidebar__overview {
  padding: 10px 4px;
  color: var(--text-color, #333);
}

.formula-sidebar__text {
  padding: 0 8px;
  border-left: 1px solid var(--border-color-1, #dcdfe6);
  background: var(--background-color-2, #fafafa);
  color: var(--text-color-1, #333);
  font-size: 13px;
  cursor: pointer;

  &:hover {
    color: var(--primary-color, #409eff);
  }
}

/* 源码一行显示，超出省略（完整内容见 title） */
.formula-sidebar__source {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>
