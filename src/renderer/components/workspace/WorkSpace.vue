<script lang="ts" setup>
import type { TreeNode } from "@ui/tree";
import { onMounted, onUnmounted, ref, watch } from "vue";
import { Tree } from "@ui/tree";
import autotoast from "autotoast.js";
import AppIcon from "@/renderer/components/ui/AppIcon.vue";
import useTab from "@/renderer/hooks/useTab";
import useWorkSpace from "@/renderer/hooks/useWorkSpace";
import { resolveImageSrc } from "@/core/utils/image-path";
import {
  dirnameOfPath,
  fileExtensionOfPath,
  fileStemOfPath,
  joinPathOf,
  relativeToWorkspace,
} from "@/renderer/utils/workspacePathHelpers";

const {
  workSpace,
  setWorkSpace,
  searchQuery,
  sortBy,
  toggleSort,
  editingNode,
  createFile,
  createFolder,
  deleteFile,
  renameFile,
  hardRefreshWorkSpace,
  watchedDirPath,
} = useWorkSpace();
const { currentTab, openFile, randomUUID } = useTab();
const currentImagePath = ref<string | null>(null);

function isImageFile(path: string): boolean {
  return /\.(?:png|jpe?g|gif|webp|svg|bmp)$/i.test(path);
}

function getSiblingImages(path: string): Array<{ path: string; name: string }> {
  const roots = workSpace.value;
  if (!roots) return [];

  const findInNodes = (nodes: TreeNode[]): Array<{ path: string; name: string }> | null => {
    if (nodes.some((node) => node.path === path)) {
      return nodes
        .filter((node) => !node.isDirectory && isImageFile(node.path))
        .map((node) => ({ path: node.path, name: node.name }));
    }

    for (const node of nodes) {
      if (!node.children) continue;
      const result = findInNodes(node.children);
      if (result) return result;
    }

    return null;
  };

  return findInNodes(roots) ?? [];
}

watch(
  () => currentTab.value?.filePath,
  () => {
    currentImagePath.value = null;
  }
);

// 右键菜单状态
const contextMenu = ref<{
  visible: boolean;
  x: number;
  y: number;
  node: TreeNode | null;
}>({
  visible: false,
  x: 0,
  y: 0,
  node: null,
});

// 删除确认弹窗
const deleteConfirm = ref<{
  visible: boolean;
  node: TreeNode | null;
}>({
  visible: false,
  node: null,
});

// 打开文件夹选择对话框
function openFolder() {
  setWorkSpace();
}

/** 在工作区树中按路径查找节点（点击回调解构后需要完整节点信息） */
function findNodeByPath(path: string): TreeNode | null {
  const roots = workSpace.value;
  if (!roots) return null;
  const stack = [...roots];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.path === path) return node;
    if (node.children) stack.push(...node.children);
  }
  return null;
}

/** 最近被点击/右键的节点：树选中上下文（工具栏新建文件夹的目标依据），与高亮选中解耦 */
const selectedNode = ref<TreeNode | null>(null);

// 切换工作区后旧节点引用失效，重置选中上下文
watch(watchedDirPath, () => {
  selectedNode.value = null;
});

function handleNodeClick({ path, name }: TreeNode) {
  // 记录树选中上下文（工具栏新建文件夹的目标依据）
  selectedNode.value = findNodeByPath(path);
  if (isImageFile(path)) {
    currentImagePath.value = path;
    const siblingImages = getSiblingImages(path);
    const previewItems = siblingImages.map((image) => ({
      src: resolveImageSrc(image.path),
      alt: image.name,
    }));
    const previewIndex = Math.max(
      0,
      siblingImages.findIndex((image) => image.path === path)
    );
    void window.electronAPI.openImagePreview(resolveImageSrc(path), name, {
      items: previewItems,
      index: previewIndex,
    });
    return;
  }
  currentImagePath.value = null;
  openFile(path);
}

// 右键菜单
function handleContextMenu(node: TreeNode, event: MouseEvent) {
  selectedNode.value = node;
  contextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    node,
  };
}

/** 右键「复制文档路径」的二级菜单状态 */
const contextSubmenu = ref<"copyPath" | null>(null);

function closeContextMenu() {
  contextSubmenu.value = null;
  contextMenu.value.visible = false;
}

function onDocumentClick() {
  closeContextMenu();
}

onMounted(() => {
  document.addEventListener("click", onDocumentClick);
});
onUnmounted(() => {
  document.removeEventListener("click", onDocumentClick);
});

