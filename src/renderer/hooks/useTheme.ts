import type { Theme, ThemeName } from "@/types/theme";
import autotoast from "autotoast.js";
import { getCurrentInstance, onMounted, onUnmounted, ref, toRaw } from "vue";
import { cssVarsDesMap } from "@/config/theme";
import { builtinThemes, DEFAULT_THEME, migrateThemeName } from "@/themes/catalog";
import themeManager from "@/renderer/utils/themeManager";
import { randomUUID } from "@/renderer/utils/tool";
import { isThemeObject } from "@/types/theme";

const currentTheme = ref<ThemeName>(DEFAULT_THEME);
const tempTheme = ref<Theme>();
const themes = ref<Theme[]>([]);
let requestId = 0;
let persistCurrentTheme = true;
let appliedCustomKeys: string[] = [];

// 主题列表：内置 catalog + 本地自定义主题
function getThemes(): Theme[] {
  return [
    ...builtinThemes,
    ...themeManager
      .getLocalThemes()
      .filter((theme) => !builtinThemes.some((builtin) => builtin.name === theme.name)),
  ];
}

// 根据类名获取主题（含旧名迁移）
function getThemeByCn(name: ThemeName): Theme {
  if (!themes.value.length) themes.value = getThemes();
  return themes.value.find((theme) => theme.name === migrateThemeName(name)) || themes.value[0];
}

function clearThemeResidue(html: HTMLElement) {
  html.classList.remove(
    ...Array.from(html.classList).filter((value) => value.startsWith("theme-"))
  );
  html.style.removeProperty("background");
  for (const key of appliedCustomKeys) html.style.removeProperty(key);
  html.style.removeProperty("--primary-color");
  appliedCustomKeys = [];
  document.getElementById("custom-theme-style")?.remove();
  // 兼容旧版注入的编辑器主题 link（现已随主题体系废弃）
  document.getElementById("milkdown-theme")?.remove();
}

// 设置主题：catalog 驱动 + 双路径加载
// - Typora 官方主题（cssFile）：动态 <link id="typora-theme-css">，requestId 竞态防护
// - 存量变量主题：样式已在 bundle（theme-main.less），直接切换 html 类名
async function setTheme(
  name: ThemeName = currentTheme.value,
  options: { persist?: boolean } = {}
): Promise<void> {
  if (!themes.value.length) themes.value = getThemes();
  const theme = getThemeByCn(name);
  const base =
    builtinThemes.find((item) => item.name === (theme.baseTheme || theme.name)) || builtinThemes[0];
  const html = document.documentElement;
  const id = ++requestId;

  if (base.cssFile) {
    const href = new URL(`${import.meta.env.BASE_URL}${base.cssFile}`, document.baseURI).href;
    let link = document.getElementById("typora-theme-css") as HTMLLinkElement | null;
    if (link?.href !== href) {
      const candidate = document.createElement("link");
      candidate.rel = "stylesheet";
      candidate.href = href;
      try {
        await new Promise<void>((resolve, reject) => {
          candidate.onload = () => resolve();
          candidate.onerror = () => reject(new Error(`主题样式加载失败：${theme.label}`));
          document.head.appendChild(candidate);
        });
      } catch (error) {
        candidate.remove();
        autotoast.show(String(error), "error");
        return;
      }
      if (id !== requestId) {
        candidate.remove();
        return;
      }
      link?.remove();
      candidate.id = "typora-theme-css";
      link = candidate;
    }
  } else {
    // 存量变量主题：清理 Typora 主题注入痕迹
    document.getElementById("typora-theme-css")?.remove();
    delete html.dataset.typoraTheme;
  }
  if (id !== requestId) return;

  // 公共：清旧类/内联变量 → dataset.themeMode + colorScheme → 类切换
  clearThemeResidue(html);
  if (base.cssFile) html.dataset.typoraTheme = base.name;
  html.dataset.themeMode =
    theme.dark === undefined ? (base.dark ? "dark" : "light") : theme.dark ? "dark" : "light";
  html.style.colorScheme = html.dataset.themeMode;
  html.classList.add(`theme-${theme.name}`);
  if (theme.isCustom) {
    // 自定义主题：主题变量内联到 html.style；存量基底主题类保留用于缺省回退
    if (theme.baseTheme && !base.cssFile) html.classList.add(`theme-${theme.baseTheme}`);
    for (const [key, value] of Object.entries(theme.data.themeProperties || {})) {
      if (key.startsWith("--") && typeof value === "string") {
        html.style.setProperty(key, value);
        appliedCustomKeys.push(key);
      }
    }
  }
  currentTheme.value = theme.name;
  persistCurrentTheme = options.persist !== false;
  if (options.persist !== false) themeManager.setCurrentLocalTheme(theme.name);
  window.dispatchEvent(new CustomEvent("theme:changed", { detail: theme.name }));
}

