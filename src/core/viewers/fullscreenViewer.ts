/**
 * 通用全屏查看器
 *
 * 图片灯箱与 Mermaid 全屏共用同一套 overlay / 工具栏 / 缩放平移交互。
 * 内容节点由调用方准备（图片克隆或 SVG 克隆），本模块只负责布局与变换。
 */

import {
  applyTransform,
  centerTransform,
  clampPan,
  fitScale,
  modeScale,
  scaleAtPoint,
  type Size,
  type ZoomLimits,
  type ZoomMode,
  type ZoomTransform,
} from "./zoomView.ts";

const ICONS = {
  back: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>',
  close:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  zoomIn:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/></svg>',
  zoomOut:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M8 11h6"/></svg>',
  reset:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
  maximize:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
};

export { ICONS as FULLSCREEN_ICONS };

const MODE_LABELS: Record<ZoomMode, string> = {
  readable: "适合阅读",
  fit: "适应窗口",
  original: "原始尺寸",
  custom: "自定义",
};

export interface FullscreenAction {
  label: string;
  title?: string;
  icon?: string;
  onClick: () => void;
}

export interface FullscreenViewerOptions {
  kind: "image" | "mermaid";
  title?: string;
  /** 已准备好的内容节点（调用方负责克隆，避免移动原节点） */
  content: HTMLElement | SVGElement;
  contentSize: Size;
  modes?: ZoomMode[];
  initialMode?: ZoomMode;
  minScale?: number;
  maxScale?: number;
  actions?: FullscreenAction[];
  ariaLabel?: string;
  onClose?: () => void;
}

export interface FullscreenViewerHandle {
  readonly element: HTMLElement;
  readonly isOpen: boolean;
  close(): void;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
}

class FullscreenViewer implements FullscreenViewerHandle {
  readonly element: HTMLElement;

  private readonly options: FullscreenViewerOptions;
  private readonly limits: ZoomLimits;
  private readonly modes: ZoomMode[];
  private readonly initialMode: ZoomMode;
  private readonly viewport: HTMLElement;
  private readonly surface: HTMLElement;
  private readonly badge: HTMLElement;
  private readonly modeSelect: HTMLSelectElement | null;
  private readonly previousFocus: HTMLElement | null;

  private transform: ZoomTransform = { scale: 1, x: 0, y: 0 };
  private mode: ZoomMode;
  private drag: DragState | null = null;
  private closed = false;

