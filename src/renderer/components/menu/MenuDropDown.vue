<script setup lang="ts">
/**
 * 标题栏项目菜单（项目图标按钮下拉）
 *
 * - 点击项目图标展开下拉菜单：打开文件 / 打开文件夹 / 打开新窗口 / 保存 / 另存为 /
 *   导出为（二级菜单：PDF·HTML·PNG·TXT·WORD）/ 切换主题（二级菜单：主题列表）/
 *   自动保存（开启时菜单项前方打勾）/ 首选项（点击才打开设置页面）；
 * - 菜单面板 Teleport 到 body（标题栏 overflow: hidden 会裁剪内部弹层），
 *   打开时按按钮位置定位：Windows 左对齐，其余平台右对齐（按钮位于标题栏右缘）；
 * - 首选项沿用原全屏设置面板（MenuBar），文件类操作后在 file:Change 中自动收起。
 */
import autotoast from "autotoast.js";
import { computed, onMounted, onUnmounted, ref } from "vue";
import AppIcon from "@/renderer/components/ui/AppIcon.vue";
import emitter from "@/renderer/events";
import useContent from "@/renderer/hooks/useContent";
import { useConfig } from "@/renderer/hooks/useConfig";
import { applyAutoSave } from "@/renderer/hooks/useAutoSave";
import useFile from "@/renderer/hooks/useFile";
import useTheme from "@/renderer/hooks/useTheme";
import useUiLoading from "@/renderer/hooks/useUiLoading";
import useRecentFiles from "@/renderer/hooks/useRecentFiles";
import useTab from "@/renderer/hooks/useTab";
import useWorkSpace from "@/renderer/hooks/useWorkSpace";
import {
  dirnameOfPath,
  fileExtensionOfPath,
  fileNameOfPath,
  fileStemOfPath,
  joinPathOf,
} from "@/renderer/utils/workspacePathHelpers";
import {
  exportAsText,
  exportElementAsPDF,
  exportElementAsPNG,
  exportElementWithStylesAndImages,
  exportMarkdownAsWord,
  getActiveEditorElement,
  getActiveEditorSelector,
} from "@/renderer/utils/exports";
import MenuBar from "./MenuBar.vue";

/** Windows 的按钮位于标题栏左缘（下拉左对齐）；其余平台按钮在右缘（下拉右对齐） */
const isWin = window.electronAPI.platform === "win32";

const { onOpen, onSave, onSaveAs, currentTab } = useFile();
const { setWorkSpace, watchedDirPath, openWorkSpaceByPath } = useWorkSpace();
const { themes, currentTheme, setTheme } = useTheme();
const { markdown } = useContent();
const { openFile, updateCurrentTabFile } = useTab();
const { recentFiles } = useRecentFiles();
const { config } = useConfig();
const { runWithLoading, nextFrame } = useUiLoading();

const menuOpen = ref(false);
const settingsOpen = ref(false);
const buttonRef = ref<HTMLButtonElement | null>(null);
const panelStyle = ref<Record<string, string>>({});

type SubmenuKind = "export" | "theme" | "recent";
const openSubmenu = ref<SubmenuKind | null>(null);

const autoSaveEnabled = computed(() => Boolean(config.value.other.autoSave));

/** 最近文件（最多 10 份，供「打开最近文件」子菜单） */
const recentFileItems = computed(() => recentFiles.value.slice(0, 10));

/** 「打开文件位置」可用性：当前文档或工作区至少有一个 */
const canRevealLocation = computed(() =>
  Boolean(currentTab.value?.filePath || watchedDirPath.value)
);

// ============ 菜单开关 ============

/** 打开菜单：按图标按钮位置计算面板坐标（Teleport 到 body 的 fixed 面板） */
function openMenu(): void {
  const rect = buttonRef.value?.getBoundingClientRect();
  if (rect) {
    panelStyle.value = {
      top: `${Math.round(rect.bottom + 6)}px`,
      ...(isWin
        ? { left: `${Math.round(rect.left)}px` }
        : { right: `${Math.round(window.innerWidth - rect.right)}px` }),
    };
  }
  openSubmenu.value = null;
  menuOpen.value = true;
}

function closeMenu(): void {
  menuOpen.value = false;
  openSubmenu.value = null;
}

