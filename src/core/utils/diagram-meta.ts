/**
 * Mermaid 图表的元数据与源码改写（纯函数，无 DOM 依赖）
 *
 * Mermaid 是声明式自动布局，语法里没有「节点坐标」，手动拖动的结果需要自行持久化：
 * - 文档内存态：位移表存在 code_block 节点的 mermaidLayout 属性（JSON 字符串），不进代码文本，
 *   拖动时不触发重新渲染，代码编辑器里也看不到这行元数据；
 * - Markdown 文件：序列化为一行合法的 Mermaid 注释，其它 Mermaid 渲染器会忽略：
 *   `%% livemd:positions {"A":{"dx":12,"dy":-4}} %%`
 *
 * 另提供 renameFlowchartNode：双击节点改名时，把新文字写回流程图源码。
 */

/** 单个节点相对自动布局位置的位移（SVG 用户坐标） */
export interface MermaidNodeOffset {
  dx: number;
  dy: number;
}

/** 节点 id → 位移 */
export type MermaidPositions = Record<string, MermaidNodeOffset>;

const POSITIONS_LINE_RE = /^[ \t]*%%[ \t]*livemd:positions[ \t]+(\{.*\})[ \t]*%%[ \t]*$/m;

/** 校验并规整位移表：丢弃非法项与零位移，全部无效时返回 null */
function normalizePositions(value: unknown): MermaidPositions | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result: MermaidPositions = {};
  for (const [id, offset] of Object.entries(value as Record<string, unknown>)) {
    const { dx, dy } = (offset ?? {}) as Partial<MermaidNodeOffset>;
    if (typeof dx !== "number" || typeof dy !== "number") continue;
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) continue;
    result[id] = { dx: Math.round(dx * 100) / 100, dy: Math.round(dy * 100) / 100 };
  }
  return Object.keys(result).length > 0 ? result : null;
}

/** 从 mermaid 代码块文本中提取位移注释，返回 [位移表, 去掉注释行后的文本] */
export function extractMermaidPositions(content: string): [MermaidPositions | null, string] {
  const match = POSITIONS_LINE_RE.exec(content);
  if (!match) return [null, content];

  let positions: MermaidPositions | null;
  try {
    positions = normalizePositions(JSON.parse(match[1]));
  } catch (error) {
    // 注释被手工改坏：保留原文（它仍是合法的 Mermaid 注释），不丢用户内容
    console.warn("[diagram-meta] positions 注释解析失败，已按普通注释保留:", error);
    return [null, content];
  }

  const before = content.slice(0, match.index);
  const after = content.slice(match.index + match[0].length);
  // 连同该行的一个换行符一起删除，避免残留空行
  const stripped = after.startsWith("\n") ? before + after.slice(1) : before.replace(/\n$/, "");
  return [positions, stripped];
}

/** 把位移表序列化为一行 Mermaid 注释（无有效位移时返回 null） */
export function serializeMermaidPositions(positions: MermaidPositions | null): string | null {
  const normalized = normalizePositions(positions);
  return normalized ? `%% livemd:positions ${JSON.stringify(normalized)} %%` : null;
}

/** 位移表 → code_block.attrs.mermaidLayout */
export function stringifyPositionsAttr(positions: MermaidPositions | null): string | null {
  const normalized = normalizePositions(positions);
  return normalized ? JSON.stringify(normalized) : null;
}

/** code_block.attrs.mermaidLayout → 位移表 */
export function parsePositionsAttr(value: unknown): MermaidPositions | null {
  if (typeof value !== "string" || !value) return null;
  try {
    return normalizePositions(JSON.parse(value));
  } catch {
    return null;
  }
}

/** 取第一条有效语句（跳过 frontmatter、注释与指令、空行） */
function firstStatement(source: string): string {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let index = 0;
  if (lines[0]?.trim() === "---") {
    index = 1;
    while (index < lines.length && lines[index].trim() !== "---") index += 1;
    index += 1;
  }
  for (; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line && !line.startsWith("%%")) return line;
  }
  return "";
}

/** 是否为流程图（只有流程图支持节点拖动与行内改名） */
export function isFlowchartSource(source: string): boolean {
  return /^(graph|flowchart)(\s|$)/i.test(firstStatement(source));
}

/** 形状括号：长的在前，保证 `((` 优先于 `(` 命中 */
const SHAPE_DELIMITERS: ReadonlyArray<readonly [string, string[]]> = [
  ["(((", [")))"]],
  ["[[", ["]]"]],
  ["[(", [")]"]],
  ["[/", ["/]", "\\]"]],
  ["[\\", ["\\]", "/]"]],
  ["((", ["))"]],
  ["([", ["])"]],
  ["{{", ["}}"]],
  ["[", ["]"]],
  ["(", [")"]],
  ["{", ["}"]],
  [">", ["]"]],
];

