/**
 * 思维导图布局 + SVG 渲染（自研，无第三方依赖）
 *
 * 布局采用「左右分布的 tidy tree」：
 * 1. 后序遍历 measure：自底向上计算每个节点子树占用的总高度；
 * 2. 根节点居中，一级分支按子树高度贪心分成右、左两组，使两侧高度尽量均衡；
 * 3. 前序遍历 assign：自顶向下为节点分配坐标——x 由深度决定（右侧向右展开、左侧镜像向左），
 *    y 在父节点分得的纵向区间内按子树高度依次排布并整体居中。
 *
 * 渲染输出纯 SVG 字符串：连线为三次贝塞尔曲线，一级分支按序取色、子孙节点沿用分支颜色。
 * 颜色通过 CSS class + CSS 变量控制，自动适配明暗主题（样式见 core/styles/livemd.css）。
 */

import { parseMindMap, type MindMapNode } from "../utils/mindmap-markdown.ts";

/** 布局后的节点 */
export interface MindMapLayoutNode {
  id: string;
  text: string;
  /** 显示文本（过长时截断加省略号） */
  label: string;
  depth: number;
  /** 节点左上角坐标与尺寸 */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 所在侧：1 右侧、-1 左侧、0 根节点 */
  side: 1 | -1 | 0;
  /** 所属一级分支的序号（根节点为 -1），用于取色 */
  branch: number;
}

/** 布局后的连线 */
export interface MindMapLayoutEdge {
  from: string;
  to: string;
  /** SVG path d 属性 */
  path: string;
  depth: number;
  branch: number;
}

export interface MindMapLayout {
  nodes: MindMapLayoutNode[];
  edges: MindMapLayoutEdge[];
  width: number;
  height: number;
}

export interface MindMapRenderOptions {
  /** 当前选中的节点 id（编辑弹窗中高亮） */
  selectedId?: string | null;
  /** 是否为交互模式（编辑弹窗）：节点显示手型光标 */
  interactive?: boolean;
}

/** 布局参数 */
const LEVEL_GAP = 44; // 相邻层级的水平间距
const SIBLING_GAP = 10; // 兄弟子树之间的垂直间距
const CANVAS_PADDING = 24; // 画布四周留白
const MAX_LABEL_WIDTH = 220; // 单个节点文本的最大显示宽度

/** 各层级节点的字号 / 高度 / 水平内边距 */
function getLevelMetrics(depth: number): { fontSize: number; height: number; padX: number } {
  if (depth === 0) return { fontSize: 16, height: 42, padX: 20 };
  if (depth === 1) return { fontSize: 14, height: 32, padX: 14 };
  return { fontSize: 13, height: 26, padX: 8 };
}

/** 估算文本宽度：CJK / 全角字符按 1 个字号宽，其它按 0.6 个字号宽（无需 DOM 测量，可同步渲染） */
export function estimateTextWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const char of text) {
    width += /[⺀-鿿가-힯＀-￯]/.test(char) ? fontSize : fontSize * 0.6;
  }
  return width;
}

/** 文本超出最大宽度时截断并补省略号 */
function truncateLabel(text: string, fontSize: number): string {
  if (estimateTextWidth(text, fontSize) <= MAX_LABEL_WIDTH) return text;
  let result = "";
  for (const char of text) {
    if (estimateTextWidth(`${result}${char}…`, fontSize) > MAX_LABEL_WIDTH) break;
    result += char;
  }
  return `${result}…`;
}

/** 布局过程中的中间结构 */
interface MeasuredNode {
  source: MindMapNode;
  depth: number;
  label: string;
  width: number;
  height: number;
  /** 子树总高度（含兄弟间距） */
  subtreeHeight: number;
  children: MeasuredNode[];
}

/** 后序遍历：计算节点尺寸与子树高度 */
function measure(node: MindMapNode, depth: number): MeasuredNode {
  const metrics = getLevelMetrics(depth);
  const label = truncateLabel(node.text, metrics.fontSize);
  const width = Math.ceil(estimateTextWidth(label, metrics.fontSize) + metrics.padX * 2);
  const children = node.children.map((child) => measure(child, depth + 1));
  const childrenHeight = sumHeights(children);
  return {
    source: node,
    depth,
    label,
    width: Math.max(width, depth === 0 ? 96 : 40),
    height: metrics.height,
    subtreeHeight: Math.max(metrics.height, childrenHeight),
    children,
  };
}

