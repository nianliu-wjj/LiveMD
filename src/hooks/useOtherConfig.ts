import { computed, nextTick } from "vue";
import { useConfig } from "./useConfig";

// 编辑器内边距 CSS 变量（用户固定值；实际生效值见 styles/responsive.less 的 --livemd-editor-padding-effective）
const EDITOR_PADDING_CSS_VAR = "--livemd-editor-padding";

// 获取配置管理实例
const { config, getConf, setConf } = useConfig();

// 当前其他配置（直接使用响应式的 config）
const currentOtherConfig = computed(() => config.value.other);

// 当前编辑器内边距
const currentEditorPadding = computed(() => currentOtherConfig.value.editorPadding);

// 是否开启自适应边距（旧配置缺省字段时视为开启）
const currentResponsivePadding = computed(
  () => currentOtherConfig.value.responsivePadding !== false
);

// 初始化配置
function init() {
  // 应用当前编辑器内边距配置到 DOM
  const otherConfig = getConf("other");

  applyEditorPadding(otherConfig.editorPadding);
  applyResponsivePadding(otherConfig.responsivePadding !== false);
}

// 设置编辑器内边距
function setEditorPadding(padding: string) {
  setConf("other", "editorPadding", padding);
  applyEditorPadding(padding);
}

// 设置自适应边距开关
function setResponsivePadding(enabled: boolean) {
  setConf("other", "responsivePadding", enabled);
  applyResponsivePadding(enabled);
}

// 应用编辑器内边距
function applyEditorPadding(padding: string) {
  nextTick(() => {
    const fontRootElement = document.querySelector("#fontRoot") as HTMLElement;

    if (!fontRootElement) {
      console.warn("[useOtherConfig] 未找到 #fontRoot，跳过应用编辑器内边距");
      return;
    }

    fontRootElement.style.setProperty(EDITOR_PADDING_CSS_VAR, padding);
  });
}

// 应用自适应边距：切换 <html data-responsive-padding>，由 responsive.less 按断点计算实际边距
function applyResponsivePadding(enabled: boolean) {
  nextTick(() => {
    document.documentElement.dataset.responsivePadding = String(enabled);
  });
}

export default function useOtherConfig() {
  return {
    currentEditorPadding,
    currentOtherConfig,
    currentResponsivePadding,
    init,
    setEditorPadding,
    setResponsivePadding,
  };
}
