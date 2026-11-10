<script setup lang="ts">
import emitter from "@/renderer/events";
import { useContext } from "@/renderer/hooks/useContext";
import { useConfig } from "@/renderer/hooks/useConfig";
import useFont from "@/renderer/hooks/useFont";
import useOtherConfig from "@/renderer/hooks/useOtherConfig";
import useHeadingAlign from "@/renderer/hooks/useHeadingAlign";
import { isShowOutline, toggleShowOutline } from "@/renderer/hooks/useOutline";
import { useSaveConfirmDialog } from "@/renderer/hooks/useSaveConfirmDialog";
import {
  createSidebarWidthController,
  SIDEBAR_DEFAULT_CSS,
} from "@/renderer/hooks/useSidebarWidth";
import useSourceCode from "@/renderer/hooks/useSourceCode";
import useSpellCheck from "@/renderer/hooks/useSpellCheck";
import useTab from "@/renderer/hooks/useTab";
import useTheme from "@/renderer/hooks/useTheme";
import useUiLoading from "@/renderer/hooks/useUiLoading";
import { useUpdateDialog } from "@/renderer/hooks/useUpdateDialog";
import { closeQuickOpen, isQuickOpenVisible, toggleQuickOpen } from "@/renderer/hooks/useQuickOpen";
import {
  closeWorkspaceSearch,
  isWorkspaceSearchVisible,
  toggleWorkspaceSearch,
} from "@/renderer/hooks/useWorkspaceSearch";
import useDocumentLint from "@/renderer/hooks/useDocumentLint";
import useWorkSpace from "@/renderer/hooks/useWorkSpace";
import type { FormatIssue } from "@/renderer/utils/documentLint";
import { shouldAutoLoadWorkspace } from "@/renderer/utils/workspacePath";
import { isMindMapEditorOpen } from "@/renderer/utils/mindmapEditorState";
import { getSidebarContextKey, writeSidebarVisibility } from "@/renderer/utils/sidebarVisibility";
import SaveConfirmDialog from "./components/dialogs/SaveConfirmDialog.vue";
import UpdateConfirmDialog from "./components/dialogs/UpdateConfirmDialog.vue";
import LivemdEditor from "./components/editor/LivemdEditor.vue";
import StatusBar from "./components/menu/StatusBar.vue";
import TitleBar from "./components/menu/TitleBar.vue";
import Outline from "./components/outline/Outline.vue";
import OutlineBar from "./components/outline/OutlineBar.vue";
import BookmarkBar from "./components/outline/BookmarkBar.vue";
import AnnotationBar from "./components/annotations/AnnotationBar.vue";
import AnnotationEditorDialog from "./components/annotations/AnnotationEditorDialog.vue";
import CommandPalette from "./components/palette/CommandPalette.vue";
import WorkspaceSearchPanel from "./components/search/WorkspaceSearchPanel.vue";
import HomePage from "./components/home/HomePage.vue";
import LintResultPanel from "./components/lint/LintResultPanel.vue";
import LoadingIcon from "./components/ui/LoadingIcon.vue";
import {
  readLastOpenedFile,
  readLastWorkspaceDir,
  trackLaunchState,
} from "@/renderer/hooks/useLaunchState";

// ✅ 应用级事件协调器（仅负责事件监听和协调）
useContext();

// ✅ 直接使用各个hooks（而不是通过useContext转发）
const { init: initTheme } = useTheme();
const { isLoading, loadingMessage } = useUiLoading();
const { init: initFont } = useFont();
const { init: initOtherConfig } = useOtherConfig();
// 标题对齐：模块内 watch(immediate) 在启动时即把已保存的对齐方式写入 CSS 变量
useHeadingAlign();
const { config, setConf } = useConfig();
const { openWorkSpaceByPath, watchedDirPath } = useWorkSpace();
const { isShowSource } = useSourceCode(); // 用于控制大纲显示
const { init: initSpellCheck } = useSpellCheck();
const {
  currentTab,
  tabs,
  activeTabId,
  close,
  saveCurrentTab,
  cleanupTabLocalImages,
  getUnsavedTabs,
  switchToTab,
  openFile,
  updateCurrentTabContent,
} = useTab();
const {
  currentResult,
  currentError: currentLintError,
  isLintRunning,
  isLintPanelVisible,
  closeLintPanel,
  scheduleAutoCheck,
  applyIssueFix,
  applyAllFixableFixes,
} = useDocumentLint();
const {
  isDialogVisible,
  dialogType,
  fileName,
  tabName,
  handleSave,
  handleDiscard,
  handleCancel,
  handleOverwrite,
  showDialog,
} = useSaveConfirmDialog();
const {
  isDialogVisible: isUpdateDialogVisible,
  updateStatus,
  downloadProgress,
  handleIgnore,
  handleUpdate,
  handleMinimize,
  handleRestore,
  handleCancel: handleUpdateCancel,
  showDialog: showUpdateDialog,
} = useUpdateDialog();