/** 一组兄弟子树的总高度（含间距） */
function sumHeights(nodes: MeasuredNode[]): number {
  if (nodes.length === 0) return 0;
  return (
    nodes.reduce((sum, node) => sum + node.subtreeHeight, 0) + SIBLING_GAP * (nodes.length - 1)
  );
}

/**
 * 计算思维导图布局
 */
export function layoutMindMap(root: MindMapNode): MindMapLayout {
  const measuredRoot = measure(root, 0);
  const nodes: MindMapLayoutNode[] = [];
  const edges: MindMapLayoutEdge[] = [];

  // 一级分支按子树高度贪心分组：先填右侧直到超过一半，其余放左侧（保持原有顺序）
  const total = sumHeights(measuredRoot.children);
  const right: MeasuredNode[] = [];
  const left: MeasuredNode[] = [];
  let rightHeight = 0;
  measuredRoot.children.forEach((child, index) => {
    // 只有 1 个分支时放右侧；其余情况右侧达到一半后转入左侧
    if (index === 0 || rightHeight + child.subtreeHeight / 2 <= total / 2) {
      right.push(child);
      rightHeight += child.subtreeHeight + SIBLING_GAP;
    } else {
      left.push(child);
    }
  });

  // 根节点中心位于 (0, 0)
  const rootX = -measuredRoot.width / 2;
  const rootY = -measuredRoot.height / 2;
  nodes.push({
    id: root.id,
    text: root.text,
    label: measuredRoot.label,
    depth: 0,
    x: rootX,
    y: rootY,
    width: measuredRoot.width,
    height: measuredRoot.height,
    side: 0,
    branch: -1,
  });

  /** 前序遍历：在纵向区间 [top, top + subtreeHeight] 内放置节点及其子树 */
  const assign = (
    node: MeasuredNode,
    parent: MindMapLayoutNode,
    top: number,
    side: 1 | -1,
    branch: number
  ) => {
    const centerY = top + node.subtreeHeight / 2;
    const x = side === 1 ? parent.x + parent.width + LEVEL_GAP : parent.x - LEVEL_GAP - node.width;
    const placed: MindMapLayoutNode = {
      id: node.source.id,
      text: node.source.text,
      label: node.label,
      depth: node.depth,
      x,
      y: centerY - node.height / 2,
      width: node.width,
      height: node.height,
      side,
      branch,
    };
    nodes.push(placed);
    edges.push({
      from: parent.id,
      to: placed.id,
      path: buildEdgePath(parent, placed, side),
      depth: node.depth,
      branch,
    });

    // 子节点整体在本节点子树区间内居中
    let childTop = top + (node.subtreeHeight - sumHeights(node.children)) / 2;
    for (const child of node.children) {
      assign(child, placed, childTop, side, branch);
      childTop += child.subtreeHeight + SIBLING_GAP;
    }
  };

  const rootNode = nodes[0];
  const placeSide = (group: MeasuredNode[], side: 1 | -1, branchOffset: number) => {
    let top = -sumHeights(group) / 2;
    group.forEach((child, index) => {
      assign(child, rootNode, top, side, branchOffset + index);
      top += child.subtreeHeight + SIBLING_GAP;
    });
  };
  placeSide(right, 1, 0);
  placeSide(left, -1, right.length);

  // 平移到正坐标系并加留白
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxX = Math.max(...nodes.map((node) => node.x + node.width));
  const maxY = Math.max(...nodes.map((node) => node.y + node.height));
  const dx = CANVAS_PADDING - minX;
  const dy = CANVAS_PADDING - minY;
  for (const node of nodes) {
    node.x += dx;
    node.y += dy;
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const edge of edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (from && to) edge.path = buildEdgePath(from, to, to.side === -1 ? -1 : 1);
  }

  return {
    nodes,
    edges,
    width: Math.ceil(maxX - minX + CANVAS_PADDING * 2),
    height: Math.ceil(maxY - minY + CANVAS_PADDING * 2),
  };
}

