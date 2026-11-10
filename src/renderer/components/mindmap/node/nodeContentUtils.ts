/**
 * 节点内容组件（图片 / 图标 / 标签 / 备注）共用的小工具，仅供 node/ 下这一组组件使用
 *
 * - 图标分组：引擎内置图标 MindMap.iconList + 扩展图标 extraIconList（对应参考项目
 *   [...nodeIconList, ...icon] 与 mergerIconList），以及「已有删除 / 同类替换 / 否则追加」的切换规则；
 * - 标签：文字、取色（与引擎渲染标签时的取色规则一致）、深拷贝；
 * - 浮层定位：引擎给出的坐标都相对浏览器窗口，浮层按约定放在编辑器根元素内绝对定位，需要换算；
 * - 图片：读取原始尺寸、贴纸转 data URL（保证 Markdown 文件自包含）；
 * - 备注里的链接：交给系统浏览器打开。
 */
import MindMap from "@/core/mindmap-engine/full.js";
// 引擎工具函数（JS 源码）：标签默认颜色必须与引擎渲染结果一致，直接复用
import { generateColorByContent } from "@/core/mindmap-engine/src/utils/index.js";
import { extraIconList } from "../config";
import { readFileAsDataUrl } from "../utils";

/* ------------------------------ 图标 ------------------------------ */

export interface NodeIconItem {
  name: string;
  /** SVG 字符串或图片地址 */
  icon: string;
}

export interface NodeIconGroup {
  name: string;
  /** 分组类型，节点数据里的图标 key 为「类型_图标名」 */
  type: string;
  list: NodeIconItem[];
}

let mergedIconGroups: NodeIconGroup[] | null = null;

/**
 * 全部图标分组：内置在前、扩展在后，同类型分组合并、同名图标后者覆盖
 * （等价于引擎 mergerIconList，但不修改原数组；与引擎 getNodeIconListIcon 的取图规则一致）
 */
export function getNodeIconGroups(): NodeIconGroup[] {
  if (mergedIconGroups) return mergedIconGroups;
  const result: NodeIconGroup[] = [];
  for (const group of [...MindMap.iconList, ...extraIconList]) {
    const existing = result.find((item) => item.type === group.type);
    if (!existing) {
      result.push({ ...group, list: [...group.list] });
      continue;
    }
    for (const icon of group.list) {
      const index = existing.list.findIndex((item) => item.name === icon.name);
      if (index === -1) existing.list.push(icon);
      else existing.list.splice(index, 1, icon);
    }
  }
  mergedIconGroups = result;
  return result;
}

/** 图标是否为 SVG 字符串（否则按图片地址渲染，对应参考项目 getHtml） */
export function isSvgIcon(icon: string): boolean {
  return icon.startsWith("<svg");
}

/** 节点数据里的图标 key */
export function toIconKey(type: string, name: string): string {
  return `${type}_${name}`;
}

/**
 * 切换图标（参考项目 setIcon 规则）：已有同名图标则删除；已有同类型图标则替换；否则追加
 * @returns 新的图标列表（不修改传入的数组，避免直接改动节点数据）
 */
export function toggleNodeIcon(list: readonly string[], type: string, name: string): string[] {
  const key = toIconKey(type, name);
  const next = [...list];
  const index = next.indexOf(key);
  if (index !== -1) {
    next.splice(index, 1);
    return next;
  }
  const typeIndex = next.findIndex((item) => item.split("_")[0] === type);
  if (typeIndex !== -1) next.splice(typeIndex, 1, key);
  else next.push(key);
  return next;
}

/* ------------------------------ 标签 ------------------------------ */

/** 节点标签：旧版为字符串，v0.10.3+ 支持 { text, style } 对象 */
export type NodeTagItem =
  | string
  | { text: string; style?: Record<string, any>; [key: string]: any };

export function getTagText(tag: NodeTagItem): string {
  return typeof tag === "string" ? tag : (tag?.text ?? "");
}

/**
 * 标签背景色，规则与引擎 createTagNode 一致：节点自身配置 > 实例选项 tagsColorMap > 按文字生成
 * （参考项目弹窗里直接对对象标签调 generateColorByContent，颜色全部相同，这里修正）
 */
export function getTagColor(
  tag: NodeTagItem,
  tagsColorMap?: Record<string, string> | null
): string {
  const text = getTagText(tag);
  const fill = typeof tag === "string" ? "" : tag?.style?.fill;
  return fill || tagsColorMap?.[text] || (generateColorByContent(text) as string);
}

