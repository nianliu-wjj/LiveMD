<script setup lang="ts">
/**
 * 主题面板（对应参考项目 Theme.vue），面板名 theme
 *
 * - 主题分三组（与参考项目分类方式一致）：经典（非深色、非朴素）、深色（dark 为 true）、
 *   朴素（参考项目 baiduThemes 列表）；列表为「默认主题 + 58 套扩展主题」倒序；
 * - 点击主题：当前自定义过基础样式（getCustomThemeConfig 非空）时先询问「覆盖 / 保留」，
 *   覆盖则清空自定义配置，关闭询问框则不切换；切换时显示加载态、setTheme 并 notifyChange；
 * - 监听 view_theme_change（含导入数据等其它途径改变主题）：同步高亮，并按主题明暗切换编辑器界面
 *   明暗（对应参考项目 handleDark → localConfig.isDark）。
 *
 * 参考项目的扩展主题分组（store.extendThemeGroupList，外部注入）在 LiveMD 中没有来源，不做。
 */
import { computed, ref, watch } from "vue";
import engineThemeList from "@/core/mindmap-engine/themes/themeList";
import themeImgMap from "@/core/mindmap-engine/themes/themeImgMap";
import MmPanel from "../ui/MmPanel.vue";
import MmDialog from "../ui/MmDialog.vue";
import { useBusEvent, useMindMapContext } from "../context";

interface ThemeItem {
  name: string;
  value: string;
  dark: boolean;
  /** 自定义预览图（参考项目扩展主题使用，内置主题取 themeImgMap） */
  img?: string;
}

interface ThemeGroup {
  name: string;
  list: ThemeItem[];
}

/** 「朴素」分组的主题（参考项目 initGroup 中的 baiduThemes） */
const SIMPLE_THEMES = [
  "default",
  "skyGreen",
  "classic2",
  "classic3",
  "classicGreen",
  "classicBlue",
  "blueSky",
  "brainImpairedPink",
  "earthYellow",
  "freshGreen",
  "freshRed",
  "romanticPurple",
  "pinkGrape",
  "mint",
];

const { mindMap, bus, activeSidebar, isDark, notifyChange } = useMindMapContext();

/** 默认主题 + 扩展主题，倒序（与参考项目一致） */
const themeList: ThemeItem[] = [
  { name: "默认主题", value: "default", dark: false },
  ...engineThemeList.map((item) => ({ name: item.name, value: item.value, dark: item.dark })),
].reverse();

/** 主题分组（对应参考项目 initGroup） */
const groupList: ThemeGroup[] = (() => {
  const simpleList: ThemeItem[] = [];
  const classicsList: ThemeItem[] = [];
  for (const item of themeList) {
    if (SIMPLE_THEMES.includes(item.value)) {
      simpleList.push(item);
    } else if (!item.dark) {
      classicsList.push(item);
    }
  }
  return [
    { name: "经典", list: classicsList },
    { name: "深色", list: themeList.filter((item) => item.dark) },
    { name: "朴素", list: simpleList },
  ];
})();

const activeName = ref(groupList[0].name);
const currentList = computed(
  () => groupList.find((group) => group.name === activeName.value)?.list ?? []
);
/** 当前主题（高亮用） */
const theme = ref(mindMap.value?.getTheme() ?? "");

/** 「是否覆盖自定义样式」询问框 */
const coverDialogVisible = ref(false);
/** 询问框打开期间等待切换的主题 */
let pendingTheme: ThemeItem | null = null;

function previewOf(item: ThemeItem): string {
  return item.img || themeImgMap[item.value] || "";
}

/** 按当前主题的明暗切换编辑器界面明暗（对应参考项目 handleDark） */
function handleDark(): void {
  const target = themeList.find((item) => item.value === theme.value);
  if (!target) return;
  if (isDark.value !== target.dark) {
    console.info("[MindMap/Theme] 主题明暗变化，切换界面为", target.dark ? "暗色" : "亮色");
    isDark.value = target.dark;
  }
}

/** 点击主题（对应参考项目 useTheme） */
function selectTheme(item: ThemeItem): void {
  const instance = mindMap.value;
  if (!instance || item.value === theme.value) return;
  const customThemeConfig = instance.getCustomThemeConfig() ?? {};
  if (Object.keys(customThemeConfig).length > 0) {
    // 自定义过基础样式：询问覆盖还是保留（关闭询问框则不切换）
    pendingTheme = item;
    coverDialogVisible.value = true;
    return;
  }
  changeTheme(item);
}

