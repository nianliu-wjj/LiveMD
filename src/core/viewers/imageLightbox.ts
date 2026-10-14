/**
 * 图片灯箱
 *
 * 从正文中的 <img> 克隆一份内容，交给通用全屏查看器。
 * 小图默认按原始尺寸居中，不强制放大；大图按视口完整显示。
 */

import {
  FULLSCREEN_ICONS,
  openFullscreenViewer,
  type FullscreenViewerHandle,
} from "./fullscreenViewer.ts";
import type { Size } from "./zoomView.ts";

export interface ImageLightboxOptions {
  image: HTMLImageElement;
  alt?: string;
  title?: string;
  onOpenExternal?: () => void;
  onClose?: () => void;
}

function fallbackSize(image: HTMLImageElement): Size {
  const rect = image.getBoundingClientRect();
  return {
    width: rect.width > 0 ? rect.width : 800,
    height: rect.height > 0 ? rect.height : 600,
  };
}

async function resolveImageSize(image: HTMLImageElement, clone: HTMLImageElement): Promise<Size> {
  if (image.naturalWidth > 0 && image.naturalHeight > 0) {
    return { width: image.naturalWidth, height: image.naturalHeight };
  }
  if (clone.complete && clone.naturalWidth > 0 && clone.naturalHeight > 0) {
    return { width: clone.naturalWidth, height: clone.naturalHeight };
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clone.removeEventListener("load", finish);
      clone.removeEventListener("error", finish);
      resolve();
    };
    clone.addEventListener("load", finish, { once: true });
    clone.addEventListener("error", finish, { once: true });
    window.setTimeout(finish, 3000);
  });

  if (clone.naturalWidth > 0 && clone.naturalHeight > 0) {
    return { width: clone.naturalWidth, height: clone.naturalHeight };
  }
  return fallbackSize(image);
}

export async function openImageLightbox(
  options: ImageLightboxOptions
): Promise<FullscreenViewerHandle | null> {
  const source = options.image.currentSrc || options.image.src;
  if (!source) return null;

  const clone = document.createElement("img");
  clone.className = "livemd-image-lightbox__image";
  clone.src = source;
  clone.alt = options.alt ?? options.image.alt ?? "";
  clone.draggable = false;
  clone.decoding = "async";
  clone.referrerPolicy = "no-referrer";

  const size = await resolveImageSize(options.image, clone);
  const actions = options.onOpenExternal
    ? [
        {
          label: "在独立窗口打开",
          title: "在独立窗口打开",
          icon: FULLSCREEN_ICONS.maximize,
          onClick: options.onOpenExternal,
        },
      ]
    : [];

  return openFullscreenViewer({
    kind: "image",
    title: options.title || options.alt || "图片预览",
    content: clone,
    contentSize: size,
    modes: ["fit", "original"],
    initialMode: "fit",
    minScale: 0.1,
    maxScale: 8,
    actions,
    onClose: options.onClose,
  });
}
