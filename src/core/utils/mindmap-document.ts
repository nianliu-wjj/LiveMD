/**
 * 思维导图文档格式（```mindmap 代码块的内容）
 *
 * 存储为 JSON，结构与 simple-mind-map 的 .smm 文件一致，可直接导入 / 导出参考项目：
 * {
 *   "layout": "logicalStructure",
 *   "root": { "data": { "text": "中心主题" }, "children": [...] },
 *   "theme": { "template": "default", "config": {} },
 *   "view": null
 * }
 *
 * 兼容旧格式：内容不是 JSON 时按「缩进层级文本」解析（见 mindmap-markdown.ts），
 * 在编辑器里保存一次后即升级为 JSON。纯函数、无 DOM 依赖，供代码块预览与编辑器共用。
 */
import { parseMindMap, type MindMapNode } from "./mindmap-markdown.ts";

/** 引擎节点数据（与 simple-mind-map 一致；data 内其余字段为样式 / 图片 / 图标等扩展属性） */
export interface MindMapTreeNode {
  data: { text: string; [key: string]: unknown };
  children: MindMapTreeNode[];
}

export interface MindMapDocument {
  /** 结构：logicalStructure / mindMap / organizationStructure / catalogOrganization / timeline / fishbone … */
  layout: string;
  root: MindMapTreeNode;
  theme: { template: string; config: Record<string, unknown> };
  /** 画布平移缩放状态（编辑器内恢复视图用，可为 null） */
  view: unknown;
}

/** 新插入的思维导图默认使用的结构与主题 */
export const DEFAULT_MINDMAP_LAYOUT = "logicalStructure";
export const DEFAULT_MINDMAP_THEME = "default";

/** 旧缩进文本树 → 引擎节点数据 */
function fromIndentTree(node: MindMapNode): MindMapTreeNode {
  return { data: { text: node.text }, children: node.children.map(fromIndentTree) };
}

/** 校验并补齐节点结构：缺 data / children / text 的节点补默认值，保证引擎可渲染 */
function normalizeTreeNode(value: unknown): MindMapTreeNode {
  const raw = (value ?? {}) as { data?: Record<string, unknown>; children?: unknown };
  const data = raw.data && typeof raw.data === "object" ? { ...raw.data } : {};
  const text = typeof data.text === "string" ? data.text : String(data.text ?? "");
  const children = Array.isArray(raw.children) ? raw.children.map(normalizeTreeNode) : [];
  return { data: { ...data, text }, children };
}

/** 内容是否为 JSON 文档（以 { 开头） */
export function isMindMapJson(source: string): boolean {
  return source.trimStart().startsWith("{");
}

/**
 * 解析代码块内容为思维导图文档
 *
 * - JSON：完整 .smm 文档，或只有节点树（{ data, children }）；
 * - 其它：旧版缩进层级文本；
 * - JSON 损坏时抛出错误（由调用方提示用户），不静默丢弃内容。
 */
export function parseMindMapDocument(source: string): MindMapDocument {
  if (!isMindMapJson(source)) {
    return {
      layout: DEFAULT_MINDMAP_LAYOUT,
      root: fromIndentTree(parseMindMap(source)),
      theme: { template: DEFAULT_MINDMAP_THEME, config: {} },
      view: null,
    };
  }

  const parsed = JSON.parse(source) as Record<string, unknown>;
  // 只有节点树（如从其它工具粘贴的 root 数据）
  const isBareTree = "data" in parsed && !("root" in parsed);
  const rootSource = isBareTree ? parsed : parsed.root;
  const theme = (parsed.theme ?? {}) as { template?: unknown; config?: unknown };
  return {
    layout: typeof parsed.layout === "string" ? parsed.layout : DEFAULT_MINDMAP_LAYOUT,
    root: normalizeTreeNode(rootSource),
    theme: {
      template: typeof theme.template === "string" ? theme.template : DEFAULT_MINDMAP_THEME,
      config:
        theme.config && typeof theme.config === "object"
          ? (theme.config as Record<string, unknown>)
          : {},
    },
    view: isBareTree ? null : (parsed.view ?? null),
  };
}

/** 文档 → 代码块内容（2 空格缩进的 JSON，便于 diff 与手工查看） */
export function serializeMindMapDocument(doc: MindMapDocument): string {
  return JSON.stringify(
    { layout: doc.layout, root: doc.root, theme: doc.theme, view: doc.view ?? null },
    null,
    2
  );
}

/** 新插入的思维导图模板 */
export function createMindMapTemplate(): string {
  return serializeMindMapDocument({
    layout: DEFAULT_MINDMAP_LAYOUT,
    root: {
      data: { text: "中心主题" },
      children: [
        { data: { text: "分支主题 1" }, children: [{ data: { text: "子主题" }, children: [] }] },
        { data: { text: "分支主题 2" }, children: [] },
      ],
    },
    theme: { template: DEFAULT_MINDMAP_THEME, config: {} },
    view: null,
  });
}

/** 统计节点数与文字数（编辑器底部「字数 / 节点」） */
export function countMindMap(root: MindMapTreeNode): { nodes: number; words: number } {
  let nodes = 0;
  let words = 0;
  const walk = (node: MindMapTreeNode) => {
    nodes += 1;
    // 富文本节点的 text 为 HTML，统计前去掉标签
    words += node.data.text.replace(/<[^>]+>/g, "").replace(/\s+/g, "").length;
    node.children.forEach(walk);
  };
  walk(root);
  return { nodes, words };
}
