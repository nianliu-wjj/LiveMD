import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { TextSelection, EditorState } from "prosemirror-state";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { after } from "node:test";
const root = fileURLToPath(new URL("..", import.meta.url));
const directory = mkdtempSync(join(root, ".git", "nov19-test-"));
after(() => rmSync(directory, { recursive: true, force: true }));
const output = join(directory, "modules.mjs");
createRequire(import.meta.url)("node:module")
  .createRequire(createRequire(import.meta.url).resolve("vite"))("esbuild")
  .buildSync({
    stdin: {
      contents: `export { defaultParser } from "./src/core/parser/index.ts";
 export { livemdSchema } from "./src/core/schema/index.ts";
 export { serializeSliceToMarkdownText, serializeMarkdown } from "./src/core/serializer/index.ts";
 export { createEnhancedToggleSyntax } from "./src/core/commands/enhanced-commands.ts";
 export { renderMarkdownWithinHtmlFragment } from "./src/core/nodeviews/html-markdown-preview.ts";`,
      resolveDir: root,
    },
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile: output,
  });
const {
  defaultParser,
  livemdSchema,
  serializeSliceToMarkdownText,
  serializeMarkdown,
  createEnhancedToggleSyntax,
  renderMarkdownWithinHtmlFragment,
} = await import(pathToFileURL(output).href);
test("单列表项部分复制不带前缀，跨列表项保留前缀", () => {
  const doc = defaultParser.parse("- alpha beta\n- gamma").doc;
  let pos;
  doc.descendants((node, p) => {
    if (node.isText && node.text.includes("alpha")) pos = p;
  });
  assert.equal(
    serializeSliceToMarkdownText(livemdSchema, doc.slice(pos + 2, pos + 5, true)),
    "pha"
  );
  assert.match(
    serializeSliceToMarkdownText(livemdSchema, doc.slice(0, doc.content.size)),
    /- alpha/
  );
});
test("HTML summary 与 details 内 Markdown 渲染，pre 保持原文", () => {
  const window = new Window();
  globalThis.Node = window.Node;
  globalThis.Element = window.Element;
  const fragment = window.document.createDocumentFragment();
  const root = window.document.createElement("details");
  root.innerHTML = "<summary>**title**</summary>\n\n- alpha\n- beta\n<pre>**raw**</pre>";
  fragment.append(root);
  renderMarkdownWithinHtmlFragment(fragment);
  assert.equal(root.querySelector("summary strong")?.textContent, "title");
  assert.equal(root.querySelectorAll("li").length, 2);
  assert.equal(root.querySelector("pre").textContent, "**raw**");
});
test("紧邻已有加粗区域时合并，不生成四连星", () => {
  const doc = defaultParser.parse("alpha **beta**").doc;
  let start;
  doc.descendants((node, p) => {
    if (node.isText && node.text.startsWith("alpha")) start = p;
  });
  let state = EditorState.create({ doc, selection: TextSelection.create(doc, start, start + 6) });
  createEnhancedToggleSyntax("**", "**")(state, (tr) => {
    state = state.apply(tr);
  });
  assert.equal(state.doc.textContent, "**alpha beta**");
  assert.doesNotMatch(serializeMarkdown(state.doc), /\*{4}/);
});

test("桥接两个已有加粗区域时保留外层标记", () => {
  const doc = defaultParser.parse("**left** middle **right**").doc;
  let from;
  doc.descendants((node, p) => {
    if (node.isText && node.text.includes(" middle ")) from = p;
  });
  let state = EditorState.create({ doc, selection: TextSelection.create(doc, from, from + 8) });
  createEnhancedToggleSyntax("**", "**")(state, (tr) => {
    state = state.apply(tr);
  });
  assert.equal(state.doc.textContent, "**left middle right**");
});
