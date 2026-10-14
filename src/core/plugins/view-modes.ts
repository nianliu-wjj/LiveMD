/**
 * 视图模式插件（专注模式 / 打字机模式）
 *
 * 对应 Typora 的 View → Focus Mode / Typewriter Mode：
 * - 专注模式：通过装饰类名弱化当前块以外的内容，突出正在编辑的段落
 * - 打字机模式：仅维护开关状态，滚动居中由编辑器实例在选区变化时处理
 */

import { Plugin, PluginKey, EditorState, Transaction } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

/** 视图模式状态 */
export interface ViewModesState {
  focusMode: boolean;
  typewriterMode: boolean;
}

/** 视图模式配置（允许只传部分字段） */
export type ViewModesConfig = Partial<ViewModesState>;

export const viewModesPluginKey = new PluginKey<ViewModesState>("livemd-view-modes");

const EMPTY_DECORATIONS = DecorationSet.empty;

/** 判断某个顶层块是否包含当前选区头部 */
function isCurrentBlock(state: EditorState, from: number, to: number): boolean {
  const head = state.selection.head;
  return head >= from && head <= to;
}

/** 根据当前状态构建专注模式装饰 */
function buildFocusDecorations(state: EditorState, modes: ViewModesState): DecorationSet {
  if (!modes.focusMode) return EMPTY_DECORATIONS;

  const decorations: Decoration[] = [];
  state.doc.forEach((node, offset) => {
    const from = offset;
    const to = offset + node.nodeSize;
    decorations.push(
      Decoration.node(from, to, {
        class: isCurrentBlock(state, from, to) ? "livemd-focus-current" : "livemd-focus-dim",
      })
    );
  });

  return DecorationSet.create(state.doc, decorations);
}

/** 创建视图模式插件 */
export function createViewModesPlugin(config: ViewModesConfig = {}): Plugin {
  const initial: ViewModesState = {
    focusMode: Boolean(config.focusMode),
    typewriterMode: Boolean(config.typewriterMode),
  };

  // 专注模式装饰缓存：装饰视图在每次 PM 渲染时都会请求（含纯选区变化），
  // 无缓存时每次都重建全文档节点装饰。装饰内容同时依赖 doc 与光标位置，故以两者为复用条件。
  let focusCache: { doc: unknown; head: number; set: DecorationSet } | null = null;

  return new Plugin<ViewModesState>({
    key: viewModesPluginKey,
    state: {
      init: () => ({ ...initial }),
      apply(tr: Transaction, value: ViewModesState): ViewModesState {
        const meta = tr.getMeta(viewModesPluginKey) as ViewModesConfig | undefined;
        if (!meta) return value;
        return { ...value, ...meta };
      },
    },
    props: {
      decorations(state) {
        const modes = viewModesPluginKey.getState(state);
        if (!modes || !modes.focusMode) return null;

        const head = state.selection.head;
        if (focusCache && focusCache.doc === state.doc && focusCache.head === head) {
          return focusCache.set;
        }

        const set = buildFocusDecorations(state, modes);
        focusCache = { doc: state.doc, head, set };
        return set;
      },
    },
  });
}

/** 更新视图模式状态 */
export function setViewModes(
  state: EditorState,
  dispatch: (tr: Transaction) => void,
  modes: ViewModesConfig
): void {
  dispatch(state.tr.setMeta(viewModesPluginKey, modes));
}

/** 读取视图模式状态 */
export function getViewModes(state: EditorState): ViewModesState | undefined {
  return viewModesPluginKey.getState(state) ?? undefined;
}