  constructor(options: FullscreenViewerOptions) {
    this.options = options;
    this.limits = { min: options.minScale ?? 0.1, max: options.maxScale ?? 8 };
    this.modes =
      options.modes && options.modes.length > 0 ? [...options.modes] : ["fit", "original"];
    this.initialMode = options.initialMode ?? (this.modes.includes("fit") ? "fit" : this.modes[0]);
    this.mode = this.initialMode;
    this.previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    this.element = document.createElement("div");
    this.element.className = `livemd-fullscreen-viewer livemd-fullscreen-viewer--${options.kind}`;
    this.element.setAttribute("role", "dialog");
    this.element.setAttribute("aria-modal", "true");
    this.element.setAttribute("aria-label", options.ariaLabel ?? options.title ?? "全屏查看");

    const panel = document.createElement("div");
    panel.className = "livemd-fullscreen-viewer__panel";

    const toolbar = document.createElement("header");
    toolbar.className = "livemd-fullscreen-viewer__toolbar";

    const backButton = this.createIconButton("back", "返回文档", () => this.close());
    backButton.classList.add("livemd-fullscreen-viewer__back");
    backButton.innerHTML = `${ICONS.back}<span>返回文档</span>`;
    toolbar.appendChild(backButton);

    const title = document.createElement("div");
    title.className = "livemd-fullscreen-viewer__title";
    title.textContent = options.title ?? (options.kind === "image" ? "图片预览" : "图表预览");
    toolbar.appendChild(title);

    const actions = document.createElement("div");
    actions.className = "livemd-fullscreen-viewer__actions";
    for (const action of options.actions ?? []) {
      const button = this.createIconButton(
        action.label,
        action.title ?? action.label,
        action.onClick
      );
      if (action.icon) button.innerHTML = action.icon;
      actions.appendChild(button);
    }
    toolbar.appendChild(actions);

    let select: HTMLSelectElement | null = null;
    if (this.modes.length > 1) {
      const modeWrapper = document.createElement("label");
      modeWrapper.className = "livemd-fullscreen-viewer__mode";
      const modeLabel = document.createElement("span");
      modeLabel.textContent = "查看";
      select = document.createElement("select");
      select.className = "livemd-fullscreen-viewer__mode-select";
      for (const mode of this.modes) {
        const option = document.createElement("option");
        option.value = mode;
        option.textContent = MODE_LABELS[mode];
        select.appendChild(option);
      }
      select.value = this.initialMode;
      select.addEventListener("change", () => {
        this.setMode(select?.value as ZoomMode);
      });
      modeWrapper.append(modeLabel, select);
      toolbar.appendChild(modeWrapper);
    }
    this.modeSelect = select;

    const closeButton = this.createIconButton("close", "关闭 (Esc)", () => this.close());
    closeButton.classList.add("livemd-fullscreen-viewer__close");
    closeButton.innerHTML = ICONS.close;
    toolbar.appendChild(closeButton);
    panel.appendChild(toolbar);

    this.viewport = document.createElement("div");
    this.viewport.className = "livemd-fullscreen-viewer__viewport";
    this.surface = document.createElement("div");
    this.surface.className = "livemd-fullscreen-viewer__surface";
    this.surface.style.width = `${Math.max(1, options.contentSize.width)}px`;
    this.surface.style.height = `${Math.max(1, options.contentSize.height)}px`;

    // 统一内容尺寸，避免图片回退尺寸与 surface 不一致
    options.content.style.display = "block";
    options.content.style.width = `${Math.max(1, options.contentSize.width)}px`;
    options.content.style.height = `${Math.max(1, options.contentSize.height)}px`;
    options.content.style.maxWidth = "none";
    options.content.style.maxHeight = "none";
    this.surface.appendChild(options.content);
    this.viewport.appendChild(this.surface);
    panel.appendChild(this.viewport);

    const footer = document.createElement("footer");
    footer.className = "livemd-fullscreen-viewer__footer";

    const zoomControls = document.createElement("div");
    zoomControls.className = "livemd-fullscreen-viewer__zoom-controls";
    const zoomOut = this.createIconButton("zoom-out", "缩小 (-)", () => this.zoomBy(1 / 1.25));
    zoomOut.innerHTML = ICONS.zoomOut;
    const reset = this.createIconButton("reset", "适应窗口 (0)", () => this.reset());
    reset.innerHTML = ICONS.reset;
    const zoomIn = this.createIconButton("zoom-in", "放大 (+)", () => this.zoomBy(1.25));
    zoomIn.innerHTML = ICONS.zoomIn;
    zoomControls.append(zoomOut, reset, zoomIn);
    footer.appendChild(zoomControls);

    this.badge = document.createElement("span");
    this.badge.className = "livemd-fullscreen-viewer__badge";
    this.badge.setAttribute("aria-live", "polite");
    footer.appendChild(this.badge);

    const hint = document.createElement("span");
    hint.className = "livemd-fullscreen-viewer__hint";
    hint.textContent = "Ctrl/⌘ + 滚轮缩放 · 拖拽平移 · Esc 关闭";
    footer.appendChild(hint);
    panel.appendChild(footer);

    this.element.appendChild(panel);

    this.element.addEventListener("mousedown", (event) => {
      if (event.target === this.element) this.close();
    });
    this.viewport.addEventListener("wheel", this.onWheel, { passive: false });
    this.viewport.addEventListener("pointerdown", this.onPointerDown);
    this.viewport.addEventListener("pointermove", this.onPointerMove);
    this.viewport.addEventListener("pointerup", this.onPointerUp);
    this.viewport.addEventListener("pointercancel", this.onPointerUp);
    this.viewport.addEventListener("dblclick", this.onDoubleClick);
    window.addEventListener("keydown", this.onKeyDown, true);
    window.addEventListener("resize", this.onResize);

    document.body.appendChild(this.element);
    document.body.classList.add("livemd-fullscreen-open", `livemd-${options.kind}-fullscreen`);

    this.applyMode(this.initialMode, false);
    requestAnimationFrame(() => {
      if (!this.closed) closeButton.focus();
    });
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;

    window.removeEventListener("keydown", this.onKeyDown, true);
    window.removeEventListener("resize", this.onResize);
    this.viewport.removeEventListener("wheel", this.onWheel);
    this.viewport.removeEventListener("pointerdown", this.onPointerDown);
    this.viewport.removeEventListener("pointermove", this.onPointerMove);
    this.viewport.removeEventListener("pointerup", this.onPointerUp);
    this.viewport.removeEventListener("pointercancel", this.onPointerUp);
    this.viewport.removeEventListener("dblclick", this.onDoubleClick);
    this.releasePointer();

    this.element.remove();
    document.body.classList.remove(
      "livemd-fullscreen-open",
      `livemd-${this.options.kind}-fullscreen`
    );
    if (activeViewer === this) activeViewer = null;
    this.options.onClose?.();

    if (this.previousFocus?.isConnected) {
      this.previousFocus.focus();
    }
  }

  private createIconButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "livemd-fullscreen-viewer__button";
    button.setAttribute("aria-label", label);
    button.title = title;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  private getViewportSize(): Size {
    const rect = this.viewport.getBoundingClientRect();
    return {
      width: Math.max(1, rect.width || this.viewport.clientWidth || window.innerWidth),
      height: Math.max(1, rect.height || this.viewport.clientHeight || window.innerHeight),
    };
  }

  private setMode(mode: ZoomMode, animate = true): void {
    this.mode = mode;
    this.applyMode(mode, animate);
  }