// 空白区域右键
function onBlankContextMenu(e: MouseEvent) {
  // 未打开文件夹时不显示右键菜单
  if (!workSpace.value) return;
  e.preventDefault();
  contextMenu.value = {
    visible: true,
    x: e.clientX,
    y: e.clientY,
    node: null,
  };
}

// 菜单操作
function getTargetDir(node: TreeNode | null): string {
  if (!node) return watchedDirPath.value ?? "";
  if (node.isDirectory) return node.path;
  // 文件所在的目录
  return node.path.replace(/[/\\][^/\\]+$/, "");
}

async function handleNewFile() {
  closeContextMenu();
  const dir = getTargetDir(contextMenu.value.node);
  if (!dir) return;
  await createFile(dir);
}

async function handleNewFolder() {
  closeContextMenu();
  const dir = getTargetDir(contextMenu.value.node);
  if (!dir) return;
  await createFolder(dir);
}

async function handleRefresh() {
  closeContextMenu();
  await hardRefreshWorkSpace();
}

function handleRename() {
  closeContextMenu();
  const node = contextMenu.value.node;
  if (!node) return;
  editingNode.value = { path: node.path, isNew: false };
}

function handleDelete() {
  closeContextMenu();
  const node = contextMenu.value.node;
  if (!node) return;
  deleteConfirm.value = { visible: true, node };
}

async function confirmDelete() {
  const node = deleteConfirm.value.node;
  deleteConfirm.value = { visible: false, node: null };
  if (!node) return;
  await deleteFile(node.path);
}

function cancelDelete() {
  deleteConfirm.value = { visible: false, node: null };
}

/** 右键目标是否为「文档」节点（目录不提供文档专属操作） */
function contextFileNode(): TreeNode | null {
  const node = contextMenu.value.node;
  if (!node || node.isDirectory) return null;
  return node;
}

/** 创建副本：同目录复制一份，文件名追加「-（副本）」，重名时再追加序号 */
async function handleDuplicate() {
  const node = contextFileNode();
  closeContextMenu();
  if (!node) return;

  const dir = dirnameOfPath(node.path);
  const stem = fileStemOfPath(node.path);
  const ext = fileExtensionOfPath(node.path);
  let targetPath = joinPathOf(dir, `${stem}-（副本）${ext}`);
  for (let index = 2; await window.electronAPI.workspaceExists(targetPath); index += 1) {
    targetPath = joinPathOf(dir, `${stem}-（副本）(${index})${ext}`);
  }

  const createdPath = await window.electronAPI.copyFile(node.path, targetPath);
  if (!createdPath) {
    autotoast.show("创建副本失败", "error");
    return;
  }
  await hardRefreshWorkSpace();
  autotoast.show("已创建副本", "success");
}

/** 复制文档路径：绝对路径 / 相对工作区路径 / 相对当前目录路径（文件名 + 后缀） */
async function handleCopyPath(kind: "absolute" | "workspace" | "relative") {
  const node = contextFileNode();
  contextSubmenu.value = null;
  closeContextMenu();
  if (!node) return;

  let text = node.path;
  if (kind === "relative") {
    text = node.name;
  } else if (kind === "workspace") {
    const relative = relativeToWorkspace(node.path, watchedDirPath.value ?? "");
    if (!relative) {
      autotoast.show("该文件不在当前工作区内", "error");
      return;
    }
    text = relative;
  }

  await window.electronAPI.writeTextToClipboard(text);
  autotoast.show("已复制路径", "success");
}

/** 打开文件路径：在系统文件管理器中定位选中文件 */
async function handleRevealFile() {
  const node = contextFileNode();
  closeContextMenu();
  if (!node) return;
  await window.electronAPI.revealFileInFolder(node.path);
}

/**
 * 在新窗口打开：新窗口载入该文档，并把其所在目录设为工作区
 *
 * 载荷与「拖拽分离」的 Tab 数据同构，额外携带 workspaceDir；
 * 新窗口渲染层读取后通过 workspace:open-path 事件加载工作区。
 */
async function handleOpenInNewWindow() {
  const node = contextFileNode();
  closeContextMenu();
  if (!node) return;

  const fileContent = await window.electronAPI.readFileByPath(node.path);
  if (!fileContent) {
    autotoast.show("打开新窗口失败", "error");
    return;
  }

  const readOnly = await window.electronAPI.getIsReadOnly(node.path);
  const opened = await window.electronAPI.createWindowWithTab({
    id: randomUUID(),
    name: node.name,
    filePath: node.path,
    content: fileContent.content,
    originalContent: fileContent.content,
    isModified: false,
    scrollRatio: 0,
    readOnly,
    fileTraits: fileContent.fileTraits,
    // 新窗口工作区为该文档所在目录（由渲染层消费）
    workspaceDir: dirnameOfPath(node.path),
  });
  if (!opened) autotoast.show("打开新窗口失败", "error");
}

