/**
 * Livemd 粘贴处理插件
 *
 * 处理粘贴的 Markdown 文本和图片
 */

import { Plugin, PluginKey } from "prosemirror-state";
import { Node, Slice } from "prosemirror-model";
import { MarkdownParser } from "../parser";
import { livemdSchema } from "../schema";
import { decorationPluginKey } from "../decorations";
import { insertMarkdownTableRowAfterCurrent } from "../commands";
import {
  IMAGE_EXTENSION_RE,
  migrateLegacyImageConfig,
  resolveImageSaveTarget,
  toCorePasteMethod,
  type ImageInsertAction,
} from "../../shared/utils/imageInsert";

/** 插件 Key */
export const pastePluginKey = new PluginKey("livemd-paste");

/** 图片粘贴方式（core 层只关心三类：本地落盘 / Base64 内嵌 / 上传图床） */
export type ImagePasteMethod = "base64" | "local" | "remote";

/** localStorage（livemd-config.image）中图片配置的形状：新旧字段并存，便于无感迁移 */
interface StoredImageConfig {
  insertAction?: ImageInsertAction;
  pasteMethod?: ImagePasteMethod;
  localPath?: string;
  customDir?: string;
  useFileNameFolder?: boolean;
}

/** 图片上传函数类型 */
export type ImageUploader = (file: File) => Promise<string>;

/** 本地图片保存函数类型 */
export type LocalImageSaver = (file: File) => Promise<string>;

/** 粘贴插件配置 */
export interface PastePluginConfig {
  /** 获取图片粘贴方式 */
  getImagePasteMethod?: () => ImagePasteMethod;
  /** 图片上传函数（用于 remote 模式） */
  imageUploader?: ImageUploader;
  /** 本地图片保存函数（用于 local 模式） */
  localImageSaver?: LocalImageSaver;
  /** 图片地址整形（./ 前缀、URL 转义），插入 Markdown 前调用 */
  formatImageSrc?: (src: string) => string;
  /** 网络图片处理：下载并按规则落盘，返回替换后的 src；返回 null 表示不处理 */
  resolveNetworkImage?: (url: string) => Promise<string | null>;
  /** 本地磁盘图片处理：按规则复制到文档目录，返回替换后的 src；返回 null 表示不处理 */
  resolveLocalImage?: (path: string) => Promise<string | null>;
}

/**
 * 获取图片粘贴方式
 * 新配置（insertAction）优先；旧配置（pasteMethod / 独立 localStorage 键）自动迁移
 */
export function getImagePasteMethod(): ImagePasteMethod {
  const stored = getStoredImageConfig();
  if (stored.insertAction) {
    return toCorePasteMethod({ insertAction: stored.insertAction });
  }
  const legacy = migrateLegacyImageConfig({
    pasteMethod: stored.pasteMethod,
    localPath: stored.localPath,
    useFileNameFolder: stored.useFileNameFolder,
  });
  if (legacy.insertAction) {
    return toCorePasteMethod({ insertAction: legacy.insertAction });
  }
  const method = localStorage.getItem("pasteMethod");
  if (method === "local" || method === "base64" || method === "remote") {
    return method;
  }
  return "local";
}

/** 获取本地图片保存目录（相对当前文件或绝对路径，空串表示当前文件目录） */
export function getLocalImagePath(): string {
  const storedConfig = getStoredImageConfig();
  return resolveImageSaveTarget({
    insertAction: storedConfig.insertAction ?? "copyToCurrentDir",
    customDir: storedConfig.customDir ?? storedConfig.localPath ?? "",
  }).targetPath;
}

function getStoredImageConfig(): StoredImageConfig {
  try {
    const rawConfig = localStorage.getItem("livemd-config");
    if (!rawConfig) return {};

    const parsed = JSON.parse(rawConfig) as { image?: StoredImageConfig };
    return parsed.image || {};
  } catch {
    return {};
  }
}

/** 默认配置 */
const defaultConfig: PastePluginConfig = {
  getImagePasteMethod,
};

