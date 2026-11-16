/**
 * markdownlint 自定义规则（对齐 Typora 格式检查插件的扩展规则）
 *
 * - MD101 math-surrounded-by-blank-lines：数学块（$$ 围栏）前后需空行；
 * - MD102 no-emphasis-only-heading：标题文字不应整体加粗/强调；
 * - MD103 inline-math-single-dollar：行内数学分隔符应为单个 `$`（`$$b$$` 出现在行内要报）。
 *
 * 实现取舍：规则只遍历 `params.parsers.micromark.tokens`（markdownlint 已按 math 扩展解析好的
 * 语法树），不依赖 `markdownlint/helpers` 里的 micromark 工具函数。原因是 markdownlint 0.42
 * 的 `exports` 只暴露 `./helpers`（helpers.cjs），`micromark-helpers.cjs` 子路径被阻断，
 * 若经别名/中转文件强行引入，需要 Vite alias + package.json imports + optimizeDeps 三处配合，
 * dev 下 Worker 还会因 CJS 未预打包报 `require is not defined`。而规则用到的只是「按类型递归
 * 筛选节点」与「空行判断」两个小工具，自行实现十几行即可，Node 测试与 Vite（主线程 / Worker、
 * dev / build）四种链路都无需任何额外配置。
 *
 * 所有规则都通过 fixInfo 提供自动修复，面板「修复」/「全部修复」可直接使用。
 */
import type { MarkdownlintCustomRule, MicromarkToken, RuleOnErrorInfo } from "markdownlint/promise";

// ============ 通用工具 ============

/**
 * 递归筛选指定类型的节点（先序遍历，结果按文档顺序排列）
 *
 * 等价于 markdownlint 内部的 filterByTypes，但不依赖其未导出的 micromark-helpers。
 */
export function filterTokensByTypes(
  tokens: readonly MicromarkToken[],
  types: readonly string[]
): MicromarkToken[] {
  const typeSet = new Set(types);
  const result: MicromarkToken[] = [];
  // 显式栈代替递归：超深嵌套（多层引用/列表）时不会爆调用栈
  const stack: MicromarkToken[] = [...tokens].reverse();
  while (stack.length > 0) {
    const token = stack.pop() as MicromarkToken;
    if (typeSet.has(token.type)) {
      result.push(token);
    }
    for (let index = token.children.length - 1; index >= 0; index -= 1) {
      stack.push(token.children[index]);
    }
  }
  return result;
}

/**
 * 判断一行是否为「空行」（与 markdownlint 的 isBlankLine 语义一致）
 *
 * - 行不存在（文档开头之前 / 结尾之后）视为空行；
 * - 去掉 HTML 注释与引用符号 `>` 后只剩空白的行视为空行（引用块内的 `>` 空行同样算分隔）。
 */
export function isBlankLine(line: string | undefined): boolean {
  if (line === undefined) return true;
  const withoutComments = line.replace(/<!--[\s\S]*?-->/g, "");
  return withoutComments.replace(/>/g, "").trim().length === 0;
}

/**
 * 计算插入空行时需要保留的容器前缀
 *
 * 引用块内插入的空行必须带 `>`，否则会把引用块截断；列表缩进则无需保留（空行本身即可）。
 * 写法与 markdownlint MD031 的修复保持一致：非 `>` 字符替换为空格后 trim。
 */
function containerPrefixOf(line: string, startColumn: number): string {
  return line
    .slice(0, Math.max(0, startColumn - 1))
    .replace(/[^>]/g, " ")
    .trim();
}

/** 取节点下非空白的直接子节点（标题文字前后的空白不影响「整体强调」判断） */
function meaningfulChildren(token: MicromarkToken): MicromarkToken[] {
  return token.children.filter((child) => child.text.trim().length > 0);
}

// ============ MD101：数学块前后需空行 ============

const MD101: MarkdownlintCustomRule = {
  names: ["MD101", "math-surrounded-by-blank-lines"],
  description: "Math blocks should be surrounded by blank lines",
  tags: ["math", "blank_lines"],
  parser: "micromark",
  function(params, onError) {
    const { lines } = params;
    for (const mathBlock of filterTokensByTypes(params.parsers.micromark.tokens, ["mathFlow"])) {
      const { startLine, startColumn, endLine } = mathBlock;
      const startText = lines[startLine - 1] ?? "";
      const prefix = containerPrefixOf(startText, startColumn);

      // 上方：前一行非空 → 在数学块起始行之前插入空行
      if (!isBlankLine(lines[startLine - 2])) {
        onError({
          lineNumber: startLine,
          context: startText.trim(),
          fixInfo: { lineNumber: startLine, insertText: `${prefix}\n` },
        });
      }

      // 下方：后一行非空 → 在数学块结束行之后插入空行。
      // 同时要求结束行本身非空：未闭合的数学块会一直延伸到容器末尾的空行，此时不应重复报错
      if (!isBlankLine(lines[endLine]) && !isBlankLine(lines[endLine - 1])) {
        const endText = lines[endLine - 1] ?? "";
        onError({
          lineNumber: endLine,
          context: endText.trim(),
          fixInfo: { lineNumber: endLine + 1, insertText: `${prefix}\n` },
        });
      }
    }
  },
};

