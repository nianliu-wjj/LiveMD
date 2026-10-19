/**
 * 折叠状态持久化（渲染层）
 *
 * core 层不知道文件路径，因此折叠索引由编辑器 emit `foldChange` 回传后，
 * 这里按「文档键」写入 localStorage：已保存文档用文件路径，未保存文档用 tab id。
 * 键格式与既有实现保持一致（键名 livemd-fold-states，值为 { [docKey]: number[] }）。
 */

const FOLD_STATES_STORAGE_KEY = "livemd-fold-states";

/** 文档键 → 折叠块索引 */
export type FoldStateMap = Record<string, number[]>;

/** 读取全部折叠记录（脏数据一律丢弃，保证调用方拿到干净结构） */
export function readFoldStateMap(): FoldStateMap {
  try {
    const raw = localStorage.getItem(FOLD_STATES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const result: FoldStateMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!Array.isArray(value)) continue;
      const indices = value.filter(
        (item): item is number => typeof item === "number" && Number.isInteger(item) && item >= 0
      );
      if (indices.length > 0) result[key] = indices;
    }
    return result;
  } catch {
    return {};
  }
}

/** 读取某个文档的折叠索引（无记录返回空数组） */
export function getFoldForDoc(docKey: string): number[] {
  if (!docKey) return [];
  return readFoldStateMap()[docKey] ?? [];
}

/**
 * 写入某个文档的折叠索引
 *
 * 索引为空时删除该文档记录，避免 localStorage 无限增长。
 */
export function setFoldForDoc(docKey: string, indices: number[]): void {
  if (!docKey) return;
  try {
    const map = readFoldStateMap();
    if (indices.length === 0) {
      delete map[docKey];
    } else {
      map[docKey] = [...new Set(indices)].sort((a, b) => a - b);
    }
    localStorage.setItem(FOLD_STATES_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // localStorage 不可用时静默降级（折叠仍在当前会话生效）
  }
}

/**
 * 文档键迁移：未保存文档保存后 `tab:<id>` → `file:<path>`
 *
 * 避免同一份文档在保存后丢失折叠状态。
 */
export function migrateFoldDocKey(fromKey: string, toKey: string): void {
  if (!fromKey || !toKey || fromKey === toKey) return;
  const indices = getFoldForDoc(fromKey);
  if (indices.length === 0) return;

  setFoldForDoc(toKey, indices);
  setFoldForDoc(fromKey, []);
}

/** 清空全部折叠记录（设置页「重置」入口备用） */
export function clearFoldStates(): void {
  try {
    localStorage.removeItem(FOLD_STATES_STORAGE_KEY);
  } catch {
    // 忽略失败
  }
}
