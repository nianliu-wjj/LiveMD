/**
 * 增强的编辑器命令
 *
 * 通过插入 Markdown 语法文本实现格式化，
 * 让 syntax-detector 和 heading-sync 等插件自动处理渲染。
 */

import { EditorState, Transaction, TextSelection } from "prosemirror-state";
import { Mark, MarkType, Node as ProsemirrorNode, Schema } from "prosemirror-model";

type Command = (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean;

/** Mark 类型对应的 Markdown 语法标记 */
const MARK_SYNTAX: Record<string, { prefix: string; suffix: string }> = {
  strong: { prefix: "**", suffix: "**" },
  emphasis: { prefix: "*", suffix: "*" },
  code_inline: { prefix: "`", suffix: "`" },
  strikethrough: { prefix: "~~", suffix: "~~" },
  highlight: { prefix: "==", suffix: "==" },
  sub: { prefix: "<sub>", suffix: "</sub>" },
  sup: { prefix: "<sup>", suffix: "</sup>" },
};

/**
 * 创建基于 Markdown 语法文本的切换命令
 *
 * 始终通过插入语法文本实现，让 syntax-detector 自动处理渲染。
 * - 有选区：在选区两端插入语法标记
 * - 无选区：插入语法标记对，光标定位到中间
 * - 已有标记：再次执行会移除标记
 */
export function createEnhancedToggleSyntax(prefix: string, suffix: string): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void) => {
    const { from, to, empty } = state.selection;

    if (dispatch) {
      if (empty) {
        // 无选区：插入标记对，光标在中间
        const text = prefix + suffix;
        const tr = state.tr.insertText(text, from);
        tr.setSelection(TextSelection.create(tr.doc, from + prefix.length));
        dispatch(tr);
      } else {
        // 有选区：检查是否已有该语法，如果是则移除，否则添加
        const tr = state.tr;
        const selectedText = state.doc.textBetween(from, to);
        const prefixLen = prefix.length;
        const suffixLen = suffix.length;

        // 情况1：选区外侧紧邻语法标记（如选中 a，两侧是 **a**）
        const beforeFrom = Math.max(0, from - prefixLen);
        const afterTo = Math.min(state.doc.content.size, to + suffixLen);
        const textBefore = state.doc.textBetween(beforeFrom, from);
        const textAfter = state.doc.textBetween(to, afterTo);

        if (textBefore === prefix && textAfter === suffix) {
          // 移除外侧语法标记（先删后面的，再删前面的，避免位置偏移）
          tr.delete(to, afterTo);
          tr.delete(beforeFrom, from);
          tr.setSelection(
            TextSelection.create(tr.doc, beforeFrom, beforeFrom + selectedText.length)
          );
          dispatch(tr);
          return true;
        }

        // 情况2：选区本身包含语法标记（如选中 **a**）
        if (
          selectedText.length >= prefixLen + suffixLen &&
          selectedText.startsWith(prefix) &&
          selectedText.endsWith(suffix)
        ) {
          const inner = selectedText.slice(prefixLen, selectedText.length - suffixLen);
          tr.insertText(inner, from, to);
          tr.setSelection(TextSelection.create(tr.doc, from, from + inner.length));
          dispatch(tr);
          return true;
        }

        // 情况3：未包裹，在选区两端插入语法标记
        tr.insertText(suffix, to);
        tr.insertText(prefix, from);
        tr.setSelection(TextSelection.create(tr.doc, from + prefixLen, to + prefixLen));
        dispatch(tr);
      }
    }
    return true;
  };
}

/**
 * 创建增强的 toggleMark 命令
 */
export function createEnhancedToggleMark(markType: MarkType): Command {
  const syntax = MARK_SYNTAX[markType.name];
  if (!syntax) return () => false;
  return createEnhancedToggleSyntax(syntax.prefix, syntax.suffix);
}

/**
 * 创建行内 HTML 标签切换命令（如 <u>...</u>）
 */
export function createEnhancedHtmlTagCommand(tag: string): Command {
  return createEnhancedToggleSyntax(`<${tag}>`, `</${tag}>`);
}

/**
 * 创建设置标题命令
 *
 * 通过插入/修改 `# ` 语法标记文本实现标题切换。
 * - 段落 → 标题：设置节点类型并插入 `# ` 前缀
 * - 标题（同级）→ 段落：移除 `# ` 前缀并转为段落
 * - 标题（不同级）→ 标题：替换 `# ` 前缀
 */
