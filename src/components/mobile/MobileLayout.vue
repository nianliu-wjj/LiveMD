<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import {
  ArrowDownUp,
  ArrowLeft,
  Bold,
  Bookmark,
  Check,
  CheckSquare2,
  ChevronDown,
  Code2,
  Eye,
  FileInput,
  FilePlus2,
  FileText,
  FolderOpen,
  Heading1,
  Heading2,
  Italic,
  List,
  ListOrdered,
  ListTree,
  MoreHorizontal,
  Quote,
  Redo2,
  Save,
  Search,
  Settings2,
  SquarePen,
  Strikethrough,
  Trash2,
  Undo2,
  User,
  WandSparkles,
  X,
} from "lucide-vue-next";
import useTab from "@/hooks/useTab";
import useReadOnlyMode from "@/hooks/useReadOnlyMode";
import useAnnotations from "@/hooks/useAnnotations";
import useMobileViewMode, { type MobileViewMode } from "@/hooks/useMobileViewMode";
import { useConfig } from "@/hooks/useConfig";
import { hideOtherEdgeBars, rightEdgeOpenWidth } from "@/utils/rightEdgeBars";
import { decodeMobileMarkdown, pickMobileMarkdown } from "@/service/mobileFile";
import {
  deleteMobileDocuments,
  ensureUniqueDocumentName,
  formatMobileDocumentDate,
  formatMobileDocumentSize,
  getRecentMobileDocuments,
  listMobileDocuments,
  readMobileDocument,
  recordMobileDocumentOpened,
  removeMobileDocumentRecents,
  sanitizeMobileDocumentName,
  saveMobileDocument,
  type MobileDocumentInfo,
  type RecentMobileDocument,
} from "@/service/mobileDocuments";
import MobileSettings from "./MobileSettings.vue";
import emitter from "@/events";

const props = defineProps<{ browsing: boolean }>();
const emit = defineEmits<{ (e: "browse", value: boolean): void }>();

const { tabs, currentTab, createNewTab, createTabFromFile, switchToTab } = useTab();
const { isReadOnlyMode, toggleReadOnlyMode } = useReadOnlyMode();
const { setBarVisible: setAnnotationsVisible } = useAnnotations();
const { mobileViewMode, mobileInstantRenderEnabled, setMobileViewMode } = useMobileViewMode();
const { config } = useConfig();

const isHtml = computed(() => currentTab.value?.kind === "html");
const reading = computed(() => isReadOnlyMode.value || Boolean(currentTab.value?.readOnly));
const activeViewMode = computed(() => mobileViewMode.value);
const splitActive = computed(
  () => !props.browsing && !reading.value && mobileViewMode.value === "split"
);

// ---------------------------------------------------------------------------
// 文件列表状态
// ---------------------------------------------------------------------------
const documents = ref<MobileDocumentInfo[]>([]);
const docsLoading = ref(false);
const docsError = ref("");
const recentEntries = ref<RecentMobileDocument[]>([]);
const query = ref("");
const sortMode = ref<"modified" | "name" | "size">("modified");
const sortMenu = ref(false);
const moreMenu = ref(false);
const selectionMenu = ref(false);
const selectionMode = ref(false);
const selectedNames = ref<string[]>([]);
const settings = ref(false);
const recentCollapsed = ref(false);
const toastMessage = ref("");

const selectedSet = computed(() => new Set(selectedNames.value));
const queryText = computed(() => query.value.trim().toLowerCase());
const sortLabel = computed(() =>
  sortMode.value === "name" ? "文件名" : sortMode.value === "size" ? "文件大小" : "最近修改"
);

function displayName(name: string | null | undefined): string {
  if (!name) return "未命名文档";
  return name.replace(/\.(md|markdown)$/i, "");
}

function metaFor(info: MobileDocumentInfo | undefined): string {
  if (!info) return "";
  return `${formatMobileDocumentDate(info.modifiedAt)} · ${formatMobileDocumentSize(info.size)}`;
}

function contentSize(content: string): number {
  try {
    return new TextEncoder().encode(content).length;
  } catch {
    return content.length;
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : JSON.stringify(error);
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;
function toast(message: string): void {
  toastMessage.value = message;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastMessage.value = "";
  }, 2200);
}

const visibleDocuments = computed(() => {
  let list = documents.value.slice();
  if (queryText.value) {
    list = list.filter((doc) => doc.name.toLowerCase().includes(queryText.value));
  }
  if (sortMode.value === "name") {
    list.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  } else if (sortMode.value === "size") {
    list.sort((a, b) => b.size - a.size);
  } else {
    list.sort((a, b) => b.modifiedAt - a.modifiedAt);
  }
  return list;
});

const groups = computed(() => {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86_400_000;
  const today: MobileDocumentInfo[] = [];
  const yesterday: MobileDocumentInfo[] = [];
  const earlier: MobileDocumentInfo[] = [];

  for (const doc of visibleDocuments.value) {
    if (doc.modifiedAt >= startOfToday) today.push(doc);
    else if (doc.modifiedAt >= startOfYesterday) yesterday.push(doc);
    else earlier.push(doc);
  }

  return [
    { key: "today", label: "今天", documents: today },
    { key: "yesterday", label: "昨天", documents: yesterday },
    { key: "earlier", label: "更早", documents: earlier },
  ].filter((group) => group.documents.length > 0);
});

interface ContinueItem {
  key: string;
  name?: string;
  tabId?: string;
  displayName: string;
  meta: string;
  unsaved: boolean;
}

const continueItems = computed<ContinueItem[]>(() => {
  const infoByName = new Map(documents.value.map((doc) => [doc.name, doc]));
  const seen = new Set<string>();
  const items: ContinueItem[] = [];
  const matchesQuery = (name: string) =>
    !queryText.value || name.toLowerCase().includes(queryText.value);

  for (const tab of tabs.value) {
    const name = tab.mobileDocName;
    if (!name) {
      if (!tab.isModified && !tab.content.trim()) continue;
      const label = tab.name || "未命名文档";
      if (!matchesQuery(label)) continue;
      items.push({
        key: `tab:${tab.id}`,
        tabId: tab.id,
        displayName: displayName(label),
        meta: `未保存 · ${formatMobileDocumentSize(contentSize(tab.content))}`,
        unsaved: true,
      });
      continue;
    }
    if (seen.has(name)) continue;
    seen.add(name);
    if (!matchesQuery(name)) continue;
    const info = infoByName.get(name);
    items.push({
      key: `doc:${name}`,
      name,
      tabId: tab.id,
      displayName: displayName(name),
      meta: tab.isModified
        ? `未保存的修改 · ${formatMobileDocumentSize(contentSize(tab.content))}`
        : metaFor(info) || "本地文档",
      unsaved: tab.isModified,
    });
  }

  for (const recent of recentEntries.value) {
    if (items.length >= 4) break;
    if (seen.has(recent.name)) continue;
    const info = infoByName.get(recent.name);
    if (!info) continue;
    if (!matchesQuery(recent.name)) continue;
    seen.add(recent.name);
    items.push({
      key: `doc:${recent.name}`,
      name: recent.name,
      displayName: displayName(recent.name),
      meta: metaFor(info),
      unsaved: false,
    });
  }

  return items.slice(0, 4);
});

