import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkdown } from "../src/core/parser/index.ts";

/** 在文档中找到第一个表格节点 */
function findFirstTable(doc) {
  let table = null;
  doc.forEach((node) => {
    if (node.type.name === "table" && !table) table = node;
  });
  return table;
}

test("表格单元格内 inline code 的管道符不再错位拆行", () => {
  const markdown = [
    "| 版本 | 关键特性 |",
    "| --- | --- |",
    "| 3.9 / 3.10 | dict 合并 `|`、结构模式匹配 `match` |",
    "| 3.11 | T 格式化 |",
  ].join("\n");

  const { doc } = parseMarkdown(markdown);
  const table = findFirstTable(doc);
  assert.ok(table, "应解析出表格节点");
  assert.equal(table.childCount, 3, "表头 + 2 条数据行");

  const row = table.child(1);
  assert.equal(row.childCount, 2, "数据行应保持 2 个单元格");
  assert.ok(row.child(1).textContent.includes("结构模式匹配"), "行内代码后的文本应留在同一单元格");
});

test("普通表格解析与对齐行为保持不变", () => {
  const markdown = ["| Name | Age |", "| :-- | --: |", "| Alice | 30 |"].join("\n");

  const { doc } = parseMarkdown(markdown);
  const table = findFirstTable(doc);
  assert.ok(table);
  assert.equal(table.childCount, 2);

  const header = table.child(0);
  assert.equal(header.childCount, 2);
  assert.equal(header.child(0).attrs.align, "left");
  assert.equal(header.child(1).attrs.align, "right");
});
