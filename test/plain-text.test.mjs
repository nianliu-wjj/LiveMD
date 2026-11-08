import assert from "node:assert/strict";
import test from "node:test";
import { MarkdownParser } from "../src/core/parser/index.ts";
import { extractPlainText, markdownToPlainText } from "../src/core/utils/plain-text.ts";

const parser = new MarkdownParser();

function plainOf(markdown) {
  return markdownToPlainText(markdown, parser);
}

test("复制纯文本：去掉加粗/斜体/行内代码等语法标记", () => {
  assert.equal(plainOf("**加粗** 与 *斜体* 和 `code`"), "加粗 与 斜体 和 code");
});

test("复制纯文本：链接只保留文字，标题去掉井号", () => {
  assert.equal(plainOf("# 标题\n\n[链接](https://example.com)"), "标题\n链接");
});

test("复制纯文本：多个段落之间保留换行", () => {
  assert.equal(plainOf("第一段\n\n第二段"), "第一段\n第二段");
});

test("复制纯文本：表格单元格用制表符分隔，行之间换行", () => {
  const text = plainOf("| a | b |\n| --- | --- |\n| **1** | 2 |");
  assert.equal(text, "a\tb\n1\t2");
});

test("复制纯文本：代码块保留代码原文", () => {
  const text = plainOf("```js\nconst a = 1;\n```");
  assert.match(text, /const a = 1;/);
  assert.doesNotMatch(text, /```/);
});

test("extractPlainText：空范围返回空字符串", () => {
  const { doc } = parser.parse("abc");
  assert.equal(extractPlainText(doc, 3, 3), "");
});