// 初始化主题
function init() {
  return setTheme(themeManager.getCurrentLocalTheme());
}

// 初始化主题列表
if (!themes.value.length) themes.value = getThemes();

// 保存主题
function saveTheme() {
  if (!tempTheme.value) return;
  themeManager.addLocalTheme(JSON.parse(JSON.stringify(toRaw(tempTheme.value))));
}

// 添加临时主题：编辑已有主题或基于当前主题派生自定义主题
function addTempTheme(name?: ThemeName) {
  if (name) {
    themeManager.setEditingThemeToStorage(name);
  } else {
    const source = getThemeByCn(currentTheme.value);
    tempTheme.value = {
      ...JSON.parse(JSON.stringify(source)),
      name: `custom-${randomUUID()}`,
      label: "自定义主题",
      description: `基于 ${source.label} 的自定义主题`,
      baseTheme: source.baseTheme || source.name,
      isCustom: true,
    };
    localStorage.setItem("theme-draft", JSON.stringify(tempTheme.value));
  }
  window.electronAPI.openThemeEditor();
}

// 删除本地主题
function removeTheme(name: ThemeName) {
  themeManager.removeLocalTheme(name);
  themes.value = getThemes();
  if (currentTheme.value === name) void setTheme(DEFAULT_THEME);
}

// 监听本地主题变化（多窗口同步）
function watchLocalThemes(callback: (themes: Theme[] | null) => void) {
  return themeManager.onThemesChange(callback);
}

themeManager.onThemesChange(() => {
  themes.value = getThemes();
  if (themes.value.some((theme) => theme.name === currentTheme.value))
    void setTheme(currentTheme.value, { persist: persistCurrentTheme });
});

// 导出主题 JSON（内置主题导出为可再定义的自定义主题）
function exportTheme(name: ThemeName) {
  const source = getThemeByCn(name);
  const theme = {
    ...source,
    name: `custom-${randomUUID()}`,
    baseTheme: source.baseTheme || source.name,
    isCustom: true,
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(theme, null, 2)], { type: "application/json" })
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `${source.label}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  autotoast.show("导出完成", "success");
}

// 导入主题 JSON
function importTheme(json: string) {
  try {
    const theme: unknown = JSON.parse(json);
    if (!isThemeObject(theme)) throw new Error("主题格式错误");
    theme.isCustom = true;
    if (builtinThemes.some((item) => item.name === theme.name)) {
      theme.baseTheme = theme.name;
      theme.name = `custom-${randomUUID()}`;
    }
    themeManager.addLocalTheme(theme);
    autotoast.show("导入主题完成", "success");
  } catch {
    autotoast.show("导入主题格式错误", "error");
  }
}
// 获取所有css变量解释
function getAllCssVarsDes() {
  return cssVarsDesMap;
}

export default function useTheme() {
  if (getCurrentInstance()) {
    onMounted(() => {});
    onUnmounted(() => {
      themeManager.uninstallListeners();
    });
  }
  return {
    // 主题变量
    themes,
    currentTheme,
    tempTheme,
    localThemes: themeManager.localThemes,

    // 增删改查
    init,
    getThemes,
    setTheme,
    saveTheme,
    removeTheme,
    addTempTheme,
    getThemeByCn,
    getAllCssVarsDes,

    // 监听主题
    watchLocalThemes,

    // 编辑主题
    getEditingThemeFromStorage: themeManager.getEditingThemeFromStorage,
    clearEditingThemeFromStorage: themeManager.clearEditingThemeFromStorage,
    setEditingThemeToStorage: themeManager.setEditingThemeToStorage,

    // 导出导入主题
    exportTheme,
    importTheme,
  };
}
