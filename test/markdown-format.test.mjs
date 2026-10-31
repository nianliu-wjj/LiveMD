import assert from "node:assert/strict";
import test from "node:test";
import { formatCjkSpacing } from "../src/renderer/utils/markdownFormat.ts";

test("pads between CJK and latin letters or digits", () => {
  assert.equal(formatCjkSpacing("中文English测试123。"), "中文 English 测试 123。");
  assert.equal(formatCjkSpacing("# 标题Title"), "# 标题 Title");
  assert.equal(formatCjkSpacing("价格100元"), "价格 100 元");
});

test("does not pad around full-width punctuation or existing spaces", () => {
  assert.equal(formatCjkSpacing("中文，English。"), "中文，English。");
  assert.equal(formatCjkSpacing("中文（English）"), "中文（English）");
  assert.equal(formatCjkSpacing("已 经 有 空 格 的 English"), "已 经 有 空 格 的 English");
  assert.equal(formatCjkSpacing("中文\nEnglish"), "中文\nEnglish");
});

test("keeps inline code, math, links and html untouched", () => {
  assert.equal(formatCjkSpacing("`code中文` 文本"), "`code中文` 文本");
  assert.equal(
    formatCjkSpacing("[链接中文](https://a.com/路径?q=中)"),
    "[链接中文](https://a.com/路径?q=中)"
  );
  assert.equal(formatCjkSpacing("<!-- 注释中文 -->"), "<!-- 注释中文 -->");
  assert.equal(formatCjkSpacing("中文<br>English"), "中文<br>English");
  assert.equal(formatCjkSpacing("行内公式$中文x$和$y=1$"), "行内公式$中文x$和$y=1$");
});

test("keeps fenced code blocks untouched", () => {
  const markdown = "```js\nconst 中文 = 1;\n```\n\n正文English";
  assert.equal(formatCjkSpacing(markdown), "```js\nconst 中文 = 1;\n```\n\n正文 English");
});

test("handles CRLF fenced code offsets", () => {
  const markdown = "code:\r\n```js\r\n中文English\r\n```\r\n中文English\r\n";
  assert.equal(
    formatCjkSpacing(markdown),
    "code:\r\n```js\r\n中文English\r\n```\r\n中文 English\r\n"
  );
});

test("pads table cells, emphasis and image alt text", () => {
  assert.equal(
    formatCjkSpacing("| 表头A | 表头b |\n| --- | --- |\n| 中文1 | x |"),
    "| 表头 A | 表头 b |\n| --- | --- |\n| 中文 1 | x |"
  );
  assert.equal(formatCjkSpacing("**粗体Bold** 中文"), "**粗体 Bold** 中文");
  assert.equal(formatCjkSpacing("图片![中文alt](img中文.png)"), "图片![中文 alt](img中文.png)");
});

test("keeps YAML front matter untouched", () => {
  const markdown = "---\ntitle: 中文Title\n---\n正文English";
  assert.equal(formatCjkSpacing(markdown), "---\ntitle: 中文Title\n---\n正文 English");
});

test("supports ignore words", () => {
  assert.equal(
    formatCjkSpacing("iPhone中文和macOS系统", { ignoreWords: ["iPhone", "macOS"] }),
    "iPhone中文和macOS系统"
  );
  assert.equal(formatCjkSpacing("iPhone中文和macOS系统"), "iPhone 中文和 macOS 系统");
});

test("does not change already padded text", () => {
  const markdown = "中文 English 测试 123。\n\n第二段 text";
  assert.equal(formatCjkSpacing(markdown), markdown);
});