// 编辑确认/取消
async function handleEditConfirm(node: TreeNode, newName: string) {
  if (!editingNode.value) return;

  if (editingNode.value.isNew) {
    // 新建文件：如果名称不变（用户直接确认），保留文件
    // 如果名称改变，重命名
    if (newName !== node.name) {
      await renameFile(node.path, newName);
    }
  } else {
    // 重命名
    if (newName !== node.name) {
      await renameFile(node.path, newName);
    }
  }
  editingNode.value = null;
}

function handleEditCancel(node: TreeNode) {
  if (editingNode.value?.isNew) {
    // 新建文件取消：删除临时文件
    deleteFile(node.path);
  }
  editingNode.value = null;
}

// 工具栏新建文件
async function toolbarNewFile() {
  const dir = watchedDirPath.value;
  if (!dir) return;
  await createFile(dir);
}

/** 工具栏新建目标目录：无选中 → 根目录；选中目录 → 其下；选中文件 → 同级 */
function toolbarTargetDir(): string {
  const node = selectedNode.value;
  if (!node) return watchedDirPath.value ?? "";
  if (node.isDirectory) return node.path;
  return node.path.replace(/[/\\][^/\\]+$/, ""); // 文件 → 去掉末尾文件名取目录
}

async function toolbarNewFolder() {
  const dir = toolbarTargetDir();
  if (!dir) return;
  await createFolder(dir); // 自动命名"新建文件夹 N"→创建→刷新→进入重命名编辑态
}

// 排序标签
function getSortLabel() {
  return sortBy.value === "name" ? "按名称" : "按时间";
}
</script>