export function createSetHeadingCommand(level: number): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void) => {
    const { $from } = state.selection;
    const parent = $from.parent;
    const parentPos = $from.before($from.depth);
    const schema = state.schema;

    if (!schema.nodes.heading) return false;

    // 只处理段落和标题
    if (parent.type.name !== "paragraph" && parent.type.name !== "heading") {
      return false;
    }

    if (dispatch) {
      const syntaxMarkerType = schema.marks.syntax_marker;
      const hashStr = "#".repeat(level);

      if (parent.type.name === "heading") {
        if (parent.attrs.level === level) {
          // 同级标题 → 段落：移除 # 前缀和后面的空格
          let removeEnd = 0;
          let syntaxEnd = 0;
          parent.forEach((child, offset) => {
            if (
              child.marks.some(
                (m: any) => m.type.name === "syntax_marker" && m.attrs.syntaxType === "heading"
              )
            ) {
              syntaxEnd = offset + child.nodeSize;
              removeEnd = syntaxEnd;
            }
          });
          // 检查语法标记后面是否紧跟一个空格
          if (syntaxEnd < parent.content.size) {
            const nextText = parent.textBetween(
              syntaxEnd,
              Math.min(syntaxEnd + 1, parent.content.size)
            );
            if (nextText === " ") {
              removeEnd = syntaxEnd + 1;
            }
          }

          const tr = state.tr;
          tr.setBlockType(parentPos, parentPos + parent.nodeSize, schema.nodes.paragraph);
          if (removeEnd > 0) {
            tr.delete(parentPos + 1, parentPos + 1 + removeEnd);
          }
          dispatch(tr.scrollIntoView());
        } else {
          // 不同级标题：只替换 # 部分（保留空格）
          let syntaxFrom = -1;
          let syntaxTo = -1;
          parent.forEach((child, offset) => {
            if (
              syntaxFrom === -1 &&
              child.marks.some(
                (m: any) => m.type.name === "syntax_marker" && m.attrs.syntaxType === "heading"
              )
            ) {
              syntaxFrom = offset;
              syntaxTo = offset + child.nodeSize;
            }
          });

          const tr = state.tr;
          const syntaxMark = syntaxMarkerType?.create({ syntaxType: "heading" });
          const newSyntaxText = syntaxMark
            ? schema.text(hashStr, [syntaxMark])
            : schema.text(hashStr);

          if (syntaxFrom >= 0) {
            tr.replaceWith(parentPos + 1 + syntaxFrom, parentPos + 1 + syntaxTo, newSyntaxText);
          }
          tr.setNodeMarkup(parentPos, schema.nodes.heading, { level });
          dispatch(tr.scrollIntoView());
        }
      } else {
        // 段落 → 标题：插入 # 和空格（分开）
        const tr = state.tr;
        tr.setBlockType(parentPos, parentPos + parent.nodeSize, schema.nodes.heading, { level });
        const syntaxMark = syntaxMarkerType?.create({ syntaxType: "heading" });
        const syntaxText = syntaxMark ? schema.text(hashStr, [syntaxMark]) : schema.text(hashStr);
        // 先插入空格，再在空格前插入 #（因为 insert 在同一位置会按顺序排列）
        tr.insert(parentPos + 1, syntaxText);
        tr.insert(parentPos + 1 + hashStr.length, schema.text(" "));
        dispatch(tr.scrollIntoView());
      }
    }
    return true;
  };
}

interface HeadingMarker {
  from: number;
  to: number;
  marks: readonly Mark[];
}

/** 查找标题节点中的 # 语法标记（偏移量相对于节点内容起点） */
function findHeadingMarker(node: ProsemirrorNode): HeadingMarker | null {
  let result: HeadingMarker | null = null;

  node.forEach((child, offset) => {
    if (result) return;
    if (
      child.isText &&
      child.marks.some(
        (mark) =>
          mark.type.name === "syntax_marker" && mark.attrs.syntaxType === "heading"
      )
    ) {
      result = { from: offset, to: offset + child.nodeSize, marks: child.marks };
    }
  });

  return result;
}

/** 插入标题的 # 前缀与空格 */
function insertHeadingMarker(
  tr: Transaction,
  nodePos: number,
  level: number,
  schema: Schema
): void {
  const markerMark = schema.marks.syntax_marker?.create({ syntaxType: "heading" });
  const hashText = schema.text("#".repeat(level), markerMark ? [markerMark] : []);
  tr.insert(nodePos + 1, hashText);
  tr.insert(nodePos + 1 + level, schema.text(" "));
}

