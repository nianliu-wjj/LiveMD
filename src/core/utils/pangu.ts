/**
 * 盘古之白：中文与英文/数字边界的排版规范化（纯函数模块）
 *
 * 为什么放在 core/utils：本模块不依赖 Vue / Tauri / ProseMirror，可直接被
 * `node --test` 单测覆盖，供状态栏按钮与后续批量排版入口复用。
 *
 * 规则（与 docs/2026-10-28-feature-implementation-guide-2.md §2 一致）：
 * 1. 仅在中文字符与半角字母/数字「直接相邻」时插入一个半角空格；
 * 2. 相邻一侧为全角标点（含弯引号）时不插入，避免“中文，English”这类已规范排版被改动；
 * 3. 围栏代码块整段跳过；行内代码、链接与图片目标、HTML 标签按保护段跳过，
 *    保护段内部一律不改动（链接文字仍参与排版，仅 URL 被保护）。
 */

/** 中文字符区段：CJK 统一表意文字、扩展 A、平假名/片假名 */
const CJK_RANGES: readonly (readonly [number, number])[] = [
  [0x4e00, 0x9fff],
  [0x3400, 0x4dbf],
  [0x3040, 0x30ff],
];

/** 全角标点区段：CJK 符号与标点、全角 ASCII 变体 */
const FULL_WIDTH_PUNCTUATION_RANGES: readonly (readonly [number, number])[] = [
  [0x3000, 0x303f],
  [0xff01, 0xff65],
];

/** 弯引号：排版规则上与全角标点同档处理 */
const CURLY_QUOTES = new Set(["“", "”", "‘", "’"]);

/** 围栏代码块起始/结束标记（``` 或 ~~~，允许最多 3 个前导空格） */
const FENCE_PATTERN = /^\s{0,3}(`{3,}|~{3,})/;

/**
 * 保护段：行内代码、链接/图片的 `](目标)` 片段、HTML 标签、裸 URL
 * 顺序影响匹配优先级（左起最早匹配者胜），`](...)` 在前可整体吞掉其中的 URL
 */
const PROTECTED_PATTERN = /(`[^`]*`|\]\([^)]*\)|<[^>]+>|https?:\/\/\S+)/g;

function isInRanges(codePoint: number, ranges: readonly (readonly [number, number])[]): boolean {
  return ranges.some(([start, end]) => codePoint >= start && codePoint <= end);
}

/** 是否中文字符（含日文假名） */
export function isCjkChar(char: string | undefined): boolean {
  if (!char) return false;
  const codePoint = char.codePointAt(0);
  return codePoint === undefined ? false : isInRanges(codePoint, CJK_RANGES);
}

/** 是否全角标点（含弯引号） */
export function isFullWidthPunctuation(char: string | undefined): boolean {
  if (!char) return false;
  if (CURLY_QUOTES.has(char)) return true;
  const codePoint = char.codePointAt(0);
  return codePoint === undefined ? false : isInRanges(codePoint, FULL_WIDTH_PUNCTUATION_RANGES);
}

/** 是否半角字母或数字 */
function isHalfWidthAlphanumeric(char: string | undefined): boolean {
  return Boolean(char) && /[A-Za-z0-9]/.test(char as string);
}

/**
 * 判断相邻两字符之间是否需要补空格
 * 中文↔半角字母/数字需要补；任一侧为全角标点时按惯例不补
 */
function needsSpaceBetween(left: string, right: string): boolean {
  if (isFullWidthPunctuation(left) || isFullWidthPunctuation(right)) return false;
  const cjkToHalfWidth = isCjkChar(left) && isHalfWidthAlphanumeric(right);
  const halfWidthToCjk = isHalfWidthAlphanumeric(left) && isCjkChar(right);
  return cjkToHalfWidth || halfWidthToCjk;
}

/**
 * 对一段可排版文本逐字符扫描并插入空格
 * 幂等性：仅在「直接相邻」的字符对之间插入，已有空格处不会重复补
 */
function insertSpaces(text: string): string {
  if (!text) return "";
  const chars = Array.from(text);
  let result = chars[0] ?? "";
  for (let index = 1; index < chars.length; index += 1) {
    if (needsSpaceBetween(chars[index - 1], chars[index])) {
      result += " ";
    }
    result += chars[index];
  }
  return result;
}

/** 对单行做「保护段外插空格」，保护段原样保留 */
function applyToFreeSegments(line: string): string {
  let result = "";
  let lastIndex = 0;
  for (const match of line.matchAll(PROTECTED_PATTERN)) {
    const index = match.index ?? 0;
    result += insertSpaces(line.slice(lastIndex, index));
    result += match[0];
    lastIndex = index + match[0].length;
  }
  return result + insertSpaces(line.slice(lastIndex));
}

/**
 * 执行排版规范化：逐行处理，围栏代码块整段跳过
 */
export function applyPanguSpacing(content: string): string {
  if (!content) return content;

  let inFence = false;
  let fenceMarker = "";

  return content
    .split("\n")
    .map((line) => {
      const fenceMatch = FENCE_PATTERN.exec(line);
      if (fenceMatch) {
        const marker = fenceMatch[1][0];
        if (!inFence) {
          inFence = true;
          fenceMarker = marker;
        } else if (marker === fenceMarker) {
          inFence = false;
          fenceMarker = "";
        }
        // 围栏标记行本身不参与排版
        return line;
      }

      if (inFence) return line;

      return applyToFreeSegments(line);
    })
    .join("\n");
}

/**
 * 是否需要排版：处理后内容是否发生变化
 * 供状态栏按钮提前短路，避免无谓的文档写入与撤销栈污染
 */
export function needsPanguSpacing(content: string): boolean {
  if (!content) return false;
  return applyPanguSpacing(content) !== content;
}
