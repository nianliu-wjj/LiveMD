import { Language, LanguageSupport } from "@codemirror/language";
import { classHighlighter, highlightTree } from "@lezer/highlight";
import { loadLanguageExtension } from "./code-block-languages";

/** 预览使用稳定的 tok-* 类名，不依赖 CodeMirror 实例注入 CSS。 */
export async function highlightHtmlPreviewCodeBlocks(root: HTMLElement): Promise<void> {
  await Promise.all(
    Array.from(root.querySelectorAll<HTMLElement>("pre > code")).map(async (code) => {
      const source = code.textContent ?? "";
      const language = code.className.match(/(?:^|\s)language-([^\s]+)/)?.[1];
      if (!language || source.length > 50_000) return;
      try {
        const extension = await loadLanguageExtension(language);
        const parser =
          extension instanceof LanguageSupport
            ? extension.language.parser
            : extension instanceof Language
              ? extension.parser
              : null;
        if (!parser || !code.isConnected || code.textContent !== source || !root.contains(code))
          return;
        const fragment = code.ownerDocument.createDocumentFragment();
        let offset = 0;
        highlightTree(parser.parse(source), classHighlighter, (from, to, classes) => {
          fragment.appendChild(code.ownerDocument.createTextNode(source.slice(offset, from)));
          const span = code.ownerDocument.createElement("span");
          span.className = classes;
          span.textContent = source.slice(from, to);
          fragment.appendChild(span);
          offset = to;
        });
        fragment.appendChild(code.ownerDocument.createTextNode(source.slice(offset)));
        code.replaceChildren(fragment);
      } catch {
        /* 加载或解析失败时保留纯文本。 */
      }
    })
  );
}