<template>
  <div class="WorkSpace" @contextmenu.prevent="onBlankContextMenu">
    <!-- 工具栏 -->
    <div v-if="workSpace" class="workspace-toolbar">
      <div class="search-wrapper">
        <input v-model="searchQuery" class="search-input" placeholder="搜索文件..." />
      </div>
      <button class="toolbar-btn" :title="getSortLabel()" @click="toggleSort">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
          <path v-if="sortBy === 'name'" d="M1 3.5h14v1H1zm0 4h10v1H1zm0 4h6v1H1z" />
          <path v-else d="M1 3.5h6v1H1zm0 4h10v1H1zm0 4h14v1H1z" />
        </svg>
      </button>
      <button class="toolbar-btn" title="新建文件" @click="toolbarNewFile">
        <AppIcon name="plus" />
      </button>
      <button
        class="toolbar-btn"
        title="新建文件夹（选中目录时在其下创建，选中文件时在其同级创建）"
        @click="toolbarNewFolder"
      >
        <AppIcon name="folder-plus" />
      </button>
    </div>

    <!-- 文件树独立滚动：工具栏固定在顶部、「更换文件夹」固定在底部，不随滚动条滑动 -->
    <div v-if="workSpace" class="workspace-tree-scroll">
      <Tree
        :nodes="workSpace"
        :current-node="currentImagePath || (currentTab ? currentTab.filePath : null)"
        :editing-path="editingNode?.path ?? null"
        @node-click="handleNodeClick"
        @node-context-menu="handleContextMenu"
        @edit-confirm="handleEditConfirm"
        @edit-cancel="handleEditCancel"
      />
    </div>
    <div v-if="workSpace" class="change-folder-bar">
      <button class="change-folder-btn" @click="openFolder">
        <AppIcon name="folder-opened" />
        <span>更换文件夹</span>
      </button>
    </div>
    <div v-if="!workSpace" class="empty-state">
      <AppIcon name="folder-opened" class="empty-icon" />
      <p>暂无打开的文件夹</p>
      <button class="open-folder-btn" @click="openFolder">选择文件夹</button>
    </div>

    <!-- 右键菜单 -->
    <Teleport to="body">
      <div
        v-if="contextMenu.visible"
        class="context-menu"
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
        @click.stop
      >
        <div class="context-menu-item" @click="handleNewFile">
          <AppIcon name="plus" />
          <span>新建文件</span>
        </div>
        <div class="context-menu-item" @click="handleNewFolder">
          <AppIcon name="folder-opened" />
          <span>新建文件夹</span>
        </div>
        <template v-if="contextMenu.node">
          <div class="context-menu-item" @click="handleRename">
            <AppIcon name="edit" />
            <span>重命名</span>
          </div>
          <!-- 文档专属操作：仅右键命中文件时展示 -->
          <template v-if="!contextMenu.node.isDirectory">
            <div class="context-menu-item" @click="handleDuplicate">
              <AppIcon name="document-copy" />
              <span>创建副本</span>
            </div>
            <div
              class="context-menu-item context-menu-item--has-submenu"
              @mouseenter="contextSubmenu = 'copyPath'"
              @mouseleave="contextSubmenu = null"
            >
              <AppIcon name="link" />
              <span>复制文档路径</span>
              <div v-if="contextSubmenu === 'copyPath'" class="context-submenu">
                <div class="context-menu-item" @click="handleCopyPath('absolute')">
                  <span>绝对路径</span>
                </div>
                <div class="context-menu-item" @click="handleCopyPath('workspace')">
                  <span>相对工作区路径</span>
                </div>
                <div class="context-menu-item" @click="handleCopyPath('relative')">
                  <span>相对当前目录路径</span>
                </div>
              </div>
            </div>
            <div class="context-menu-item" @click="handleRevealFile">
              <AppIcon name="folder-opened" />
              <span>打开文件路径</span>
            </div>
            <div class="context-menu-item" @click="handleOpenInNewWindow">
              <AppIcon name="app-window" />
              <span>在新窗口打开</span>
            </div>
          </template>

          <div class="context-menu-divider" />
          <div class="context-menu-item danger" @click="handleDelete">
            <AppIcon name="close" />
            <span>删除</span>
          </div>
        </template>
        <div class="context-menu-divider" />
        <div class="context-menu-item" @click="handleRefresh">
          <svg
            viewBox="0 0 16 16"
            width="13"
            height="13"
            fill="currentColor"
            style="flex-shrink: 0"
          >
            <path
              d="M13.65 2.35A7.96 7.96 0 0 0 8 0C3.58 0 0 3.58 0 8s3.58 8 8 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 8 14 6 6 0 1 1 8 2c1.66 0 3.14.69 4.22 1.78L9 7h7V0l-2.35 2.35z"
              transform="scale(0.8) translate(2,2)"
            />
          </svg>
          <span>刷新</span>
        </div>
      </div>
    </Teleport>

    <!-- 删除确认弹窗 -->
    <Teleport to="body">
      <Transition name="dialog-fade" appear>
        <div v-if="deleteConfirm.visible" class="dialog-overlay" @click.self="cancelDelete">
          <div class="dialog-content">
            <div class="dialog-header">
              <h3>确认删除</h3>
            </div>
            <div class="dialog-body">
              <p>
                确定要删除
                <strong>{{ deleteConfirm.node?.name }}</strong>
                吗？此操作不可恢复。
              </p>
            </div>
            <div class="dialog-footer">
              <button class="btn btn-secondary" @click="cancelDelete">取消</button>
              <button class="btn btn-danger" @click="confirmDelete">确认删除</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style lang="less" scoped>