  private applyMode(mode: ZoomMode, _animate = true): void {
    const viewport = this.getViewportSize();
    const content = this.options.contentSize;

    if (mode === "custom") {
      this.transform = clampPan(this.transform, content, viewport);
    } else {
      const scale = modeScale(mode, content, viewport, {
        ...this.limits,
        fallbackScale: this.transform.scale,
      });
      this.transform = centerTransform(content, viewport, scale);
    }

    if (this.modeSelect) this.modeSelect.value = mode;
    this.apply();
  }

  private apply(): void {
    applyTransform(this.surface, this.transform);
    this.badge.textContent = `${Math.round(this.transform.scale * 100)}%`;
    this.element.dataset.scale = String(this.transform.scale);
    this.element.dataset.mode = this.mode;
  }

  private zoomBy(factor: number, point?: { x: number; y: number }): void {
    const viewport = this.getViewportSize();
    const pivot = point ?? { x: viewport.width / 2, y: viewport.height / 2 };
    const nextScale = this.transform.scale * factor;

    // 缩小到 fit 比例以下时回到 fit，避免用户陷入过小视图
    const fit = fitScale(this.options.contentSize, viewport, { ...this.limits, padding: 32 });
    if (factor < 1 && nextScale <= fit + 1e-4) {
      this.setMode("fit");
      return;
    }

    this.transform = scaleAtPoint(this.transform, nextScale, pivot.x, pivot.y, this.limits);
    this.transform = clampPan(this.transform, this.options.contentSize, viewport);
    this.mode = "custom";
    if (this.modeSelect) this.modeSelect.value = "custom";
    this.apply();
  }

  private reset(): void {
    this.setMode(this.initialMode === "custom" ? "fit" : this.initialMode);
  }

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : 1;
    const deltaX = event.deltaX * unit;
    const deltaY = event.deltaY * unit;

    if (event.ctrlKey || event.metaKey) {
      const rect = this.viewport.getBoundingClientRect();
      const factor = Math.exp(-deltaY * 0.0015);
      this.zoomBy(factor, {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
      return;
    }

    this.transform = clampPan(
      {
        ...this.transform,
        x: this.transform.x - deltaX,
        y: this.transform.y - deltaY,
      },
      this.options.contentSize,
      this.getViewportSize()
    );
    this.apply();
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest("button, select, a")) return;

    this.drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: this.transform.x,
      originY: this.transform.y,
    };
    this.viewport.setPointerCapture(event.pointerId);
    this.viewport.classList.add("dragging");
    event.preventDefault();
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    const next = {
      ...this.transform,
      x: this.drag.originX + (event.clientX - this.drag.startX),
      y: this.drag.originY + (event.clientY - this.drag.startY),
    };
    this.transform = clampPan(next, this.options.contentSize, this.getViewportSize());
    this.apply();
    event.preventDefault();
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    this.releasePointer();
  };

  private releasePointer(): void {
    if (!this.drag) return;
    try {
      if (this.viewport.hasPointerCapture(this.drag.pointerId)) {
        this.viewport.releasePointerCapture(this.drag.pointerId);
      }
    } catch {
      // 指针可能已经释放，忽略
    }
    this.drag = null;
    this.viewport.classList.remove("dragging");
  }

  private onDoubleClick = (event: MouseEvent): void => {
    if (event.target instanceof Element && event.target.closest("button, select, a")) return;
    this.setMode(this.mode === "original" ? "fit" : "original");
  };

  private onResize = (): void => {
    if (this.mode === "custom") {
      this.transform = clampPan(this.transform, this.options.contentSize, this.getViewportSize());
      this.apply();
    } else {
      this.applyMode(this.mode, false);
    }
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    const key = event.key;
    const target = event.target;
    const isFormControl =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement;

    if (key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }

    if (key === "Tab") {
      this.trapFocus(event);
      return;
    }

    if (isFormControl) return;

    if (key === "+" || key === "=") {
      event.preventDefault();
      event.stopPropagation();
      this.zoomBy(1.25);
    } else if (key === "-" || key === "_") {
      event.preventDefault();
      event.stopPropagation();
      this.zoomBy(1 / 1.25);
    } else if (key === "0") {
      event.preventDefault();
      event.stopPropagation();
      this.reset();
    } else if (key === "f" || key === "F") {
      event.preventDefault();
      event.stopPropagation();
      this.setMode("fit");
    } else if (key === "1") {
      event.preventDefault();
      event.stopPropagation();
      this.setMode("original");
    }
  };

  private trapFocus(event: KeyboardEvent): void {
    const focusable = Array.from(
      this.element.querySelectorAll<HTMLElement>(
        'button:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      )
    ).filter((element) => element.offsetParent !== null);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && (active === first || !this.element.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !this.element.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }
}

let activeViewer: FullscreenViewer | null = null;

export function openFullscreenViewer(options: FullscreenViewerOptions): FullscreenViewerHandle {
  activeViewer?.close();
  const viewer = new FullscreenViewer(options);
  activeViewer = viewer;
  return viewer;
}

export function closeActiveFullscreenViewer(): void {
  activeViewer?.close();
}
