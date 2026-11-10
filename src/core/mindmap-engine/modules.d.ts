/**
 * 引擎内部 JS 模块的类型兜底：编辑器组件直接引用引擎内部工具 / 常量 / 插件时（与参考项目一致，
 * 如 `@/core/mindmap-engine/src/utils/index.js`），以简写环境模块声明统一按 any 处理，避免 TS7016。
 * 公共入口 full.js 有精确声明（full.d.ts），优先使用。
 */
declare module "@/core/mindmap-engine/src/*";
declare module "@/core/mindmap-engine/themes/index.js";
