import assert from "node:assert/strict";
import test from "node:test";
import { buildTableDelimiterRow } from "../src/core/utils/table.ts";

test("buildTableDelimiterRow: 按列对齐生成 GFM 分隔行", () => {
  assert.deepEqual(buildTableDelimiterRow(["left", "center", "right"]), [":---", ":---:", "---:"]);
});

test("buildTableDelimiterRow: 未设置对齐时输出基础分隔符", () => {
  assert.deepEqual(buildTableDelimiterRow([null, undefined, null]), ["---", "---", "---"]);
});

test("buildTableDelimiterRow: 混合对齐与未知取值", () => {
  assert.deepEqual(buildTableDelimiterRow(["left", null, "center", "weird"]), [
    ":---",
    "---",
    ":---:",
    "---",
  ]);
});

test("buildTableDelimiterRow: 空列返回空数组", () => {
  assert.deepEqual(buildTableDelimiterRow([]), []);
});
