/**
 * 图片插入规则（Typora 式）——类型与纯函数，core / renderer 共用
 *
 * 对应设置页「图片」：
 *   插入图片时…      insertAction（无特殊操作 / 复制到当前文件夹 / ./assets / ./${filename}.assets / 自定义 / 上传 / Base64）
 *   对本地位置的图片应用上述规则   applyToLocalImages
 *   对网络位置的图片应用上述规则   applyToNetworkImages
 *   允许根据 YAML 设置自动上传图片 autoUploadByYaml
 *   图片语法偏好     preferRelativePath / addDotSlashPrefix / escapeUrlOnInsert
 */

/** 插入图片时的处理动作 */
export type ImageInsertAction =
  | "none"
  | "copyToCurrentDir"
  | "copyToAssets"
  | "copyToFileNameFolder"
  | "copyToCustomDir"
  | "upload"
  | "base64";

export interface ImageInsertConfig {
  /** 插入图片时的处理动作 */
  insertAction: ImageInsertAction;
  /** 自定义目录（insertAction = copyToCustomDir 时生效；相对当前文件目录或绝对路径） */
  customDir: string;
  /** 插入本地磁盘上的图片（拖入 / 粘贴文件路径）时也应用上述规则 */
  applyToLocalImages: boolean;
  /** 插入网络图片（粘贴 http(s) 图片地址或含网络图片的 Markdown）时下载并应用上述规则 */
  applyToNetworkImages: boolean;
  /** 允许按 YAML front matter（typora-upload-image / livemd-upload-image: true）自动上传 */
  autoUploadByYaml: boolean;
  /** 优先使用相对路径（自定义目录为绝对路径时也尽量写成相对当前文件的路径） */
  preferRelativePath: boolean;
  /** 为相对路径添加 ./ 前缀 */
  addDotSlashPrefix: boolean;
  /** 插入时自动转义图片 URL（空格 → %20、括号 → %28/%29） */
  escapeUrlOnInsert: boolean;
}

/** 默认值与 Typora 默认设置一致：复制到 ./assets，本地/网络都应用，YAML 关闭，相对路径 + ./ 开启，不转义 */
export const defaultImageInsertConfig: ImageInsertConfig = {
  insertAction: "copyToAssets",
  customDir: "",
  applyToLocalImages: true,
  applyToNetworkImages: true,
  autoUploadByYaml: false,
  preferRelativePath: true,
  addDotSlashPrefix: true,
  escapeUrlOnInsert: false,
};

/** 设置页下拉框选项（顺序即展示顺序） */
export const IMAGE_INSERT_ACTION_OPTIONS: Array<{ value: ImageInsertAction; label: string }> = [
  { value: "none", label: "无特殊操作" },
  { value: "copyToCurrentDir", label: "复制图片到当前文件夹" },
  { value: "copyToAssets", label: "复制图片到 ./assets 文件夹" },
  { value: "copyToFileNameFolder", label: "复制图片到 ./${filename}.assets 文件夹" },
  { value: "copyToCustomDir", label: "复制到自定义文件夹" },
  { value: "upload", label: "上传图片（图床）" },
  { value: "base64", label: "转为 Base64 内嵌" },
];

/** 粘贴插件层只区分三类：本地落盘 / Base64 / 上传 */
export type CoreImagePasteMethod = "local" | "base64" | "remote";

/** 是否为"复制到某目录"类动作 */
export function isCopyAction(action: ImageInsertAction): boolean {
  return action.startsWith("copyTo");
}

/**
 * 推导粘贴插件层的处理方式
 * @param yamlUpload 文档 YAML 要求自动上传（且设置允许）时强制走上传
 */
export function toCorePasteMethod(
  config: Pick<ImageInsertConfig, "insertAction">,
  yamlUpload = false
): CoreImagePasteMethod {
  if (yamlUpload) return "remote";
  switch (config.insertAction) {
    case "base64":
      return "base64";
    case "upload":
      return "remote";
    default:
      return "local";
  }
}

/** 交给 Rust 的本地保存目标 */
export interface ImageSaveTarget {
  /** 相对当前文件目录的子目录或绝对目录；空串 = 当前文件所在目录 */
  targetPath: string;
  /** 使用 `${filename}.assets` 同名文件夹 */
  useFileNameFolder: boolean;
  /** 不复制到文档目录，先落到应用临时目录（"无特殊操作" 时剪贴板位图仍需有落点） */
  saveToTemp: boolean;
}

/**
 * 按插入动作解析保存目标
 * @param yamlCopyTo YAML front matter 中 typora-copy-images-to / livemd-copy-images-to 指定的目录（优先）
 */
