/**
 * 标题 / 表格折叠插件
 *
 * 设计（与 docs/2026-10-29-md-feature-fix-guide §7 / §8 一致）：
 * - 折叠状态与装饰集都放在插件 StateField（不进文档、不进撤销栈）；
 * - 两种装饰：
 *   1. `Decoration.widget`：块前插入折叠箭头按钮（`side: -1`、`ignoreSelection: true`，
 *      widget key 含折叠状态以强制重建并切换旋转样式）；
 *   2. `Decoration.node`：给被隐藏块加 `livemd-fold-hidden` 类（CSS `display: none !important`）；
 * - **增量映射**：文档变化时优先 `DecorationSet.map(tr.mapping, tr.doc)`——
 *   普通块内编辑只平移位置，映射结果即为正确解；仅当顶层块结构变化（增删块/换块类型）
 *   导致块索引失配时才回退全量重建（避免每次击键都重建全文档装饰）；
 * - 折叠集合由 core 计算（`computeFoldPlan` 纯函数），持久化交给渲染层：
 *   编辑器在 dispatchTransaction 中检测 `foldPluginKey` meta，emit `foldChange` 事件回传索引。
 */
import type { Node as ProseMirrorNode } from "prosemirror-model";
import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { computeFoldPlan, type FoldableBlockInfo } from "../utils/fold";

interface FoldState {
  /** 已折叠的顶层块索引 */
  indices: number[];
  /** 对应的装饰集（增量映射复用） */
  decorations: DecorationSet;
}

export const foldPluginKey = new PluginKey<FoldState>("livemd-fold");

/** 折叠指令载荷（通过 tr.setMeta(foldPluginKey, ...) 下发） */
export interface FoldMeta {
  type: "toggle" | "set" | "clear";
  /** toggle 用：目标块索引 */
  index?: number;
  /** set 用：完整折叠集合 */
  indices?: number[];
}

/** 读取当前折叠块索引（升序数组，便于持久化与比较） */
export function getFoldedIndices(state: EditorState): number[] {
  const value = foldPluginKey.getState(state);
  return value ? [...value.indices] : [];
}

/** 用给定集合整体替换折叠状态 */
export function setFoldedBlocks(
  state: EditorState,
  dispatch: (tr: EditorState["tr"]) => void,
  indices: number[]
): void {
  dispatch(state.tr.setMeta(foldPluginKey, { type: "set", indices } satisfies FoldMeta));
}

/** 切换单个块的折叠状态 */
export function toggleFoldBlock(
  state: EditorState,
  dispatch: (tr: EditorState["tr"]) => void,
  index: number
): void {
  dispatch(state.tr.setMeta(foldPluginKey, { type: "toggle", index } satisfies FoldMeta));
}

/** 清空全部折叠状态 */
export function clearFoldedBlocks(
  state: EditorState,
  dispatch: (tr: EditorState["tr"]) => void
): void {
  dispatch(state.tr.setMeta(foldPluginKey, { type: "clear" } satisfies FoldMeta));
}

/** 创建折叠箭头按钮：点击即切换对应块的折叠状态 */
function createFoldButton(view: EditorView, index: number, isFolded: boolean): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = isFolded ? "livemd-fold-arrow folded" : "livemd-fold-arrow";
  button.title = isFolded ? "展开" : "折叠";
  button.setAttribute("aria-label", button.title);
  // 阻止 mousedown 抢焦点/丢选区，点击时再统一切换
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleFoldBlock(view.state, view.dispatch.bind(view), index);
  });
  return button;
}

/**
 * 依据文档与折叠集合全量构建装饰集
 */
function buildFoldDecorations(doc: ProseMirrorNode, indices: number[]): DecorationSet {
  const folded = new Set(indices);
  const blocks: FoldableBlockInfo[] = [];
  const ranges: Array<{ from: number; to: number }> = [];

  doc.forEach((node, offset) => {
    blocks.push({
      type: node.type.name,
      level: node.type.name === "heading" ? Number(node.attrs.level) : undefined,
    });
    ranges.push({ from: offset, to: offset + node.nodeSize });
  });

  const plan = computeFoldPlan(blocks, folded);
  const decorations: Decoration[] = [];

  for (const index of plan.targets) {
    const range = ranges[index];
    if (!range) continue;
    const isFolded = folded.has(index);
    decorations.push(
      Decoration.widget(range.from + 1, (view) => createFoldButton(view, index, isFolded), {
        side: -1,
        ignoreSelection: true,
        // key 含折叠状态：状态变化时强制重建，从而切换箭头旋转样式
        key: `fold-arrow-${index}-${isFolded}`,
      })
    );
  }

  for (const index of plan.hidden) {
    const range = ranges[index];
    if (!range) continue;
    decorations.push(Decoration.node(range.from, range.to, { class: "livemd-fold-hidden" }));
  }

  return DecorationSet.create(doc, decorations);
}

/**
 * 校验已折叠块索引在新文档中仍指向可折叠块（顶层块结构未变化）
 *
 * 增量映射仅在结构不变时安全：块内编辑平移位置后装饰内容不变；
 * 一旦增删块/换块类型，映射后的箭头与隐藏区间就指向错误目标，此时必须回退全量重建。
 */
function validateFoldTargets(doc: ProseMirrorNode, indices: number[]): boolean {
  for (const index of indices) {
    const node = index < doc.childCount ? doc.child(index) : null;
    if (!node || (node.type.name !== "heading" && node.type.name !== "table")) {
      return false;
    }
  }
  return true;
}

/** 归一化 meta 为新的折叠索引集合（返回 null 表示 meta 不产生状态变化） */
function resolveNextIndices(value: FoldState, meta: FoldMeta | undefined): number[] | null {
  if (!meta) return null;
  if (meta.type === "set") return [...(meta.indices ?? [])];
  if (meta.type === "clear") return [];
  if (meta.type === "toggle" && typeof meta.index === "number") {
    const next = new Set(value.indices);
    if (next.has(meta.index)) next.delete(meta.index);
    else next.add(meta.index);
    return [...next].sort((a, b) => a - b);
  }
  return null;
}

/**
 * 创建折叠插件
 *
 * @param initialFolded 初始折叠块索引（渲染层从 localStorage 恢复后注入）
 */
export function createFoldPlugin(initialFolded: number[] = []): Plugin<FoldState> {
  return new Plugin<FoldState>({
    key: foldPluginKey,
    state: {
      init: (_, state) => ({
        indices: [...initialFolded],
        decorations: buildFoldDecorations(state.doc, initialFolded),
      }),
      apply: (tr, value) => {
        const meta = tr.getMeta(foldPluginKey) as FoldMeta | undefined;
        const nextIndices = resolveNextIndices(value, meta);
        if (nextIndices) {
          return { indices: nextIndices, decorations: buildFoldDecorations(tr.doc, nextIndices) };
        }

        if (tr.docChanged) {
          // 优先增量映射：箭头 widget 与隐藏类都是位置型装饰，
          // 普通编辑（块内改动）不改变折叠目标块集合，map 平移即可，
          // 避免每次击键都全量重建；顶层块结构变化时回退重建。
          if (value.indices.length > 0) {
            const mapped = value.decorations.map(tr.mapping, tr.doc);
            if (validateFoldTargets(tr.doc, value.indices)) {
              return { indices: value.indices, decorations: mapped };
            }
          }
          return {
            indices: value.indices,
            decorations: buildFoldDecorations(tr.doc, value.indices),
          };
        }

        return value;
      },
    },
    props: {
      decorations: (state) => foldPluginKey.getState(state)?.decorations ?? DecorationSet.empty,
    },
  });
}