// 编辑器类型：'milkdown' | 'livemd'
// 监听主进程的关闭确认事件
window.electronAPI.on("close:confirm", async () => {
  await handleSafeClose("close");
});

// 监听Tab关闭确认事件
const handleTabCloseConfirm = async (payload: any) => {
  const { tabId, tabName, resolver } = payload;
  const result = await showDialog(tabName);
  let closed = false;

  if (result === "save") {
    const targetTab = tabs.value.find((tab) => tab.id === tabId);
    if (targetTab && activeTabId.value !== tabId) {
      await switchToTab(tabId);
      await nextTick();
    }
    // 只有保存并成功才关闭
    const saved = await saveCurrentTab();
    if (saved) {
      close(tabId);
      closed = true;
    }
  } else if (result === "discard") {
    // 放弃更改，直接关闭
    await cleanupTabLocalImages(tabs.value.find((tab) => tab.id === tabId));
    close(tabId);
    closed = true;
  }
  // cancel 则不做任何操作
  resolver?.(closed);
};
emitter.on("tab:close-confirm", handleTabCloseConfirm);

const onUpdateAvailable = (payload: any) => {
  const info = payload || {};

  localStorage.setItem("updateInfo", JSON.stringify(info));
  const ignoredVersion = localStorage.getItem("ignoredVersion");

  if (ignoredVersion !== info.version) {
    showUpdateDialog();
  }
};

// 监听主进程的更新可用事件 (Auto Update)
window.electronAPI.on("update:available", onUpdateAvailable);

// 监听手动检查的更新可用事件 (Manual Check from About)
import { onMounted, onUnmounted, ref, watch, nextTick, computed } from "vue";

// 大纲侧边栏两阶段动画状态机
// closed: 隐藏 | opening: transform 滑入动画 | open: flex 正常布局 | closing-prep: 切回 transform 定位 | closing: transform 滑出动画
type OutlineState = "closed" | "opening" | "open" | "closing-prep" | "closing";
const initialSidebarContextKey = getSidebarContextKey(
  watchedDirPath.value ?? config.value.workspace?.startupPath
);
let activeSidebarContextKey = initialSidebarContextKey;
// 启动一律折叠（首页需求）：不读取上次的展开状态，只保留 autoExpandSidebar 这一显式开关；
// 会话内用户手动展开/收起仍按工作区写入 localStorage，不覆盖既有偏好。
const initialOutlineVisible = Boolean(config.value.workspace?.autoExpandSidebar);
toggleShowOutline(initialOutlineVisible);
const outlineState = ref<OutlineState>(initialOutlineVisible ? "open" : "closed");
const editorAreaRef = ref<HTMLElement | null>(null);

const sidebarWidthController = createSidebarWidthController({
  getContainerWidth: () => editorAreaRef.value?.getBoundingClientRect().width ?? 0,
  getPreferredWidth: () => config.value.workspace?.sidebarWidth,
  setPreferredWidth: (width) => {
    setConf("workspace", {
      ...config.value.workspace,
      sidebarWidth: width,
    });
  },
});
const savedSidebarWidth = config.value.workspace?.sidebarWidth;
const sidebarWidth = ref<number | null>(
  typeof savedSidebarWidth === "number" && Number.isFinite(savedSidebarWidth)
    ? savedSidebarWidth
    : null
);
const sidebarResizing = ref(false);
const editorAreaStyle = computed(() => ({
  "--sidebar-width": sidebarWidth.value === null ? SIDEBAR_DEFAULT_CSS : `${sidebarWidth.value}px`,
}));

