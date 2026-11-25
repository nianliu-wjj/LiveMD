import { DOMSerializer } from "prosemirror-model";
import { parseMarkdown } from "../parser/index.ts";
import { livemdSchema } from "../schema/index.ts";

const verbatim = new Set(["PRE", "CODE", "KBD", "SCRIPT", "STYLE", "TEXTAREA", "SVG", "MATH"]);
const inline = new Set(["SUMMARY", "SPAN", "B", "I", "U", "EM", "STRONG", "A", "LABEL"]);

/** 先抽离完整栅栏，避免 HTML 解析器把代码中的标签变成真实 DOM。 */
export function extractMarkdownCodeFences(source: string): {
  html: string;
  fences: Map<string, string>;
} {
  let prefix = "LIVEMD-FENCE-";
  while (source.includes(prefix)) prefix += "X";
  const fences = new Map<string, string>();
  const lines = source.split("\n");
  const output: string[] = [];
  const depths = new Map<string, number>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const opening = !Array.from(depths.values()).some((depth) => depth > 0)
      ? line.match(/^ {0,3}(`{3,}|~{3,})([^\r]*)\r?$/)
      : null;
    if (opening && !(opening[1][0] === "`" && opening[2].includes("`"))) {
      const closing = new RegExp(`^ {0,3}${opening[1][0]}{${opening[1].length},}\\s*$`);
      let end = i + 1;
      while (end < lines.length && !closing.test(lines[end])) end++;
      if (end < lines.length) {
        const token = `${prefix}${fences.size}-END`;
        // 直接构造代码节点，实体字符不经过 DOM 解码或 Markdown 行内解析。
        const language = opening[2].trim().split(/\s/)[0];
        const code = lines
          .slice(i + 1, end)
          .join("\n")
          .replace(/\r$/gm, "");
        const node = livemdSchema.node(
          "code_block",
          { language },
          code ? livemdSchema.text(code) : []
        );
        const doc = typeof document === "undefined" ? null : document;
        if (doc) {
          const container = doc.createElement("div");
          container.appendChild(
            DOMSerializer.fromSchema(livemdSchema).serializeNode(node, { document: doc })
          );
          fences.set(token, container.innerHTML);
          output.push(token);
          i = end;
          continue;
        }
      }
    }
    for (const match of line.matchAll(/<\s*(\/?)\s*(pre|code|textarea|script|style)\b[^>]*>/gi)) {
      const tag = match[2].toLowerCase();
      depths.set(tag, Math.max(0, (depths.get(tag) ?? 0) + (match[1] ? -1 : 1)));
    }
    output.push(line);
  }
  return { html: output.join("\n"), fences };
}

export function restoreMarkdownCodeFences(
  fragment: DocumentFragment,
  fences: Map<string, string>
): void {
  if (!fences.size) return;
  const doc = fragment.ownerDocument;
  const visit = (parent: Node) => {
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        visit(child);
        continue;
      }
      if (child.nodeType !== Node.TEXT_NODE) continue;
      const text = child.textContent ?? "";
      const replacement = doc.createDocumentFragment();
      let offset = 0;
      while (offset < text.length) {
        let next = -1;
        let token = "";
        for (const key of fences.keys()) {
          const index = text.indexOf(key, offset);
          if (index >= 0 && (next < 0 || index < next)) {
            next = index;
            token = key;
          }
        }
        if (next < 0) {
          replacement.appendChild(doc.createTextNode(text.slice(offset)));
          break;
        }
        replacement.appendChild(doc.createTextNode(text.slice(offset, next)));
        const template = doc.createElement("template");
        template.innerHTML = fences.get(token)!;
        replacement.appendChild(template.content);
        offset = next + token.length;
      }
      parent.replaceChild(replacement, child);
    }
  };
  visit(fragment);
}

/** 只转换预览 DOM，解析失败保留原文。 */
export function renderMarkdownWithinHtmlFragment(fragment: DocumentFragment): void {
  const serializer = DOMSerializer.fromSchema(livemdSchema);
  const visit = (parent: Node) => {
    if (parent instanceof Element && verbatim.has(parent.tagName)) return;
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        visit(child);
        continue;
      }
      if (child.nodeType !== Node.TEXT_NODE || !child.textContent?.trim()) continue;
      try {
        const parsed = parseMarkdown(child.textContent).doc;
        const isInline = parent instanceof Element && inline.has(parent.tagName);
        if (isInline && (parsed.childCount !== 1 || parsed.firstChild?.type.name !== "paragraph"))
          continue;
        const content = isInline ? parsed.firstChild!.content : parsed.content;
        const rendered = serializer.serializeFragment(content, { document: parent.ownerDocument! });
        // syntax_marker 的文本本身不属于预览内容。
        rendered.querySelectorAll(".livemd-syntax").forEach((marker) => marker.remove());
        parent.replaceChild(rendered, child);
      } catch {
        /* Preserve the original text when parsing fails. */
      }
    }
  };
  visit(fragment);
}
