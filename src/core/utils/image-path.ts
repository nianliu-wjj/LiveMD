import { convertFileSrc } from "@tauri-apps/api/core";

function dirname(filePath: string): string {
  const sep = filePath.includes("\\") ? "\\" : "/";
  const lastIndex = filePath.lastIndexOf(sep);
  return lastIndex === -1 ? "." : filePath.substring(0, lastIndex);
}

function joinPath(dir: string, relative: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  let rel = relative;
  while (rel.startsWith("./") || rel.startsWith(".\\")) {
    rel = rel.substring(2);
  }
  while (rel.startsWith("/") || rel.startsWith("\\")) {
    rel = rel.substring(1);
  }
  return (dir + sep + rel).replace(/\\/g, "/");
}

function isAbsoluteLocalPath(src: string): boolean {
  if (!src) return false;

  const platform = (window as any).electronAPI?.platform;
  if (platform === "win32") {
    return /^[a-z]:[\\/]/i.test(src) || /^\\\\[^\\]/.test(src);
  }

  return src.startsWith("/");
}

function toAssetUrl(src: string): string {
  try {
    return convertFileSrc(src.replace(/\\/g, "/"));
  } catch (error) {
    console.error("[image-path] 转换本地图片地址失败:", src, error);
    return src;
  }
}

/**
 * Tauri 资源地址反解为本地路径
 *
 * convertFileSrc 产出的地址形如：
 * - Windows：http(s)://asset.localhost/C:/path/to/a.png
 * - macOS / Linux：asset://localhost/path/to/a.png
 * 导出 HTML 需要把这类地址还原成文件系统路径，交给 Rust 读取为 Base64。
 */
export function assetUrlToLocalPath(src: string): string | null {
  try {
    const url = new URL(src);
    const isAssetUrl =
      url.protocol === "asset:" ||
      url.hostname === "asset.localhost" ||
      url.hostname === "localhost.asset";
    if (!isAssetUrl) return null;

    const decoded = decodeURIComponent(url.pathname);
    if (!decoded) return null;

    // Windows 盘符路径会带前导斜杠（/C:/...），去掉后才能被 Rust 识别为绝对路径
    const isWindowsDrive = decoded.length > 2 && decoded[0] === "/" && decoded[2] === ":";
    const localPath = isWindowsDrive ? decoded.slice(1) : decoded;
    return localPath || null;
  } catch {
    return null;
  }
}

export function fileUrlToLocalPath(src: string): string | null {
  try {
    const url = new URL(src);
    if (url.protocol !== "file:") return null;
    let path = decodeURIComponent(url.pathname);
    if (url.host) {
      path = `\\\\${url.host}${path.replace(/\//g, "\\")}`;
    } else if (/^\/[a-z]:/i.test(path)) {
      path = path.slice(1);
    }
    return path;
  } catch {
    return null;
  }
}

function resolveLivemdUrl(src: string): string | null {
  // 按固定长度剥离 livemd:// 前缀
  let raw = src.slice("livemd://".length);
  if (raw.startsWith("/")) raw = raw.slice(1);
  const slash = raw.indexOf("/");
  if (slash === -1) return null;

  const encodedMarkdownPath = raw.slice(0, slash);
  const relativePath = raw.slice(slash + 1);
  try {
    const bytes = Uint8Array.from(atob(encodedMarkdownPath), (char) => char.charCodeAt(0));
    const markdownPath = new TextDecoder().decode(bytes);
    const absolutePath = joinPath(dirname(markdownPath), decodeURIComponent(relativePath));
    return toAssetUrl(absolutePath);
  } catch (error) {
    console.error("[image-path] 解析 livemd:// 地址失败:", src, error);
    return null;
  }
}

export function resolveImageSrc(src: string): string {
  if (!src) return src;

  if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:")) {
    return src;
  }

  if (src.startsWith("livemd://")) {
    return resolveLivemdUrl(src) ?? src;
  }

  if (src.startsWith("file://")) {
    const localPath = fileUrlToLocalPath(src);
    return localPath ? toAssetUrl(localPath) : src;
  }

  if (isAbsoluteLocalPath(src)) {
    return toAssetUrl(src);
  }

  const currentFilePath = (window as any).__currentFilePath;
  if (!currentFilePath) return src;

  const absolutePath = joinPath(dirname(currentFilePath), src);
  return toAssetUrl(absolutePath);
}