/** 切换主题（对应参考项目 changeTheme：showLoading + setTheme + storeData） */
function changeTheme(item: ThemeItem): void {
  const instance = mindMap.value;
  if (!instance) return;
  console.info("[MindMap/Theme] 切换主题:", item.value);
  bus.emit("showLoading");
  instance.setTheme(item.value);
  notifyChange();
}

/** 覆盖：清空自定义基础样式后切换 */
function onCover(): void {
  const item = pendingTheme;
  pendingTheme = null;
  coverDialogVisible.value = false;
  const instance = mindMap.value;
  if (!item || !instance) return;
  console.info("[MindMap/Theme] 覆盖自定义基础样式");
  instance.setThemeConfig({}, true);
  changeTheme(item);
}

/** 保留：保留自定义基础样式切换 */
function onReserve(): void {
  const item = pendingTheme;
  pendingTheme = null;
  coverDialogVisible.value = false;
  if (item) changeTheme(item);
}

/** 关闭询问框（× / 遮罩 / Esc）：不切换主题 */
function onCoverDialogToggle(visible: boolean): void {
  coverDialogVisible.value = visible;
  if (!visible) pendingTheme = null;
}

watch(activeSidebar, (value) => {
  if (value === "theme" && mindMap.value) theme.value = mindMap.value.getTheme();
});

// 主题变化（本面板切换、导入数据等），对应参考项目 handleViewThemeChange
useBusEvent("view_theme_change", () => {
  const instance = mindMap.value;
  if (!instance) return;
  theme.value = instance.getTheme();
  handleDark();
});
</script>

<template>
  <MmPanel name="theme" title="主题">
    <div class="mm-theme">
      <div class="mm-theme__tabs" role="tablist">
        <button
          v-for="group in groupList"
          :key="group.name"
          type="button"
          class="mm-theme__tab"
          :class="{ 'is-active': group.name === activeName }"
          role="tab"
          :aria-selected="group.name === activeName"
          @click="activeName = group.name"
        >
          {{ group.name }}
        </button>
      </div>
      <div class="mm-theme__list">
        <div
          v-for="item in currentList"
          :key="item.value"
          class="mm-theme__item"
          :class="{ 'is-active': item.value === theme }"
          :title="item.name"
          @click="selectTheme(item)"
        >
          <img class="mm-theme__img" :src="previewOf(item)" alt="" draggable="false" />
          <div class="mm-theme__name">{{ item.name }}</div>
        </div>
      </div>
    </div>
  </MmPanel>

  <!-- 放在面板外：面板是定位元素，放在里面时遮罩只能盖住面板 -->
  <MmDialog
    :model-value="coverDialogVisible"
    title="提示"
    width="420px"
    @update:model-value="onCoverDialogToggle"
  >
    <p class="mm-theme__tip">你当前自定义过基础样式，是否覆盖？</p>
    <template #footer>
      <button type="button" class="mm-btn" @click="onReserve">保留</button>
      <button type="button" class="mm-btn mm-btn--primary" @click="onCover">覆盖</button>
    </template>
  </MmDialog>
</template>

<style lang="less" scoped>
/* 占满面板内容区：分组页签固定，主题列表单独滚动 */
.mm-theme {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.mm-theme__tabs {
  display: flex;
  flex-shrink: 0;
  justify-content: center;
  gap: 4px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--border-color-1, #e4e7ed);
}

.mm-theme__tab {
  margin-bottom: -1px;
  padding: 6px 14px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--text-color-2, #606266);
  font-size: 13px;
  cursor: pointer;

  &:hover {
    color: var(--primary-color, #409eff);
  }

  &.is-active {
    border-bottom-color: var(--primary-color, #409eff);
    color: var(--primary-color, #409eff);
    font-weight: 600;
  }
}

.mm-theme__list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 4px;
}

.mm-theme__item {
  margin-bottom: 16px;
  padding-bottom: 6px;
  border: 3px solid transparent;
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
  transition:
    box-shadow 0.2s,
    border-color 0.2s;

  &:hover {
    box-shadow:
      0 1px 2px -2px rgba(0, 0, 0, 0.16),
      0 3px 6px 0 rgba(0, 0, 0, 0.12),
      0 5px 12px 4px rgba(0, 0, 0, 0.09);
  }

  &.is-active {
    border-color: color-mix(in srgb, var(--primary-color, #409eff) 55%, transparent);
  }
}

.mm-theme__img {
  display: block;
  width: 100%;
}

.mm-theme__name {
  margin-top: 4px;
  text-align: center;
  font-size: 13px;
  color: var(--text-color-1, #333);
}

.mm-theme__tip {
  margin: 0;
  line-height: 1.7;
}
</style>
