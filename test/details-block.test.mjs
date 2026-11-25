import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkdown } from "../src/core/parser/index.ts";
import { serializeMarkdown } from "../src/core/serializer/index.ts";

const source =
  "<details open>\n<summary>**标题**</summary>\n\n正文\n\n```html\n<div>hello</div>\n```\n\n</details>";
test("details 内摘要、段落、代码块均为可编辑结构", () => {
  const node = parseMarkdown(source).doc.firstChild;
  assert.equal(node.type.name, "details");
  assert.equal(node.childCount, 3);
  assert.equal(node.firstChild.type.name, "summary");
  assert.ok(
    node.firstChild.content.content.some((child) =>
      child.marks.some((mark) => mark.type.name === "strong")
    )
  );
  assert.equal(node.child(1).type.name, "paragraph");
  assert.equal(node.child(2).type.name, "code_block");
  assert.equal(node.child(2).textContent, "<div>hello</div>");
});
test("details 保存往返保留内容与展开属性", () => {
  const doc = parseMarkdown(source).doc;
  const serialized = serializeMarkdown(doc);
  assert.ok(serialized.includes("<details open>"));
  assert.ok(serialized.includes("<summary>**标题**</summary>"));
  assert.deepEqual(parseMarkdown(serialized).doc.toJSON(), doc.toJSON());
});
test("没有 summary 时补空摘要", () => {
  const node = parseMarkdown("<details>\n正文\n</details>").doc.firstChild;
  assert.equal(node.firstChild.type.name, "summary");
  assert.equal(node.firstChild.textContent, "");
  assert.equal(node.attrs.open, false);
});
test("嵌套 details 与代码中的闭合标签不会提前截断", () => {
  const node = parseMarkdown(
    "<details>\n<summary>外层</summary>\n\n<details>\n<summary>内层</summary>\n\n```html\n</details>\n```\n</details>\n</details>"
  ).doc.firstChild;
  assert.equal(node.child(1).type.name, "details");
  assert.equal(node.child(1).child(1).textContent, "</details>");
});
test("单行 details 可解析", () => {
  const node = parseMarkdown("<details><summary>标题</summary>正文</details>").doc.firstChild;
  assert.equal(node.type.name, "details");
  assert.equal(node.child(1).textContent, "正文");
});
test("未闭合 details 与其他 HTML 保留原文", () => {
  for (const source of ["<details>\n<summary>未闭合</summary>", "<div>\n正文\n</div>"]) {
    const node = parseMarkdown(source).doc.firstChild;
    assert.equal(node.type.name, "html_block");
    assert.equal(node.textContent, source);
  }
});
