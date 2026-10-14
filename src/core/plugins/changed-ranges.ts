/**
 * appendTransaction 插件增量扫描工具
 *
 * 四个 appendTransaction 插件（syntax-detector / syntax-fixer / heading-sync / blockquote-alert-sync）
 * 原本在每次 docChanged 事务后 `doc.descendants()` 全文档扫描——每敲一个字符全文档遍历 ×4，
 * 大文档击键必然卡顿。本模块把"本轮事务改动了哪些位置"推导出来并扩张到顶层块边界，
 * 插件只需 `nodesBetween` 这些范围：
 *
 * - `getAffectedRanges`：把每个 step 的 StepMap 区间经后续 step 的映射推到最终文档坐标，
 *   没有 StepMap 区间的 mark / 属性类 step 按 step.from/to 兜底，再无法判定时退化为全文档；
 * - `expandRangeToBlocks`：扩张到 ±1 顶层块的安全边距（行内语法跨块边界的场景也能覆盖）。
 *   **顶层块边界处绝不调用 `before(0)/after(0)`**——ProseMirror 对 depth=0 直接 throw，
 *   打开文档的全量替换起点就是 0，曾因此导致 hydration 中断、文档空白；
 * - `forEachNodeInRanges`：多个范围落在同一节点（同一列表 / 引用块）时只回调一次。
 *
 * 边界用例见 test/changed-ranges.test.mjs。
 */
import type { Node } from "prosemirror-model";
import type { Transaction } from "prosemirror-state";
import { Mapping } from "prosemirror-transform";

export interface ChangedRange {
  from: number;
  to: number;
}

function mergeRanges(ranges: ChangedRange[]): ChangedRange[] {
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: ChangedRange[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
    else merged.push({ ...range });
  }
  return merged;
}

/** 将所有 step 的变更坐标映射到最后一条事务的文档，包含没有 StepMap 的 mark/属性变化。 */
export function getAffectedRanges(transactions: readonly Transaction[]): ChangedRange[] {
  const mapping = new Mapping();
  for (const tr of transactions) mapping.appendMapping(tr.mapping);
  const ranges: ChangedRange[] = [];
  let stepIndex = 0;
  for (const tr of transactions) {
    for (let index = 0; index < tr.steps.length; index++, stepIndex++) {
      const after = mapping.slice(stepIndex + 1);
      let mappedRange = false;
      tr.mapping.maps[index].forEach((_oldFrom, _oldTo, from, to) => {
        mappedRange = true;
        ranges.push({ from: after.map(from, -1), to: after.map(to, 1) });
      });
      if (mappedRange) continue;
      const step = tr.steps[index].toJSON();
      if (typeof step.from === "number" && typeof step.to === "number") {
        ranges.push({ from: after.map(step.from, -1), to: after.map(step.to, 1) });
      } else if (typeof step.pos === "number") {
        ranges.push({ from: after.map(step.pos, -1), to: after.map(step.pos + 1, 1) });
      } else if (tr.docChanged) {
        const finalDoc = transactions[transactions.length - 1].doc;
        return [{ from: 0, to: finalDoc.content.size }];
      }
    }
  }
  return mergeRanges(ranges);
}

/** 在顶层边界处直接使用坐标，绝不调用 before(0)/after(0)。 */
export function expandRangeToBlocks(doc: Node, range: ChangedRange): ChangedRange {
  const size = doc.content.size;
  if (!doc.childCount) return { from: 0, to: size };
  const clamp = (pos: number) => Math.max(0, Math.min(size, Number.isFinite(pos) ? pos : 0));
  const $from = doc.resolve(clamp(Math.min(range.from, range.to)));
  const $to = doc.resolve(clamp(Math.max(range.from, range.to)));
  const fromIndex = $from.index(0);
  const toIndex = $to.index(0);
  let from = $from.depth > 0 ? $from.before(1) : $from.pos;
  let to = $to.depth > 0 ? $to.after(1) : $to.pos;
  if (fromIndex > 0) from -= doc.child(fromIndex - 1).nodeSize;
  const nextIndex = $to.depth > 0 ? toIndex + 1 : toIndex;
  if (nextIndex < doc.childCount) to += doc.child(nextIndex).nodeSize;
  return { from: Math.max(0, from), to: Math.min(size, to) };
}

export function getAffectedBlockRanges(
  doc: Node,
  transactions: readonly Transaction[]
): ChangedRange[] {
  return mergeRanges(
    getAffectedRanges(transactions).map((range) => expandRangeToBlocks(doc, range))
  );
}

/** 去重祖先节点：多个不相邻范围可能落在同一个列表或引用块内。 */
export function forEachNodeInRanges(
  doc: Node,
  ranges: readonly ChangedRange[],
  callback: (node: Node, pos: number, parent: Node | null, index: number) => boolean | void
): void {
  const visited = new Map<number, boolean | void>();
  for (const { from, to } of ranges) {
    if (from === to) continue;
    doc.nodesBetween(from, to, (node, pos, parent, index) => {
      if (visited.has(pos)) return visited.get(pos);
      const result = callback(node, pos, parent, index);
      visited.set(pos, result);
      return result;
    });
  }
}
