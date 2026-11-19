import { DOMSerializer } from "prosemirror-model";
import { parseMarkdown } from "../parser";
import { livemdSchema } from "../schema";

const verbatim = new Set(["PRE", "CODE", "KBD", "SCRIPT", "STYLE", "TEXTAREA", "SVG", "MATH"]);
const inline = new Set(["SUMMARY", "SPAN", "B", "I", "U", "EM", "STRONG", "A", "LABEL"]);

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
