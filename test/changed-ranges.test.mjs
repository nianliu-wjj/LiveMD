import assert from "node:assert/strict";
import test from "node:test";
import { Schema } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import {
  expandRangeToBlocks,
  forEachNodeInRanges,
  getAffectedBlockRanges,
  getAffectedRanges,
} from "../src/core/plugins/changed-ranges.ts";

/** 最小 schema：doc / paragraph / blockquote / text + strong mark（mark-only step 用例） */
const schema = new Schema({
  nodes: {
    doc: { content: "block*" },
    paragraph: { content: "text*", group: "block" },
    blockquote: { content: "block+", group: "block" },
    text: { group: "inline" },
  },
  marks: {
    strong: {},
  },
});

function p(text) {
  return schema.nodes.paragraph.create(null, text ? schema.text(text) : null);
}
function bq(...children) {
  return schema.nodes.blockquote.create(null, children);
}
function doc(...children) {
  return schema.nodes.doc.create(null, children);
}
function stateOf(d) {
  return EditorState.create({ schema, doc: d });
}

test("空文档：expandRangeToBlocks 与全量插入不抛错且范围合法", () => {
  const empty = doc();
  assert.deepEqual(expandRangeToBlocks(empty, { from: 0, to: 0 }), { from: 0, to: 0 });

  // 空文档插入第一个段落：变更范围 = 新段落全部
  const tr = stateOf(empty).tr.insert(0, p("a"));
  assert.deepEqual(getAffectedBlockRanges(tr.doc, [tr]), [{ from: 0, to: 3 }]);
});

test("越界与非法坐标：钳制到 [0, size]，不抛 RangeError", () => {
  const d = doc(p("aa"), p("bb"));
  const size = d.content.size;

  assert.deepEqual(expandRangeToBlocks(d, { from: -5, to: 9999 }), { from: 0, to: size });

  const nan = expandRangeToBlocks(d, { from: Number.NaN, to: Number.NaN });
  assert.ok(nan.from >= 0 && nan.to <= size && nan.from <= nan.to);

  // from > to 也应被归一化
  const reversed = expandRangeToBlocks(d, { from: 6, to: 1 });
  assert.deepEqual(reversed, { from: 0, to: size });
});

test("块间边界：顶层 depth=0 位置扩张 ±1 块，绝不调用 before(0)/after(0)", () => {
  // 三个段落，各占 4 个位置：边界在 0 / 4 / 8 / 12
  const d = doc(p("aa"), p("bb"), p("cc"));

  // 文档起点
  assert.deepEqual(expandRangeToBlocks(d, { from: 0, to: 0 }), { from: 0, to: 4 });
  // 第 1/2 块之间
  assert.deepEqual(expandRangeToBlocks(d, { from: 4, to: 4 }), { from: 0, to: 8 });
  // 文档终点
  assert.deepEqual(expandRangeToBlocks(d, { from: 12, to: 12 }), { from: 8, to: 12 });
  // 块内位置：左右各扩一个块
  assert.deepEqual(expandRangeToBlocks(d, { from: 6, to: 6 }), { from: 0, to: 12 });
  // 首块内：左侧无块可扩
  assert.deepEqual(expandRangeToBlocks(d, { from: 2, to: 2 }), { from: 0, to: 8 });
});

test("引用块：嵌套位置扩到顶层块并可遍历到内部段落", () => {
  // p("x") 占 [0,3)，blockquote 占 [3,12)，p("y") 占 [12,15)
  const d = doc(p("x"), bq(p("inner")), p("y"));
  const range = expandRangeToBlocks(d, { from: 5, to: 5 });
  assert.deepEqual(range, { from: 0, to: 15 });

  const visited = [];
  forEachNodeInRanges(d, [range], (node) => {
    visited.push(node.type.name);
    return true;
  });
  assert.ok(visited.includes("blockquote"));
  assert.ok(visited.includes("paragraph"));
});

test("全量替换：restoreDoc 式 replaceWith(0, size) 的变更范围覆盖全文档", () => {
  const state = stateOf(doc(p("old")));
  const next = doc(p("new 1"), p("new 2"), bq(p("quoted")));
  const tr = state.tr.replaceWith(0, state.doc.content.size, next.content);

  assert.deepEqual(getAffectedBlockRanges(tr.doc, [tr]), [{ from: 0, to: tr.doc.content.size }]);
});

test("多事务：后续 step 的映射把各步坐标推到最终文档", () => {
  const s0 = stateOf(doc(p("aa"), p("bb"), p("cc")));
  const tr1 = s0.tr.insertText("Z", 1); // 块 0 → "Zaa"，后续块整体右移 1
  const s1 = s0.apply(tr1);
  const tr2 = s1.tr.insertText("Q", 10); // 块 2 内（原 9，移位后 10）

  assert.deepEqual(getAffectedRanges([tr1, tr2]), [
    { from: 1, to: 2 },
    { from: 10, to: 11 },
  ]);

  // 两段范围各自扩张 ±1 块后重叠，合并为整篇
  assert.deepEqual(getAffectedBlockRanges(tr2.doc, [tr1, tr2]), [
    { from: 0, to: tr2.doc.content.size },
  ]);
});

test("仅 mark 变化的 step 没有 StepMap 区间，按 step.from/to 兜底", () => {
  const state = stateOf(doc(p("hello"), p("world")));
  const tr = state.tr.addMark(1, 4, schema.marks.strong.create());
  assert.deepEqual(getAffectedRanges([tr]), [{ from: 1, to: 4 }]);
});

test("无文档变更的事务不产生范围，forEachNodeInRanges 对空范围不遍历", () => {
  const state = stateOf(doc(p("a")));
  const tr = state.tr; // 无 step
  assert.deepEqual(getAffectedRanges([tr]), []);

  let count = 0;
  forEachNodeInRanges(state.doc, [{ from: 1, to: 1 }], () => {
    count += 1;
  });
  assert.equal(count, 0);
});

test("forEachNodeInRanges：多范围落在同一节点时只回调一次", () => {
  const d = doc(p("abc"));
  const seen = [];
  forEachNodeInRanges(
    d,
    [
      { from: 0, to: 2 },
      { from: 2, to: 5 },
    ],
    (node, pos) => {
      seen.push(`${node.type.name}@${pos}`);
      return true;
    }
  );
  assert.deepEqual(seen, ["paragraph@0", "text@1"]);
});