/** 这些语句里的标识符不是节点定义，不能在其上写入标签 */
const NON_NODE_STATEMENT_RE =
  /^\s*(%%|graph\b|flowchart\b|subgraph\b|end\b|style\b|classDef\b|class\b|click\b|linkStyle\b|direction\b)/i;

/** 把用户输入编码为 Mermaid 标签：含特殊字符时加引号，引号本身转义为实体 */
function encodeLabel(label: string): string {
  const escaped = label.replace(/"/g, "#quot;");
  return /^[\w一-鿿 ]+$/.test(label) ? escaped : `"${escaped}"`;
}

/** 判断 line[index] 开始的 id 左边界是否合法（避免命中更长标识符的一部分） */
function isTokenStart(line: string, index: number): boolean {
  if (index === 0) return true;
  const prev = line[index - 1];
  if (/[\w一-鿿.]/.test(prev)) return false;
  // id 可以含 `-`：只有 `--`、`=-`、`.-` 这样的连线符号结尾才算边界
  if (prev === "-") return /[-=.]/.test(line[index - 2] ?? "");
  return true;
}

/**
 * 在一行里定位「括号 / 引号 / 竖线之外」的 id 出现位置，
 * 跳过节点文字和连线文字，避免把标签里恰好相同的词当成节点。
 */
function findTokenPositions(line: string, id: string): number[] {
  const positions: number[] = [];
  let depth = 0;
  let inQuote = false;
  let inPipe = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') inQuote = !inQuote;
    if (inQuote) continue;
    if (char === "|") inPipe = !inPipe;
    if (inPipe) continue;
    if (depth === 0 && line.startsWith(id, index) && isTokenStart(line, index)) {
      positions.push(index);
    }
    if ("[({".includes(char)) depth += 1;
    else if ("])}".includes(char)) depth = Math.max(0, depth - 1);
  }
  return positions;
}

/** 从 start（开括号之后）查找闭括号，引号内的括号不计 */
function findCloser(line: string, start: number, closers: string[]): [number, string] | null {
  let inQuote = false;
  for (let index = start; index < line.length; index += 1) {
    if (line[index] === '"') inQuote = !inQuote;
    if (inQuote) continue;
    const closer = closers.find((candidate) => line.startsWith(candidate, index));
    if (closer) return [index, closer];
  }
  return null;
}

/**
 * 修改流程图节点的显示文字，返回新源码；找不到节点或文字为空时返回 null。
 *
 * 优先改写带形状的定义（`A[旧]` → `A[新]`，形状保持不变），也支持 `A@{ label: "旧" }`；
 * 节点从未声明过文字（如 `A --> B`）时，把首次出现改为 `A[新]`。
 */
export function renameFlowchartNode(source: string, id: string, label: string): string | null {
  const text = label.replace(/[\r\n]+/g, " ").trim();
  if (!text || !id) return null;

  const lines = source.split("\n");
  let bareRef: { lineIndex: number; end: number } | null = null;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (NON_NODE_STATEMENT_RE.test(line)) continue;

    for (const position of findTokenPositions(line, id)) {
      const end = position + id.length;
      const rest = line.slice(end);

      // v11 对象语法：A@{ shape: rect, label: "文字" }
      if (rest.startsWith("@{")) {
        const close = line.indexOf("}", end);
        if (close === -1) continue;
        const body = line.slice(end + 2, close);
        const quoted = `"${text.replace(/"/g, "#quot;")}"`;
        const nextBody = /label\s*:/.test(body)
          ? body.replace(/label\s*:\s*("[^"]*"|[^,}]*)/, `label: ${quoted}`)
          : ` label: ${quoted},${body}`;
        lines[lineIndex] = line.slice(0, end + 2) + nextBody + line.slice(close);
        return lines.join("\n");
      }

      const shape = SHAPE_DELIMITERS.find(([open]) => rest.startsWith(open));
      if (shape) {
        const contentStart = end + shape[0].length;
        const found = findCloser(line, contentStart, shape[1]);
        if (!found) continue;
        lines[lineIndex] = line.slice(0, contentStart) + encodeLabel(text) + line.slice(found[0]);
        return lines.join("\n");
      }

      // 右边界：后面紧跟标识符字符说明命中的是更长 id 的前缀
      const isBare = !/^[\w一-鿿]/.test(rest) && !/^-[\w一-鿿]/.test(rest);
      if (isBare && !bareRef) bareRef = { lineIndex, end };
    }
  }

  if (!bareRef) return null;
  const line = lines[bareRef.lineIndex];
  lines[bareRef.lineIndex] =
    `${line.slice(0, bareRef.end)}[${encodeLabel(text)}]${line.slice(bareRef.end)}`;
  return lines.join("\n");
}
