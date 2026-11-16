/**
 * Intl.Segmenter 最小 polyfill（仅在运行环境缺失时注入）
 *
 * 为什么需要：markdownlint 0.42 的 MD060（table-column-style）依赖 string-width，
 * 后者在**模块顶层**执行 `new Intl.Segmenter()`。旧版 WebView（如 Firefox 内核 < 125、
 * 早期 WebKitGTK）缺少该 API 时，markdownlint 整个模块加载即抛 TypeError，
 * 检查 Worker 随之失效——过去这个错误会被吞成「没有发现问题」。
 *
 * 因此本文件必须在 markdownlint 之前被 import（ESM 按 import 顺序求值依赖）。
 *
 * 实现范围：
 * - grapheme（默认）：按「基字符 + 组合附标 / 变体选择符 / ZWJ 连接 / 区域旗帜成对」近似切分，
 *   足以满足 string-width 的显示宽度计算；
 * - word：连续的字母/数字/下划线为一个词段（isWordLike=true），其余按字素切分；
 * - sentence：整段作为一个片段。
 * 原生实现存在时什么都不做，不影响现代内核（WebView2 / Chromium）的行为。
 */

type Granularity = "grapheme" | "word" | "sentence";

interface SegmentData {
  segment: string;
  index: number;
  input: string;
  isWordLike?: boolean;
}

/** 依附在前一个字符上的码点：组合附标、变体选择符、ZWJ 本身、肤色修饰符 */
const EXTEND_RE = /[\p{M}\u200D\uFE00-\uFE0F\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]/u;
/** 区域指示符（两两组成国旗） */
const REGIONAL_INDICATOR_RE = /[\u{1F1E6}-\u{1F1FF}]/u;
/** 词字符：字母 / 数字 / 连接标点 / 附标 */
const WORD_CHAR_RE = /[\p{L}\p{N}\p{Pc}\p{M}]/u;

/** 近似的字素切分 */
function splitGraphemes(input: string): SegmentData[] {
  const segments: SegmentData[] = [];
  const codePoints = Array.from(input);
  let offset = 0;
  let index = 0;
  while (index < codePoints.length) {
    const start = offset;
    let segment = codePoints[index];
    const isRegional = REGIONAL_INDICATOR_RE.test(segment);
    index += 1;
    // 国旗：两个区域指示符为一个字素
    if (isRegional && index < codePoints.length && REGIONAL_INDICATOR_RE.test(codePoints[index])) {
      segment += codePoints[index];
      index += 1;
    }
    // 吸收后续的附标 / 变体选择符；遇到 ZWJ 时连同下一个字符一起吸收（emoji 连接序列）
    while (index < codePoints.length && EXTEND_RE.test(codePoints[index])) {
      const extend = codePoints[index];
      segment += extend;
      index += 1;
      if (extend === "\u200D" && index < codePoints.length) {
        segment += codePoints[index];
        index += 1;
      }
    }
    offset += segment.length;
    segments.push({ segment, index: start, input });
  }
  return segments;
}

/** 近似的分词：词字符连续成段，其余按字素逐个输出 */
function splitWords(input: string): SegmentData[] {
  const segments: SegmentData[] = [];
  for (const grapheme of splitGraphemes(input)) {
    const isWordLike = WORD_CHAR_RE.test(grapheme.segment);
    const previous = segments[segments.length - 1];
    if (isWordLike && previous?.isWordLike) {
      previous.segment += grapheme.segment;
      continue;
    }
    segments.push({ ...grapheme, isWordLike });
  }
  return segments;
}

export class SegmenterPolyfill {
  private readonly granularity: Granularity;

  constructor(_locales?: string | string[], options?: { granularity?: Granularity }) {
    this.granularity = options?.granularity ?? "grapheme";
  }

  segment(
    input: string
  ): Iterable<SegmentData> & { containing(index?: number): SegmentData | undefined } {
    const text = String(input);
    let segments: SegmentData[];
    if (this.granularity === "word") {
      segments = splitWords(text);
    } else if (this.granularity === "sentence") {
      segments = text.length > 0 ? [{ segment: text, index: 0, input: text }] : [];
    } else {
      segments = splitGraphemes(text);
    }
    return {
      [Symbol.iterator]: () => segments[Symbol.iterator](),
      containing: (index = 0) =>
        segments.find((item) => index >= item.index && index < item.index + item.segment.length),
    };
  }

  resolvedOptions(): { locale: string; granularity: Granularity } {
    return { locale: "en", granularity: this.granularity };
  }

  static supportedLocalesOf(locales?: string | string[]): string[] {
    if (locales === undefined) return [];
    return Array.isArray(locales) ? locales : [locales];
  }
}

/** 是否由本模块注入了 polyfill（供日志与排查使用） */
export let isIntlSegmenterPolyfilled = false;

if (
  typeof Intl !== "undefined" &&
  typeof (Intl as { Segmenter?: unknown }).Segmenter !== "function"
) {
  (Intl as unknown as { Segmenter: typeof SegmenterPolyfill }).Segmenter = SegmenterPolyfill;
  isIntlSegmenterPolyfilled = true;
  console.warn("[intlSegmenterPolyfill] 当前内核缺少 Intl.Segmenter，已注入近似实现");
}
