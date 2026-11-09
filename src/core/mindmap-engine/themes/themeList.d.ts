import type { MindMapInstance } from "./full";

/** 主题列表项（移植自 simple-mind-map-plugin-themes） */
export interface MindMapThemeItem {
  name: string;
  value: string;
  dark: boolean;
  theme: Record<string, unknown>;
}

declare const themeList: MindMapThemeItem[];
export default themeList;

export type { MindMapInstance };