/** Markdown 中的图片语法 / 网络图片地址（供粘贴时识别） */
const NETWORK_IMAGE_RE = /!\[[^\]]*\]\(https?:\/\/[^)\s]+/i;

/**
 * 是否为可直接插入的单个图片地址
 * 网络地址与本地绝对路径都要求扩展名像图片，避免把普通文本或网页地址误判为图片
 */
function looksLikeBareImageAddress(value: string): boolean {
  const isNetwork = /^https?:\/\//i.test(value);
  const isLocalAbsolute =
    /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\") || value.startsWith("/");
  if (!isNetwork && !isLocalAbsolute) return false;
  return IMAGE_EXTENSION_RE.test(value);
}

/**
 * 创建粘贴处理插件
 */
export function createPastePlugin(config: PastePluginConfig = {}): Plugin {
  const parser = new MarkdownParser(livemdSchema);
  const mergedConfig = { ...defaultConfig, ...config };

  return new Plugin({
    key: pastePluginKey,

    props: {
      handlePaste(view, event, _slice) {
        const clipboardData = event.clipboardData;
        if (!clipboardData) return false;

        // 检查是否处于源码模式
        const decoState = decorationPluginKey.getState(view.state);
        const isSourceView = decoState?.sourceView ?? false;

        // 检查是否有图片
        const files = clipboardData.files;
        if (files && files.length > 0) {
          const hasImage = Array.from(files).some((file) => file.type.startsWith("image/"));
          if (hasImage) {
            if (isSourceView) {
              // 源码模式下：图片粘贴创建段落而非 image 节点
              handleImagePasteAsText(view, files, mergedConfig);
            } else {
              // 正常模式：创建 image 节点
              handleImagePaste(view, files, mergedConfig);
            }
            return true;
          }
        }

        // 获取粘贴的纯文本
        const text = clipboardData.getData("text/plain");
        if (!text) return false;

        // 单个图片地址（网络 URL 或本地绝对路径）：按"对网络/本地位置的图片应用上述规则"处理
        if (!isSourceView) {
          const bareImage = text.trim();
          if (bareImage && !/\s/.test(bareImage) && looksLikeBareImageAddress(bareImage)) {
            if (handleBareImageAddress(view, bareImage, mergedConfig)) return true;
          }
        }

        // 源码模式下：所有文本都作为纯文本插入，不解析 Markdown
        if (isSourceView) {
          return false; // 让默认处理器插入纯文本
        }

        if (insertMarkdownTableRowAfterCurrent(view.state, text, view.dispatch.bind(view))) {
          return true;
        }

        // 检查是否包含 Markdown 语法
        if (!containsMarkdownSyntax(text)) {
          // 检查是否有外部 HTML（非编辑器内部复制）
          const html = clipboardData.getData("text/html");
          if (html && !html.includes("data-pm-slice")) {
            // 外部 HTML 粘贴，作为纯文本插入，避免 ProseMirror 解析 HTML marks
            const tr = view.state.tr.insertText(text);
            view.dispatch(tr);
            return true;
          }
          return false; // 让默认处理器处理
        }

        // 检查是否来自编辑器内部复制（ProseMirror 会在 HTML 中添加 data-pm-slice 标记）
        const html = clipboardData.getData("text/html");
        if (html && html.includes("data-pm-slice")) {
          return false; // 内部复制，让 ProseMirror 默认处理
        }

        // 含网络图片的 Markdown：先按规则把网络图片下载落盘，再解析插入
        if (mergedConfig.resolveNetworkImage && NETWORK_IMAGE_RE.test(text)) {
          void handleMarkdownWithNetworkImages(view, text, parser, mergedConfig);
          return true;
        }

        const pasteSlice = parseMarkdownPasteSlice(text, parser);
        if (!pasteSlice) return false;
        const tr = view.state.tr.replaceSelection(pasteSlice).scrollIntoView();
        view.dispatch(tr);
        return true;
      },
    },
  });
}

export function parseMarkdownPasteSlice(
  text: string,
  parser: MarkdownParser = new MarkdownParser(livemdSchema)
): Slice | null {
  const { doc } = parser.parse(normalizePastedMarkdownText(text));
  const content = doc.content;
  if (content.size === 0) return null;
  return new Slice(content, 0, 0);
}

