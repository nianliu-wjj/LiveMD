<script setup lang="ts">
/**
 * 大纲栏容器：贴窗口右缘悬浮列（大纲从左侧栏迁入右缘三栏，§2）
 *
 * - 布局与 AnnotationBar 同构：position: fixed 贴右缘，不进 editorArea 的 flex 布局
 * - 宽度拖拽（240–480，livemd-outline-bar-width 持久化；与批注/书签栏共用 useBarResize）
 * - 折叠状态按文档持久化：沿用旧 Outline.vue 的 localStorage 键与 key 格式
 *   （livemd-outline-collapsed，headingKey = `${level}::${text}`，老数据无缝迁移）
 * - 右缘三栏互斥协议：展开前收起批注栏与书签栏（hideOtherEdgeBars）
 * - 贴边便签与悬浮栏骨架使用右缘公共样式（styles/right-edge.less）
 * - 外部展开入口：emitter outline:show-bar / sidebar:set-tab(tab=outline)
 */
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import AppIcon from "@/renderer/components/ui/AppIcon.vue";
import emitter from "@/renderer/events";
import useBarResize from "@/renderer/hooks/useBarResize";
import useOutline from "@/renderer/hooks/useOutline";
import useTab from "@/renderer/hooks/useTab";
import { hideOtherEdgeBars, reportEdgeBarState } from "@/renderer/utils/rightEdgeBars";

type OutlineItem = { id: string; level: number; text: string; pos: number };
type OutlineRow = {
  item: OutlineItem;
  hasChildren: boolean;
};

const { outline } = useOutline();
const { currentTab } = useTab();

/** 打开大纲栏（贴边便签/命令面板入口），并收起批注栏与书签栏（互斥协议） */
function showBar(): void {
  setBarVisible(true);
  hideOtherEdgeBars("outline");
}

/** 批注栏/书签栏请求收起大纲栏（互斥协议） */
function handleHideBar(): void {
  setBarVisible(false);
}

// ============ 栏可见性与宽度 ============

const BAR_VISIBLE_KEY = "livemd-outline-bar-visible";
// 启动一律折叠（首页需求）：不读取上次的展开状态；会话内展开/收起仍写入该键
const barVisible = ref(false);

function setBarVisible(visible: boolean): void {
  barVisible.value = visible;
  try {
    localStorage.setItem(BAR_VISIBLE_KEY, String(visible));
  } catch {
    // 忽略持久化失败
  }
}

// 宽度拖拽（240–480 夹取 + livemd-outline-bar-width 持久化）：与批注/书签栏共用 useBarResize
const { barWidth, startResize } = useBarResize({
  storageKey: "livemd-outline-bar-width",
  defaultWidth: 300,
});

// 上报展开状态与宽度：其余两栏便签让位到本面板左侧（右缘互斥协议工具）
watch([barVisible, barWidth], ([visible, width]) => reportEdgeBarState("outline", visible, width), {
  immediate: true,
});

// ============ 折叠状态按文档持久化（沿用旧 Outline.vue 的键与格式）============

// 折叠状态：记录哪些标题被折叠了（key 是 heading id）
const collapsedSet = reactive(new Set<string>());

const OUTLINE_COLLAPSE_STORAGE_KEY = "livemd-outline-collapsed";
type CollapsedMap = Record<string, string[]>;

function readCollapsedMap(): CollapsedMap {
  try {
    const raw = localStorage.getItem(OUTLINE_COLLAPSE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: CollapsedMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (Array.isArray(value)) {
        result[key] = value.filter((item): item is string => typeof item === "string");
      }
    }
    return result;
  } catch {
    return {};
  }
}

const collapsedMap = ref<CollapsedMap>(readCollapsedMap());
const currentDocKey = computed(() => {
  const tab = currentTab.value;
  if (!tab) return "none";
  return tab.filePath ? `file:${tab.filePath}` : `tab:${tab.id}`;
});

function headingKey(item: OutlineItem): string {
  return `${item.level}::${item.text}`;
}

