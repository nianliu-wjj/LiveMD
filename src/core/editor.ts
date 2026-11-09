/**
 * Livemd 编辑器主类
 *
 * 整合所有模块，提供统一的编辑器 API
 */

import { EditorState, Plugin, Transaction, Selection, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { Schema, Node, Slice, Fragment } from "prosemirror-model";
import { history } from "prosemirror-history";
import { dropCursor } from "prosemirror-dropcursor";
import { gapCursor } from "prosemirror-gapcursor";
import { baseKeymap } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";

// 导入 KaTeX CSS
import "katex/dist/katex.min.css";

import { livemdSchema } from "./schema";
import {
  buildClipboardPayload,
  canDeleteAfterClipboardWrite,
  getClipboardFontFamilies,
  getRenderedNodeRoot,
  getRenderedSelectionRoot,
  hasRenderedClipboardNode,
  refreshClipboardFallbacks,
  writeClipboardEvent,
  writeClipboardPayload,
  type ClipboardPayload,
} from "./clipboard";
import { parseMarkdown, MarkdownParser } from "./parser";
import { serializeMarkdown, MarkdownSerializer } from "./serializer";
import { createInstantRenderPlugin } from "./plugins/instant-render";
import { createInputRulesPlugin } from "./plugins/input-rules";
import { createAutoPairPlugin } from "./plugins/auto-pair";
import { createTableResizePlugin } from "./plugins/table-resize";
import {
  createFoldPlugin,
  foldPluginKey,
  getFoldedIndices,
  setFoldedBlocks as applyFoldedBlocks,
  type FoldMeta,
} from "./plugins/fold";
import { createSyntaxFixerPlugin } from "./plugins/syntax-fixer";
import { extractPlainText, markdownToPlainText } from "./utils/plain-text";
import { createMindMapTemplate } from "./utils/mindmap-document";
import { createSyntaxDetectorPlugin } from "./plugins/syntax-detector";
import { createHeadingSyncPlugin } from "./plugins/heading-sync";
import {
  createBlockquoteAlertKeymapPlugin,
  createBlockquoteAlertSyncPlugin,
} from "./plugins/blockquote-alert-sync";
import {
  createPastePlugin,
  containsMarkdownSyntax,
  fileToBase64,
  getImagePasteMethod,
  parseMarkdownPasteSlice,
  saveImageLocally,
  ImagePasteMethod,
} from "./plugins/paste";
import { createMathBlockSyncPlugin } from "./plugins/math-block-sync";
import { createHtmlBlockSyncPlugin } from "./plugins/html-block-sync";
import { createImageSyncPlugin } from "./plugins/image-sync";
import { createViewModesPlugin, setViewModes, getViewModes } from "./plugins/view-modes";
import {
  bookmarksPluginKey,
  createBookmarksPlugin,
  setBookmarkedBlocks,
} from "./plugins/bookmarks";
import {
  addAnnotation,
  createAnnotationsPlugin,
  getAnnotationItems,
  removeAnnotations,
  replaceAllAnnotations,
  updateAnnotationState,
  type AnnotationItem,
} from "./plugins/annotations";
import {
  buildAnnotationAnchor,
  createAnnotationId,
  resolveAnnotationEntries,
  type AnnotationAnchor,
  type AnnotationEntry,
  type AnchorBlockInfo,
} from "../shared/utils/annotations";
import { createPlaceholderPlugin } from "./plugins/placeholder";
import { createLineNumbersPlugin } from "./plugins/line-numbers";
import { createSourceViewTransformPlugin } from "./plugins/source-view-transform";
import {
  createSearchPlugin,
  searchPluginKey,
  updateSearch,
  findNext,
  findPrev,
  replaceMatch,
  replaceAll,
  clearSearch,
} from "./plugins/search";
import type { SearchOptions } from "./plugins/search";
import { createKeymapPlugin, createDynamicKeymapPlugin } from "./keymap";
import type { ShortcutKeyMap } from "./keymap";
import { createCodeBlockNodeView } from "./nodeviews/code-block";
import { createMathBlockNodeView } from "./nodeviews/math-block";
import { createHtmlBlockNodeView } from "./nodeviews/html-block";
import { createImageNodeView } from "./nodeviews/image";
import {
  createBulletListNodeView,
  createOrderedListNodeView,
  createListItemNodeView,
  createTaskListNodeView,
  createTaskItemNodeView,
} from "./nodeviews/list";
import {
  findSyntaxMarkerRegions,
  toggleSourceView,
  setSourceView,
  decorationPluginKey,
} from "./decorations";
import type { LivemdConfig, LivemdEditor as ILivemdEditor, LivemdPlugin } from "./types";
import {
  insertTable,
  addRowBefore,
  addRowAfter,
  addRowAtEnd,
  addColumnBefore,
  addColumnAfter,
  addColumnAtEnd,
  deleteRow,
  deleteColumn,
  insertMarkdownTableRowAfterCurrent,
} from "./commands";
import { DEFAULT_SHORTCUTS, buildActionCommandMap } from "./keymap";
import type { ShortcutActionId } from "./keymap";
import { createTableNodeView } from "./nodeviews/table";

/**
 * 将 ProseMirror 快捷键格式转为显示文本
 */
function formatShortcutDisplay(key: string): string {
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const parts = key.split("-");
  const mapped = parts.map((p) => {
    switch (p) {
      case "Mod":
        return isMac ? "⌘" : "Ctrl";
      case "Shift":
        return isMac ? "⇧" : "Shift";
      case "Alt":
        return isMac ? "⌥" : "Alt";
      case "minus":
        return "-";
      default:
        return p.length === 1 ? p.toUpperCase() : p;
    }
  });
  return isMac ? mapped.join("") : mapped.join("+");
}

/** 编辑器默认配置 */
const defaultConfig: LivemdConfig = {
  content: "",
  readonly: false,
  sourceView: false,
};

// Flow text uses ProseMirror's semantic clipboard DOM; live DOM is for bounded nodes.
function shouldUseRenderedClipboardDom(view: EditorView): boolean {
  return hasRenderedClipboardNode(view.state.selection.content().content);
}

/**
 * Livemd 编辑器类
 */
export class LivemdEditor implements ILivemdEditor {
  view: EditorView;
  private config: LivemdConfig;
  private schema: Schema;
  private parser: MarkdownParser;
  private serializer: MarkdownSerializer;
  private plugins: LivemdPlugin[] = [];
  private eventHandlers: Map<string, Set<Function>> = new Map();
  private contextMenu: HTMLElement | null = null;
  private linkTooltip: HTMLElement | null = null;
  private linkTooltipCurrentLink: HTMLAnchorElement | null = null;
  private linkTooltipHideTimer: ReturnType<typeof setTimeout> | null = null;
  private searchPanel: HTMLElement | null = null;
  private searchWrapper: HTMLElement | null = null;
  private searchInput: HTMLInputElement | null = null;
  private replaceRow: HTMLElement | null = null;
  private matchCountSpan: HTMLElement | null = null;
  private searchCaseSensitive = false;
  private searchWholeWord = false;
  private searchUseRegex = false;
  private searchInSelection = false;
  private searchSelectionRange: { from: number; to: number } | null = null;
  private containerKeydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private selectionCorrectionHandler: (() => void) | null = null;
  private suppressSelectionCorrection = false;
  private recentMouseupSelectionHead: number | null = null;
  private recentMouseupAt = 0;
  private typewriterRaf: number | null = null;
  private _destroyed = false;

  /** getMarkdown 缓存：文档未变化时复用上一次全量序列化结果（doc 引用相等即命中） */
  private markdownCache: { doc: unknown; markdown: string } | null = null;
  /** 批注区间快照：dispatchTransaction 末尾对比感知"自动删除/位置变化"（插件 apply 保持纯函数） */
  private annotationSnapshot: Map<string, { from: number; to: number; state: string }> = new Map();

  constructor(container: HTMLElement, config: LivemdConfig = {}) {
    this.config = { ...defaultConfig, ...config };
    this.schema = livemdSchema;
    this.parser = new MarkdownParser(this.schema);
    this.serializer = new MarkdownSerializer();

    // 解析初始内容
    const { doc } = this.parser.parse(this.config.content || "");

    // 创建编辑器状态
    const state = EditorState.create({
      doc,
      plugins: this.createPlugins(),
    });

    // 创建编辑器视图
    this.view = new EditorView(container, {
      state,
      editable: () => !this.config.readonly,
      clipboardTextSerializer: (slice) => this.serializeSliceToMarkdown(slice),
      clipboardTextParser: (text) => {
        // 将粘贴的纯文本作为 Markdown 解析
        return parseMarkdownPasteSlice(text, this.parser) || Slice.empty;
      },
      nodeViews: {
        code_block: (node, view, getPos) =>
          createCodeBlockNodeView(node, view, getPos, () => this.config.readonly === true),
        math_block: createMathBlockNodeView,
        html_block: createHtmlBlockNodeView,
        image: createImageNodeView,
        bullet_list: createBulletListNodeView,
        ordered_list: createOrderedListNodeView,
        list_item: createListItemNodeView,
        task_list: createTaskListNodeView,
        task_item: createTaskItemNodeView,
        table: (node, view) =>
          createTableNodeView(node, view, {
            // 复制表格与格式化表格代码需要渲染层能力，交给 editor 转发
            onCopyTable: () => {
              const payload = this.createCurrentTableClipboardPayload();
              if (payload) void writeClipboardPayload(payload);
            },
            onRunRendererCommand: (id) => this.emit("rendererCommand", { id }),
          }),
      },
      dispatchTransaction: (tr) => this.dispatchTransaction(tr),
      attributes: {
        class: "livemd-editor",
      },
      handleClick: (view, pos, event) => this.handleEditorClick(view, pos, event),
      handleDOMEvents: {
        contextmenu: (view, event) => this.handleContextMenu(view, event),
        copy: (view, event) => this.handleCopy(view, event),
        cut: (view, event) => this.handleCut(view, event),
      },
    });

    // 初始渲染后同步一次表格工具栏显隐
    this.syncTableToolbarVisibility();

    // 初始化自定义插件
    this.initPlugins();

    // 初始化链接 tooltip 和点击拦截
    this.initLinkHandler();

    // 创建搜索面板（挂载到 container，不在 contenteditable 内）
    this.createSearchPanel(container);

    // 设置初始源码视图状态
    if (this.config.sourceView) {
      setSourceView(this.view.state, true, this.view.dispatch.bind(this.view));
    }
  }

  /**
   * 创建 ProseMirror 插件
   */
  private createPlugins(): Plugin[] {
    const plugins: Plugin[] = [
      // 历史记录
      history(),
      // 拖拽光标
      dropCursor(),
      // 间隙光标
      gapCursor(),
      // 搜索替换快捷键（最高优先级）
      keymap({
        "Mod-f": () => {
          this.openSearch(false);
          return true;
        },
        "Mod-h": () => {
          this.openSearch(true);
          return true;
        },
      }),
      // 引用告示块快捷键插件（需早于 keymap，优先处理 Backspace/Delete）
      createBlockquoteAlertKeymapPlugin(),
      // 动态快捷键插件（可自定义的快捷键，优先级最高）
      createDynamicKeymapPlugin(this.schema, () => this.getCachedCustomKeyMap()),
      // 不可自定义的快捷键（块级 Enter、列表操作等）
      ...createKeymapPlugin(this.schema),
      // 基础快捷键
      keymap(baseKeymap),
      // 即时渲染插件
      ...createInstantRenderPlugin(),
      // 引用告示块同步/装饰插件（需晚于 instant-render，读取源码模式状态）
      createBlockquoteAlertSyncPlugin(),
      // 输入规则
      createInputRulesPlugin(this.schema),
      // 中文标点/引号自动成对闭合（晚于输入规则，规则命中时优先由规则消费）
      createAutoPairPlugin(),
      // 表格行列尺寸调整（Ctrl + 拖拽）
      createTableResizePlugin(),
      // 标题 / 表格折叠（折叠状态存插件 state，不改文档结构）
      createFoldPlugin(),
      // 语法修复插件
      createSyntaxFixerPlugin(),
      // 语法检测插件
      createSyntaxDetectorPlugin(),
      // 标题同步插件
      createHeadingSyncPlugin(),
      // 粘贴处理插件
      createPastePlugin(this.config.pasteConfig),
      // 数学块状态同步插件
      createMathBlockSyncPlugin(),
      // HTML 块状态同步插件
      createHtmlBlockSyncPlugin(),
      // 图片状态同步插件
      createImageSyncPlugin(),
      // 源码模式文档转换插件
      createSourceViewTransformPlugin(),
      // 视图模式插件（专注模式 / 打字机模式）
      createViewModesPlugin(this.config.viewModes),
      // 书签标记插件
      createBookmarksPlugin(),
      // 批注高亮插件
      createAnnotationsPlugin(),
      // 行号插件
      createLineNumbersPlugin(),
      // 搜索插件
      createSearchPlugin(),
    ];

    // Placeholder 插件（如果配置了）
    if (this.config.placeholder) {
      plugins.push(createPlaceholderPlugin(this.config.placeholder));
    }

    return plugins;
  }

  /**
   * 初始化自定义插件
   */
  private initPlugins(): void {
    if (this.config.plugins) {
      for (const plugin of this.config.plugins) {
        this.plugins.push(plugin);
        plugin.init?.(this);
      }
    }
  }

  /**
   * 处理事务分发
   */
  /**
   * 同步表格悬浮工具栏的显隐
   *
   * 以 DOM 类名切换实现（.livemd-table-active），避免为纯展示需求新增装饰插件：
   * 光标所在表格显示工具栏，其余表格隐藏；弹层（网格选择器/更多操作）由 NodeView 自行管理。
   */
  private syncTableToolbarVisibility(): void {
    let activeBlock: Element | null = null;
    try {
      const dom = this.view.domAtPos(this.view.state.selection.from).node;
      const element = dom instanceof HTMLElement ? dom : dom.parentElement;
      activeBlock = element?.closest(".livemd-table-block") ?? null;
    } catch {
      activeBlock = null;
    }

    const blocks = this.view.dom.querySelectorAll(".livemd-table-block");
    blocks.forEach((block) => {
      block.classList.toggle("livemd-table-active", block === activeBlock);
    });
  }

  private dispatchTransaction(tr: Transaction): void {
    // 只读：拦截一切改动文档的事务（键入、右键菜单、命令面板等程序化修改）；
    // 内容注入类事务（setMarkdown / restoreDoc）带 addToHistory=false 标记，照常放行
    if (this.config.readonly && tr.docChanged && tr.getMeta("addToHistory") !== false) {
      console.info("[livemd] 只读状态下忽略文档修改事务");
      return;
    }

    const newState = this.view.state.apply(tr);
    this.view.updateState(newState);

    // 折叠状态变化：回传块索引，由渲染层按文件持久化。
    // 必须在 updateState 之后读取：此前在 apply 之前 emit，回传的是变更前的旧索引，
    // restoreDoc 注入折叠时会把持久化记录覆盖成空集合。
    if (tr.getMeta(foldPluginKey)) {
      this.emit("foldChange", { indices: this.getFoldedBlocks() });
    }

    // 光标所在表格显示悬浮工具栏（其余表格隐藏）
    this.syncTableToolbarVisibility();

    // 触发变更事件
    if (tr.docChanged) {
      // 文档已变化，作废 getMarkdown 缓存（仅选区变化不影响序列化结果）
      this.markdownCache = null;
      this.emit("change", {
        markdown: this.getMarkdown(),
        transaction: tr,
      });
    }

    // 触发选区变更事件
    if (tr.selectionSet) {
      this.emit("selectionChange", {
        from: newState.selection.from,
        to: newState.selection.to,
        sourceFrom: newState.selection.from,
        sourceTo: newState.selection.to,
      });

      // 打字机模式：选区变化后将光标滚动到视图垂直中央
      const viewModes = getViewModes(newState);
      if (viewModes?.typewriterMode) {
        this.scheduleTypewriterScroll();
      }
    }

    // 批注变更感知（对比插件状态快照，插件 apply 保持纯函数）
    this.syncAnnotationState(newState);
  }

  /**
   * 下次绘制时将光标滚动到视图中央（打字机模式）
   */
  private scheduleTypewriterScroll(): void {
    if (this.typewriterRaf !== null) return;
    this.typewriterRaf = requestAnimationFrame(() => {
      this.typewriterRaf = null;
      this.centerCursor();
    });
  }

  /**
   * 将光标所在位置滚动到滚动容器垂直中央
   */
  centerCursor(): void {
    if (this._destroyed) return;
    const scrollParent = this.view.dom.closest(".scrollView") as HTMLElement | null;
    if (!scrollParent) return;

    let coords: { top: number; bottom: number } | null = null;
    try {
      coords = this.view.coordsAtPos(this.view.state.selection.head);
    } catch {
      coords = null;
    }
    if (!coords) return;

    const parentRect = scrollParent.getBoundingClientRect();
    const centerY = parentRect.top + parentRect.height / 2;
    const cursorCenterY = (coords.top + coords.bottom) / 2;
    const delta = cursorCenterY - centerY;
    if (Math.abs(delta) < 1) return;
    scrollParent.scrollTop += delta;
  }

  /**
   * 获取 Markdown 内容
   */
  /**
   * 全量序列化 O(文档大小)，此前每次调用都重新执行：打字场景下 change 事件 +
   * selectionChange 回调至少触发两次，是键入延迟的主要来源。现在按 doc 引用缓存——
   * 文档未变（仅选区移动）时直接复用上一次结果，文档变化时才重新序列化。
   */
  getMarkdown(): string {
    const doc = this.view.state.doc;
    if (this.markdownCache && this.markdownCache.doc === doc) {
      return this.markdownCache.markdown;
    }
    const markdown = serializeMarkdown(doc);
    this.markdownCache = { doc, markdown };
    return markdown;
  }

  /**
   * 获取当前选区的 Markdown 片段
   *
   * 用于「提取选区为新文件」等需要保留 Markdown 结构的场景。
   */
  getSelectionMarkdown(): string {
    const { selection } = this.view.state;
    if (selection.empty) return "";
    return this.serializeSliceToMarkdown(selection.content()).trim();
  }

  /**
   * 获取当前选区的纯文本（忽略 Markdown 语法标记）
   */
  getSelectionText(): string {
    const { from, to, empty } = this.view.state.selection;
    if (empty) return "";
    return this.getPlainTextBetween(from, to).replace(/\s+/g, " ").trim();
  }

  /**
   * 获取光标/选区所在链接的信息
   */
  getLinkAtSelection(): { href: string; text: string } | null {
    const range = this.findLinkRange();
    if (!range) return null;
    return {
      href: range.href,
      text: this.getPlainTextBetween(range.from, range.to).replace(/\s+/g, " ").trim(),
    };
  }

  /**
   * 插入或更新链接
   *
   * 通过插入 Markdown 语法文本实现，交给 syntax-detector 渲染为链接。
   * 选区已有链接时替换整段链接语法；否则保留选区中的行内格式。
   */
  insertLink(text: string, href: string): boolean {
    if (!this.view.editable) return false;
    const linkHref = href.trim();
    if (!linkHref) return false;

    const state = this.view.state;
    const selection = state.selection;
    if (!(selection instanceof TextSelection)) return false;

    const { from, to, empty } = selection;
    const safeHref = linkHref.replace(/\s+/g, "%20").replace(/([()])/g, "\\$1");
    const existing = this.findLinkRange();

    let replaceFrom = from;
    let replaceTo = to;
    let markdown: string;

    if (existing) {
      const selectedText = this.getPlainTextBetween(existing.from, existing.to)
        .replace(/\s+/g, " ")
        .trim();
      const label = text.trim() || selectedText || linkHref;
      markdown = `[${label}](${safeHref})`;
      replaceFrom = existing.from;
      replaceTo = existing.to;
    } else if (empty) {
      const label = text.trim() || linkHref;
      markdown = `[${label}](${safeHref})`;
    } else {
      const plainText = this.getSelectionText();
      const rawText = state.doc.textBetween(from, to, "\n", "\n");
      const edited = Boolean(text.trim()) && text.trim() !== plainText;
      const label = edited || rawText.includes("\n") ? text.trim() || plainText : rawText;
      markdown = `[${label}](${safeHref})`;
    }

    let tr = state.tr.insertText(markdown, replaceFrom, replaceTo);
    tr = tr.setSelection(TextSelection.create(tr.doc, replaceFrom + markdown.length));
    this.view.dispatch(tr.scrollIntoView());
    this.view.focus();
    return true;
  }

  /**
   * 删除当前选区（不可编辑时返回 false）
   */
  deleteSelection(): boolean {
    if (!this.view.editable) return false;
    const { selection } = this.view.state;
    if (selection.empty) return false;
    this.view.dispatch(this.view.state.tr.deleteSelection().scrollIntoView());
    this.view.focus();
    return true;
  }

  /**
   * 设置 Markdown 内容
   */
  setMarkdown(content: string): void {
    const { doc } = this.parser.parse(content);
    const tr = this.view.state.tr
      .replaceWith(0, this.view.state.doc.content.size, doc.content)
      .setMeta("addToHistory", false);
    this.view.dispatch(tr);
  }

  /**
   * 恢复文档：内容替换 + 折叠 + 书签 + 光标合并为**一条事务**
   *
   * 渲染层原来 `setMarkdown + setBookmarkedBlocks + setFoldedBlocks` 三连调 = 3 条事务
   * = 3 次 appendTransaction 插件全文档跑 + 3 次全量 decorate；合并后打开文档的插件开销砍掉 2/3。
   * 折叠 / 书签插件都按 meta 生效，可以挂在同一条事务上；光标偏移越界时自动钳制。
   */
  restoreDoc(
    content: string,
    options: { folded?: number[]; bookmarks?: number[]; cursorOffset?: number } = {}
  ): void {
    const { doc } = this.parser.parse(content);
    let tr = this.view.state.tr
      .replaceWith(0, this.view.state.doc.content.size, doc.content)
      .setMeta("addToHistory", false);

    if (options.folded) {
      // 折叠插件按 meta 生效：set 语义覆盖为完整折叠集合
      tr = tr.setMeta(foldPluginKey, {
        type: "set",
        indices: options.folded,
      } satisfies FoldMeta);
    }
    if (options.bookmarks) {
      tr = tr.setMeta(bookmarksPluginKey, options.bookmarks);
    }
    if (options.cursorOffset !== undefined && options.cursorOffset > 0) {
      // 越界自动钳制到新文档范围内
      const pos = Math.min(Math.max(0, options.cursorOffset), tr.doc.content.size);
      tr = tr.setSelection(Selection.near(tr.doc.resolve(pos)));
    }

    this.view.dispatch(tr);
  }

  /** 顶层块预览文本（与书签存储使用同一口径） */
  private static blockPreview(node: {
    textBetween: Function;
    content: { size: number };
    type: { name: string };
  }): string {
    const text = String(node.textBetween(0, Math.min(node.content.size, 160), " "))
      .replace(/\s+/g, " ")
      .trim();
    if (text) return text;

    const labels: Record<string, string> = {
      paragraph: "段落",
      heading: "标题",
      bullet_list: "无序列表",
      ordered_list: "有序列表",
      code_block: "代码块",
      blockquote: "引用",
      table: "表格",
      image: "图片",
      horizontal_rule: "分隔线",
      math_block: "公式块",
      html_block: "HTML 块",
    };
    return labels[node.type.name] ?? node.type.name;
  }

  /**
   * 获取坐标所在顶层块的索引与预览文本（用于 Alt+点击添加书签）
   */
  getBlockBookmarkAt(
    clientX: number,
    clientY: number
  ): {
    index: number;
    text: string;
    type: string;
  } | null {
    const coords = this.view.posAtCoords({ left: clientX, top: clientY });
    if (!coords) return null;

    const $pos = this.view.state.doc.resolve(coords.pos);
    if ($pos.depth === 0) return null;

    const index = $pos.index(0);
    const node = this.view.state.doc.child(index);
    return {
      index,
      text: LivemdEditor.blockPreview(node),
      type: node.type.name,
    };
  }

  /**
   * 获取光标所在顶层块的索引与预览文本（用于命令面板添加书签）
   */
  getCurrentBlockBookmark(): { index: number; text: string; type: string } | null {
    const $from = this.view.state.selection.$from;
    if ($from.depth === 0) return null;

    const index = $from.index(0);
    const node = this.view.state.doc.child(index);
    return {
      index,
      text: LivemdEditor.blockPreview(node),
      type: node.type.name,
    };
  }

  /** 更新当前编辑器显示的书签块 */
  /** 读取当前折叠块索引（渲染层持久化用） */
  getFoldedBlocks(): number[] {
    return getFoldedIndices(this.view.state);
  }

  /** 恢复折叠状态（读取本地持久化数据后调用） */
  setFoldedBlocks(indices: number[]): void {
    applyFoldedBlocks(this.view.state, this.view.dispatch.bind(this.view), indices);
  }

  setBookmarkedBlocks(indices: number[]): void {
    setBookmarkedBlocks(this.view.state, this.view.dispatch.bind(this.view), indices);
  }

  /**
   * 跳转到书签块
   *
   * 优先使用保存的索引；若文档结构已变化，则回退到按预览文本匹配。
   */
  revealBlock(bookmark: { index: number; text?: string }): boolean {
    const doc = this.view.state.doc;
    if (doc.childCount === 0) return false;

    const normalized = (value: string) => value.replace(/\s+/g, " ").trim();
    const targetText = normalized(bookmark.text ?? "");
    const expectedIndex = Math.max(0, Math.min(bookmark.index, doc.childCount - 1));

    let targetIndex = -1;
    const candidate = doc.child(expectedIndex);
    const candidateText = LivemdEditor.blockPreview(candidate);
    if (!targetText || candidateText === targetText) {
      targetIndex = expectedIndex;
    }

    if (targetIndex < 0 && targetText) {
      doc.forEach((node, _offset, index) => {
        if (targetIndex >= 0) return;
        const preview = LivemdEditor.blockPreview(node);
        if (preview === targetText) {
          targetIndex = index;
        }
      });
    }

    if (targetIndex < 0 && targetText) {
      doc.forEach((node, _offset, index) => {
        if (targetIndex >= 0 || targetText.length < 2) return;
        const preview = LivemdEditor.blockPreview(node);
        if (preview.includes(targetText) || targetText.includes(preview)) {
          targetIndex = index;
        }
      });
    }

    if (targetIndex < 0) targetIndex = expectedIndex;

    let pos = 0;
    for (let index = 0; index < targetIndex; index += 1) {
      pos += doc.child(index).nodeSize;
    }

    const dom = this.view.nodeDOM(pos);
    if (dom instanceof HTMLElement) {
      dom.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    try {
      const target = doc.child(targetIndex);
      if (!target.isLeaf) {
        const selection = TextSelection.near(doc.resolve(pos + 1));
        this.view.dispatch(this.view.state.tr.setSelection(selection));
      }
    } catch {
      // 原子块或特殊结构无法放置光标时仅滚动
    }

    this.view.focus();
    return true;
  }

  // ============ 批注（Annotation）============

  /** getCustomKeyMap 缓存：避免右键菜单/快捷键匹配每次都 JSON.parse 整个配置 */
  private customKeyMapCache: ShortcutKeyMap | null = null;

  /**
   * 带缓存的用户自定义快捷键读取
   *
   * 快捷键匹配在每次按键/右键菜单都会读取映射，直接 JSON.parse 整个配置是每击键的隐藏开销；
   * 配置写入后调用 invalidateCustomKeyMapCache() 失效缓存。
   */
  private getCachedCustomKeyMap(): ShortcutKeyMap {
    if (!this.customKeyMapCache) {
      this.customKeyMapCache = this.getCustomKeyMap();
    }
    return this.customKeyMapCache;
  }

  /** 快捷键配置变化后失效缓存（设置页写入快捷键配置时调用） */
  invalidateCustomKeyMapCache(): void {
    this.customKeyMapCache = null;
  }

  /** 块起点数组缓存：同一文档多条批注共享结果，避免 O(批注数 × 块数) 的重复全量遍历 */
  private blockStartsCache: { doc: Node; starts: number[] } | null = null;

  /**
   * 顶层块起始位置累计数组 [0, n0, n0+n1, ...]（锚点换算用）
   *
   * 按 doc 引用缓存：批注锚点回写会对每条批注各求一次块起点，无缓存即每条一次全文档遍历。
   * 返回数组已冻结，调用方不得修改。
   */
  private getBlockStartPositions(doc: Node): number[] {
    if (this.blockStartsCache && this.blockStartsCache.doc === doc) {
      return this.blockStartsCache.starts;
    }
    const starts: number[] = [];
    let pos = 0;
    for (let index = 0; index < doc.childCount; index += 1) {
      starts.push(pos);
      pos += doc.child(index).nodeSize;
    }
    const frozen = Object.freeze(starts) as number[];
    this.blockStartsCache = { doc, starts: frozen };
    return frozen;
  }

  /**
   * 反算语义锚点：PM 位置 → 块索引 + 块内偏移 + 文本快照。
   * 块内偏移用 "PM 位置 − 块起点 − 1"（+1 是块的 open token；对纯文本段落即文本偏移）。
   */
  private computeAnchorForRange(from: number, to: number): AnnotationAnchor | null {
    const doc = this.view.state.doc;
    if (from >= to || from < 0 || to > doc.content.size || doc.childCount === 0) return null;

    const blockStarts = this.getBlockStartPositions(doc);
    const $from = doc.resolve(from);
    const $to = doc.resolve(to);
    const clampIndex = (index: number) => Math.max(0, Math.min(index, doc.childCount - 1));
    const startBlockIndex = clampIndex($from.index(0));
    const endBlockIndex = clampIndex($to.index(0));

    const startOffset = Math.max(0, from - blockStarts[startBlockIndex] - 1);
    const endOffset = Math.max(0, to - blockStarts[endBlockIndex] - 1);
    const selectedText = doc.textBetween(from, to, "\n", " ");

    return buildAnnotationAnchor({
      startBlockIndex,
      startOffset,
      endBlockIndex,
      endOffset,
      selectedText,
    });
  }

  /**
   * 右键菜单入口：由编辑器一次性完成"建装饰 + 发 id"，
   * 渲染层的事件处理是幂等的数据补充（store 记录 + 展开对话框），没有中间态。
   */
  requestCreateAnnotation(): void {
    const { state } = this.view;
    const { from, to } = state.selection;
    const anchor = this.computeAnchorForRange(from, to);
    if (!anchor) return;

    const id = createAnnotationId();
    addAnnotation(state, this.view.dispatch.bind(this.view), {
      id,
      from,
      to,
      state: "editing",
    });
    this.emit("annotationRequestCreate", { id, anchor, from, to });
  }

  /** editing → done */
  commitAnnotation(id: string): void {
    updateAnnotationState(this.view.state, this.view.dispatch.bind(this.view), id, "done");
  }

  /** done → editing（重新编辑） */
  editAnnotation(id: string): void {
    updateAnnotationState(this.view.state, this.view.dispatch.bind(this.view), id, "editing");
  }

  /** 取消 / 删除共用 */
  removeAnnotation(id: string): void {
    removeAnnotations(this.view.state, this.view.dispatch.bind(this.view), [id]);
  }

  /** 滚动定位 + 双脉冲闪烁动画 */
  revealAnnotation(id: string): boolean {
    const item = getAnnotationItems(this.view.state).find((entry) => entry.id === id);
    if (!item) return false;

    let dom: Element | null = null;
    try {
      dom = this.view.dom.querySelector(`[data-annotation-id="${CSS.escape(id)}"]`);
    } catch {
      dom = null;
    }
    if (dom instanceof HTMLElement) {
      dom.scrollIntoView({ behavior: "smooth", block: "center" });
      // 重启动画前强制 reflow，保证连续点击也能重新闪烁
      dom.classList.remove("livemd-annotation-mark--flash");
      void dom.offsetWidth;
      dom.classList.add("livemd-annotation-mark--flash");
      window.setTimeout(() => dom?.classList.remove("livemd-annotation-mark--flash"), 2600);
    }
    return true;
  }

  /**
   * 文件加载后重定位注入（replace-all）。
   * 返回重定位失败被丢弃的 id，供渲染层清理存储。
   */
  restoreAnnotations(entries: AnnotationEntry[]): string[] {
    const doc = this.view.state.doc;
    const blocks: AnchorBlockInfo[] = [];
    for (let index = 0; index < doc.childCount; index += 1) {
      const child = doc.child(index);
      blocks.push({ text: child.textContent, contentSize: child.content.size });
    }

    const { resolved, droppedIds } = resolveAnnotationEntries(blocks, entries);

    const items: AnnotationItem[] = [];
    for (const { entry, range } of resolved) {
      const from = this.resolveAnchorEndpoint(range.startBlockIndex, range.startOffset);
      const to = this.resolveAnchorEndpoint(range.endBlockIndex, range.endOffset);
      if (from === null || to === null || from >= to) {
        droppedIds.push(entry.id);
        continue;
      }
      items.push({ id: entry.id, from, to, state: entry.state });
    }

    replaceAllAnnotations(this.view.state, this.view.dispatch.bind(this.view), items);
    return droppedIds;
  }

  /** 块索引 + 块内偏移 → PM 位置（computeAnchorForRange 的逆换算） */
  private resolveAnchorEndpoint(blockIndex: number, offset: number): number | null {
    const doc = this.view.state.doc;
    if (blockIndex < 0 || blockIndex >= doc.childCount) return null;

    let blockStart = 0;
    for (let index = 0; index < blockIndex; index += 1) {
      blockStart += doc.child(index).nodeSize;
    }
    const blockEnd = blockStart + doc.child(blockIndex).nodeSize;
    // +1 = 块 open token；夹到块内容范围内（末尾 -1 是块 close token）
    return Math.min(
      Math.max(blockStart + 1 + offset, blockStart + 1),
      Math.max(blockStart + 1, blockEnd - 1)
    );
  }

  /** 读取当前批注项（供桥接层计算锚定文字屏幕坐标） */
  listAnnotationItems(): AnnotationItem[] {
    return getAnnotationItems(this.view.state);
  }

  /**
   * 批注变更感知（挂在 dispatchTransaction 里 updateState 之后）：
   * 对比插件状态与 annotationSnapshot——id 消失 → emit annotationAutoRemoved；
   * 位置/状态变化 → computeAnchorForRange 重算锚点 emit annotationPositions
   * （渲染层防抖回写 localStorage，使持久化锚点在编辑过程中持续保鲜）。
   */
  private syncAnnotationState(state: EditorState): void {
    const items = getAnnotationItems(state);
    if (items.length === 0 && this.annotationSnapshot.size === 0) return; // 快速路径

    const removedIds: string[] = [];
    const positions: Array<{ id: string; anchor: AnnotationAnchor }> = [];
    const nextSnapshot = new Map<string, { from: number; to: number; state: string }>();
    let changed = false;

    for (const item of items) {
      nextSnapshot.set(item.id, { from: item.from, to: item.to, state: item.state });
      const prev = this.annotationSnapshot.get(item.id);
      if (!prev || prev.from !== item.from || prev.to !== item.to || prev.state !== item.state) {
        changed = true;
      }
      const anchor = this.computeAnchorForRange(item.from, item.to);
      if (anchor) positions.push({ id: item.id, anchor });
    }

    for (const id of this.annotationSnapshot.keys()) {
      if (!nextSnapshot.has(id)) removedIds.push(id); // 坍缩剔除 / 渲染层主动删除 都在这显现
    }

    this.annotationSnapshot = nextSnapshot;
    if (removedIds.length > 0) this.emit("annotationAutoRemoved", { ids: removedIds });
    if (changed && positions.length > 0) this.emit("annotationPositions", { positions });
  }

  /**
   * 获取当前配置
   */
  getConfig(): LivemdConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<LivemdConfig>): void {
    // 配置（可能含 shortcuts）更新后失效快捷键缓存，避免读到旧映射
    this.customKeyMapCache = null;
    this.config = { ...this.config, ...config };

    // 处理只读状态变更
    if (config.readonly !== undefined) {
      this.view.setProps({ editable: () => !config.readonly });
    }

    // 处理源码视图变更
    if (config.sourceView !== undefined) {
      setSourceView(this.view.state, config.sourceView, this.view.dispatch.bind(this.view));
    }

    // 处理视图模式变更（专注模式 / 打字机模式）
    if (config.viewModes !== undefined) {
      setViewModes(this.view.state, this.view.dispatch.bind(this.view), config.viewModes);
      if (config.viewModes.typewriterMode) {
        this.scheduleTypewriterScroll();
      }
    }
  }

  /**
   * 销毁编辑器
   */
  destroy(): void {
    this._destroyed = true;

    if (this.typewriterRaf !== null) {
      cancelAnimationFrame(this.typewriterRaf);
      this.typewriterRaf = null;
    }

    // 销毁自定义插件
    for (const plugin of this.plugins) {
      plugin.destroy?.();
    }
    this.plugins = [];

    // 清理事件处理器
    this.eventHandlers.clear();

    // 清理右键菜单
    this.hideContextMenu();

    // 清理链接 tooltip
    this.hideLinkTooltipImmediate();
    this.linkTooltip?.remove();
    this.linkTooltip = null;

    // 清理搜索面板
    if (this.containerKeydownHandler) {
      this.view.dom.parentElement?.removeEventListener("keydown", this.containerKeydownHandler);
      this.containerKeydownHandler = null;
    }
    if (this.selectionCorrectionHandler) {
      document.removeEventListener("selectionchange", this.selectionCorrectionHandler);
      this.selectionCorrectionHandler = null;
    }
    this.searchWrapper?.remove();
    this.searchWrapper = null;
    this.searchPanel = null;

    // 销毁视图
    this.view.destroy();
  }

  /**
   * 聚焦编辑器
   */
  focus(): void {
    this.view.focus();
  }

  /** Retry async PNG fallbacks after a previously hidden editor becomes visible. */
  refreshClipboardFallbacks(): void {
    refreshClipboardFallbacks(this.view.dom);
  }

  /**
   * 处理编辑器点击事件
   * 用于处理点击空白区域时的聚焦
   */
  private handleEditorClick(view: EditorView, pos: number, event: MouseEvent): boolean {
    // 批注高亮点击：不拦截（光标仍正常落位），仅通知渲染层定位对应卡片
    const target = event.target as Element | null;
    const annotationEl = target?.closest?.("[data-annotation-id]") ?? null;
    if (annotationEl) {
      const id = annotationEl.getAttribute("data-annotation-id");
      if (id) {
        this.emit("annotationClicked", { id });
      }
    }

    const { state } = view;
    const { doc } = state;
    const clickY = event.clientY;

    // 获取第一个和最后一个块节点的位置
    const firstChild = doc.firstChild;
    const lastChild = doc.lastChild;

    if (!firstChild || !lastChild) return false;

    // 检查是否点击在第一个节点上方
    const firstNodePos = 0;
    const firstNodeCoords = view.coordsAtPos(firstNodePos + 1);
    if (clickY < firstNodeCoords.top) {
      // 点击在第一个节点上方，聚焦到第一个字符
      const tr = state.tr.setSelection(TextSelection.create(state.doc, 1));
      view.dispatch(tr);
      view.focus();
      return true;
    }

    // 检查是否点击在最后一个节点下方
    const lastNodePos = doc.content.size - lastChild.nodeSize;
    const lastNodeEndPos = doc.content.size;
    const lastNodeCoords = view.coordsAtPos(lastNodeEndPos);
    if (clickY > lastNodeCoords.bottom) {
      // 点击在最后一个节点下方
      // 如果最后一个节点不是段落，在后面插入一个段落
      if (lastChild.type.name !== "paragraph") {
        const paragraph = state.schema.nodes.paragraph.create();
        const tr = state.tr.insert(doc.content.size, paragraph);
        tr.setSelection(TextSelection.create(tr.doc, doc.content.size + 1));
        view.dispatch(tr);
        view.focus();
        return true;
      }
    }

    return false;
  }

  // ============ 链接 Tooltip 和点击拦截 ============

  private static readonly IS_MAC =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  private static readonly MOD_KEY = LivemdEditor.IS_MAC ? "⌘" : "Ctrl";

  /** 从 DOM 元素向上查找最近的 <a> 标签 */
  private findLinkElement(target: HTMLElement): HTMLAnchorElement | null {
    let el: HTMLElement | null = target;
    const root = this.view.dom;
    while (el && el !== root) {
      if (el.tagName === "A") {
        return el as HTMLAnchorElement;
      }
      el = el.parentElement;
    }
    return null;
  }

  /** 从 <a> 元素获取链接 URL（优先从 ProseMirror 文档模型读取） */
  private getLinkHref(linkEl: HTMLAnchorElement): string {
    // 1. 先尝试从 href 属性获取
    const href = linkEl.getAttribute("href");
    if (href) return href;

    // 2. href 为空时，从 ProseMirror 文档模型中获取 link mark 的 attrs
    try {
      const pos = this.view.posAtDOM(linkEl, 0);
      if (pos >= 0) {
        const $pos = this.view.state.doc.resolve(pos);
        // 检查当前位置的 marks
        const marks = $pos.marks();
        for (const mark of marks) {
          if (mark.type.name === "link" && mark.attrs.href) {
            return mark.attrs.href;
          }
        }
        // 也检查该位置的节点 marks
        const node = this.view.state.doc.nodeAt(pos);
        if (node) {
          for (const mark of node.marks) {
            if (mark.type.name === "link" && mark.attrs.href) {
              return mark.attrs.href;
            }
          }
        }
      }
    } catch {
      // posAtDOM 可能抛出异常
    }

    // 3. 最后从 DOM 中与此链接相邻的语法标记文本提取 URL
    // 从 linkEl 向后查找紧邻的 ](url) 语法标记
    let sibling: Element | null = linkEl.nextElementSibling;
    // 跳过同属一个链接的中间 <a> 元素
    while (sibling && sibling.tagName === "A") {
      sibling = sibling.nextElementSibling;
    }
    if (sibling && sibling.matches('span.livemd-syntax[data-syntax-type="link"]')) {
      const text = sibling.textContent || "";
      const m = text.match(/\]\((.+?)(?:\s+"[^"]*")?\)$/);
      if (m && m[1]) return m[1];
    }

    return "";
  }

  /** 初始化链接处理 */
  private initLinkHandler(): void {
    const dom = this.view.dom;
    const container = dom.parentElement || dom;

    // 确保容器有定位上下文（tooltip 用 absolute 定位）
    if (container !== dom && getComputedStyle(container).position === "static") {
      container.style.position = "relative";
    }

    // 在 mousedown capture 阶段拦截链接上的 Ctrl+click，
    // 阻止 ProseMirror 将其解释为节点选中，并直接打开链接
    dom.addEventListener(
      "mousedown",
      (e: Event) => {
        const me = e as MouseEvent;
        const modPressed = LivemdEditor.IS_MAC ? me.metaKey : me.ctrlKey;
        if (!modPressed) return;
        const linkEl = this.findLinkElement(me.target as HTMLElement);
        if (!linkEl) return;

        me.preventDefault();
        me.stopPropagation();

        const href = this.getLinkHref(linkEl);
        if (href) {
          const electronAPI = (window as any).electronAPI;
          const currentFilePath = (window as any).__currentFilePath || null;
          if (electronAPI?.openLink) {
            electronAPI.openLink(href, currentFilePath);
          } else if (electronAPI?.openExternal) {
            electronAPI.openExternal(href);
          } else {
            window.open(href, "_blank", "noopener,noreferrer");
          }
        }
      },
      true // capture 阶段
    );

    // 用 capture 阶段拦截所有链接点击，阻止 Electron 内部导航
    dom.addEventListener(
      "click",
      (e: Event) => {
        const me = e as MouseEvent;
        this.correctSelectionFromHiddenSyntaxMarker();
        const linkEl = this.findLinkElement(me.target as HTMLElement);
        if (!linkEl) return;

        // 始终阻止 <a> 标签的默认跳转
        me.preventDefault();
      },
      true // capture 阶段
    );

    dom.addEventListener(
      "mouseup",
      (e: Event) => {
        this.recordMouseupSelectionSnapshot();
        queueMicrotask(() => this.correctSelectionFromHiddenSyntaxMarker());
        setTimeout(() => this.correctSelectionFromHiddenSyntaxMarker(), 0);
      },
      true
    );

    // mousemove 检测链接 hover
    dom.addEventListener("mousemove", (e: Event) => {
      const me = e as MouseEvent;
      const linkEl = this.findLinkElement(me.target as HTMLElement);
      if (linkEl) {
        const href = this.getLinkHref(linkEl);
        if (href) {
          this.showLinkTooltip(linkEl, href);
          return;
        }
      }
      if (this.linkTooltipCurrentLink) {
        this.hideLinkTooltipDelayed();
      }
    });

    // 鼠标离开编辑器时隐藏
    dom.addEventListener("mouseleave", () => {
      this.hideLinkTooltipDelayed();
    });

    // 滚动时隐藏
    const scrollParent = dom.closest(".scrollView") || container;
    if (scrollParent) {
      scrollParent.addEventListener("scroll", () => this.hideLinkTooltipImmediate(), {
        passive: true,
      });
    }

    if (!this.selectionCorrectionHandler) {
      this.selectionCorrectionHandler = () => {
        if (!this.view.hasFocus()) return;
        this.correctSelectionFromHiddenSyntaxMarker();
      };
      document.addEventListener("selectionchange", this.selectionCorrectionHandler);
    }
  }

  private recordMouseupSelectionSnapshot(): void {
    const { selection } = this.view.state;
    if (!selection.empty) return;
    if (this.isPositionInsideSyntaxMarker(selection.head)) return;
    this.recentMouseupSelectionHead = selection.head;
    this.recentMouseupAt = Date.now();
  }

  private isPositionInsideSyntaxMarker(pos: number): boolean {
    const syntaxRegions = findSyntaxMarkerRegions(this.view.state.doc);
    return syntaxRegions.some((region) => pos >= region.from && pos <= region.to);
  }

  private correctSelectionFromHiddenSyntaxMarker(): void {
    if (this.suppressSelectionCorrection) return;

    const nativeSelection = window.getSelection();
    if (!nativeSelection?.isCollapsed) return;

    const anchorNode = nativeSelection.anchorNode;
    const now = Date.now();
    const recentHead = this.recentMouseupSelectionHead;
    if (recentHead === null || now - this.recentMouseupAt > 250) return;
    if (this.isPositionInsideSyntaxMarker(recentHead)) return;

    let nativePos: number | null = null;
    try {
      if (anchorNode) {
        nativePos = this.view.posAtDOM(anchorNode, nativeSelection.anchorOffset);
      }
    } catch {
      nativePos = null;
    }

    const { selection } = this.view.state;
    const anchorText = anchorNode?.textContent ?? "";
    const nativeLooksLikeSyntaxMarker =
      (nativePos !== null && this.isPositionInsideSyntaxMarker(nativePos)) ||
      (anchorText === "`" && this.isPositionInsideSyntaxMarker(selection.head));

    if (!nativeLooksLikeSyntaxMarker) return;
    if (selection.head === recentHead) return;

    this.suppressSelectionCorrection = true;
    try {
      this.view.dispatch(
        this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc, recentHead))
      );
      this.view.focus();
    } finally {
      requestAnimationFrame(() => {
        this.suppressSelectionCorrection = false;
      });
    }
  }

  private showLinkTooltip(linkEl: HTMLAnchorElement, href: string): void {
    if (this.linkTooltipHideTimer) {
      clearTimeout(this.linkTooltipHideTimer);
      this.linkTooltipHideTimer = null;
    }
    // 同一个链接不重复更新
    if (this.linkTooltipCurrentLink === linkEl && this.linkTooltip?.style.display === "block") {
      return;
    }

    const container = this.view.dom.parentElement || this.view.dom;

    if (!this.linkTooltip) {
      this.linkTooltip = document.createElement("div");
      this.linkTooltip.className = "livemd-link-tooltip";
      container.appendChild(this.linkTooltip);
    }

    const tip = this.linkTooltip;
    const displayHref = href.length > 60 ? href.slice(0, 57) + "..." : href;
    tip.textContent = `${displayHref}  ${LivemdEditor.MOD_KEY}+左击访问`;
    tip.style.display = "block";

    const linkRect = linkEl.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    let left = linkRect.left - containerRect.left;
    const top = linkRect.bottom - containerRect.top + 4;
    tip.style.top = `${top}px`;
    tip.style.left = `${left}px`;

    // 下一帧修正右侧溢出
    requestAnimationFrame(() => {
      if (!this.linkTooltip) return;
      const tipRect = this.linkTooltip.getBoundingClientRect();
      const cr = container.getBoundingClientRect();
      if (tipRect.right > cr.right - 8) {
        left = cr.right - cr.left - tipRect.width - 8;
        this.linkTooltip.style.left = `${Math.max(0, left)}px`;
      }
    });

    this.linkTooltipCurrentLink = linkEl;
  }

  private hideLinkTooltipDelayed(): void {
    if (this.linkTooltipHideTimer) clearTimeout(this.linkTooltipHideTimer);
    this.linkTooltipHideTimer = setTimeout(() => {
      if (this.linkTooltip) this.linkTooltip.style.display = "none";
      this.linkTooltipCurrentLink = null;
      this.linkTooltipHideTimer = null;
    }, 150);
  }

  private hideLinkTooltipImmediate(): void {
    if (this.linkTooltipHideTimer) {
      clearTimeout(this.linkTooltipHideTimer);
      this.linkTooltipHideTimer = null;
    }
    if (this.linkTooltip) this.linkTooltip.style.display = "none";
    this.linkTooltipCurrentLink = null;
  }

  /**
   * 处理右键菜单
   */
  private handleContextMenu(view: EditorView, event: MouseEvent): boolean {
    // 检查是否在代码块内（代码块有自己的右键菜单）
    const target = event.target as HTMLElement;
    if (
      target.closest(".livemd-code-block-editor") ||
      target.closest(".livemd-code-block-header")
    ) {
      return false; // 让代码块处理
    }

    event.preventDefault();
    this.showContextMenu(event);
    return true;
  }

  /**
   * 检测坐标位置是否在表格内
   */
  private isInsideTable(e: MouseEvent): boolean {
    const coords = { left: e.clientX, top: e.clientY };
    const pos = this.view.posAtCoords(coords);
    if (!pos) return false;
    const $pos = this.view.state.doc.resolve(pos.pos);
    for (let depth = $pos.depth; depth > 0; depth--) {
      if ($pos.node(depth).type.name === "table") return true;
    }
    return false;
  }

  /**
   * 将选区同步到右键点击位置
   */
  private syncSelectionToMouseEvent(e: MouseEvent): void {
    const pos = this.view.posAtCoords({ left: e.clientX, top: e.clientY });
    if (!pos) return;
    const tr = this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc, pos.pos));
    this.view.dispatch(tr);
  }

  /** 复制时保留当前表格选区的纯文本规则，并同时写入富文本。 */
  private handleCopy(view: EditorView, event: ClipboardEvent): boolean {
    if (
      this.isClipboardEventFromCodeBlock(view, event) ||
      this.isClipboardEventFromHtmlBlockEditor(view, event) ||
      view.state.selection.empty
    )
      return false;

    const plain = this.serializeSelectionForClipboard();
    return this.writeNativeClipboard(view, event, plain, false);
  }

  /** 剪切只在双格式载荷写入成功后修改文档。 */
  private handleCut(view: EditorView, event: ClipboardEvent): boolean {
    if (
      this.isClipboardEventFromCodeBlock(view, event) ||
      this.isClipboardEventFromHtmlBlockEditor(view, event) ||
      !view.editable ||
      view.state.selection.empty
    ) {
      return false;
    }

    const plain = this.serializeSelectionForClipboard();
    return this.writeNativeClipboard(view, event, plain, true);
  }

  private writeNativeClipboard(
    view: EditorView,
    event: ClipboardEvent,
    plain: string,
    cut: boolean
  ): boolean {
    const payload = this.createRichClipboardPayload(view, plain);
    const result = writeClipboardEvent(event, payload);
    if (cut && !canDeleteAfterClipboardWrite(payload, result)) {
      event.preventDefault();
      return true;
    }
    if (result.status === "failed") return false;

    if (cut) {
      view.dispatch(view.state.tr.deleteSelection().scrollIntoView().setMeta("uiEvent", "cut"));
    }
    return true;
  }

  private isSelectionInsideNodeType(view: EditorView, typeName: string): boolean {
    const { from, to } = view.state.selection;
    let selectionInsideNode = false;
    view.state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type.name === typeName && from >= pos && to <= pos + node.nodeSize) {
        selectionInsideNode = true;
        return false;
      }
      return !selectionInsideNode;
    });
    return selectionInsideNode;
  }

  private isClipboardEventFromCodeBlock(view: EditorView, event: ClipboardEvent): boolean {
    const target = event.target as Element | null;
    return (
      !!target?.closest?.(".livemd-code-block") &&
      this.isSelectionInsideNodeType(view, "code_block")
    );
  }

  private isClipboardEventFromHtmlBlockEditor(view: EditorView, event: ClipboardEvent): boolean {
    const target = event.target as Element | null;
    return (
      !!target?.closest?.(".livemd-html-block-editor") &&
      this.isSelectionInsideNodeType(view, "html_block")
    );
  }

  private getClipboardImageMode(): ImagePasteMethod {
    return this.config.pasteConfig?.getImagePasteMethod?.() ?? getImagePasteMethod();
  }

  private buildClipboardPayloadForDom(
    dom: HTMLElement,
    plain: string,
    sourceView: boolean,
    imageMode?: ImagePasteMethod
  ): ClipboardPayload {
    return buildClipboardPayload(plain, dom, {
      sourceView,
      imageMode: imageMode ?? (sourceView ? undefined : this.getClipboardImageMode()),
      ...getClipboardFontFamilies(
        this.view.dom,
        this.view.dom.querySelector<HTMLElement>(".cm-content") ?? undefined
      ),
    });
  }

  private createRichClipboardPayload(view: EditorView, plain: string): ClipboardPayload {
    const sourceView = this.isSourceViewEnabled();
    const imageMode = sourceView ? undefined : this.getClipboardImageMode();
    try {
      const renderedRoot =
        sourceView || !shouldUseRenderedClipboardDom(view)
          ? null
          : getRenderedSelectionRoot(view, imageMode);
      const dom = renderedRoot ?? view.serializeForClipboard(view.state.selection.content()).dom;
      return this.buildClipboardPayloadForDom(dom, plain, sourceView, imageMode);
    } catch (error) {
      console.error("生成富文本剪贴板失败", error);
      return { plain, html: "", richRequired: !sourceView };
    }
  }

  private createCurrentTableClipboardPayload(): ClipboardPayload | null {
    const tableInfo = this.getTableAtPosition(this.view.state.selection.from);
    if (!tableInfo) return null;

    const doc = this.schema.topNodeType.create(null, tableInfo.node);
    const plain = serializeMarkdown(doc).trimEnd();
    try {
      const sourceView = this.isSourceViewEnabled();
      const imageMode = sourceView ? undefined : this.getClipboardImageMode();
      const renderedRoot = sourceView
        ? null
        : getRenderedNodeRoot(this.view, tableInfo.pos, imageMode);
      const dom = renderedRoot ?? this.view.serializeForClipboard(new Slice(doc.content, 0, 0)).dom;
      return this.buildClipboardPayloadForDom(dom, plain, sourceView, imageMode);
    } catch (error) {
      console.error("生成表格剪贴板失败", error);
      return { plain, html: "", richRequired: true };
    }
  }

  /**
   * 创建右键菜单分隔线
   */
  private createContextMenuSeparator(): HTMLElement {
    const sep = document.createElement("div");
    sep.className = "livemd-context-menu-separator";
    return sep;
  }

  /**
   * 创建带子菜单的菜单项
   */
  private createContextMenuItemWithSubmenu(
    label: string,
    submenuBuilder: (container: HTMLElement) => void,
    disabled = false
  ): HTMLElement {
    const item = document.createElement("div");
    item.className = "livemd-context-menu-item has-submenu";
    item.textContent = label;

    // 只读等场景下整项置灰，且不构建子菜单
    if (disabled) {
      item.classList.add("disabled");
      return item;
    }

    const submenu = document.createElement("div");
    submenu.className = "livemd-context-menu-submenu";
    submenuBuilder(submenu);
    item.appendChild(submenu);

    let hideTimer: ReturnType<typeof setTimeout> | null = null;

    const showSubmenu = () => {
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
      submenu.classList.add("visible");
      // 动态定位：先显示以获取尺寸，再调整
      requestAnimationFrame(() => {
        const itemRect = item.getBoundingClientRect();
        const subRect = submenu.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        // 水平：优先右侧，溢出则左侧
        let left = itemRect.right;
        if (left + subRect.width > vw - 8) {
          left = itemRect.left - subRect.width;
        }
        if (left < 8) left = 8;

        // 垂直：与菜单项顶部对齐，溢出则上移
        let top = itemRect.top - 4;
        if (top + subRect.height > vh - 8) {
          top = vh - subRect.height - 8;
        }
        if (top < 8) top = 8;

        submenu.style.left = `${left}px`;
        submenu.style.top = `${top}px`;
      });
    };

    const hideSubmenu = () => {
      hideTimer = setTimeout(() => {
        submenu.classList.remove("visible");
      }, 150);
    };

    item.addEventListener("mouseenter", showSubmenu);
    item.addEventListener("mouseleave", hideSubmenu);
    submenu.addEventListener("mouseenter", () => {
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
    });
    submenu.addEventListener("mouseleave", hideSubmenu);

    return item;
  }

  /**
   * 创建表格网格选择器
   */
  private buildTableGridPicker(container: HTMLElement): void {
    const picker = document.createElement("div");
    picker.className = "livemd-table-grid-picker";

    const gridContainer = document.createElement("div");
    gridContainer.className = "grid-container";

    const label = document.createElement("div");
    label.className = "grid-label";
    label.textContent = "";

    const maxRows = 8;
    const maxCols = 8;
    const cells: HTMLElement[][] = [];

    for (let r = 0; r < maxRows; r++) {
      cells[r] = [];
      for (let c = 0; c < maxCols; c++) {
        const cell = document.createElement("div");
        cell.className = "grid-cell";
        cell.dataset.row = String(r);
        cell.dataset.col = String(c);
        gridContainer.appendChild(cell);
        cells[r][c] = cell;
      }
    }

    const updateHighlight = (hoverRow: number, hoverCol: number) => {
      for (let r = 0; r < maxRows; r++) {
        for (let c = 0; c < maxCols; c++) {
          cells[r][c].classList.toggle("active", r <= hoverRow && c <= hoverCol);
        }
      }
      label.textContent = `${hoverRow + 1} × ${hoverCol + 1} 表格`;
    };

    gridContainer.addEventListener("mouseover", (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains("grid-cell")) {
        const r = parseInt(target.dataset.row!, 10);
        const c = parseInt(target.dataset.col!, 10);
        updateHighlight(r, c);
      }
    });

    gridContainer.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains("grid-cell")) {
        const rows = parseInt(target.dataset.row!, 10) + 1;
        const cols = parseInt(target.dataset.col!, 10) + 1;
        this.view.focus();
        insertTable(rows, cols)(this.view.state, this.view.dispatch.bind(this.view));
        this.hideContextMenu();
      }
    });

    picker.appendChild(gridContainer);
    picker.appendChild(label);
    container.appendChild(picker);
  }

  /**
   * 显示右键菜单
   */
  private async showContextMenu(e: MouseEvent): Promise<void> {
    // 移除已存在的右键菜单
    this.hideContextMenu();

    const menu = document.createElement("div");
    menu.className = "livemd-context-menu";

    // 检查是否有选区
    const { selection } = this.view.state;
    const hasSelection = !selection.empty;

    // 异步操作后编辑器可能已被销毁（如 HMR），直接返回
    if (this._destroyed) return;

    // 复制
    const copyItem = this.createContextMenuItem("复制", !hasSelection, async () => {
      const plain = this.serializeSelectionForClipboard();
      const payload = this.createRichClipboardPayload(this.view, plain);
      await writeClipboardPayload(payload);
      this.hideContextMenu();
    });
    menu.appendChild(copyItem);

    // 复制纯文本：只写 text/plain，去掉 Markdown 语法标记（如 "**加粗**" → "加粗"）
    const copyPlainItem = this.createContextMenuItem("复制纯文本", !hasSelection, async () => {
      const plainText = this.getSelectionPlainTextForCopy();
      console.debug("[LivemdEditor] 复制纯文本，长度:", plainText.length);
      await writeClipboardPayload({ plain: plainText, html: "", richRequired: false });
      this.hideContextMenu();
    });
    menu.appendChild(copyPlainItem);

    // 剪切
    const cutItem = this.createContextMenuItem(
      "剪切",
      !hasSelection || !this.view.editable,
      async () => {
        if (!this.view.editable) return;

        const state = this.view.state;
        const plain = this.serializeSelectionForClipboard();
        const payload = this.createRichClipboardPayload(this.view, plain);
        const result = await writeClipboardPayload(payload);
        const canDelete = this.view.editable && canDeleteAfterClipboardWrite(payload, result);
        const selection = this.view.state.selection;
        if (canDelete && this.view.state.doc === state.doc && selection.eq(state.selection)) {
          this.view.dispatch(
            this.view.state.tr.deleteSelection().scrollIntoView().setMeta("uiEvent", "cut")
          );
        }
        this.hideContextMenu();
      }
    );
    menu.appendChild(cutItem);

    // 粘贴 - 点击时再读取剪贴板，避免打开右键菜单就触发权限弹窗
    const pasteItem = this.createContextMenuItem("粘贴", !this.view.editable, async () => {
      this.hideContextMenu();
      this.view.focus();
      await this.handlePasteFromClipboard();
    });
    menu.appendChild(pasteItem);

    // 只粘贴文本：只读取剪贴板纯文本，去掉其中的 Markdown 格式，不识别图片
    const pastePlainItem = this.createContextMenuItem(
      "只粘贴文本",
      !this.view.editable,
      async () => {
        this.hideContextMenu();
        this.view.focus();
        await this.handlePastePlainTextFromClipboard();
      }
    );
    menu.appendChild(pastePlainItem);

    // 批注：选区非空且不在代码块 / HTML 块内时可用（源码模式右键走 CodeMirror 菜单，天然无此项）
    const canAnnotate =
      hasSelection &&
      !this.isSelectionInsideNodeType(this.view, "code_block") &&
      !this.isSelectionInsideNodeType(this.view, "html_block");
    menu.appendChild(this.createContextMenuSeparator());
    menu.appendChild(
      this.createContextMenuItem("批注", !canAnnotate, () => {
        this.requestCreateAnnotation();
        this.hideContextMenu();
      })
    );

    // 检测是否在表格内
    const inTable = this.isInsideTable(e);

    if (inTable) {
      this.syncSelectionToMouseEvent(e);

      // 表格内右键 — 追加表格操作项
      menu.appendChild(this.createContextMenuSeparator());

      menu.appendChild(
        this.createContextMenuItem("复制表格", false, async () => {
          const payload = this.createCurrentTableClipboardPayload();
          if (payload) await writeClipboardPayload(payload);
          this.hideContextMenu();
        })
      );

      menu.appendChild(this.createContextMenuSeparator());

      menu.appendChild(
        this.createContextMenuItem("向上插入行", !this.view.editable, () => {
          this.view.focus();
          addRowBefore(this.view.state, this.view.dispatch.bind(this.view));
          this.hideContextMenu();
        })
      );
      menu.appendChild(
        this.createContextMenuItem("向下插入行", !this.view.editable, () => {
          this.view.focus();
          addRowAfter(this.view.state, this.view.dispatch.bind(this.view));
          this.hideContextMenu();
        })
      );
      menu.appendChild(
        this.createContextMenuItem("在末尾添加行", !this.view.editable, () => {
          this.view.focus();
          addRowAtEnd(this.view.state, this.view.dispatch.bind(this.view));
          this.hideContextMenu();
        })
      );

      menu.appendChild(this.createContextMenuSeparator());

      menu.appendChild(
        this.createContextMenuItem("向左插入列", !this.view.editable, () => {
          this.view.focus();
          addColumnBefore(this.view.state, this.view.dispatch.bind(this.view));
          this.hideContextMenu();
        })
      );
      menu.appendChild(
        this.createContextMenuItem("向右插入列", !this.view.editable, () => {
          this.view.focus();
          addColumnAfter(this.view.state, this.view.dispatch.bind(this.view));
          this.hideContextMenu();
        })
      );
      menu.appendChild(
        this.createContextMenuItem("在末尾添加列", !this.view.editable, () => {
          this.view.focus();
          addColumnAtEnd(this.view.state, this.view.dispatch.bind(this.view));
          this.hideContextMenu();
        })
      );

      menu.appendChild(this.createContextMenuSeparator());

      menu.appendChild(
        this.createContextMenuItem("删除当前行", !this.view.editable, () => {
          this.view.focus();
          deleteRow(this.view.state, this.view.dispatch.bind(this.view));
          this.hideContextMenu();
        })
      );
      menu.appendChild(
        this.createContextMenuItem("删除当前列", !this.view.editable, () => {
          this.view.focus();
          deleteColumn(this.view.state, this.view.dispatch.bind(this.view));
          this.hideContextMenu();
        })
      );
    } else {
      // 非表格区域 — 追加"插入"子菜单和"插入表格"
      menu.appendChild(this.createContextMenuSeparator());
      // 只读时"插入"与"插入表格"整项置灰
      const insertDisabled = !this.view.editable;
      menu.appendChild(
        this.createContextMenuItemWithSubmenu(
          "插入",
          (submenu) => {
            this.buildInsertSubmenu(submenu);
          },
          insertDisabled
        )
      );
      menu.appendChild(
        this.createContextMenuItemWithSubmenu(
          "插入表格",
          (submenu) => {
            this.buildTableGridPicker(submenu);
          },
          insertDisabled
        )
      );
    }

    // 定位菜单
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;

    document.body.appendChild(menu);
    this.contextMenu = menu;

    // 调整位置，确保菜单在视口内
    const menuRect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    if (menuRect.right > viewportWidth) {
      menu.style.left = `${viewportWidth - menuRect.width - 8}px`;
    }
    if (menuRect.bottom > viewportHeight) {
      menu.style.top = `${viewportHeight - menuRect.height - 8}px`;
    }

    // 点击外部关闭
    const closeHandler = (event: MouseEvent) => {
      if (!(event.target instanceof globalThis.Node) || !menu.contains(event.target)) {
        this.hideContextMenu();
        document.removeEventListener("click", closeHandler);
      }
    };
    setTimeout(() => {
      document.addEventListener("click", closeHandler);
    }, 0);
  }

  /**
   * 创建右键菜单项
   */
  private createContextMenuItem(
    label: string,
    disabled: boolean,
    onClick: () => void | Promise<void>
  ): HTMLElement {
    const item = document.createElement("div");
    item.className = "livemd-context-menu-item";
    if (disabled) {
      item.classList.add("disabled");
    }
    item.textContent = label;

    if (!disabled) {
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        void onClick();
      });
    }

    return item;
  }

  /**
   * 获取某个动作当前绑定的快捷键（已格式化为显示文本）
   */
  private getShortcutDisplay(actionId: ShortcutActionId): string {
    const customMap = this.getCachedCustomKeyMap();
    const def = DEFAULT_SHORTCUTS.find((s) => s.id === actionId);
    if (!def) return "";
    const customKey = customMap[actionId];
    const key = customKey === undefined ? def.defaultKey : (customKey ?? "");
    if (!key) return "";
    return formatShortcutDisplay(key);
  }

  /**
   * 创建带快捷键提示的菜单项
   */
  private createContextMenuItemWithShortcut(
    label: string,
    shortcutActionId: ShortcutActionId | null,
    disabled: boolean,
    onClick: () => void
  ): HTMLElement {
    const item = document.createElement("div");
    item.className = "livemd-context-menu-item";
    if (disabled) item.classList.add("disabled");

    const labelSpan = document.createElement("span");
    labelSpan.textContent = label;
    item.appendChild(labelSpan);

    if (shortcutActionId) {
      const shortcut = this.getShortcutDisplay(shortcutActionId);
      if (shortcut) {
        const shortcutSpan = document.createElement("span");
        shortcutSpan.className = "livemd-context-menu-shortcut";
        shortcutSpan.textContent = shortcut;
        item.appendChild(shortcutSpan);
      }
    }

    if (!disabled) {
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        void onClick();
      });
    }

    return item;
  }

  /**
   * 构建"插入"子菜单内容
   * 使用与快捷键相同的增强命令（buildActionCommandMap）
   */
  private buildInsertSubmenu(container: HTMLElement): void {
    const commandMap = buildActionCommandMap(this.schema);
    const dispatch = this.view.dispatch.bind(this.view);
    const execAndClose = (actionId: ShortcutActionId) => {
      this.view.focus();
      const cmd = commandMap[actionId];
      if (cmd) cmd(this.view.state, dispatch);
      this.hideContextMenu();
    };

    type MenuItem = { label: string; id: ShortcutActionId };

    const inlineItems: MenuItem[] = [
      { label: "粗体", id: "toggleStrong" },
      { label: "斜体", id: "toggleEmphasis" },
      { label: "行内代码", id: "toggleCodeInline" },
      { label: "删除线", id: "toggleStrikethrough" },
      { label: "高亮", id: "toggleHighlight" },
      { label: "下划线", id: "toggleUnderline" },
      { label: "上标", id: "toggleSuperscript" },
      { label: "下标", id: "toggleSubscript" },
    ];

    for (const item of inlineItems) {
      container.appendChild(
        this.createContextMenuItemWithShortcut(item.label, item.id, false, () =>
          execAndClose(item.id)
        )
      );
    }

    container.appendChild(this.createContextMenuSeparator());

    const blockItems: MenuItem[] = [
      { label: "一级标题", id: "setHeading1" },
      { label: "二级标题", id: "setHeading2" },
      { label: "三级标题", id: "setHeading3" },
      { label: "段落", id: "setParagraph" },
      { label: "代码块", id: "setCodeBlock" },
      { label: "引用", id: "wrapInBlockquote" },
      { label: "无序列表", id: "wrapInBulletList" },
      { label: "有序列表", id: "wrapInOrderedList" },
    ];

    for (const item of blockItems) {
      container.appendChild(
        this.createContextMenuItemWithShortcut(item.label, item.id, false, () =>
          execAndClose(item.id)
        )
      );
    }

    container.appendChild(this.createContextMenuSeparator());

    const insertItems: MenuItem[] = [
      { label: "分割线", id: "insertHorizontalRule" },
      { label: "数学公式", id: "insertMathBlock" },
    ];

    for (const item of insertItems) {
      container.appendChild(
        this.createContextMenuItemWithShortcut(item.label, item.id, false, () =>
          execAndClose(item.id)
        )
      );
    }

    // 插入思维导图：```mindmap 代码块 + 模板内容（中心主题 + 分支），插入后可点「编辑思维导图」图形化编辑
    container.appendChild(
      this.createContextMenuItem("思维导图", false, () => {
        this.hideContextMenu();
        this.insertMindmapBlock();
      })
    );

    // 插入图片（通过文件选择器）
    container.appendChild(
      this.createContextMenuItem("图片", false, () => {
        // 保存当前光标位置（菜单关闭后选区可能丢失）
        const savedPos = this.view.state.selection.$from.pos;
        this.hideContextMenu();
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.onchange = () => {
          const file = input.files?.[0];
          if (file) {
            // 恢复焦点和光标位置
            this.view.focus();
            const tr = this.view.state.tr.setSelection(
              TextSelection.create(this.view.state.doc, savedPos)
            );
            this.view.dispatch(tr);
            this.insertImageFromFile(file);
          }
        };
        input.click();
      })
    );

    // 插入链接（由渲染层弹出链接对话框）
    container.appendChild(
      this.createContextMenuItem("链接", false, () => {
        this.hideContextMenu();
        this.view.focus();
        this.view.dom.dispatchEvent(new CustomEvent("livemd:insert-link", { bubbles: true }));
      })
    );
  }

  /** 创建搜索面板 DOM */
  private createSearchPanel(container: HTMLElement): void {
    // SVG 图标工厂
    const svgIcon = (path: string, vb = "0 0 16 16") => {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", vb);
      svg.innerHTML = path;
      return svg;
    };

    // 创建按钮的辅助函数（阻止 mousedown 防止编辑器失焦）
    const makeBtn = (cls: string, title: string, icon: SVGSVGElement, onClick: () => void) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = cls;
      btn.title = title;
      btn.appendChild(icon);
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", onClick);
      return btn;
    };

    // 外层 wrapper（sticky 定位）
    const wrapper = document.createElement("div");
    wrapper.className = "livemd-search-wrapper";

    const panel = document.createElement("div");
    panel.className = "livemd-search-panel";

    // ---- 搜索行 ----
    const searchRow = document.createElement("div");
    searchRow.className = "livemd-search-row";

    // 展开/收起替换 ▶/▼
    const toggleIcon = svgIcon('<path d="M6 4l4 4-4 4z"/>');
    const toggleBtn = makeBtn("toggle-replace", "切换替换", toggleIcon, () =>
      this.toggleReplaceRow()
    );

    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.className = "search-input";
    searchInput.placeholder = "搜索";
    searchInput.addEventListener("input", () => this.onSearchInput());
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        findPrev(this.view);
        this.updateMatchCount();
      } else if (e.key === "Enter") {
        e.preventDefault();
        findNext(this.view);
        this.updateMatchCount();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.closeSearch();
      }
    });

    // Aa 区分大小写
    const caseIcon = svgIcon(
      '<text x="2" y="12" font-size="11" font-weight="600" font-family="sans-serif" fill="currentColor">Aa</text>'
    );
    const caseBtn = makeBtn("case-sensitive", "区分大小写", caseIcon, () => {
      this.searchCaseSensitive = !this.searchCaseSensitive;
      caseBtn.classList.toggle("active", this.searchCaseSensitive);
      this.onSearchInput();
    });

    // Ab| 全字匹配
    const wordIcon = svgIcon(
      '<text x="1" y="12" font-size="10" font-weight="600" font-family="sans-serif" fill="currentColor">Ab</text><rect x="12" y="2" width="1.5" height="12" rx="0.5" fill="currentColor"/>'
    );
    const wordBtn = makeBtn("whole-word", "全字匹配", wordIcon, () => {
      this.searchWholeWord = !this.searchWholeWord;
      wordBtn.classList.toggle("active", this.searchWholeWord);
      this.onSearchInput();
    });

    // .* 正则
    const regexIcon = svgIcon(
      '<text x="1" y="12" font-size="12" font-weight="600" font-family="monospace" fill="currentColor">.*</text>'
    );
    const regexBtn = makeBtn("use-regex", "正则表达式", regexIcon, () => {
      this.searchUseRegex = !this.searchUseRegex;
      regexBtn.classList.toggle("active", this.searchUseRegex);
      this.onSearchInput();
    });

    const matchCount = document.createElement("span");
    matchCount.className = "match-count";

    // ↑ 上一个
    const prevIcon = svgIcon('<path d="M8 4L3 9h10z"/>');
    const prevBtn = makeBtn("prev-match", "上一个匹配 (Shift+Enter)", prevIcon, () => {
      findPrev(this.view);
      this.updateMatchCount();
    });

    // ↓ 下一个
    const nextIcon = svgIcon('<path d="M8 12L3 7h10z"/>');
    const nextBtn = makeBtn("next-match", "下一个匹配 (Enter)", nextIcon, () => {
      findNext(this.view);
      this.updateMatchCount();
    });

    // 选区内搜索
    const selIcon = svgIcon('<path d="M2 3h12v2H2zM4 7h8v2H4zM2 11h12v2H2z"/>');
    const selBtn = makeBtn("search-in-selection", "在选区内搜索", selIcon, () => {
      this.searchInSelection = !this.searchInSelection;
      selBtn.classList.toggle("active", this.searchInSelection);
      if (this.searchInSelection) {
        const { from, to } = this.view.state.selection;
        this.searchSelectionRange = from !== to ? { from, to } : null;
      } else {
        this.searchSelectionRange = null;
      }
      this.onSearchInput();
    });

    // × 关闭
    const closeIcon = svgIcon(
      '<path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" fill="none"/>'
    );
    const closeBtn = makeBtn("close-search", "关闭 (Escape)", closeIcon, () => this.closeSearch());

    searchRow.append(
      toggleBtn,
      searchInput,
      caseBtn,
      wordBtn,
      regexBtn,
      matchCount,
      prevBtn,
      nextBtn,
      selBtn,
      closeBtn
    );

    // ---- 替换行 ----
    const replaceRow = document.createElement("div");
    replaceRow.className = "livemd-replace-row hidden";

    const replaceInput = document.createElement("input");
    replaceInput.type = "text";
    replaceInput.className = "replace-input";
    replaceInput.placeholder = "替换";
    replaceInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        replaceMatch(this.view, replaceInput.value);
        this.onSearchInput();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.closeSearch();
      }
    });

    const replaceOneBtn = document.createElement("button");
    replaceOneBtn.type = "button";
    replaceOneBtn.className = "replace-btn";
    replaceOneBtn.textContent = "替换";
    replaceOneBtn.addEventListener("mousedown", (e) => e.preventDefault());
    replaceOneBtn.addEventListener("click", () => {
      replaceMatch(this.view, replaceInput.value);
      this.onSearchInput();
    });

    const replaceAllBtn = document.createElement("button");
    replaceAllBtn.type = "button";
    replaceAllBtn.className = "replace-btn";
    replaceAllBtn.textContent = "全部替换";
    replaceAllBtn.addEventListener("mousedown", (e) => e.preventDefault());
    replaceAllBtn.addEventListener("click", () => {
      replaceAll(this.view, replaceInput.value);
      this.onSearchInput();
    });

    replaceRow.append(replaceInput, replaceOneBtn, replaceAllBtn);

    panel.append(searchRow, replaceRow);
    wrapper.appendChild(panel);

    // 挂载到最近的滚动容器（overflow-y: auto/scroll 的祖先）
    // 这样 sticky 定位才能正确工作
    const scrollParent = this.findScrollParent(container) || container;
    scrollParent.insertBefore(wrapper, scrollParent.firstChild);

    this.searchWrapper = wrapper;
    this.searchPanel = panel;
    this.searchInput = searchInput;
    this.replaceRow = replaceRow;
    this.matchCountSpan = matchCount;

    // 在容器上监听快捷键，确保只读模式下也能打开搜索
    // 设置 tabindex 使容器在只读模式下仍可聚焦接收键盘事件
    if (!container.hasAttribute("tabindex")) {
      container.setAttribute("tabindex", "-1");
    }
    this.containerKeydownHandler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "f") {
        e.preventDefault();
        this.openSearch(false);
      } else if (mod && e.key === "h") {
        e.preventDefault();
        this.openSearch(true);
      }
    };
    container.addEventListener("keydown", this.containerKeydownHandler);
  }

  /** 打开搜索面板 */
  openSearch(showReplace: boolean, initialQuery?: string): void {
    if (!this.searchWrapper || !this.searchInput) return;

    const isReadonly = this.config.readonly;

    this.searchWrapper.classList.add("visible");

    // 只读模式下隐藏替换行和展开按钮
    const toggleBtn = this.searchPanel?.querySelector(".toggle-replace") as HTMLElement | null;
    if (isReadonly) {
      this.replaceRow?.classList.add("hidden");
      if (toggleBtn) toggleBtn.style.visibility = "hidden";
    } else {
      if (toggleBtn) toggleBtn.style.visibility = "";
      if (showReplace) {
        this.replaceRow?.classList.remove("hidden");
        const toggleSvg = toggleBtn?.querySelector("svg");
        if (toggleSvg) toggleSvg.innerHTML = '<path d="M4 6l4 4 4-4z"/>';
      }
    }

    // 优先使用外部传入的关键词（工作区搜索跳转），否则填入选中文本
    const { from, to } = this.view.state.selection;
    if (initialQuery && initialQuery.length > 0) {
      this.searchInput.value = initialQuery;
    } else if (from !== to) {
      const selectedText = this.view.state.doc.textBetween(from, to, "\n");
      if (selectedText && !selectedText.includes("\n")) {
        this.searchInput.value = selectedText;
      }
    }

    this.searchInput.focus();
    this.searchInput.select();
    this.onSearchInput();
  }

  /** 关闭搜索面板 */
  closeSearch(): void {
    if (!this.searchWrapper) return;
    this.searchWrapper.classList.remove("visible");
    clearSearch(this.view);
    this.view.focus();
  }

  /** 切换替换行 */
  private toggleReplaceRow(): void {
    if (!this.replaceRow || !this.searchPanel) return;
    const hidden = this.replaceRow.classList.toggle("hidden");
    const toggleSvg = this.searchPanel.querySelector(".toggle-replace svg");
    if (toggleSvg) {
      toggleSvg.innerHTML = hidden ? '<path d="M6 4l4 4-4 4z"/>' : '<path d="M4 6l4 4 4-4z"/>';
    }
  }

  /** 搜索输入变化 */
  private onSearchInput(): void {
    if (!this.searchInput) return;
    const query = this.searchInput.value;
    const options: SearchOptions = {
      caseSensitive: this.searchCaseSensitive,
      wholeWord: this.searchWholeWord,
      useRegex: this.searchUseRegex,
      searchInSelection: this.searchInSelection,
      selectionRange: this.searchSelectionRange,
    };
    updateSearch(this.view, query, options);
    this.updateMatchCount();
  }

  /** 更新匹配计数显示 */
  private updateMatchCount(): void {
    if (!this.matchCountSpan) return;
    const state = searchPluginKey.getState(this.view.state);
    if (!state || state.matches.length === 0) {
      this.matchCountSpan.textContent = this.searchInput?.value ? "无结果" : "";
    } else {
      this.matchCountSpan.textContent = `${state.currentIndex + 1}/${state.matches.length}`;
    }
  }

  /** 查找最近的可滚动祖先元素 */
  private findScrollParent(el: HTMLElement): HTMLElement | null {
    let parent = el.parentElement;
    while (parent) {
      const style = getComputedStyle(parent);
      if (style.overflowY === "auto" || style.overflowY === "scroll") {
        return parent;
      }
      parent = parent.parentElement;
    }
    return null;
  }

  private hideContextMenu(): void {
    if (this.contextMenu) {
      this.contextMenu.remove();
      this.contextMenu = null;
    }
    // 移除其他可能存在的右键菜单
    document.querySelectorAll(".livemd-context-menu").forEach((el) => el.remove());
  }

  /**
   * 从剪贴板粘贴内容
   */
  private async handlePasteFromClipboard(): Promise<void> {
    try {
      // 尝试读取剪贴板内容
      const items = await navigator.clipboard.read();

      for (const item of items) {
        // 检查是否有图片
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (imageType) {
          const blob = await item.getType(imageType);
          const file = new File([blob], "pasted-image.png", { type: imageType });
          await this.insertImageFromFile(file);
          return;
        }

        // 检查是否有文本
        if (item.types.includes("text/plain")) {
          const blob = await item.getType("text/plain");
          const text = await blob.text();
          if (text) {
            this.insertPastedText(text);
          }
          return;
        }
      }
    } catch {
      // 如果 read() 失败，尝试 readText()
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          this.insertPastedText(text);
        }
      } catch {
        console.warn("无法访问剪贴板");
      }
    }
  }

  /**
   * 在当前选区插入思维导图代码块（模板内容），只读时事务会被 dispatchTransaction 拦截
   */
  insertMindmapBlock(): void {
    const codeBlockType = this.schema.nodes.code_block;
    if (!codeBlockType) return;
    const node = codeBlockType.create({ language: "mindmap" }, this.schema.text(createMindMapTemplate()));
    console.info("[LivemdEditor] 插入思维导图代码块");
    this.view.focus();
    this.view.dispatch(this.view.state.tr.replaceSelectionWith(node).scrollIntoView());
  }

  /**
   * 「复制纯文本」的内容：即时渲染模式直接遍历文档跳过语法标记；
   * 源码模式下文档即 Markdown 原文，先序列化选区再解析去格式
   */
  private getSelectionPlainTextForCopy(): string {
    const { from, to } = this.view.state.selection;
    if (this.isSourceViewEnabled()) {
      return markdownToPlainText(this.serializeSelectionForClipboard(), this.parser);
    }
    return extractPlainText(this.view.state.doc, from, to);
  }

  /**
   * 「只粘贴文本」：读取剪贴板 text/plain，去掉 Markdown 格式后按纯文本插入
   */
  private async handlePastePlainTextFromClipboard(): Promise<void> {
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch (error) {
      console.warn("[LivemdEditor] 无法读取剪贴板纯文本:", error);
      return;
    }
    if (!text || this._destroyed || !this.view.editable) return;

    const { $from } = this.view.state.selection;
    const inCode = Boolean($from.parent.type.spec.code);
    // 代码块内保持原文；其余位置若含 Markdown 语法则转为纯文本
    const plainText =
      !inCode && containsMarkdownSyntax(text)
        ? markdownToPlainText(text, this.parser)
        : text.replace(/\r\n?/g, "\n");
    console.debug("[LivemdEditor] 只粘贴文本，代码块内:", inCode, "长度:", plainText.length);
    this.insertPlainText(plainText);
  }

  /**
   * 按纯文本插入：单行直接 insertText；多行在普通段落中拆成多个段落（首尾与当前段落合并），
   * 代码块内保留换行原样插入。不经过 Markdown 解析。
   */
  private insertPlainText(text: string): void {
    const { state } = this.view;
    const { $from } = state.selection;
    const lines = text.split("\n");
    const paragraphType = this.schema.nodes.paragraph;

    if (lines.length === 1 || $from.parent.type.spec.code || !paragraphType) {
      this.view.dispatch(state.tr.insertText(text).scrollIntoView());
      return;
    }

    const paragraphs = lines.map((line) =>
      paragraphType.create(null, line ? this.schema.text(line) : undefined)
    );
    // openStart/openEnd = 1：首行并入光标前的段落、末行并入光标后的段落
    const slice = new Slice(Fragment.from(paragraphs), 1, 1);
    this.view.dispatch(state.tr.replaceSelection(slice).scrollIntoView());
  }

  private insertPastedText(text: string): void {
    if (
      insertMarkdownTableRowAfterCurrent(this.view.state, text, this.view.dispatch.bind(this.view))
    ) {
      return;
    }

    if (!this.isSourceViewEnabled() && containsMarkdownSyntax(text)) {
      const pasteSlice = parseMarkdownPasteSlice(text, this.parser);
      if (pasteSlice) {
        const tr = this.view.state.tr.replaceSelection(pasteSlice).scrollIntoView();
        this.view.dispatch(tr);
        return;
      }
    }

    const tr = this.view.state.tr.insertText(text).scrollIntoView();
    this.view.dispatch(tr);
  }

  /**
   * 从文件插入图片
   */
  /**
   * 在当前选区插入一张图片（src 已是最终 Markdown 地址）
   * 供拖入本地图片、网络图片下载、渲染层桥接调用；只读时事务会被 dispatchTransaction 拦截
   */
  insertImage(src: string, alt = ""): void {
    if (!src) return;
    const { $from } = this.view.state.selection;

    if (this.isSourceViewEnabled()) {
      const paragraph = this.schema.nodes.paragraph.create(
        { imageAttrs: { src, alt, title: "" } },
        this.schema.text(`![${alt}](${src})`)
      );
      this.view.dispatch(this.view.state.tr.insert($from.pos, paragraph));
      return;
    }

    const imageNode = this.schema.nodes.image?.createAndFill({ src, alt, title: "" });
    if (imageNode) {
      this.view.dispatch(this.view.state.tr.insert($from.pos, imageNode));
    }
  }

  private async insertImageFromFile(file: File): Promise<void> {
    // 获取图片粘贴方式
    const method: ImagePasteMethod = this.config.pasteConfig?.getImagePasteMethod?.() || "local";

    let src: string;

    try {
      switch (method) {
        case "base64":
          src = await fileToBase64(file);
          break;

        case "remote":
          if (this.config.pasteConfig?.imageUploader) {
            src = await this.config.pasteConfig.imageUploader(file);
          } else {
            console.warn("Image uploader not configured, falling back to base64");
            src = await fileToBase64(file);
          }
          break;

        case "local":
          if (this.config.pasteConfig?.localImageSaver) {
            src = await this.config.pasteConfig.localImageSaver(file);
          } else {
            // 尝试使用 Electron API
            src = await saveImageLocally(file);
          }
          break;

        default:
          src = await fileToBase64(file);
      }
    } catch (error) {
      console.error("Failed to process image:", error);
      // 出错时回退到 base64
      src = await fileToBase64(file);
    }

    // 图片地址整形（./ 前缀、URL 转义），由渲染层按设置注入
    src = this.config.pasteConfig?.formatImageSrc?.(src) || src;

    // 源码模式下：创建包含 Markdown 文本的段落
    if (this.isSourceViewEnabled()) {
      const alt = file.name;
      const markdownText = `![${alt}](${src})`;
      const paragraph = this.schema.nodes.paragraph.create(
        { imageAttrs: { src, alt, title: "" } },
        this.schema.text(markdownText)
      );
      const { $from } = this.view.state.selection;
      const tr = this.view.state.tr.insert($from.pos, paragraph);
      this.view.dispatch(tr);
      return;
    }

    // 创建图片节点
    const imageNode = this.schema.nodes.image?.createAndFill({
      src,
      alt: file.name,
      title: "",
    });

    if (imageNode) {
      const { $from } = this.view.state.selection;
      const tr = this.view.state.tr.insert($from.pos, imageNode);
      this.view.dispatch(tr);
    }
  }

  private serializeSelectionForClipboard(): string {
    const tableSelectionText = this.serializeTableSelectionForClipboard();
    if (tableSelectionText !== null) return tableSelectionText;

    return this.serializeSliceToMarkdown(this.view.state.selection.content());
  }

  private serializeTableSelectionForClipboard(): string | null {
    const { selection } = this.view.state;
    if (selection.empty) return null;

    const from = selection.from;
    const to = selection.to;
    const tableInfo = this.getCommonSelectedTable(from, to);
    if (!tableInfo) return null;

    const selectedCells: Array<{ rowIndex: number; colIndex: number; text: string }> = [];
    const tableContentStart = tableInfo.pos + 1;

    tableInfo.node.forEach((row, rowOffset, rowIndex) => {
      const rowStart = tableContentStart + rowOffset;
      let cellStart = rowStart + 1;

      row.forEach((cell, _cellOffset, colIndex) => {
        const cellEnd = cellStart + cell.nodeSize;
        if (from < cellEnd && to > cellStart) {
          selectedCells.push({
            rowIndex,
            colIndex,
            text: cell.textContent || "",
          });
        }
        cellStart = cellEnd;
      });
    });

    if (selectedCells.length === 0) return null;

    const rowIndexes = [...new Set(selectedCells.map((cell) => cell.rowIndex))].sort(
      (a, b) => a - b
    );
    const colIndexes = [...new Set(selectedCells.map((cell) => cell.colIndex))].sort(
      (a, b) => a - b
    );

    if (rowIndexes.length === 1) {
      return selectedCells
        .sort((a, b) => a.colIndex - b.colIndex)
        .map((cell) => cell.text)
        .join("\t");
    }

    if (colIndexes.length === 1) {
      return selectedCells
        .sort((a, b) => a.rowIndex - b.rowIndex)
        .map((cell) => cell.text)
        .join("\n");
    }

    const cellMap = new Map<string, string>();
    for (const cell of selectedCells) {
      cellMap.set(`${cell.rowIndex}:${cell.colIndex}`, cell.text);
    }

    const rows = rowIndexes.map((rowIndex) =>
      colIndexes.map((colIndex) => cellMap.get(`${rowIndex}:${colIndex}`) ?? "")
    );

    if (rows.length === 0 || rows[0].length === 0) return null;

    const lines = [
      `| ${rows[0].join(" | ")} |`,
      `| ${rows[0].map(() => "---").join(" | ")} |`,
      ...rows.slice(1).map((row) => `| ${row.join(" | ")} |`),
    ];
    return lines.join("\n");
  }

  private getCommonSelectedTable(from: number, to: number): { node: Node; pos: number } | null {
    const doc = this.view.state.doc;
    const startTable = this.getTableAtPosition(from);
    const endTable = this.getTableAtPosition(Math.max(from, to - 1));
    if (!startTable || !endTable) return null;
    if (startTable.pos !== endTable.pos) return null;

    let hasOutsideContent = false;
    doc.nodesBetween(from, to, (node, pos) => {
      if (hasOutsideContent) return false;
      if (pos === startTable.pos) return false;
      if (pos >= startTable.pos && pos < startTable.pos + startTable.node.nodeSize) return true;
      hasOutsideContent = true;
      return false;
    });

    return hasOutsideContent ? null : startTable;
  }

  private getTableAtPosition(pos: number): { node: Node; pos: number } | null {
    const $pos = this.view.state.doc.resolve(pos);
    for (let depth = $pos.depth; depth > 0; depth--) {
      const node = $pos.node(depth);
      if (node.type.name === "table") {
        return {
          node,
          pos: $pos.before(depth),
        };
      }
    }
    return null;
  }

  /**
   * 提取指定范围中的纯文本，忽略 Markdown 语法标记
   */
  private getPlainTextBetween(from: number, to: number): string {
    if (to <= from) return "";

    let text = "";
    this.view.state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.isBlock && pos > from && text && !text.endsWith("\n")) {
        text += "\n";
      }
      if (!node.isText) return;

      const start = Math.max(from, pos);
      const end = Math.min(to, pos + node.nodeSize);
      if (end <= start) return;
      if (node.marks.some((mark) => mark.type.name === "syntax_marker")) return;

      text += node.text?.slice(start - pos, end - pos) ?? "";
    });
    return text;
  }

  /**
   * 查找光标/选区所在的完整链接语法范围
   */
  private findLinkRange(): { from: number; to: number; href: string } | null {
    const state = this.view.state;
    const markType = state.schema.marks.link;
    if (!markType) return null;

    const { from, to, $from } = state.selection;
    let seedFrom = from;
    let seedTo = to;

    if (from === to) {
      if (!markType.isInSet($from.marks())) return null;
      let start = from;
      while (start > 0 && state.doc.rangeHasMark(start - 1, start, markType)) {
        start -= 1;
      }
      seedFrom = start;
      seedTo = from;
    } else if (!state.doc.rangeHasMark(from, to, markType)) {
      return null;
    }

    let linkFrom = seedFrom;
    let linkTo = seedTo;
    while (linkFrom > 0 && state.doc.rangeHasMark(linkFrom - 1, linkFrom, markType)) {
      linkFrom -= 1;
    }
    while (
      linkTo < state.doc.content.size &&
      state.doc.rangeHasMark(linkTo, linkTo + 1, markType)
    ) {
      linkTo += 1;
    }
    if (linkFrom === linkTo) return null;

    let href = "";
    state.doc.nodesBetween(linkFrom, linkTo, (node) => {
      if (href || !node.isText) return;
      const mark = markType.isInSet(node.marks);
      if (mark) href = String(mark.attrs.href || "");
    });

    return { from: linkFrom, to: linkTo, href };
  }

  /**
   * 将 Slice 序列化为 Markdown 文本
   */
  private serializeSliceToMarkdown(slice: Slice): string {
    const fragment = slice.content;
    if (fragment.childCount === 0) return "";

    // 检查是否全部为行内节点（段落内部分选区）
    let allInline = true;
    fragment.forEach((node) => {
      if (!node.isInline) allInline = false;
    });

    if (allInline) {
      const para = this.schema.nodes.paragraph.create(null, fragment);
      const doc = this.schema.topNodeType.create(null, para);
      return serializeMarkdown(doc).trim();
    }

    const doc = this.schema.topNodeType.create(null, fragment);
    return serializeMarkdown(doc).trimEnd();
  }

  /**
   * 获取光标位置
   */
  getCursorOffset(): number {
    return this.view.state.selection.head;
  }

  /**
   * 设置光标位置
   */
  setCursorOffset(offset: number): void {
    const { doc } = this.view.state;
    const pos = Math.min(Math.max(0, offset), doc.content.size);
    const $pos = doc.resolve(pos);
    const selection = Selection.near($pos);
    const tr = this.view.state.tr.setSelection(selection);
    this.view.dispatch(tr);
  }

  /**
   * 切换源码视图
   */
  toggleSourceView(): void {
    toggleSourceView(this.view.state, this.view.dispatch.bind(this.view), this.view);
    this.config.sourceView = !this.config.sourceView;
  }

  /**
   * 获取源码视图状态
   */
  isSourceViewEnabled(): boolean {
    const state = decorationPluginKey.getState(this.view.state);
    return state?.sourceView ?? false;
  }

  /**
   * 注册事件处理器
   */
  on(event: string, handler: Function): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  /**
   * 移除事件处理器
   */
  off(event: string, handler: Function): void {
    this.eventHandlers.get(event)?.delete(handler);
  }

  /**
   * 触发事件
   */
  private emit(event: string, data: any): void {
    this.eventHandlers.get(event)?.forEach((handler) => handler(data));
  }

  /**
   * 执行命令
   */
  command(name: string, ...args: any[]): boolean {
    return this.executeAction(name, ...args);
  }

  /**
   * 执行快捷键动作命令（命令面板、上下文菜单等共用）
   */
  executeAction(id: string, ..._args: any[]): boolean {
    const commands = buildActionCommandMap(this.schema) as Record<
      string,
      (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean
    >;
    const command = commands[id];
    if (!command) return false;

    const handled = command(this.view.state, this.view.dispatch.bind(this.view));
    if (handled) {
      this.view.focus();
    }
    return handled;
  }

  /**
   * 打开查找/替换面板
   */
  openFind(replace = false): void {
    this.openSearch(replace);
  }

  /**
   * 获取 ProseMirror 状态
   */
  getState(): EditorState {
    return this.view.state;
  }

  /**
   * 获取文档
   */
  getDoc(): Node {
    return this.view.state.doc;
  }

  /**
   * 获取 Schema
   */
  getSchema(): Schema {
    return this.schema;
  }

  /**
   * 获取用户自定义快捷键映射
   * 从 localStorage 读取
   */
  private getCustomKeyMap(): ShortcutKeyMap {
    try {
      const raw = localStorage.getItem("livemd-config");
      if (raw) {
        const config = JSON.parse(raw);
        return config.shortcuts || {};
      }
    } catch {
      // ignore
    }
    return {};
  }
}

/**
 * 创建 Livemd 编辑器
 */
export function createLivemdEditor(container: HTMLElement, config?: LivemdConfig): LivemdEditor {
  return new LivemdEditor(container, config);
}
