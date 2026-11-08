/**
 * 纯文本提取：用于右键「复制纯文本」「只粘贴文本」
 *
 * 编辑器把 Markdown 语法符号（如 `**`、`[`、`](url)`）作为带 syntax_marker 标记的文本保存在文档里，
 * 这里遍历文档片段时跳过这些标记文本，只保留用户可见的内容：
 * - 块级节点之间换行；表格单元格之间用制表符分隔、行之间换行（粘贴到表格软件可直接分列）；
 * - 图片取替代文本（alt），硬换行转为换行；
 * - 代码块保留原始代码文本。
 */

import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { MarkdownParser } from "../parser/index.ts";

/** 判断文本节点是否为 Markdown 语法标记（复制纯文本时需剔除） */
function isSyntaxMarkerText(node: ProseMirrorNode): boolean {
  return node.marks.some((mark) => mark.type.name === "syntax_marker");
}

/**
 * 提取文档 [from, to) 范围内的纯文本（不含 Markdown 语法标记）
 */
export function extractPlainText(doc: ProseMirrorNode, from: number, to: number): string {
  if (to <= from) return "";

  let text = "";
  // 当前表格行内已输出的单元格数：第二个及以后的单元格前补制表符
  let cellIndexInRow = 0;

  doc.nodesBetween(from, to, (node, pos, parent) => {
    const typeName = node.type.name;
    const isCell = typeName === "table_cell" || typeName === "table_header";
    const insideCell = parent?.type.name === "table_cell" || parent?.type.name === "table_header";

    // 块级节点之间换行（单元格及其内部段落不换行，单元格之间由制表符分隔）
    if (node.isBlock && pos > from && text && !isCell && !insideCell && !/[\n\t]$/.test(text)) {
      text += "\n";
    }

    // nodesBetween 先序遍历：行节点先于其单元格被访问，在此重置单元格计数
    if (typeName === "table_row") {
      cellIndexInRow = 0;
      return true;
    }

    if (isCell) {
      if (cellIndexInRow > 0) text += "\t";
      cellIndexInRow += 1;
      return true;
    }

    if (typeName === "hard_break") {
      text += "\n";
      return false;
    }

    if (typeName === "image") {
      text += String(node.attrs.alt ?? "");
      return false;
    }

    if (!node.isText) return true;
    if (isSyntaxMarkerText(node)) return false;

    const start = Math.max(from, pos);
    const end = Math.min(to, pos + node.nodeSize);
    if (end > start) {
      let slice = node.text?.slice(start - pos, end - pos) ?? "";
      // 标题 "# 标题" 去掉井号后会残留前导空格：标题行首文本去掉前导空白
      if (parent?.type.name === "heading" && (text === "" || text.endsWith("\n"))) {
        slice = slice.trimStart();
      }
      text += slice;
    }
    return false;
  });

  return text;
}

/**
 * 把一段 Markdown 文本转换为纯文本：先用编辑器解析器解析，再按 extractPlainText 规则去掉语法标记
 * 解析失败时原样返回，保证粘贴不丢内容
 */
export function markdownToPlainText(markdown: string, parser: MarkdownParser): string {
  const normalized = markdown.replace(/\r\n?/g, "\n");
  try {
    const { doc } = parser.parse(normalized);
    return extractPlainText(doc, 0, doc.content.size);
  } catch (error) {
    console.warn("[plain-text] Markdown 解析失败，按原文粘贴:", error);
    return normalized;
  }
}
