/**
 * 旧版思维导图格式解析：「缩进层级文本」→ 树
 *
 * 早期版本的 ```mindmap 代码块存的是缩进层级文本，现已改为 JSON（见 mindmap-document.ts）。
 * 这里只保留解析，供 mindmap-document 兼容打开旧文档；在编辑器中保存一次即升级为 JSON。
 *
 * 旧格式：每级缩进 2 个空格（Tab 计为 2 个空格）：
 *
 * ```mindmap
 * 中心主题
 *   分支一
 *     子主题 1
 *     子主题 2
 *   分支二
 * ```
 *
 * - 第一行非空文本为根节点（中心主题）；若出现多个顶层节点，其余顶层节点挂到第一个根节点下；
 * - 行首可选的列表符号 `- ` / `* ` / `+ ` 会被忽略，便于从 Markdown 列表粘贴；
 * - 缩进跳级（如直接从 0 级跳到 3 级）时挂到最近的上一层节点，保证结构总是一棵合法的树。
 *
 * 节点 id 为路径形式（root、root-0、root-0-1），每次解析都会重新生成，仅在单次编辑会话内有效。
 */

/** 思维导图节点 */
export interface MindMapNode {
  /** 路径 id：root / root-0 / root-0-1 …… */
  id: string;
  /** 节点文本 */
  text: string;
  /** 子节点 */
  children: MindMapNode[];
}

/** 每级缩进的空格数 */
export const MINDMAP_INDENT = 2;

/** 空内容时的默认根节点文本 */
const DEFAULT_ROOT_TEXT = "中心主题";

/** 计算行首缩进宽度（Tab 计为 MINDMAP_INDENT 个空格） */
function measureIndent(line: string): number {
  let width = 0;
  for (const char of line) {
    if (char === " ") width += 1;
    else if (char === "\t") width += MINDMAP_INDENT;
    else break;
  }
  return width;
}

/** 去掉行首缩进与可选的列表符号 */
function cleanLineText(line: string): string {
  return line.trim().replace(/^[-*+]\s+/, "");
}

/** 按树结构重新生成路径 id */
export function reassignIds(node: MindMapNode, id = "root"): MindMapNode {
  node.id = id;
  node.children.forEach((child, index) => reassignIds(child, `${id}-${index}`));
  return node;
}

/**
 * 把缩进层级文本解析为思维导图树
 */
export function parseMindMap(source: string): MindMapNode {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let root: MindMapNode | null = null;
  // 栈：维护当前路径上每一层的 { 缩进宽度, 节点 }；根节点以 -1 作为哨兵缩进，永不出栈，
  // 因此与根同缩进的其它顶层行会挂到根节点下
  const stack: { indent: number; node: MindMapNode }[] = [];

  for (const rawLine of lines) {
    const text = cleanLineText(rawLine);
    if (!text) continue;
    const indent = measureIndent(rawLine);
    const node: MindMapNode = { id: "", text, children: [] };

    if (!root) {
      root = node;
      stack.push({ indent: -1, node });
      continue;
    }

    // 弹出缩进 ≥ 当前行的层级，栈顶即为父节点（缩进跳级时自然挂到最近的上一层）
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    stack[stack.length - 1].node.children.push(node);
    stack.push({ indent, node });
  }

  return reassignIds(root ?? { id: "", text: DEFAULT_ROOT_TEXT, children: [] });
}
