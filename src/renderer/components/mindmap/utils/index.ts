/**
 * 思维导图编辑器通用工具（对应参考项目 web/src/utils/index.js，按 LiveMD 运行环境改写）
 *
 * - 文件保存：引擎导出结果都是 data URL，Tauri 下 <a download> 不可靠，统一走原生「另存为」对话框；
 * - 剪贴板：优先 Clipboard API，失败回退到 LiveMD 的原生剪贴板接口；
 * - 全屏、文件读取、Markdown 渲染（备注展示）等。
 */
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";

/** data URL / 纯文本 / Blob → 字节数组 */
export async function toBytes(data: string | Blob): Promise<Uint8Array> {
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  const match = /^data:([^,]*?)(;base64)?,(.*)$/s.exec(data);
  if (!match) return new TextEncoder().encode(data);
  const [, , isBase64, payload] = match;
  if (isBase64) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }
  return new TextEncoder().encode(decodeURIComponent(payload));
}

/** 浏览器环境兜底：<a download> 触发下载 */
function downloadInBrowser(data: string | Blob, fileName: string): void {
  const url = data instanceof Blob ? URL.createObjectURL(data) : data;
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  if (data instanceof Blob) setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 保存导出结果（另存为对话框）
 *
 * @param data 引擎 export(type, false) 的返回值（data URL / Blob / 文本）
 * @param fileName 默认文件名（不含扩展名）
 * @param ext 扩展名（不含点）
 * @returns 保存后的路径；用户取消返回 null；浏览器环境下载后返回文件名
 */
export async function saveExportFile(
  data: string | Blob,
  fileName: string,
  ext: string,
  filterName = "思维导图"
): Promise<string | null> {
  const fullName = `${fileName}.${ext}`;
  const api = (window as any).electronAPI;
  if (typeof api?.saveBinaryFile !== "function") {
    console.info("[MindMap/saveExportFile] 非桌面环境，使用浏览器下载:", fullName);
    downloadInBrowser(data, fullName);
    return fullName;
  }
  const bytes = await toBytes(data);
  const savedPath = (await api.saveBinaryFile(bytes, fullName, filterName, [ext])) as string | null;
  console.info("[MindMap/saveExportFile] 导出保存结果:", savedPath ?? "用户取消");
  return savedPath;
}

/** 读取文件为文本 */
export function readFileAsText(file: File): Promise<string> {
  return file.text();
}

/** 读取文件为 ArrayBuffer（对应参考项目 fileToBuffer） */
export function fileToBuffer(file: File): Promise<ArrayBuffer> {
  return file.arrayBuffer();
}

/** 读取文件为 data URL（节点图片等） */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** 弹出文件选择框（对应参考项目各处的 <input type="file"> 用法） */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
}

/** 复制文本到剪贴板（对应参考项目 copy / setDataToClipboard） */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.warn("[MindMap/copyText] Clipboard API 不可用，改用原生接口:", error);
    try {
      return (await (window as any).electronAPI?.writeTextToClipboard?.(text)) !== false;
    } catch {
      return false;
    }
  }
}

/** 复制图片到剪贴板（对应参考项目 setImgToClipboard） */
export async function copyImage(blob: Blob): Promise<boolean> {
  try {
    await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
    return true;
  } catch (error) {
    console.warn("[MindMap/copyImage] 复制图片失败:", error);
    return false;
  }
}

/** 元素全屏 / 退出全屏（对应参考项目 fullScreen） */
export async function toggleFullscreen(element: HTMLElement): Promise<void> {
  if (document.fullscreenElement) {
    await document.exitFullscreen();
  } else {
    await element.requestFullscreen();
  }
}

/** 向上查找带指定类名的祖先（对应参考项目 getParentWithClass） */
export function getParentWithClass(el: Element | null, className: string): Element | null {
  return el?.closest(`.${className}`) ?? null;
}

/**
 * 备注 Markdown → HTML（替代参考项目的 @toast-ui/editor Viewer）
 * remark-rehype 默认丢弃原始 HTML，结果可安全插入 innerHTML。
 */
export async function markdownToHtml(markdown: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkRehype)
    .use(rehypeStringify)
    .process(markdown);
  return String(file);
}

/** 打印元素（对应参考项目 printOutline：大纲打印） */
export function printElement(el: HTMLElement): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("style", "position:absolute;width:0;height:0;border:0;");
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) return;
  // 开发环境样式在 <style> 里，生产构建在 <link> 里：两者都复制（link 用解析后的绝对地址）
  for (const style of Array.from(document.querySelectorAll("style"))) doc.write(style.outerHTML);
  for (const link of Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')
  )) {
    doc.write(`<link rel="stylesheet" href="${link.href}">`);
  }
  doc.write('<style media="print">@page {size: portrait;}</style>');
  doc.write(`<div>${el.outerHTML}</div>`);
  setTimeout(() => {
    iframe.contentWindow?.print();
    iframe.remove();
  }, 500);
}
