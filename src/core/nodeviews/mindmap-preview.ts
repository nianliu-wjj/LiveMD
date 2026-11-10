/**
 * 思维导图代码块预览：用移植的思维导图引擎离屏渲染，导出为 SVG 图片
 *
 * - 引擎按需动态加载（独立 chunk），文档里没有思维导图时不加载；
 * - 每次预览在屏幕外临时创建只读实例，渲染完成后导出 SVG（data URL）并立即销毁，
 *   文档中只保留一张图片，数百个思维导图块也不会常驻引擎实例；
 * - 全局串行队列 + 按内容的 LRU 缓存：滚动、切换标签页、撤销重做时秒出结果。
 * 结构 / 主题 / 样式与编辑器所见一致（同一引擎同一份数据）；编辑器「设置 / 基础样式」里
 * 影响外观的全局引擎选项（彩虹线条、外框内边距等）同样作用于预览，并参与缓存键。
 */
import {
  MINDMAP_ENGINE_CONFIG_KEY,
  MINDMAP_PREVIEW_ENGINE_OPTION_KEYS,
  parseMindMapDocument,
  type MindMapTreeNode,
} from "../utils/mindmap-document";

/** 预览缓存上限（data URL 体积较大，数量不宜过多） */
const PREVIEW_CACHE_LIMIT = 32;
/** 单次渲染超时：引擎异常时不让队列永久卡住 */
const RENDER_TIMEOUT_MS = 15_000;

const previewCache = new Map<string, string>();
let renderQueue: Promise<unknown> = Promise.resolve();
let enginePromise: Promise<typeof import("../mindmap-engine/full.js")> | null = null;

/** 动态加载引擎（失败后清空，允许下次重试） */
export function loadMindMapEngine(): Promise<typeof import("../mindmap-engine/full.js")> {
  enginePromise ??= import("../mindmap-engine/full.js").catch((error) => {
    enginePromise = null;
    throw error;
  });
  return enginePromise;
}

/** 读取影响外观的全局引擎选项（编辑器「设置 / 基础样式」持久化的那部分） */
function readPreviewEngineOptions(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(MINDMAP_ENGINE_CONFIG_KEY);
    if (!raw) return {};
    const saved = JSON.parse(raw) as Record<string, unknown>;
    const options: Record<string, unknown> = {};
    for (const key of MINDMAP_PREVIEW_ENGINE_OPTION_KEYS) {
      if (saved[key] !== undefined) options[key] = saved[key];
    }
    return options;
  } catch (error) {
    console.warn("[mindmap-preview] 读取引擎选项失败，按默认选项渲染:", error);
    return {};
  }
}

/** 缓存键：内容 + 影响外观的引擎选项（选项变化后旧预览自然失效） */
function cacheKeyOf(source: string, options: Record<string, unknown>): string {
  return `${JSON.stringify(options)}\u0000${source}`;
}

function readCache(key: string): string | undefined {
  const value = previewCache.get(key);
  if (value === undefined) return undefined;
  previewCache.delete(key);
  previewCache.set(key, value);
  return value;
}

function writeCache(key: string, value: string): void {
  previewCache.set(key, value);
  if (previewCache.size > PREVIEW_CACHE_LIMIT) {
    const oldest = previewCache.keys().next().value;
    if (oldest !== undefined) previewCache.delete(oldest);
  }
}

/** 同步读取已缓存的预览（命中时代码块可直接显示，无需占位） */
export function peekMindMapPreview(source: string): string | undefined {
  return readCache(cacheKeyOf(source, readPreviewEngineOptions()));
}

/** 树中是否存在富文本节点 */
function hasRichTextNode(node: MindMapTreeNode): boolean {
  return Boolean(node.data.richText) || node.children.some(hasRichTextNode);
}

/** 离屏渲染一次并导出 SVG data URL */
async function renderOnce(source: string, engineOptions: Record<string, unknown>): Promise<string> {
  const doc = parseMindMapDocument(source);
  const { default: MindMap, RichText } = await loadMindMapEngine();
  // 富文本节点的导出样式（foreignObject 复位样式、公式样式）由 RichText 插件提供：
  // 数据含富文本时临时启用，渲染完再从引擎类的插件列表移除（编辑器打开时已注册的保持不动）
  const needRichText = hasRichTextNode(doc.root);
  const hadRichText = MindMap.hasPlugin(RichText) !== -1;

  // 屏幕外容器：引擎需要真实尺寸测量文字，不能 display:none
  const container = document.createElement("div");
  container.style.cssText =
    "position:fixed;left:-30000px;top:0;width:1600px;height:1000px;pointer-events:none;";
  document.body.appendChild(container);

  let mindMap: InstanceType<typeof MindMap> | null = null;
  try {
    mindMap = new MindMap({
      el: container,
      data: doc.root,
      layout: doc.layout,
      theme: doc.theme.template,
      themeConfig: doc.theme.config,
      readonly: true,
      fit: false,
      ...engineOptions,
    });
    if (needRichText) mindMap.addPlugin(RichText);
    const instance = mindMap;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("思维导图渲染超时")), RENDER_TIMEOUT_MS);
      instance.on("node_tree_render_end", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    return (await instance.export("svg", false, "思维导图")) as string;
  } finally {
    mindMap?.destroy();
    container.remove();
    if (needRichText && !hadRichText) {
      const index = MindMap.hasPlugin(RichText);
      if (index !== -1) MindMap.pluginList.splice(index, 1);
    }
  }
}

/**
 * 获取思维导图预览图（SVG data URL）
 *
 * 渲染排队串行执行，避免多个离屏实例同时占用主线程。
 */
export function renderMindMapPreview(source: string): Promise<string> {
  const engineOptions = readPreviewEngineOptions();
  const key = cacheKeyOf(source, engineOptions);
  const cached = readCache(key);
  if (cached) return Promise.resolve(cached);

  const task = renderQueue.then(async () => {
    // 排队期间可能已有相同内容渲染完成
    const hit = readCache(key);
    if (hit) return hit;
    const startedAt = performance.now();
    const url = await renderOnce(source, engineOptions);
    writeCache(key, url);
    console.debug(
      `[mindmap-preview] 预览渲染完成，耗时 ${Math.round(performance.now() - startedAt)}ms`
    );
    return url;
  });
  // 队列只关心顺序，单个任务失败不影响后续任务
  renderQueue = task.catch(() => undefined);
  return task;
}
