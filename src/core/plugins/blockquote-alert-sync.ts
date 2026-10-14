/**
 * Livemd 引用告示块同步插件
 *
 * 被动识别 blockquote 首行中的 GitHub Alert 标记：
 * > [!NOTE]
 *
 * 实时输入时，blockquote 输入规则会把行首 `>` 消费掉，所以首段文本可能是：
 * - `> [!NOTE]`：来自文件解析/粘贴解析
 * - `[!NOTE]`：来自编辑器内直接输入
 *
 * 同步 blockquote 节点属性；当用户刚输入完整 marker 且当前块只有 marker 行时，
 * 自动插入下一空行，等价于用户手动按一次回车。
 */

import { Node } from "prosemirror-model";
import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet, EditorView } from "prosemirror-view";
import { decorationPluginKey } from "../decorations";
import { forEachNodeInRanges, getAffectedBlockRanges } from "./changed-ranges";

export const blockquoteAlertSyncPluginKey = new PluginKey("livemd-blockquote-alert-sync");
export const blockquoteAlertKeymapPluginKey = new PluginKey("livemd-blockquote-alert-keymap");

type AlertMarker = {
  from: number;
  to: number;
  type: string;
  blockquotePos: number;
  paragraphPos: number;
  paragraphNodeSize: number;
};

const ALERT_PATTERN = /^\s*(?:>\s*)?\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i;
const ALERT_MARKER_PATTERN =
  /^(?<prefix>\s*(?:>\s*)?)(?<marker>\[!(?<type>NOTE|TIP|IMPORTANT|WARNING|CAUTION)\])\s*$/i;

const SVG_NS = "http://www.w3.org/2000/svg";
const ALERT_ICON_PATHS: Record<string, string[]> = {
  note: ["circle:12,12,10", "line:12,16,12,12", "line:12,8,12.01,8"],
  tip: [
    "path:M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1.3.5 2.6 1.5 3.5.8.8 1.3 1.5 1.5 2.5",
    "path:M9 18h6",
    "path:M10 22h4",
    "path:M10 14h4",
  ],
  important: ["circle:12,12,10", "line:12,8,12,12", "line:12,16,12.01,16"],
  warning: [
    "path:m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",
    "line:12,9,12,13",
    "line:12,17,12.01,17",
  ],
  caution: ["path:M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20", "line:15,9,9,15", "line:9,9,15,15"],
};

function appendSvgShape(svg: SVGElement, descriptor: string): void {
  const [kind, value] = descriptor.split(":");
  if (kind === "circle") {
    const [cx, cy, r] = value.split(",");
    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", cx);
    circle.setAttribute("cy", cy);
    circle.setAttribute("r", r);
    svg.appendChild(circle);
    return;
  }

  if (kind === "line") {
    const [x1, y1, x2, y2] = value.split(",");
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", x1);
    line.setAttribute("y1", y1);
    line.setAttribute("x2", x2);
    line.setAttribute("y2", y2);
    svg.appendChild(line);
    return;
  }

  if (kind === "path") {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", value);
    svg.appendChild(path);
  }
}

function createAlertSvgIcon(type: string): SVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.4");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");

  const paths = ALERT_ICON_PATHS[type] ?? ALERT_ICON_PATHS.note;
  paths.forEach((descriptor) => appendSvgShape(svg, descriptor));
  return svg;
}

function getBlockquoteAlertType(node: Node): string | null {
  if (node.type.name !== "blockquote") return null;

  const firstChild = node.firstChild;
  if (!firstChild || firstChild.type.name !== "paragraph") return null;

  const match = firstChild.textContent.match(ALERT_PATTERN);
  return match ? match[1].toLowerCase() : null;
}

