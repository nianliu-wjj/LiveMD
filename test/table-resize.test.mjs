import assert from "node:assert/strict";
import test from "node:test";
import {
  clampColumnWidth,
  clampRowHeight,
  computeResizeDirection,
  forEachTableCell,
  MIN_COLUMN_WIDTH,
  MIN_ROW_HEIGHT,
  parsePxValue,
  RESIZE_EDGE_TOLERANCE,
} from "../src/core/utils/table-resize.ts";

test("computeResizeDirection: 右缘命中判定为列宽调整", () => {
  assert.equal(computeResizeDirection(200 - RESIZE_EDGE_TOLERANCE, 10, 200, 40), "col");
  assert.equal(computeResizeDirection(200, 10, 200, 40), "col");
});

test("computeResizeDirection: 下缘命中判定为行高调整", () => {
  assert.equal(computeResizeDirection(10, 40 - RESIZE_EDGE_TOLERANCE, 200, 40), "row");
  assert.equal(computeResizeDirection(10, 40, 200, 40), "row");
});

test("computeResizeDirection: 右下角同时命中时优先列宽", () => {
  assert.equal(computeResizeDirection(199, 39, 200, 40), "col");
});

test("computeResizeDirection: 远离边缘返回 null", () => {
  assert.equal(computeResizeDirection(100, 20, 200, 40), null);
  assert.equal(computeResizeDirection(0, 0, 200, 40), null);
});

test("clampColumnWidth: 下限与取整", () => {
  assert.equal(clampColumnWidth(10), MIN_COLUMN_WIDTH);
  assert.equal(clampColumnWidth(120.4), 120);
  assert.equal(clampColumnWidth(120.6), 121);
});

test("clampRowHeight: 下限与取整", () => {
  assert.equal(clampRowHeight(5), MIN_ROW_HEIGHT);
  assert.equal(clampRowHeight(48.5), 49);
});

test("clampColumnWidth / clampRowHeight: 非有限值回退到下限", () => {
  assert.equal(clampColumnWidth(Number.NaN), MIN_COLUMN_WIDTH);
  assert.equal(clampColumnWidth(Number.POSITIVE_INFINITY), MIN_COLUMN_WIDTH);
  assert.equal(clampRowHeight(Number.NaN), MIN_ROW_HEIGHT);
});

test("parsePxValue: 合法与非法样式值", () => {
  assert.equal(parsePxValue("120px"), 120);
  assert.equal(parsePxValue(" 88.5px "), 88.5);
  assert.equal(parsePxValue("0px"), null);
  assert.equal(parsePxValue("120"), null);
  assert.equal(parsePxValue("auto"), null);
  assert.equal(parsePxValue(null), null);
});

test("forEachTableCell: 推导每个 cell 的绝对位置", () => {
  // 构造 2x2 表格：cell nodeSize = 5（含前后边界），row nodeSize = 11
  const cell = (label) => ({
    nodeSize: 5,
    childCount: 0,
    child: () => cell(label),
    attrs: { label },
  });
  const row = (cells) => ({
    nodeSize: 11,
    childCount: cells.length,
    child: (i) => cells[i],
    attrs: {},
  });
  const table = {
    nodeSize: 24,
    childCount: 2,
    child: (i) => [row([cell("a"), cell("b")]), row([cell("c"), cell("d")])][i],
    attrs: {},
  };

  const seen = [];
  forEachTableCell(table, 100, (node, pos, rowIdx, colIdx) => {
    seen.push([node.attrs.label, pos, rowIdx, colIdx]);
  });

  assert.deepEqual(seen, [
    ["a", 102, 0, 0],
    ["b", 107, 0, 1],
    ["c", 113, 1, 0],
    ["d", 118, 1, 1],
  ]);
});
