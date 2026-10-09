/**
 * 批注（Annotation）数据模型与锚点工具
 *
 * 批注是"跨编辑会话的区间引用"：持久化时记录语义锚点
 * （块索引 + 块内偏移 + 选中文本快照），重载时按锚点重新解析；
 * 运行期的位置平移由 ProseMirror 的 position mapping 负责（见 core/plugins/annotations.ts）。
 *
 * 本模块全部为纯函数、零依赖（不 import prosemirror），可直接被 Node 单测加载；
 * 编辑器层负责 Node → AnchorBlockInfo、ResolvedAnchor → PM position 的双向换算。
 *
 * 注意：模块放在 shared 而非 renderer/utils —— core/editor.ts 也要构造/重定位锚点，
 * core 层不允许反向依赖 renderer。
 */

/** 批注锚点：描述被批注文字"在哪里" */
export interface AnnotationAnchor {
  /** 起点所在顶层块索引 */
  startBlockIndex: number;
  /** 终点所在顶层块索引 */
  endBlockIndex: number;
  /** 起点块内偏移（文本坐标 ≈ PM content offset） */
  startOffset: number;
  /** 终点块内偏移 */
  endOffset: number;
  /** 完整选中文本快照（展示用） */
  anchorText: string;
  /** 选中文本前 40 字符（起点搜索重定位用） */
  headText: string;
  /** 选中文本后 40 字符（终点搜索重定位用） */
  tailText: string;
}

/** 单条批注 */
export interface AnnotationEntry {
  /** `ann-{hex时间}-{hex随机}`，createAnnotationId() 生成 */
  id: string;
  anchor: AnnotationAnchor;
  /** 批注正文（Markdown 源文） */
  content: string;
  /** 未提交 / 已提交 */
  state: "editing" | "done";
  createdAt: number;
  updatedAt: number;
}

/** localStorage 中的整体结构：docKey → 条目列表 */
export type AnnotationMap = Record</* docKey */ string, AnnotationEntry[]>;

/** 块信息的最小抽象，prosemirror 节点与单测桩都满足该形状 */
export interface AnchorBlockInfo {
  /** node.textContent */
  text: string;
  /** node.content.size */
  contentSize: number;
}

/** 重定位成功后的区间（跨块双端点） */
export interface ResolvedAnnotationRange {
  startBlockIndex: number;
  endBlockIndex: number;
  startOffset: number;
  endOffset: number;
}

/** localStorage 存储键 */
export const ANNOTATIONS_STORAGE_KEY = "livemd-annotations";

/** head/tail 文本样本长度 */
const SAMPLE_LENGTH = 40;

/** 邻块扩散搜索半径 */
const NEIGHBOR_SEARCH_RADIUS = 3;

/** docKey：有文件路径用 `file:{path}`，未保存文档用 `tab:{id}`（同书签/大纲折叠的做法） */
export function annotationDocKey(filePath: string | null | undefined, tabId: string): string {
  return filePath ? `file:${filePath}` : `tab:${tabId}`;
}

/** id 生成器：编辑器核心（右键创建时）与渲染层共用同一口径 */
export function createAnnotationId(): string {
  const time = Date.now().toString(16);
  const rand = Math.random().toString(16).slice(2, 10);
  return `ann-${time}-${rand}`;
}

function isNonNegativeInt(value: unknown): boolean {
  // 先用 typeof 收窄（Number.isInteger 不收窄 unknown），再用 Number.isInteger 精确校验
  if (typeof value !== "number") return false;
  return Number.isInteger(value) && value >= 0;
}

function isValidAnchor(value: unknown): value is AnnotationAnchor {
  if (!value || typeof value !== "object") return false;
  const anchor = value as Record<string, unknown>;
  return (
    isNonNegativeInt(anchor.startBlockIndex) &&
    isNonNegativeInt(anchor.endBlockIndex) &&
    isNonNegativeInt(anchor.startOffset) &&
    isNonNegativeInt(anchor.endOffset) &&
    typeof anchor.anchorText === "string" &&
    typeof anchor.headText === "string" &&
    typeof anchor.tailText === "string"
  );
}

function isValidEntry(value: unknown): value is AnnotationEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    entry.id.length > 0 &&
    isValidAnchor(entry.anchor) &&
    typeof entry.content === "string" &&
    (entry.state === "editing" || entry.state === "done") &&
    typeof entry.createdAt === "number" &&
    Number.isFinite(entry.createdAt) &&
    typeof entry.updatedAt === "number" &&
    Number.isFinite(entry.updatedAt)
  );
}

/** 解析 localStorage 中的批注数据，非法字段静默丢弃（fail-fast + 容忍版本演进） */
export function parseAnnotations(raw: string | null): AnnotationMap {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const result: AnnotationMap = {};
    for (const [docKey, entries] of Object.entries(parsed as Record<string, unknown>)) {
      if (!docKey || !Array.isArray(entries)) continue;
      const valid = entries.filter(isValidEntry);
      if (valid.length > 0) {
        result[docKey] = valid;
      }
    }
    return result;
  } catch {
    return {};
  }
}

export function serializeAnnotations(map: AnnotationMap): string {
  return JSON.stringify(map);
}

export function addAnnotationToMap(
  map: AnnotationMap,
  docKey: string,
  entry: AnnotationEntry
): AnnotationMap {
  const list = map[docKey] ?? [];
  return { ...map, [docKey]: [...list, entry] };
}

export type AnnotationPatch = Partial<Pick<AnnotationEntry, "content" | "state" | "anchor">>;

