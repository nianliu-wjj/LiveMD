import { ref, watch } from "vue";

/**
 * 最近打开文件记录
 *
 * 对应 Typora 的“最近使用的文档”能力，同时为快速打开面板提供数据来源。
 */
export interface RecentFileItem {
  path: string;
  name: string;
  openedAt: number;
}

const STORAGE_KEY = "livemd-recent-files";
const MAX_RECENT_FILES = 50;

function readStoredRecentFiles(): RecentFileItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is RecentFileItem =>
          Boolean(item) &&
          typeof item.path === "string" &&
          item.path.length > 0 &&
          typeof item.name === "string"
      )
      .map((item) => ({
        path: item.path,
        name: item.name,
        openedAt: typeof item.openedAt === "number" ? item.openedAt : 0,
      }))
      .slice(0, MAX_RECENT_FILES);
  } catch {
    return [];
  }
}

const recentFiles = ref<RecentFileItem[]>(readStoredRecentFiles());

watch(
  recentFiles,
  (value) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {
      // localStorage 不可用时仅保留内存记录
    }
  },
  { deep: true }
);

function getFileName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath;
}

/** 记录一次文件打开（同路径去重并置顶） */
export function recordRecentFile(filePath: string, name?: string): void {
  if (!filePath) return;
  const normalizedName = name || getFileName(filePath);
  const next = recentFiles.value.filter((item) => item.path !== filePath);
  next.unshift({ path: filePath, name: normalizedName, openedAt: Date.now() });
  recentFiles.value = next.slice(0, MAX_RECENT_FILES);
}

/** 移除一条最近记录 */
export function removeRecentFile(filePath: string): void {
  recentFiles.value = recentFiles.value.filter((item) => item.path !== filePath);
}

/** 清空最近记录 */
export function clearRecentFiles(): void {
  recentFiles.value = [];
}

export default function useRecentFiles() {
  return {
    recentFiles,
    recordRecentFile,
    removeRecentFile,
    clearRecentFiles,
  };
}