/** 父节点侧边中点 → 子节点对侧边中点的三次贝塞尔曲线 */
function buildEdgePath(parent: MindMapLayoutNode, child: MindMapLayoutNode, side: 1 | -1): string {
  const startX = side === 1 ? parent.x + parent.width : parent.x;
  const startY = parent.y + parent.height / 2;
  const endX = side === 1 ? child.x : child.x + child.width;
  // 二级及以下节点为「下划线」样式，连线落到节点底边
  const endY = child.depth >= 2 ? child.y + child.height : child.y + child.height / 2;
  const control = (endX - startX) / 2;
  const r = (value: number) => Math.round(value * 10) / 10;
  return `M ${r(startX)} ${r(startY)} C ${r(startX + control)} ${r(startY)}, ${r(endX - control)} ${r(endY)}, ${r(endX)} ${r(endY)}`;
}

/** 分支配色数量（与 livemd.css 中 .livemd-mindmap-branch-N 对应） */
export const MINDMAP_BRANCH_COLORS = 8;

/** XML 特殊字符转义 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 渲染布局为 SVG 字符串
 */
export function renderMindMapLayout(
  layout: MindMapLayout,
  options: MindMapRenderOptions = {}
): string {
  const parts: string[] = [];
  const branchClass = (branch: number) =>
    branch < 0 ? "" : ` livemd-mindmap-branch-${branch % MINDMAP_BRANCH_COLORS}`;

  parts.push(
    `<svg class="livemd-mindmap-svg${options.interactive ? " is-interactive" : ""}" xmlns="http://www.w3.org/2000/svg" ` +
      `viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}" role="img">`
  );

  // 先画连线，节点覆盖在连线之上
  parts.push('<g class="livemd-mindmap-edges">');
  for (const edge of layout.edges) {
    const strokeWidth = edge.depth === 1 ? 2.5 : edge.depth === 2 ? 1.8 : 1.4;
    parts.push(
      `<path class="livemd-mindmap-edge${branchClass(edge.branch)}" d="${edge.path}" fill="none" stroke-width="${strokeWidth}" stroke-linecap="round" />`
    );
  }
  parts.push("</g>");

  parts.push('<g class="livemd-mindmap-nodes">');
  for (const node of layout.nodes) {
    const metrics = getLevelMetrics(node.depth);
    const selected = options.selectedId === node.id ? " is-selected" : "";
    const levelClass = node.depth === 0 ? "is-root" : node.depth === 1 ? "is-branch" : "is-leaf";
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    parts.push(
      `<g class="livemd-mindmap-node ${levelClass}${branchClass(node.branch)}${selected}" data-node-id="${escapeXml(node.id)}">`
    );
    parts.push(`<title>${escapeXml(node.text)}</title>`);
    if (node.depth <= 1) {
      parts.push(
        `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${node.depth === 0 ? 10 : 8}" />`
      );
    } else {
      // 子孙节点：透明点击区 + 底部下划线（XMind 风格）
      parts.push(
        `<rect class="livemd-mindmap-hit" x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="4" />`
      );
      parts.push(
        `<line x1="${node.x}" y1="${node.y + node.height}" x2="${node.x + node.width}" y2="${node.y + node.height}" stroke-width="1.6" stroke-linecap="round" />`
      );
    }
    parts.push(
      `<text x="${cx}" y="${cy}" font-size="${metrics.fontSize}" text-anchor="middle" dominant-baseline="central">${escapeXml(node.label)}</text>`
    );
    parts.push("</g>");
  }
  parts.push("</g></svg>");
  return parts.join("");
}

/**
 * 解析缩进层级文本并直接渲染为 SVG（代码块预览使用，同步执行）
 */
export function renderMindMapSvg(source: string, options: MindMapRenderOptions = {}): string {
  return renderMindMapLayout(layoutMindMap(parseMindMap(source)), options);
}