export function updateAnnotationInMap(
  map: AnnotationMap,
  docKey: string,
  id: string,
  patch: AnnotationPatch,
  now: number = Date.now()
): AnnotationMap {
  const list = map[docKey];
  if (!list) return map;

  let changed = false;
  const nextList = list.map((entry) => {
    if (entry.id !== id) return entry;
    changed = true;
    return { ...entry, ...patch, updatedAt: now };
  });

  return changed ? { ...map, [docKey]: nextList } : map;
}

export function removeAnnotationFromMap(
  map: AnnotationMap,
  docKey: string,
  id: string
): AnnotationMap {
  const list = map[docKey];
  if (!list) return map;

  const remaining = list.filter((entry) => entry.id !== id);
  const next = { ...map };
  if (remaining.length > 0) {
    next[docKey] = remaining;
  } else {
    delete next[docKey];
  }
  return next;
}

/** 由选区信息构造锚点，并截取 head/tail 样本 */
export function buildAnnotationAnchor(input: {
  startBlockIndex: number;
  startOffset: number;
  endBlockIndex: number;
  endOffset: number;
  selectedText: string;
}): AnnotationAnchor {
  const anchorText = input.selectedText;
  return {
    startBlockIndex: Math.max(0, Math.floor(input.startBlockIndex)),
    endBlockIndex: Math.max(0, Math.floor(input.endBlockIndex)),
    startOffset: Math.max(0, Math.floor(input.startOffset)),
    endOffset: Math.max(0, Math.floor(input.endOffset)),
    anchorText,
    headText: anchorText.slice(0, SAMPLE_LENGTH),
    tailText: anchorText.slice(-SAMPLE_LENGTH),
  };
}

/**
 * 单端点重定位（四级漏斗，§3.5 / §7.4）：
 * 1. 块存在且偏移落在块文本长度内 → 信任偏移（**不校验文本**——"内容变化不影响关联"的宽容性来源）
 * 2. 偏移越界 → 原块内 indexOf(searchText)；终点命中位必须 + searchText.length
 * 3. 原块找不到 → 邻块扩散搜索（半径 3，先左后右）
 * 4. 全部失败 → null（该条批注锚定的文字"已不存在"，按需求自动删除）
 */
function resolveEndpoint(
  blocks: AnchorBlockInfo[],
  blockIndex: number,
  offset: number,
  searchText: string,
  atEnd: boolean
): { index: number; offset: number } | null {
  // 1) 偏移在块文本长度内 → 信任偏移（不校验文本）
  if (blockIndex < blocks.length && offset >= 0 && offset <= blocks[blockIndex].text.length) {
    return { index: blockIndex, offset };
  }

  // 2) 原块内样本搜索
  const blockText = blocks[blockIndex]?.text;
  if (typeof blockText === "string") {
    const found = blockText.indexOf(searchText);
    if (found >= 0 && searchText.length > 0) {
      const target = atEnd ? found + searchText.length : found;
      return { index: blockIndex, offset: Math.min(target, blockText.length) };
    }
  }

  // 3) 邻块扩散搜索（半径 3，先左后右）
  for (let distance = 1; distance <= NEIGHBOR_SEARCH_RADIUS; distance += 1) {
    const leftIndex = blockIndex - distance;
    if (leftIndex >= 0 && leftIndex < blocks.length) {
      const found = blocks[leftIndex].text.indexOf(searchText);
      if (found >= 0 && searchText.length > 0) {
        const target = atEnd ? found + searchText.length : found;
        return { index: leftIndex, offset: Math.min(target, blocks[leftIndex].text.length) };
      }
    }
    const rightIndex = blockIndex + distance;
    if (rightIndex >= 0 && rightIndex < blocks.length) {
      const found = blocks[rightIndex].text.indexOf(searchText);
      if (found >= 0 && searchText.length > 0) {
        const target = atEnd ? found + searchText.length : found;
        return { index: rightIndex, offset: Math.min(target, blocks[rightIndex].text.length) };
      }
    }
  }

  // 4) 失败 → 整条批注失效
  return null;
}

/**
 * 重定位单条批注锚点。
 * 同块 `start.offset >= end.offset` → 判 null（与运行期 `from >= to` 坍缩语义一致，
 * 禁止"夹到 end-1"式宽容，见 §7.4 踩坑一）。
 */
export function resolveAnnotationAnchor(
  blocks: AnchorBlockInfo[],
  anchor: AnnotationAnchor
): ResolvedAnnotationRange | null {
  if (!isValidAnchor(anchor)) return null;
  if (anchor.startBlockIndex > anchor.endBlockIndex) return null;

  const start = resolveEndpoint(
    blocks,
    anchor.startBlockIndex,
    anchor.startOffset,
    anchor.headText,
    false
  );
  const end = resolveEndpoint(
    blocks,
    anchor.endBlockIndex,
    anchor.endOffset,
    anchor.tailText,
    true
  );
  if (!start || !end) return null;
  if (start.index > end.index) return null;
  if (start.index === end.index && start.offset >= end.offset) return null;

  return {
    startBlockIndex: start.index,
    endBlockIndex: end.index,
    startOffset: start.offset,
    endOffset: end.offset,
  };
}

/** 批量重定位：返回可恢复条目（带区间）与重定位失败被丢弃的 id */
export function resolveAnnotationEntries(
  blocks: AnchorBlockInfo[],
  entries: AnnotationEntry[]
): {
  resolved: Array<{ entry: AnnotationEntry; range: ResolvedAnnotationRange }>;
  droppedIds: string[];
} {
  const resolved: Array<{ entry: AnnotationEntry; range: ResolvedAnnotationRange }> = [];
  const droppedIds: string[] = [];

  for (const entry of entries) {
    const range = resolveAnnotationAnchor(blocks, entry.anchor);
    if (range) {
      resolved.push({ entry, range });
    } else {
      droppedIds.push(entry.id);
    }
  }

  return { resolved, droppedIds };
}
