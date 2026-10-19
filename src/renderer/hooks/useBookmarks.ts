import { readonly, ref } from "vue";
import {
  BOOKMARKS_STORAGE_KEY,
  parseBookmarks,
  removeBookmarkFromMap,
  serializeBookmarks,
  toggleBookmarkInMap,
  type BookmarkMap,
} from "@/renderer/utils/bookmarks";

function loadBookmarks(): BookmarkMap {
  try {
    return parseBookmarks(localStorage.getItem(BOOKMARKS_STORAGE_KEY));
  } catch {
    return {};
  }
}

const bookmarkMap = ref<BookmarkMap>(loadBookmarks());

function persist(): void {
  try {
    localStorage.setItem(BOOKMARKS_STORAGE_KEY, serializeBookmarks(bookmarkMap.value));
  } catch {
    // localStorage 不可用时只保留内存状态
  }
}

/** 读取指定文件的书签块索引 */
export function getBookmarkIndices(filePath: string | null | undefined): number[] {
  if (!filePath) return [];
  return (bookmarkMap.value[filePath] ?? []).map((entry) => entry.index);
}

/** 切换指定文件某个块的书签，返回是否为新增 */
export function toggleFileBookmark(
  filePath: string,
  entry: { index: number; text: string; type: string }
): boolean {
  const { map, added } = toggleBookmarkInMap(bookmarkMap.value, filePath, entry);
  bookmarkMap.value = map;
  persist();
  return added;
}

/** 删除指定文件某个块的书签 */
export function removeFileBookmark(filePath: string, index: number): void {
  bookmarkMap.value = removeBookmarkFromMap(bookmarkMap.value, filePath, index);
  persist();
}

export default function useBookmarks() {
  return {
    bookmarks: readonly(bookmarkMap),
    getBookmarkIndices,
    toggleFileBookmark,
    removeFileBookmark,
  };
}
