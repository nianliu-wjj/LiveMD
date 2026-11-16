import { getCurrentWindow } from "@tauri-apps/api/window";

type PreviewItem = { src: string; alt?: string };
type PreviewPayload = { items: PreviewItem[]; index: number };

declare global {
  interface Window {
    __LIVEMD_IMAGE_PREVIEW__?: PreviewPayload;
    __LIVEMD_SET_PREVIEW__?: (payload: PreviewPayload) => void;
  }
}

const viewer = document.querySelector<HTMLDivElement>(".viewer")!;
const image = document.querySelector<HTMLImageElement>("#preview-image")!;
const counter = document.querySelector<HTMLDivElement>("#counter")!;
const closeButton = document.querySelector<HTMLButtonElement>("#close-button")!;
const prevButton = document.querySelector<HTMLButtonElement>("#prev-button")!;
const nextButton = document.querySelector<HTMLButtonElement>("#next-button")!;

let items: PreviewItem[] = [];
let currentIndex = 0;
let scale = 1;
let offsetX = 0;
let offsetY = 0;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragStartOffsetX = 0;
let dragStartOffsetY = 0;

const minScale = 0.2;
const maxScale = 8;

function canDragImage(): boolean {
  return scale > 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getDragBounds(): { x: number; y: number } {
  if (!canDragImage()) return { x: 0, y: 0 };
  const viewerRect = viewer.getBoundingClientRect();
  const scaledWidth = image.offsetWidth * scale;
  const scaledHeight = image.offsetHeight * scale;
  return {
    x: Math.max(0, (scaledWidth - viewerRect.width) / 2),
    y: Math.max(0, (scaledHeight - viewerRect.height) / 2),
  };
}

function clampOffsetToBounds(): boolean {
  const bounds = getDragBounds();
  const nextOffsetX = clamp(offsetX, -bounds.x, bounds.x);
  const nextOffsetY = clamp(offsetY, -bounds.y, bounds.y);
  const changed = nextOffsetX !== offsetX || nextOffsetY !== offsetY;
  offsetX = nextOffsetX;
  offsetY = nextOffsetY;
  return changed;
}

function applyTransform(): void {
  if (!canDragImage()) {
    offsetX = 0;
    offsetY = 0;
  }
  image.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
  viewer.classList.toggle("zoomed", canDragImage());
}

function settleOffsetWithinBounds(): void {
  if (!canDragImage()) {
    offsetX = 0;
    offsetY = 0;
    applyTransform();
    return;
  }
  if (clampOffsetToBounds()) applyTransform();
}

function showImage(index: number): void {
  if (!items.length) return;
  currentIndex = (index + items.length) % items.length;
  const item = items[currentIndex];
  image.src = item.src;
  image.alt = item.alt || "";
  document.title = item.alt || "图片预览";
  scale = 1;
  offsetX = 0;
  offsetY = 0;
  applyTransform();
  counter.textContent = `${currentIndex + 1} / ${items.length}`;
}

function showRelative(offset: number): void {
  showImage(currentIndex + offset);
}

function applyPayload(payload: PreviewPayload | undefined): void {
  if (!payload?.items?.length) return;
  items = payload.items;
  currentIndex = Math.min(
    Math.max(payload.index || 0, 0),
    Math.max(items.length - 1, 0),
  );
  const hasSwitcher = items.length > 1;
  prevButton.hidden = !hasSwitcher;
  nextButton.hidden = !hasSwitcher;
  counter.hidden = !hasSwitcher;
  showImage(currentIndex);
}

closeButton.addEventListener("click", () => {
  void getCurrentWindow().close();
});
prevButton.addEventListener("click", () => showRelative(-1));
nextButton.addEventListener("click", () => showRelative(1));

window.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const delta = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    scale = Math.min(maxScale, Math.max(minScale, scale * delta));
    if (canDragImage()) clampOffsetToBounds();
    applyTransform();
  },
  { passive: false },
);

viewer.addEventListener("mousedown", (event) => {
  if (event.button !== 0 || !canDragImage()) return;
  event.preventDefault();
  isDragging = true;
  dragStartX = event.clientX;
  dragStartY = event.clientY;
  dragStartOffsetX = offsetX;
  dragStartOffsetY = offsetY;
  viewer.classList.add("dragging");
});

window.addEventListener("mousemove", (event) => {
  if (!isDragging) return;
  event.preventDefault();
  offsetX = dragStartOffsetX + event.clientX - dragStartX;
  offsetY = dragStartOffsetY + event.clientY - dragStartY;
  applyTransform();
});

function stopDrag(): void {
  if (!isDragging) return;
  isDragging = false;
  viewer.classList.remove("dragging");
  settleOffsetWithinBounds();
}

window.addEventListener("mouseup", stopDrag);
window.addEventListener("mouseleave", stopDrag);
window.addEventListener("resize", settleOffsetWithinBounds);
image.addEventListener("load", settleOffsetWithinBounds);

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    void getCurrentWindow().close();
  } else if (event.key === "ArrowLeft") {
    showRelative(-1);
  } else if (event.key === "ArrowRight") {
    showRelative(1);
  } else if (event.key === "0") {
    scale = 1;
    offsetX = 0;
    offsetY = 0;
    applyTransform();
  }
});

window.__LIVEMD_SET_PREVIEW__ = applyPayload;
applyPayload(window.__LIVEMD_IMAGE_PREVIEW__);