// ============ MD102：标题不应整体加粗/强调 ============

/** 强调类节点及其正文子节点类型 */
const EMPHASIS_TEXT_TYPE: Record<string, string> = {
  strong: "strongText",
  emphasis: "emphasisText",
};

/**
 * 剥掉整体包裹的强调标记，返回内部原文
 *
 * `***x***` 这类多层嵌套（强调里只有一个强调）会逐层剥到最里层；
 * 返回 null 表示结构不符合预期（不提供自动修复，只报问题）。
 */
function unwrapEmphasis(token: MicromarkToken): string | null {
  let current: MicromarkToken = token;
  // 层数上限只是防御，正常文档不会超过 3 层
  for (let depth = 0; depth < 8; depth += 1) {
    const textType = EMPHASIS_TEXT_TYPE[current.type];
    if (!textType) return null;
    const textToken = current.children.find((child) => child.type === textType);
    if (!textToken) return null;
    const inner = meaningfulChildren(textToken);
    if (
      inner.length === 1 &&
      EMPHASIS_TEXT_TYPE[inner[0].type] &&
      inner[0].text === textToken.text
    ) {
      current = inner[0];
      continue;
    }
    return textToken.text;
  }
  return null;
}

const MD102: MarkdownlintCustomRule = {
  names: ["MD102", "no-emphasis-only-heading"],
  description: "Heading text should not be entirely emphasized",
  tags: ["headings", "emphasis"],
  parser: "micromark",
  function(params, onError) {
    const headingTexts = filterTokensByTypes(params.parsers.micromark.tokens, [
      "atxHeadingText",
      "setextHeadingText",
    ]);
    for (const headingText of headingTexts) {
      const children = meaningfulChildren(headingText);
      // 只有「唯一子节点就是强调」才算整体强调；`## *斜体* 标题` 这类局部强调不报
      if (children.length !== 1) continue;
      const [emphasized] = children;
      if (!EMPHASIS_TEXT_TYPE[emphasized.type]) continue;

      const length = emphasized.endColumn - emphasized.startColumn;
      const info: RuleOnErrorInfo = {
        lineNumber: emphasized.startLine,
        detail: emphasized.type === "strong" ? "标题整体加粗" : "标题整体斜体",
        context: emphasized.text,
        range: [emphasized.startColumn, length],
      };
      // 修复：去掉包裹的强调标记，保留原文（跨行的 setext 标题不做单行修复）
      const unwrapped =
        emphasized.startLine === emphasized.endLine ? unwrapEmphasis(emphasized) : null;
      if (unwrapped !== null && unwrapped.trim().length > 0) {
        info.fixInfo = {
          editColumn: emphasized.startColumn,
          deleteCount: length,
          insertText: unwrapped,
        };
      }
      onError(info);
    }
  },
};

// ============ MD103：行内数学分隔符应为单个 $ ============

const MD103: MarkdownlintCustomRule = {
  names: ["MD103", "inline-math-single-dollar"],
  description: "Inline math should be delimited by a single dollar sign",
  tags: ["math"],
  parser: "micromark",
  function(params, onError) {
    const { lines } = params;
    for (const mathText of filterTokensByTypes(params.parsers.micromark.tokens, ["mathText"])) {
      const sequence = mathText.children.find((child) => child.type === "mathTextSequence");
      const delimiterLength = sequence?.text.length ?? 1;
      if (delimiterLength === 1) continue;

      const length = mathText.endColumn - mathText.startColumn;
      const info: RuleOnErrorInfo = {
        lineNumber: mathText.startLine,
        detail: `行内数学使用了 ${"$".repeat(delimiterLength)} 分隔符`,
        context: mathText.text,
        range: [mathText.startColumn, length],
      };

      // 只对单行、内部不含 $ 的公式给自动修复（含 $ 时改分隔符会改变语义）
      const inner = mathText.text
        .slice(delimiterLength, mathText.text.length - delimiterLength)
        .trim();
      if (mathText.startLine === mathText.endLine && inner.length > 0 && !inner.includes("$")) {
        const lineText = lines[mathText.startLine - 1] ?? "";
        // 整行只有这一个 `$$...$$`：用户本意是公式块，修复为块级 $$ 围栏；否则改为行内 $...$
        const isStandalone =
          lineText.trim() === mathText.text && mathText.startColumn === lineText.indexOf("$") + 1;
        const indent = lineText.slice(0, mathText.startColumn - 1);
        info.fixInfo = {
          editColumn: mathText.startColumn,
          deleteCount: length,
          insertText: isStandalone ? `$$\n${indent}${inner}\n${indent}$$` : `$${inner}$`,
        };
      }
      onError(info);
    }
  },
};

/** 全部自定义规则（lint 调用时作为 customRules 传入；默认随 `default: true` 启用） */
export const CUSTOM_LINT_RULES: readonly MarkdownlintCustomRule[] = [MD101, MD102, MD103];

/** 自定义规则编码集合（无官方文档链接，供 infoUrl 兜底判断） */
export const CUSTOM_LINT_RULE_CODES: ReadonlySet<string> = new Set(
  CUSTOM_LINT_RULES.map((rule) => rule.names[0])
);