// ---------------------------------------------------------------------------
// 文档库读写
// ---------------------------------------------------------------------------
async function refreshDocuments(showLoading = false): Promise<void> {
  if (showLoading) docsLoading.value = true;
  try {
    documents.value = await listMobileDocuments();
    docsError.value = "";
    recentEntries.value = getRecentMobileDocuments();
  } catch (error) {
    docsError.value = errorMessage(error);
  } finally {
    docsLoading.value = false;
  }
}

function upsertDocumentInfo(info: MobileDocumentInfo): void {
  const index = documents.value.findIndex((doc) => doc.name === info.name);
  if (index >= 0) documents.value[index] = info;
  else documents.value.push(info);
  recentEntries.value = getRecentMobileDocuments();
}

async function openDocument(name: string): Promise<void> {
  if (!name) return;
  const existingTab = tabs.value.find((tab) => tab.mobileDocName === name);
  if (existingTab) {
    await switchToTab(existingTab.id);
    recordMobileDocumentOpened(name);
    emit("browse", false);
    return;
  }

  try {
    const document = await readMobileDocument(name);
    if (!document) {
      toast("文档不存在或已被删除");
      await refreshDocuments();
      return;
    }
    const tab = await createTabFromFile(name, document.content, document.fileTraits, {
      readOnly: /\.(html|htm)$/i.test(name),
    });
    tab.filePath = null;
    tab.mobileDocName = name;
    tab.name = name;
    tab.originalContent = document.content;
    tab.isModified = false;
    tab.isNewlyLoaded = false;
    recordMobileDocumentOpened(name);
    await switchToTab(tab.id);
    emit("browse", false);
  } catch (error) {
    toast(`打开失败：${errorMessage(error)}`);
  }
}

async function openContinueItem(item: ContinueItem): Promise<void> {
  if (selectionMode.value) {
    if (item.name) toggleDocumentSelection(item.name);
    return;
  }
  if (item.tabId) {
    await switchToTab(item.tabId);
    if (item.name) recordMobileDocumentOpened(item.name);
    emit("browse", false);
    return;
  }
  if (item.name) await openDocument(item.name);
}

async function newDocument(): Promise<void> {
  moreMenu.value = false;
  closeMenus();
  selectionMode.value = false;
  selectedNames.value = [];
  const tab = createNewTab();
  tab.name = "未命名文档.md";
  tab.mobileDocName = undefined;
  tab.filePath = null;
  if (isReadOnlyMode.value) toggleReadOnlyMode(false);
  emit("browse", false);
}

async function openTemporaryFile(): Promise<void> {
  moreMenu.value = false;
  try {
    const file = await pickMobileMarkdown();
    if (!file) return;
    const decoded = decodeMobileMarkdown(
      file.name,
      new TextDecoder("utf-8", { ignoreBOM: true }).decode(await file.arrayBuffer())
    );
    const tab = await createTabFromFile(file.name, decoded.content, decoded.fileTraits, {
      readOnly: /\.(html|htm)$/i.test(file.name),
    });
    tab.filePath = null;
    tab.isModified = tab.kind !== "html";
    tab.isNewlyLoaded = false;
    await switchToTab(tab.id);
    emit("browse", false);
  } catch (error) {
    toast(`打开失败：${errorMessage(error)}`);
  }
}

async function importDocument(): Promise<void> {
  moreMenu.value = false;
  closeMenus();
  try {
    const file = await pickMobileMarkdown();
    if (!file) return;
    const decoded = decodeMobileMarkdown(
      file.name,
      new TextDecoder("utf-8", { ignoreBOM: true }).decode(await file.arrayBuffer())
    );
    const base = sanitizeMobileDocumentName(file.name);
    if (!base) {
      toast("文件名无效");
      return;
    }
    const name = ensureUniqueDocumentName(
      base,
      documents.value.map((doc) => doc.name)
    );
    await saveMobileDocument(name, decoded.content, decoded.fileTraits);
    recordMobileDocumentOpened(name);
    await refreshDocuments();
    await openDocument(name);
    toast("已导入到应用文档目录");
  } catch (error) {
    toast(`导入失败：${errorMessage(error)}`);
  }
}

// ---------------------------------------------------------------------------
// 保存
// ---------------------------------------------------------------------------
const saving = ref(false);
const nameDialogOpen = ref(false);
const nameInput = ref("");
const nameField = ref<HTMLInputElement | null>(null);
let nameDialogResolve: ((value: string | null) => void) | null = null;

const normalizedName = computed(() => sanitizeMobileDocumentName(nameInput.value));
const nameConflict = computed(() => {
  const name = normalizedName.value;
  if (!name) return false;
  return documents.value.some((doc) => doc.name.toLowerCase() === name.toLowerCase());
});

function promptDocumentName(suggested: string): Promise<string | null> {
  nameInput.value = suggested || "未命名文档.md";
  nameDialogOpen.value = true;
  void nextTick(() => {
    nameField.value?.focus();
    nameField.value?.select();
  });
  return new Promise((resolve) => {
    nameDialogResolve = resolve;
  });
}

function closeNameDialog(value: string | null): void {
  nameDialogOpen.value = false;
  const resolve = nameDialogResolve;
  nameDialogResolve = null;
  resolve?.(value);
}

function submitNameDialog(): void {
  const name = normalizedName.value;
  if (!name) return;
  closeNameDialog(name);
}

async function saveCurrentDocument(): Promise<void> {
  const tab = currentTab.value;
  if (!tab || tab.kind === "html" || tab.readOnly || saving.value) return;

  saving.value = true;
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  try {
    let name = tab.mobileDocName;
    if (!name) {
      const suggested = sanitizeMobileDocumentName(tab.name || "未命名文档.md") || "未命名文档.md";
      const picked = await promptDocumentName(suggested);
      if (!picked) return;
      name = picked;
    }

    const content = tab.content;
    const info = await saveMobileDocument(name, content, tab.fileTraits);
    tab.mobileDocName = name;
    tab.filePath = null;
    tab.name = name;
    tab.originalContent = content;
    tab.isModified = tab.content !== content;
    tab.isNewlyLoaded = false;
    recordMobileDocumentOpened(name);
    upsertDocumentInfo(info);
    toast("已保存到应用文档目录");
  } catch (error) {
    toast(`保存失败：${errorMessage(error)}`);
  } finally {
    saving.value = false;
  }
}

// 移动端文档不走 useTab 的自动保存（以 filePath 为门槛），这里按文件名防抖写盘
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
watch(
  () => [currentTab.value?.id, currentTab.value?.content, currentTab.value?.isModified] as const,
  () => {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    const tab = currentTab.value;
    if (
      !tab ||
      props.browsing ||
      reading.value ||
      !tab.mobileDocName ||
      !tab.isModified ||
      !config.value.other.autoSave
    ) {
      return;
    }
    autoSaveTimer = setTimeout(() => {
      void autoSaveMobileTab(tab.id);
    }, 1500);
  }
);