function toggleMenu(): void {
  if (menuOpen.value) {
    closeMenu();
  } else {
    openMenu();
  }
}

// ============ 文件操作 ============

function handleOpenFile(): void {
  closeMenu();
  void onOpen();
}

function handleOpenFolder(): void {
  closeMenu();
  void setWorkSpace();
}

/**
 * 打开最近文件：在当前窗口打开该文档，并把工作区切到它所在目录
 */
async function handleOpenRecentFile(filePath: string): Promise<void> {
  closeMenu();
  await openFile(filePath);
  const dir = dirnameOfPath(filePath);
  if (dir) await openWorkSpaceByPath(dir);
}

/** 目标目录内挑一个不冲突的默认文件名（未命名.md → 未命名 (2).md …） */
async function nextAvailableFileName(dir: string, preferred: string): Promise<string> {
  const stem = fileStemOfPath(preferred);
  const ext = fileExtensionOfPath(preferred);
  for (let index = 1; index <= 50; index += 1) {
    const name = index === 1 ? preferred : `${stem} (${index})${ext}`;
    if (!(await window.electronAPI.workspaceExists(joinPathOf(dir, name)))) return name;
  }
  return `${stem} (${Date.now()})${ext}`;
}

/**
 * 移动到…：把当前文档移动到选定目录；没有打开文档时按「在目标目录新建文档」处理
 *
 * 目标存在同名文件时先弹覆盖确认（复用保存流程的对话框，仅「覆盖」视为同意）。
 */
async function handleMoveToDirectory(): Promise<void> {
  closeMenu();
  const picked = await window.electronAPI.showOpenDialog({
    properties: ["openDirectory"],
    title: "选择目标文件夹",
  });
  if (!picked || picked.canceled || picked.filePaths.length === 0) return;
  const targetDir = picked.filePaths[0];

  const tab = currentTab.value;
  if (!tab || !tab.filePath) {
    // 无打开文档：在目标目录新建文档并打开
    const name = await nextAvailableFileName(targetDir, "未命名.md");
    const createdPath = await window.electronAPI.createFile(targetDir, name);
    if (!createdPath) {
      autotoast.show("新建文档失败", "error");
      return;
    }
    await openFile(createdPath);
    await openWorkSpaceByPath(targetDir);
    return;
  }

  const targetPath = joinPathOf(targetDir, fileNameOfPath(tab.filePath));
  if (await window.electronAPI.workspaceExists(targetPath)) {
    const choice = await window.electronAPI.showOverwriteConfirm(fileNameOfPath(tab.filePath));
    if (choice !== 1) return; // 仅「覆盖」继续
  }

  const movedPath = await window.electronAPI.moveFile(tab.filePath, targetDir);
  if (!movedPath) {
    autotoast.show("移动文档失败", "error");
    return;
  }
  updateCurrentTabFile(movedPath, tab.content, fileNameOfPath(movedPath));
  autotoast.show("已移动文档", "success");
}

/**
 * 打开文件位置：优先当前文档所在位置，其次当前工作区；
 * 两者都没有时菜单项置灰（canRevealLocation = false）。
 */
async function handleRevealLocation(): Promise<void> {
  if (!canRevealLocation.value) return;
  closeMenu();
  const target = currentTab.value?.filePath ?? watchedDirPath.value;
  if (!target) return;
  await window.electronAPI.revealFileInFolder(target);
}

function handleNewWindow(): void {
  closeMenu();
  void window.electronAPI.createBlankWindow().catch(() => {
    autotoast.show("打开新窗口失败", "error");
  });
}

function handleSave(): void {
  closeMenu();
  void onSave();
}

function handleSaveAs(): void {
  closeMenu();
  void onSaveAs();
}

// ============ 导出为（二级菜单） ============

type ExportKind = "pdf" | "html" | "png" | "txt" | "word";

/** 导出文件名（去掉 .md 后缀；未保存文档使用默认名） */
function getExportBaseName(): string {
  return currentTab.value?.name?.slice(0, -3) || "导出的文件";
}

