/**
 * 标题 / 表格折叠计算（纯函数，不依赖 ProseMirror，便于单元测试）
 *
 * - 标题（h1~h6）折叠：隐藏该标题之后、下一个同级或更高级标题之前的所有顶层块；
 * - 表格折叠：隐藏表格节点整体；
 * - 折叠不修改文档结构，只影响装饰（Markdown 序列化不受影响）。
 */

/** 顶层块的折叠相关信息 */
export interface FoldableBlockInfo {
  /** 节点类型名（heading / table / paragraph 等） */
  type: string;
  /** 标题层级（仅 heading 有效，1~6） */
  level?: number;
}

/** 折叠装饰计划：以顶层块索引为键 */
export interface FoldPlan {
  /** 渲染折叠箭头的块索引（标题 + 表格） */
  targets: Set<number>;
  /** 被隐藏的块索引 */
  hidden: Set<number>;
}

/**
 * 计算折叠装饰计划
 *
 * @param blocks 顶层块序列（类型 + 标题层级）
 * @param folded 已折叠块的索引集合
 */
export function computeFoldPlan(
  blocks: FoldableBlockInfo[],
  folded: ReadonlySet<number>
): FoldPlan {
  const targets = new Set<number>();
  const hidden = new Set<number>();

  blocks.forEach((block, index) => {
    // 标题与表格可折叠：渲染箭头
    if (block.type === "heading" || block.type === "table") {
      targets.add(index);
    }
    // 表格折叠：整体隐藏
    if (block.type === "table" && folded.has(index)) {
      hidden.add(index);
    }
  });

  // 标题折叠：隐藏后续块直到同级或更高级标题（或文档结束）
  blocks.forEach((block, index) => {
    if (block.type !== "heading" || !folded.has(index)) return;
    const level = block.level ?? 1;
    for (let next = index + 1; next < blocks.length; next += 1) {
      const candidate = blocks[next];
      if (candidate.type === "heading" && (candidate.level ?? 1) <= level) break;
      hidden.add(next);
    }
  });

  return { targets, hidden };
}

/**
 * 判断给定位置区间是否与被隐藏区间相交（用于折叠时光标避让）
 *
 * @param hiddenRanges 隐藏区间列表 [from, to)
 * @param from 光标起点
 * @param to 光标终点
 */
export function intersectsHiddenRange(
  hiddenRanges: Array<{ from: number; to: number }>,
  from: number,
  to: number
): boolean {
  return hiddenRanges.some((range) => from < range.to && to > range.from);
}
