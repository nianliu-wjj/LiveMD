/** 折叠时保留的代码预览行数（与 Typora fence_enhance 默认值一致） */
export const CODE_BLOCK_FOLD_PREVIEW_LINES = 5;

const DEFAULT_LINE_HEIGHT = 20;

/**
 * 判断代码块是否允许折叠
 *
 * Mermaid 图表模式只展示渲染结果，折叠代码编辑区没有意义。
 */
export function canFoldCodeBlock(lineCount: number, isDiagram: boolean): boolean {
  return (
    !isDiagram &&
    Number.isFinite(lineCount) &&
    lineCount > CODE_BLOCK_FOLD_PREVIEW_LINES
  );
}

/**
 * 计算折叠后的 CodeMirror 滚动区域高度
 *
 * 行高由 CodeMirror 实际测量，额外加上内容区的上下内边距。
 */
export function getCodeBlockFoldHeight(
  lineHeight: number,
  totalVerticalPadding: number
): number {
  const safeLineHeight =
    Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : DEFAULT_LINE_HEIGHT;
  const safePadding =
    Number.isFinite(totalVerticalPadding) && totalVerticalPadding > 0
      ? totalVerticalPadding
      : 0;

  return Math.ceil(safeLineHeight * CODE_BLOCK_FOLD_PREVIEW_LINES + safePadding);
}
