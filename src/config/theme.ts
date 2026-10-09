import { builtinThemes } from "../themes/catalog";

/** 按 slug 提供展示元数据；由主题目录（catalog）派生，新增主题无需在此登记 */
export const themeNameMap: Record<string, { label: string; description: string }> =
  Object.fromEntries(
    builtinThemes.map(({ name, label, description }) => [name, { label, description }])
  );

export const cssVarsDesMap: {
  app: Record<string, string>;
  editor: Record<string, string>;
} = {
  // 应用主题css变量
  app: {
    "--primary-color": "主色",
    "--secondary-color": "次色",
    "--background-color": "背景色",
    "--background-color-1": "背景色1",
    "--background-color-2": "背景色2",
    "--background-color-3": "背景色3",
    "--text-color": "文字色",
    "--text-color-1": "文字色1",
    "--text-color-2": "文字色2",
    "--text-color-3": "文字色3",
    "--placeholder-color": "占位符色",
    "--border-color": "边框色",
    "--border-color-1": "边框色1",
    "--border-color-2": "边框色2",
    "--hover-color": "悬停色",
    "--hover-background-color": "悬停背景色",
    "--active-color": "激活色",
    "--active-line-color": "激活线色",
    "--selected-color": "选中色",
    "--selected-background-color": "选中背景色",
    "--primary-color-transparent": "主色透明",
  },

  // 编辑器css变量
  editor: {
    "--crepe-color-background": "背景色",
    "--crepe-color-on-background": "背景色",
    "--crepe-color-surface": "表面色",
    "--crepe-color-surface-low": "表面低色",
    "--crepe-color-on-surface": "表面色",
    "--crepe-color-on-surface-variant": "表面变体色",
    "--crepe-color-outline": "轮廓色",
    "--crepe-color-primary": "主色",
    "--crepe-color-secondary": "次色",
    "--crepe-color-on-secondary": "次色",
    "--crepe-color-inverse": "反色",
    "--crepe-color-on-inverse": "反色",
    "--crepe-color-inline-code": "内联代码色",
    "--crepe-color-error": "错误色",
    "--crepe-color-hover": "悬停色",
    "--crepe-color-selected": "选中色",
    "--crepe-color-inline-area": "内联区域色",
  },
};