function normalizePastedMarkdownText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/\u200b/g, "")
    .replace(/\u200c/g, "")
    .replace(/\u200d/g, "")
    .replace(/\ufeff/g, "");
}

/**
 * 粘贴裸图片地址：网络 URL 交给 resolveNetworkImage 下载，本地路径交给 resolveLocalImage 复制
 * 命中并成功处理返回 true（已插入图片节点），否则返回 false 走默认文本粘贴
 */
function handleBareImageAddress(view: any, address: string, config: PastePluginConfig): boolean {
  const isNetwork = /^https?:\/\//i.test(address);
  const resolver = isNetwork ? config.resolveNetworkImage : config.resolveLocalImage;
  if (!resolver) return false;
  if (isNetwork && !IMAGE_EXTENSION_RE.test(address)) return false;

  void (async () => {
    try {
      const resolved = await resolver(address);
      if (!resolved) return;
      const src = config.formatImageSrc?.(resolved) || resolved;
      const imageNode = view.state.schema.nodes.image?.createAndFill({
        src,
        alt: altFromAddress(address),
        title: "",
      });
      if (!imageNode) return;
      const { $from } = view.state.selection;
      view.dispatch(view.state.tr.insert($from.pos, imageNode));
    } catch (error) {
      console.error("[paste] 处理图片地址失败:", error);
    }
  })();

  return true;
}

/** 从地址取文件名作为 alt */
function altFromAddress(address: string): string {
  const cleaned = address.split(/[?#]/)[0];
  return decodeURIComponent(cleaned.split(/[\\/]/).pop() || "image");
}

/**
 * 粘贴含网络图片的 Markdown：逐一下载并按规则落盘，再按新文本解析插入
 * 全部未处理（规则关闭或下载失败）时按原文插入，行为与从前一致
 */
async function handleMarkdownWithNetworkImages(
  view: any,
  text: string,
  parser: MarkdownParser,
  config: PastePluginConfig
): Promise<void> {
  const urls = Array.from(text.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/gi)).map(
    (match) => match[1]
  );

  let nextText = text;
  const replacements = new Map<string, string>();
  for (const url of new Set(urls)) {
    try {
      const resolved = await config.resolveNetworkImage?.(url);
      if (resolved) {
        replacements.set(url, config.formatImageSrc?.(resolved) || resolved);
      }
    } catch (error) {
      console.error("[paste] 下载网络图片失败:", url, error);
    }
  }

  for (const [from, to] of replacements) {
    nextText = nextText.split(from).join(to);
  }

  const slice = parseMarkdownPasteSlice(nextText, parser);
  if (!slice) return;
  view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
}

/**
 * 处理图片粘贴
 */
async function handleImagePaste(
  view: any,
  files: FileList,
  config: PastePluginConfig
): Promise<void> {
  const method = config.getImagePasteMethod?.() || getImagePasteMethod();
  const schema = view.state.schema;
  const nodes: Node[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file.type.startsWith("image/")) continue;

    try {
      let src: string;

      switch (method) {
        case "base64":
          src = await fileToBase64(file);
          break;

        case "remote":
          if (config.imageUploader) {
            src = await config.imageUploader(file);
          } else {
            console.warn("Image uploader not configured, falling back to base64");
            src = await fileToBase64(file);
          }
          break;

        case "local":
          if (config.localImageSaver) {
            src = await config.localImageSaver(file);
          } else {
            // 尝试使用 Electron API
            src = await saveImageLocally(file);
          }
          break;

        default:
          src = await fileToBase64(file);
      }

      const imageNode = schema.nodes.image?.createAndFill({
        src,
        alt: file.name,
        title: "",
      });

      if (imageNode) {
        nodes.push(imageNode);
      }
    } catch (error) {
      console.error("Failed to process image:", error);
    }
  }

  if (nodes.length > 0) {
    const { $from } = view.state.selection;
    let tr = view.state.tr;

    for (const node of nodes) {
      tr = tr.insert($from.pos, node);
    }

    view.dispatch(tr);
  }
}