/** 复制标签（对象标签连同 style 一起复制，避免多个节点共享同一对象、改一个影响全部） */
export function cloneTag(tag: NodeTagItem): NodeTagItem {
  if (typeof tag === "string") return tag;
  return tag.style ? { ...tag, style: { ...tag.style } } : { ...tag };
}

/* ------------------------------ 浮层定位 ------------------------------ */

/** 编辑器根元素（浮层定位容器）在窗口中的矩形 */
export function getEditorRect(el: Element | null | undefined): DOMRect {
  const container = el?.closest(".mindmap-editor") ?? document.documentElement;
  return container.getBoundingClientRect();
}

/**
 * svg.js 元素在窗口中的矩形
 * svg.js 的 rbox() 会叠加页面滚动偏移（页面坐标），浮层换算需要窗口坐标，所以直接取 DOM 矩形
 */
export function getSvgClientRect(
  el: { node?: Element; rbox?: () => DOMRectInit } | null | undefined
): DOMRect | null {
  if (el?.node) return el.node.getBoundingClientRect();
  if (el?.rbox) return DOMRect.fromRect(el.rbox());
  return null;
}

/** 把数值限制在 [min, max]（max 小于 min 时取 min） */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/* ------------------------------ 图片 ------------------------------ */

export interface ImageSize {
  width: number;
  height: number;
}

/**
 * 读取图片原始尺寸（对应引擎 getImageSize）：失败或超时返回 0 × 0，由调用方回退默认尺寸；
 * 网络图片可能一直挂起，加超时避免「确定」按钮无响应
 */
export function loadImageSize(src: string, timeout = 10000): Promise<ImageSize> {
  return new Promise((resolve) => {
    const img = new Image();
    let timer = 0;
    const finish = (width: number, height: number): void => {
      window.clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      resolve({ width, height });
    };
    timer = window.setTimeout(() => {
      console.warn("[MindMap/nodeContent] 读取图片尺寸超时:", src.slice(0, 80));
      finish(0, 0);
    }, timeout);
    img.onload = () => finish(img.naturalWidth, img.naturalHeight);
    img.onerror = () => finish(0, 0);
    img.src = src;
  });
}

const stickerDataUrlTasks = new Map<string, Promise<string>>();

/**
 * 贴纸转为 data URL
 *
 * 贴纸是应用内资源，地址随构建版本 / 运行环境变化（开发服务器、Tauri 协议、带哈希的文件名），
 * 直接写进 Markdown 换个环境就失效，所以嵌入图片内容；引擎 NodeBase64ImageStorage 插件会把
 * 相同的 data URL 去重存进根节点 imgMap，同一贴纸用在多个节点也只存一份。
 */
export function stickerToDataUrl(url: string): Promise<string> {
  // 小图已被 Vite 内联成 data URL
  if (url.startsWith("data:")) return Promise.resolve(url);
  let task = stickerDataUrlTasks.get(url);
  if (!task) {
    task = (async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`读取贴纸失败（HTTP ${response.status}）`);
      const svg = await response.text();
      // 按内容显式声明 SVG 类型，不依赖服务端返回的 Content-Type
      return readFileAsDataUrl(new File([svg], "sticker.svg", { type: "image/svg+xml" }));
    })();
    // 失败的任务不缓存，下次点击重试
    task.catch(() => stickerDataUrlTasks.delete(url));
    stickerDataUrlTasks.set(url, task);
  }
  return task;
}

/* ------------------------------ 输入 ------------------------------ */

/** 是否为输入法组字过程中的按键（此时的回车用于上屏候选词，不应触发确定 / 添加） */
export function isImeComposing(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}

/* ------------------------------ 链接 ------------------------------ */

/** 备注里允许打开的链接协议（其它协议包括 javascript: 一律忽略） */
const SAFE_LINK_PROTOCOL = /^(https?:|mailto:)/i;

/** 用系统浏览器打开备注里的链接（WebView 内直接跳转会离开编辑器） */
export function openNoteLink(href: string): void {
  const url = href.trim();
  if (!SAFE_LINK_PROTOCOL.test(url)) {
    console.warn("[MindMap/nodeContent] 忽略不支持的链接:", url);
    return;
  }
  console.info("[MindMap/nodeContent] 打开外部链接:", url);
  const api = window.electronAPI;
  if (typeof api?.openExternal === "function") {
    api.openExternal(url).catch((error: unknown) => {
      console.error("[MindMap/nodeContent] 打开链接失败:", error);
    });
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
