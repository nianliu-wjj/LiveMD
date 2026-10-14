/**
 * 书签插件
 *
 * 对应 typora_plugin 的 bookmark：在顶层块（段落、标题、列表、代码块等）上
 * 添加可持久化的书签标记。书签本身由渲染层按文件存储，插件只负责绘制标记。
 */

import { Plugin, PluginKey, Transaction } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { Node as ProsemirrorNode } from "prosemirror-model";

export interface BookmarksState {
  /** 顶层块索引列表 */
  indices: number[];
  decorations: DecorationSet;
}

export const bookmarksPluginKey = new PluginKey<BookmarksState>("livemd-bookmarks");

function buildDecorations(doc: ProsemirrorNode, indices: number[]): DecorationSet {
  const indexSet = new Set(indices);
  const decorations: Decoration[] = [];

  doc.forEach((node, offset, index) => {
    if (indexSet.has(index)) {
      decorations.push(
        Decoration.node(offset, offset + node.nodeSize, {
          class: "livemd-bookmarked",
        })
      );
    }
  });

  return DecorationSet.create(doc, decorations);
}

/** 创建书签装饰插件 */
export function createBookmarksPlugin(initialIndices: number[] = []): Plugin<BookmarksState> {
  return new Plugin<BookmarksState>({
    key: bookmarksPluginKey,
    state: {
      init: (_, state) => ({
        indices: [...initialIndices],
        decorations: buildDecorations(state.doc, initialIndices),
      }),
      apply(tr: Transaction, value: BookmarksState): BookmarksState {
        const meta = tr.getMeta(bookmarksPluginKey) as number[] | undefined;
        if (meta) {
          return {
            indices: [...meta],
            decorations: buildDecorations(tr.doc, meta),
          };
        }
        if (tr.docChanged) {
          return {
            indices: value.indices,
            decorations: value.decorations.map(tr.mapping, tr.doc),
          };
        }
        return value;
      },
    },
    props: {
      decorations(state) {
        return bookmarksPluginKey.getState(state)?.decorations ?? null;
      },
    },
  });
}

/** 更新书签块索引 */
export function setBookmarkedBlocks(
  state: import("prosemirror-state").EditorState,
  dispatch: (tr: Transaction) => void,
  indices: number[]
): void {
  dispatch(state.tr.setMeta(bookmarksPluginKey, indices).setMeta("addToHistory", false));
}
