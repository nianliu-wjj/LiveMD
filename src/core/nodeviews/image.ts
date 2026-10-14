/**
 * Livemd 图片 NodeView
 *
 * 支持编辑模式和预览模式切换
 * 聚焦时同时显示图片和源码，离开时只显示图片
 * 源码可编辑，编辑后自动更新图片属性
 * 源码位置根据光标进入方向动态调整
 * 支持源码模式只显示原始 Markdown 文本
 */

import { Node } from "prosemirror-model";
import { EditorView, NodeView } from "prosemirror-view";
import { NodeSelection, Selection } from "prosemirror-state";
import { sourceViewManager } from "../decorations";
import { resolveImageSrc } from "../utils/image-path";
import { cacheClipboardImage } from "../clipboard";
import { openImageLightbox } from "../viewers/imageLightbox";
import { FULLSCREEN_ICONS, type FullscreenViewerHandle } from "../viewers/fullscreenViewer";

// 存储所有 ImageView 实例，用于全局更新
const imageViews = new Set<ImageView>();

/** 图片自然尺寸缓存上限（FIFO 淘汰，Map 迭代序即插入序） */
const IMAGE_SIZE_CACHE_LIMIT = 500;

/**
 * 图片自然尺寸模块级缓存：key 为解析后的渲染 src。
 *
 * 命中即在创建 <img> 时写入 width + aspect-ratio 占住布局空间，图片加载完成前占位高度
 * 不再为 0——快速滚动时不出现空白，加载完成时也不会发生二次布局抖动。
 */
const imageSizeCache = new Map<string, { w: number; h: number }>();

function rememberImageSize(src: string, w: number, h: number): void {
  if (!src || w <= 0 || h <= 0) return;
  imageSizeCache.delete(src);
  imageSizeCache.set(src, { w, h });
  if (imageSizeCache.size > IMAGE_SIZE_CACHE_LIMIT) {
    const oldest = imageSizeCache.keys().next().value;
    if (oldest !== undefined) imageSizeCache.delete(oldest);
  }
}

// 记录上一次光标位置，用于判断进入方向
let lastCursorPos = 0;

/**
 * 更新所有图片的编辑状态
 */
export function updateAllImages(view: EditorView): void {
  const { from, to } = view.state.selection;
  const selection = view.state.selection;

  for (const imageView of imageViews) {
    imageView.updateEditingState(from, to, selection, lastCursorPos);
  }

  // 更新上一次光标位置
  lastCursorPos = from;
}

/**
 * 解析图片 Markdown 语法
 * 格式: ![alt](src "title") 或 [![alt](src "title")](href "linkTitle")
 */
function parseImageMarkdown(
  markdown: string
): { src: string; alt: string; title: string; linkHref?: string; linkTitle?: string } | null {
  // 先尝试匹配链接图片 [![alt](src "title")](href "linkTitle")
  const linkedMatch = markdown.match(
    /^\[!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/
  );
  if (linkedMatch) {
    return {
      alt: linkedMatch[1] || "",
      src: linkedMatch[2] || "",
      title: linkedMatch[3] || "",
      linkHref: linkedMatch[4] || "",
      linkTitle: linkedMatch[5] || "",
    };
  }
  // 普通图片 ![alt](src "title")
  const match = markdown.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/);
  if (!match) return null;
  return {
    alt: match[1] || "",
    src: match[2] || "",
    title: match[3] || "",
  };
}

/**
 * 图片 NodeView
 *
 * 图片是原子节点，不使用 contentDOM
 * 源码可编辑，编辑后自动更新图片属性
 * 支持源码模式只显示原始 Markdown 文本
 */
export class ImageView implements NodeView {
  dom: HTMLElement;
  private imgElement: HTMLElement;
  private sourceContainer: HTMLElement;
  private sourceInput: HTMLInputElement;
  private view: EditorView;
  private getPos: () => number | undefined;
  private isEditing: boolean = false;
  private node: Node;
  private sourcePosition: "before" | "after" = "after";
  // 源码模式相关
  private sourceViewMode: boolean = false;
  private sourceViewUnsubscribe: (() => void) | null = null;
  private sourceTextElement: HTMLElement | null = null;
  /** 图片右上角「全屏查看」按钮 */
  private expandButton: HTMLButtonElement | null = null;
  /** 当前打开的图片灯箱 */
  private lightboxHandle: FullscreenViewerHandle | null = null;
  private lightboxOpening = false;
  private lightboxSignature: string | null = null;

