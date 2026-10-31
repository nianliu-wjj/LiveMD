import assert from "node:assert/strict";
import test from "node:test";
import { formatMarkdownTables } from "../src/renderer/utils/tableFormat.ts";

test("aligns table columns and trims cell padding", () => {
  const input = [
    "| Name | Age |",
    "|---|---|",
    "|Alice|30|",
    "|张三|7|",
  ].join("\n");

  assert.equal(
    formatMarkdownTables(input),
    [
      "| Name  | Age |",
      "| ----- | --- |",
      "| Alice | 30  |",
      "| 张三  | 7   |",
    ].join("\n")
  );
});

test("preserves GFM alignment markers", () => {
  const input = [
    "| left | center | right |",
    "| :--- | :----: | ----: |",
    "| a | b | c |",
  ].join("\n");

  assert.equal(
    formatMarkdownTables(input),
    [
      "| left | center | right |",
      "| :--- | :----: | ----: |",
      "| a    |   b    |     c |",
    ].join("\n")
  );
});

test("keeps fenced code blocks untouched", () => {
  const input = [
    "```md",
    "| a | b |",
    "|---|---|",
    "```",
    "",
    "~~~",
    "| c | d |",
    "| --- | --- |",
    "~~~",
  ].join("\n");

  assert.equal(formatMarkdownTables(input), input);
});

test("handles escaped pipes and pipes inside inline code", () => {
  const input = [
    "| a \\| b | `x|y` |",
    "| --- | --- |",
    "| 1 | 2 |",
  ].join("\n");

  assert.equal(
    formatMarkdownTables(input),
    [
      "| a \\| b | `x|y` |",
      "| ------ | ----- |",
      "| 1      | 2     |",
    ].join("\n")
  );
});

test("ignores text that is not a GFM table", () => {
  const input = [
    "This | is not a table.",
    "",
    "| not | a table |",
    "",
    "| a | b |",
    "not a delimiter",
  ].join("\n");

  assert.equal(formatMarkdownTables(input), input);
});

test("preserves CRLF line endings and trailing newline", () => {
  const input = "| a | b |\r\n| --- | --- |\r\n| 1 | 2 |\r\n";
  assert.equal(
    formatMarkdownTables(input),
    "| a   | b   |\r\n| --- | --- |\r\n| 1   | 2   |\r\n"
  );
});

test("leaves malformed row counts alone", () => {
  const input = [
    "| a | b |",
    "| --- | --- |",
    "| only-one |",
  ].join("\n");

  assert.equal(formatMarkdownTables(input), input);
});

test("returns unchanged text when there is nothing to format", () => {
  const input = "# 标题\n\n普通段落。\n";
  assert.equal(formatMarkdownTables(input), input);
});
