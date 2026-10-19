/**
 * Markdown 文本格式化工具
 *
 * 目前包含 typora_plugin md_padding 的核心能力：
 * 在中日韩文字与拉丁字母/数字之间插入空格，同时跳过代码块、行内代码、
 * 公式、HTML 标签、链接地址等不应改写的区域。
 */

const CJK_CHAR = "\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uac00-\\ud7af\\uf900-\\ufaff";
const LATIN_CHAR = "A-Za-z0-9\\u00c0-\\u024f";

const CJK_TO_LATIN_RE = new RegExp(`([${CJK_CHAR}])([${LATIN_CHAR}])`, "g");
const LATIN_TO_CJK_RE = new RegExp(`([${LATIN_CHAR}])([${CJK_CHAR}])`, "g");

/** 受保护片段的占位符（NUL 不会出现在正常 Markdown 文本中） */
const PLACEHOLDER_START = "\u0000";
const PLACEHOLDER_END = "\u0000";
const PLACEHOLDER_RE = /\u0000(\d+)\u0000/g;

interface ProtectedSpan {
  start: number;
  end: number;
}

/** 查找成对的围栏代码块（支持 ``` 与 ~~~），按真实换行符计算偏移 */
function findFencedCodeBlocks(markdown: string): ProtectedSpan[] {
  const spans: ProtectedSpan[] = [];
  let offset = 0;
  let openFence: { char: string; length: number; start: number } | null = null;

  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const lineStart = offset;
    const lineEnd = offset + line.length;
    const match = line.match(/^\s{0,3}(`{3,}|~{3,})/);

    if (match) {
      const fence = match[1];
      if (!openFence) {
        openFence = { char: fence[0], length: fence.length, start: lineStart };
      } else if (fence[0] === openFence.char && fence.length >= openFence.length) {
        spans.push({ start: openFence.start, end: lineEnd });
        openFence = null;
      }
    }

    offset += rawLine.length + 1;
  }

  // 未闭合的围栏视为延伸到文末
  if (openFence) {
    spans.push({ start: openFence.start, end: markdown.length });
  }
  return spans;
}

/** 收集需要原样保留的片段 */
function findProtectedSpans(markdown: string): ProtectedSpan[] {
  const spans: ProtectedSpan[] = [];

  // YAML front matter
  const frontMatter = markdown.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  if (frontMatter) {
    spans.push({ start: 0, end: frontMatter[0].length });
  }

  spans.push(...findFencedCodeBlocks(markdown));

  const patterns: RegExp[] = [
    /(`+)([\s\S]*?)\1/g, // 行内代码
    /\$\$[\s\S]*?\$\$/g, // 块公式
    /(?<!\\)\$(?!\$)[^$\n]*?(?<!\\)\$/g, // 行内公式
    /<!--[\s\S]*?-->/g, // HTML 注释
    /<\/?[A-Za-z][^>]*>/g, // HTML 标签
    /\]\([^)]*\)/g, // 链接/图片地址
    /https?:\/\/[^\s)<>]+/g, // 裸链接
    /:[0-9a-z_-]+?:/gi, // 表情短代码
  ];

  for (const pattern of patterns) {
    for (const match of markdown.matchAll(pattern)) {
      if (match.index === undefined) continue;
      spans.push({ start: match.index, end: match.index + match[0].length });
    }
  }

  return mergeSpans(spans);
}

function mergeSpans(spans: ProtectedSpan[]): ProtectedSpan[] {
  if (spans.length === 0) return spans;
  const sorted = [...spans].sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: ProtectedSpan[] = [sorted[0]];

  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    const last = merged[merged.length - 1];
    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

export interface CjkSpacingOptions {
  /** 不参与加空格处理的单词（例如 iPhone、macOS） */
  ignoreWords?: string[];
}

/**
 * 在中日韩文字与拉丁字母/数字之间插入空格
 *
 * 与 md_padding 行为保持一致：全角标点两侧不插空格，代码、公式、HTML、
 * 链接地址等区域保持原样。
 */
export function formatCjkSpacing(markdown: string, options: CjkSpacingOptions = {}): string {
  if (!markdown) return markdown;

  const spans = findProtectedSpans(markdown);

  // 额外保护 ignoreWords
  for (const word of options.ignoreWords ?? []) {
    if (!word) continue;
    let index = markdown.indexOf(word);
    while (index !== -1) {
      spans.push({ start: index, end: index + word.length });
      index = markdown.indexOf(word, index + word.length);
    }
  }

  const merged = mergeSpans(spans);
  const placeholders: string[] = [];
  let protectedText = "";
  let cursor = 0;

  for (const span of merged) {
    if (span.start < cursor) continue;
    protectedText += markdown.slice(cursor, span.start);
    protectedText += `${PLACEHOLDER_START}${placeholders.length}${PLACEHOLDER_END}`;
    placeholders.push(markdown.slice(span.start, span.end));
    cursor = span.end;
  }
  protectedText += markdown.slice(cursor);

  const padded = protectedText
    .replace(CJK_TO_LATIN_RE, "$1 $2")
    .replace(LATIN_TO_CJK_RE, "$1 $2");

  return padded.replace(PLACEHOLDER_RE, (_, index: string) => placeholders[Number(index)] ?? "");
}

export default formatCjkSpacing;
