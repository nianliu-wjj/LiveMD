/**
 * 表格 NodeView：横向滚动容器 + 表头悬浮工具栏
 *
 * 结构（对齐 docs/2026-10-29-md-editor-fix-guide §表格工具栏 与用户需求）：
 *
 * ```
 * <div class="livemd-table-block">          ← position: relative，工具栏定位基准
 *   <div class="livemd-table-toolbar">      ← 悬浮在表格上方，仅在光标位于表内时显示
 *     调整表格 / 左对齐 / 居中对齐 / 右对齐 / 更多操作 / 删除表格
 *   </div>
 *   <div class="livemd-table-scroll">       ← overflow-x: auto，宽表格横向滚动
 *     <table>…</table>                      ← contentDOM
 *   </div>
 * </div>
 * ```
 *
 * 与内核的分工：工具栏只负责发命令（commands/index.ts 中的表格命令）与展示状态，
 * 「复制表格」「格式化表格代码」需要渲染层能力，通过构造参数回调交给 editor.ts 转发。
 */
import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { EditorView, NodeView, ViewMutationRecord } from "prosemirror-view";
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  deleteRow,
  deleteTable,
  moveColumnLeft,
  moveColumnRight,
  moveRowDown,
  moveRowUp,
  resizeTable,
  setColumnAlign,
  type TableColumnAlign,
} from "../commands";

/** 渲染层回调（内核无法直接触达的能力） */
export interface TableNodeViewCallbacks {
  /** 复制整张表格到剪贴板（沿用编辑器既有剪贴板通路） */
  onCopyTable: () => void;
  /** 请求渲染层执行命令（如「格式化表格代码」→ format:table-format） */
  onRunRendererCommand: (id: string) => void;
}

/** 网格选择器最大行列数 */
const GRID_PICKER_SIZE = 8;

/** 对齐按钮与更多操作菜单的图标（内联 SVG，保持 core 不依赖 UI 组件） */
const ICONS = {
  adjust:
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="1.75" y="1.75" width="12.5" height="12.5" rx="1.5"/><path d="M1.75 6h12.5M1.75 10.5h12.5M6 1.75v12.5M10.5 1.75v12.5"/></svg>',
  alignLeft:
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 4h12M2 8h8M2 12h10"/></svg>',
  alignCenter:
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 4h12M4 8h8M3 12h10"/></svg>',
  alignRight:
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 4h12M6 8h8M4 12h10"/></svg>',
  more: '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><circle cx="3.2" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="12.8" cy="8" r="1.3"/></svg>',
  trash:
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.8 8.2a1 1 0 0 0 1 .8h4.4a1 1 0 0 0 1-.8l.8-8.2"/></svg>',
};

/** 更多操作菜单项（label + 快捷键提示 + 动作） */
interface MoreMenuItem {
  label: string;
  hint?: string;
  run: (view: EditorView) => void;
  danger?: boolean;
}

export class TableNodeView implements NodeView {
  /** 外层定位容器（工具栏与滚动容器都挂在它下面） */
  dom: HTMLElement;
  /** PM 内容容器：表格本体 */
  contentDOM: HTMLElement;

  private node: ProseMirrorNode;
  private view: EditorView;
  private callbacks: TableNodeViewCallbacks;

  private toolbar: HTMLElement;
  private gridPicker: HTMLElement;
  private gridCells: HTMLElement[] = [];
  private gridLabel: HTMLElement;
  private moreMenu: HTMLElement;
  private alignButtons = new Map<TableColumnAlign, HTMLElement>();

  private onDocumentPointerDown: ((event: PointerEvent) => void) | null = null;
  private onDocumentKeyDown: ((event: KeyboardEvent) => void) | null = null;

  constructor(node: ProseMirrorNode, view: EditorView, callbacks: TableNodeViewCallbacks) {
    this.node = node;
    this.view = view;
    this.callbacks = callbacks;

    this.dom = document.createElement("div");
    this.dom.className = "livemd-table-block";

    const scroll = document.createElement("div");
    scroll.className = "livemd-table-scroll";

    const table = document.createElement("table");
    this.contentDOM = table;
    scroll.appendChild(table);

    this.toolbar = this.createToolbar();
    this.gridPicker = this.createGridPicker();
    this.gridLabel = this.gridPicker.querySelector(".livemd-table-grid-label") as HTMLElement;
    this.moreMenu = this.createMoreMenu();

    this.dom.appendChild(this.toolbar);
    this.dom.appendChild(this.gridPicker);
    this.dom.appendChild(this.moreMenu);
    this.dom.appendChild(scroll);

    this.registerDocumentListeners();
  }

