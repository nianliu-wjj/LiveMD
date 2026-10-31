import assert from "node:assert/strict";
import test from "node:test";
import { splitTableCells } from "../src/core/utils/table.ts";

test("inline code 内的管道符不作为单元格分隔符", () => {
  // 来源：真实文档 `| 3.9 / 3.10 | dict 合并 \`|\`、结构模式匹配 \`match\` |`
  const cells = splitTableCells(" 3.9 / 3.10 | dict 合并 `|`、结构模式匹配 `match` ");
  assert.deepEqual(cells, [" 3.9 / 3.10 ", " dict 合并 `|`、结构模式匹配 `match` "]);
});

test("普通单元格仍按管道符切分", () => {
  assert.deepEqual(splitTableCells("a | b | c"), ["a ", " b ", " c"]);
});

test("空单元格被保留", () => {
  assert.deepEqual(splitTableCells("a||b"), ["a", "", "b"]);
});

test("\\| 转义序列不切分且原样保留", () => {
  assert.deepEqual(splitTableCells("a\\|b"), ["a\\|b"]);
  assert.deepEqual(splitTableCells("a\\|b|c"), ["a\\|b", "c"]);
});

test("代码域长度一致的成对反引号成功闭合", () => {
  assert.deepEqual(splitTableCells("`a`b|c"), ["`a`b", "c"]);
});

test("长度不同的反引号串不闭合代码域", () => {
  // 一个反引号开启，两个反引号不算闭合，之后的管道符仍在代码域内
  assert.deepEqual(splitTableCells("`a``b|c"), ["`a``b|c"]);
});

test("双反引号代码域内的单管道符不切分", () => {
  assert.deepEqual(splitTableCells("``x|y`` z|w"), ["``x|y`` z", "w"]);
});

test("未闭合代码域内所有管道符都不切分", () => {
  assert.deepEqual(splitTableCells("`a|b"), ["`a|b"]);
});

test("代码域内的反斜杠转义也不产生切分", () => {
  assert.deepEqual(splitTableCells("`a\\|b` | c"), ["`a\\|b` ", " c"]);
});
