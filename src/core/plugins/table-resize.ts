/**
 * 表格行高 / 列宽调整插件（Ctrl + 拖拽单元格右缘 / 下缘）
 *
 * 设计要点（与 docs/2026-10-29-full-feature-implementation-plan.md §10 一致）：
 * 1. 无 prosemirror-tables 依赖，自研最小表格 schema，插件事自己处理 DOM 拖拽；
 * 2. **拖拽期间不产生事务**：直接改 td/th 的行内样式做实时反馈，避免污染撤销栈与触发重排风暴；
 * 3. 松手后一次性写属性（单条事务，可一步撤销），尺寸存入 colwidth / rowheight；
 * 4. Markdown 不携带尺寸，序列化后尺寸丢失（与 Typora 行为一致）；
 * 5. 修饰键统一用 Ctrl（macOS 上避开 Cmd 拖拽的浏览器默认行为）。
 *
 * 因此「正在拖拽」这一瞬时状态不进插件 state（不允许事务），而是模块内变量 + isTableResizing() 暴露，
 * 供编辑器在拖拽期间跳过点击 / 选区处理；插件 state 仅记录最近一次拖拽是否处于进行中（松手后置回 false）。
 */

import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import {
  clampColumnWidth,
  clampRowHeight,
  computeResizeDirection,
  forEachTableCell,
  type ResizeDirection,
  type TableLikeNode,
} from "../utils/table-resize";

export const tableResizePluginKey = new PluginKey<{ dragging: boolean }>("livemd-table-resize");

interface DragSession {
  direction: ResizeDirection;
  /** 本次拖拽涉及的单元格（列：整列；行：整行） */
  cellElements: HTMLTableCellElement[];
  tablePos: number;
  rowIdx: number;
  colIdx: number;
  startX: number;
  startY: number;
  /** 起始尺寸（列宽或行高） */
  startSize: number;
  /** 拖拽期间临时写入的行内样式原值，用于结束 / 取消时还原 */
  originalStyles: Map<HTMLElement, { width: string; height: string }>;
}

/** 当前是否处于表格调整拖拽中（模块级：拖拽期间不产生事务，无法从 state 读取） */
let activeSession: DragSession | null = null;

export function isTableResizing(): boolean {
  return activeSession !== null;
}

/** 命中单元格：从事件目标向上找 td / th */
function findCellElement(target: EventTarget | null): HTMLTableCellElement | null {
  if (!(target instanceof HTMLElement)) return null;
  const cell = target.closest("td, th");
  return cell instanceof HTMLTableCellElement ? cell : null;
}

/** 由表格 DOM 反查 table 节点在文档中的起始位置 */
function findTablePos(view: EditorView, tableEl: HTMLTableElement): number | null {
  try {
    const pos = view.posAtDOM(tableEl, 0);
    const $pos = view.state.doc.resolve(pos);
    for (let depth = $pos.depth; depth > 0; depth -= 1) {
      if ($pos.node(depth).type.name === "table") return $pos.before(depth);
    }
  } catch {
    // DOM 已脱离文档（表格被删除等）时忽略
  }
  return null;
}

/** 收集同一列 / 同一行的所有单元格元素（最小 schema 无合并单元格，行列一一对应） */
function collectCellElements(
  tableEl: HTMLTableElement,
  direction: ResizeDirection,
  rowIdx: number,
  colIdx: number
): HTMLTableCellElement[] {
  const elements: HTMLTableCellElement[] = [];
  if (direction === "col") {
    for (const row of Array.from(tableEl.rows)) {
      const cell = row.cells[colIdx];
      if (cell) elements.push(cell);
    }
  } else {
    const row = tableEl.rows[rowIdx];
    if (row) elements.push(...Array.from(row.cells));
  }
  return elements;
}

/** 读取单元格当前的列宽 / 行高（用于拖拽起点尺寸） */
function readCurrentSize(cell: HTMLTableCellElement, direction: ResizeDirection): number {
  const rect = cell.getBoundingClientRect();
  return direction === "col" ? rect.width : rect.height;
}

/** 松手：把最终尺寸写入文档属性（单条事务，可一步撤销） */
function commitResize(view: EditorView, session: DragSession, size: number): void {
  // 先清掉拖拽期间的临时行内样式，避免与 toDOM 写出的样式叠加
  for (const [element, original] of session.originalStyles) {
    element.style.width = original.width;
    element.style.height = original.height;
  }

  const tableNode = view.state.doc.nodeAt(session.tablePos);
  if (!tableNode) return;

  const tr = view.state.tr;
  forEachTableCell(
    tableNode as unknown as TableLikeNode,
    session.tablePos,
    (cell, pos, rowIdx, colIdx) => {
      const inTarget =
        session.direction === "col" ? colIdx === session.colIdx : rowIdx === session.rowIdx;
      if (!inTarget) return;
      const attrs = session.direction === "col" ? { colwidth: size } : { rowheight: size };
      tr.setNodeMarkup(pos, undefined, { ...cell.attrs, ...attrs });
    }
  );

  if (tr.docChanged) {
    view.dispatch(tr.setMeta(tableResizePluginKey, { dragging: false }));
  }
}

