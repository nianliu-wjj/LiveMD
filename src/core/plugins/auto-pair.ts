/**
 * 中文标点 / 引号自动成对闭合插件
 *
 * 决策逻辑全部在 core/utils/brackets.ts（纯函数、可零依赖单测），本插件只负责把决策落到事务：
 * - handleTextInput：插入成对（光标落中间）/ 跳过已有闭符号 / 包裹选区；
 * - handleKeyDown：Backspace 命中空对时一次删除两侧。
 *
 * 不干预的三种场景：源码模式（decorationPluginKey 的 sourceView，按原文输入）、
 * IME 组合输入（view.composing）、非文本块（$from.parent.isTextblock 为假）。
 */

import { Plugin, TextSelection, type EditorState } from "prosemirror-state";
import { decorationPluginKey } from "../decorations";
import {
  DEFAULT_AUTO_PAIR_OPTIONS,
  computeAutoPair,
  shouldDeletePair,
  type AutoPairOptions,
} from "../utils/brackets";

/**
 * 创建自动成对闭合插件
 *
 * @param options 覆盖默认开关（ASCII 括号 / 引号 / Markdown 强调符号）
 */
export function createAutoPairPlugin(options: Partial<AutoPairOptions> = {}): Plugin {
  const resolvedOptions: AutoPairOptions = { ...DEFAULT_AUTO_PAIR_OPTIONS, ...options };

  /** 源码模式下不干预：源码模式按原文输入，自动闭合会破坏 Markdown 结构 */
  function isSourceView(state: EditorState): boolean {
    return Boolean(decorationPluginKey.getState(state)?.sourceView);
  }

  return new Plugin({
    props: {
      handleTextInput(view, from, to, text) {
        const { state } = view;
        if (view.composing || isSourceView(state)) return false;

        const { $from } = state.selection;
        if (!$from.parent.isTextblock) return false;
        // 跨文本块的输入不处理（避免在块边界插入无效字符）
        if (!$from.sameParent(state.doc.resolve(to))) return false;

        const textBefore = state.doc.textBetween($from.start(), from, "\n", "\n");
        const textAfter = state.doc.textBetween(to, $from.end(), "\n", "\n");
        const decision = computeAutoPair(textBefore, textAfter, text, from !== to, resolvedOptions);

        switch (decision.type) {
          case "insert-pair": {
            const tr = state.tr.insertText(decision.open + decision.close, from, to);
            // 光标落在成对符号中间
            view.dispatch(
              tr.setSelection(TextSelection.create(tr.doc, from + decision.open.length))
            );
            return true;
          }

          case "wrap-selection": {
            const tr = state.tr
              .insertText(decision.open, from)
              .insertText(decision.close, to + decision.open.length);
            // 保留选区内容被包裹后的选中态
            view.dispatch(
              tr.setSelection(
                TextSelection.create(tr.doc, from + decision.open.length, to + decision.open.length)
              )
            );
            return true;
          }

          case "skip-over": {
            // 光标后已有同一闭符号：只移动光标，不重复插入
            view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, to + text.length)));
            return true;
          }

          default:
            return false;
        }
      },

      handleKeyDown(view, event) {
        if (event.key !== "Backspace") return false;
        if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;

        const { state } = view;
        if (isSourceView(state)) return false;

        const { empty, $from } = state.selection;
        if (!empty || !$from.parent.isTextblock) return false;

        const position = $from.pos;
        const blockStart = $from.start();
        const blockEnd = $from.end();
        // 块内且两侧都有字符才可能夹在空对中间
        if (position <= blockStart || position >= blockEnd) return false;

        const textBefore = state.doc.textBetween(position - 1, position, "\n", "\n");
        const textAfter = state.doc.textBetween(position, position + 1, "\n", "\n");
        if (!shouldDeletePair(textBefore, textAfter)) return false;

        view.dispatch(state.tr.delete(position - 1, position + 1));
        return true;
      },
    },
  });
}
