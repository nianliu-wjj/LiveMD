/**
 * 思维导图数据层（自研，无第三方依赖）
 *
 * 存储格式：```mindmap 围栏代码块，内容为「缩进层级文本」，每级缩进 2 个空格（Tab 计为 2 个空格）：
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

/** 新插入的思维导图模板 */
export const MINDMAP_TEMPLATE = ["中心主题", "  分支主题 1", "    子主题", "  分支主题 2"].join(
  "\n"
);

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

/**
 * 把思维导图树序列化为缩进层级文本（每级 2 空格）
 */
export function serializeMindMap(root: MindMapNode): string {
  const lines: string[] = [];
  const walk = (node: MindMapNode, depth: number) => {
    // 换行会破坏层级结构，节点文本中的换行统一替换为空格
    const text = node.text.replace(/[\r\n]+/g, " ").trim() || "未命名";
    lines.push(" ".repeat(depth * MINDMAP_INDENT) + text);
    node.children.forEach((child) => walk(child, depth + 1));
  };
  walk(root, 0);
  return lines.join("\n");
}

/** 深拷贝（编辑弹窗在副本上操作，取消时不影响原数据） */
export function cloneMindMap(node: MindMapNode): MindMapNode {
  return { id: node.id, text: node.text, children: node.children.map(cloneMindMap) };
}

/** 按 id 查找节点 */
export function findNode(root: MindMapNode, id: string): MindMapNode | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

/** 查找节点的父节点（根节点返回 null） */
export function findParent(root: MindMapNode, id: string): MindMapNode | null {
  for (const child of root.children) {
    if (child.id === id) return root;
    const found = findParent(child, id);
    if (found) return found;
  }
  return null;
}

/** 统计节点总数 */
export function countNodes(root: MindMapNode): number {
  return 1 + root.children.reduce((sum, child) => sum + countNodes(child), 0);
}

/** 计算树的最大深度（只有根节点时为 1） */
export function getDepth(root: MindMapNode): number {
  return 1 + root.children.reduce((max, child) => Math.max(max, getDepth(child)), 0);
}

// ============ 编辑操作：均原地修改树并重排 id，返回操作后应选中的节点 id ============

/** 新增子节点 */
export function addChild(root: MindMapNode, parentId: string, text = "新主题"): string | null {
  const parent = findNode(root, parentId);
  if (!parent) return null;
  const node: MindMapNode = { id: "", text, children: [] };
  parent.children.push(node);
  reassignIds(root);
  return node.id;
}

/** 新增同级节点（插在当前节点之后）；根节点没有同级，退化为新增子节点 */
export function addSibling(root: MindMapNode, nodeId: string, text = "新主题"): string | null {
  const parent = findParent(root, nodeId);
  if (!parent) return addChild(root, nodeId, text);
  const index = parent.children.findIndex((child) => child.id === nodeId);
  const node: MindMapNode = { id: "", text, children: [] };
  parent.children.splice(index + 1, 0, node);
  reassignIds(root);
  return node.id;
}

/** 删除节点及其子树（根节点不可删除），返回删除后应选中的节点 id */
export function removeNode(root: MindMapNode, nodeId: string): string | null {
  const parent = findParent(root, nodeId);
  if (!parent) return null;
  const index = parent.children.findIndex((child) => child.id === nodeId);
  parent.children.splice(index, 1);
  reassignIds(root);
  // 优先选中原位置的下一个兄弟，其次上一个兄弟，最后选中父节点
  const next = parent.children[index] ?? parent.children[index - 1];
  return next ? next.id : parent.id;
}

/** 在兄弟间上移 / 下移节点，返回移动后的节点 id */
export function moveNode(root: MindMapNode, nodeId: string, delta: -1 | 1): string | null {
  const parent = findParent(root, nodeId);
  if (!parent) return null;
  const index = parent.children.findIndex((child) => child.id === nodeId);
  const target = index + delta;
  if (target < 0 || target >= parent.children.length) return nodeId;
  const [node] = parent.children.splice(index, 1);
  parent.children.splice(target, 0, node);
  reassignIds(root);
  return node.id;
}

/** 修改节点文本 */
export function updateNodeText(root: MindMapNode, nodeId: string, text: string): boolean {
  const node = findNode(root, nodeId);
  if (!node) return false;
  node.text = text;
  return true;
}
