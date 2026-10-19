/**
 * 折叠状态 Store（模块级单例）
 *
 * 薄封装 `renderer/utils/foldStates.ts`：让组件以 hook 形式取用，
 * 并保持「同一份持久化数据在多个编辑器实例间共享」的语义。
 */
import {
  clearFoldStates,
  getFoldForDoc,
  migrateFoldDocKey,
  setFoldForDoc,
} from "@/renderer/utils/foldStates";

export default function useFoldStates() {
  return {
    /** 读取某文档的折叠块索引 */
    getFoldForDoc,
    /** 写入某文档的折叠块索引（空数组即删除记录） */
    setFoldForDoc,
    /** 未保存文档保存后迁移记录：tab:<id> → file:<path> */
    migrateFoldDocKey,
    /** 清空全部折叠记录 */
    clearFoldStates,
  };
}