function syncSidebarWidth() {
  if (!sidebarResizing.value) {
    sidebarWidth.value = sidebarWidthController.refresh();
  }
}

function addSidebarResizeListeners() {
  window.addEventListener("pointermove", moveSidebarResize);
  window.addEventListener("pointerup", finishSidebarResize);
  window.addEventListener("pointercancel", finishSidebarResize);
  window.addEventListener("blur", finishSidebarResize);
}

function removeSidebarResizeListeners() {
  window.removeEventListener("pointermove", moveSidebarResize);
  window.removeEventListener("pointerup", finishSidebarResize);
  window.removeEventListener("pointercancel", finishSidebarResize);
  window.removeEventListener("blur", finishSidebarResize);
}

function startSidebarResize(event: PointerEvent) {
  if (event.button !== 0) return;
  event.preventDefault();
  const handle = event.currentTarget as HTMLElement | null;
  try {
    handle?.setPointerCapture(event.pointerId);
  } catch {
    // Window-level listeners remain the fallback when pointer capture is unavailable.
  }
  sidebarWidthController.beginResize(event.clientX);
  sidebarResizing.value = true;
  sidebarWidth.value = sidebarWidthController.getWidth();
  addSidebarResizeListeners();
}

function moveSidebarResize(event: PointerEvent) {
  if (!sidebarResizing.value) return;
  event.preventDefault();
  sidebarWidth.value = sidebarWidthController.resizeTo(event.clientX);
}

function finishSidebarResize() {
  if (!sidebarResizing.value) return;
  sidebarResizing.value = false;
  sidebarWidthController.endResize();
  sidebarWidth.value = sidebarWidthController.getWidth();
  removeSidebarResizeListeners();
}

const outlineClass = computed(() => `outline-${outlineState.value}`);

watch(
  isShowOutline,
  (visible) => {
    writeSidebarVisibility(activeSidebarContextKey, visible);
  },
  { flush: "sync" }
);

// 启动恢复会话期间为 true：此时打开的工作区属于「恢复」而非用户主动打开，保持启动折叠的约定
let isRestoringLaunchSession = false;

// ✅ 切换可见性写入的上下文键（§7）：打开工作区不应把用户手动展开的侧边栏关掉。
// 用户主动打开/切换到新工作区时自动展开左侧文件树，让用户直观看到文件夹里的文档。
watch(watchedDirPath, (workspacePath, prevWorkspacePath) => {
  const nextSidebarContextKey = getSidebarContextKey(workspacePath);
  if (workspacePath && workspacePath !== prevWorkspacePath && !isRestoringLaunchSession) {
    console.info("[App] 打开新工作区，自动展开左侧边栏:", workspacePath);
    // 先切换上下文键，展开状态写入新工作区对应的偏好
    activeSidebarContextKey = nextSidebarContextKey;
    toggleShowOutline(true);
    return;
  }
  if (nextSidebarContextKey === activeSidebarContextKey) return;
  activeSidebarContextKey = nextSidebarContextKey;
});

watch(isShowOutline, async (val) => {
  if (val) {
    outlineState.value = "opening";
  } else {
    // 先瞬间切回 transform 定位（视觉位置不变，无动画）
    outlineState.value = "closing-prep";
    await nextTick();
    editorAreaRef.value?.offsetHeight; // 强制浏览器应用样式
    outlineState.value = "closing";
  }
});

function onOutlineTransitionEnd(e: TransitionEvent) {
  if (e.propertyName !== "transform") return;
  if (outlineState.value === "opening") {
    outlineState.value = "open"; // 切换到 flex 布局，内容正常排版
  } else if (outlineState.value === "closing") {
    outlineState.value = "closed";
  }
}

// 快速打开 / 命令面板 / 工作区搜索全局快捷键
function handleGlobalKeydown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing) return;
  // 思维导图全屏编辑器打开时，全局快捷键不作用于被遮住的文档
  if (isMindMapEditorOpen()) return;

  const mod = event.ctrlKey || event.metaKey;
  if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "k") {
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea")) return;
    event.preventDefault();
    emitter.emit("editor:insert-link");
    return;
  }

  if (mod && event.key.toLowerCase() === "p" && !event.altKey) {
    event.preventDefault();
    closeWorkspaceSearch();
    toggleQuickOpen(event.shiftKey ? "commands" : "files");
    return;
  }

  if (mod && event.shiftKey && event.key.toLowerCase() === "f") {
    event.preventDefault();
    closeQuickOpen();
    toggleWorkspaceSearch();
    return;
  }

  if (event.key === "Escape") {
    if (isQuickOpenVisible.value) closeQuickOpen();
    if (isWorkspaceSearchVisible.value) closeWorkspaceSearch();
  }
}