  /* ---------------- NodeView 生命周期 ---------------- */

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.syncAlignButtons();
    return true;
  }

  /** 工具栏 / 弹层的 DOM 变更不应触发 PM 重绘；表格本体的变更必须放行 */
  ignoreMutation(mutation: ViewMutationRecord): boolean {
    const target = mutation.target as HTMLElement;
    if (this.contentDOM.contains(target)) return false;
    return this.dom.contains(target);
  }

  /** 工具栏内的交互不交给 PM 处理 */
  stopEvent(event: Event): boolean {
    const target = event.target as HTMLElement | null;
    if (!target) return false;
    return Boolean(
      target.closest(".livemd-table-toolbar, .livemd-table-grid-picker, .livemd-table-more-menu")
    );
  }

  destroy(): void {
    this.removeDocumentListeners();
  }

  /* ---------------- 工具栏与弹层 ---------------- */

  private createToolbar(): HTMLElement {
    const toolbar = document.createElement("div");
    toolbar.className = "livemd-table-toolbar";

    toolbar.appendChild(
      this.createToolButton("调整表格", ICONS.adjust, () => this.toggleGridPicker())
    );

    const alignItems: Array<{ align: TableColumnAlign; title: string; icon: string }> = [
      { align: "left", title: "左对齐", icon: ICONS.alignLeft },
      { align: "center", title: "居中对齐", icon: ICONS.alignCenter },
      { align: "right", title: "右对齐", icon: ICONS.alignRight },
    ];
    for (const item of alignItems) {
      const button = this.createToolButton(item.title, item.icon, () => {
        const before = this.view.state.doc;
        const ctxFound = (() => {
          const { $from } = this.view.state.selection;
          for (let depth = $from.depth; depth > 0; depth -= 1) {
            if ($from.node(depth).type.name === "table") return true;
          }
          return false;
        })();
        this.runCommand((state, dispatch) => setColumnAlign(state, dispatch, item.align));
        this.syncAlignButtons();
        console.log(
          "[table-toolbar]",
          item.align,
          JSON.stringify({
            ctxFound,
            selectionFrom: this.view.state.selection.from,
            selectionEmpty: this.view.state.selection.empty,
            docChanged: this.view.state.doc !== before,
            cellStyle:
              (this.contentDOM.querySelector("th, td") as HTMLElement | null)?.getAttribute(
                "style"
              ) ?? null,
          })
        );
      });
      this.alignButtons.set(item.align, button);
      toolbar.appendChild(button);
    }

    toolbar.appendChild(this.createToolButton("更多操作", ICONS.more, () => this.toggleMoreMenu()));
    toolbar.appendChild(
      this.createToolButton(
        "删除表格",
        ICONS.trash,
        () => {
          this.runCommand(deleteTable);
          this.hidePopovers();
        },
        true
      )
    );

    return toolbar;
  }

  private createToolButton(
    title: string,
    icon: string,
    onClick: () => void,
    danger = false
  ): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = danger
      ? "livemd-table-tool-btn livemd-table-tool-btn--danger"
      : "livemd-table-tool-btn";
    button.title = title;
    button.setAttribute("aria-label", title);
    button.innerHTML = icon;
    console.log("[tt] create", title, document.contains(this.dom));
    button.addEventListener("mousedown", (event) => {
      console.log("[tt] mousedown", title);
      // 防止点击工具栏时丢失编辑器选区
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      console.log("[tt] click", title);
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  /** 网格选择器：滑过即预览行列数，点击确定目标尺寸 */
  private createGridPicker(): HTMLElement {
    const picker = document.createElement("div");
    picker.className = "livemd-table-grid-picker";
    picker.hidden = true;

    const grid = document.createElement("div");
    grid.className = "livemd-table-grid";
    for (let row = 1; row <= GRID_PICKER_SIZE; row += 1) {
      for (let col = 1; col <= GRID_PICKER_SIZE; col += 1) {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "livemd-table-grid-cell";
        cell.dataset.row = String(row);
        cell.dataset.col = String(col);
        cell.setAttribute("aria-label", `${row} 行 ${col} 列`);
        cell.addEventListener("mouseenter", () => this.previewGrid(row, col));
        cell.addEventListener("mousedown", (event) => event.preventDefault());
        cell.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.runCommand((state, dispatch) => resizeTable(state, dispatch, row, col));
          this.toggleGridPicker(false);
        });
        grid.appendChild(cell);
        this.gridCells.push(cell);
      }
    }

    const label = document.createElement("div");
    label.className = "livemd-table-grid-label";
    label.textContent = "选择行列数";

    picker.appendChild(grid);
    picker.appendChild(label);
    picker.addEventListener("mouseleave", () => this.previewGrid(0, 0));
    return picker;
  }

  private previewGrid(rows: number, cols: number): void {
    for (const cell of this.gridCells) {
      const row = Number(cell.dataset.row);
      const col = Number(cell.dataset.col);
      cell.classList.toggle("active", rows > 0 && row <= rows && col <= cols);
    }
    this.gridLabel.textContent = rows > 0 ? `${rows} 行 × ${cols} 列` : "选择行列数";
  }

  /** 更多操作菜单（与 Typora 表格菜单一致） */
  private createMoreMenu(): HTMLElement {
    const menu = document.createElement("div");
    menu.className = "livemd-table-more-menu";
    menu.hidden = true;

    const items: MoreMenuItem[] = [
      {
        label: "上方插入行",
        hint: "Ctrl+Enter",
        run: (view) => addRowBefore(view.state, view.dispatch.bind(view)),
      },
      { label: "下方插入行", run: (view) => addRowAfter(view.state, view.dispatch.bind(view)) },
      { label: "左侧插入列", run: (view) => addColumnBefore(view.state, view.dispatch.bind(view)) },
      { label: "右侧插入列", run: (view) => addColumnAfter(view.state, view.dispatch.bind(view)) },
      {
        label: "上移该行",
        hint: "Alt+↑",
        run: (view) => moveRowUp(view.state, view.dispatch.bind(view)),
      },
      {
        label: "下移该行",
        hint: "Alt+↓",
        run: (view) => moveRowDown(view.state, view.dispatch.bind(view)),
      },
      {
        label: "左移该列",
        hint: "Alt+←",
        run: (view) => moveColumnLeft(view.state, view.dispatch.bind(view)),
      },
      {
        label: "右移该列",
        hint: "Alt+→",
        run: (view) => moveColumnRight(view.state, view.dispatch.bind(view)),
      },
      { label: "删除行", run: (view) => deleteRow(view.state, view.dispatch.bind(view)) },
      { label: "复制表格", run: () => this.callbacks.onCopyTable() },
      {
        label: "格式化表格代码",
        run: () => this.callbacks.onRunRendererCommand("format:table-format"),
      },
      {
        label: "删除表格",
        run: (view) => deleteTable(view.state, view.dispatch.bind(view)),
        danger: true,
      },
    ];

    for (const item of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = item.danger
        ? "livemd-table-more-item livemd-table-more-item--danger"
        : "livemd-table-more-item";
      button.innerHTML =
        `<span class="livemd-table-more-label">${item.label}</span>` +
        `<span class="livemd-table-more-hint">${item.hint ?? ""}</span>`;
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.hidePopovers();
        // 同 runCommand：命令先于聚焦执行，避免选区被重置
        item.run(this.view);
        this.view.focus();
      });
      menu.appendChild(button);
    }

    return menu;
  }

  /* ---------------- 状态同步与工具方法 ---------------- */

  /** 依据「光标所在列」的对齐同步三个对齐按钮的激活态 */
  private syncAlignButtons(): void {
    const align = this.currentColumnAlign();
    for (const [value, button] of this.alignButtons) {
      button.classList.toggle("active", value === align);
    }
  }

  private currentColumnAlign(): TableColumnAlign {
    const { $from } = this.view.state.selection;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const node = $from.node(depth);
      if (node.type.name === "table_cell" || node.type.name === "table_header") {
        return ((node.attrs.align as TableColumnAlign) ?? null) as TableColumnAlign;
      }
    }
    return null;
  }

  private runCommand(
    command: (state: EditorView["state"], dispatch: EditorView["dispatch"]) => boolean
  ): void {
    // 顺序很重要：先执行命令（选区仍在表格内），再聚焦编辑器；
    // 若先 focus()，选区可能被重置到文档开头，表格内命令将直接返回 false。
    command(this.view.state, this.view.dispatch.bind(this.view));
    this.view.focus();
  }

  private toggleGridPicker(force?: boolean): void {
    const next = force ?? this.gridPicker.hidden;
    this.gridPicker.hidden = !next;
    this.moreMenu.hidden = true;
    if (next) {
      this.previewGrid(0, 0);
    }
  }

  private toggleMoreMenu(force?: boolean): void {
    const next = force ?? this.moreMenu.hidden;
    this.moreMenu.hidden = !next;
    this.gridPicker.hidden = true;
  }

  private hidePopovers(): void {
    this.gridPicker.hidden = true;
    this.moreMenu.hidden = true;
  }

  private registerDocumentListeners(): void {
    this.onDocumentPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (
        target.closest(".livemd-table-toolbar, .livemd-table-grid-picker, .livemd-table-more-menu")
      ) {
        return;
      }
      this.hidePopovers();
    };
    this.onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") this.hidePopovers();
    };
    document.addEventListener("pointerdown", this.onDocumentPointerDown, true);
    document.addEventListener("keydown", this.onDocumentKeyDown, true);
  }

  private removeDocumentListeners(): void {
    if (this.onDocumentPointerDown) {
      document.removeEventListener("pointerdown", this.onDocumentPointerDown, true);
      this.onDocumentPointerDown = null;
    }
    if (this.onDocumentKeyDown) {
      document.removeEventListener("keydown", this.onDocumentKeyDown, true);
      this.onDocumentKeyDown = null;
    }
  }
}

/** 创建表格 NodeView（editor.ts 的 nodeViews 注册入口） */
export function createTableNodeView(
  node: ProseMirrorNode,
  view: EditorView,
  callbacks: TableNodeViewCallbacks
): TableNodeView {
  return new TableNodeView(node, view, callbacks);
}