async function autoSaveMobileTab(tabId: string): Promise<void> {
  const tab = tabs.value.find((item) => item.id === tabId);
  if (
    !tab ||
    !tab.mobileDocName ||
    !tab.isModified ||
    tab.kind === "html" ||
    tab.readOnly ||
    !config.value.other.autoSave ||
    saving.value
  )
    return;
  const name = tab.mobileDocName;
  const content = tab.content;
  try {
    const info = await saveMobileDocument(name, content, tab.fileTraits);
    if (tab.content === content) {
      tab.originalContent = content;
      tab.isModified = false;
      tab.isNewlyLoaded = false;
    }
    upsertDocumentInfo(info);
  } catch {
    // 自动保存失败静默处理，用户手动保存时会看到错误提示
  }
}

// ---------------------------------------------------------------------------
// 排序 / 多选 / 删除
// ---------------------------------------------------------------------------
function closeMenus(): void {
  moreMenu.value = false;
  sortMenu.value = false;
  selectionMenu.value = false;
}

function setSort(mode: "modified" | "name" | "size"): void {
  sortMode.value = mode;
  sortMenu.value = false;
}

function enterSelection(): void {
  closeMenus();
  selectionMode.value = true;
  selectedNames.value = [];
}

function exitSelection(): void {
  closeMenus();
  selectionMode.value = false;
  selectedNames.value = [];
}

const allVisibleSelected = computed(
  () =>
    visibleDocuments.value.length > 0 &&
    visibleDocuments.value.every((doc) => selectedSet.value.has(doc.name))
);

function toggleSelectAll(): void {
  if (allVisibleSelected.value) selectedNames.value = [];
  else selectedNames.value = visibleDocuments.value.map((doc) => doc.name);
}

function toggleDocumentSelection(name: string): void {
  const next = new Set(selectedNames.value);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  selectedNames.value = [...next];
}

function onDocumentClick(name: string): void {
  if (selectionMode.value) toggleDocumentSelection(name);
  else void openDocument(name);
}

const deleteDialogOpen = ref(false);

function requestDelete(): void {
  selectionMenu.value = false;
  if (!selectedNames.value.length) return;
  deleteDialogOpen.value = true;
}

async function confirmDelete(): Promise<void> {
  deleteDialogOpen.value = false;
  const names = selectedNames.value.slice();
  if (!names.length) return;
  try {
    const deleted = await deleteMobileDocuments(names);
    removeMobileDocumentRecents(names);
    for (const name of names) {
      const tab = tabs.value.find((item) => item.mobileDocName === name);
      if (tab) {
        tab.mobileDocName = undefined;
        tab.filePath = null;
        tab.name = displayName(name);
      }
    }
    documents.value = documents.value.filter((doc) => !names.includes(doc.name));
    selectedNames.value = [];
    selectionMode.value = false;
    recentEntries.value = getRecentMobileDocuments();
    toast(`已删除 ${deleted} 个文档`);
    await refreshDocuments();
  } catch (error) {
    toast(`删除失败：${errorMessage(error)}`);
  }
}

watch(documents, (list) => {
  const names = new Set(list.map((doc) => doc.name));
  selectedNames.value = selectedNames.value.filter((name) => names.has(name));
});

// ---------------------------------------------------------------------------
// 编辑器视图模式 / 分屏预览
// ---------------------------------------------------------------------------
const previewHtml = ref("");
let previewTimer: ReturnType<typeof setTimeout> | null = null;
let previewSeq = 0;

function applyInstantRender(): void {
  if (!props.browsing) emitter.emit("instantRender:set", mobileInstantRenderEnabled.value);
}

function applySplitClass(): void {
  document.documentElement.classList.toggle("mobile-split-mode", splitActive.value);
  if (splitActive.value) schedulePreview();
}

function selectViewMode(mode: MobileViewMode): void {
  setMobileViewMode(mode);
  viewMenu.value = false;
  applyInstantRender();
  applySplitClass();
}

function schedulePreview(): void {
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    void renderPreview();
  }, 220);
}

async function renderPreview(): Promise<void> {
  if (!splitActive.value) return;
  const content = currentTab.value?.content ?? "";
  const seq = ++previewSeq;
  try {
    const { markdownToHtml } = await import("@/components/mindmap/utils");
    const html = await markdownToHtml(content);
    if (seq === previewSeq) previewHtml.value = html;
  } catch {
    if (seq === previewSeq) previewHtml.value = "<p>预览渲染失败</p>";
  }
}

watch(
  [mobileInstantRenderEnabled, () => currentTab.value?.id, reading],
  () => {
    void nextTick(() => {
      applyInstantRender();
      applySplitClass();
    });
  },
  { immediate: true }
);

watch(
  () => [splitActive.value, currentTab.value?.id, currentTab.value?.content] as const,
  () => {
    applySplitClass();
    if (splitActive.value) schedulePreview();
  }
);

// ---------------------------------------------------------------------------
// 编辑器交互
// ---------------------------------------------------------------------------
const keyboard = ref(false);
const viewMenu = ref(false);
const formatMore = ref(false);
const readingToolsOpen = ref(false);

watch([reading, () => props.browsing, () => currentTab.value?.id], () => {
  readingToolsOpen.value = false;
});

function toggleReadingTools(): void {
  readingToolsOpen.value = !readingToolsOpen.value;
  viewMenu.value = false;
  formatMore.value = false;
}

function toggleViewMenu(): void {
  viewMenu.value = !viewMenu.value;
  formatMore.value = false;
  readingToolsOpen.value = false;
}

function viewport(): void {
  const view = window.visualViewport;
  const bottom = view ? Math.max(0, window.innerHeight - view.height - view.offsetTop) : 0;
  keyboard.value = bottom > 120;
  document.documentElement.style.setProperty("--mobile-keyboard-offset", `${bottom}px`);
}

function command(id: string): void {
  if (props.browsing || reading.value) return;
  emitter.emit("editor:command", { id });
  formatMore.value = false;
}

function toggleEditing(): void {
  if (currentTab.value?.readOnly) return;
  readingToolsOpen.value = false;
  if (reading.value) {
    toggleReadOnlyMode(false);
    applyInstantRender();
    return;
  }
  toggleReadOnlyMode(true);
  (document.activeElement as HTMLElement | null)?.blur();
  viewMenu.value = false;
  formatMore.value = false;
}

function openOutline(): void {
  readingToolsOpen.value = false;
  viewMenu.value = false;
  (document.activeElement as HTMLElement | null)?.blur();
  emitter.emit("outline:show-bar");
}

function openBookmarks(): void {
  readingToolsOpen.value = false;
  viewMenu.value = false;
  (document.activeElement as HTMLElement | null)?.blur();
  emitter.emit("bookmarks:show-bar");
}

function openAnnotations(): void {
  readingToolsOpen.value = false;
  viewMenu.value = false;
  (document.activeElement as HTMLElement | null)?.blur();
  hideOtherEdgeBars("annotations");
  setAnnotationsVisible(true);
}

function closeEdgeBars(): void {
  emitter.emit("outline:hide-bar");
  emitter.emit("bookmarks:hide-bar");
  emitter.emit("annotations:hide-bar");
}

function backToFiles(): void {
  (document.activeElement as HTMLElement | null)?.blur();
  closeMenus();
  viewMenu.value = false;
  formatMore.value = false;
  closeEdgeBars();
  emit("browse", true);
}

function openSettings(): void {
  readingToolsOpen.value = false;
  closeMenus();
  viewMenu.value = false;
  formatMore.value = false;
  closeEdgeBars();
  settings.value = true;
}

