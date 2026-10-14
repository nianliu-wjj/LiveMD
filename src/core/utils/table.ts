/**
 * 表格单元格切分
 *
 * GFM 表格按未转义的管道符分隔单元格，但 Typora 等编辑器对表格更宽容：
 * 反引号代码域内的 `|` 视为字面内容，`\|` 转义序列也不视为分隔符。
 * naive 的 `content.split("|")` 会把 inline code 里的管道符错误切开，
 * 导致单元格错位（例如 `` 合并 `|`、匹配 `` 被拆成两个单元格）。
 */

/**
 * 按单元格切分表格行内容（去掉首尾围栏管道后的部分）。
 *
 * 规则：
 * - 跳过成对反引号代码域内的 `|`（开闭域的反引号串长度必须一致，与 CommonMark 一致）；
 * - 跳过 `\|` 等反斜杠转义序列（序列整体保留在单元格内）；
 * - 其余未转义的 `|` 作为分隔符，单元格内容保留原始空白（由调用方 trim）。
 */
export function splitTableCells(content: string): string[] {
  const cells: string[] = [];
  let current = "";
  // >0 表示当前处于反引号代码域内，值为开启/闭合代码域的反引号串长度
  let codeFenceTicks = 0;

  for (let i = 0; i < content.length; ) {
    const char = content[i];

    if (char === "\\") {
      // 反斜杠转义序列成对消费，`\|` 不会在此处切断单元格
      if (i + 1 < content.length) {
        current += content.slice(i, i + 2);
        i += 2;
      } else {
        current += char;
        i += 1;
      }
      continue;
    }

    if (char === "`") {
      let ticks = 0;
      while (content[i + ticks] === "`") ticks++;
      current += content.slice(i, i + ticks);
      i += ticks;
      if (codeFenceTicks > 0) {
        // 长度一致的反引号串闭合代码域
        if (ticks === codeFenceTicks) codeFenceTicks = 0;
      } else {
        codeFenceTicks = ticks;
      }
      continue;
    }

    if (char === "|" && codeFenceTicks === 0) {
      cells.push(current);
      current = "";
      i += 1;
      continue;
    }

    current += char;
    i += 1;
  }

  cells.push(current);
  return cells;
}

/**
 * 由各列对齐值生成 GFM 表格分隔行的单元格
 *
 * left → `:---`，center → `:---:`，right → `---:`，未设置 → `---`
 * （与解析端的对齐识别互为逆运算，保证对齐能随保存写回 Markdown）
 */
export function buildTableDelimiterRow(
  alignments: ReadonlyArray<string | null | undefined>
): string[] {
  return alignments.map((align) => {
    switch (align) {
      case "left":
        return ":---";
      case "center":
        return ":---:";
      case "right":
        return "---:";
      default:
        return "---";
    }
  });
}