async function handleExport(kind: ExportKind): Promise<void> {
  closeMenu();
  const base = getExportBaseName();
  try {
    if (kind === "pdf") {
      await exportElementAsPDF(getActiveEditorSelector(), `${base}.pdf`, {
        pageSize: "A4",
        scale: 1,
      });
      autotoast.show("导出成功", "success");
    } else if (kind === "html") {
      await exportElementWithStylesAndImages(getActiveEditorElement(), `${base}.html`);
    } else if (kind === "png") {
      await exportElementAsPNG(getActiveEditorElement(), `${base}.png`);
      autotoast.show("导出成功", "success");
    } else if (kind === "txt") {
      exportAsText(markdown.value, `${base}.txt`);
    } else {
      await exportMarkdownAsWord(markdown.value, `${base}.docx`);
      autotoast.show("导出成功", "success");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 原生保存对话框中的用户取消不算导出失败
    if (!message.includes("取消")) {
      autotoast.show(`导出失败: ${message}`, "error");
    }
  }
}

// ============ 切换主题（二级菜单：主题列表） ============

async function handleThemeSelect(name: string): Promise<void> {
  closeMenu();
  if (name === currentTheme.value) return;
  // 与设置页主题卡片一致的切换反馈（加载遮罩 + 防闪烁）
  await runWithLoading(
    async () => {
      await nextFrame();
      await setTheme(name);
      await nextFrame();
    },
    "正在切换主题...",
    220
  );
}

// ============ 自动保存 / 首选项 ============

function handleToggleAutoSave(): void {
  closeMenu();
  applyAutoSave(!autoSaveEnabled.value);
}

/** 首选项：打开设置面板（唯一进入设置页面的入口） */
function handleOpenSettings(): void {
  closeMenu();
  settingsOpen.value = true;
}

// ============ 全局收起 ============

function handleFileChange(): void {
  closeMenu();
  settingsOpen.value = false;
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  closeMenu();
  settingsOpen.value = false;
}

function handleWindowResize(): void {
  closeMenu();
}

onMounted(() => {
  emitter.on("file:Change", handleFileChange);
  document.addEventListener("keydown", handleKeydown);
  window.addEventListener("resize", handleWindowResize);
});

onUnmounted(() => {
  emitter.off("file:Change", handleFileChange);
  document.removeEventListener("keydown", handleKeydown);
  window.removeEventListener("resize", handleWindowResize);
});
</script>

<template>
  <div class="MenuDropDownBox">
    <button ref="buttonRef" class="dropdown-header" type="button" @click="toggleMenu">
      <svg
        class="logo"
        :class="{ active: menuOpen }"
        viewBox="4 4 30 30"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <!-- 实心圆角底板：颜色随主题变化（--logo-bg），见 styles/logo-theme.less -->
        <path
          fill="var(--logo-bg, #4f6b47)"
          d="M 34.00 19.00 L 33.99 22.43 L 33.96 23.85 L 33.91 24.93 L 33.84 25.84 L 33.74 26.63 L 33.63 27.34 L 33.49 27.98 L 33.34 28.57 L 33.16 29.11 L 32.96 29.61 L 32.74 30.07 L 32.49 30.50 L 32.22 30.90 L 31.93 31.27 L 31.61 31.61 L 31.27 31.93 L 30.90 32.22 L 30.50 32.49 L 30.07 32.74 L 29.61 32.96 L 29.11 33.16 L 28.57 33.34 L 27.98 33.49 L 27.34 33.63 L 26.63 33.74 L 25.84 33.84 L 24.93 33.91 L 23.85 33.96 L 22.43 33.99 L 19.00 34.00 L 15.57 33.99 L 14.15 33.96 L 13.07 33.91 L 12.16 33.84 L 11.37 33.74 L 10.66 33.63 L 10.02 33.49 L 9.43 33.34 L 8.89 33.16 L 8.39 32.96 L 7.93 32.74 L 7.50 32.49 L 7.10 32.22 L 6.73 31.93 L 6.39 31.61 L 6.07 31.27 L 5.78 30.90 L 5.51 30.50 L 5.26 30.07 L 5.04 29.61 L 4.84 29.11 L 4.66 28.57 L 4.51 27.98 L 4.37 27.34 L 4.26 26.63 L 4.16 25.84 L 4.09 24.93 L 4.04 23.85 L 4.01 22.43 L 4.00 19.00 L 4.01 15.57 L 4.04 14.15 L 4.09 13.07 L 4.16 12.16 L 4.26 11.37 L 4.37 10.66 L 4.51 10.02 L 4.66 9.43 L 4.84 8.89 L 5.04 8.39 L 5.26 7.93 L 5.51 7.50 L 5.78 7.10 L 6.07 6.73 L 6.39 6.39 L 6.73 6.07 L 7.10 5.78 L 7.50 5.51 L 7.93 5.26 L 8.39 5.04 L 8.89 4.84 L 9.43 4.66 L 10.02 4.51 L 10.66 4.37 L 11.37 4.26 L 12.16 4.16 L 13.07 4.09 L 14.15 4.04 L 15.57 4.01 L 19.00 4.00 L 22.43 4.01 L 23.85 4.04 L 24.93 4.09 L 25.84 4.16 L 26.63 4.26 L 27.34 4.37 L 27.98 4.51 L 28.57 4.66 L 29.11 4.84 L 29.61 5.04 L 30.07 5.26 L 30.50 5.51 L 30.90 5.78 L 31.27 6.07 L 31.61 6.39 L 31.93 6.73 L 32.22 7.10 L 32.49 7.50 L 32.74 7.93 L 32.96 8.39 L 33.16 8.89 L 33.34 9.43 L 33.49 10.02 L 33.63 10.66 L 33.74 11.37 L 33.84 12.16 L 33.91 13.07 L 33.96 14.15 L 33.99 15.57 Z"
        />
        <path
          d="M 14.5 11.3 L 14.5 25.4 L 26.5 25.4"
          fill="none"
          stroke="var(--logo-mark, #fcf9f1)"
          stroke-width="4.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>

    <Teleport to="body">
      <!-- 点击空白处收起 -->
      <Transition name="menu-fade">
        <div v-if="menuOpen" class="project-menu-backdrop" @click="closeMenu" />
      </Transition>

      <!-- 项目菜单面板 -->
      <Transition name="menu-fade">
        <div
          v-if="menuOpen"
          class="project-menu"
          :class="{ 'project-menu--right': !isWin }"
          :style="panelStyle"
        >
          <div class="project-menu__item" @click="handleOpenFile">
            <span class="project-menu__check" />
            <AppIcon name="document" class="project-menu__icon" />
            <span class="project-menu__label">打开文件</span>
          </div>
          <div class="project-menu__item" @click="handleOpenFolder">
            <span class="project-menu__check" />
            <AppIcon name="folder-opened" class="project-menu__icon" />
            <span class="project-menu__label">打开文件夹…</span>
          </div>

          <!-- 打开最近文件（最多 10 份；打开后工作区切到该文件所在目录） -->
          <div
            class="project-menu__item"
            @mouseenter="openSubmenu = 'recent'"
            @mouseleave="openSubmenu = null"
          >
            <span class="project-menu__check" />
            <AppIcon name="refresh" class="project-menu__icon" />
            <span class="project-menu__label">打开最近文件</span>
            <AppIcon name="arrow-right" class="project-menu__arrow" />
            <div v-if="openSubmenu === 'recent'" class="project-menu__submenu">
              <div
                v-for="item in recentFileItems"
                :key="item.path"
                class="project-menu__item"
                :title="item.path"
                @click="handleOpenRecentFile(item.path)"
              >
                <span class="project-menu__check" />
                <AppIcon name="markdown" class="project-menu__icon" />
                <span class="project-menu__label">{{ item.name }}</span>
              </div>
              <div
                v-if="recentFileItems.length === 0"
                class="project-menu__item project-menu__item--disabled"
              >
                <span class="project-menu__check" />
                <span class="project-menu__label">暂无最近文件</span>
              </div>
            </div>
          </div>

          <div class="project-menu__item" @click="handleMoveToDirectory">
            <span class="project-menu__check" />
            <AppIcon name="folder-plus" class="project-menu__icon" />
            <span class="project-menu__label">移动到…</span>
          </div>

          <div
            class="project-menu__item"
            :class="{ 'project-menu__item--disabled': !canRevealLocation }"
            @click="handleRevealLocation"
          >
            <span class="project-menu__check" />
            <AppIcon name="document-copy" class="project-menu__icon" />
            <span class="project-menu__label">打开文件位置</span>
          </div>
          <div class="project-menu__item" @click="handleNewWindow">
            <span class="project-menu__check" />
            <AppIcon name="app-window" class="project-menu__icon" />
            <span class="project-menu__label">打开新窗口</span>
          </div>
          <div class="project-menu__item" @click="handleSave">
            <span class="project-menu__check" />
            <AppIcon name="save" class="project-menu__icon" />
            <span class="project-menu__label">保存</span>
          </div>
          <div class="project-menu__item" @click="handleSaveAs">
            <span class="project-menu__check" />
            <AppIcon name="document-copy" class="project-menu__icon" />
            <span class="project-menu__label">另存为…</span>
          </div>

          <div
            class="project-menu__item"
            @mouseenter="openSubmenu = 'export'"
            @mouseleave="openSubmenu = null"
          >
            <span class="project-menu__check" />
            <AppIcon name="export-file" class="project-menu__icon" />
            <span class="project-menu__label">导出为…</span>
            <AppIcon name="arrow-right" class="project-menu__arrow" />
            <div v-if="openSubmenu === 'export'" class="project-menu__submenu">
              <div class="project-menu__item" @click="handleExport('pdf')">
                <span class="project-menu__check" />
                <AppIcon name="pdf" class="project-menu__icon" />
                <span class="project-menu__label">PDF</span>
              </div>
              <div class="project-menu__item" @click="handleExport('html')">
                <span class="project-menu__check" />
                <AppIcon name="html" class="project-menu__icon" />
                <span class="project-menu__label">HTML</span>
              </div>
              <div class="project-menu__item" @click="handleExport('png')">
                <span class="project-menu__check" />
                <AppIcon name="image" class="project-menu__icon" />
                <span class="project-menu__label">PNG</span>
              </div>
              <div class="project-menu__item" @click="handleExport('txt')">
                <span class="project-menu__check" />
                <AppIcon name="document" class="project-menu__icon" />
                <span class="project-menu__label">TXT</span>
              </div>
              <div class="project-menu__item" @click="handleExport('word')">
                <span class="project-menu__check" />
                <AppIcon name="word-file" class="project-menu__icon" />
                <span class="project-menu__label">WORD</span>
              </div>
            </div>
          </div>

          <div
            class="project-menu__item"
            @mouseenter="openSubmenu = 'theme'"
            @mouseleave="openSubmenu = null"
          >
            <span class="project-menu__check" />
            <AppIcon name="waiguan" class="project-menu__icon" />
            <span class="project-menu__label">切换主题</span>
            <AppIcon name="arrow-right" class="project-menu__arrow" />
            <div
              v-if="openSubmenu === 'theme'"
              class="project-menu__submenu project-menu__submenu--themes"
            >
              <div
                v-for="theme in themes"
                :key="theme.name"
                class="project-menu__item"
                :title="theme.description"
                @click="handleThemeSelect(theme.name)"
              >
                <span class="project-menu__check">{{
                  theme.name === currentTheme ? "✓" : ""
                }}</span>
                <span class="project-menu__label">{{ theme.label }}</span>
              </div>
            </div>
          </div>

          <div class="project-menu__item" @click="handleToggleAutoSave">
            <span class="project-menu__check">{{ autoSaveEnabled ? "✓" : "" }}</span>
            <AppIcon name="refresh" class="project-menu__icon" />
            <span class="project-menu__label">自动保存</span>
          </div>
          <div class="project-menu__item" @click="handleOpenSettings">
            <span class="project-menu__check" />
            <AppIcon name="config-props" class="project-menu__icon" />
            <span class="project-menu__label">首选项</span>
          </div>
        </div>
      </Transition>

      <!-- 首选项：全屏设置面板（沿用原样式） -->
      <Transition name="menu-fade">
        <div v-if="settingsOpen" class="menu-overlay" @click="settingsOpen = false">
          <button
            class="menu-close-button"
            type="button"
            aria-label="关闭菜单"
            @click.stop="settingsOpen = false"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
          <div class="dropdown-content" @click.stop>
            <MenuBar />
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style lang="less" scoped>
.MenuDropDownBox {
  height: 100%;
  flex-shrink: 0;
  display: flex;
  align-items: center;

  .dropdown-header {
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    margin-left: 6px;
    padding: 0 10px;
    height: 34px;
    border: none;
    border-radius: 12px;
    background: transparent;
    -webkit-app-region: no-drag;

    &:hover {
      background: var(--hover-color);
    }

    .logo {
      display: inline-block;
      // 16px 实心底板：小尺寸下 L 字母仍可辨认（原 13px 空心环几乎看不出字母）
      width: 16px;
      height: 18px;
      transition: 0.2s;
      color: var(--primary-color);

      &.active {
        transform: rotate(180deg);
      }
    }
  }
}

/* ============ 项目菜单（下拉列表） ============ */

.project-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9000;
  background: transparent;
}