function navFiles(): void {
  settings.value = false;
  closeMenus();
  closeEdgeBars();
  emit("browse", true);
}

function navBookmarks(): void {
  settings.value = false;
  closeMenus();
  (document.activeElement as HTMLElement | null)?.blur();
  emitter.emit("bookmarks:show-bar");
}

const navVisible = computed(() => (props.browsing || settings.value) && !selectionMode.value);
const navActive = computed(() => (settings.value ? "me" : "files"));

const wordCountText = computed(() => {
  const text = currentTab.value?.content ?? "";
  return `${text.replace(/\s+/g, "").length.toLocaleString("zh-CN")} 字`;
});

const documentTitle = computed(() =>
  displayName(currentTab.value?.mobileDocName || currentTab.value?.name)
);

const viewOptions = [
  {
    id: "instant" as const,
    label: "即时渲染",
    desc: "显示光标附近的源码标记",
    icon: WandSparkles,
  },
  {
    id: "split" as const,
    label: "分屏预览",
    desc: "左编辑 · 右预览",
    icon: ListTree,
  },
  {
    id: "wysiwyg" as const,
    label: "所见即所得",
    desc: "隐藏 Markdown 标记，专注排版",
    icon: Eye,
  },
];

// ---------------------------------------------------------------------------
// 生命周期
// ---------------------------------------------------------------------------
watch(
  () => props.browsing,
  (browsing) => {
    closeMenus();
    if (browsing) {
      viewMenu.value = false;
      formatMore.value = false;
      recentEntries.value = getRecentMobileDocuments();
      void refreshDocuments();
    } else {
      applyInstantRender();
      applySplitClass();
    }
  }
);

watch(reading, (value) => {
  document.documentElement.classList.toggle("mobile-reading", value);
  if (value) {
    formatMore.value = false;
    viewMenu.value = false;
  }
  applySplitClass();
  if (!value) applyInstantRender();
});

watch(settings, (value) => {
  if (value) closeMenus();
});

onMounted(() => {
  document.documentElement.classList.add("mobile-layout");
  document.documentElement.classList.toggle("mobile-reading", reading.value);
  applySplitClass();
  window.visualViewport?.addEventListener("resize", viewport);
  window.visualViewport?.addEventListener("scroll", viewport);
  viewport();
  void refreshDocuments(true);
  applyInstantRender();
});

onUnmounted(() => {
  document.documentElement.classList.remove("mobile-layout", "mobile-reading", "mobile-split-mode");
  document.documentElement.style.removeProperty("--mobile-keyboard-offset");
  window.visualViewport?.removeEventListener("resize", viewport);
  window.visualViewport?.removeEventListener("scroll", viewport);
  if (toastTimer) clearTimeout(toastTimer);
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  if (previewTimer) clearTimeout(previewTimer);
});
</script>