/**
 * 启动时按 launchMode 恢复上次会话（文件路径均先校验存在再打开，§6.3）
 */
async function restoreLaunchSession(): Promise<void> {
  const launchMode = config.value.workspace?.launchMode ?? "new";

  if (launchMode === "new") return;

  isRestoringLaunchSession = true;
  try {
    await restoreLaunchSessionByMode(launchMode);
  } finally {
    // watchedDirPath 的 watch 默认 pre flush：等本轮回调执行完再解除恢复标记
    await nextTick();
    isRestoringLaunchSession = false;
  }
}

async function restoreLaunchSessionByMode(
  launchMode: NonNullable<typeof config.value.workspace>["launchMode"]
): Promise<void> {
  // fixed 模式：打开固定工作区（沿用 startupPath）
  if (launchMode === "fixed") {
    const startupPath = config.value.workspace?.startupPath;
    if (startupPath && shouldAutoLoadWorkspace(startupPath)) {
      const exists = await window.electronAPI.workspaceExists(startupPath);
      if (exists) {
        await openWorkSpaceByPath(startupPath);
      }
    }
    return;
  }

  // lastFile / lastSession 模式：先恢复工作区目录，再恢复文件
  const lastFile = readLastOpenedFile();
  const lastWorkspaceDir =
    launchMode === "lastSession" ? readLastWorkspaceDir() : dirnameOf(lastFile);

  if (lastWorkspaceDir && shouldAutoLoadWorkspace(lastWorkspaceDir)) {
    const exists = await window.electronAPI.workspaceExists(lastWorkspaceDir);
    if (exists) {
      await openWorkSpaceByPath(lastWorkspaceDir);
    }
  }

  // 两种模式都在内容区恢复上次打开的文件（lastSession：文件随文件夹一起恢复）
  if (lastFile) {
    const exists = await window.electronAPI.workspaceExists(lastFile);
    if (exists) {
      await openFile(lastFile);
    }
  }
}

/** 取路径中的目录部分（无目录分隔符时返回空串） */
function dirnameOf(filePath: string): string {
  const normalized = filePath.replace(/[/\\]+$/, "");
  const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return index > 0 ? normalized.slice(0, index) : "";
}

onMounted(() => {
  window.addEventListener("keydown", handleGlobalKeydown);
  void nextTick().then(syncSidebarWidth);
  initTheme();
  initFont();
  initOtherConfig();
  initSpellCheck();
  trackLaunchState();
  void restoreLaunchSession();
  emitter.on("update:available", onUpdateAvailable);
  emitter.on("workspace:open-path", handleWorkspaceOpenPath);
});
watch(
  () => config.value.workspace?.sidebarWidth,
  () => syncSidebarWidth()
);

// 内容变化触发防抖重查（600ms）：面板关闭时也重查，保持状态栏问题数实时
watch(
  () => currentTab.value?.content,
  () => scheduleAutoCheck()
);

onUnmounted(() => {
  window.removeEventListener("keydown", handleGlobalKeydown);
  emitter.off("update:available", onUpdateAvailable);
  emitter.off("workspace:open-path", handleWorkspaceOpenPath);
  emitter.off("tab:close-confirm", handleTabCloseConfirm);
  removeSidebarResizeListeners();
});

// Reuse safe close logic
/** 结果面板「定位」：把行号交给活跃编辑器换算为文档位置 */
function handleLintReveal(line: number): void {
  emitter.emit("lint:reveal-line", line);
}

/** 结果面板「修复」：修复单条并写回当前标签页（标记为已修改，可撤销） */
function handleLintFix(issue: FormatIssue): void {
  const content = currentTab.value?.content ?? "";
  updateCurrentTabContent(applyIssueFix(content, issue), true);
}

/** 结果面板「全部修复」 */
function handleLintFixAll(): void {
  const content = currentTab.value?.content ?? "";
  updateCurrentTabContent(applyAllFixableFixes(content), true);
}

