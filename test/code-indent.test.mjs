import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_INDENT_RULE,
  detectIndentWidth,
  getIndentRule,
  reindentCode,
} from "../src/core/utils/code-indent.ts";

test("getIndentRule：按语言返回惯例缩进，大小写不敏感", () => {
  assert.equal(getIndentRule("Python").unit, "    ");
  assert.equal(getIndentRule("go").unit, "\t");
  assert.equal(getIndentRule("go").useTab, true);
  assert.equal(getIndentRule("yaml").unit, "  ");
  assert.equal(getIndentRule("ts").tabSize, 2);
});

test("getIndentRule：未知语言与空语言回退 2 空格", () => {
  assert.deepEqual(getIndentRule("brainfuck"), DEFAULT_INDENT_RULE);
  assert.deepEqual(getIndentRule(""), DEFAULT_INDENT_RULE);
  assert.deepEqual(getIndentRule(null), DEFAULT_INDENT_RULE);
});

test("detectIndentWidth：识别 2 / 4 空格与制表符缩进", () => {
  assert.equal(detectIndentWidth("a\n  b\n    c"), 2);
  assert.equal(detectIndentWidth("a\n    b\n        c"), 4);
  assert.equal(detectIndentWidth("a\n\tb\n\t\tc", 4), 4);
  assert.equal(detectIndentWidth("a\nb"), 0);
});

test("reindentCode：2 空格 Python 转为 4 空格", () => {
  const source = "def f():\n  if x:\n    return 1\n  return 2";
  const expected = "def f():\n    if x:\n        return 1\n    return 2";
  assert.equal(reindentCode(source, getIndentRule("python")), expected);
});

test("reindentCode：空格缩进的 Go 转为制表符", () => {
  const source = "func f() {\n    if x {\n        return\n    }\n}";
  const expected = "func f() {\n\tif x {\n\t\treturn\n\t}\n}";
  assert.equal(reindentCode(source, getIndentRule("go")), expected);
});

test("reindentCode：制表符 JS 转为 2 空格，空行与无缩进代码保持不变", () => {
  const source = "function f() {\n\tif (x) {\n\t\treturn 1;\n\t}\n\n}";
  const expected = "function f() {\n  if (x) {\n    return 1;\n  }\n\n}";
  assert.equal(reindentCode(source, getIndentRule("javascript")), expected);
  assert.equal(reindentCode("a\nb", getIndentRule("python")), "a\nb");
});
