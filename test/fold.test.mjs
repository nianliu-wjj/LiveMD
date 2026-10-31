import assert from "node:assert/strict";
import test from "node:test";
import { computeFoldPlan, intersectsHiddenRange } from "../src/core/utils/fold.ts";

/** 便捷构造顶层块序列 */
function blocks(spec) {
  return spec.map(([type, level]) => (level === undefined ? { type } : { type, level }));
}

test("computeFoldPlan: 标题与表格进入 targets，段落不进入", () => {
  const plan = computeFoldPlan(
    blocks([["heading", 1], ["paragraph"], ["table"], ["heading", 2]]),
    new Set()
  );
  assert.deepEqual(
    [...plan.targets].sort((a, b) => a - b),
    [0, 2, 3]
  );
  assert.equal(plan.hidden.size, 0);
});

test("computeFoldPlan: 折叠 h1 隐藏到下一个同级或更高级标题之前", () => {
  const plan = computeFoldPlan(
    blocks([
      ["heading", 1],
      ["paragraph"],
      ["heading", 2],
      ["paragraph"],
      ["paragraph"],
      ["heading", 1],
    ]),
    new Set([0])
  );
  assert.deepEqual(
    [...plan.hidden].sort((a, b) => a - b),
    [1, 2, 3, 4]
  );
});

test("computeFoldPlan: 折叠 h2 只隐藏到下一个 h2/h1", () => {
  const plan = computeFoldPlan(
    blocks([
      ["heading", 2],
      ["paragraph"],
      ["heading", 3],
      ["paragraph"],
      ["heading", 2],
      ["paragraph"],
    ]),
    new Set([0])
  );
  // h3 属于更深层级，仍被折叠；遇到同级 h2（索引 4）停止
  assert.deepEqual(
    [...plan.hidden].sort((a, b) => a - b),
    [1, 2, 3]
  );
});

test("computeFoldPlan: 文档末尾标题折叠后无隐藏块", () => {
  const plan = computeFoldPlan(
    blocks([["heading", 1], ["paragraph"], ["heading", 2]]),
    new Set([2])
  );
  assert.equal(plan.hidden.size, 0);
});

test("computeFoldPlan: 表格折叠隐藏自身", () => {
  const plan = computeFoldPlan(blocks([["paragraph"], ["table"], ["paragraph"]]), new Set([1]));
  assert.deepEqual([...plan.hidden], [1]);
  assert.deepEqual([...plan.targets], [1]);
});

test("computeFoldPlan: 段落索引上的折叠不产生任何隐藏", () => {
  const plan = computeFoldPlan(
    blocks([["heading", 1], ["paragraph"], ["paragraph"]]),
    new Set([1])
  );
  assert.equal(plan.hidden.size, 0);
});

test("computeFoldPlan: 多处折叠的隐藏集合合并", () => {
  const plan = computeFoldPlan(
    blocks([["heading", 1], ["paragraph"], ["heading", 1], ["paragraph"], ["table"]]),
    new Set([0, 2, 4])
  );
  assert.deepEqual(
    [...plan.hidden].sort((a, b) => a - b),
    [1, 3, 4]
  );
});

test("computeFoldPlan: 空文档与空折叠集合安全返回", () => {
  assert.equal(computeFoldPlan([], new Set()).targets.size, 0);
  const plan = computeFoldPlan(blocks([["heading", 1], ["paragraph"]]), new Set());
  assert.equal(plan.hidden.size, 0);
  assert.deepEqual([...plan.targets], [0]);
});

test("computeFoldPlan: 缺少 level 的标题按 1 级处理", () => {
  const plan = computeFoldPlan(blocks([["heading"], ["paragraph"], ["heading", 2]]), new Set([0]));
  // 同级判定：无 level 视作 1 级，因此遇到索引 2 的 h2 不会停止（1 < 2 继续隐藏）
  assert.deepEqual(
    [...plan.hidden].sort((a, b) => a - b),
    [1, 2]
  );
});

test("intersectsHiddenRange: 相交判定", () => {
  const ranges = [{ from: 10, to: 20 }];
  assert.equal(intersectsHiddenRange(ranges, 15, 16), true);
  assert.equal(intersectsHiddenRange(ranges, 5, 11), true);
  assert.equal(intersectsHiddenRange(ranges, 19, 25), true);
  assert.equal(intersectsHiddenRange(ranges, 20, 25), false);
  assert.equal(intersectsHiddenRange(ranges, 0, 10), false);
  assert.equal(intersectsHiddenRange([], 0, 10), false);
});
