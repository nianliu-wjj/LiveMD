import type { Block, ExportPDFOptions } from "@/main/types";
import { buildSelfContainedMarkup } from "@/core/clipboard";
import { assetUrlToLocalPath, fileUrlToLocalPath } from "@/core/utils/image-path";
import { restoreMermaidExportSize } from "@/core/viewers/zoomView";

const ACTIVE_EDITOR_SELECTOR = '.livemd-editor-instance[data-active="true"] .livemd-container';

export function getActiveEditorElement(): HTMLElement {
  const element = document.querySelector(ACTIVE_EDITOR_SELECTOR);
  if (!(element instanceof HTMLElement)) throw new Error("Active editor element not found");
  return element;
}

export function getActiveEditorSelector(): string {
  return ACTIVE_EDITOR_SELECTOR;
}

/**
 * 导出选定元素为一个带样式和图片的独立 HTML 文件
 * @param element - 要导出的元素
 * @param filename - 导出文件名（默认为 export.html）
 */
export async function exportElementWithStylesAndImages(
  element: HTMLElement,
  filename: string = "export.html"
): Promise<void> {
  // 克隆元素并应用内联样式
  const cloned = cloneWithInlineStyles(element);
  restoreMermaidSizes(cloned);

  // 将 <img> 转为 base64
  await inlineImages(cloned);

  // 生成完整 HTML
  const html = `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>
      html, body {
        margin: 0;
        padding: 0;
        width: 100%;
        min-width: 1100px;
        height: auto;
      }
      .export-container {
        box-sizing: border-box;
        display: flex;
        justify-content: center;
      }
      .export-container > .livemd-container {
        width: 100%!important;
      }
      .export-container > .livemd-container .livemd-editor,.export-container > .livemd-container .livemd-editor > div[contenteditable="true"] {
        width: 100%!important;
      }
      p {
        word-break: break-word;
        width: 100%!important;
      }
    </style>
  </head>
  <body>
    <div class="export-container">${cloned.outerHTML}</div>
  </body>
  </html>`;

  // 下载文件
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 克隆元素及其所有子元素，并将样式内联化
 * @param element - 原始元素
 * @returns 克隆后的元素（样式已内联）
 */
function cloneWithInlineStyles(element: HTMLElement): HTMLElement {
  const clone = element.cloneNode(true) as HTMLElement;
  applyStylesRecursive(element, clone);
  return clone;
}

/**
 * 导出前把 Mermaid SVG 从屏幕缩放状态恢复为固有尺寸，避免打印时被裁切。
 */
function restoreMermaidSizes(root: Element): void {
  root.querySelectorAll<SVGSVGElement>('svg[data-livemd-mermaid="true"]').forEach((svg) => {
    restoreMermaidExportSize(svg);
  });
}

/**
 * 递归地应用 computed style
 * @param src - 原始节点
 * @param dest - 克隆节点
 */
function applyStylesRecursive(src: Element, dest: Element): void {
  const computed = getComputedStyle(src);
  const style = Array.from(computed)
    .map((key) => `${key}:${computed.getPropertyValue(key)};`)
    .join("");
  dest.setAttribute("style", style);

  // 🚨 修复 <a> 链接的点击性
  if (dest instanceof HTMLAnchorElement) {
    dest.style.pointerEvents = "auto";
    dest.style.cursor = "pointer";
    dest.style.textDecoration = "underline";
    dest.setAttribute("target", "_blank"); // 可选：让导出文件中点击在新标签打开
  }

  const srcChildren = Array.from(src.children);
  const destChildren = Array.from(dest.children);
  for (let i = 0; i < srcChildren.length; i++) {
    applyStylesRecursive(srcChildren[i], destChildren[i]);
  }
}

/**
 * 将元素中的所有 <img> src 转换为 base64（data URL）
 * @param root - 要处理的根元素
 */
/** 按扩展名推断图片 MIME（本地图片内联为 data URL 时需要） */
function guessImageMime(filePath: string): string {
  switch (filePath.split(".").pop()?.toLowerCase() ?? "") {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "bmp":
      return "image/bmp";
    case "avif":
      return "image/avif";
    default:
      return "image/png";
  }
}

async function inlineImages(root: HTMLElement): Promise<void> {
  const images = Array.from(root.querySelectorAll("img"));

  const tasks = images.map(async (img) => {
    const src = img.src;
    if (src.startsWith("data:")) return; // 已经是内联的

    // 本地图片优先走 Rust Base64 通路：不受 CSP / CORS 限制，
    // 能稳定读取工作区内外任意路径的图片（fetch(asset://) 在部分环境会被拦截）
    const localPath = assetUrlToLocalPath(src) ?? fileUrlToLocalPath(src);
    if (localPath) {
      try {
        const base64 = await window.electronAPI.readFileBase64(localPath);
        img.src = `data:${guessImageMime(localPath)};base64,${base64}`;
        return;
      } catch (err) {
        console.warn("本地图片 Base64 内联失败，回退到 fetch:", localPath, err);
      }
    }

    try {
      const res = await fetch(src, { mode: "cors" });
      const blob = await res.blob();
      const base64 = await blobToDataURL(blob);
      img.src = base64;
    } catch (err) {
      console.warn("图片内联失败:", src, err);
    }
  });

  await Promise.all(tasks);
}

/**
 * Blob → data URL
 * @param blob - Blob 对象
 * @returns base64 编码的 data URL
 */
function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

// 导出为 PDF
export async function exportElementAsPDF(
  elementSelector: string,
  outputName: string,
  options?: ExportPDFOptions
): Promise<void> {
  await window.electronAPI.exportAsPDF(elementSelector, outputName, options);
}
// 导出为 Word

/**
 * 遍历 Markdown 渲染后的 DOM，生成结构化数据
 * 过滤非正文节点（toolbar、控件等）
 */
export function serializeMarkdownToBlocks(selector: string): Block[] {
  const el = document.querySelector(selector);
  if (!el) throw new Error("Element not found");

  const blocks: Block[] = [];

  function traverse(node: Node) {
    if (!(node instanceof HTMLElement)) return;

    const className = node.className || "";
    if (
      className.includes("milkdown-block-handle") ||
      className.includes("crepe-drop-cursor") ||
      className.includes("milkdown-link-preview") ||
      className.includes("milkdown-link-edit") ||
      className.includes("milkdown-toolbar") ||
      className.includes("milkdown-latex-inline-edit") ||
      className.includes("milkdown-slash-menu")
    ) {
      return;
    }

    if (node.dataset.ignore) return;
    if (node.classList.contains("cm-content")) {
      const lines: string[] = [];
      node.querySelectorAll(".cm-line").forEach((line) => {
        lines.push(line.textContent || "");
      });
      blocks.push({ type: "code", lines });
      return;
    }
    const tag = node.tagName.toLowerCase();
    if (tag.startsWith("h")) {
      blocks.push({
        type: "heading",
        level: Number(tag[1]) as 1 | 2 | 3,
        text: node.textContent || "",
      });
    } else if (tag === "p") {
      blocks.push({ type: "paragraph", text: node.textContent || "" });
    } else if (tag === "pre") {
      blocks.push({ type: "code", lines: node.textContent?.split("\n") || [] });
    } else if (tag === "ul" || tag === "ol") {
      const items: string[] = [];
      node.querySelectorAll("li").forEach((li) => items.push(li.textContent || ""));
      blocks.push({ type: "list", items, ordered: tag === "ol" });
    }

    node.childNodes.forEach(traverse);
  }

  traverse(el);
  return blocks;
}

export async function exportMarkdownAsWord(markdown: string, outputName: string): Promise<void> {
  const blocks = parseMarkdownToBlocks(markdown);
  await window.electronAPI.exportAsWord(blocks, outputName);
}

/**
 * 将 Markdown 源码文本解析为结构化 Block 数据
 */
export function parseMarkdownToBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 标题
    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      const level = Math.min(headingMatch[1].length, 3) as 1 | 2 | 3;
      blocks.push({ type: "heading", level, text: headingMatch[2] });
      i++;
      continue;
    }

    // 代码块
    if (line.trimStart().startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push({ type: "code", lines: codeLines });
      i++; // 跳过结束的 ```
      continue;
    }

    // 无序列表
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
        i++;
      }
      blocks.push({ type: "list", items, ordered: false });
      continue;
    }

    // 有序列表
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ type: "list", items, ordered: true });
      continue;
    }

    // 空行跳过
    if (line.trim() === "") {
      i++;
      continue;
    }

    // 段落
    blocks.push({ type: "paragraph", text: line });
    i++;
  }

  return blocks;
}

