import assert from "node:assert/strict";
import test from "node:test";
import {
  countDocumentStats,
  countMarkdownChars,
  countMarkdownLines,
  countParagraphs,
  countWords,
  formatReadingTime,
} from "../src/renderer/utils/wordCount.ts";

test("word count treats CJK characters and latin words separately", () => {
  assert.equal(countWords("你好，世界 Hello world 100"), 7);
  assert.equal(countWords(""), 0);
  assert.equal(countWords("纯中文测试"), 5);
  assert.equal(countWords("only english words"), 3);
});

test("word count ignores image base64 payloads", () => {
  const markdown = "![x](data:image/png;base64,AAAA)";
  assert.equal(countWords(markdown), 2);
  assert.equal(countMarkdownChars(markdown), countMarkdownChars("![x](image)"));
});

test("markdown line and character counts keep the existing status bar semantics", () => {
  assert.equal(countMarkdownLines("a\n\nb\nc"), 2);
  assert.equal(countMarkdownLines("a\n\nb\nc", { skipEmpty: false }), 2);
  assert.equal(countMarkdownLines(""), 0);
  assert.equal(countMarkdownChars("abc 中文"), 6);
});

test("paragraph count splits on blank lines", () => {
  assert.equal(countParagraphs("a\n\nb\nc"), 2);
  assert.equal(countParagraphs("   \n\n  "), 0);
});

test("document stats aggregates all counters", () => {
  const markdown = "你好 world\n\n第二段 text";
  const stats = countDocumentStats(markdown);
  assert.equal(stats.words, 7);
  assert.equal(stats.characters, countMarkdownChars(markdown));
  assert.equal(stats.lines, 2);
  assert.equal(stats.paragraphs, 2);
  assert.equal(stats.readingSeconds, Math.round((7 / 250) * 60));
});

test("reading time formats seconds and minutes", () => {
  assert.equal(formatReadingTime(0), "0 秒");
  assert.equal(formatReadingTime(30), "30 秒");
  assert.equal(formatReadingTime(60), "1 分钟");
  assert.equal(formatReadingTime(90), "2 分钟");
});
