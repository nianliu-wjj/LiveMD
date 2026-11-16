/**
 * 文档统计（对应 Typora 状态栏的字数统计）
 *
 * 统计口径：
 * - 字数：中日韩文字按字符计，拉丁文字按单词计
 * - 字符数：包含空白的全部字符（图片 base64 视为 1 个占位）
 * - 行数：沿用原有“非空内容块”口径，跳过空行
 * - 段落数：按空行分隔的内容块数量
 * - 阅读时间：按每分钟 250 字估算
 */

const IMAGE_BASE64_REGEX = /data:image\/[a-zA-Z]+;base64,[a-zA-Z0-9+/=]+/g;

export interface DocumentStats {
  words: number;
  characters: number;
  charactersWithoutSpaces: number;
  lines: number;
  paragraphs: number;
  readingSeconds: number;
}

/** 移除图片 base64 数据，避免污染统计 */
function stripImageData(markdown: string): string {
  return markdown.replace(IMAGE_BASE64_REGEX, "image");
}

/** 统计行数（沿用状态栏原有口径：按空行/换行符切分后跳过空块） */
export function countMarkdownLines(text: string, options = { skipEmpty: true }): number {
  if (!text) return 0;
  const rawLines = text.split(/\n{2,}|<br\s*\/?>| {2}\n/g);
  if (options.skipEmpty) {
    return rawLines.filter((line) => line.trim().length > 0).length;
  }
  return rawLines.length;
}

/** 统计字符数（不剔除 Markdown 语法符号，只剔除图片 base64） */
export function countMarkdownChars(text: string): number {
  return (text.replaceAll("&#x20;", "").replace(IMAGE_BASE64_REGEX, "image").trim() || "").split("")
    .length;
}

/** 统计字数：CJK 单字 + 拉丁单词 */
export function countWords(text: string): number {
  if (!text) return 0;
  const cleaned = stripImageData(text);
  const cjkMatches = cleaned.match(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g);
  const latinMatches = cleaned.match(/[A-Za-z0-9][A-Za-z0-9'’_-]*/g);
  return (cjkMatches?.length ?? 0) + (latinMatches?.length ?? 0);
}

/** 统计段落数：按空行分隔的内容块 */
export function countParagraphs(text: string): number {
  if (!text.trim()) return 0;
  return text
    .split(/\n\s*\n/g)
    .map((block) => block.trim())
    .filter((block) => block.length > 0).length;
}

/** 汇总统计信息 */
export function countDocumentStats(markdown: string): DocumentStats {
  const text = stripImageData(markdown ?? "");
  const charactersWithoutSpaces = text.replace(/\s/g, "").length;
  const words = countWords(text);

  return {
    words,
    characters: countMarkdownChars(markdown ?? ""),
    charactersWithoutSpaces,
    lines: countMarkdownLines(markdown ?? ""),
    paragraphs: countParagraphs(text),
    readingSeconds: Math.round((words / 250) * 60),
  };
}

/** 将阅读时间格式化为“X 秒 / X 分钟” */
export function formatReadingTime(seconds: number): string {
  if (seconds <= 0) return "0 秒";
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} 分钟`;
}