/** 修改已有标题的级别，同步替换 # 标记 */
function updateHeadingLevel(
  tr: Transaction,
  nodePos: number,
  node: ProsemirrorNode,
  level: number,
  schema: Schema
): void {
  const marker = findHeadingMarker(node);
  tr.setNodeMarkup(nodePos, undefined, { ...node.attrs, level });

  if (marker) {
    const hashText = schema.text("#".repeat(level), [...marker.marks]);
    tr.replaceWith(nodePos + 1 + marker.from, nodePos + 1 + marker.to, hashText);
  } else {
    insertHeadingMarker(tr, nodePos, level, schema);
  }
}

/** 将标题转为段落，同时移除 # 标记与紧随其后的空格 */
function convertHeadingToParagraph(
  tr: Transaction,
  nodePos: number,
  node: ProsemirrorNode,
  schema: Schema
): void {
  const marker = findHeadingMarker(node);
  tr.setBlockType(nodePos, nodePos + node.nodeSize, schema.nodes.paragraph);

  if (!marker) return;

  let deleteTo = nodePos + 1 + marker.to;
  if (marker.to < node.content.size) {
    const nextText = node.textBetween(
      marker.to,
      Math.min(marker.to + 1, node.content.size)
    );
    if (nextText === " ") deleteTo += 1;
  }
  tr.delete(nodePos + 1 + marker.from, deleteTo);
}

/**
 * 创建标题升降级命令
 *
 * 对应 easy_modify 的 changeHeaders：
 * - promote（提升）：段落 → 六级标题，H2 → H1，H1 不变
 * - demote（降低）：H1 → H2，H6 → 段落，段落不变
 * 选区覆盖多个块时批量处理，从后往前修改以避免位置偏移。
 */
export function createChangeHeadingLevelCommand(
  direction: "promote" | "demote"
): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void) => {
    const schema = state.schema;
    if (!schema.nodes.heading || !schema.nodes.paragraph) return false;

    const { from, to } = state.selection;
    const selectionEnd = Math.max(to, from + 1);
    const targets: Array<{ pos: number; node: ProsemirrorNode }> = [];

    state.doc.forEach((node, offset) => {
      const nodeEnd = offset + node.nodeSize;
      if (nodeEnd <= from || offset >= selectionEnd) return;
      if (node.type.name === "heading" || node.type.name === "paragraph") {
        targets.push({ pos: offset, node });
      }
    });

    if (targets.length === 0) return false;

    const tr = state.tr;
    let changed = false;

    for (const { pos, node } of targets.reverse()) {
      if (node.type.name === "paragraph") {
        if (direction !== "promote") continue;
        tr.setBlockType(pos, pos + node.nodeSize, schema.nodes.heading, { level: 6 });
        insertHeadingMarker(tr, pos, 6, schema);
        changed = true;
        continue;
      }

      const level = Number(node.attrs.level) || 1;
      if (direction === "promote") {
        if (level <= 1) continue;
        updateHeadingLevel(tr, pos, node, level - 1, schema);
        changed = true;
      } else if (level >= 6) {
        convertHeadingToParagraph(tr, pos, node, schema);
        changed = true;
      } else {
        updateHeadingLevel(tr, pos, node, level + 1, schema);
        changed = true;
      }
    }

    if (changed && dispatch) {
      dispatch(tr.scrollIntoView());
    }
    return changed;
  };
}

/**
 * 创建设置段落命令
 *
 * 如果当前是标题，移除 # 前缀并转为段落。
 */
export function createSetParagraphCommand(): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void) => {
    const { $from } = state.selection;
    const parent = $from.parent;
    const parentPos = $from.before($from.depth);
    const schema = state.schema;

    if (!schema.nodes.paragraph) return false;

    if (parent.type.name === "paragraph") return false; // 已经是段落

    if (parent.type.name === "heading") {
      if (dispatch) {
        let syntaxEnd = 0;
        let removeEnd = 0;
        parent.forEach((child, offset) => {
          if (
            child.marks.some(
              (m: any) => m.type.name === "syntax_marker" && m.attrs.syntaxType === "heading"
            )
          ) {
            syntaxEnd = offset + child.nodeSize;
            removeEnd = syntaxEnd;
          }
        });
        // 检查语法标记后面是否紧跟一个空格
        if (syntaxEnd < parent.content.size) {
          const nextText = parent.textBetween(
            syntaxEnd,
            Math.min(syntaxEnd + 1, parent.content.size)
          );
          if (nextText === " ") {
            removeEnd = syntaxEnd + 1;
          }
        }

        const tr = state.tr;
        tr.setBlockType(parentPos, parentPos + parent.nodeSize, schema.nodes.paragraph);
        if (removeEnd > 0) {
          tr.delete(parentPos + 1, parentPos + 1 + removeEnd);
        }
        dispatch(tr.scrollIntoView());
      }
      return true;
    }

    return false;
  };
}
