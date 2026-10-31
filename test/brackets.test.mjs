import assert from "node:assert/strict";
import test from "node:test";
import {
  CJK_OPENERS,
  computeAutoPair,
  DEFAULT_AUTO_PAIR_OPTIONS,
  PAIR_CLOSERS,
  PAIR_OPENERS,
  shouldDeletePair,
} from "../src/core/utils/brackets.ts";

test("符号对表：开闭符号成对且中文开符号齐备", () => {
  assert.equal(PAIR_OPENERS.length, 14);
  assert.equal(PAIR_CLOSERS.length, 14);
  for (const opener of ["《", "【", "（", "「", "『", "“", "‘"]) {
    assert.ok(CJK_OPENERS.includes(opener), `缺少中文开符号 ${opener}`);
  }
});

test("computeAutoPair: 中文标点默认插入成对并落光标中间", () => {
  assert.deepEqual(computeAutoPair("中文", "", "（", false), {
    type: "insert-pair",
    open: "（",
    close: "）",
  });
  assert.deepEqual(computeAutoPair("", "", "《", false), {
    type: "insert-pair",
    open: "《",
    close: "》",
  });
});

test("computeAutoPair: ASCII 括号默认不参与，开启后参与", () => {
  assert.deepEqual(computeAutoPair("", "", "(", false), { type: "default" });
  assert.deepEqual(
    computeAutoPair("", "", "(", false, { ...DEFAULT_AUTO_PAIR_OPTIONS, asciiBrackets: true }),
    { type: "insert-pair", open: "(", close: ")" }
  );
});

test("computeAutoPair: 闭符号后紧跟同符号时跳过", () => {
  assert.deepEqual(computeAutoPair("（", "）后续", "）", false), { type: "skip-over" });
  assert.deepEqual(computeAutoPair("", "」", "」", false), { type: "skip-over" });
});

test("computeAutoPair: 有选区时包裹选区", () => {
  assert.deepEqual(computeAutoPair("", "", "「", true), {
    type: "wrap-selection",
    open: "「",
    close: "」",
  });
  // 闭符号在选区内不包裹，交回默认行为
  assert.deepEqual(computeAutoPair("", "", "」", true), { type: "default" });
});

test("computeAutoPair: ASCII 撇号在词字符后不闭合", () => {
  assert.deepEqual(computeAutoPair("don", "", "'", false), { type: "default" });
  assert.deepEqual(computeAutoPair("中文", "", "'", false), { type: "default" });
  // 非词字符后（如空格）仍成对
  assert.deepEqual(computeAutoPair("don ", "", "'", false), {
    type: "insert-pair",
    open: "'",
    close: "'",
  });
});

test("computeAutoPair: ASCII 双引号仅在词字符后防护", () => {
  assert.deepEqual(computeAutoPair("word", "", '"', false), { type: "default" });
  assert.deepEqual(computeAutoPair("word ", "", '"', false), {
    type: "insert-pair",
    open: '"',
    close: '"',
  });
});

test("computeAutoPair: 中文引号总是闭合", () => {
  assert.deepEqual(computeAutoPair("他说", "", "“", false), {
    type: "insert-pair",
    open: "“",
    close: "”",
  });
  assert.deepEqual(computeAutoPair("中文", "", "‘", false), {
    type: "insert-pair",
    open: "‘",
    close: "’",
  });
});

test("computeAutoPair: Markdown 强调符号默认不参与，开启后参与", () => {
  assert.deepEqual(computeAutoPair("", "", "`", false), { type: "default" });
  assert.deepEqual(
    computeAutoPair("", "", "`", false, { ...DEFAULT_AUTO_PAIR_OPTIONS, markdownSymbols: true }),
    { type: "insert-pair", open: "`", close: "`" }
  );
});

test("computeAutoPair: 普通字符与空输入不干预", () => {
  assert.deepEqual(computeAutoPair("", "", "a", false), { type: "default" });
  assert.deepEqual(computeAutoPair("", "", "", false), { type: "default" });
});

test("shouldDeletePair: 光标夹在空对中间时命中", () => {
  assert.deepEqual(shouldDeletePair("（", "）"), { open: "（", close: "）", category: "cjk" });
  assert.deepEqual(shouldDeletePair("“", "”"), { open: "“", close: "”", category: "cjk" });
  // 非空对不命中
  assert.equal(shouldDeletePair("（内容", "）"), undefined);
  assert.equal(shouldDeletePair("（", "内容）"), undefined);
  assert.equal(shouldDeletePair("", ""), undefined);
});
