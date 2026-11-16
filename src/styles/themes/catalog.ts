import catalog from "./builtin-themes.json";
import type { Theme } from "../types/theme";

export const DEFAULT_THEME = "normal";
export const DEFAULT_DARK_THEME = "normal-dark";
export const builtinThemes: Theme[] = catalog;
/** 旧主题名 → 新主题名映射；当前命名一致，留作未来重命名时登记 */
export const legacyThemeNames: Record<string, string> = {};

export function migrateThemeName(name: string): string {
  return legacyThemeNames[name] || name;
}
