/**
 * 表格行高 / 列宽调整（Ctrl + 拖拽）纯函数
 *
 * Markdown 语法本身不携带列宽 / 行高信息，调整结果保存在
 * table_cell / table_header 的 colwidth / rowheight 属性中，
 * 仅在编辑会话内生效（与 Typora 行为一致，序列化回 Markdown 后丢失）。
 *
 * 抽成纯函数的原因：方向判定、上下限钳制、样式值解析、位置推导都是易错边界，
 * 与 ProseMirror 解耦后可零依赖单测（见 test/table-resize.test.mjs）。
 */

/** 边缘命中容差（px）：距 cell 右缘 / 下缘多少像素内判定为可拖拽 */
export const RESIZE_EDGE_TOLERANCE = 6;

/** 列宽下限（px） */
export const MIN_COLUMN_WIDTH = 40;

/** 行高下限（px） */
export const MIN_ROW_HEIGHT = 24;

/** 拖拽方向：col 调整列宽，row 调整行高 */
export type ResizeDirection = "col" | "row";

/**
 * 根据指针相对 cell 的位置判定拖拽方向
 *
 * @param offsetX 指针相对 cell 左缘的横向偏移
 * @param offsetY 指针相对 cell 顶缘的纵向偏移
 * @param width cell 宽度
 * @param height cell 高度
 */
export function computeResizeDirection(
  offsetX: number,
  offsetY: number,
  width: number,
  height: number
): ResizeDirection | null {
  const nearRight = width - offsetX <= RESIZE_EDGE_TOLERANCE;
  const nearBottom = height - offsetY <= RESIZE_EDGE_TOLERANCE;
  // 右下角同时命中时优先列宽调整
  if (nearRight) return "col";
  if (nearBottom) return "row";
  return null;
}

/** 钳制列宽到合法范围（取整） */
export function clampColumnWidth(width: number): number {
  if (!Number.isFinite(width)) return MIN_COLUMN_WIDTH;
  return Math.max(MIN_COLUMN_WIDTH, Math.round(width));
}

/** 钳制行高到合法范围（取整） */
export function clampRowHeight(height: number): number {
  if (!Number.isFinite(height)) return MIN_ROW_HEIGHT;
  return Math.max(MIN_ROW_HEIGHT, Math.round(height));
}

/**
 * 解析 "120px" 样式的值为数字（无效返回 null）
 * 用于从 HTML style 属性中还原 colwidth / rowheight
 */
export function parsePxValue(value: string | null): number | null {
  if (!value) return null;
  const match = /^(\d+(?:\.\d+)?)px$/.exec(value.trim());
  if (!match) return null;
  const num = Number(match[1]);
  return Number.isFinite(num) && num > 0 ? num : null;
}

/**
 * 表格节点的最小形状接口
 * ProseMirror 的 Node 满足该结构；测试用普通对象模拟
 */
export interface TableLikeNode {
  nodeSize: number;
  childCount: number;
  child(index: number): TableLikeNode;
  attrs: Record<string, unknown>;
}

/**
 * 遍历表格中所有 cell 及其在文档中的绝对位置
 *
 * 位置推导：tablePos 指向 table 节点起点，+1 进入内部（首个 row）；
 * row 内 +1 进入 cells；随后按 nodeSize 累进。
 */
export function forEachTableCell(
  tableNode: TableLikeNode,
  tablePos: number,
  callback: (cell: TableLikeNode, pos: number, rowIdx: number, colIdx: number) => void
): void {
  let rowPos = tablePos + 1;
  for (let rowIdx = 0; rowIdx < tableNode.childCount; rowIdx += 1) {
    const row = tableNode.child(rowIdx);
    let cellPos = rowPos + 1;
    for (let colIdx = 0; colIdx < row.childCount; colIdx += 1) {
      const cell = row.child(colIdx);
      callback(cell, cellPos, rowIdx, colIdx);
      cellPos += cell.nodeSize;
    }
    rowPos += row.nodeSize;
  }
}