.project-menu {
  position: fixed;
  z-index: 9001;
  min-width: 208px;
  padding: 6px;
  border: 1px solid color-mix(in srgb, var(--border-color-1) 84%, transparent);
  border-radius: 10px;
  background: var(--background-color-1);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.2);
  color: var(--text-color-1);
  font-size: 13px;

  &__item {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border-radius: 6px;
    cursor: pointer;
    white-space: nowrap;
    transition: background-color 0.12s ease;

    &:hover {
      background: var(--hover-background-color, rgba(0, 0, 0, 0.06));
    }
  }

  // 勾选位：自动保存 / 当前主题等可勾选菜单项在文字前方显示
  &__check {
    width: 14px;
    flex-shrink: 0;
    text-align: center;
    color: var(--primary-color);
    font-size: 12px;
    line-height: 1;
  }

  &__icon {
    flex-shrink: 0;
    font-size: 15px;
    color: var(--text-color-3);
  }

  &__label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__arrow {
    margin-left: 12px;
    flex-shrink: 0;
    font-size: 12px;
    color: var(--text-color-3);
  }

  // 二级菜单：悬停展开，紧贴父项右缘（无间隙避免鼠标穿越时误收起）
  &__submenu {
    position: absolute;
    top: -6px;
    left: 100%;
    min-width: 168px;
    max-height: min(60vh, 520px);
    overflow-y: auto;
    padding: 4px;
    border: 1px solid color-mix(in srgb, var(--border-color-1) 84%, transparent);
    border-radius: 8px;
    background: var(--background-color-1);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2);

    &--themes {
      min-width: 200px;
    }
  }

  // 右侧布局（macOS/Linux：按钮位于标题栏右缘，二级菜单向左展开）
  &--right {
    .project-menu__submenu {
      left: auto;
      right: 100%;
    }
  }
}

