/**
 * Mermaid 全屏查看
 *
 * 克隆正文中已渲染的 SVG，做安全净化与尺寸规范化后交给通用全屏查看器。
 * 不重新执行 mermaid.render，避免主题、字体与正文不一致。
 */

import {
  FULLSCREEN_ICONS,
  openFullscreenViewer,
  type FullscreenViewerHandle,
} from "../viewers/fullscreenViewer.ts";
import {
  normalizeMermaidSvgSize,
  normalizeRenderedMermaidViewport,
  readSvgIntrinsicSize,
  restoreMermaidExportSize,
} from "../viewers/zoomView.ts";

export { normalizeRenderedMermaidViewport, restoreMermaidExportSize };

export interface MermaidFullscreenOptions {
  title?: string;
  /** 图表源码，用于复制 */
  source?: string;
  onClose?: () => void;
}

const COPY_ICON =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

function sanitizeSvgClone(source: SVGSVGElement): SVGSVGElement {
  const clone = source.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll("script").forEach((script) => script.remove());

  const elements: Element[] = [clone, ...Array.from(clone.querySelectorAll("*"))];
  for (const element of elements) {
    for (const attribute of Array.from(element.attributes)) {
      if (/^on/i.test(attribute.name)) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (
        (attribute.name === "href" || attribute.name === "xlink:href") &&
        /^\s*javascript:/i.test(attribute.value)
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return clone;
}

export function openMermaidFullscreen(
  sourceSvg: SVGSVGElement,
  options: MermaidFullscreenOptions = {}
): FullscreenViewerHandle {
  // 先修正正文 SVG 的空白边界，再克隆，保证全屏与正文尺寸一致
  normalizeRenderedMermaidViewport(sourceSvg);

  const clone = sanitizeSvgClone(sourceSvg);
  clone.classList.add("livemd-mermaid-fullscreen__svg");
  const size = normalizeMermaidSvgSize(clone);
  const title = options.title || "Mermaid 图表";
  const actions = options.source
    ? [
        {
          label: "复制图表源码",
          title: "复制图表源码",
          icon: COPY_ICON,
          onClick: () => {
            void navigator.clipboard?.writeText(options.source ?? "");
          },
        },
      ]
    : [];

  return openFullscreenViewer({
    kind: "mermaid",
    title,
    content: clone,
    contentSize: size,
    modes: ["readable", "fit", "original", "custom"],
    initialMode: "fit",
    minScale: 0.1,
    maxScale: 8,
    actions,
    ariaLabel: `${title}全屏预览`,
    onClose: options.onClose,
  });
}

/**
 * 读取正文 Mermaid SVG 的固有尺寸，供外部布局或导出使用。
 */
export function readMermaidSvgSize(svg: SVGSVGElement): { width: number; height: number } {
  return readSvgIntrinsicSize(svg);
}

export { FULLSCREEN_ICONS };
