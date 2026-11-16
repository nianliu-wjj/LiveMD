/**
 * markdownlint 规则表（供设置对话框渲染规则开关列表）
 *
 * 为什么不从库里读：markdownlint 0.42 的包导出映射只暴露 lint 相关 API
 * （`applyFix` / `applyFixes` / `getVersion` / `resolveModule`），并未导出规则元数据，
 * 因此规则清单在本文件静态维护：新增规则时在此补一行即可（编码 / 别名 / 中文说明）。
 *
 * 说明：lint 结果里的「规则说明」直接用 markdownlint 返回的 ruleDescription（英文原文），
 * 本表的 description 仅用于设置列表的中文速览。
 */

export interface MarkdownLintRule {
  /** 规则编码（MD001 等），也是 markdownlint config 的键 */
  code: string;
  /** 规则别名（heading-increment 等） */
  alias: string;
  /** 中文简述 */
  description: string;
  /** 是否为本项目自定义规则（非 markdownlint 内置，无官方文档） */
  custom?: boolean;
}

/** markdownlint 官方规则文档目录（infoUrl 兜底用） */
export const MARKDOWNLINT_DOC_URL_BASE = "https://github.com/DavidAnson/markdownlint/blob/main/doc";

export const MARKDOWNLINT_RULES: readonly MarkdownLintRule[] = [
  { code: "MD001", alias: "heading-increment", description: "标题层级只能逐级递增" },
  { code: "MD003", alias: "heading-style", description: "标题风格需统一（如全用 ATX #）" },
  { code: "MD004", alias: "ul-style", description: "无序列表符号风格需统一" },
  { code: "MD005", alias: "list-indent", description: "同层列表项缩进需一致" },
  { code: "MD007", alias: "ul-indent", description: "无序列表缩进需符合约定" },
  { code: "MD009", alias: "no-trailing-spaces", description: "行尾不应有多余空格" },
  { code: "MD010", alias: "no-hard-tabs", description: "不应使用硬制表符" },
  { code: "MD011", alias: "no-reversed-links", description: "链接括号方向写反" },
  { code: "MD012", alias: "no-multiple-blanks", description: "不应有连续多个空行" },
  { code: "MD013", alias: "line-length", description: "行长度超出限制" },
  { code: "MD014", alias: "commands-show-output", description: "命令行示例不应展示输出提示符" },
  { code: "MD018", alias: "no-missing-space-atx", description: "# 后缺少空格" },
  { code: "MD019", alias: "no-multiple-space-atx", description: "# 后多余空格" },
  { code: "MD020", alias: "no-missing-space-closed-atx", description: "闭合式标题内缺少空格" },
  { code: "MD021", alias: "no-multiple-space-closed-atx", description: "闭合式标题内多余空格" },
  { code: "MD022", alias: "blanks-around-headings", description: "标题上下需空行" },
  { code: "MD023", alias: "heading-start-left", description: "标题必须顶格" },
  { code: "MD024", alias: "no-duplicate-heading", description: "同级标题不应重名" },
  { code: "MD025", alias: "single-title", description: "文档只应有一个一级标题" },
  { code: "MD026", alias: "no-trailing-punctuation", description: "标题末尾不应有标点" },
  { code: "MD027", alias: "no-multiple-space-blockquote", description: "引用块符号后多余空格" },
  { code: "MD028", alias: "no-blanks-blockquote", description: "引用块之间不应有空行" },
  { code: "MD029", alias: "ol-prefix", description: "有序列表序号风格需统一" },
  { code: "MD030", alias: "list-marker-space", description: "列表符号后的空格数需统一" },
  { code: "MD031", alias: "blanks-around-fences", description: "代码块上下需空行" },
  { code: "MD032", alias: "blanks-around-lists", description: "列表上下需空行" },
  { code: "MD033", alias: "no-inline-html", description: "不应使用内联 HTML" },
  { code: "MD034", alias: "no-bare-urls", description: "裸链接需加尖括号或写成链接" },
  { code: "MD035", alias: "hr-style", description: "分隔线风格需统一" },
  { code: "MD036", alias: "no-emphasis-as-heading", description: "不应以强调代替标题" },
  { code: "MD037", alias: "no-space-in-emphasis", description: "强调符号内不应有空格" },
  { code: "MD038", alias: "no-space-in-code", description: "行内代码内不应有空格" },
  { code: "MD039", alias: "no-space-in-links", description: "链接文字内不应有空格" },
  { code: "MD040", alias: "fenced-code-language", description: "围栏代码块需声明语言" },
  { code: "MD041", alias: "first-line-heading", description: "首行应为标题" },
  { code: "MD042", alias: "no-empty-links", description: "不应有空链接" },
  { code: "MD043", alias: "required-headings", description: "标题结构需符合约定" },
  { code: "MD044", alias: "proper-names", description: "专有名词大小写需正确" },
  { code: "MD045", alias: "no-alt-text", description: "图片需有替代文本" },
  { code: "MD046", alias: "code-block-style", description: "代码块风格需统一" },
  { code: "MD047", alias: "single-trailing-newline", description: "文件应以单个换行结尾" },
  { code: "MD048", alias: "code-fence-style", description: "围栏符号风格需统一" },
  { code: "MD049", alias: "emphasis-style", description: "斜体风格需统一（* 或 _）" },
  { code: "MD050", alias: "strong-style", description: "粗体风格需统一（** 或 __）" },
  { code: "MD051", alias: "link-fragments", description: "链接锚点需指向存在的标题" },
  { code: "MD052", alias: "reference-links-images", description: "引用式链接需有定义" },
  { code: "MD053", alias: "link-image-reference-definitions", description: "无用的引用定义需删除" },
  { code: "MD054", alias: "link-image-style", description: "链接与图片风格需统一" },
  { code: "MD055", alias: "table-pipe-style", description: "表格竖线风格需统一" },
  { code: "MD056", alias: "table-column-count", description: "表格各行列数需一致" },
  { code: "MD058", alias: "blanks-around-tables", description: "表格上下需空行" },
  { code: "MD059", alias: "descriptive-link-text", description: "链接文字需有描述性" },
  { code: "MD060", alias: "table-column-style", description: "表格列竖线需对齐、风格统一" },
  // ---- 自定义规则（对齐 Typora 格式检查插件，实现见 markdownLintCustomRules.ts）----
  {
    code: "MD101",
    alias: "math-surrounded-by-blank-lines",
    description: "数学公式块上下需空行",
    custom: true,
  },
  {
    code: "MD102",
    alias: "no-emphasis-only-heading",
    description: "标题不应整体加粗或斜体",
    custom: true,
  },
  {
    code: "MD103",
    alias: "inline-math-single-dollar",
    description: "行内公式应使用单个 $ 包裹",
    custom: true,
  },
];

/** 规则文档链接：官方规则按编码指向 doc/mdXXX.md；自定义规则没有在线文档，返回 null */
export function getRuleDocUrl(rule: MarkdownLintRule): string | null {
  if (rule.custom) return null;
  return `${MARKDOWNLINT_DOC_URL_BASE}/${rule.code.toLowerCase()}.md`;
}
