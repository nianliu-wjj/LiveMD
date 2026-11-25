/**
 * 光标紧邻区域级语法标记显示（Typora 同构 · 显示机制第三阶段）
 *
 * 在 ProseMirror 体系内落地的硬约束（见 docs/BUGFIX-CARET-REGION.md 第 3 节源码证据）：
 * - 光标移动路径上禁止 inline decoration 增删/attrs 变化（text wrapper 重建 →
 *   WKWebView 幽灵态）；
 * - 禁止外部直改 PM 渲染元素（mark 元素全有 contentDOM，MarkViewDesc 不忽略属性
 *   mutation → 触发该区段 DOM 重读）。
 *
 * 因此光标状态的写入通道是编辑器 DOM 之外的 <style> 元素（document.head 下，
 * PM MutationObserver 观察不到，样式文本替换仅引发样式重算）：
 * 每次编辑器 update 后计算「光标紧邻区域集合」→ 生成结构选择器
 * （tag:nth-of-type 链，锚定 view.dom 的 scope class）→ 整体替换 style 文本。
 * 标记文本自身的 DOM 结构（schema toDOM 恒定 meta wrapper）完全不被触碰。
 *
 * 显示类型分派：
 * - heading：保持焦点块级显示（焦点块 CSS 限定 heading 类型，见 livemd.css）；
 * - blockquote（引用 "> "）/ list 前缀：永不入选、无任何即时渲染显示规则；
 * - math_inline：沿用既有光标驱动渲染机制，不进本通道；
 * - escape / html_entity：2-N 字符微区域（无语义外壳，锚定标记 span 自身）；
 * - 其余语义 mark（strong/emphasis/code_inline/…）：区域 = mark 连续覆盖范围
 *   （含标记文本），光标邻接（nodeBefore/nodeAfter 携带该 mark）即命中。
 */

import { EditorView } from "prosemirror-view";
// ⚠️ 注意：Mark/Node 仅作类型使用必须用 type 导入 —— 值导入会让 prosemirror-model 的
// Node 类在运行时遮蔽 DOM 全局 Node（Node.ELEMENT_NODE 变 undefined），导致下方
// nodeType 守卫恒走 no-op 分支（踩坑实录见文档坑 1）
import type { Mark, Node as ProseMirrorNode } from "prosemirror-model";
import type { SyntaxMarkerRegion } from "./index";

/** 参与区域级显示的语义 mark 类型 */
const SEMANTIC_MARK_TYPES = new Set([
  "strong",
  "emphasis",
  "code_inline",
  "strikethrough",
  "highlight",
  "link",
  "sub",
  "sup",
  "html_inline",
]);

/** 光标紧邻区域 */
export interface CaretRegion {
  from: number;
  to: number;
  kind: "semantic" | "escape" | "html_entity";
}

/** 结构链最大深度（防异常结构生成超长选择器） */
const SHELL_MAX_DEPTH = 8;

/**
 * 求一个 mark 实例在当前 textblock 内的连续覆盖区段（含标记文本自身）。
 * 返回覆盖光标邻域（±1 容错计数偏差）的那个区段，无则 null。
 */
function markExtentInBlock(
  parent: ProseMirrorNode,
  parentStart: number,
  mark: Mark,
  cursorOffset: number
): { from: number; to: number } | null {
  const runs: Array<{ s: number; e: number }> = [];
  let runStart = -1;
  let runEnd = -1;
  let offset = 0;
  parent.forEach((child) => {
    const size = child.nodeSize;
    if (child.marks.some((m) => m.eq(mark))) {
      if (runStart < 0) runStart = offset;
      runEnd = offset + size;
    } else {
      if (runStart >= 0) runs.push({ s: runStart, e: runEnd });
      runStart = -1;
    }
    offset += size;
  });
  if (runStart >= 0) runs.push({ s: runStart, e: runEnd });

  for (const run of runs) {
    if (cursorOffset >= run.s - 1 && cursorOffset <= run.e + 1) {
      return { from: parentStart + run.s, to: parentStart + run.e };
    }
  }
  return null;
}

/**
 * 计算光标紧邻区域集合（纯文档模型计算，可在 Node 环境单测）。
 *
 * 语义区域：光标 nodeBefore / nodeAfter 任一携带语义 mark 即命中——这天然表达
 * 「光标在内容内部 / 紧贴标记前后」而「相隔 ≥1 字符」不亮；
 * 微区域（escape / html_entity）：光标落在 [from-1, to+1] 即命中。
 *
 * heading / blockquote / math_inline 等类型永不入选：
 * - heading 由焦点块 CSS 保持块级显示；
 * - blockquote "> " 前缀自始至终不显示（用户决策）；
 * - math_inline 沿用既有光标驱动渲染机制。
 */
