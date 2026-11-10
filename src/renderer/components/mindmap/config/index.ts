/**
 * 思维导图编辑器配置统一出口
 *
 * - zh：各类下拉列表（中文）；
 * - constant：结构预览图、公式示例、连线风格支持表、彩虹线条配色；
 * - icon：节点扩展图标；
 * - image：节点贴纸图片库（按需加载）。
 */
export * from "./zh";
export * from "./constant";
export { default as extraIconList } from "./icon";
export { loadStickerGroups, type StickerGroup, type StickerItem } from "./image";
