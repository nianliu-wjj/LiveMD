/**
 * 中文标点 / 引号自动成对闭合的纯决策函数
 *
 * 为什么单独抽纯函数：成对闭合的边界情形（撇号、选区包裹、源码模式跳过）最容易出错，
 * 决策逻辑与 ProseMirror 视图解耦后可零依赖单测（见 test/brackets.test.mjs），
 * 插件 src/core/plugins/auto-pair.ts 只负责把决策落到事务上。
 *
 * 规则（与 docs/2026-10-28-feature-implementation-guide-2.md §5 一致）：
 * - 中文标点（《【（）「」『』“”）默认参与闭合；
 * - ASCII 括号（() [] {}）默认不参与，避免与代码/Markdown 习惯冲突；
 * - 引号默认参与，但 ASCII 撇号/引号有防护：紧跟词字符时不闭合（don't、"引号"语义）；
 * - Markdown 强调符号（` *）默认不参与。
 */

/** 符号对分类：决定该对由哪个开关控制 */
export type PairCategory = "cjk" | "asciiBracket" | "quote" | "markdown";

export interface SymbolPair {
  open: string;
  close: string;
  category: PairCategory;
}

export interface AutoPairOptions {
  /** ASCII 括号 () [] {} 是否自动成对 */
  asciiBrackets: boolean;
  /** 引号（ASCII 与中文）是否自动成对 */
  quotes: boolean;
  /** Markdown 强调符号 ` 与 * 是否自动成对 */
  markdownSymbols: boolean;
}

export type AutoPairDecision =
  | { type: "insert-pair"; open: string; close: string }
  | { type: "skip-over" }
  | { type: "wrap-selection"; open: string; close: string }
  | { type: "default" };

/** 14 对可闭合符号（中文 7 对 + ASCII 括号 3 对 + 引号 2 对 + Markdown 2 对） */
const PAIRS: readonly SymbolPair[] = [
  { open: "《", close: "》", category: "cjk" },
  { open: "【", close: "】", category: "cjk" },
  { open: "（", close: "）", category: "cjk" },
  { open: "「", close: "」", category: "cjk" },
  { open: "『", close: "』", category: "cjk" },
  { open: "“", close: "”", category: "cjk" },
  { open: "‘", close: "’", category: "cjk" },
  { open: "(", close: ")", category: "asciiBracket" },
  { open: "[", close: "]", category: "asciiBracket" },
  { open: "{", close: "}", category: "asciiBracket" },
  { open: '"', close: '"', category: "quote" },
  { open: "'", close: "'", category: "quote" },
  { open: "`", close: "`", category: "markdown" },
  { open: "*", close: "*", category: "markdown" },
];

export const PAIR_OPENERS: readonly string[] = PAIRS.map((pair) => pair.open);
export const PAIR_CLOSERS: readonly string[] = PAIRS.map((pair) => pair.close);
/** 中文开符号集合（总是参与闭合） */
export const CJK_OPENERS: readonly string[] = PAIRS.filter((pair) => pair.category === "cjk").map(
  (pair) => pair.open
);

export const DEFAULT_AUTO_PAIR_OPTIONS: AutoPairOptions = {
  asciiBrackets: false,
  quotes: true,
  markdownSymbols: false,
};

/** 词字符（含中文）结尾：用于 ASCII 撇号/引号防护 */
const WORD_ENDING = /[\w一-鿿]$/;

function isPairEnabled(pair: SymbolPair, options: AutoPairOptions): boolean {
  switch (pair.category) {
    case "cjk":
      return true;
    case "asciiBracket":
      return options.asciiBrackets;
    case "quote":
      return options.quotes;
    case "markdown":
      return options.markdownSymbols;
  }
}

/** 找到某个输入字符对应的开/闭符号对（未启用则返回 undefined） */
function findPair(
  input: string,
  options: AutoPairOptions,
  side: "open" | "close"
): SymbolPair | undefined {
  return PAIRS.find((pair) => {
    if (!isPairEnabled(pair, options)) return false;
    return (side === "open" ? pair.open : pair.close) === input;
  });
}

/**
 * ASCII 引号防护：紧跟词字符时不闭合
 * - `'`：don't、中文'（撇号语义）
 * - `"`：仅在词字符后防护（中文引号“”总是闭合）
 */
function shouldSkipAsciiQuote(input: string, textBefore: string): boolean {
  const previous = textBefore.at(-1) ?? "";
  if (!previous) return false;
  if (input === "'") return WORD_ENDING.test(previous);
  if (input === '"') return WORD_ENDING.test(previous);
  return false;
}

/**
 * 计算自动闭合决策
 *
 * @param textBefore 光标前同一文本块内的文本（用于撇号防护与闭合判定）
 * @param textAfter 光标后同一文本块内的文本（用于跳过已有闭符号）
 * @param input 本次输入的字符
 * @param hasSelection 当前是否有选区（有选区时按“包裹”处理）
 */
export function computeAutoPair(
  textBefore: string,
  textAfter: string,
  input: string,
  hasSelection: boolean,
  options: AutoPairOptions = DEFAULT_AUTO_PAIR_OPTIONS
): AutoPairDecision {
  if (!input) return { type: "default" };

  const opener = findPair(input, options, "open");
  const closer = findPair(input, options, "close");

  // 有选区：仅开符号包裹选区（闭符号不干预，交由默认行为覆盖选区）
  if (hasSelection) {
    return opener
      ? { type: "wrap-selection", open: opener.open, close: opener.close }
      : { type: "default" };
  }

  // 输入闭符号且光标后已是同一闭符号：跳过，避免重复成对
  if (closer && textAfter.startsWith(closer.close)) {
    return { type: "skip-over" };
  }

  if (opener) {
    if (opener.category === "quote" && input === "'" && shouldSkipAsciiQuote(input, textBefore)) {
      return { type: "default" };
    }
    if (opener.category === "quote" && input === '"' && shouldSkipAsciiQuote(input, textBefore)) {
      return { type: "default" };
    }
    return { type: "insert-pair", open: opener.open, close: opener.close };
  }

  return { type: "default" };
}

/**
 * Backspace 删除成对符号：光标夹在空对中间时返回该对，供插件一次删除两侧
 */
export function shouldDeletePair(textBefore: string, textAfter: string): SymbolPair | undefined {
  const previous = textBefore.at(-1) ?? "";
  const next = textAfter[0] ?? "";
  if (!previous || !next) return undefined;
  return PAIRS.find((pair) => pair.open === previous && pair.close === next);
}
