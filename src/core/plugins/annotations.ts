/**
 * 批注（Annotation）装饰插件
 *
 * 与书签插件（bookmarks.ts）同构，三点关键差异：
 * 1. 装饰类型：Decoration.node → Decoration.inline（行内高亮），并持有
 *    data-annotation-id 数据属性以便事件冒泡定位到卡片；
 * 2. 状态主体：indices → Map<id, {from,to,state}>，批注必须显式跟踪区间；
 * 3. 坍缩删除：apply 中 mapping 后逐条检查，from >= to 即剔除。
 *
 * 插件 apply 必须是纯函数、禁止回调/emit（同一事务可能重放，副作用会重复触发）；
 * "整段删除自动移除"的感知由编辑器层在 dispatchTransaction 末尾对比插件状态快照完成
 * （见 core/editor.ts 的 syncAnnotationState）。
 *
 * 批注操作通过 tr.setMeta(annotationsPluginKey, meta) 分发，且都带
 * setMeta("addToHistory", false)——批注操作不是文档编辑，不应污染撤销栈
 * （批注区间仍会随 ordinary 文字编辑平移，不受影响）。
 */

import { EditorState, Plugin, PluginKey, Transaction } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { Node as ProsemirrorNode } from "prosemirror-model";

/** 批注区间状态 */
export type AnnotationState = "editing" | "done";

/** 插件层的单个批注项（运行期以 PM 位置跟踪） */
export interface AnnotationItem {
  id: string;
  from: number;
  to: number;
  state: AnnotationState;
}

export interface AnnotationsState {
  items: AnnotationItem[];
  decorations: DecorationSet;
}

/** 插件指令：右键新建 / commit・edit 切样式 / 取消・删除 / 文件加载恢复 */
export type AnnotationsMeta =
  | { type: "add"; item: AnnotationItem }
  | { type: "update-state"; id: string; state: AnnotationState }
  | { type: "remove"; ids: string[] }
  | { type: "replace-all"; items: AnnotationItem[] };

export const annotationsPluginKey = new PluginKey<AnnotationsState>("livemd-annotations");

function buildDecorations(doc: ProsemirrorNode, items: AnnotationItem[]): DecorationSet {
  const decorations = items.map((item) =>
    Decoration.inline(item.from, item.to, {
      class:
        item.state === "editing"
          ? "livemd-annotation-mark livemd-annotation-mark--editing"
          : "livemd-annotation-mark",
      "data-annotation-id": item.id,
    })
  );
  return DecorationSet.create(doc, decorations);
}

/**
 * 区间映射：起点贴前文(-1)、终点贴后文(+1)，在区间边界外侧输入时不吞新字符。
 * from >= to = 整段文字被删除 → 剔除（部分删除只是收缩）。
 */
function mapItem(tr: Transaction, item: AnnotationItem): AnnotationItem | null {
  const from = tr.mapping.map(item.from, -1);
  const to = tr.mapping.map(item.to, 1);
  if (from >= to) return null;
  return { ...item, from, to };
}

/** 创建批注装饰插件 */
export function createAnnotationsPlugin(
  initialItems: AnnotationItem[] = []
): Plugin<AnnotationsState> {
  return new Plugin<AnnotationsState>({
    key: annotationsPluginKey,
    state: {
      init: (_, state) => ({
        items: [...initialItems],
        decorations: buildDecorations(state.doc, initialItems),
      }),
      apply(tr: Transaction, value: AnnotationsState): AnnotationsState {
        const meta = tr.getMeta(annotationsPluginKey) as AnnotationsMeta | undefined;
        if (meta) {
          switch (meta.type) {
            case "add": {
              const items = [...value.items.filter((item) => item.id !== meta.item.id), meta.item];
              return { items, decorations: buildDecorations(tr.doc, items) };
            }
            case "update-state": {
              const items = value.items.map((item) =>
                item.id === meta.id ? { ...item, state: meta.state } : item
              );
              return { items, decorations: buildDecorations(tr.doc, items) };
            }
            case "remove": {
              const removed = new Set(meta.ids);
              const items = value.items.filter((item) => !removed.has(item.id));
              return { items, decorations: buildDecorations(tr.doc, items) };
            }
            case "replace-all": {
              const items = [...meta.items];
              return { items, decorations: buildDecorations(tr.doc, items) };
            }
          }
        }
        if (tr.docChanged) {
          const items: AnnotationItem[] = [];
          for (const item of value.items) {
            const mapped = mapItem(tr, item);
            if (mapped) items.push(mapped);
          }
          // 区间全部存活时平移既有 DecorationSet（增量、高效）；有剔除则整体重建
          if (items.length === value.items.length) {
            return { items, decorations: value.decorations.map(tr.mapping, tr.doc) };
          }
          return { items, decorations: buildDecorations(tr.doc, items) };
        }
        return value;
      },
    },
    props: {
      decorations(state) {
        return annotationsPluginKey.getState(state)?.decorations ?? null;
      },
    },
  });
}

/** 右键新建：加入一条 editing 态批注区间 */
export function addAnnotation(
  state: EditorState,
  dispatch: (tr: Transaction) => void,
  item: AnnotationItem
): void {
  dispatch(
    state.tr
      .setMeta(annotationsPluginKey, { type: "add", item } satisfies AnnotationsMeta)
      .setMeta("addToHistory", false)
  );
}

/** commit / edit：切换装饰样式 */
export function updateAnnotationState(
  state: EditorState,
  dispatch: (tr: Transaction) => void,
  id: string,
  nextState: AnnotationState
): void {
  dispatch(
    state.tr
      .setMeta(annotationsPluginKey, { type: "update-state", id, state: nextState })
      .setMeta("addToHistory", false)
  );
}

/** 取消 / 删除共用（对插件而言是同一操作） */
export function removeAnnotations(
  state: EditorState,
  dispatch: (tr: Transaction) => void,
  ids: string[]
): void {
  dispatch(
    state.tr
      .setMeta(annotationsPluginKey, { type: "remove", ids } satisfies AnnotationsMeta)
      .setMeta("addToHistory", false)
  );
}

/** 文件加载恢复：一次性替换全部批注区间 */
export function replaceAllAnnotations(
  state: EditorState,
  dispatch: (tr: Transaction) => void,
  items: AnnotationItem[]
): void {
  dispatch(
    state.tr
      .setMeta(annotationsPluginKey, { type: "replace-all", items } satisfies AnnotationsMeta)
      .setMeta("addToHistory", false)
  );
}

/** 读取当前插件状态中的批注项 */
export function getAnnotationItems(state: EditorState): AnnotationItem[] {
  return annotationsPluginKey.getState(state)?.items ?? [];
}
