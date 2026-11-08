import type { FontConfig, FontSizeConfig } from "@/types/font";
import type { ShortcutKeyMap } from "@/core";
import { useStorage } from "@vueuse/core";
import { readonly, watch } from "vue";

import {
  defaultFontConfig,
  defaultFontSizeConfig,
  legacyDefaultFontSizeConfig,
} from "@/config/fonts";
import { setNestedProperty } from "@/renderer/utils/tool";
import {
  defaultImageInsertConfig,
  migrateLegacyImageConfig,
  type ImageInsertConfig,
  type LegacyImageConfig,
} from "@/shared/utils/imageInsert";

/** 启动恢复模式（设置页"启动时打开"选择器） */
export type LaunchMode = "new" | "lastFile" | "lastSession" | "fixed";

interface AppConfig extends Record<string, any> {
  font: {
    family: FontConfig;
    size: FontSizeConfig;
  };
  /** 图片插入规则（Typora 式），详见 @/shared/utils/imageInsert */
  image: ImageInsertConfig;
  other: {
    editorPadding: string;
    /** 自适应边距：按屏幕宽度缩放编辑区左右边距（editorPadding 作为常规屏幕的上限） */
    responsivePadding: boolean;
    autoSave: boolean;
  };
  mermaid: {
    defaultDisplayMode: "code" | "mixed" | "diagram";
  };
  view: {
    focusMode: boolean;
    typewriterMode: boolean;
  };
  shortcuts: ShortcutKeyMap;
  workspace: {
    sortBy: "name" | "mtime";
    startupPath: string;
    autoExpandSidebar: boolean;
    sidebarWidth: number | null;
    /** 启动时打开哪种会话：新窗口 / 上次的文件 / 上次的文件夹和文件 / 固定工作区 */
    launchMode: LaunchMode;
  };
}

const defaultConfig: AppConfig = {
  font: {
    family: defaultFontConfig,
    size: defaultFontSizeConfig,
  },
  image: { ...defaultImageInsertConfig },
  other: {
    editorPadding: "120px",
    responsivePadding: true,
    autoSave: true,
  },
  mermaid: {
    defaultDisplayMode: "diagram",
  },
  view: {
    focusMode: false,
    typewriterMode: false,
  },
  shortcuts: {},
  workspace: {
    sortBy: "name",
    startupPath: "",
    autoExpandSidebar: false,
    sidebarWidth: null,
    launchMode: "new",
  },
};

const LAUNCH_MODES: readonly LaunchMode[] = ["new", "lastFile", "lastSession", "fixed"];

function isLaunchMode(value: unknown): value is LaunchMode {
  return typeof value === "string" && (LAUNCH_MODES as readonly string[]).includes(value);
}

function mergeAppConfig(partial?: Partial<AppConfig>): AppConfig {
  const mergedFontSize = {
    ...defaultConfig.font.size,
    ...partial?.font?.size,
  };

  for (const type of Object.keys(defaultFontSizeConfig) as Array<keyof FontSizeConfig>) {
    if (mergedFontSize[type] === legacyDefaultFontSizeConfig[type]) {
      mergedFontSize[type] = defaultFontSizeConfig[type];
    }
  }

  return {
    ...defaultConfig,
    ...partial,
    font: {
      ...defaultConfig.font,
      ...partial?.font,
      size: mergedFontSize,
    },
    image: mergeImageConfig(partial?.image),
    other: {
      ...defaultConfig.other,
      ...partial?.other,
    },
    mermaid: {
      ...defaultConfig.mermaid,
      ...partial?.mermaid,
    },
    view: {
      ...defaultConfig.view,
      ...partial?.view,
    },
    shortcuts: partial?.shortcuts || defaultConfig.shortcuts,
    workspace: {
      ...defaultConfig.workspace,
      ...partial?.workspace,
      launchMode: isLaunchMode(partial?.workspace?.launchMode)
        ? partial.workspace.launchMode
        : defaultConfig.workspace.launchMode,
    },
  };
}

/** 极旧版本把图片配置写在独立 localStorage 键里（pasteMethod / localImagePath） */
function getLegacyImageConfig(): Partial<ImageInsertConfig> {
  const pasteMethod = localStorage.getItem("pasteMethod");
  const localPath = localStorage.getItem("localImagePath");
  if (!pasteMethod && !localPath) return {};

  return migrateLegacyImageConfig({ pasteMethod, localPath });
}

/**
 * 合并图片配置：
 * - 存储里已是新配置（含 insertAction）→ 直接用，只补默认值；
 * - 存储里是旧配置（pasteMethod / localPath / useFileNameFolder）→ 自动迁移为插入动作；
 * - 更早版本写在独立键上的配置作为兜底。
 */
function mergeImageConfig(
  partial?: (Partial<ImageInsertConfig> & LegacyImageConfig) | null
): ImageInsertConfig {
  if (!partial) return { ...defaultConfig.image, ...getLegacyImageConfig() };
  const { pasteMethod, localPath, useFileNameFolder, ...rest } = partial;
  const migrated = rest.insertAction
    ? {}
    : {
        ...getLegacyImageConfig(),
        ...migrateLegacyImageConfig({ pasteMethod, localPath, useFileNameFolder }),
      };
  return { ...defaultConfig.image, ...migrated, ...rest };
}

const config = useStorage<AppConfig>("livemd-config", defaultConfig, localStorage, {
  serializer: {
    read: (value: string) => {
      try {
        const parsed = JSON.parse(value) as Partial<AppConfig>;
        return mergeAppConfig(parsed);
      } catch {
        return mergeAppConfig();
      }
    },
    write: (value: AppConfig) => JSON.stringify(value),
  },
});

export function useConfig() {
  return {
    config,

    getConf: <K extends keyof AppConfig>(key: K) => readonly(config.value[key]),

    setConf: <K extends keyof AppConfig>(key: K, value: AppConfig[K] | string, pathValue?: any) => {
      if (typeof value === "string" && pathValue !== undefined) {
        config.value = {
          ...config.value,
          [key]: setNestedProperty(config.value[key], value, pathValue),
        };
      } else {
        config.value = { ...config.value, [key]: value as AppConfig[K] };
      }
    },

    watchConf: <K extends keyof AppConfig>(key: K, callback: (value: AppConfig[K]) => void) => {
      return watch(() => config.value[key], callback, { deep: true });
    },
  };
}
