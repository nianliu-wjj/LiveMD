/**
 * 启动会话状态记录（"启动时打开"配置的数据源）
 *
 * - 实时记录当前打开的文件路径与工作区目录，而非在窗口关闭时才写入：
 *   saved 状态直接关闭不走 close:confirm 流程，关闭钩子不可靠；
 * - lastFile 仅记录真实文件（有 filePath），未保存的新文档不记录；
 * - 所有写入均 try/catch，localStorage 不可用时静默降级。
 */
import { watch } from "vue";
import useTab from "@/renderer/hooks/useTab";
import useWorkSpace from "@/renderer/hooks/useWorkSpace";

const LAST_FILE_KEY = "livemd-launch-last-file";
const LAST_WORKSPACE_KEY = "livemd-launch-last-workspace";

function readStoredPath(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeStoredPath(key: string, value: string): void {
  try {
    if (value) {
      localStorage.setItem(key, value);
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // localStorage 不可用时静默降级
  }
}

/** 上次关闭时打开的文件路径（未记录过则为空串） */
export function readLastOpenedFile(): string {
  return readStoredPath(LAST_FILE_KEY);
}

/** 上次打开的工作区目录（未记录过则为空串） */
export function readLastWorkspaceDir(): string {
  return readStoredPath(LAST_WORKSPACE_KEY);
}

/** 在 App 挂载后调用一次：实时跟踪当前文件与工作区并持久化 */
export function trackLaunchState(): void {
  const { currentTab, tabs } = useTab();
  const { watchedDirPath } = useWorkSpace();

  // 任一 Tab 的文件路径变化都刷新"上次文件"：取当前激活 Tab 的路径
  watch(
    () => currentTab.value?.filePath ?? "",
    (filePath) => {
      if (filePath) {
        writeStoredPath(LAST_FILE_KEY, filePath);
      }
    },
    { immediate: true }
  );

  // 关闭文件（Tab 全部关闭）时清除"上次文件"，避免下次启动恢复一个已关闭的文档
  watch(
    () => tabs.value.length,
    (count) => {
      if (count === 0) {
        writeStoredPath(LAST_FILE_KEY, "");
      }
    }
  );

  // 工作区目录变化时记录（不用 immediate：本仓库 watchedDirPath 初始为 null，
  // immediate 会在启动时把"上次工作区"记录先清空，随后 restoreLaunchSession 就读不到了；
  // 打开工作区/关闭工作区都是一次变化，非 immediate 的 watch 同样能覆盖记录时机）
  watch(watchedDirPath, (dirPath) => {
    writeStoredPath(LAST_WORKSPACE_KEY, dirPath ?? "");
  });
}