export function resolveImageSaveTarget(
  config: Pick<ImageInsertConfig, "insertAction" | "customDir">,
  yamlCopyTo?: string | null
): ImageSaveTarget {
  if (yamlCopyTo && yamlCopyTo.trim()) {
    return { targetPath: yamlCopyTo.trim(), useFileNameFolder: false, saveToTemp: false };
  }
  switch (config.insertAction) {
    case "copyToCurrentDir":
      return { targetPath: "", useFileNameFolder: false, saveToTemp: false };
    case "copyToAssets":
      return { targetPath: "assets", useFileNameFolder: false, saveToTemp: false };
    case "copyToFileNameFolder":
      return { targetPath: "", useFileNameFolder: true, saveToTemp: false };
    case "copyToCustomDir":
      return { targetPath: config.customDir.trim(), useFileNameFolder: false, saveToTemp: false };
    default:
      // none / upload / base64：剪贴板位图只能先落到应用临时目录（保存文档时不迁移）
      return { targetPath: "", useFileNameFolder: false, saveToTemp: true };
  }
}

/** 旧版本设置项（pasteMethod / localPath / useFileNameFolder）的形状 */
export interface LegacyImageConfig {
  pasteMethod?: string | null;
  localPath?: string | null;
  useFileNameFolder?: boolean | null;
}

/**
 * 把旧配置推导为新的插入动作，供首次升级时无感迁移
 * - base64 → base64；remote → upload；
 * - local + 同名文件夹 → copyToFileNameFolder；local + 空路径 → copyToCurrentDir；
 *   local + "assets" → copyToAssets；其余 → copyToCustomDir（保留原路径）。
 */
export function migrateLegacyImageConfig(legacy: LegacyImageConfig): Partial<ImageInsertConfig> {
  const method = legacy.pasteMethod;
  if (method === "base64") return { insertAction: "base64" };
  if (method === "remote") return { insertAction: "upload" };
  if (method !== "local") return {};

  if (legacy.useFileNameFolder) return { insertAction: "copyToFileNameFolder" };
  const localPath = (legacy.localPath ?? "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!localPath) return { insertAction: "copyToCurrentDir" };
  if (localPath.replace(/\/+$/, "") === "assets") return { insertAction: "copyToAssets" };
  return { insertAction: "copyToCustomDir", customDir: legacy.localPath ?? "" };
}

/** 是否带 URI scheme（http:、file:、data:、livemd: …） */
export function hasUriScheme(src: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(src);
}

/** 是否为 http(s) 网络地址 */
export function isNetworkImageUrl(src: string): boolean {
  return /^https?:\/\//i.test(src.trim());
}

/** 是否为本地绝对路径（Windows 盘符 / UNC / POSIX 根） */
export function isAbsoluteLocalImagePath(src: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(src) || src.startsWith("\\\\") || src.startsWith("/");
}

/** 常见图片扩展名（允许带 ?query / #hash） */
export const IMAGE_EXTENSION_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)(?:[?#][^\s]*)?$/i;

export function looksLikeImagePath(src: string): boolean {
  return IMAGE_EXTENSION_RE.test(src.trim());
}

/** 为相对路径添加 ./ 前缀（已有 ./、../ 或带 scheme / 绝对路径的保持不变） */
export function addDotSlash(path: string): string {
  if (
    !path ||
    path.startsWith("./") ||
    path.startsWith("../") ||
    path.startsWith("#") ||
    hasUriScheme(path) ||
    isAbsoluteLocalImagePath(path)
  ) {
    return path;
  }
  return `./${path}`;
}

/**
 * 转义图片 URL 中会破坏 Markdown 链接语法的字符：空格、括号；
 * 裸 % 转为 %25，已是 %XX 的序列保持不变（幂等）
 */
export function escapeImageUrl(path: string): string {
  return path
    .replace(/%(?![0-9A-Fa-f]{2})/g, "%25")
    .replace(/ /g, "%20")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
}

/** 插入 Markdown 前的最终整形：统一正斜杠 → 按偏好加 ./ → 按偏好转义 */
export function formatInsertedImagePath(
  path: string,
  config: Pick<ImageInsertConfig, "addDotSlashPrefix" | "escapeUrlOnInsert">
): string {
  if (!path || path.startsWith("data:")) return path;
  let result = hasUriScheme(path) ? path : path.replace(/\\/g, "/");
  if (config.addDotSlashPrefix) result = addDotSlash(result);
  if (config.escapeUrlOnInsert) result = escapeImageUrl(result);
  return result;
}

/** YAML front matter 中与图片相关的覆盖项 */
export interface ImageYamlOverrides {
  /** typora-copy-images-to / livemd-copy-images-to：图片保存目录（相对当前文件或绝对路径） */
  copyImagesTo?: string;
  /** typora-upload-image / livemd-upload-image: true：要求自动上传 */
  uploadImage?: boolean;
}

/**
 * 解析文档开头的 YAML front matter（只识别 `key: value` 平铺写法，足以覆盖 Typora 约定）
 */
export function parseImageYamlOverrides(markdown: string): ImageYamlOverrides {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown ?? "");
  if (!match) return {};

  const overrides: ImageYamlOverrides = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^\s*([A-Za-z0-9_-]+)\s*:\s*(.*?)\s*$/.exec(line);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    let value = kv[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key === "typora-copy-images-to" || key === "livemd-copy-images-to") {
      if (value) overrides.copyImagesTo = value;
    } else if (key === "typora-upload-image" || key === "livemd-upload-image") {
      overrides.uploadImage = /^(true|yes|on|1)$/i.test(value);
    }
  }
  return overrides;
}