.WorkSpace {
  flex: 1;
  min-height: 0;
  height: 100%;
  // 外层不滚动：滚动只发生在中间的文件树区域，顶部工具栏与底部「更换文件夹」保持固定
  overflow: hidden;
  position: relative;
  display: flex;
  flex-direction: column;

  .workspace-tree-scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;

    // 细滚动条：仅在文件树区域出现
    scrollbar-width: thin;
    scrollbar-color: color-mix(in srgb, var(--text-color-3) 34%, transparent) transparent;

    &::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }

    &::-webkit-scrollbar-track {
      background: transparent;
    }

    &::-webkit-scrollbar-thumb {
      background: color-mix(in srgb, var(--text-color-3) 28%, transparent);
      border: 2px solid transparent;
      border-radius: 999px;
      background-clip: content-box;
    }

    &::-webkit-scrollbar-thumb:hover {
      background: color-mix(in srgb, var(--text-color-3) 45%, transparent);
      background-clip: content-box;
    }
  }

  .workspace-toolbar {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border-color-1);
    flex-shrink: 0;

    .search-wrapper {
      flex: 1;
      min-width: 0;
    }

    .search-input {
      width: 100%;
      height: 24px;
      padding: 0 8px;
      border: 1px solid var(--border-color-1);
      border-radius: 4px;
      background: var(--background-color-2);
      color: var(--text-color-1);
      font-size: 12px;
      outline: none;
      transition: border-color 0.2s;
      box-sizing: border-box;

      &::placeholder {
        color: var(--text-color-3);
      }

      &:focus {
        border-color: var(--primary-color);
      }
    }

    .toolbar-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: var(--text-color-3);
      cursor: pointer;
      flex-shrink: 0;
      font-size: 12px;
      transition: all 0.2s;

      &:hover {
        background: var(--hover-background-color);
        color: var(--text-color-1);
      }

      svg {
        font-size: 14px;
      }
    }
  }

  .change-folder-bar {
    flex-shrink: 0;
    padding: 8px;
    border-top: 1px solid var(--border-color-1);
    margin-top: auto;

    .change-folder-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      width: 100%;
      padding: 6px 0;
      border: 1px solid var(--border-color-1);
      border-radius: 5px;
      cursor: pointer;
      background: var(--background-color-2);
      color: var(--text-color-3);
      font-size: 12px;
      transition: all 0.2s ease;

      svg {
        font-size: 13px;
      }

      &:hover {
        background: var(--hover-background-color);
        color: var(--text-color-1);
        border-color: var(--primary-color);
      }
    }
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    gap: 12px;
    padding: 20px;

    .empty-icon {
      font-size: 36px;
      color: var(--text-color-3);
      opacity: 0.5;
    }

    p {
      color: var(--text-color-3);
      font-size: 12px;
      margin: 0;
    }

    .open-folder-btn {
      font-size: 12px;
      line-height: 1;
      padding: 6px 16px;
      border-radius: 5px;
      border: 1px solid var(--border-color-1);
      cursor: pointer;
      background: var(--background-color-2);
      color: var(--text-color-2);
      transition: all 0.2s ease;

      &:hover {
        background: var(--hover-background-color);
        color: var(--text-color-1);
        border-color: var(--primary-color);
      }
    }
  }
}
</style>

<style lang="less">
// 右键菜单（全局样式）
.context-menu {
  position: fixed;
  z-index: 10000;
  min-width: 140px;
  background: var(--background-color-1);
  border: 1px solid var(--border-color-1);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 4px 0;
  font-size: 12px;

  .context-menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    cursor: pointer;
    color: var(--text-color-1);
    transition: background-color 0.15s;

    &:hover {
      background: var(--hover-background-color);
    }

    &.danger {
      color: #f56565;

      &:hover {
        background: rgba(245, 101, 101, 0.1);
      }
    }

    svg {
      font-size: 13px;
    }
  }

  /* 「复制文档路径」二级菜单：贴父项右缘展开 */
  .context-menu-item--has-submenu {
    position: relative;
  }

  .context-submenu {
    position: absolute;
    top: 0;
    left: 100%;
    min-width: 150px;
    padding: 4px 0;
    border: 1px solid var(--border-color-1);
    border-radius: 6px;
    background: var(--background-color-1);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }

  .context-menu-divider {
    height: 1px;
    background: var(--border-color-1);
    margin: 4px 0;
  }
}

// 删除确认弹窗（全局样式）
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(2px);
}

.dialog-content {
  background: var(--background-color-1);
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  min-width: 360px;
  max-width: 440px;
  border: 1px solid var(--border-color-1);
}

.dialog-header {
  padding: 20px 24px 0;

  h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--text-color);
  }
}

.dialog-body {
  padding: 16px 24px;

  p {
    margin: 0;
    font-size: 13px;
    color: var(--text-color-2);
    line-height: 1.5;

    strong {
      color: var(--text-color-1);
    }
  }
}

.dialog-footer {
  padding: 0 24px 20px;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.btn {
  padding: 7px 16px;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-secondary {
  background: var(--background-color-2);
  color: var(--text-color-3);
  border: 1px solid var(--border-color-1);

  &:hover {
    background: var(--hover-background-color);
    color: var(--text-color-1);
  }
}

.btn-danger {
  background: #f56565;
  color: white;

  &:hover {
    background: #e53e3e;
  }
}

.dialog-fade-enter-active,
.dialog-fade-leave-active {
  transition: opacity 0.3s ease;

  .dialog-content {
    transition: transform 0.3s ease;
  }
}

.dialog-fade-enter-from,
.dialog-fade-leave-to {
  opacity: 0;

  .dialog-content {
    transform: translateY(-20px) scale(0.95);
  }
}
</style>
