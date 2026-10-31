import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPanguSpacing,
  isCjkChar,
  isFullWidthPunctuation,
  needsPanguSpacing,
} from "../src/core/utils/pangu.ts";

test("applyPanguSpacing: 中文与英文之间插入空格", () => {
  assert.equal(applyPanguSpacing("中文English中文"), "中文 English 中文");
});

test("applyPanguSpacing: 中文与数字之间插入空格", () => {
  assert.equal(applyPanguSpacing("共12个字符"), "共 12 个字符");
});

test("applyPanguSpacing: 已有空格不重复插入（幂等）", () => {
  const once = applyPanguSpacing("中文 English 中文12个");
  assert.equal(applyPanguSpacing(once), once);
  assert.equal(once, "中文 English 中文 12 个");
});

test("applyPanguSpacing: 全角标点相邻处不插入空格", () => {
  assert.equal(applyPanguSpacing("中文：English"), "中文：English");
  assert.equal(applyPanguSpacing("English，中文"), "English，中文");
  assert.equal(applyPanguSpacing("他说“中文English”"), "他说“中文 English”");
});

test("applyPanguSpacing: 纯英文与纯中文行不被改动", () => {
  assert.equal(applyPanguSpacing("hello world"), "hello world");
  assert.equal(applyPanguSpacing("只有中文，没有英文"), "只有中文，没有英文");
});

test("applyPanguSpacing: 围栏代码块整段跳过", () => {
  const content = ["```js", "const 中文Var=1", "```", "中文Var 定义"].join("\n");
  const expected = ["```js", "const 中文Var=1", "```", "中文 Var 定义"].join("\n");
  assert.equal(applyPanguSpacing(content), expected);
});

test("applyPanguSpacing: 波浪号围栏同样跳过", () => {
  const content = ["~~~", "中文English", "~~~"].join("\n");
  assert.equal(applyPanguSpacing(content), content);
});

test("applyPanguSpacing: 行内代码内部不改动", () => {
  assert.equal(applyPanguSpacing("用 `中文English` 表示"), "用 `中文English` 表示");
});

test("applyPanguSpacing: 链接与图片目标被保护，链接文字仍参与排版", () => {
  assert.equal(
    applyPanguSpacing("[中文English](https://example.com/中文English)"),
    "[中文 English](https://example.com/中文English)"
  );
  assert.equal(
    applyPanguSpacing("![中文Alt](https://a.com/x中文)"),
    "![中文 Alt](https://a.com/x中文)"
  );
});

test("applyPanguSpacing: HTML 标签被保护", () => {
  assert.equal(applyPanguSpacing("<span>中文English</span>"), "<span>中文 English</span>");
});

test("applyPanguSpacing: 空内容与纯空行安全返回", () => {
  assert.equal(applyPanguSpacing(""), "");
  assert.equal(applyPanguSpacing("\n\n"), "\n\n");
});

test("needsPanguSpacing: 仅在有可排版边界时为真", () => {
  assert.equal(needsPanguSpacing("中文English"), true);
  assert.equal(needsPanguSpacing("中文 English"), false);
  assert.equal(needsPanguSpacing("```\n中文English\n```"), false);
  assert.equal(needsPanguSpacing(""), false);
});

test("isCjkChar / isFullWidthPunctuation: 字符判定", () => {
  assert.equal(isCjkChar("中"), true);
  assert.equal(isCjkChar("あ"), true);
  assert.equal(isCjkChar("a"), false);
  assert.equal(isCjkChar(""), false);
  assert.equal(isFullWidthPunctuation("，"), true);
  assert.equal(isFullWidthPunctuation("“"), true);
  assert.equal(isFullWidthPunctuation(","), false);
});
