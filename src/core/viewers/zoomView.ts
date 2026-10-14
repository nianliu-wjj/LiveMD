/**
 * 通用缩放 / 平移变换内核
 *
 * 坐标约定：内容左上角为 (0, 0)，变换表示
 * `translate(x, y) scale(scale)`，transform-origin 固定为 0 0。
 * 屏幕坐标 = 内容坐标 * scale + (x, y)。
 *
 * 该模块不依赖 ProseMirror / Vue，图片灯箱与 Mermaid 全屏共用同一套数学，
 * 方便在 Node 中直接单测。
 */

export interface ZoomTransform {
  scale: number;
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface ZoomLimits {
  min?: number;
  max?: number;
}

export interface FitOptions extends ZoomLimits {
  /** 内容四周保留的空白，默认 32px */
  padding?: number;
  /** 小图是否允许放大到超过原始尺寸，默认 false */
  allowUpscale?: boolean;
}

export type ZoomMode = "readable" | "fit" | "original" | "custom";

export const DEFAULT_MIN_SCALE = 0.1;
export const DEFAULT_MAX_SCALE = 8;
export const DEFAULT_FIT_PADDING = 32;

function isPositiveFinite(value: number | undefined | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function clampScale(scale: number, limits: ZoomLimits = {}): number {
  const min = isPositiveFinite(limits.min) ? limits.min : DEFAULT_MIN_SCALE;
  const max = isPositiveFinite(limits.max) ? limits.max : DEFAULT_MAX_SCALE;
  return clamp(Number.isFinite(scale) ? scale : min, Math.min(min, max), Math.max(min, max));
}

/**
 * 保持屏幕锚点不动的缩放。
 *
 * 设旧变换为 s、x，新缩放为 s'，锚点屏幕坐标为 p，则
 * x' = p - (p - x) * (s' / s)。
 */
export function scaleAtPoint(
  transform: ZoomTransform,
  nextScale: number,
  pointX: number,
  pointY: number,
  limits: ZoomLimits = {}
): ZoomTransform {
  const scale = clampScale(nextScale, limits);
  if (!Number.isFinite(transform.scale) || transform.scale <= 0 || scale === transform.scale) {
    return { ...transform, scale };
  }
  const ratio = scale / transform.scale;
  return {
    scale,
    x: pointX - (pointX - transform.x) * ratio,
    y: pointY - (pointY - transform.y) * ratio,
  };
}

/**
 * 缩放后把内容限制在视口内；内容小于视口时自动居中。
 */
export function clampPan(
  transform: ZoomTransform,
  content: Size,
  viewport: Size,
  margin = 0
): ZoomTransform {
  const scale = clampScale(transform.scale);
  const contentWidth = Math.max(1, content.width) * scale;
  const contentHeight = Math.max(1, content.height) * scale;
  const viewportWidth = Math.max(1, viewport.width);
  const viewportHeight = Math.max(1, viewport.height);

  const x =
    contentWidth <= viewportWidth
      ? (viewportWidth - contentWidth) / 2
      : clamp(transform.x, viewportWidth - contentWidth - margin, margin);
  const y =
    contentHeight <= viewportHeight
      ? (viewportHeight - contentHeight) / 2
      : clamp(transform.y, viewportHeight - contentHeight - margin, margin);

  return { scale, x, y };
}

/**
 * fit 模式缩放：完整显示且默认不放大。
 */
export function fitScale(content: Size, viewport: Size, options: FitOptions = {}): number {
  const padding = Math.max(0, options.padding ?? DEFAULT_FIT_PADDING);
  const availableWidth = Math.max(1, viewport.width - padding * 2);
  const availableHeight = Math.max(1, viewport.height - padding * 2);
  const raw = Math.min(availableWidth / Math.max(1, content.width), availableHeight / Math.max(1, content.height));
  const max = options.allowUpscale
    ? (isPositiveFinite(options.max) ? options.max : DEFAULT_MAX_SCALE)
    : Math.min(1, isPositiveFinite(options.max) ? options.max : 1);
  const min = isPositiveFinite(options.min) ? options.min : DEFAULT_MIN_SCALE;
  return clamp(raw, min, Math.max(min, max));
}

export function centerTransform(content: Size, viewport: Size, scale: number): ZoomTransform {
  const safeScale = clampScale(scale);
  return {
    scale: safeScale,
    x: (Math.max(1, viewport.width) - Math.max(1, content.width) * safeScale) / 2,
    y: (Math.max(1, viewport.height) - Math.max(1, content.height) * safeScale) / 2,
  };
}

export function fitTransform(content: Size, viewport: Size, options: FitOptions = {}): ZoomTransform {
  return centerTransform(content, viewport, fitScale(content, viewport, options));
}

/**
 * 按查看模式计算缩放。
 *
 * - readable：优先保证正文可读，宽度适配但不小于 85%，也不放大超过 100%
 * - fit：完整显示，小内容不放大
 * - original：100%
 * - custom：保持当前缩放（由调用方传入 fallbackScale）
 */
export function modeScale(
  mode: ZoomMode,
  content: Size,
  viewport: Size,
  options: FitOptions & { fallbackScale?: number } = {}
): number {
  const padding = Math.max(0, options.padding ?? DEFAULT_FIT_PADDING);
  const availableWidth = Math.max(1, viewport.width - padding * 2);
  switch (mode) {
    case "readable":
      return clampScale(Math.max(0.85, Math.min(1, availableWidth / Math.max(1, content.width))), options);
    case "fit":
      return fitScale(content, viewport, options);
    case "original":
      return clampScale(1, options);
    case "custom":
    default:
      return clampScale(options.fallbackScale ?? 1, options);
  }
}

export function transformToCss(transform: ZoomTransform): string {
  return `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`;
}

export function applyTransform(element: HTMLElement | SVGElement, transform: ZoomTransform): void {
  element.style.transformOrigin = "0 0";
  element.style.transform = transformToCss(transform);
}

export interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 解析 SVG viewBox，非法值返回 null */
export function parseViewBox(value: string | null | undefined): ViewBox | null {
  if (!value) return null;
  const values = value
    .trim()
    .split(/[\s,]+/)
    .map((item) => Number(item));
  if (values.length !== 4 || values.some((item) => !Number.isFinite(item))) return null;
  const [x, y, width, height] = values;
  if (!isPositiveFinite(width) || !isPositiveFinite(height)) return null;
  return { x, y, width, height };
}

/** 解析 SVG 的 width/height 属性，百分比或带非 px 单位时返回 null */
export function parseSvgLength(value: string | null | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.endsWith("%")) return null;
  if (!/^-?(?:\d+\.?\d*|\.\d+)(?:px)?$/i.test(trimmed)) return null;
  const parsed = Number.parseFloat(trimmed);
  return isPositiveFinite(parsed) ? parsed : null;
}

/**
 * 读取 SVG 的固有尺寸：viewBox 优先，其次数值 width/height，最后测量 DOM。
 * 结果缓存到 dataset，避免反复读取布局。
 */
export function readSvgIntrinsicSize(svg: SVGSVGElement): Size {
  const cachedWidth = Number(svg.dataset?.livemdIntrinsicWidth);
  const cachedHeight = Number(svg.dataset?.livemdIntrinsicHeight);
  if (isPositiveFinite(cachedWidth) && isPositiveFinite(cachedHeight)) {
    return { width: cachedWidth, height: cachedHeight };
  }

  const viewBox = parseViewBox(svg.getAttribute("viewBox"));
  let width = viewBox?.width;
  let height = viewBox?.height;

  if (!isPositiveFinite(width) || !isPositiveFinite(height)) {
    width = parseSvgLength(svg.getAttribute("width")) ?? undefined;
    height = parseSvgLength(svg.getAttribute("height")) ?? undefined;
  }

  if (!isPositiveFinite(width) || !isPositiveFinite(height)) {
    const rect = svg.getBoundingClientRect?.();
    if (rect) {
      width = isPositiveFinite(rect.width) ? rect.width : width;
      height = isPositiveFinite(rect.height) ? rect.height : height;
    }
  }

  const size = {
    width: isPositiveFinite(width) ? width : 800,
    height: isPositiveFinite(height) ? height : 600,
  };

  if (svg.dataset) {
    svg.dataset.livemdIntrinsicWidth = String(size.width);
    svg.dataset.livemdIntrinsicHeight = String(size.height);
  }
  return size;
}

/**
 * 把 Mermaid 输出的百分比尺寸规范化成 viewBox 对应的像素尺寸。
 * 仅用于全屏克隆图，避免修改正文卡片的响应式布局。
 */
export function normalizeMermaidSvgSize(svg: SVGSVGElement): Size {
  const size = readSvgIntrinsicSize(svg);
  const width = Math.max(1, Math.round(size.width));
  const height = Math.max(1, Math.round(size.height));

  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("data-livemd-mermaid", "true");
  svg.style.maxWidth = "none";
  svg.style.width = `${width}px`;
  svg.style.height = `${height}px`;
  svg.style.overflow = "visible";

  return { width, height };
}

/**
 * 根据 g.root 的实际边界修正 viewBox。
 *
 * Mermaid 11 在部分 WebView 中会为 foreignObject 文本计算出过大的边界，
 * 导致 SVG 四周出现数千像素空白。这里只在检测到明显空白时收缩。
 */
export function computeRootAdjustedViewBox(
  viewBox: ViewBox,
  svgRect: RectLike,
  rootRect: RectLike,
  padding = 4
): ViewBox | null {
  if (!isPositiveFinite(viewBox.width) || !isPositiveFinite(viewBox.height)) return null;
  if (!isPositiveFinite(svgRect.width) || !isPositiveFinite(svgRect.height)) return null;
  if (!isPositiveFinite(rootRect.width) || !isPositiveFinite(rootRect.height)) return null;

  const scaleX = viewBox.width / svgRect.width;
  const scaleY = viewBox.height / svgRect.height;
  const width = rootRect.width * scaleX + padding * 2;
  const height = rootRect.height * scaleY + padding * 2;
  if (!isPositiveFinite(width) || !isPositiveFinite(height)) return null;

  const hasBlankBorder = width < viewBox.width * 0.98 || height < viewBox.height * 0.98;
  if (!hasBlankBorder) return null;

  return {
    x: viewBox.x + (rootRect.left - svgRect.left) * scaleX - padding,
    y: viewBox.y + (rootRect.top - svgRect.top) * scaleY - padding,
    width,
    height,
  };
}

function formatViewBoxNumber(value: number): string {
  return Number(value.toFixed(3)).toString();
}

/** 对已渲染的 Mermaid SVG 执行空白边界修正，返回是否修改 */
export function normalizeRenderedMermaidViewport(svg: SVGSVGElement, padding = 4): boolean {
  if (typeof svg.getBoundingClientRect !== "function") return false;
  const root = svg.querySelector("g.root") as SVGGElement | null;
  if (!root || typeof root.getBoundingClientRect !== "function") return false;

  const viewBox = parseViewBox(svg.getAttribute("viewBox"));
  if (!viewBox) return false;

  const adjusted = computeRootAdjustedViewBox(
    viewBox,
    svg.getBoundingClientRect(),
    root.getBoundingClientRect(),
    padding
  );
  if (!adjusted) return false;

  svg.setAttribute(
    "viewBox",
    `${formatViewBoxNumber(adjusted.x)} ${formatViewBoxNumber(adjusted.y)} ${formatViewBoxNumber(
      adjusted.width
    )} ${formatViewBoxNumber(adjusted.height)}`
  );
  if (svg.dataset) {
    svg.dataset.livemdIntrinsicWidth = String(adjusted.width);
    svg.dataset.livemdIntrinsicHeight = String(adjusted.height);
  }
  return true;
}

/**
 * 导出前恢复 Mermaid SVG 的固有尺寸，避免把全屏查看时的缩放状态带入打印。
 */
export function restoreMermaidExportSize(svg: SVGSVGElement): void {
  const size = readSvgIntrinsicSize(svg);
  svg.removeAttribute("data-livemd-fullscreen");
  svg.style.removeProperty("max-width");
  svg.style.removeProperty("width");
  svg.style.removeProperty("height");
  svg.style.removeProperty("overflow");
  svg.setAttribute("width", String(Math.max(1, Math.round(size.width))));
  svg.setAttribute("height", String(Math.max(1, Math.round(size.height))));
}
