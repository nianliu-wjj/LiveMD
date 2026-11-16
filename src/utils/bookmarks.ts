/**
 * 书签存储工具
 *
 * 对应 typora_plugin 的 bookmark：按文档记录若干顶层块书签，
 * 提供纯函数形式的增删与序列化逻辑，便于单元测试。
 */

export interface BookmarkEntry {
  /** 顶层块索引 */
  index: number;
  /** 块预览文本，用于索引失效时重新定位 */
  text: string;
  /** 块类型（paragraph / heading / code_block 等） */
  type: string;
  /** 创建时间戳 */
  createdAt: number;
}

export type BookmarkMap = Record<string, BookmarkEntry[]>;

export const BOOKMARKS_STORAGE_KEY = "livemd-bookmarks";

function isValidEntry(value: unknown): value is BookmarkEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.index === "number" &&
    Number.isFinite(entry.index) &&
    entry.index >= 0 &&
    typeof entry.text === "string" &&
    typeof entry.type === "string" &&
    typeof entry.createdAt === "number" &&
    Number.isFinite(entry.createdAt)
  );
}

/** 解析 localStorage 中的书签数据，非法数据会被忽略 */
export function parseBookmarks(raw: string | null): BookmarkMap {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const result: BookmarkMap = {};
    for (const [filePath, entries] of Object.entries(parsed as Record<string, unknown>)) {
      if (!filePath || !Array.isArray(entries)) continue;
      const valid = entries
        .filter(isValidEntry)
        .map((entry) => ({ ...entry, index: Math.floor(entry.index) }))
        .sort((left, right) => left.index - right.index);
      if (valid.length > 0) {
        result[filePath] = valid;
      }
    }
    return result;
  } catch {
    return {};
  }
}

export function serializeBookmarks(map: BookmarkMap): string {
  return JSON.stringify(map);
}

/**
 * 切换某个块的书签状态
 *
 * 同一索引已存在书签时删除，否则新增。
 */
export function toggleBookmarkInMap(
  map: BookmarkMap,
  filePath: string,
  entry: { index: number; text: string; type: string },
  now: number = Date.now()
): { map: BookmarkMap; added: boolean } {
  const list = map[filePath] ?? [];
  const exists = list.some((item) => item.index === entry.index);

  if (exists) {
    const remaining = list.filter((item) => item.index !== entry.index);
    const next = { ...map };
    if (remaining.length > 0) {
      next[filePath] = remaining;
    } else {
      delete next[filePath];
    }
    return { map: next, added: false };
  }

  const nextEntry: BookmarkEntry = {
    index: Math.max(0, Math.floor(entry.index)),
    text: entry.text,
    type: entry.type,
    createdAt: now,
  };
  const nextList = [...list, nextEntry].sort((left, right) => left.index - right.index);
  return { map: { ...map, [filePath]: nextList }, added: true };
}

/** 删除某个块的书签 */
export function removeBookmarkFromMap(
  map: BookmarkMap,
  filePath: string,
  index: number
): BookmarkMap {
  const list = map[filePath];
  if (!list) return map;

  const remaining = list.filter((item) => item.index !== index);
  const next = { ...map };
  if (remaining.length > 0) {
    next[filePath] = remaining;
  } else {
    delete next[filePath];
  }
  return next;
}

/** 展平为可展示的行 */
export function listBookmarks(
  map: BookmarkMap
): Array<{ filePath: string; entry: BookmarkEntry }> {
  return Object.entries(map).flatMap(([filePath, entries]) =>
    entries.map((entry) => ({ filePath, entry }))
  );
}