export function computeCaretRegions(
  doc: ProseMirrorNode,
  cursorPos: number,
  syntaxRegions?: SyntaxMarkerRegion[] | null
): CaretRegion[] {
  const result: CaretRegion[] = [];
  const seen = new Set<string>();

  const $cursor = doc.resolve(Math.min(Math.max(cursorPos, 0), doc.content.size));
  if (!$cursor.parent.isTextblock) return result;

  // A. 语义 mark 邻接收集（同一类型只取一次）
  const markByType = new Map<string, Mark>();
  for (const adjacent of [$cursor.nodeBefore, $cursor.nodeAfter]) {
    if (!adjacent) continue;
    for (const m of adjacent.marks) {
      if (SEMANTIC_MARK_TYPES.has(m.type.name)) markByType.set(m.type.name, m);
    }
  }
  const parentStart = $cursor.start($cursor.depth);
  for (const [typeName, mark] of markByType) {
    const extent = markExtentInBlock($cursor.parent, parentStart, mark, $cursor.parentOffset);
    if (!extent) continue;
    const key = `${typeName}:${extent.from}:${extent.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...extent, kind: "semantic" });
  }

  // B. 微区域（escape / html_entity）
  for (const region of syntaxRegions ?? []) {
    if (region.syntaxType !== "escape" && region.syntaxType !== "html_entity") continue;
    if (cursorPos < region.from - 1 || cursorPos > region.to + 1) continue;
    const key = `${region.syntaxType}:${region.from}:${region.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ from: region.from, to: region.to, kind: region.syntaxType });
  }

  return result;
}

/** domAtPos 结果规范化为 Element（文本节点取其父元素） */
function elementFromDomAtPos(view: EditorView, pos: number, bias: -1 | 1): Element | null {
  const { node } = view.domAtPos(Math.max(0, Math.min(pos, view.state.doc.content.size)), bias);
  if (!node) return null;
  if (node.nodeType === Node.TEXT_NODE) return node.parentElement;
  return node instanceof Element ? node : node.parentElement;
}

/**
 * 标记区域 → 标记 span 自身（span.livemd-syntax，其唯一直子即 meta）。
 * 取 from+1 处向左取 DOM：落在标记文本内部，避开 PM domAtPos 在 text 边界
 * 返回块级元素的坑（踩坑实录见文档坑 3）。
 */
function resolveSyntaxSpan(view: EditorView, from: number, to: number): Element | null {
  const inside = Math.min(from + 1, to);
  let el = elementFromDomAtPos(view, inside, -1);
  let hops = 0;
  while (el && el !== view.dom && hops++ < SHELL_MAX_DEPTH) {
    if (el.classList.contains("livemd-syntax")) return el;
    el = el.parentElement;
  }
  return null;
}

/**
 * 结构选择器生成：目标元素到编辑器根每层 tag + 同 tag 兄弟序（nth-of-type 按
 * 元素计，text 节点不参与），根层锚定 scope class。深度超限放弃该区域（容错
 * 降级——宁可少亮一处，不产生脆弱选择器）。
 */
function buildSelector(view: EditorView, target: Element, scopeClass: string): string | null {
  const parts: string[] = [];
  let el: Element | null = target;
  let depth = 0;
  while (el && el !== view.dom) {
    if (el.classList.contains("livemd-focus-block") && parts.length > 0) {
      return `.${scopeClass} .livemd-focus-block > ${parts.join(" > ")}`;
    }
    if (++depth > SHELL_MAX_DEPTH) return null;
    const tag = el.tagName.toLowerCase();
    let nth = 1;
    let sib: Element | null = el.previousElementSibling;
    while (sib) {
      if (sib.tagName.toLowerCase() === tag) nth++;
      sib = sib.previousElementSibling;
    }
    parts.unshift(`${tag}:nth-of-type(${nth})`);
    el = el.parentElement;
  }
  if (el !== view.dom || parts.length === 0) return null;
  return `.${scopeClass} > ${parts.join(" > ")}`;
}

/** 区域规则的 meta 匹配尾巴：标记 span 的唯一直子（精确到单个 meta） */
const META_TAIL = "> span.livemd-syntax-meta";

/** meta 显示声明体：与 livemd.css 焦点块 heading 规则保持一致 */
const META_DISPLAY_DECL = `  display: inline;
  color: var(--text-color-3, #999);
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
  font-size: 0.9em;
  user-select: auto;
  pointer-events: auto;`;

/**
 * 区域集合 → 样式表文本（同选择器去重；entity 区域附解码 widget 隐藏规则）。
 *
 * 定位策略（冒烟三期定稿）：标记 DOM 是「扁平三段式」——开标记 span、内容外壳、
 * 闭标记 span 是块的直接子元素（不存在包裹三段的外壳祖先），因此不做外壳解析，
 * 而是语义区域在文档层展开为区间内**每个带 syntax_marker 的 text**（块内平铺
 * 遍历），逐个定位其标记 span 生成唯一路径选择器 —— 嵌套语义（strong 内 em）
 * 与转义标记的 span 各自精确命中，同块相邻的其他语义区域零泄漏。
 */