<template>
  <!-- ===================== 文件列表 ===================== -->
  <template v-if="browsing">
    <header class="m-files-header">
      <div v-if="!selectionMode" class="m-title-row">
        <h1>文件</h1>
        <span class="m-space-pill"><FolderOpen :size="14" />全部</span>
        <div class="m-header-actions">
          <button
            type="button"
            class="m-icon-button"
            :title="`排序：${sortLabel}`"
            :aria-expanded="sortMenu"
            @click="
              sortMenu = !sortMenu;
              moreMenu = false;
            "
          >
            <ArrowDownUp :size="20" />
          </button>
          <button
            type="button"
            class="m-icon-button m-icon-button--circle"
            title="更多"
            :aria-expanded="moreMenu"
            @click="
              moreMenu = !moreMenu;
              sortMenu = false;
            "
          >
            <MoreHorizontal :size="22" />
          </button>
        </div>
      </div>

      <div v-else class="m-title-row m-selection-bar">
        <strong class="m-selection-count">已选 {{ selectedNames.length }} 项</strong>
        <div class="m-selection-actions">
          <button type="button" @click="exitSelection">取消</button>
          <button type="button" @click="toggleSelectAll">
            {{ allVisibleSelected ? "取消全选" : "全选" }}
          </button>
          <button
            type="button"
            class="m-icon-button m-icon-button--circle"
            title="多选操作"
            :aria-expanded="selectionMenu"
            @click="selectionMenu = !selectionMenu"
          >
            <MoreHorizontal :size="22" />
          </button>
        </div>
      </div>

      <label v-if="!selectionMode" class="m-search">
        <Search :size="18" />
        <input
          v-model="query"
          type="search"
          inputmode="search"
          placeholder="搜索文件名"
          aria-label="搜索文件名"
        />
        <button v-if="query" type="button" aria-label="清空搜索" @click="query = ''">
          <X :size="16" />
        </button>
      </label>
    </header>

    <main class="m-files-scroll">
      <div v-if="docsLoading && documents.length === 0" class="m-docs-loading">正在加载文档…</div>

      <section v-if="continueItems.length && !selectionMode" class="m-doc-section">
        <button
          type="button"
          class="m-section-title"
          :aria-expanded="!recentCollapsed"
          @click="recentCollapsed = !recentCollapsed"
        >
          <span>接续阅读</span>
          <ChevronDown :size="16" :class="{ 'is-collapsed': recentCollapsed }" />
        </button>
        <div v-show="!recentCollapsed">
          <button
            v-for="item in continueItems"
            :key="item.key"
            type="button"
            class="m-doc-card m-doc-card--recent"
            @click="openContinueItem(item)"
          >
            <span class="m-doc-icon"><FileText :size="21" /></span>
            <span class="m-doc-body">
              <span class="m-doc-title">{{ item.displayName }}</span>
              <span class="m-doc-meta">
                <span>{{ item.unsaved ? "未保存" : "本地文档" }}</span>
                <span>{{ item.meta }}</span>
              </span>
            </span>
            <span class="m-doc-open"><FileText :size="19" /></span>
          </button>
        </div>
      </section>

      <section v-for="group in groups" :key="group.key" class="m-doc-section m-doc-section--dated">
        <h2 class="m-section-title">{{ group.label }}</h2>
        <button
          v-for="doc in group.documents"
          :key="doc.name"
          type="button"
          class="m-doc-card"
          :class="{
            'is-selected': selectedSet.has(doc.name),
            'is-selecting': selectionMode,
          }"
          @click="onDocumentClick(doc.name)"
        >
          <span
            v-if="selectionMode"
            class="m-select-circle"
            :class="{ checked: selectedSet.has(doc.name) }"
          >
            <Check v-if="selectedSet.has(doc.name)" :size="14" :stroke-width="3" />
          </span>
          <span v-else class="m-doc-icon"><FileText :size="21" /></span>
          <span class="m-doc-body">
            <span class="m-doc-title">{{ displayName(doc.name) }}</span>
            <span class="m-doc-meta">
              <span>本地文档</span>
              <span>{{ metaFor(doc) }}</span>
            </span>
          </span>
          <span v-if="!selectionMode" class="m-doc-open"><FileText :size="19" /></span>
        </button>
      </section>

      <div v-if="!docsLoading && !visibleDocuments.length" class="m-empty">
        <span class="m-empty-icon"><FileText :size="34" /></span>
        <h2>{{ query ? "没有找到文档" : "还没有文档" }}</h2>
        <p>{{ query ? "换个关键词试试" : "新建 Markdown 文档，或从设备导入已有文件" }}</p>
        <div v-if="!query" class="m-empty-actions">
          <button type="button" class="primary" @click="newDocument">
            <FilePlus2 :size="18" />新建 md
          </button>
          <button type="button" @click="importDocument"><FileInput :size="18" />导入文件</button>
        </div>
      </div>

      <p v-if="docsError" class="m-docs-error">{{ docsError }}</p>
    </main>

    <!-- 排序菜单 -->
    <div v-if="sortMenu" class="m-popover m-sort-menu">
      <p class="m-popover-title">排序方式</p>
      <button type="button" @click="setSort('modified')">
        <span>最近修改</span><Check v-if="sortMode === 'modified'" :size="16" />
      </button>
      <button type="button" @click="setSort('name')">
        <span>文件名称</span><Check v-if="sortMode === 'name'" :size="16" />
      </button>
      <button type="button" @click="setSort('size')">
        <span>文件大小</span><Check v-if="sortMode === 'size'" :size="16" />
      </button>
    </div>

    <!-- 文件操作菜单 -->
    <div v-if="moreMenu" class="m-popover m-action-menu">
      <button type="button" @click="newDocument"><FilePlus2 :size="20" />新建 md</button>
      <button type="button" @click="openTemporaryFile"><FolderOpen :size="20" />打开文件</button>
      <button type="button" @click="importDocument"><FileInput :size="20" />导入文件</button>
      <button type="button" @click="enterSelection"><CheckSquare2 :size="20" />选择</button>
    </div>

    <!-- 多选操作菜单 -->
    <div v-if="selectionMenu" class="m-popover m-action-menu m-selection-menu">
      <button type="button" class="danger" :disabled="!selectedNames.length" @click="requestDelete">
        <Trash2 :size="20" />删除{{ selectedNames.length ? ` (${selectedNames.length})` : "" }}
      </button>
    </div>

    <div v-if="sortMenu || moreMenu || selectionMenu" class="m-menu-backdrop" @click="closeMenus" />
  </template>

  <!-- ===================== 编辑器顶栏 ===================== -->
  <header v-else class="m-editor-header">
    <button type="button" class="m-back" aria-label="返回文件列表" @click="backToFiles">
      <ArrowLeft :size="22" />
    </button>
    <span class="m-editor-title">{{ documentTitle }}</span>
    <span v-if="!isHtml" class="m-word-count">{{ wordCountText }}</span>
    <button
      type="button"
      v-if="!isHtml"
      class="m-save"
      :class="{ 'is-dirty': currentTab?.isModified }"
      :disabled="saving || Boolean(currentTab?.readOnly)"
      aria-label="保存文件"
      title="保存到应用文档目录"
      @click="saveCurrentDocument"
    >
      <Save :size="23" />
      <span v-if="currentTab?.isModified" class="m-save-dot" />
    </button>
  </header>

  <!-- ===================== 编辑器浮动工具 ===================== -->
  <template v-if="!browsing">
    <!-- 左侧竖排工具 -->
    <nav
      class="m-editor-rail"
      :class="{
        'is-keyboard': keyboard,
        'is-reading': reading,
        'is-collapsed': reading && !readingToolsOpen,
      }"
      v-if="!isHtml"
      :aria-label="reading ? '阅读工具' : '编辑器工具'"
    >
      <button
        v-if="reading"
        type="button"
        class="m-reading-toggle"
        :aria-label="readingToolsOpen ? '收起阅读工具' : '展开阅读工具'"
        :title="readingToolsOpen ? '收起阅读工具' : '展开阅读工具'"
        :aria-expanded="readingToolsOpen"
        @click="toggleReadingTools"
      >
        <ChevronDown v-if="readingToolsOpen" :size="20" />
        <WandSparkles v-else :size="22" />
      </button>
      <template v-if="!reading || readingToolsOpen">
        <button
          type="button"
          :class="{ active: viewMenu }"
          aria-label="视图模式"
          title="视图模式"
          @click="toggleViewMenu"
        >
          <WandSparkles :size="20" />
        </button>
        <button
          type="button"
          :disabled="Boolean(currentTab?.readOnly)"
          :aria-label="reading ? '开始编辑' : '进入阅读模式'"
          :title="reading ? '开始编辑' : '进入阅读模式'"
          @click="toggleEditing"
        >
          <SquarePen v-if="reading" :size="20" />
          <Eye v-else :size="20" />
        </button>
        <span class="m-rail-divider" />
        <button type="button" aria-label="大纲" title="大纲" @click="openOutline">
          <ListTree :size="20" />
        </button>
        <button type="button" aria-label="书签" title="书签" @click="openBookmarks">
          <Bookmark :size="20" />
        </button>
        <button type="button" aria-label="批注" title="批注" @click="openAnnotations">
          <SquarePen :size="20" />
        </button>
        <button type="button" aria-label="设置" title="设置" @click="openSettings">
          <Settings2 :size="20" />
        </button>
      </template>
    </nav>

    <!-- 视图模式菜单 -->
    <div v-if="viewMenu" class="m-view-menu">
      <p class="m-view-menu__title">视图模式</p>
      <button
        v-for="option in viewOptions"
        :key="option.id"
        type="button"
        class="m-view-option"
        :class="{ active: activeViewMode === option.id }"
        @click="selectViewMode(option.id)"
      >
        <span class="m-view-option__icon"><component :is="option.icon" :size="20" /></span>
        <span class="m-view-option__text">
          <strong>{{ option.label }}</strong>
          <small>{{ option.desc }}</small>
        </span>
        <Check v-if="activeViewMode === option.id" class="m-view-check" :size="18" />
      </button>
    </div>
    <div v-if="viewMenu" class="m-menu-backdrop" @click="viewMenu = false" />

    <!-- 键盘上方格式胶囊 -->
    <div v-if="!reading && !splitActive" class="m-format-dock" @pointerdown.prevent>
      <button type="button" class="m-format-round" aria-label="大纲" @click="openOutline">
        <ListTree :size="21" />
      </button>
      <div class="m-format-pill">
        <button type="button" aria-label="撤销" @click="command('undo')">
          <Undo2 :size="19" />
        </button>
        <button type="button" aria-label="重做" @click="command('redo')">
          <Redo2 :size="19" />
        </button>
        <span class="m-format-sep" />
        <button type="button" aria-label="加粗" @click="command('toggleStrong')">
          <Bold :size="19" />
        </button>
        <button type="button" aria-label="斜体" @click="command('toggleEmphasis')">
          <Italic :size="19" />
        </button>
        <button type="button" aria-label="删除线" @click="command('toggleStrikethrough')">
          <Strikethrough :size="19" />
        </button>
        <span class="m-format-sep" />
        <button type="button" aria-label="标题" @click="command('setHeading2')">
          <Heading2 :size="20" />
        </button>
        <button type="button" aria-label="无序列表" @click="command('wrapInBulletList')">
          <List :size="20" />
        </button>
        <button
          type="button"
          :class="{ active: formatMore }"
          aria-label="更多格式"
          @click="formatMore = !formatMore"
        >
          <MoreHorizontal :size="20" />
        </button>
      </div>

      <div v-if="formatMore" class="m-format-more">
        <button type="button" @click="command('setHeading1')"><Heading1 :size="18" />H1</button>
        <button type="button" @click="command('setHeading2')"><Heading2 :size="18" />H2</button>
        <button type="button" @click="command('setHeading3')">H3</button>
        <button type="button" @click="command('setParagraph')">正文</button>
        <button type="button" @click="command('toggleHighlight')">高亮</button>
        <button type="button" @click="command('toggleCodeInline')"><Code2 :size="18" />行内</button>
        <button type="button" @click="command('wrapInOrderedList')">
          <ListOrdered :size="18" />有序
        </button>
        <button type="button" @click="command('wrapInBlockquote')"><Quote :size="18" />引用</button>
        <button type="button" @click="command('setCodeBlock')">代码块</button>
      </div>
    </div>

    <!-- 分屏预览 -->
    <aside v-if="splitActive" class="m-split-preview" aria-label="文档预览">
      <header>
        <span>预览</span>
        <button type="button" aria-label="关闭分屏预览" @click="selectViewMode('instant')">
          <X :size="18" />
        </button>
      </header>
      <div class="m-split-preview__body" v-html="previewHtml" />
    </aside>
  </template>

  <!-- ===================== 底部导航 ===================== -->
  <nav v-if="navVisible" class="m-nav" :class="{ 'm-nav--raised': settings }" aria-label="移动导航">
    <button type="button" :class="{ active: navActive === 'files' }" @click="navFiles">
      <FolderOpen :size="22" /><small>文件</small>
    </button>
    <button type="button" @click="navBookmarks"><Bookmark :size="22" /><small>书签</small></button>
    <button type="button" :class="{ active: navActive === 'me' }" @click="openSettings">
      <User :size="22" /><small>我的</small>
    </button>
  </nav>

  <MobileSettings v-if="settings" @close="settings = false" />

  <button
    v-if="rightEdgeOpenWidth > 0"
    type="button"
    class="m-sheet-backdrop"
    aria-label="关闭面板"
    @click="closeEdgeBars"
  />

  <!-- ===================== 弹层 ===================== -->
  <div v-if="nameDialogOpen" class="m-modal-backdrop" @click.self="closeNameDialog(null)">
    <form
      class="m-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="m-save-title"
      @submit.prevent="submitNameDialog"
    >
      <h2 id="m-save-title">保存文档</h2>
      <p class="m-modal-desc">保存到应用文档目录，下次打开即可继续编辑。</p>
      <label class="m-name-field">
        <input
          ref="nameField"
          v-model="nameInput"
          type="text"
          placeholder="文件名"
          aria-label="文件名"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          @keydown.esc="closeNameDialog(null)"
        />
      </label>
      <p class="m-name-preview">{{ normalizedName || "请输入文件名" }}</p>
      <p v-if="nameConflict" class="m-name-warn">同名文档已存在，保存将覆盖原文件</p>
      <div class="m-modal-actions">
        <button type="button" @click="closeNameDialog(null)">取消</button>
        <button type="submit" class="primary" :disabled="!normalizedName">
          {{ nameConflict ? "覆盖保存" : "保存" }}
        </button>
      </div>
    </form>
  </div>

  <div v-if="deleteDialogOpen" class="m-modal-backdrop" @click.self="deleteDialogOpen = false">
    <div class="m-modal" role="dialog" aria-modal="true" aria-labelledby="m-delete-title">
      <h2 id="m-delete-title">删除文档</h2>
      <p class="m-modal-desc">已选择 {{ selectedNames.length }} 个文档，删除后不可恢复。</p>
      <div class="m-modal-actions">
        <button type="button" @click="deleteDialogOpen = false">取消</button>
        <button type="button" class="danger" @click="confirmDelete">删除</button>
      </div>
    </div>
  </div>

  <div v-if="toastMessage" class="m-toast" role="status">{{ toastMessage }}</div>