/**
 * 源码模式下处理图片粘贴：创建包含 Markdown 文本的段落
 */
async function handleImagePasteAsText(
  view: any,
  files: FileList,
  config: PastePluginConfig
): Promise<void> {
  const method = config.getImagePasteMethod?.() || getImagePasteMethod();
  const schema = view.state.schema;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file.type.startsWith("image/")) continue;

    try {
      let src: string;

      switch (method) {
        case "base64":
          src = await fileToBase64(file);
          break;
        case "remote":
          if (config.imageUploader) {
            src = await config.imageUploader(file);
          } else {
            src = await fileToBase64(file);
          }
          break;
        case "local":
          if (config.localImageSaver) {
            src = await config.localImageSaver(file);
          } else {
            src = await saveImageLocally(file);
          }
          break;
        default:
          src = await fileToBase64(file);
      }

      const alt = file.name;
      const markdownText = `![${alt}](${src})`;
      const paragraph = schema.nodes.paragraph.create(
        { imageAttrs: { src, alt, title: "" } },
        schema.text(markdownText)
      );

      const { $from } = view.state.selection;
      const tr = view.state.tr.insert($from.pos, paragraph);
      view.dispatch(tr);
    } catch (error) {
      console.error("Failed to process image:", error);
    }
  }
}

/**
 * 将文件转换为 base64
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
}

/**
 * 保存图片到本地
 */
export async function saveImageLocally(file: File): Promise<string> {
  // 检查是否在 Electron 环境中
  if (typeof window !== "undefined" && (window as any).electronAPI) {
    const electronAPI = (window as any).electronAPI;

    // 将图片保存到临时目录
    const arrayBuffer = await file.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);
    const localImagePath = getLocalImagePath();
    const currentFilePath = (window as any).__currentFilePath || null;
    const tempPath = await electronAPI.writeTempImage?.(
      buffer,
      localImagePath,
      currentFilePath,
      file.name,
      file.type
    );

    if (tempPath) {
      return tempPath;
    }
  }

  // 如果不在 Electron 环境或保存失败，回退到 base64
  console.warn("Local image saving not available, falling back to base64");
  return fileToBase64(file);
}

/**
 * 检查文本是否包含 Markdown 语法
 */
export function containsMarkdownSyntax(text: string): boolean {
  const normalizedText = normalizePastedMarkdownText(text);
  const patterns = [
    /^#{1,6}\s/m, // 标题
    /\*\*[^*]+\*\*/, // 粗体
    /__[^_]+__/, // 粗体
    /\*[^*]+\*/, // 斜体
    /_[^_]+_/, // 斜体
    /~~[^~]+~~/, // 删除线
    /`[^`]+`/, // 行内代码
    /^```/m, // 代码块
    /^~~~\w*/m, // 代码块
    /^(?: {4}|\t)\S/m, // 缩进代码块
    /\[[^\]]+\]\([^)]*\)/, // 链接（允许空 URL）
    /!\[[^\]]*\]\([^)]+\)/, // 图片
    /^>\s?/m, // 引用
    /^\s*[-*+]\s/m, // 无序列表
    /^\s*\d+[.)]\s/m, // 有序列表
    /^\s*[-*+]\s+\*\*[^*]+\*\*/m, // AI 回答常见：列表项内加粗标签
    /^[-*_]{3,}\s*$/m, // 分隔线
    /==[^=]+==/, // 高亮
    /^\s*\$\$/m, // 数学块（支持缩进）
    /\$[^$]+\$/, // 行内数学
    /<su[bp]>.+?<\/su[bp]>/, // sub/sup
    /<[a-zA-Z][a-zA-Z0-9]*(?:\s[^>]*)?>.*?<\/[a-zA-Z][a-zA-Z0-9]*>/, // 行内 HTML
    /^- \[[ xX]\]/m, // 任务列表
    /^\|.+\|$/m, // 表格
  ];

  return patterns.some((pattern) => pattern.test(normalizedText));
}
