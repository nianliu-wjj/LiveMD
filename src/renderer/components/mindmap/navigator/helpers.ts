/**
 * 底部栏 / 小地图 / 搜索 / 右键菜单共用的小工具（仅 navigator/ 目录内部使用）
 */

/** 编辑器根元素（全屏编辑器 .mindmap-editor，浮层都在它内部绝对定位） */
export function getEditorRoot(el: Element | null | undefined): HTMLElement | null {
  return (el?.closest(".mindmap-editor") as HTMLElement | null) ?? null;
}

/** 编辑器根元素的尺寸（取不到根元素时退回窗口尺寸） */
export function getEditorRootSize(el: Element | null | undefined): {
  width: number;
  height: number;
} {
  const root = getEditorRoot(el);
  return root
    ? { width: root.clientWidth, height: root.clientHeight }
    : { width: window.innerWidth, height: window.innerHeight };
}

/**
 * 富文本 HTML → 纯文本
 *
 * 参考项目用「innerHTML 赋给游离 div 再取 textContent」，游离元素里的 <img onerror> 仍会加载并执行；
 * DOMParser 生成的是惰性文档（不执行脚本、不加载图片），节点文本来自文档内容，这样更安全。
 */
export function htmlToText(html: string): string {
  if (!html) return "";
  return new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
}

/** 节点数据的纯文本：富文本节点去掉标签，text 缺失时为空串 */
export function getNodeText(
  data: { text?: unknown; richText?: unknown } | null | undefined
): string {
  const text = data?.text === undefined || data?.text === null ? "" : String(data.text);
  return data?.richText ? htmlToText(text) : text;
}

/** 关键字高亮片段 */
export interface HighlightSegment {
  text: string;
  match: boolean;
}

/**
 * 按关键字切分文本，供模板逐段渲染高亮
 *
 * 参考项目把节点文本拼成 HTML 再 v-html，且用未转义的搜索词构造正则：节点文本里的标签会被当作 HTML 注入，
 * 搜索词含 ( [ * 等字符时正则直接报错。这里按纯文本逐段切分（与引擎 Search 插件的 includes 匹配方式一致）。
 */
export function splitByKeyword(text: string, keyword: string): HighlightSegment[] {
  if (!keyword) return [{ text, match: false }];
  const segments: HighlightSegment[] = [];
  let start = 0;
  let index = text.indexOf(keyword);
  while (index !== -1) {
    if (index > start) segments.push({ text: text.slice(start, index), match: false });
    segments.push({ text: keyword, match: true });
    start = index + keyword.length;
    index = text.indexOf(keyword, start);
  }
  if (start < text.length) segments.push({ text: text.slice(start), match: false });
  return segments;
}