/** 依据持久化数据恢复当前文档的折叠状态 */
function syncCollapsedFromStorage() {
  collapsedSet.clear();
  const keys = new Set(collapsedMap.value[currentDocKey.value] ?? []);
  if (keys.size === 0) return;
  for (const item of outline.value) {
    if (keys.has(headingKey(item))) {
      collapsedSet.add(item.id);
    }
  }
}

/** 将当前折叠状态写回 localStorage */
function persistCollapsed() {
  const keys = outline.value.filter((item) => collapsedSet.has(item.id)).map(headingKey);
  const next: CollapsedMap = { ...collapsedMap.value };
  if (keys.length > 0) {
    next[currentDocKey.value] = keys;
  } else {
    delete next[currentDocKey.value];
  }
  collapsedMap.value = next;
  try {
    localStorage.setItem(OUTLINE_COLLAPSE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage 不可用时仅保留内存状态
  }
}

watch([outline, currentDocKey], syncCollapsedFromStorage, { immediate: true });

// 当前光标所在标题（用于大纲高亮）
const activeOutlineId = computed<string | null>(() => {
  const cursor = currentTab.value?.milkdownCursorOffset;
  if (typeof cursor !== "number") return null;
  let active: OutlineItem | null = null;
  for (const item of outline.value) {
    if (item.pos <= cursor) {
      active = item;
    } else {
      break;
    }
  }
  return active?.id ?? null;
});

const outlineRows = computed<OutlineRow[]>(() => {
  const items = outline.value;
  const rows: OutlineRow[] = [];
  const collapsedAncestorLevels: number[] = [];

  items.forEach((item, index) => {
    while (
      collapsedAncestorLevels.length > 0 &&
      collapsedAncestorLevels[collapsedAncestorLevels.length - 1] >= item.level
    ) {
      collapsedAncestorLevels.pop();
    }

    const hasCollapsedAncestor = collapsedAncestorLevels.length > 0;
    const hasChildHeading = index + 1 < items.length && items[index + 1].level > item.level;

    if (!hasCollapsedAncestor) {
      rows.push({
        item,
        hasChildren: hasChildHeading,
      });
    }

    if (hasChildHeading && collapsedSet.has(item.id)) {
      collapsedAncestorLevels.push(item.level);
    }
  });

  return rows;
});

// 判断某个标题是否有子标题
function hasChildren(index: number): boolean {
  const items = outline.value;
  const currentLevel = items[index].level;
  return index + 1 < items.length && items[index + 1].level > currentLevel;
}

/** 所有可折叠标题是否均处于展开状态（手动逐一展开同样成立），驱动单按钮的动作切换 */
const isAllExpanded = computed(() => {
  const items = outline.value;
  for (let index = 0; index < items.length; index += 1) {
    if (hasChildren(index) && collapsedSet.has(items[index].id)) {
      return false;
    }
  }
  return true;
});

function toggleCollapse(oi: OutlineItem) {
  if (collapsedSet.has(oi.id)) {
    collapsedSet.delete(oi.id);
  } else {
    collapsedSet.add(oi.id);
  }
  persistCollapsed();
}

function onOiClick(oi: OutlineItem) {
  emitter.emit("outline:scrollTo", oi.pos);
}

// ============ 右键菜单（沿用旧 Outline.vue 的折叠子菜单）============

const contextMenu = ref<{
  visible: boolean;
  x: number;
  y: number;
  item: OutlineItem | null;
}>({
  visible: false,
  x: 0,
  y: 0,
  item: null,
});

// 折叠子菜单
const showCollapseSubmenu = ref(false);

function onItemContextMenu(e: MouseEvent, oi: OutlineItem) {
  e.preventDefault();
  e.stopPropagation();
  showCollapseSubmenu.value = false;
  contextMenu.value = {
    visible: true,
    x: e.clientX,
    y: e.clientY,
    item: oi,
  };
}

function closeContextMenu() {
  contextMenu.value.visible = false;
  showCollapseSubmenu.value = false;
}

function handleJump() {
  if (contextMenu.value.item) {
    emitter.emit("outline:scrollTo", contextMenu.value.item.pos);
  }
  closeContextMenu();
}

function collapseByLevel(level: number) {
  // 折叠所有该级别的标题（只折叠有子标题的）
  outline.value.forEach((oi, index) => {
    if (oi.level === level && hasChildren(index)) {
      collapsedSet.add(oi.id);
    }
  });
  persistCollapsed();
  closeContextMenu();
}

function collapseAll() {
  outline.value.forEach((oi, index) => {
    if (hasChildren(index)) {
      collapsedSet.add(oi.id);
    }
  });
  persistCollapsed();
  closeContextMenu();
}

function expandAll() {
  collapsedSet.clear();
  persistCollapsed();
  closeContextMenu();
}

/** 折叠按钮：全部展开时执行全折叠；否则（含手动部分折叠）执行全展开 */
function toggleCollapseAll(): void {
  if (isAllExpanded.value) {
    collapseAll();
  } else {
    expandAll();
  }
}

// 全局点击关闭菜单
function onDocClick() {
  closeContextMenu();
}

// ============ 事件订阅 ============

/** sidebar:set-tab（大纲 tab 已迁出到右缘栏，这里只响应 outline） */
function handleSidebarSetTab(payload?: { tab?: string; show?: boolean }): void {
  if (payload?.tab === "outline") {
    showBar();
  }
}

onMounted(() => {
  document.addEventListener("click", onDocClick);
  emitter.on("outline:hide-bar", handleHideBar);
  emitter.on("outline:show-bar", showBar);
  emitter.on("sidebar:set-tab", handleSidebarSetTab);
});

onUnmounted(() => {
  document.removeEventListener("click", onDocClick);
  emitter.off("outline:hide-bar", handleHideBar);
  emitter.off("outline:show-bar", showBar);
  emitter.off("sidebar:set-tab", handleSidebarSetTab);
});
</script>

<template>
  <!-- 贴边收起态：第 1 槽竖排便签（大纲 → 批注 → 书签 自上而下） -->
  <button
    v-if="!barVisible"
    type="button"
    class="right-edge-tab"
    title="展开大纲栏"
    @click="showBar"
  >
    大纲
  </button>

  <!-- 展开态：右缘悬浮栏 -->
  <div v-else class="right-edge-bar" :style="{ width: `${barWidth}px` }">
    <div class="right-edge-bar__resize-handle" @pointerdown="startResize" />
    <div class="right-edge-bar__header">
      <span class="right-edge-bar__title">大纲</span>
      <div class="right-edge-bar__header-actions">
        <button
          type="button"
          class="outline-bar__toggle"
          :title="isAllExpanded ? '全部折叠' : '全部展开'"
          @click="toggleCollapseAll"
        >
          <AppIcon :name="isAllExpanded ? 'chevrons-down-up' : 'chevrons-up-down'" />
        </button>
      </div>
    </div>

    <!-- 折叠把手：吸附左边框垂直中点 -->
    <button
      type="button"
      class="right-edge-bar__fold"
      title="收起大纲栏"
      @click="setBarVisible(false)"
    >
      <AppIcon name="arrow-right" />
    </button>

    <div class="right-edge-bar__list">
      <template v-if="outline.length > 0">
        <div
          v-for="{ item: oi, hasChildren: itemHasChildren } in outlineRows"
          :key="oi.id"
          class="outline-bar__item"
          :class="{ active: activeOutlineId === oi.id }"
          :style="{ paddingLeft: `${oi.level * 12}px` }"
          @click="onOiClick(oi)"
          @contextmenu="onItemContextMenu($event, oi)"
        >
          <span
            v-if="itemHasChildren"
            class="collapse-icon"
            :class="{ collapsed: collapsedSet.has(oi.id) }"
            @click.stop="toggleCollapse(oi)"
          >
            <AppIcon name="arrow-right" />
          </span>
          <span v-else class="collapse-icon-placeholder"></span>
          <span class="outline-bar__item-text">{{ oi.text }}</span>
        </div>
      </template>
      <div v-else class="right-edge-bar__empty">
        <AppIcon name="List-outlined" class="right-edge-bar__empty-icon" />
        <p class="right-edge-bar__empty-text">暂无大纲</p>
        <p class="right-edge-bar__empty-hint">编辑文档时自动生成标题大纲</p>
      </div>
    </div>
  </div>

  <!-- 右键菜单 -->
  <Teleport to="body">
    <div
      v-if="contextMenu.visible"
      class="outline-context-menu"
      :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
      @click.stop
    >
      <div class="outline-ctx-item" @click="handleJump">
        <span>跳转到该位置</span>
      </div>
      <div class="outline-ctx-divider" />
      <div
        class="outline-ctx-item has-submenu"
        @mouseenter="showCollapseSubmenu = true"
        @mouseleave="showCollapseSubmenu = false"
      >
        <span>折叠</span>
        <AppIcon name="arrow-right" class="submenu-arrow" />
        <!-- 二级菜单 -->
        <div v-if="showCollapseSubmenu" class="outline-submenu">
          <div class="outline-ctx-item" @click="collapseByLevel(1)">折叠一级标题</div>
          <div class="outline-ctx-item" @click="collapseByLevel(2)">折叠二级标题</div>
          <div class="outline-ctx-item" @click="collapseByLevel(3)">折叠三级标题</div>
          <div class="outline-ctx-item" @click="collapseByLevel(4)">折叠四级标题</div>
          <div class="outline-ctx-item" @click="collapseByLevel(5)">折叠五级标题</div>
          <div class="outline-ctx-item" @click="collapseByLevel(6)">折叠六级标题</div>
          <div class="outline-ctx-divider" />
          <div class="outline-ctx-item" @click="collapseAll">折叠全部</div>
          <div class="outline-ctx-item" @click="expandAll">展开全部</div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style lang="less" scoped>
// 全部折叠/展开：单图标按钮，图标与动作随折叠状态切换
.outline-bar__toggle {
  display: inline-flex;
  align-items: center;
  font-size: 15px;
}

.outline-bar__item {
  display: flex;
  align-items: center;
  width: 100%;
  color: var(--text-color-1, #333);
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: all 0.2s ease;
  padding: 4px 4px;
  border-radius: 4px;
  margin: 0 2px;
  // 条目过多时不随 flex 容器压缩（否则行高被压扁导致文字互相叠压），改为容器滚动
  flex-shrink: 0;

  &:hover {
    background: var(--background-color-1, #fff);
  }

  &.active {
    background: color-mix(in srgb, var(--primary-color, #4a9eff) 14%, transparent);
    color: var(--primary-color, #4a9eff);
    font-weight: 500;
  }

  .collapse-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    margin-right: 4px;
    transition: transform 0.2s;
    transform: rotate(90deg);
    color: var(--text-color-3, #999);
    font-size: 10px;
    border-radius: 3px;

    &:hover {
      background: var(--hover-background-color, rgba(0, 0, 0, 0.06));
    }

    &.collapsed {
      transform: rotate(0deg);
    }
  }

  .collapse-icon-placeholder {
    display: inline-block;
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    margin-right: 4px;
  }
}

.outline-bar__item-text {
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>

<style lang="less">
// 大纲右键菜单（与旧 Outline.vue 同名同构，全局样式供 Teleport 使用）
.outline-context-menu {
  position: fixed;
  z-index: 10000;
  min-width: 140px;
  background: var(--background-color-1);
  border: 1px solid var(--border-color-1);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 4px 0;
  font-size: 12px;

  .outline-ctx-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 12px;
    cursor: pointer;
    color: var(--text-color-1);
    transition: background-color 0.15s;
    position: relative;
    white-space: nowrap;

    &:hover {
      background: var(--hover-background-color);
    }

    .submenu-arrow {
      font-size: 10px;
      color: var(--text-color-3);
    }
  }

  .outline-ctx-divider {
    height: 1px;
    background: var(--border-color-1);
    margin: 4px 0;
  }

  .has-submenu {
    position: relative;
  }

  .outline-submenu {
    position: absolute;
    left: 100%;
    top: -4px;
    min-width: 130px;
    background: var(--background-color-1);
    border: 1px solid var(--border-color-1);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    padding: 4px 0;
  }
}
</style>