/** 新窗口（「在新窗口打开」）要求把指定目录设为工作区 */
function handleWorkspaceOpenPath(dirPath: string): void {
  void openWorkSpaceByPath(dirPath);
}

async function handleSafeClose(action: "close" | "update") {
  const unsavedTabs = getUnsavedTabs();
  if (unsavedTabs.length === 0) {
    if (action === "update") {
      await window.electronAPI.quitAndInstall();
    } else {
      window.electronAPI.closeDiscard();
    }
    return;
  }

  for (const tab of unsavedTabs) {
    // 切换到该tab以便用户查看
    await switchToTab(tab.id);

    // 弹出保存确认框
    const result = await showDialog(tab.name);

    if (result === "cancel") {
      // 用户取消关闭操作，中止后续流程
      return;
    }

    if (result === "save") {
      const saved = await saveCurrentTab();
      if (!saved) {
        // 保存失败，中止关闭
        return;
      }
    } else {
      await cleanupTabLocalImages(tab);
    }
  }

  // 所有此轮检查都通过（保存或丢弃），强制关闭/更新
  if (action === "update") {
    window.electronAPI.quitAndInstall();
  } else {
    window.electronAPI.closeDiscard();
  }
}

// Overwrite handleUpdateInstall to check for unsaved changes
const handleInstall = async () => {
  await handleSafeClose("update");
};
</script>

<template>
  <TitleBar />
  <div id="fontRoot">
    <!-- ✅ 多编辑器实例：每个 tab 拥有独立的编辑器，v-show 保持 DOM 存活 -->
    <div ref="editorAreaRef" class="editorArea" :class="outlineClass" :style="editorAreaStyle">
      <div class="outlineBox">
        <Outline />
        <div class="sidebar-resize-handle" @pointerdown="startSidebarResize" />
      </div>
      <div class="editorBox" @transitionend="onOutlineTransitionEnd">
        <!-- 无打开标签页时：内容区展示首页（新建 / 打开 / 最近文件 / 快捷键） -->
        <HomePage v-if="tabs.length === 0" />

        <!-- Livemd 编辑器（每个 tab 独立实例） -->
        <LivemdEditor
          v-for="tab in tabs"
          :key="tab.id"
          v-show="tab.id === activeTabId"
          :tab="tab"
          :is-active="tab.id === activeTabId"
        />
      </div>
    </div>
  </div>
  <!-- 右缘三栏：大纲 / 批注 / 书签（贴边悬浮，与 StatusBar 平级不占布局流） -->
  <OutlineBar />
  <AnnotationBar />
  <BookmarkBar />
  <AnnotationEditorDialog />
  <StatusBar
    :content="currentTab?.content ?? ''"
    :update-status="updateStatus"
    :download-progress="downloadProgress"
    :is-update-dialog-visible="isUpdateDialogVisible"
    @restore-update="handleRestore"
  />
  <SaveConfirmDialog
    :visible="isDialogVisible"
    :type="dialogType"
    :tab-name="tabName"
    :file-name="fileName"
    @save="handleSave"
    @discard="handleDiscard"
    @cancel="handleCancel"
    @overwrite="handleOverwrite"
  />
  <UpdateConfirmDialog
    :visible="isUpdateDialogVisible"
    :status="updateStatus"
    :progress="downloadProgress"
    @get="handleUpdate"
    @install="handleInstall"
    @ignore="handleIgnore"
    @cancel="handleUpdateCancel"
    @minimize="handleMinimize"
  />
  <!-- 文档检查结果面板：贴右缘悬浮（不占布局流） -->
  <LintResultPanel
    v-if="isLintPanelVisible"
    class="lint-panel-overlay"
    :result="currentResult"
    :error="currentLintError"
    :is-running="isLintRunning"
    @close="closeLintPanel()"
    @reveal="handleLintReveal"
    @fix="handleLintFix"
    @fix-all="handleLintFixAll"
  />
  <CommandPalette />
  <WorkspaceSearchPanel />
  <Transition name="global-loading-fade" appear>
    <div v-if="isLoading" class="global-loading-overlay">
      <div class="global-loading-card">
        <LoadingIcon class="global-loading-icon" />
        <span>{{ loadingMessage || "加载中..." }}</span>
      </div>
    </div>
  </Transition>
</template>

