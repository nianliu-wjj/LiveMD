/**
 * Mermaid 流程图交互：节点拖动 + 连线跟随 + 位置恢复 + 双击事件
 *
 * Mermaid 的 SVG 是一次性产物，这里不重新布局，而是直接改写已渲染的 SVG：
 * - 节点 `<g class="node">`：在自动布局坐标上叠加位移；
 * - 连线 `<path data-edge>`：取 Mermaid 写在 data-points 里的原始折点，两端随节点平移、
 *   中间折点按比例插值，端点重新裁剪到节点边框，再用与 Mermaid 默认一致的 basis 曲线生成路径；
 * - 连线标签：跟随两端位移的平均值。
 *
 * 位移作用在每次渲染得到的新 SVG 上，因此 SVG 字符串缓存里始终是未改动的自动布局结果。
 * 几何计算均为纯函数（导出供单元测试），DOM 操作只发生在 attachMermaidInteractions 内。
 */
import { isFlowchartSource, type MermaidPositions } from "../utils/diagram-meta.ts";

export interface Point {
  x: number;
  y: number;
}

export interface MermaidInteractionHooks {
  /** 只读时禁止拖动与编辑 */
  isReadOnly: () => boolean;
  /** 拖动结束：交回完整位移表 */
  onLayoutChange: (positions: MermaidPositions) => void;
  /** 双击流程图节点 */
  onEditNode: (id: string, label: string, element: SVGGElement) => void;
  /** 双击图表其它位置 / 非流程图：回退到编辑源码 */
  onEditSource: () => void;
}

/** 超过该屏幕像素才算拖动，避免单击 / 双击时的手抖被记录成位移 */
const DRAG_THRESHOLD_PX = 3;
/** 拖动后扩展 viewBox 时四周保留的留白 */
const VIEWBOX_PADDING = 8;

const fmt = (value: number): string => String(Math.round(value * 100) / 100);

/** 与 d3.curveBasis 相同的路径生成（Mermaid 流程图的默认曲线），保证拖动前后线型一致 */
export function buildBasisPath(points: readonly Point[]): string {
  if (points.length === 0) return "";
  const [first] = points;
  let d = `M${fmt(first.x)},${fmt(first.y)}`;
  if (points.length === 1) return d;
  if (points.length === 2) return `${d}L${fmt(points[1].x)},${fmt(points[1].y)}`;

  const lineTo = (x: number, y: number) => {
    d += `L${fmt(x)},${fmt(y)}`;
  };
  const curveTo = (p0: Point, p1: Point, next: Point) => {
    d +=
      `C${fmt((2 * p0.x + p1.x) / 3)},${fmt((2 * p0.y + p1.y) / 3)},` +
      `${fmt((p0.x + 2 * p1.x) / 3)},${fmt((p0.y + 2 * p1.y) / 3)},` +
      `${fmt((p0.x + 4 * p1.x + next.x) / 6)},${fmt((p0.y + 4 * p1.y + next.y) / 6)}`;
  };

  lineTo((5 * points[0].x + points[1].x) / 6, (5 * points[0].y + points[1].y) / 6);
  for (let index = 2; index < points.length; index += 1) {
    curveTo(points[index - 2], points[index - 1], points[index]);
  }
  const last = points[points.length - 1];
  curveTo(points[points.length - 2], last, last);
  lineTo(last.x, last.y);
  return d;
}