/** 取消（Esc / 窗口失焦）：还原样式，不产生事务 */
function cancelResize(): void {
  if (!activeSession) return;
  for (const [element, original] of activeSession.originalStyles) {
    element.style.width = original.width;
    element.style.height = original.height;
  }
  activeSession = null;
}

export function createTableResizePlugin(): Plugin<{ dragging: boolean }> {
  let view: EditorView | null = null;

  function handleMouseMove(event: MouseEvent): void {
    if (!activeSession || !view) return;
    event.preventDefault();
    const delta =
      activeSession.direction === "col"
        ? event.clientX - activeSession.startX
        : event.clientY - activeSession.startY;
    const size =
      activeSession.direction === "col"
        ? clampColumnWidth(activeSession.startSize + delta)
        : clampRowHeight(activeSession.startSize + delta);

    // 仅改行内样式做实时反馈，不产生事务
    for (const element of activeSession.cellElements) {
      if (activeSession.direction === "col") {
        element.style.width = `${size}px`;
      } else {
        element.style.height = `${size}px`;
      }
    }
  }

  function handleMouseUp(event: MouseEvent): void {
    if (!activeSession || !view) return;
    const session = activeSession;
    activeSession = null;
    removeWindowListeners();

    const delta =
      session.direction === "col" ? event.clientX - session.startX : event.clientY - session.startY;
    const size =
      session.direction === "col"
        ? clampColumnWidth(session.startSize + delta)
        : clampRowHeight(session.startSize + delta);

    commitResize(view, session, size);
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape" && activeSession) {
      cancelResize();
      removeWindowListeners();
    }
  }

  function addWindowListeners(): void {
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", handleBlur);
  }

  function removeWindowListeners(): void {
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", handleMouseUp);
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("blur", handleBlur);
  }

  function handleBlur(): void {
    cancelResize();
    removeWindowListeners();
  }

  return new Plugin<{ dragging: boolean }>({
    key: tableResizePluginKey,
    state: {
      init: () => ({ dragging: false }),
      apply: (tr, value) => {
        const meta = tr.getMeta(tableResizePluginKey) as { dragging?: boolean } | undefined;
        return meta?.dragging === undefined ? value : { dragging: meta.dragging };
      },
    },
    props: {
      handleDOMEvents: {
        // Ctrl + 在单元格右缘 / 下缘按下：进入调整会话
        mousedown(currentView, event) {
          view = currentView;
          if (!(event instanceof MouseEvent)) return false;
          if (event.button !== 0 || !event.ctrlKey) return false;

          const cell = findCellElement(event.target);
          if (!cell) return false;
          const tableEl = cell.closest("table");
          if (!(tableEl instanceof HTMLTableElement)) return false;

          const rect = cell.getBoundingClientRect();
          const direction = computeResizeDirection(
            event.clientX - rect.left,
            event.clientY - rect.top,
            rect.width,
            rect.height
          );
          if (!direction) return false;

          const tablePos = findTablePos(currentView, tableEl);
          if (tablePos === null) return false;

          const rowIdx = (cell.parentElement as HTMLTableRowElement).rowIndex;
          const colIdx = cell.cellIndex;
          const cellElements = collectCellElements(tableEl, direction, rowIdx, colIdx);
          const originalStyles = new Map(
            cellElements.map((element) => [
              element,
              { width: element.style.width, height: element.style.height },
            ])
          );

          activeSession = {
            direction,
            cellElements,
            tablePos,
            rowIdx,
            colIdx,
            startX: event.clientX,
            startY: event.clientY,
            startSize: readCurrentSize(cell, direction),
            originalStyles,
          };

          event.preventDefault();
          addWindowListeners();
          return true;
        },

        // 悬停反馈：Ctrl 按下且贴近边缘时切换光标
        mousemove(currentView, event) {
          view = currentView;
          if (!(event instanceof MouseEvent)) return false;
          if (activeSession) return false;
          if (!event.ctrlKey) {
            currentView.dom.style.cursor = "";
            return false;
          }

          const cell = findCellElement(event.target);
          if (!cell) {
            currentView.dom.style.cursor = "";
            return false;
          }
          const rect = cell.getBoundingClientRect();
          const direction = computeResizeDirection(
            event.clientX - rect.left,
            event.clientY - rect.top,
            rect.width,
            rect.height
          );
          currentView.dom.style.cursor =
            direction === "col" ? "col-resize" : direction === "row" ? "row-resize" : "";
          return false;
        },
      },
    },
    view() {
      return {
        destroy() {
          cancelResize();
          removeWindowListeners();
        },
      };
    },
  });
}
