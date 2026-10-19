/**
 * Markdown 表格格式化（渲染层入口）
 *
 * 实现已下沉到 core（`src/core/utils/table-format.ts`），供内核的表格工具栏
 * 「格式化表格代码」与渲染层的命令面板共用；此文件保留原有导入路径不变。
 *
 * 注意：这里必须用相对路径 + .ts 扩展名转发——`@/` 别名只由 Vite/tsconfig 解析，
 * Node 的单元测试（node --test + strip-types）不认别名。
 */
export { formatMarkdownTables } from "../../core/utils/table-format.ts";