</template>

<style scoped lang="less">
/* ===================== 通用 ===================== */
button {
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

button:disabled {
  opacity: 0.45;
  cursor: default;
}

.m-icon-button {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 12px;
  color: var(--text-color-2);
}

.m-icon-button--circle {
  border: 1px solid var(--border-color-1);
  border-radius: 50%;
  background: color-mix(in srgb, var(--background-color-2) 80%, transparent);
}

.m-title-row h1 {
  margin: 0;
  font-size: 34px;
  line-height: 1.15;
  font-weight: 700;
  letter-spacing: -0.6px;
}

/* ===================== 文件页 ===================== */
.m-files-header {
  flex-shrink: 0;
  padding: calc(env(safe-area-inset-top, 0px) + 14px) 16px 0;
  background: var(--background-color-1);
}

.m-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 46px;
}

.m-space-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--background-color-2) 85%, transparent);
  border: 1px solid var(--border-color-1);
  color: var(--text-color-3);
  font-size: 11.5px;
  white-space: nowrap;
}

.m-header-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.m-search {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  margin: 14px 0 4px;
  padding: 0 12px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--background-color-2) 82%, transparent);
  border: 1px solid var(--border-color-1);
  color: var(--text-color-3);

  input {
    flex: 1;
    min-width: 0;
    height: 100%;
    border: 0;
    background: transparent;
    color: var(--text-color);
    font-size: 15px;
    outline: none;
  }

  input::placeholder {
    color: var(--text-color-3);
  }

  button {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    color: var(--text-color-3);
  }
}

.m-selection-bar {
  justify-content: space-between;
}

.m-selection-count {
  font-size: 17px;
  font-weight: 600;
}

.m-selection-actions {
  display: flex;
  align-items: center;
  gap: 14px;

  > button:not(.m-icon-button) {
    color: var(--primary-color);
    font-size: 14px;
    padding: 8px 0;
  }
}

.m-files-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 8px 16px calc(env(safe-area-inset-bottom, 0px) + 116px);
  background: var(--background-color-1);
}

.m-docs-loading {
  padding: 40px 0;
  text-align: center;
  color: var(--text-color-3);
  font-size: 13px;
}

.m-doc-section {
  margin-top: 10px;
}

.m-doc-section--dated {
  margin-top: 20px;
}

.m-section-title {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  margin: 0 2px 9px;
  padding: 0;
  background: transparent;
  color: var(--text-color-3);
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.2px;
  text-align: left;

  svg {
    transition: transform 0.18s ease;
  }

  svg.is-collapsed {
    transform: rotate(-90deg);
  }
}

.m-doc-card {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 76px;
  margin-bottom: 10px;
  padding: 13px 14px;
  border-radius: 18px;
  border: 1px solid var(--border-color-1);
  background: color-mix(in srgb, var(--background-color-2) 82%, transparent);
  text-align: left;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.m-doc-card:active {
  background: color-mix(in srgb, var(--background-color-2) 70%, var(--primary-color) 8%);
}

.m-doc-card.is-selected {
  border-color: color-mix(in srgb, var(--primary-color) 55%, transparent);
  background: color-mix(in srgb, var(--primary-color) 10%, var(--background-color-2));
}

.m-doc-icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border-radius: 13px;
  background: color-mix(in srgb, var(--primary-color) 13%, transparent);
  color: var(--primary-color);
}

.m-doc-body {
  flex: 1;
  min-width: 0;
}