<style scoped lang="less">
#fontRoot {
  height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
}

.editorArea {
  height: 0;
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;

  // 默认：侧边栏隐藏在左侧外
  .outlineBox {
    position: absolute;
    left: 0;
    top: 0;
    width: var(--sidebar-width);
    height: 100%;
    z-index: 10;
    transform: translateX(-100%);
    opacity: 0;
    pointer-events: none;
    transition:
      transform 0.2s ease,
      opacity 0.2s ease;
  }

  .sidebar-resize-handle {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 20;
    width: 10px;
    cursor: ew-resize;
    touch-action: none;
    background: transparent;

    &::after {
      content: "";
      position: absolute;
      top: 0;
      bottom: 0;
      right: -1px;
      width: 2px;
      background: var(--primary-color);
      opacity: 0.35;
      transition: opacity 0.15s ease;
    }

    &:hover::after {
      opacity: 1;
    }
  }

  .editorBox {
    flex: 1;
    width: 100%;
    cursor: default;
    transition: transform 0.2s ease;
  }

  // 打开动画：transform 滑入（GPU 加速，零重排）
  &.outline-opening {
    .outlineBox {
      transform: translateX(0);
      opacity: 1;
      pointer-events: auto;
    }
    .editorBox {
      transform: translateX(var(--sidebar-width));
    }
  }

  // 打开完成：切换为 flex 正常布局，内容区正确排版
  &.outline-open {
    .outlineBox {
      position: relative;
      transform: none;
      opacity: 1;
      pointer-events: auto;
      flex-shrink: 0;
      transition: none;
    }
    .editorBox {
      width: 0;
      transform: none;
      transition: none;
    }
  }

  // 关闭准备：瞬间切回 transform 定位（视觉位置不变）
  &.outline-closing-prep {
    .outlineBox {
      position: absolute;
      transform: translateX(0);
      opacity: 1;
      pointer-events: auto;
      transition: none;
    }
    .editorBox {
      width: 100%;
      transform: translateX(var(--sidebar-width));
      transition: none;
    }
  }

  // 关闭动画：transform 滑出
  &.outline-closing {
    .outlineBox {
      position: absolute;
      transform: translateX(-100%);
      opacity: 0;
      pointer-events: none;
      transition:
        transform 0.2s ease,
        opacity 0.2s ease;
    }
    .editorBox {
      width: 100%;
      transform: translateX(0);
      transition: transform 0.2s ease;
    }
  }
}

// 手机竖屏 / 极窄窗口：左侧边栏改为覆盖式抽屉，不再挤压正文（正文宽度保持 100%）
@media (max-width: 640px) {
  .editorArea {
    .outlineBox {
      width: min(var(--sidebar-width), 85vw);
      box-shadow: 4px 0 16px rgba(0, 0, 0, 0.16);
    }

    &.outline-opening .editorBox,
    &.outline-closing-prep .editorBox {
      transform: none;
    }

    &.outline-open {
      .outlineBox {
        position: absolute;
      }
      .editorBox {
        width: 100%;
      }
    }

    .sidebar-resize-handle {
      display: none;
    }
  }
}

.global-loading-fade-enter-active,
.global-loading-fade-leave-active {
  transition: opacity 0.18s ease;
}

.global-loading-fade-enter-from,
.global-loading-fade-leave-to {
  opacity: 0;
}

.global-loading-overlay {
  position: fixed;
  inset: 0;
  z-index: 200000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--background-color) 60%, rgba(0, 0, 0, 0.28));
  backdrop-filter: blur(3px);
  -webkit-app-region: no-drag;
}

.global-loading-card {
  min-width: 180px;
  padding: 18px 22px;
  border: 1px solid var(--border-color-1);
  border-radius: 12px;
  background: var(--background-color-1);
  color: var(--text-color-1);
  box-shadow: 0 14px 42px rgba(0, 0, 0, 0.24);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  font-size: 14px;
}

.global-loading-icon {
  color: var(--primary-color);
  font-size: 22px;
}

/* 文档检查结果面板：贴右缘、位于状态栏上方 */
.lint-panel-overlay {
  position: fixed;
  right: 16px;
  bottom: calc(var(--statusbar-height, 28px) + 12px);
  width: min(460px, calc(100vw - 32px));
  z-index: 900;
}
</style>