/**
 * 导出为纯文本文件（使用 Markdown 源码）
 */
export function exportAsText(markdown: string, outputName: string = "export.txt"): void {
  const blob = new Blob([markdown], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = outputName;
  a.click();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 导出元素为 PNG 图片
 *
 * 在离屏宿主中克隆元素（解除高度限制，按完整内容尺寸导出），图片统一内联为 data URL，
 * 经 SVG foreignObject 光栅化后触发下载；样式与字体经 buildSelfContainedMarkup 内联
 * （对齐剪贴板 PNG 兜底的光栅化路径）。
 */
export async function exportElementAsPNG(
  element: HTMLElement,
  filename: string = "export.png"
): Promise<void> {
  const host = document.createElement("div");
  host.style.cssText = `position: fixed; left: -100000px; top: 0; width: ${element.clientWidth}px; pointer-events: none;`;
  const clone = element.cloneNode(true) as HTMLElement;
  // 编辑器容器默认撑满视口高度：解除限制，按完整内容尺寸导出
  clone.style.height = "auto";
  clone.style.maxHeight = "none";
  clone.style.overflow = "visible";
  host.appendChild(clone);
  document.body.appendChild(host);

  try {
    await inlineImages(clone);
    const width = Math.ceil(
      clone.scrollWidth || clone.getBoundingClientRect().width || element.clientWidth
    );
    const height = Math.ceil(clone.scrollHeight || clone.getBoundingClientRect().height);
    if (width <= 0 || height <= 0) {
      throw new Error("没有可导出的内容");
    }

    const { markup } = buildSelfContainedMarkup(clone);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml">${markup}</div></foreignObject></svg>`;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("PNG 光栅化失败"));
        image.src = url;
      });

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("无法创建导出画布");
      }
      context.drawImage(image, 0, 0, width, height);

      const link = document.createElement("a");
      link.href = canvas.toDataURL("image/png");
      link.download = filename;
      link.click();
    } finally {
      URL.revokeObjectURL(url);
    }
  } finally {
    host.remove();
  }
}
