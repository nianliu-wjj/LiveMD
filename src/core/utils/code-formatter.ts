/**
 * 代码块格式化工具（按语言分派）
 *
 * - prettier standalone：JS/TS/JSON/CSS/SCSS/LESS/HTML/Markdown/YAML
 *   （standalone 版在浏览器环境运行，无需 Node API）；
 * - sql-formatter：SQL（独立库，关键字大写、子句换行）；
 * - 其余语言（Go/Rust/Java/Python/Shell 等无浏览器端可靠格式化器）不支持。
 *
 * 结果一律以 `{ ok, code?, reason? }` 返回，不抛异常，
 * 便于调用方（代码块 NodeView）直接映射为按钮反馈与提示文案。
 */
import * as prettier from "prettier/standalone";
import * as prettierPlugins from "prettier/plugins/babel";
import estreePlugin from "prettier/plugins/estree";
import htmlPlugin from "prettier/plugins/html";
import markdownPlugin from "prettier/plugins/markdown";
import postcssPlugin from "prettier/plugins/postcss";
import typescriptPlugin from "prettier/plugins/typescript";
import yamlPlugin from "prettier/plugins/yaml";
import { format as formatSql } from "sql-formatter";
import { getIndentRule } from "./code-indent.ts";

/** prettier 各语言解析器 / 插件映射：language → [parser, plugins] */
const PRETTIER_TARGETS: Record<string, { parser: string; plugins: unknown[] }> = {
  javascript: { parser: "babel", plugins: [prettierPlugins, estreePlugin] },
  typescript: { parser: "typescript", plugins: [prettierPlugins, estreePlugin, typescriptPlugin] },
  json: { parser: "json", plugins: [prettierPlugins, estreePlugin] },
  css: { parser: "css", plugins: [postcssPlugin] },
  scss: { parser: "scss", plugins: [postcssPlugin] },
  less: { parser: "less", plugins: [postcssPlugin] },
  html: { parser: "html", plugins: [prettierPlugins, estreePlugin, htmlPlugin] },
  markdown: { parser: "markdown", plugins: [markdownPlugin] },
  yaml: { parser: "yaml", plugins: [yamlPlugin] },
};

/** 语言别名表：代码块常见简写 → 规范语言名 */
const FORMATTER_ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  node: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  yml: "yaml",
  "c++": "cpp",
  golang: "go",
  "c#": "csharp",
};

/** 代码块语言名 → 格式化器视角的规范语言名 */
export function normalizeFormatterLanguage(language: string): string {
  const lower = language.trim().toLowerCase();
  return FORMATTER_ALIASES[lower] ?? lower;
}

/** 该语言是否可格式化 */
export function getFormatSupport(language: string): boolean {
  const normalized = normalizeFormatterLanguage(language);
  return normalized === "sql" || normalized in PRETTIER_TARGETS;
}

/** 格式化成功结果 */
export interface FormatSuccess {
  ok: true;
  code: string;
}

/** 格式化失败结果（原因已转为用户可读文案） */
export interface FormatFailure {
  ok: false;
  reason: string;
}

export type FormatResult = FormatSuccess | FormatFailure;

/** prettier 输出统一配置（tabWidth / useTabs 在 formatCode 中按语言覆盖） */
const PRETTIER_OPTIONS = {
  printWidth: 80,
  tabWidth: 2,
  semi: true,
  singleQuote: false,
  trailingComma: "all" as const,
  endOfLine: "lf" as const,
};

/** 裸异常 → 用户可读原因 */
function toReason(error: unknown): string {
  if (error instanceof Error) {
    const firstLine = error.message.split("\n")[0]?.trim();
    return firstLine ? `格式化失败：${firstLine}` : "格式化失败：语法错误";
  }
  return "格式化失败：未知错误";
}

/**
 * 按语言格式化代码
 *
 * @param code 源代码文本
 * @param language 代码块声明的语言（支持别名，如 js/ts/yml）
 * @returns 成功时携带格式化结果；失败时携带原因，不抛异常
 */
export async function formatCode(code: string, language: string): Promise<FormatResult> {
  if (!code.trim()) return { ok: false, reason: "内容为空，无需格式化" };

  const normalized = normalizeFormatterLanguage(language);
  // 缩进宽度 / 是否用制表符按语言惯例取值（与代码块编辑时的缩进规则一致）
  const indent = getIndentRule(normalized);

  if (normalized === "sql") {
    try {
      return {
        ok: true,
        code: await formatSql(code, {
          language: "sql",
          tabWidth: indent.tabSize,
          useTabs: indent.useTab,
          keywordCase: "upper",
        }),
      };
    } catch (error) {
      return { ok: false, reason: toReason(error) };
    }
  }

  const target = PRETTIER_TARGETS[normalized];
  if (!target) return { ok: false, reason: `暂不支持格式化 ${language || "该"} 语言` };

  try {
    const formatted = await prettier.format(code, {
      ...PRETTIER_OPTIONS,
      tabWidth: indent.tabSize,
      useTabs: indent.useTab,
      parser: target.parser,
      plugins: target.plugins as never[],
    });
    return { ok: true, code: formatted };
  } catch (error) {
    return { ok: false, reason: toReason(error) };
  }
}