.m-doc-title {
  display: block;
  overflow: hidden;
  color: var(--text-color);
  font-size: 15.5px;
  font-weight: 600;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.m-doc-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 6px;
  color: var(--text-color-3);
  font-size: 11.5px;
  line-height: 1.2;
}

.m-doc-meta span:last-child {
  flex-shrink: 0;
}

.m-doc-open {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 30px;
  color: color-mix(in srgb, var(--primary-color) 72%, var(--text-color-3));
  opacity: 0.9;
}

.m-select-circle {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--text-color-3) 55%, transparent);
  color: #fff;
}

.m-select-circle.checked {
  border-color: var(--primary-color);
  background: var(--primary-color);
}

.m-doc-card.is-selecting {
  padding-left: 12px;
}

.m-empty {
  padding: 18vh 20px 0;
  text-align: center;
  color: var(--text-color-3);
}

.m-empty-icon {
  display: grid;
  place-items: center;
  width: 70px;
  height: 70px;
  margin: 0 auto 16px;
  border-radius: 22px;
  background: color-mix(in srgb, var(--primary-color) 12%, transparent);
  color: var(--primary-color);
}

.m-empty h2 {
  margin: 0 0 6px;
  color: var(--text-color);
  font-size: 18px;
}

.m-empty p {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
}

.m-empty-actions {
  display: flex;
  justify-content: center;
  gap: 10px;
  margin-top: 20px;

  button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 10px 16px;
    border-radius: 13px;
    border: 1px solid var(--border-color-1);
    background: var(--background-color-2);
    color: var(--text-color-2);
    font-size: 13px;
  }

  button.primary {
    border-color: transparent;
    background: var(--primary-color);
    color: #fff;
  }
}

.m-docs-error {
  padding: 16px 0;
  color: var(--text-color-3);
  font-size: 12px;
  text-align: center;
}

/* ===================== 菜单 / 弹层 ===================== */
.m-sheet-backdrop {
  position: fixed;
  inset: 0;
  z-index: 149;
  background: rgba(0, 0, 0, 0.46);
}

.m-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 41;
  background: transparent;
}

.m-popover {
  position: fixed;
  top: calc(env(safe-area-inset-top, 0px) + 64px);
  right: 14px;
  z-index: 42;
  min-width: 176px;
  padding: 6px;
  border-radius: 16px;
  border: 1px solid var(--border-color-1);
  background: color-mix(in srgb, var(--background-color-2) 96%, transparent);
  box-shadow: 0 16px 44px #0004;
  backdrop-filter: blur(18px);
}

.m-sort-menu {
  right: 60px;
}

.m-popover-title {
  margin: 4px 10px 6px;
  color: var(--text-color-3);
  font-size: 11px;
}

.m-popover button {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 44px;
  padding: 0 12px;
  border-radius: 11px;
  color: var(--text-color-2);
  font-size: 14px;
  text-align: left;

  span {
    flex: 1;
  }

  svg:last-child {
    color: var(--primary-color);
  }
}

.m-popover button:active {
  background: var(--background-color-1);
}

.m-popover button.danger {
  color: #e05a5a;
}

.m-action-menu button {
  font-size: 14.5px;
}

.m-selection-menu {
  top: calc(env(safe-area-inset-top, 0px) + 64px);
}

.m-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(2px);
}

.m-modal {
  width: min(100%, 360px);
  padding: 22px;
  border-radius: 22px;
  border: 1px solid var(--border-color-1);
  background: var(--background-color-2);
  box-shadow: 0 24px 70px #0005;
}

.m-modal h2 {
  margin: 0 0 8px;
  font-size: 19px;
}

.m-modal-desc {
  margin: 0 0 16px;
  color: var(--text-color-3);
  font-size: 12.5px;
  line-height: 1.6;
}

.m-name-field input {
  width: 100%;
  height: 46px;
  padding: 0 13px;
  border-radius: 13px;
  border: 1px solid var(--border-color-1);
  background: var(--background-color-1);
  color: var(--text-color);
  font-size: 16px;
  outline: none;
}

.m-name-field input:focus {
  border-color: var(--primary-color);
}

.m-name-preview {
  margin: 8px 2px 0;
  color: var(--text-color-3);
  font-size: 11.5px;
  overflow-wrap: anywhere;
}

.m-name-warn {
  margin: 8px 2px 0;
  color: #e0a24a;
  font-size: 11.5px;
  line-height: 1.5;
}

.m-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;

  button {
    min-width: 82px;
    min-height: 42px;
    padding: 0 16px;
    border-radius: 12px;
    border: 1px solid var(--border-color-1);
    background: var(--background-color-1);
    color: var(--text-color-2);
    font-size: 14px;
  }

  button.primary {
    border-color: transparent;
    background: var(--primary-color);
    color: #fff;
  }

  button.danger {
    border-color: transparent;
    background: #d85050;
    color: #fff;
  }
}

.m-toast {
  position: fixed;
  left: 50%;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 96px);
  z-index: 220;
  transform: translateX(-50%);
  max-width: calc(100vw - 48px);
  padding: 10px 16px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text-color) 88%, transparent);
  color: var(--background-color-1);
  font-size: 12.5px;
  line-height: 1.4;
  text-align: center;
  box-shadow: 0 10px 30px #0004;
}

/* ===================== 编辑器顶栏 ===================== */
.m-editor-header {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 8px;
  height: calc(env(safe-area-inset-top, 0px) + 56px);
  padding: env(safe-area-inset-top, 0px) 10px 0;
  background: var(--background-color-1);
}

.m-back,
.m-save {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  color: var(--text-color-2);
}

.m-back:active,
.m-save:active {
  background: var(--background-color-2);
}

.m-editor-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 16px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.m-word-count {
  flex-shrink: 0;
  color: var(--text-color-3);
  font-size: 11.5px;
  white-space: nowrap;
}

.m-save {
  position: relative;
  color: var(--primary-color);
}

.m-save:disabled {
  opacity: 0.5;
}

.m-save-dot {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #e0a24a;
}

/* ===================== 编辑器浮动工具 ===================== */
.m-editor-rail {
  position: fixed;
  left: calc(env(safe-area-inset-left, 0px) + 8px);
  bottom: calc(env(safe-area-inset-bottom, 0px) + 88px);
  z-index: 28;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px;
  border-radius: 999px;
  border: 1px solid var(--border-color-1);
  background: color-mix(in srgb, var(--background-color-2) 82%, transparent);
  box-shadow: 0 8px 30px #0003;
  backdrop-filter: blur(18px);
}

.m-editor-rail.is-reading {
  bottom: calc(env(safe-area-inset-bottom, 0px) + 20px);
}

.m-editor-rail.is-collapsed {
  padding: 0;
  border-radius: 50%;

  .m-reading-toggle {
    width: 50px;
    height: 50px;
  }
}

.m-editor-rail.is-keyboard {
  display: none;
}

.m-editor-rail button {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  color: var(--text-color-2);
  transition:
    color 0.15s ease,
    background 0.15s ease;
}

.m-editor-rail button:active,
.m-editor-rail button.active {
  color: var(--primary-color);
  background: color-mix(in srgb, var(--primary-color) 13%, transparent);
}

.m-rail-divider {
  width: 20px;
  height: 1px;
  margin: 3px 0;
  background: var(--border-color-1);
}

