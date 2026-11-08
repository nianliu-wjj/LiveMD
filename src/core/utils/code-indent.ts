/**
 * 代码块按语言的缩进规则
 *
 * 不同语言社区的缩进惯例不同（PEP 8 的 Python 4 空格、gofmt 的 Go 制表符、前端生态 2 空格……），
 * 这里集中维护「语言 → 缩进单位」映射，供以下场景共用：
 * - CodeMirror 的 indentUnit / tabSize（Enter 自动缩进、Tab / Shift-Tab 增减缩进）；
 * - 源码模式下纯文本代码的 Tab 键；
 * - prettier / sql-formatter 的 tabWidth / useTabs；
 * - 右键「调整缩进」：把整段代码的行首缩进统一转换为该语言的缩进单位。
 */

/** 缩进规则 */
export interface IndentRule {
  /** 一级缩进插入的文本（若干空格或一个制表符） */
  unit: string;
  /** 制表符显示宽度 / 一级缩进的列数 */
  tabSize: number;
  /** 是否使用制表符缩进 */
  useTab: boolean;
}

const spaces = (size: number): IndentRule => ({
  unit: " ".repeat(size),
  tabSize: size,
  useTab: false,
});

const tab = (size: number): IndentRule => ({ unit: "\t", tabSize: size, useTab: true });

/** 未声明语言或未收录语言的回退规则：2 空格 */
export const DEFAULT_INDENT_RULE: IndentRule = spaces(2);

/** 语言 → 缩进规则（键为小写语言名或常用别名） */
const INDENT_RULES: Record<string, IndentRule> = {
  // 4 空格：PEP 8、Java/C# 官方风格、PHP PSR-12、Rust rustfmt、Swift、Kotlin、C/C++ 常见风格
  python: spaces(4),
  py: spaces(4),
  java: spaces(4),
  kotlin: spaces(4),
  kt: spaces(4),
  scala: spaces(2),
  csharp: spaces(4),
  "c#": spaces(4),
  cs: spaces(4),
  c: spaces(4),
  cpp: spaces(4),
  "c++": spaces(4),
  "objective-c": spaces(4),
  objc: spaces(4),
  php: spaces(4),
  rust: spaces(4),
  rs: spaces(4),
  swift: spaces(4),
  powershell: spaces(4),
  ps1: spaces(4),
  perl: spaces(4),
  sql: spaces(4),
  dockerfile: spaces(4),
  matlab: spaces(4),
  octave: spaces(4),
  // 制表符：gofmt 强制 Tab；Makefile 语法要求 Tab
  go: tab(4),
  golang: tab(4),
  makefile: tab(4),
  make: tab(4),
  // 2 空格：前端生态（prettier 默认）、Ruby 社区、YAML（禁止 Tab）、Lua、R、Shell
  javascript: spaces(2),
  js: spaces(2),
  jsx: spaces(2),
  typescript: spaces(2),
  ts: spaces(2),
  tsx: spaces(2),
  json: spaces(2),
  html: spaces(2),
  xml: spaces(2),
  vue: spaces(2),
  css: spaces(2),
  scss: spaces(2),
  less: spaces(2),
  yaml: spaces(2),
  yml: spaces(2),
  toml: spaces(2),
  markdown: spaces(2),
  md: spaces(2),
  ruby: spaces(2),
  rb: spaces(2),
  lua: spaces(2),
  r: spaces(2),
  shell: spaces(2),
  bash: spaces(2),
  sh: spaces(2),
  mermaid: spaces(4),
  mindmap: spaces(2),
};

/** 获取语言对应的缩进规则（大小写不敏感，未收录语言回退 2 空格） */
export function getIndentRule(language: string | null | undefined): IndentRule {
  const key = (language ?? "").trim().toLowerCase();
  return INDENT_RULES[key] ?? DEFAULT_INDENT_RULE;
}

/** 缩进规则的简短描述（用于提示文案），如「4 空格」「Tab」 */
export function describeIndentRule(rule: IndentRule): string {
  return rule.useTab ? "Tab" : `${rule.tabSize} 空格`;
}

/** 计算行首空白的显示列数（制表符按 tabSize 对齐到下一个制表位） */
function measureIndentColumns(whitespace: string, tabSize: number): number {
  let columns = 0;
  for (const char of whitespace) {
    columns = char === "\t" ? columns + tabSize - (columns % tabSize) : columns + 1;
  }
  return columns;
}

/**
 * 推断代码当前使用的「一级缩进列数」：
 * 取所有非空且有缩进的行的缩进列数，求其最大公约数（常见值 2 / 4 / 8）；
 * 若全部使用制表符缩进，则以一个制表符为一级。
 */
export function detectIndentWidth(code: string, tabSize = 4): number {
  const widths: number[] = [];
  let allTabs = true;
  let hasIndent = false;

  for (const line of code.split("\n")) {
    if (!line.trim()) continue;
    const whitespace = /^[ \t]*/.exec(line)?.[0] ?? "";
    if (!whitespace) continue;
    hasIndent = true;
    if (/ /.test(whitespace)) allTabs = false;
    widths.push(measureIndentColumns(whitespace, tabSize));
  }

  if (!hasIndent) return 0;
  if (allTabs) return tabSize;

  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const unitWidth = widths.reduce((acc, width) => gcd(acc, width), 0);
  // 对齐续行等零散缩进可能把公约数拉到 1，此时按最常见的 2 / 4 判断更合理
  if (unitWidth >= 2) return unitWidth;
  const smallest = Math.min(...widths.filter((width) => width > 0));
  return smallest >= 4 ? 4 : 2;
}

/**
 * 按语言规则重排缩进：保持代码的层级结构不变，只把每行行首的空白换成目标语言的缩进单位。
 *
 * 例：2 空格缩进的 Python 代码 → 4 空格；空格缩进的 Go 代码 → 制表符。
 * 行内空白、空行、无缩进的行保持原样；多出的不足一级的零散空格（如对齐续行）按空格保留。
 */
export function reindentCode(code: string, rule: IndentRule): string {
  const sourceWidth = detectIndentWidth(code, rule.tabSize);
  if (sourceWidth === 0) return code;

  return code
    .split("\n")
    .map((line) => {
      const whitespace = /^[ \t]*/.exec(line)?.[0] ?? "";
      if (!whitespace || !line.trim()) return line;
      const columns = measureIndentColumns(whitespace, rule.tabSize);
      const levels = Math.floor(columns / sourceWidth);
      const remainder = columns - levels * sourceWidth;
      return rule.unit.repeat(levels) + " ".repeat(remainder) + line.slice(whitespace.length);
    })
    .join("\n");
}
