/**
 * Livemd 编辑器命令
 *
 * 提供常用的编辑操作命令
 */

import { EditorState, Transaction, TextSelection } from "prosemirror-state";
import { Fragment, Node, Mark, MarkType, NodeType } from "prosemirror-model";
import { toggleMark, setBlockType, wrapIn, lift } from "prosemirror-commands";

type Command = (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean;

/**
 * 切换粗体
 */
export function toggleStrong(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const markType = state.schema.marks.strong;
  if (!markType) return false;
  return toggleMark(markType)(state, dispatch);
}

/**
 * 切换斜体
 */
export function toggleEmphasis(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const markType = state.schema.marks.emphasis;
  if (!markType) return false;
  return toggleMark(markType)(state, dispatch);
}

/**
 * 切换行内代码
 */
export function toggleCodeInline(
  state: EditorState,
  dispatch?: (tr: Transaction) => void
): boolean {
  const markType = state.schema.marks.code_inline;
  if (!markType) return false;
  return toggleMark(markType)(state, dispatch);
}

/**
 * 切换删除线
 */
export function toggleStrikethrough(
  state: EditorState,
  dispatch?: (tr: Transaction) => void
): boolean {
  const markType = state.schema.marks.strikethrough;
  if (!markType) return false;
  return toggleMark(markType)(state, dispatch);
}

/**
 * 切换高亮
 */
export function toggleHighlight(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const markType = state.schema.marks.highlight;
  if (!markType) return false;
  return toggleMark(markType)(state, dispatch);
}

/**
 * 设置标题级别
 */
export function setHeading(level: number): Command {
  return (state, dispatch) => {
    const nodeType = state.schema.nodes.heading;
    if (!nodeType) return false;
    return setBlockType(nodeType, { level })(state, dispatch);
  };
}

/**
 * 设置为段落
 */
export function setParagraph(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const nodeType = state.schema.nodes.paragraph;
  if (!nodeType) return false;
  return setBlockType(nodeType)(state, dispatch);
}

/**
 * 设置为代码块
 */
export function setCodeBlock(language = ""): Command {
  return (state, dispatch) => {
    const nodeType = state.schema.nodes.code_block;
    if (!nodeType) return false;
    return setBlockType(nodeType, { language })(state, dispatch);
  };
}

/**
 * 包装为引用块
 */
export function wrapInBlockquote(
  state: EditorState,
  dispatch?: (tr: Transaction) => void
): boolean {
  const nodeType = state.schema.nodes.blockquote;
  if (!nodeType) return false;
  return wrapIn(nodeType)(state, dispatch);
}

/**
 * 包装为无序列表
 */
export function wrapInBulletList(
  state: EditorState,
  dispatch?: (tr: Transaction) => void
): boolean {
  const nodeType = state.schema.nodes.bullet_list;
  if (!nodeType) return false;
  return wrapIn(nodeType)(state, dispatch);
}

/**
 * 包装为有序列表
 */
export function wrapInOrderedList(
  state: EditorState,
  dispatch?: (tr: Transaction) => void
): boolean {
  const nodeType = state.schema.nodes.ordered_list;
  if (!nodeType) return false;
  return wrapIn(nodeType)(state, dispatch);
}

/**
 * 取消包装（提升）
 */
export function liftBlock(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  return lift(state, dispatch);
}

/**
 * 插入分隔线
 */
export function insertHorizontalRule(
  state: EditorState,
  dispatch?: (tr: Transaction) => void
): boolean {
  const nodeType = state.schema.nodes.horizontal_rule;
  if (!nodeType) return false;

  if (dispatch) {
    const tr = state.tr.replaceSelectionWith(nodeType.create());
    dispatch(tr.scrollIntoView());
  }
  return true;
}

/**
 * 插入图片
 */
export function insertImage(src: string, alt = "", title = ""): Command {
  return (state, dispatch) => {
    const nodeType = state.schema.nodes.image;
    if (!nodeType) return false;

    if (dispatch) {
      const node = nodeType.create({ src, alt, title });
      const tr = state.tr.replaceSelectionWith(node);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/**
 * 插入链接
 */
export function insertLink(href: string, title = ""): Command {
  return (state, dispatch) => {
    const markType = state.schema.marks.link;
    if (!markType) return false;

    const { from, to, empty } = state.selection;

    if (dispatch) {
      const mark = markType.create({ href, title });
      let tr = state.tr;

      if (empty) {
        // 没有选中文本，插入链接文本
        const text = title || href;
        tr = tr.insertText(text, from);
        tr = tr.addMark(from, from + text.length, mark);
      } else {
        // 有选中文本，添加链接
        tr = tr.addMark(from, to, mark);
      }

      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/**
 * 移除链接
 */
export function removeLink(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const markType = state.schema.marks.link;
  if (!markType) return false;

  const { from, to } = state.selection;

  if (dispatch) {
    const tr = state.tr.removeMark(from, to, markType);
    dispatch(tr);
  }
  return true;
}

/**
 * 插入表格
 */
export function insertTable(rows = 3, cols = 3): Command {
  return (state, dispatch) => {
    const { table, table_row, table_header, table_cell, paragraph } = state.schema.nodes;
    if (!table || !table_row || !table_header || !table_cell) return false;

    if (dispatch) {
      const tableRows: Node[] = [];

      // 表头行
      const headerCells: Node[] = [];
      for (let c = 0; c < cols; c++) {
        // 单元格内容用空行内内容（与解析器产出一致）；放入段落节点会与 schema 的 inline* 约束冲突，
        // 导致后续「重建单元格」的命令（按列对齐、调整行列等）触发内容校验失败
        headerCells.push(table_header.create(null));
      }
      tableRows.push(table_row.create(null, headerCells));

      // 数据行
      for (let r = 1; r < rows; r++) {
        const cells: Node[] = [];
        for (let c = 0; c < cols; c++) {
          cells.push(table_cell.create(null));
        }
        tableRows.push(table_row.create(null, cells));
      }

      const tableNode = table.create(null, tableRows);
      const tr = state.tr.replaceSelectionWith(tableNode);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/**
 * 查找光标所在的表格上下文
 */
function findTableContext(state: EditorState) {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === "table") {
      // 找到 table_row 和 table_cell 的 depth
      let rowDepth = -1;
      let cellDepth = -1;
      for (let d = $from.depth; d > depth; d--) {
        const n = $from.node(d);
        if (n.type.name === "table_row") rowDepth = d;
        if (n.type.name === "table_cell" || n.type.name === "table_header") cellDepth = d;
      }
      if (rowDepth === -1 || cellDepth === -1) return null;
      const rowIndex = $from.index(depth);
      const cellIndex = $from.index(rowDepth);
      return {
        tableDepth: depth,
        tableStart: $from.before(depth),
        tableNode: node,
        rowDepth,
        rowIndex,
        cellDepth,
        cellIndex,
      };
    }
  }
  return null;
}

/**
 * 创建一行新的 cells
 */
function createRow(state: EditorState, colCount: number, useHeader: boolean): Node {
  const { table_row, table_header, table_cell, paragraph } = state.schema.nodes;
  const cellType = useHeader ? table_header : table_cell;
  const cells: Node[] = [];
  for (let i = 0; i < colCount; i++) {
    cells.push(cellType.create(null));
  }
  return table_row.create(null, cells);
}

/**
 * 在当前行上方插入一行
 */
export function addRowBefore(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const ctx = findTableContext(state);
  if (!ctx) return false;
  if (dispatch) {
    const { $from } = state.selection;
    const rowPos = $from.before(ctx.rowDepth);
    const colCount = ctx.tableNode.child(0).childCount;
    const newRow = createRow(state, colCount, false);
    dispatch(state.tr.insert(rowPos, newRow).scrollIntoView());
  }
  return true;
}

/**
 * 在当前行下方插入一行
 */
export function addRowAfter(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const ctx = findTableContext(state);
  if (!ctx) return false;
  if (dispatch) {
    const { $from } = state.selection;
    const rowPos = $from.after(ctx.rowDepth);
    const colCount = ctx.tableNode.child(0).childCount;
    const newRow = createRow(state, colCount, false);
    dispatch(state.tr.insert(rowPos, newRow).scrollIntoView());
  }
  return true;
}

/**
 * 在表格末尾追加一行
 */
export function addRowAtEnd(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const ctx = findTableContext(state);
  if (!ctx) return false;
  if (dispatch) {
    const tableEnd = ctx.tableStart + ctx.tableNode.nodeSize - 1;
    const colCount = ctx.tableNode.child(0).childCount;
    const newRow = createRow(state, colCount, false);
    dispatch(state.tr.insert(tableEnd, newRow).scrollIntoView());
  }
  return true;
}

/**
 * 在当前列左侧插入一列
 */
export function addColumnBefore(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const ctx = findTableContext(state);
  if (!ctx) return false;
  if (dispatch) {
    const { paragraph, table_header, table_cell } = state.schema.nodes;
    let tr = state.tr;
    const tableStart = ctx.tableStart + 1; // 进入 table 内部
    let offset = 0;
    ctx.tableNode.forEach((row, rowOffset, rowIndex) => {
      const isHeaderRow = rowIndex === 0;
      const cellType = isHeaderRow ? table_header : table_cell;
      const newCell = cellType.create(null, paragraph.create());
      // 找到该行中第 cellIndex 个 cell 的位置
      let cellPos = tableStart + rowOffset + 1; // +1 进入 row 内部
      for (let c = 0; c < ctx.cellIndex; c++) {
        cellPos += row.child(c).nodeSize;
      }
      tr = tr.insert(cellPos + offset, newCell);
      offset += newCell.nodeSize;
    });
    dispatch(tr.scrollIntoView());
  }
  return true;
}

/**
 * 在当前列右侧插入一列
 */
export function addColumnAfter(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const ctx = findTableContext(state);
  if (!ctx) return false;
  if (dispatch) {
    const { paragraph, table_header, table_cell } = state.schema.nodes;
    let tr = state.tr;
    const tableStart = ctx.tableStart + 1;
    let offset = 0;
    ctx.tableNode.forEach((row, rowOffset, rowIndex) => {
      const isHeaderRow = rowIndex === 0;
      const cellType = isHeaderRow ? table_header : table_cell;
      const newCell = cellType.create(null, paragraph.create());
      let cellPos = tableStart + rowOffset + 1;
      for (let c = 0; c <= ctx.cellIndex; c++) {
        cellPos += row.child(c).nodeSize;
      }
      tr = tr.insert(cellPos + offset, newCell);
      offset += newCell.nodeSize;
    });
    dispatch(tr.scrollIntoView());
  }
  return true;
}

/**
 * 在表格最右侧追加一列
 */
export function addColumnAtEnd(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const ctx = findTableContext(state);
  if (!ctx) return false;
  if (dispatch) {
    const { paragraph, table_header, table_cell } = state.schema.nodes;
    let tr = state.tr;
    const tableStart = ctx.tableStart + 1;
    let offset = 0;
    ctx.tableNode.forEach((row, rowOffset, rowIndex) => {
      const isHeaderRow = rowIndex === 0;
      const cellType = isHeaderRow ? table_header : table_cell;
      const newCell = cellType.create(null, paragraph.create());
      // 插入到行末尾（row 结束标签前）
      const rowEnd = tableStart + rowOffset + row.nodeSize - 1;
      tr = tr.insert(rowEnd + offset, newCell);
      offset += newCell.nodeSize;
    });
    dispatch(tr.scrollIntoView());
  }
  return true;
}

/**
 * 删除当前行
 */
export function deleteRow(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const ctx = findTableContext(state);
  if (!ctx) return false;
  // 至少保留一行
  if (ctx.tableNode.childCount <= 1) return false;
  if (dispatch) {
    const { $from } = state.selection;
    const rowStart = $from.before(ctx.rowDepth);
    const rowEnd = $from.after(ctx.rowDepth);
    dispatch(state.tr.delete(rowStart, rowEnd).scrollIntoView());
  }
  return true;
}

/**
 * 删除当前列
 */
export function deleteColumn(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const ctx = findTableContext(state);
  if (!ctx) return false;
  // 至少保留一列
  if (ctx.tableNode.child(0).childCount <= 1) return false;
  if (dispatch) {
    let tr = state.tr;
    const tableStart = ctx.tableStart + 1;
    let offset = 0;
    ctx.tableNode.forEach((row, rowOffset) => {
      let cellPos = tableStart + rowOffset + 1;
      for (let c = 0; c < ctx.cellIndex; c++) {
        cellPos += row.child(c).nodeSize;
      }
      const cellEnd = cellPos + row.child(ctx.cellIndex).nodeSize;
      tr = tr.delete(cellPos + offset, cellEnd + offset);
      offset -= row.child(ctx.cellIndex).nodeSize;
    });
    dispatch(tr.scrollIntoView());
  }
  return true;
}

/**
 * 调整表格行列数（「调整表格」网格选择器用）
 *
 * 保留左上重叠区域已有单元格（内容与列宽/对齐属性一并保留），
 * 新增行列补空单元格，裁掉的单元格直接丢弃；表头固定为第 0 行。
 */
export function resizeTable(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  rows: number,
  cols: number
): boolean {
  const ctx = findTableContext(state);
  if (!ctx || rows < 1 || cols < 1) return false;

  const currentRows = ctx.tableNode.childCount;
  const currentCols = ctx.tableNode.child(0).childCount;
  if (rows === currentRows && cols === currentCols) return false;

  if (dispatch) {
    const { table_row, table_header, table_cell, paragraph } = state.schema.nodes;
    const newRows: Node[] = [];
    for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
      const cellType = rowIndex === 0 ? table_header : table_cell;
      const cells: Node[] = [];
      for (let colIndex = 0; colIndex < cols; colIndex += 1) {
        const existing =
          rowIndex < currentRows && colIndex < currentCols
            ? ctx.tableNode.child(rowIndex).child(colIndex)
            : null;
        cells.push(existing ?? cellType.create(null));
      }
      newRows.push(table_row.create(null, cells));
    }

    const from = ctx.tableStart + 1;
    const to = ctx.tableStart + ctx.tableNode.nodeSize - 1;
    dispatch(state.tr.replaceWith(from, to, Fragment.fromArray(newRows)).scrollIntoView());
  }
  return true;
}

/** 列对齐取值（与 GFM 分隔行语义一致） */
export type TableColumnAlign = "left" | "center" | "right" | null;

/** 在当前行与其上一行之间做移动所需的起始位置 */
function rowStartAt(tableStart: number, tableNode: Node, rowIndex: number): number {
  let offset = 0;
  for (let index = 0; index < rowIndex; index += 1) {
    offset += tableNode.child(index).nodeSize;
  }
  return tableStart + 1 + offset;
}

/**
 * 上移当前行（表头行不参与移动：仅数据行可上移，且不能移到表头之上）
 */
export function moveRowUp(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const ctx = findTableContext(state);
  if (!ctx || ctx.rowIndex <= 1) return false;
  if (dispatch) {
    const row = ctx.tableNode.child(ctx.rowIndex);
    const currentStart = rowStartAt(ctx.tableStart, ctx.tableNode, ctx.rowIndex);
    const previousStart = rowStartAt(ctx.tableStart, ctx.tableNode, ctx.rowIndex - 1);
    const tr = state.tr
      .delete(currentStart, currentStart + row.nodeSize)
      .insert(previousStart, row);
    dispatch(tr.scrollIntoView());
  }
  return true;
}

/**
 * 下移当前行（表头行不参与移动）
 */
export function moveRowDown(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const ctx = findTableContext(state);
  if (!ctx || ctx.rowIndex === 0 || ctx.rowIndex >= ctx.tableNode.childCount - 1) return false;
  if (dispatch) {
    const row = ctx.tableNode.child(ctx.rowIndex);
    const nextRow = ctx.tableNode.child(ctx.rowIndex + 1);
    const currentStart = rowStartAt(ctx.tableStart, ctx.tableNode, ctx.rowIndex);
    const tr = state.tr
      .delete(currentStart, currentStart + row.nodeSize)
      .insert(currentStart + nextRow.nodeSize, row);
    dispatch(tr.scrollIntoView());
  }
  return true;
}

/** 列移动公共实现：direction 为 -1 左移、1 右移 */
function moveColumn(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  direction: -1 | 1
): boolean {
  const ctx = findTableContext(state);
  if (!ctx) return false;
  const colCount = ctx.tableNode.child(0).childCount;
  const targetIndex = ctx.cellIndex + direction;
  if (targetIndex < 0 || targetIndex >= colCount) return false;

  if (dispatch) {
    const newRows: Node[] = [];
    ctx.tableNode.forEach((row) => {
      const cells: Node[] = [];
      row.forEach((cell) => {
        cells.push(cell);
      });
      const [moved] = cells.splice(ctx.cellIndex, 1);
      cells.splice(targetIndex, 0, moved);
      newRows.push(row.type.create(row.attrs, Fragment.fromArray(cells)));
    });
    const from = ctx.tableStart + 1;
    const to = ctx.tableStart + ctx.tableNode.nodeSize - 1;
    dispatch(state.tr.replaceWith(from, to, Fragment.fromArray(newRows)).scrollIntoView());
  }
  return true;
}

/** 左移当前列 */
export function moveColumnLeft(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  return moveColumn(state, dispatch, -1);
}

/** 右移当前列 */
export function moveColumnRight(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  return moveColumn(state, dispatch, 1);
}

/**
 * 删除整个表格（文档因此为空时补一个空段落，保证光标有落点）
 */
export function deleteTable(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const ctx = findTableContext(state);
  if (!ctx) return false;
  if (dispatch) {
    const from = ctx.tableStart;
    const to = ctx.tableStart + ctx.tableNode.nodeSize;
    let tr = state.tr.delete(from, to);
    if (tr.doc.childCount === 0) {
      tr = tr.insert(0, state.schema.nodes.paragraph.create());
    }
    dispatch(tr.scrollIntoView());
  }
  return true;
}

/**
 * 设置光标所在列的对齐方式
 *
 * 写入该列所有单元格（含表头）的 align 属性；序列化时会写回 GFM 分隔行，
 * 与 Markdown 的 :--- / :---: / ---: 列对齐语义一致。
 */
export function setColumnAlign(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  align: TableColumnAlign
): boolean {
  const ctx = findTableContext(state);
  if (!ctx) return false;

  if (dispatch) {
    let tr = state.tr;
    const tableStart = ctx.tableStart + 1;
    ctx.tableNode.forEach((row, rowOffset) => {
      let cellPos = tableStart + rowOffset + 1;
      for (let index = 0; index < ctx.cellIndex; index += 1) {
        cellPos += row.child(index).nodeSize;
      }
      const cell = row.child(ctx.cellIndex);
      tr = tr.setNodeMarkup(cellPos, undefined, { ...cell.attrs, align });
    });
    dispatch(tr.scrollIntoView());
  }
  return true;
}

/**
 * 获取当前行的 Markdown 文本
 */
export function getCurrentRowMarkdown(state: EditorState): string | null {
  const ctx = findTableContext(state);
  if (!ctx) return null;

  const rowNode = ctx.tableNode.child(ctx.rowIndex);
  const cells: string[] = [];

  rowNode.forEach((cell) => {
    cells.push(cell.textContent || "");
  });

  return `| ${cells.join(" | ")} |`;
}

function parseMarkdownTableRow(text: string): string[] | null {
  const trimmed = text.trim();
  if (!/^\|.*\|$/u.test(trimmed)) return null;

  const inner = trimmed.slice(1, -1);
  const cells = inner.split("|").map((cell) => cell.trim());
  return cells;
}

/**
 * 在当前行后插入 Markdown 表格行
 */
export function insertMarkdownTableRowAfterCurrent(
  state: EditorState,
  rowMarkdown: string,
  dispatch?: (tr: Transaction) => void
): boolean {
  const ctx = findTableContext(state);
  if (!ctx) return false;

  const cells = parseMarkdownTableRow(rowMarkdown);
  if (!cells) return false;

  const colCount = ctx.tableNode.child(0)?.childCount ?? 0;
  if (cells.length !== colCount) return false;

  const { table_row, table_header, table_cell, paragraph } = state.schema.nodes;
  if (!table_row || !table_header || !table_cell || !paragraph) return false;

  const cellType = table_cell || table_header;
  const rowNode = table_row.create(
    null,
    cells.map((cellText) =>
      cellType.create(
        null,
        cellText ? paragraph.create(null, state.schema.text(cellText)) : paragraph.create()
      )
    )
  );

  if (dispatch) {
    const { $from } = state.selection;
    const rowPos = $from.after(ctx.rowDepth);
    const tr = state.tr.insert(rowPos, rowNode);
    const selectionPos = Math.min(rowPos + 2, tr.doc.content.size);
    tr.setSelection(TextSelection.create(tr.doc, selectionPos));
    dispatch(tr.scrollIntoView());
  }

  return true;
}

/**
 * 插入数学块
 */
export function insertMathBlock(content = ""): Command {
  return (state, dispatch) => {
    const nodeType = state.schema.nodes.math_block;
    if (!nodeType) return false;

    if (dispatch) {
      const node = nodeType.create({ content });
      const tr = state.tr.replaceSelectionWith(node);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/**
 * 插入容器
 */
export function insertContainer(type = "note", title = ""): Command {
  return (state, dispatch) => {
    const { container, paragraph } = state.schema.nodes;
    if (!container) return false;

    if (dispatch) {
      const node = container.create({ type, title }, paragraph?.create());
      const tr = state.tr.replaceSelectionWith(node);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

export const commands = {
  toggleStrong,
  toggleEmphasis,
  toggleCodeInline,
  toggleStrikethrough,
  toggleHighlight,
  setHeading,
  setParagraph,
  setCodeBlock,
  wrapInBlockquote,
  wrapInBulletList,
  wrapInOrderedList,
  liftBlock,
  insertHorizontalRule,
  insertImage,
  insertLink,
  removeLink,
  insertTable,
  addRowBefore,
  addRowAfter,
  addRowAtEnd,
  addColumnBefore,
  addColumnAfter,
  addColumnAtEnd,
  deleteRow,
  deleteColumn,
  getCurrentRowMarkdown,
  insertMarkdownTableRowAfterCurrent,
  insertMathBlock,
  resizeTable,
  moveRowUp,
  moveRowDown,
  moveColumnLeft,
  moveColumnRight,
  deleteTable,
  setColumnAlign,
  insertContainer,
};
