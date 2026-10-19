/**
 * 批注 store hook（模块级单例）
 *
 * 分层与 useBookmarks 同构：本层负责 AnnotationMap 读写 + 防抖持久化 + 面板/激活态；
 * 持久化不进核心编辑器（编辑器核心无 localStorage 依赖，保持可独立测试）。
 *
 * 防抖持久化：编辑器在每次事务后上报最新锚点（annotationPositions），频率极高，
 * 写 localStorage 走 500ms 防抖；用户的显式 CRUD（新增/更新/删除）立即落盘。
 */

import { computed, readonly, ref, watch } from "vue";
import {
  ANNOTATIONS_STORAGE_KEY,
  addAnnotationToMap,
  annotationDocKey,
  parseAnnotations,
  removeAnnotationFromMap,
  serializeAnnotations,
  updateAnnotationInMap,
  type AnnotationAnchor,
  type AnnotationEntry,
  type AnnotationMap,
  type AnnotationPatch,
} from "@/shared/utils/annotations";
import useTab from "@/renderer/hooks/useTab";

function loadAnnotations(): AnnotationMap {
  try {
    return parseAnnotations(localStorage.getItem(ANNOTATIONS_STORAGE_KEY));
  } catch {
    return {};
  }
}

const annotationMap = ref<AnnotationMap>(loadAnnotations());

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function writeStorage(): void {
  try {
    localStorage.setItem(ANNOTATIONS_STORAGE_KEY, serializeAnnotations(annotationMap.value));
  } catch {
    // localStorage 不可用时只保留内存状态
  }
}

/** 锚点回写专用：500ms 防抖（每事务都触发，不能同步写） */
function schedulePersist(): void {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    writeStorage();
  }, 500);
}

function persistNow(): void {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  writeStorage();
}

// ============ 面板 / 激活态 ============

/** 批注栏展开状态（贴边收起 = false） */
const isBarVisible = ref(false);

/** 激活批注 id（点击高亮 / 新建 / 提交时设置，驱动卡片展开滚动） */
const activeAnnotationId = ref<string | null>(null);

/** 当前文档 key：由 useTab 的当前 tab 派生（文件用 file:{path}，未保存文档用 tab:{id}） */
const { currentTab } = useTab();
const currentDocKey = computed<string>(() => {
  const tab = currentTab.value;
  if (!tab) return "";
  return annotationDocKey(tab.filePath, tab.id);
});

/**
 * 未保存文档保存后迁移批注：tab:{id} → file:{path}
 *
 * 批注按 docKey 归档，而 docKey 由当前 tab 派生：保存成功会让键从 tab:{id} 变成 file:{path}。
 * 不迁移的话，保存前写的批注会滞留在旧键上变成孤儿（面板与编辑器都读不到）。
 * 仅在「旧键是 tab:、新键是 file:」时迁移，避免文件另存为等其它键变化误搬数据。
 */
watch(currentDocKey, (nextKey, previousKey) => {
  if (!previousKey || !nextKey || previousKey === nextKey) return;
  if (!previousKey.startsWith("tab:") || !nextKey.startsWith("file:")) return;

  const movedEntries = annotationMap.value[previousKey];
  if (!movedEntries || movedEntries.length === 0) return;

  const nextMap = { ...annotationMap.value, [nextKey]: movedEntries };
  delete nextMap[previousKey];
  annotationMap.value = nextMap;
  persistNow();
});

/** 当前文档的全部批注（含 editing，供对话框查询） */
const entries = computed<AnnotationEntry[]>(() => {
  const key = currentDocKey.value;
  if (!key) return [];
  return annotationMap.value[key] ?? [];
});

/** 当前文档已提交批注（批注栏列表只展示 done 态） */
const doneEntries = computed<AnnotationEntry[]>(() =>
  entries.value.filter((entry) => entry.state === "done")
);

function setBarVisible(visible: boolean): void {
  isBarVisible.value = visible;
}

function setActiveAnnotation(id: string | null): void {
  activeAnnotationId.value = id;
}

// ============ CRUD ============

function addEntry(docKey: string, entry: AnnotationEntry): void {
  annotationMap.value = addAnnotationToMap(annotationMap.value, docKey, entry);
  persistNow();
}

function updateEntry(docKey: string, id: string, patch: AnnotationPatch): void {
  annotationMap.value = updateAnnotationInMap(annotationMap.value, docKey, id, patch);
  persistNow();
}

function removeEntries(docKey: string, ids: string[]): void {
  let map = annotationMap.value;
  for (const id of ids) {
    map = removeAnnotationFromMap(map, docKey, id);
  }
  if (map !== annotationMap.value) {
    annotationMap.value = map;
    persistNow();
  }
}

/** 编辑器上报的最新锚点回写（位置对比后增量更新；持久化走防抖） */
function applyAnchors(
  docKey: string,
  positions: Array<{ id: string; anchor: AnnotationAnchor }>
): void {
  if (positions.length === 0) return;

  let map = annotationMap.value;
  for (const { id, anchor } of positions) {
    const existing = (map[docKey] ?? []).find((entry) => entry.id === id);
    if (!existing) continue;
    if (JSON.stringify(existing.anchor) === JSON.stringify(anchor)) continue;
    map = updateAnnotationInMap(map, docKey, id, { anchor }, Date.now());
  }
  if (map !== annotationMap.value) {
    annotationMap.value = map;
    schedulePersist();
  }
}

export default function useAnnotations() {
  return {
    annotationMap: readonly(annotationMap),
    entries,
    doneEntries,
    currentDocKey,
    barVisible: readonly(isBarVisible),
    activeAnnotationId: readonly(activeAnnotationId),
    setBarVisible,
    setActiveAnnotation,
    addEntry,
    updateEntry,
    removeEntries,
    applyAnchors,
  };
}