.m-format-dock {
  position: fixed;
  left: 50%;
  bottom: calc(var(--mobile-keyboard-offset, 0px) + env(safe-area-inset-bottom, 0px) + 10px);
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: calc(100vw - 16px);
  transform: translateX(-50%);
  transition: bottom 0.18s ease;
}

.m-format-round {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1px solid var(--border-color-1);
  background: color-mix(in srgb, var(--background-color-2) 86%, transparent);
  color: var(--text-color-2);
  box-shadow: 0 6px 22px #0003;
  backdrop-filter: blur(16px);
}

.m-format-round:active {
  color: var(--primary-color);
}

.m-format-pill {
  position: relative;
  display: flex;
  align-items: center;
  gap: 1px;
  max-width: 100%;
  padding: 4px 6px;
  overflow-x: auto;
  border-radius: 999px;
  border: 1px solid var(--border-color-1);
  background: color-mix(in srgb, var(--background-color-2) 88%, transparent);
  box-shadow: 0 8px 28px #0003;
  backdrop-filter: blur(18px);
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }

  > button {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 34px;
    height: 36px;
    border-radius: 50%;
    color: var(--text-color-2);
  }

  > button:active,
  > button.active {
    color: var(--primary-color);
    background: color-mix(in srgb, var(--primary-color) 12%, transparent);
  }
}

.m-format-sep {
  flex-shrink: 0;
  width: 1px;
  height: 18px;
  margin: 0 2px;
  background: var(--border-color-1);
}

.m-format-more {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 8px);
  z-index: 31;
  display: flex;
  align-items: center;
  gap: 2px;
  max-width: calc(100vw - 24px);
  padding: 5px 6px;
  overflow-x: auto;
  border-radius: 999px;
  border: 1px solid var(--border-color-1);
  background: color-mix(in srgb, var(--background-color-2) 94%, transparent);
  box-shadow: 0 12px 34px #0004;
  transform: translateX(-50%);
  backdrop-filter: blur(18px);
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }

  button {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    min-width: 42px;
    height: 34px;
    padding: 0 10px;
    border-radius: 999px;
    color: var(--text-color-2);
    font-size: 12.5px;
    white-space: nowrap;
  }

  button:active {
    color: var(--primary-color);
    background: color-mix(in srgb, var(--primary-color) 12%, transparent);
  }
}

/* ===================== 视图模式菜单 ===================== */
.m-view-menu {
  position: fixed;
  left: calc(env(safe-area-inset-left, 0px) + 56px);
  bottom: calc(env(safe-area-inset-bottom, 0px) + 150px);
  z-index: 46;
  width: min(304px, calc(100vw - 76px));
  padding: 10px;
  border-radius: 20px;
  border: 1px solid var(--border-color-1);
  background: color-mix(in srgb, var(--background-color-2) 96%, transparent);
  box-shadow: 0 18px 54px #0005;
  backdrop-filter: blur(20px);
}

.m-view-menu__title {
  margin: 3px 10px 8px;
  color: var(--text-color-3);
  font-size: 11.5px;
}

.m-view-option {
  display: flex;
  align-items: center;
  gap: 11px;
  width: 100%;
  padding: 9px;
  border-radius: 14px;
  border: 1px solid transparent;
  text-align: left;
}

.m-view-option.active {
  border-color: color-mix(in srgb, var(--primary-color) 55%, transparent);
  background: color-mix(in srgb, var(--primary-color) 8%, transparent);
}

.m-view-option__icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  border-radius: 12px;
  background: var(--background-color-1);
  color: var(--primary-color);
}

.m-view-option__text {
  flex: 1;
  min-width: 0;

  strong {
    display: block;
    font-size: 13.5px;
    font-weight: 600;
  }

  small {
    display: block;
    margin-top: 2px;
    overflow: hidden;
    color: var(--text-color-3);
    font-size: 10.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.m-view-check {
  flex-shrink: 0;
  color: var(--primary-color);
}

/* ===================== 分屏预览 ===================== */
.m-split-preview {
  position: fixed;
  top: calc(env(safe-area-inset-top, 0px) + 56px);
  right: 0;
  bottom: var(--mobile-keyboard-offset, 0px);
  z-index: 26;
  display: flex;
  flex-direction: column;
  width: 50vw;
  border-left: 1px solid var(--border-color-1);
  background: var(--background-color-1);

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
    height: 42px;
    padding: 0 10px 0 14px;
    color: var(--text-color-3);
    font-size: 12px;
    border-bottom: 1px solid var(--border-color-1);
  }

  header button {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    color: var(--text-color-3);
  }
}

.m-split-preview__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 14px 40px;
  color: var(--text-color);
  font-size: 14px;
  line-height: 1.75;
  user-select: text;
  -webkit-user-select: text;

  :deep(h1),
  :deep(h2),
  :deep(h3),
  :deep(h4) {
    line-height: 1.35;
    margin: 1em 0 0.5em;
  }

  :deep(h1) {
    font-size: 1.5em;
  }

  :deep(h2) {
    font-size: 1.32em;
  }

  :deep(h3) {
    font-size: 1.18em;
  }

  :deep(p) {
    margin: 0.6em 0;
  }

  :deep(ul),
  :deep(ol) {
    padding-left: 1.3em;
  }

  :deep(blockquote) {
    margin: 0.8em 0;
    padding: 4px 12px;
    border-left: 3px solid var(--primary-color);
    color: var(--text-color-2);
  }

  :deep(code) {
    padding: 1px 5px;
    border-radius: 5px;
    background: var(--background-color-2);
    font-size: 0.92em;
  }

  :deep(pre) {
    padding: 10px;
    overflow-x: auto;
    border-radius: 10px;
    background: var(--background-color-2);
  }

  :deep(pre code) {
    padding: 0;
    background: transparent;
  }

  :deep(a) {
    color: var(--primary-color);
  }

  :deep(img) {
    max-width: 100%;
  }

  :deep(hr) {
    border: 0;
    border-top: 1px solid var(--border-color-1);
  }
}

/* ===================== 底部导航 ===================== */
.m-nav {
  position: fixed;
  left: 50%;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 14px);
  z-index: 32;
  display: flex;
  align-items: center;
  justify-content: space-around;
  width: min(78vw, 360px);
  height: 62px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid var(--border-color-1);
  background: color-mix(in srgb, var(--background-color-2) 88%, transparent);
  box-shadow: 0 12px 40px #0004;
  transform: translateX(-50%);
  backdrop-filter: blur(22px);

  button {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    min-width: 72px;
    height: 48px;
    border-radius: 16px;
    color: var(--text-color-3);
  }

  button.active {
    color: var(--primary-color);
  }

  small {
    font-size: 10.5px;
    line-height: 1;
  }
}

.m-nav--raised {
  z-index: 120;
}

@media (prefers-reduced-motion: no-preference) {
  .m-nav,
  .m-format-dock {
    animation: m-fade-up 0.18s ease;
  }

  .m-view-menu,
  .m-popover {
    animation: m-fade-in 0.16s ease;
  }
}

@keyframes m-fade-up {
  from {
    opacity: 0;
    transform: translate(-50%, 6px);
  }
  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
}

@keyframes m-fade-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