/** 从矩形中心指向 target 的射线与矩形边框的交点；target 在矩形内时返回 null */
export function clipToBox(
  center: Point,
  halfW: number,
  halfH: number,
  target: Point
): Point | null {
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  if (Math.abs(dx) <= halfW && Math.abs(dy) <= halfH) return null;
  const scale = Math.min(
    dx === 0 ? Number.POSITIVE_INFINITY : halfW / Math.abs(dx),
    dy === 0 ? Number.POSITIVE_INFINITY : halfH / Math.abs(dy)
  );
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

/**
 * 根据两端位移计算连线新折点
 * @param box 两端节点当前的中心与半宽高（尺寸未知时为 null，端点只做平移）
 */
export function moveEdgePoints(
  base: readonly Point[],
  sourceDelta: MermaidOffset,
  targetDelta: MermaidOffset,
  box: { source: NodeBox | null; target: NodeBox | null } = { source: null, target: null }
): Point[] {
  const last = base.length - 1;
  const moved = base.map((point, index) => {
    const t = last === 0 ? 0 : index / last;
    return {
      x: point.x + sourceDelta.dx + (targetDelta.dx - sourceDelta.dx) * t,
      y: point.y + sourceDelta.dy + (targetDelta.dy - sourceDelta.dy) * t,
    };
  });
  if (last < 1) return moved;

  if (box.source) {
    moved[0] =
      clipToBox(box.source.center, box.source.halfW, box.source.halfH, moved[1]) ?? moved[0];
  }
  if (box.target) {
    moved[last] =
      clipToBox(box.target.center, box.target.halfW, box.target.halfH, moved[last - 1]) ??
      moved[last];
  }
  return moved;
}

interface MermaidOffset {
  dx: number;
  dy: number;
}

interface NodeBox {
  center: Point;
  halfW: number;
  halfH: number;
}

/** 从 Mermaid 节点 DOM id 取节点 id：`flowchart-A-0` / `mermaid-1-flowchart-A-0` → `A` */
export function parseNodeId(domId: string): string | null {
  return /flowchart-(.+)-\d+$/.exec(domId)?.[1] ?? null;
}

/**
 * 从连线 id 解析两端节点：`L_A_B_0`（旧版为 `L-A-B-0`）。
 * 节点 id 本身可含 `_` / `-`，单靠分隔符无法切分，因此用已知节点集合匹配，取最长匹配。
 */
export function parseEdgeEnds(edgeId: string, nodeIds: readonly string[]): [string, string] | null {
  const marker = /(?:^|[-_])L[-_]/.exec(edgeId);
  if (!marker) return null;
  const body = edgeId.slice(marker.index + marker[0].length);

  let best: [string, string] | null = null;
  for (const from of nodeIds) {
    if (!body.startsWith(from) || !/[-_]/.test(body[from.length] ?? "")) continue;
    const rest = body.slice(from.length + 1);
    for (const to of nodeIds) {
      if (!rest.startsWith(to) || !/^[-_]\d+/.test(rest.slice(to.length))) continue;
      if (!best || from.length + to.length > best[0].length + best[1].length) best = [from, to];
    }
  }
  return best;
}

/** 解析 translate(x, y)（缺失时为 0,0） */
function parseTranslate(element: Element | null): Point {
  const match = /translate\(\s*(-?[\d.eE+-]+)[\s,]*(-?[\d.eE+-]+)?/.exec(
    element?.getAttribute("transform") ?? ""
  );
  return { x: match ? Number(match[1]) : 0, y: match?.[2] ? Number(match[2]) : 0 };
}

/** 祖先 g 的累计平移：节点与连线可能分属不同的嵌套 root，换算到同一坐标系（隐藏时也可用） */
function ancestorOffset(element: Element, svg: SVGSVGElement): Point {
  const offset = { x: 0, y: 0 };
  for (let current = element.parentElement; current && current !== (svg as Element); ) {
    const translate = parseTranslate(current);
    offset.x += translate.x;
    offset.y += translate.y;
    current = current.parentElement;
  }
  return offset;
}

interface NodeEntry {
  id: string;
  element: SVGGElement;
  /** 自动布局的 translate（局部坐标） */
  base: Point;
  /** 祖先累计平移 */
  offset: Point;
  /** 半宽高：隐藏状态取不到尺寸时为 0 */
  halfW: number;
  halfH: number;
  delta: MermaidOffset;
}

interface EdgeEntry {
  element: SVGPathElement;
  source: NodeEntry;
  target: NodeEntry;
  points: Point[];
  offset: Point;
  label: SVGGElement | null;
  labelBase: Point;
}

function readEdgePoints(path: SVGPathElement): Point[] {
  const encoded = path.getAttribute("data-points");
  if (encoded) {
    try {
      const points = JSON.parse(atob(encoded)) as Point[];
      if (Array.isArray(points) && points.length >= 2) return points;
    } catch (error) {
      console.warn("[mermaid-interactions] data-points 解析失败，退化为首尾直线:", error);
    }
  }
  const numbers = (path.getAttribute("d") ?? "").match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (numbers.length < 4) return [];
  return [
    { x: numbers[0], y: numbers[1] },
    { x: numbers[numbers.length - 2], y: numbers[numbers.length - 1] },
  ];
}

function readNodeSize(element: SVGGElement): { halfW: number; halfH: number } {
  try {
    const box = element.getBBox();
    return { halfW: box.width / 2, halfH: box.height / 2 };
  } catch {
    return { halfW: 0, halfH: 0 };
  }
}

function collectNodes(svg: SVGSVGElement): Map<string, NodeEntry> {
  const nodes = new Map<string, NodeEntry>();
  svg.querySelectorAll<SVGGElement>("g.node[id]").forEach((element) => {
    const id = parseNodeId(element.id);
    if (!id || nodes.has(id)) return;
    nodes.set(id, {
      id,
      element,
      base: parseTranslate(element),
      offset: ancestorOffset(element, svg),
      ...readNodeSize(element),
      delta: { dx: 0, dy: 0 },
    });
  });
  return nodes;
}

function collectEdges(svg: SVGSVGElement, nodes: Map<string, NodeEntry>): EdgeEntry[] {
  const ids = [...nodes.keys()];
  const edges: EdgeEntry[] = [];
  svg.querySelectorAll<SVGPathElement>('path[data-edge="true"]').forEach((element) => {
    const edgeId = element.getAttribute("data-id") ?? element.id;
    const ends = parseEdgeEnds(edgeId, ids);
    const points = readEdgePoints(element);
    if (!ends || points.length < 2) {
      console.debug("[mermaid-interactions] 跳过无法解析的连线:", edgeId);
      return;
    }
    const label = (svg.querySelector(`g.edgeLabel > g.label[data-id="${CSS.escape(edgeId)}"]`)
      ?.parentElement ?? null) as SVGGElement | null;
    edges.push({
      element,
      source: nodes.get(ends[0]) as NodeEntry,
      target: nodes.get(ends[1]) as NodeEntry,
      points,
      offset: ancestorOffset(element, svg),
      label,
      labelBase: parseTranslate(label),
    });
  });
  return edges;
}

/** 节点当前边框（换算到连线所在坐标系）；尺寸未知时返回 null */
function boxInEdgeSpace(node: NodeEntry, edge: EdgeEntry): NodeBox | null {
  if (node.halfW === 0 || node.halfH === 0) return null;
  return {
    center: {
      x: node.base.x + node.delta.dx + node.offset.x - edge.offset.x,
      y: node.base.y + node.delta.dy + node.offset.y - edge.offset.y,
    },
    halfW: node.halfW,
    halfH: node.halfH,
  };
}

function renderEdge(edge: EdgeEntry): void {
  const isSelfLoop = edge.source === edge.target;
  const points = moveEdgePoints(
    edge.points,
    edge.source.delta,
    edge.target.delta,
    isSelfLoop
      ? { source: null, target: null }
      : { source: boxInEdgeSpace(edge.source, edge), target: boxInEdgeSpace(edge.target, edge) }
  );
  edge.element.setAttribute("d", buildBasisPath(points));
  if (edge.label) {
    const x = edge.labelBase.x + (edge.source.delta.dx + edge.target.delta.dx) / 2;
    const y = edge.labelBase.y + (edge.source.delta.dy + edge.target.delta.dy) / 2;
    edge.label.setAttribute("transform", `translate(${fmt(x)}, ${fmt(y)})`);
  }
}

function renderNode(node: NodeEntry): void {
  node.element.setAttribute(
    "transform",
    `translate(${fmt(node.base.x + node.delta.dx)}, ${fmt(node.base.y + node.delta.dy)})`
  );
}

/** 扩展 viewBox 容纳移出原边界的节点，并按比例放宽 max-width，避免图表整体被缩小 */
function fitViewBox(
  svg: SVGSVGElement,
  nodes: Map<string, NodeEntry>,
  base: { x: number; y: number; width: number; height: number; maxWidth: number } | null
): void {
  if (!base) return;
  let minX = base.x;
  let minY = base.y;
  let maxX = base.x + base.width;
  let maxY = base.y + base.height;
  for (const node of nodes.values()) {
    if (node.delta.dx === 0 && node.delta.dy === 0) continue;
    const cx = node.base.x + node.delta.dx + node.offset.x;
    const cy = node.base.y + node.delta.dy + node.offset.y;
    minX = Math.min(minX, cx - node.halfW - VIEWBOX_PADDING);
    minY = Math.min(minY, cy - node.halfH - VIEWBOX_PADDING);
    maxX = Math.max(maxX, cx + node.halfW + VIEWBOX_PADDING);
    maxY = Math.max(maxY, cy + node.halfH + VIEWBOX_PADDING);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  svg.setAttribute("viewBox", `${fmt(minX)} ${fmt(minY)} ${fmt(width)} ${fmt(height)}`);
  if (base.maxWidth > 0) {
    svg.style.maxWidth = `${fmt((base.maxWidth * width) / base.width)}px`;
  }
  // 全屏查看与导出按该固有尺寸计算
  svg.dataset.livemdIntrinsicWidth = String(width);
  svg.dataset.livemdIntrinsicHeight = String(height);
}

function readBaseViewBox(svg: SVGSVGElement) {
  const values = (svg.getAttribute("viewBox") ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (values.length !== 4 || !values.every(Number.isFinite)) return null;
  const [x, y, width, height] = values;
  return { x, y, width, height, maxWidth: Number.parseFloat(svg.style.maxWidth) || 0 };
}

/**
 * 在渲染完成的 SVG 上恢复保存的位置并挂载交互，返回清理函数
 */
export function attachMermaidInteractions(
  svg: SVGSVGElement,
  source: string,
  positions: MermaidPositions | null,
  hooks: MermaidInteractionHooks
): () => void {
  const isFlowchart = isFlowchartSource(source);

  const handleDblClick = (event: MouseEvent) => {
    if (hooks.isReadOnly()) return;
    event.preventDefault();
    event.stopPropagation();
    const element = (event.target as Element).closest<SVGGElement>("g.node[id]");
    const id = element ? parseNodeId(element.id) : null;
    if (isFlowchart && element && id) {
      hooks.onEditNode(id, element.querySelector(".nodeLabel")?.textContent?.trim() ?? "", element);
    } else {
      hooks.onEditSource();
    }
  };
  svg.addEventListener("dblclick", handleDblClick);

  // 时序图、ER 图等由各自引擎布局，没有可平移的节点结构，只提供双击编辑源码
  if (!isFlowchart) {
    return () => svg.removeEventListener("dblclick", handleDblClick);
  }

  const nodes = collectNodes(svg);
  const edges = collectEdges(svg, nodes);
  const baseViewBox = readBaseViewBox(svg);
  svg.classList.add("livemd-mermaid-draggable");

  // 恢复保存的位置；节点已从源码删除的旧记录直接忽略
  if (positions) {
    for (const [id, offset] of Object.entries(positions)) {
      const node = nodes.get(id);
      if (!node) continue;
      node.delta = { dx: offset.dx, dy: offset.dy };
      renderNode(node);
    }
    edges.forEach(renderEdge);
    fitViewBox(svg, nodes, baseViewBox);
  }

  const currentPositions = (): MermaidPositions => {
    const result: MermaidPositions = {};
    for (const node of nodes.values()) {
      if (node.delta.dx !== 0 || node.delta.dy !== 0) result[node.id] = { ...node.delta };
    }
    return result;
  };

  let endActiveDrag: (() => void) | null = null;

  const handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || hooks.isReadOnly()) return;
    const element = (event.target as Element).closest<SVGGElement>("g.node[id]");
    const id = element ? parseNodeId(element.id) : null;
    const node = id ? nodes.get(id) : undefined;
    if (!element || !node) return;

    const startX = event.clientX;
    const startY = event.clientY;
    const startDelta = { ...node.delta };
    // 屏幕像素 → SVG 用户坐标（已含 viewBox 缩放与编辑器缩放）
    const scale = svg.getScreenCTM()?.a || 1;
    const related = edges.filter((edge) => edge.source === node || edge.target === node);
    let dragging = false;

    const onMove = (moveEvent: PointerEvent) => {
      const screenDx = moveEvent.clientX - startX;
      const screenDy = moveEvent.clientY - startY;
      if (!dragging) {
        if (Math.hypot(screenDx, screenDy) < DRAG_THRESHOLD_PX) return;
        dragging = true;
        element.classList.add("is-dragging");
        try {
          element.setPointerCapture(event.pointerId);
        } catch {
          // 捕获失败时仍由 window 级监听兜底
        }
      }
      moveEvent.preventDefault();
      node.delta = { dx: startDelta.dx + screenDx / scale, dy: startDelta.dy + screenDy / scale };
      renderNode(node);
      related.forEach(renderEdge);
    };

    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      endActiveDrag = null;
      if (!dragging) return;
      element.classList.remove("is-dragging");
      if (!commit) {
        node.delta = startDelta;
        renderNode(node);
        related.forEach(renderEdge);
        return;
      }
      // 吞掉拖动结束后的 click，避免触发节点上的 click 链接
      svg.addEventListener("click", (clickEvent) => clickEvent.stopPropagation(), {
        capture: true,
        once: true,
      });
      fitViewBox(svg, nodes, baseViewBox);
      console.debug("[mermaid-interactions] 节点拖动完成:", node.id, node.delta);
      hooks.onLayoutChange(currentPositions());
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    endActiveDrag = onCancel;
  };

  svg.addEventListener("pointerdown", handlePointerDown);

  return () => {
    endActiveDrag?.();
    svg.removeEventListener("pointerdown", handlePointerDown);
    svg.removeEventListener("dblclick", handleDblClick);
  };
}
