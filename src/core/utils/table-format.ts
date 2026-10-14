/**
 * Markdown 表格格式化
 *
 * 对应 typora_plugin easy_modify 的 reformatTable：
 * 按列对齐 GFM 表格，统一单元格两侧空格，并保留对齐方式。
 * 只处理独立成行的管道表格，跳过围栏代码块与普通含 | 的文本。
 */

interface Alignment {
  left: boolean;
  right: boolean;
}

interface TableBlock {
  start: number;
  end: number;
  header: string[];
  alignments: Alignment[];
  rows: string[][];
}

function displayWidth(value: string): number {
  let width = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0x200b || code === 0x200c || code === 0x200d || code === 0xfeff) continue;
    const isWide =
      (code >= 0x1100 && code <= 0x115f) ||
      code === 0x2329 ||
      code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff);
    width += isWide ? 2 : 1;
  }
  return width;
}

/** 按未转义、且不在行内代码中的 | 拆分单元格 */
function splitRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);

  const cells: string[] = [];
  let current = "";
  let escaped = false;
  let inCode = false;

  for (const char of text) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      current += char;
      escaped = true;
      continue;
    }
    if (char === "`") {
      inCode = !inCode;
      current += char;
      continue;
    }
    if (char === "|" && !inCode) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function isDelimiterRow(line: string): boolean {
  if (!line.trim().startsWith("|")) return false;
  const cells = splitRow(line);
  if (cells.length === 0) return false;
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function parseAlignments(delimiter: string): Alignment[] {
  return splitRow(delimiter).map((cell) => ({
    left: cell.startsWith(":"),
    right: cell.endsWith(":"),
  }));
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.endsWith("|");
}

function isFenceLine(line: string): boolean {
  return /^\s{0,3}(`{3,}|~{3,})/.test(line);
}

function padCell(value: string, width: number, alignment: Alignment | undefined): string {
  const padding = Math.max(0, width - displayWidth(value));
  if (alignment?.left && alignment?.right) {
    const left = Math.floor(padding / 2);
    return " ".repeat(left) + value + " ".repeat(padding - left);
  }
  if (alignment?.right) return " ".repeat(padding) + value;
  return value + " ".repeat(padding);
}

function renderSeparator(alignment: Alignment | undefined, width: number): string {
  const left = Boolean(alignment?.left);
  const right = Boolean(alignment?.right);
  const dashes = Math.max(3, width - (left ? 1 : 0) - (right ? 1 : 0));
  return `${left ? ":" : ""}${"-".repeat(dashes)}${right ? ":" : ""}`;
}

function renderTable(block: TableBlock): string[] {
  const columnCount = Math.max(
    block.header.length,
    block.alignments.length,
    ...block.rows.map((row) => row.length)
  );

  const normalize = (row: string[]) => {
    const cells = row.slice(0, columnCount);
    while (cells.length < columnCount) cells.push("");
    return cells;
  };

  const header = normalize(block.header);
  const rows = block.rows.map(normalize);
  const allRows = [header, ...rows];
  const widths = Array.from({ length: columnCount }, (_, index) =>
    Math.max(3, ...allRows.map((row) => displayWidth(row[index])))
  );

  const renderRow = (row: string[]) =>
    `| ${row
      .map((cell, index) => padCell(cell, widths[index], block.alignments[index]))
      .join(" | ")} |`;

  const separator = `| ${widths
    .map((width, index) => renderSeparator(block.alignments[index], width))
    .join(" | ")} |`;

  return [renderRow(header), separator, ...rows.map(renderRow)];
}

/**
 * 格式化文档中的所有 GFM 表格
 *
 * - 统一为 `| 单元格 |` 形式并按显示宽度对齐
 * - 保留 :--- / :---: / ---: 对齐方式
 * - 跳过围栏代码块、缩进表格与非表格文本
 * - 保留原有换行符风格
 */
export function formatMarkdownTables(markdown: string): string {
  if (!markdown.includes("|")) return markdown;

  const newline = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(/\r?\n/);
  const output = [...lines];

  let fence: { char: string; length: number } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);

    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fence) {
        fence = { char: marker[0], length: marker.length };
      } else if (marker[0] === fence.char && marker.length >= fence.length) {
        fence = null;
      }
      continue;
    }

    if (fence) continue;
    if (!isTableRow(line) || index + 1 >= lines.length) continue;
    if (!isDelimiterRow(lines[index + 1])) continue;

    const header = splitRow(line);
    const delimiterCells = splitRow(lines[index + 1]);
    if (header.length === 0 || delimiterCells.length !== header.length) continue;

    const rawRows: string[] = [];
    let end = index + 1;
    while (end + 1 < lines.length) {
      const next = lines[end + 1];
      if (!isTableRow(next)) break;
      rawRows.push(next);
      end += 1;
    }

    const rows = rawRows.map(splitRow);
    if (rows.some((row) => row.length !== header.length)) {
      index = end;
      continue;
    }

    const block: TableBlock = {
      start: index,
      end,
      header,
      alignments: parseAlignments(lines[index + 1]),
      rows,
    };
    const rendered = renderTable(block);
    for (let offset = 0; offset < rendered.length; offset += 1) {
      output[block.start + offset] = rendered[offset];
    }

    index = end;
  }

  return output.join(newline);
}
