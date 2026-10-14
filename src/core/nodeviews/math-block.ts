/**
 * Livemd 数学公式 NodeView
 *
 * 使用 KaTeX 渲染数学公式
 * 光标进入块时显示源码，离开时显示渲染
 */

import { Node as ProseMirrorNode } from "prosemirror-model";
import { Selection, TextSelection } from "prosemirror-state";
import { EditorView, NodeView } from "prosemirror-view";
import katex from "katex";
import "katex/dist/katex.min.css";
import { requestClipboardPngFallback } from "../clipboard";

/**
 * KaTeX 渲染结果缓存：同一公式内容（含 displayMode）全应用只渲染一次。
 *
 * 装饰插件与 NodeView 在每次光标移动/文档变化时都会请求公式渲染，
 * 无缓存时每次都同步执行 KaTeX 排版（单条几毫秒），是大文档（公式多）选区变化卡顿的主因之一。
 * LRU 上限控制内存：键为公式源码（通常很短），8000 条足以覆盖大型文档。
 */
const MATH_RENDER_CACHE_LIMIT = 8000;
const mathRenderCache = new Map<string, string>();

function renderMath(content: string, displayMode: boolean): string {
  if (!content.trim()) {
    return "";
  }

  const cacheKey = `${displayMode ? "b" : "i"}:${content}`;
  const cached = mathRenderCache.get(cacheKey);
  if (cached !== undefined) {
    // 命中后重插到 Map 末尾，维持 LRU 语义
    mathRenderCache.delete(cacheKey);
    mathRenderCache.set(cacheKey, cached);
    return cached;
  }

  let rendered: string;
  try {
    rendered = katex.renderToString(content, {
      displayMode,
      throwOnError: false,
      output: "html",
      // 公式含中文/全角字符时，strict 模式每次渲染都会向控制台刷 unicodeTextInMathMode 告警
      strict: false,
    });
  } catch {
    rendered = `<span class="math-error">${escapeHtml(content)}</span>`;
  }

  if (mathRenderCache.size >= MATH_RENDER_CACHE_LIMIT) {
    // Map 迭代序即插入序，删除首项即最旧项
    const oldest = mathRenderCache.keys().next().value;
    if (oldest !== undefined) mathRenderCache.delete(oldest);
  }
  mathRenderCache.set(cacheKey, rendered);
  return rendered;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const mathBlockViews = new Set<MathBlockView>();

export function updateAllMathBlocks(view: EditorView): void {
  const { from, to } = view.state.selection;
  for (const mathView of mathBlockViews) {
    mathView.updateEditingState(from, to);
  }
}

export class MathBlockView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private preview: HTMLElement;
  private sourceContainer: HTMLElement;
  private node: ProseMirrorNode;
  private view: EditorView;
  private getPos: () => number | undefined;
  private isEditing = false;

  constructor(node: ProseMirrorNode, view: EditorView, getPos: () => number | undefined) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    mathBlockViews.add(this);

    this.dom = document.createElement("div");
    this.dom.className = "math-block";

    this.preview = document.createElement("div");
    this.preview.className = "math-preview";
    this.dom.appendChild(this.preview);

    this.sourceContainer = document.createElement("div");
    this.sourceContainer.className = "math-source-container";
    this.dom.appendChild(this.sourceContainer);

    this.contentDOM = document.createElement("div");
    this.contentDOM.className = "math-source";
    this.sourceContainer.appendChild(this.contentDOM);

    this.preview.addEventListener("mousedown", (event) => {
      event.preventDefault();
      this.enterEditMode();
    });

    this.contentDOM.addEventListener("keydown", (event) => {
      const selection = this.view.state.selection;
      if (!selection.empty) return;

      if (
        event.key === "Backspace" &&
        selection.$from.parent.type === this.node.type &&
        selection.$from.parentOffset === 0 &&
        this.node.textContent.length > 0
      ) {
        event.preventDefault();
        this.unwrapMathBlock();
        return;
      }

      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        this.node.textContent.length === 0
      ) {
        event.preventDefault();
        this.deleteMathBlock();
      }
    });

    this.updatePreview(node.textContent);
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        if (!this.isEditing && !this.preview.hasAttribute("data-clipboard-png")) {
          requestClipboardPngFallback(this.preview);
        }
      });
    }
    this.updateEditingState(view.state.selection.from, view.state.selection.to);
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.updatePreview(node.textContent);
    return true;
  }

  updateEditingState(selFrom: number, selTo: number): void {
    const pos = this.getPos();
    if (pos === undefined) return;

    const nodeEnd = pos + this.node.nodeSize;
    const cursorInNode = selFrom >= pos && selTo <= nodeEnd;
    this.setEditing(cursorInNode);
  }

  private updatePreview(content: string): void {
    const html = renderMath(content, true);
    this.preview.removeAttribute("data-clipboard-png");
    this.preview.innerHTML = html || '<span class="math-placeholder">输入数学公式...</span>';
    if (html && !this.isEditing) requestClipboardPngFallback(this.preview);
  }

  private setEditing(editing: boolean): void {
    if (this.isEditing === editing) return;
    this.isEditing = editing;
    this.dom.classList.toggle("editing", editing);
    if (!editing && this.preview.innerHTML && !this.preview.hasAttribute("data-clipboard-png")) {
      requestClipboardPngFallback(this.preview);
    }
  }

  private enterEditMode(): void {
    const pos = this.getPos();
    if (pos === undefined) return;

    const contentPos = pos + 1 + this.node.textContent.length;
    const tr = this.view.state.tr.setSelection(
      TextSelection.create(this.view.state.doc, contentPos)
    );
    this.view.dispatch(tr);
    this.view.focus();
  }

  private deleteMathBlock(): void {
    const pos = this.getPos();
    if (pos === undefined) return;

    const { state } = this.view;
    const nodeEnd = pos + this.node.nodeSize;
    const tr = state.tr.delete(pos, nodeEnd);

    if (tr.doc.content.size === 0) {
      const paragraph = state.schema.nodes.paragraph.create();
      tr.insert(0, paragraph);
      tr.setSelection(TextSelection.create(tr.doc, 1));
    } else {
      const $pos = tr.doc.resolve(Math.min(pos, tr.doc.content.size));
      tr.setSelection(Selection.near($pos, -1));
    }

    this.view.dispatch(tr);
    this.view.focus();
  }

  private unwrapMathBlock(): void {
    const pos = this.getPos();
    if (pos === undefined) return;

    const { state } = this.view;
    const nodeEnd = pos + this.node.nodeSize;
    const paragraph = state.schema.nodes.paragraph.create(
      null,
      this.node.textContent ? state.schema.text(this.node.textContent) : null
    );
    const tr = state.tr.replaceWith(pos, nodeEnd, paragraph);
    tr.setSelection(TextSelection.create(tr.doc, pos + 1));
    this.view.dispatch(tr);
    this.view.focus();
  }

  selectNode(): void {
    this.setEditing(true);
  }

  deselectNode(): void {
    this.setEditing(false);
  }

  stopEvent(): boolean {
    return false;
  }

  ignoreMutation(mutation: MutationRecord | { type: "selection"; target: Node }): boolean {
    if (mutation.type === "selection") return false;
    return !this.contentDOM.contains(mutation.target as Node);
  }

  destroy(): void {
    mathBlockViews.delete(this);
  }
}

export function createMathBlockNodeView(
  node: ProseMirrorNode,
  view: EditorView,
  getPos: () => number | undefined
): NodeView {
  return new MathBlockView(node, view, getPos);
}

export function renderInlineMath(content: string): string {
  return renderMath(content, false);
}

export function isKaTeXAvailable(): boolean {
  return true;
}

export function preloadKaTeX(): Promise<void> {
  return Promise.resolve();
}