  constructor(node: Node, view: EditorView, getPos: () => number | undefined) {
    this.view = view;
    this.getPos = getPos;
    this.node = node;

    // 注册到全局集合
    imageViews.add(this);

    // 创建容器
    this.dom = document.createElement("div");
    this.dom.className = "livemd-image-block";

    // 创建图片元素
    this.imgElement = document.createElement("div");
    this.imgElement.className = "livemd-image-preview";
    this.dom.appendChild(this.imgElement);

    // 全屏查看按钮（悬停图片时显示）
    this.expandButton = document.createElement("button");
    this.expandButton.type = "button";
    this.expandButton.className = "livemd-image-expand-btn";
    this.expandButton.title = "全屏查看图片";
    this.expandButton.setAttribute("aria-label", "全屏查看图片");
    this.expandButton.innerHTML = FULLSCREEN_ICONS.maximize;
    this.expandButton.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    this.expandButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.openLightbox();
    });

    // 创建源码容器（编辑模式下显示）
    this.sourceContainer = document.createElement("div");
    this.sourceContainer.className = "livemd-image-source-container";
    this.dom.appendChild(this.sourceContainer);

    // 创建源码输入框
    this.sourceInput = document.createElement("input");
    this.sourceInput.type = "text";
    this.sourceInput.className = "livemd-image-source-input";
    this.sourceInput.draggable = false; // 禁止拖动
    this.sourceContainer.appendChild(this.sourceInput);

    // 禁止容器拖动
    this.dom.draggable = false;
    this.sourceContainer.draggable = false;

    // 阻止源码容器的拖动事件
    this.sourceContainer.addEventListener("dragstart", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    this.sourceContainer.addEventListener("mousedown", (e) => {
      // 阻止事件冒泡到 ProseMirror，防止触发节点拖动
      e.stopPropagation();
    });

    // 初始渲染
    this.updateContent(node);

    // 点击图片进入编辑模式
    this.imgElement.addEventListener("click", (e) => {
      e.preventDefault();
      this.selectThisNode();
    });
    this.imgElement.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const { src } = this.node.attrs;
      if (!src) return;
      void this.openLightbox();
    });

    // 源码输入框事件
    this.sourceInput.addEventListener("blur", () => {
      this.applySourceChange();
    });

    // 实时响应源码变化
    this.sourceInput.addEventListener("input", () => {
      this.previewSourceChange();
    });

    this.sourceInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.applySourceChange();
        // 移动光标到下一行
        const pos = this.getPos();
        if (pos !== undefined) {
          const { state } = this.view;
          const $pos = state.doc.resolve(pos + this.node.nodeSize);
          const tr = state.tr.setSelection(Selection.near($pos));
          this.view.dispatch(tr);
          this.view.focus();
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        // 恢复原始值
        this.updateSourceInput();
        this.view.focus();
      } else if (e.key === "Backspace") {
        // 当输入框为空时，删除整个图片节点
        if (
          this.sourceInput.value === "" ||
          (this.sourceInput.selectionStart === 0 && this.sourceInput.selectionEnd === 0)
        ) {
          if (this.sourceInput.value === "") {
            e.preventDefault();
            this.deleteImageNode();
          }
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        this.applySourceChange();
        // 移动光标到图片之前
        const pos = this.getPos();
        if (pos !== undefined) {
          const { state } = this.view;
          const $pos = state.doc.resolve(pos);
          const tr = state.tr.setSelection(Selection.near($pos, -1));
          this.view.dispatch(tr);
          this.view.focus();
        }
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        this.applySourceChange();
        // 移动光标到图片之后
        const pos = this.getPos();
        if (pos !== undefined) {
          const { state } = this.view;
          const $pos = state.doc.resolve(pos + this.node.nodeSize);
          const tr = state.tr.setSelection(Selection.near($pos, 1));
          this.view.dispatch(tr);
          this.view.focus();
        }
      }
    });

    // 源码模式初始化
    this.initSourceViewMode();
  }

  /**
   * 初始化源码模式
   */
  private initSourceViewMode(): void {
    // 创建源码文本元素（源码模式下显示）
    this.sourceTextElement = document.createElement("div");
    this.sourceTextElement.className = "livemd-image-source-text";
    this.sourceTextElement.contentEditable = "true";
    this.sourceTextElement.spellcheck = false;
    this.updateSourceText();

    // 源码文本编辑事件
    this.sourceTextElement.addEventListener("input", () => {
      this.handleSourceTextInput();
    });

    this.sourceTextElement.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.applySourceTextChange();
        // 移动光标到下一行
        const pos = this.getPos();
        if (pos !== undefined) {
          const { state } = this.view;
          const $pos = state.doc.resolve(pos + this.node.nodeSize);
          const tr = state.tr.setSelection(Selection.near($pos));
          this.view.dispatch(tr);
          this.view.focus();
        }
      } else if (e.key === "Backspace") {
        const text = this.sourceTextElement?.textContent || "";
        const selection = window.getSelection();
        if (
          text === "" ||
          (selection && selection.anchorOffset === 0 && selection.focusOffset === 0)
        ) {
          if (text === "") {
            e.preventDefault();
            this.deleteImageNode();
          }
        }
      }
    });

    this.sourceTextElement.addEventListener("blur", () => {
      this.applySourceTextChange();
    });

    // 订阅源码模式状态变化
    this.sourceViewUnsubscribe = sourceViewManager.subscribe((sourceView) => {
      this.setSourceViewMode(sourceView);
    });
  }

  /**
   * 更新源码文本
   */
  private updateSourceText(): void {
    if (!this.sourceTextElement) return;
    const { src, alt, title, linkHref, linkTitle } = this.node.attrs;
    let imgMarkdown = `![${alt}](${src}`;
    if (title) {
      imgMarkdown += ` "${title}"`;
    }
    imgMarkdown += ")";
    let markdown: string;
    if (linkHref) {
      markdown = `[${imgMarkdown}](${linkHref}`;
      if (linkTitle) {
        markdown += ` "${linkTitle}"`;
      }
      markdown += ")";
    } else {
      markdown = imgMarkdown;
    }
    this.sourceTextElement.textContent = markdown;
  }

  /**
   * 处理源码文本输入
   */
  private handleSourceTextInput(): void {
    // 实时预览不需要做什么，因为源码模式下不显示图片
  }

  /**
   * 应用源码文本变更
   */
  private applySourceTextChange(): void {
    if (!this.sourceTextElement) return;
    const newMarkdown = this.sourceTextElement.textContent?.trim() || "";
    const parsed = parseImageMarkdown(newMarkdown);

    if (!parsed) {
      // 解析失败，恢复原始值
      this.updateSourceText();
      return;
    }

    const pos = this.getPos();
    if (pos === undefined) return;

    const { state } = this.view;
    const { src, alt, title, linkHref, linkTitle } = this.node.attrs;

    // 检查是否有变化
    if (
      parsed.src === src &&
      parsed.alt === alt &&
      parsed.title === title &&
      (parsed.linkHref || "") === (linkHref || "") &&
      (parsed.linkTitle || "") === (linkTitle || "")
    ) {
      return;
    }

    // 更新节点属性
    const tr = state.tr.setNodeMarkup(pos, undefined, {
      src: parsed.src,
      alt: parsed.alt,
      title: parsed.title,
      linkHref: parsed.linkHref || "",
      linkTitle: parsed.linkTitle || "",
    });
    this.view.dispatch(tr);
  }

  /**
   * 设置源码模式
   */
  private setSourceViewMode(enabled: boolean): void {
    if (this.sourceViewMode === enabled) return;
    this.sourceViewMode = enabled;

    if (enabled) {
      // 进入源码模式
      this.dom.classList.add("source-view");
      // 隐藏图片预览
      this.imgElement.style.display = "none";
      // 隐藏编辑模式的源码容器
      this.sourceContainer.style.display = "none";
      // 显示源码文本
      if (this.sourceTextElement) {
        this.updateSourceText();
        this.dom.appendChild(this.sourceTextElement);
      }
    } else {
      // 退出源码模式
      this.dom.classList.remove("source-view");
      // 显示图片预览
      this.imgElement.style.display = "";
      // 恢复编辑模式的源码容器显示状态
      this.sourceContainer.style.display = "";
      // 移除源码文本
      if (this.sourceTextElement && this.sourceTextElement.parentNode) {
        this.sourceTextElement.remove();
      }
    }
  }

  update(node: Node): boolean {
    if (node.type.name !== "image") return false;
    const signatureChanged =
      Boolean(this.lightboxHandle) && this.getLightboxSignature() !== this.lightboxSignature;
    this.node = node;
    if (signatureChanged) this.closeLightbox();
    this.updateContent(node);
    // 源码模式下也更新源码文本
    if (this.sourceViewMode) {
      this.updateSourceText();
    }
    return true;
  }

  private getLightboxSignature(): string {
    const { src, alt, title } = this.node.attrs;
    return `${src}\n${alt}\n${title}`;
  }

  /**
   * 打开当前图片的灯箱
   */
  private async openLightbox(): Promise<void> {
    if (this.lightboxOpening || this.lightboxHandle) return;
    const img = this.imgElement.querySelector("img");
    if (!img) return;

    this.lightboxOpening = true;
    const { src, alt, title } = this.node.attrs;
    const signature = this.getLightboxSignature();
    try {
      let handle: FullscreenViewerHandle | null = null;
      handle = await openImageLightbox({
        image: img,
        alt,
        title,
        onOpenExternal: () => {
          window.electronAPI?.openImagePreview?.(resolveImageSrc(src), alt || "");
        },
        onClose: () => {
          if (this.lightboxHandle === handle) {
            this.lightboxHandle = null;
            this.lightboxSignature = null;
          }
        },
      });

      if (!handle) return;
      // 图片加载期间节点可能已被修改，避免展示旧图
      if (this.getLightboxSignature() !== signature) {
        handle.close();
        return;
      }
      this.lightboxHandle = handle;
      this.lightboxSignature = signature;
    } finally {
      this.lightboxOpening = false;
    }
  }

  private closeLightbox(): void {
    this.lightboxHandle?.close();
    this.lightboxHandle = null;
    this.lightboxSignature = null;
  }

  private updateContent(node: Node): void {
    const { src, alt, title, linkHref } = node.attrs;
    this.renderImage(src, alt, title, linkHref);

    // 更新源码输入框（仅在非编辑状态下更新，避免覆盖用户输入）
    if (!this.isEditing) {
      this.updateSourceInput();
    }
  }

  /**
   * 渲染图片
   */
  private renderImage(src: string, alt: string, title?: string, linkHref?: string): void {
    // 清空容器
    this.imgElement.innerHTML = "";

    if (!src) {
      this.showImagePlaceholder("请输入图片地址");
      return;
    }

    const img = document.createElement("img");
    // 将相对路径转为 livemd:// 协议 URL 仅用于 DOM 渲染
    const resolvedSrc = resolveImageSrc(src);
    img.src = resolvedSrc;
    img.alt = alt;
    img.draggable = false;
    img.loading = "lazy";
    img.decoding = "async";
    if (/^https?:/i.test(src)) img.referrerPolicy = "no-referrer";
    if (title) img.title = title;

    // 尺寸缓存命中：瞬时写入宽度与宽高比占住布局空间（高度随容器约束等比推导，不写死）
    const cachedSize = imageSizeCache.get(resolvedSrc);
    if (cachedSize) {
      img.width = cachedSize.w;
      img.style.aspectRatio = `${cachedSize.w} / ${cachedSize.h}`;
      img.style.height = "auto";
    }

    img.onerror = () => {
      this.showImageError(src);
    };
    img.addEventListener(
      "load",
      () => {
        // 加载完成后回填自然尺寸缓存：下次渲染同一 src 免加载抖动
        rememberImageSize(resolvedSrc, img.naturalWidth, img.naturalHeight);
        const renderedSrc = img.currentSrc || img.src;
        if (!/^https?:/i.test(src) && !/^https?:/i.test(renderedSrc)) {
          void cacheClipboardImage(img);
        }
      },
      { once: true }
    );

    // 用收缩到图片宽度的容器包住图片和放大按钮，避免宽容器把按钮推到远离图片的位置
    const frame = document.createElement("span");
    frame.className = "livemd-image-preview-frame";

    if (linkHref) {
      const a = document.createElement("a");
      a.href = linkHref;
      a.appendChild(img);
      // 阻止在编辑器中点击链接跳转
      a.addEventListener("click", (e) => {
        e.preventDefault();
      });
      frame.appendChild(a);
    } else {
      frame.appendChild(img);
    }

    if (this.expandButton) {
      frame.appendChild(this.expandButton);
    }
    this.imgElement.appendChild(frame);
  }

  /**
   * 显示图片加载失败占位
   */
  private showImageError(src: string): void {
    this.imgElement.innerHTML = "";
    const placeholder = document.createElement("div");
    placeholder.className = "livemd-image-placeholder livemd-image-error-placeholder";
    placeholder.innerHTML = `
      <span class="livemd-image-placeholder-icon">🖼️</span>
      <span class="livemd-image-placeholder-text">图片加载失败</span>
      <span class="livemd-image-placeholder-src">${this.escapeHtml(src)}</span>
    `;
    this.imgElement.appendChild(placeholder);
  }

  /**
   * 显示图片占位
   */
  private showImagePlaceholder(text: string): void {
    this.imgElement.innerHTML = "";
    const placeholder = document.createElement("div");
    placeholder.className = "livemd-image-placeholder";
    placeholder.innerHTML = `
      <span class="livemd-image-placeholder-icon">🖼️</span>
      <span class="livemd-image-placeholder-text">${this.escapeHtml(text)}</span>
    `;
    this.imgElement.appendChild(placeholder);
  }

  /**
   * 转义 HTML
   */
  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  private updateSourceInput(): void {
    const { src, alt, title, linkHref, linkTitle } = this.node.attrs;
    let imgMarkdown = `![${alt}](${src}`;
    if (title) {
      imgMarkdown += ` "${title}"`;
    }
    imgMarkdown += ")";
    if (linkHref) {
      let markdown = `[${imgMarkdown}](${linkHref}`;
      if (linkTitle) {
        markdown += ` "${linkTitle}"`;
      }
      markdown += ")";
      this.sourceInput.value = markdown;
    } else {
      this.sourceInput.value = imgMarkdown;
    }
  }

  /**
   * 实时预览源码变化（不更新 ProseMirror 状态）
   */
  private previewSourceChange(): void {
    const newMarkdown = this.sourceInput.value.trim();
    const parsed = parseImageMarkdown(newMarkdown);

    if (parsed) {
      // 实时更新图片预览
      this.renderImage(parsed.src, parsed.alt, parsed.title, parsed.linkHref);
    } else {
      // 语法不完整时显示占位
      this.showImagePlaceholder("请输入完整的图片语法");
    }
  }

  /**
   * 应用源码变更（更新 ProseMirror 状态）
   */
  private applySourceChange(): void {
    const newMarkdown = this.sourceInput.value.trim();
    const parsed = parseImageMarkdown(newMarkdown);

    if (!parsed) {
      // 解析失败，恢复原始值
      this.updateSourceInput();
      return;
    }

    const pos = this.getPos();
    if (pos === undefined) return;

    const { state } = this.view;
    const { src, alt, title, linkHref, linkTitle } = this.node.attrs;

    // 检查是否有变化
    if (
      parsed.src === src &&
      parsed.alt === alt &&
      parsed.title === title &&
      (parsed.linkHref || "") === (linkHref || "") &&
      (parsed.linkTitle || "") === (linkTitle || "")
    ) {
      return;
    }

    // 更新节点属性
    const tr = state.tr.setNodeMarkup(pos, undefined, {
      src: parsed.src,
      alt: parsed.alt,
      title: parsed.title,
      linkHref: parsed.linkHref || "",
      linkTitle: parsed.linkTitle || "",
    });
    this.view.dispatch(tr);
  }

  /**
   * 删除图片节点
   */
  private deleteImageNode(): void {
    const pos = this.getPos();
    if (pos === undefined) return;

    const { state } = this.view;
    const tr = state.tr.delete(pos, pos + this.node.nodeSize);

    // 如果删除后文档为空，创建一个空段落
    if (tr.doc.content.size === 0) {
      const paragraph = state.schema.nodes.paragraph.create();
      tr.insert(0, paragraph);
    }

    this.view.dispatch(tr);
    this.view.focus();
  }

  /**
   * 选中此节点
   */
  private selectThisNode(): void {
    const pos = this.getPos();
    if (pos === undefined) return;

    const { state } = this.view;
    const selection = NodeSelection.create(state.doc, pos);

    const tr = state.tr.setSelection(selection);
    this.view.dispatch(tr);
    this.view.focus();
  }

  /**
   * 根据光标位置更新编辑状态
   */
  updateEditingState(selFrom: number, selTo: number, selection: any, prevCursorPos: number): void {
    const pos = this.getPos();
    if (pos === undefined) return;

    const node = this.view.state.doc.nodeAt(pos);
    if (!node) return;

    const nodeStart = pos;
    const nodeEnd = pos + node.nodeSize;

    // 只有 NodeSelection 选中此节点时才进入编辑模式
    const isSelected = selection instanceof NodeSelection && selection.from === pos;

    if (isSelected && !this.isEditing) {
      // 判断进入方向：从前方还是后方进入
      const enterFromBefore = prevCursorPos <= nodeStart;
      this.setSourcePosition(enterFromBefore ? "before" : "after");
      this.setEditing(true);
    } else if (!isSelected && this.isEditing) {
      this.setEditing(false);
    }
  }

  /**
   * 设置源码位置
   */
  private setSourcePosition(position: "before" | "after"): void {
    if (this.sourcePosition === position) return;
    this.sourcePosition = position;

    // 调整 DOM 顺序
    if (position === "before") {
      this.dom.insertBefore(this.sourceContainer, this.imgElement);
      this.dom.classList.add("source-before");
      this.dom.classList.remove("source-after");
    } else {
      this.dom.appendChild(this.sourceContainer);
      this.dom.classList.remove("source-before");
      this.dom.classList.add("source-after");
    }
  }

  private setEditing(editing: boolean): void {
    this.isEditing = editing;
    if (editing) {
      this.dom.classList.add("editing");
      // 自动聚焦到输入框
      requestAnimationFrame(() => {
        this.sourceInput.focus();
        // 根据进入方向设置光标位置
        if (this.sourcePosition === "before") {
          // 从上方进入，光标在开头
          this.sourceInput.setSelectionRange(0, 0);
        } else {
          // 从下方进入，光标在末尾
          const len = this.sourceInput.value.length;
          this.sourceInput.setSelectionRange(len, len);
        }
        // 确保输入框在可视范围内
        this.sourceInput.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    } else {
      this.dom.classList.remove("editing");
    }
  }

  selectNode(): void {
    // 点击选中时，默认源码在下方
    this.setSourcePosition("after");
    this.setEditing(true);
  }

  deselectNode(): void {
    this.setEditing(false);
  }

  stopEvent(event: Event): boolean {
    // 允许输入框接收所有事件
    if (event.target === this.sourceInput) {
      // 阻止拖动事件
      if (event.type === "dragstart" || event.type === "drag") {
        event.preventDefault();
        return true;
      }
      return true;
    }
    // 允许源码文本元素接收所有事件
    if (event.target === this.sourceTextElement) {
      if (event.type === "dragstart" || event.type === "drag") {
        event.preventDefault();
        return true;
      }
      return true;
    }
    // 阻止源码容器的拖动
    if (
      event.target === this.sourceContainer ||
      (event.target instanceof globalThis.Node && this.sourceContainer.contains(event.target))
    ) {
      if (event.type === "dragstart" || event.type === "drag") {
        event.preventDefault();
        return true;
      }
    }
    return false;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    // 从全局集合中移除
    imageViews.delete(this);
    this.closeLightbox();
    // 取消订阅源码模式状态
    if (this.sourceViewUnsubscribe) {
      this.sourceViewUnsubscribe();
      this.sourceViewUnsubscribe = null;
    }
  }
}

/**
 * 创建图片 NodeView
 */
export function createImageNodeView(
  node: Node,
  view: EditorView,
  getPos: () => number | undefined
): NodeView {
  return new ImageView(node, view, getPos);
}