/* ============ 首选项：全屏设置面板 ============ */

.menu-overlay {
  position: fixed;
  inset: 0;
  z-index: 99;
  padding-top: 45px;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  background: rgba(10, 14, 24, 0.28);
  backdrop-filter: blur(12px);
  -webkit-app-region: no-drag;
}

.menu-close-button {
  position: fixed;
  top: 58px;
  right: 18px;
  z-index: 1;
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid color-mix(in srgb, var(--border-color-1) 82%, transparent);
  border-radius: 999px;
  color: var(--text-color);
  background: color-mix(in srgb, var(--background-color-1) 88%, transparent);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.18);
  cursor: pointer;
  transition:
    background-color 0.18s ease,
    border-color 0.18s ease,
    color 0.18s ease,
    transform 0.18s ease;

  &:hover {
    color: var(--primary-color);
    border-color: color-mix(in srgb, var(--primary-color) 56%, var(--border-color-1));
    background: var(--hover-color);
    transform: translateY(-1px);
  }
}

.dropdown-content {
  width: 100%;
  height: 100%;
  border-radius: 12px 12px 0 0;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--border-color-1) 84%, transparent);
  background: color-mix(in srgb, var(--background-color-1) 94%, transparent);
  box-shadow: 0 28px 72px rgba(0, 0, 0, 0.28);
  white-space: nowrap;
}

/* 不可用的菜单项（如未打开文档且无工作区时的「打开文件位置」） */
.project-menu__item--disabled {
  opacity: 0.45;
  cursor: default;

  &:hover {
    background: transparent;
  }
}

.menu-fade-enter-active,
.menu-fade-leave-active {
  transition: opacity 0.18s ease;
}

.menu-fade-enter-from,
.menu-fade-leave-to {
  opacity: 0;
}
</style>