function buildCaretStylesheet(
  view: EditorView,
  regions: CaretRegion[],
  scopeClass: string
): string {
  const metaSelectors = new Set<string>();
  const entitySelectors = new Set<string>();

  const emitMarker = (from: number, to: number, isEntity: boolean) => {
    const span = resolveSyntaxSpan(view, from, to);
    if (!span) return;
    const selector = buildSelector(view, span, scopeClass);
    if (!selector) return;
    metaSelectors.add(`${selector} ${META_TAIL}`);
    if (isEntity) {
      // entity 隐藏解码 widget（原文 meta 显示时互斥）。
      // widget 挂于区域尾部 side:-1，DOM 上紧邻原文 span 之后（兄弟 + 选择器）。
      entitySelectors.add(`${selector} + .livemd-html-entity-rendered`);
    }
  };

  for (const region of regions) {
    if (region.kind === "semantic") {
      const $from = view.state.doc.resolve(region.from);
      const parent = $from.parent;
      const parentStart = $from.start($from.depth);
      let offset = parentStart;
      parent.forEach((child) => {
        if (
          child.isText &&
          offset >= region.from &&
          offset + child.nodeSize <= region.to &&
          child.marks.some((m) => m.type.name === "syntax_marker")
        ) {
          emitMarker(offset, offset + child.nodeSize, false);
        }
        offset += child.nodeSize;
      });
    } else {
      emitMarker(region.from, region.to, region.kind === "html_entity");
    }
  }

  if (metaSelectors.size === 0 && entitySelectors.size === 0) return "";

  // 注释保持 ASCII：vite-auto-i18n 会把中文字面量替换为 $deepScan(key) 运行时调用，
  // 裸 key 会污染 style 文本首条规则的 prelude（踩坑实录见文档坑 2）
  const parts: string[] = ["/* livemd caret-region (auto-generated) */"];
  if (metaSelectors.size > 0) {
    parts.push(`${Array.from(metaSelectors).join(",\n")} {\n${META_DISPLAY_DECL}\n}`);
  }
  if (entitySelectors.size > 0) {
    parts.push(`${Array.from(entitySelectors).join(",\n")} {\n  display: none;\n}`);
  }
  return parts.join("\n\n") + "\n";
}

/** 自管 style 元素控制器 */
export interface CaretStyleController {
  /** 编辑器每次 update 后调用（源码模式自动退场；光标无邻接区域即清空） */
  refresh: () => void;
  /** 编辑器销毁时移除 style 元素与 scope class */
  dispose: () => void;
}

let scopeCounter = 0;

/**
 * 挂接光标区域显示：编辑器根挂唯一 scope class（多编辑器实例隔离），
 * document.head 下创建自管 style 元素。getter 注入装饰插件状态（避免循环 import）。
 */
export function attachCaretStyle(
  view: EditorView,
  getPluginState: () =>
    | {
        sourceView: boolean;
        instantRenderEnabled?: boolean;
        cachedSyntaxRegions?: SyntaxMarkerRegion[];
      }
    | undefined
): CaretStyleController {
  if (!view.dom || view.dom.nodeType !== Node.ELEMENT_NODE) {
    return { refresh: () => {}, dispose: () => {} };
  }
  const scopeClass = `livemd-caret-scope-${(scopeCounter += 1)}`;
  view.dom.classList.add(scopeClass);
  const style = document.createElement("style");
  style.setAttribute("data-livemd-caret", scopeClass);
  document.head.appendChild(style);
  let lastCss: string | null = null;

  const refresh = () => {
    try {
      const pluginState = getPluginState();
      let regions: CaretRegion[] = [];
      const active =
        pluginState?.sourceView !== true &&
        pluginState?.instantRenderEnabled !== false &&
        view.state.selection.empty;
      if (active) {
        regions = computeCaretRegions(
          view.state.doc,
          view.state.selection.head,
          pluginState?.cachedSyntaxRegions
        );
      }
      const css = active ? buildCaretStylesheet(view, regions, scopeClass) : "";
      if (import.meta.env.DEV) {
        // 调试页可见的观测口：区域集合与生成结果（仅开发构建）
        (view.dom as unknown as Record<string, unknown>).__caretDebug = {
          active,
          regions,
          css,
        };
      }
      if (css !== lastCss) {
        style.textContent = css;
        lastCss = css;
      }
    } catch (error) {
      // 区域显示失败不允许影响编辑器 update 主流程
      console.error("[livemd-caret-style]", error);
    }
  };

  const dispose = () => {
    style.remove();
    view.dom.classList?.remove(scopeClass);
  };

  // 初次刷新：插件 view() 构造期不存在 update 钩子调用，编辑器挂载后首个 PM update
  // 在用户首次编辑 / 移动光标前不会发生——不在 attach 期先刷一次，初始光标所在
  // 区域的标记会一直等到用户动一下光标才亮（初始态迟滞，见文档 8.5 链 B）
  refresh();

  return { refresh, dispose };
}