function findBlockquoteAlertMarker(node: Node, pos: number): AlertMarker | null {
  if (node.type.name !== "blockquote") return null;

  const firstChild = node.firstChild;
  if (!firstChild || firstChild.type.name !== "paragraph") return null;

  const match = firstChild.textContent.match(ALERT_MARKER_PATTERN);
  const groups = match?.groups;
  if (!groups?.marker || !groups.type) return null;

  const markerStart = groups.prefix.length;
  const markerEnd = markerStart + groups.marker.length;
  const paragraphPos = pos + 1;

  return {
    from: paragraphPos + 1 + markerStart,
    to: paragraphPos + 1 + markerEnd,
    type: groups.type.toLowerCase(),
    blockquotePos: pos,
    paragraphPos,
    paragraphNodeSize: firstChild.nodeSize,
  };
}

function createAlertIcon(marker: AlertMarker, view: EditorView): HTMLElement {
  const icon = document.createElement("button");
  icon.type = "button";
  icon.className = `livemd-blockquote-alert-icon livemd-blockquote-alert-icon-${marker.type}`;
  icon.appendChild(createAlertSvgIcon(marker.type));
  icon.title = "告示标记";
  icon.setAttribute("aria-label", "告示标记");
  icon.setAttribute("contenteditable", "false");

  icon.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
  icon.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    view.focus();
  });

  return icon;
}

function findAlertMarkerAt(doc: Node, pos: number): AlertMarker | null {
  let found: AlertMarker | null = null;

  doc.descendants((node, nodePos) => {
    if (found) return false;
    if (node.type.name !== "blockquote") return true;

    const marker = findBlockquoteAlertMarker(node, nodePos);
    if (marker && pos >= marker.from && pos <= marker.to) {
      found = marker;
      return false;
    }
    return true;
  });

  return found;
}

function findMarkerBeforeParagraphStart(doc: Node, pos: number): AlertMarker | null {
  let found: AlertMarker | null = null;

  doc.descendants((node, nodePos) => {
    if (found) return false;
    if (node.type.name !== "blockquote") return true;

    const marker = findBlockquoteAlertMarker(node, nodePos);
    if (!marker) return true;

    const nextParagraph = node.child(1);
    if (!nextParagraph || nextParagraph.type.name !== "paragraph") return true;

    const nextParagraphStart = marker.paragraphPos + marker.paragraphNodeSize + 1;
    if (pos === nextParagraphStart) {
      found = marker;
      return false;
    }

    return true;
  });

  return found;
}

function buildDecorations(doc: Node, sourceView: boolean): DecorationSet {
  if (sourceView) return DecorationSet.empty;

  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    const marker = findBlockquoteAlertMarker(node, pos);
    if (!marker) return true;

    decorations.push(
      Decoration.widget(marker.from, (view) => createAlertIcon(marker, view), {
        key: `blockquote-alert-${marker.from}-${marker.to}-${marker.type}`,
        side: -1,
      })
    );
    decorations.push(
      Decoration.inline(marker.from, marker.to, {
        class: "livemd-blockquote-alert-marker-hidden",
        contenteditable: "false",
        "aria-hidden": "true",
      })
    );

    return true;
  });

  return DecorationSet.create(doc, decorations);
}

export function createBlockquoteAlertKeymapPlugin(): Plugin {
  return new Plugin({
    key: blockquoteAlertKeymapPluginKey,

    props: {
      handleKeyDown(view, event) {
        if (event.key !== "Backspace" && event.key !== "Delete") return false;
        const { selection } = view.state;
        if (!selection.empty) return false;

        const marker =
          findMarkerBeforeParagraphStart(view.state.doc, selection.from) ??
          (event.key === "Backspace"
            ? findAlertMarkerAt(view.state.doc, selection.from - 1)
            : findAlertMarkerAt(view.state.doc, selection.from));
        if (!marker) return false;

        event.preventDefault();
        const tr = view.state.tr.delete(
          marker.paragraphPos,
          marker.paragraphPos + marker.paragraphNodeSize
        );
        const nextPos = Math.min(marker.blockquotePos + 1, tr.doc.content.size);
        tr.setSelection(TextSelection.near(tr.doc.resolve(nextPos), 1));
        view.dispatch(tr.scrollIntoView());
        return true;
      },
    },
  });
}

