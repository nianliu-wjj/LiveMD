export const STANDALONE_SIDEBAR_CONTEXT = "__standalone__";

const SIDEBAR_VISIBILITY_STORAGE_PREFIX = "livemd-sidebar-visibility:";

type SidebarVisibilityStorage = Pick<Storage, "getItem" | "setItem">;

export function getSidebarContextKey(pathValue?: string | null): string {
  const value = pathValue?.trim();
  if (!value) return STANDALONE_SIDEBAR_CONTEXT;

  const isWindowsPath = /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\");
  let normalized = value.replace(/[\\/]+$/, "");
  if (!normalized) return "/";
  if (/^[a-zA-Z]:$/.test(normalized)) normalized += "/";

  return isWindowsPath ? normalized.replace(/\\/g, "/").toLowerCase() : normalized;
}

export function resolveSidebarVisibility(
  savedVisibility: unknown,
  fallbackVisibility: boolean
): boolean {
  return typeof savedVisibility === "boolean" ? savedVisibility : fallbackVisibility;
}

export function readSidebarVisibility(
  contextKey: string,
  storage: SidebarVisibilityStorage = localStorage
): boolean | undefined {
  const value = storage.getItem(
    `${SIDEBAR_VISIBILITY_STORAGE_PREFIX}${encodeURIComponent(contextKey)}`
  );
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

export function writeSidebarVisibility(
  contextKey: string,
  visible: boolean,
  storage: SidebarVisibilityStorage = localStorage
): void {
  storage.setItem(
    `${SIDEBAR_VISIBILITY_STORAGE_PREFIX}${encodeURIComponent(contextKey)}`,
    String(visible)
  );
}