/**
 * 校验增量映射后的装饰集与新文档一致：统计两边的告示 marker 数量是否相同。
 *
 * map 只会平移位置、不会改变装饰内容；若编辑删除/改写了告示标记行，
 * 新文档的 marker 数会变，此时必须回退全量重建。
 * 仅遍历 blockquote 节点，成本远低于 buildDecorations 的全文档扫描。
 */
function hasAlertMarkersForDecorations(doc: Node, decorations: DecorationSet): boolean {
  let docMarkers = 0;
  doc.descendants((node, pos) => {
    if (findBlockquoteAlertMarker(node, pos)) {
      docMarkers += 1;
      return false;
    }
    return node.type.name === "doc" || node.type.name === "blockquote";
  });

  let decoCount = 0;
  decorations.find().forEach(() => {
    decoCount += 1;
  });

  // 每个 marker 产生 1 个 widget + 1 个 inline 装饰
  return decoCount === docMarkers * 2;
}

export function createBlockquoteAlertSyncPlugin(): Plugin {
  return new Plugin({
    key: blockquoteAlertSyncPluginKey,

    state: {
      init(_, state) {
        const sourceView = decorationPluginKey.getState(state)?.sourceView ?? false;
        return buildDecorations(state.doc, sourceView);
      },
      apply(tr, oldDecorations, oldState, newState) {
        const oldSourceView = decorationPluginKey.getState(oldState)?.sourceView ?? false;
        const newSourceView = decorationPluginKey.getState(newState)?.sourceView ?? false;
        if (!tr.docChanged && oldSourceView === newSourceView) {
          return oldDecorations.map(tr.mapping, tr.doc);
        }

        // 文档变化时优先增量映射：告示图标 widget 与 inline 装饰都是位置型装饰，
        // 普通编辑平移位置后 map 结果即为正确解；marker 数量校验不通过才回退全量重建
        if (!newSourceView && oldSourceView === newSourceView) {
          const mapped = oldDecorations.map(tr.mapping, tr.doc);
          if (hasAlertMarkersForDecorations(newState.doc, mapped)) {
            return mapped;
          }
        }
        return buildDecorations(newState.doc, newSourceView);
      },
    },

    props: {
      decorations(state) {
        return blockquoteAlertSyncPluginKey.getState(state) ?? DecorationSet.empty;
      },
    },

    appendTransaction(transactions, oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      if (transactions.some((tr) => tr.getMeta("blockquote-alert-sync"))) return null;

      let tr = newState.tr;
      let changed = false;
      let insertedNextLine = false;

      // 增量扫描：只遍历本轮事务改动的顶层块（±1 块边距）内的引用块，不再每次击键全文档遍历
      const affectedRanges = getAffectedBlockRanges(newState.doc, transactions);
      forEachNodeInRanges(newState.doc, affectedRanges, (node, pos) => {
        if (node.type.name !== "blockquote") return true;

        const alertType = getBlockquoteAlertType(node);
        const currentAlertType = node.attrs.alertType ?? null;
        if (alertType === currentAlertType) return true;

        tr = tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          alertType,
        });
        changed = true;

        const marker = findBlockquoteAlertMarker(node, pos);
        const shouldInsertNextLine =
          marker &&
          node.childCount === 1 &&
          newState.selection.empty &&
          newState.selection.from >= marker.from &&
          newState.selection.from <= marker.to;

        if (shouldInsertNextLine) {
          const insertPos = marker.paragraphPos + marker.paragraphNodeSize;
          const paragraph = newState.schema.nodes.paragraph.create();
          tr = tr.insert(insertPos, paragraph);
          tr = tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 1), 1));
          insertedNextLine = true;
        }

        return true;
      });

      if (!changed) return null;
      tr.setMeta("blockquote-alert-sync", true);
      return insertedNextLine ? tr.scrollIntoView() : tr;
    },
  });
}
