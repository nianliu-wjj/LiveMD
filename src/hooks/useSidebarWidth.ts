const SIDEBAR_DEFAULT_RATIO = 0.25;
export const SIDEBAR_DEFAULT_CSS = `${SIDEBAR_DEFAULT_RATIO * 100}%`;
const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 600;
const SIDEBAR_MAX_RATIO = 0.5;

interface SidebarWidthBounds {
  min: number;
  max: number;
}

interface SidebarWidthControllerOptions {
  getContainerWidth: () => number;
  getPreferredWidth: () => number | null | undefined;
  setPreferredWidth: (width: number) => void;
}

interface SidebarWidthController {
  getBounds: () => SidebarWidthBounds;
  getWidth: () => number;
  beginResize: (clientX: number) => void;
  resizeTo: (clientX: number) => number;
  endResize: () => void;
  refresh: () => number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

export function createSidebarWidthController(
  options: SidebarWidthControllerOptions
): SidebarWidthController {
  let width = 0;
  let resizing = false;
  let resizeStartX = 0;
  let resizeStartWidth = 0;

  function getBounds(): SidebarWidthBounds {
    const containerWidth = Math.max(0, options.getContainerWidth());
    const max = Math.min(SIDEBAR_MAX_WIDTH, Math.floor(containerWidth * SIDEBAR_MAX_RATIO));
    return {
      min: Math.min(SIDEBAR_MIN_WIDTH, max),
      max,
    };
  }

  function resolveWidth(): number {
    const bounds = getBounds();
    const preferredWidth = options.getPreferredWidth();
    const requestedWidth =
      typeof preferredWidth === "number" && Number.isFinite(preferredWidth)
        ? preferredWidth
        : options.getContainerWidth() * SIDEBAR_DEFAULT_RATIO;
    return clamp(requestedWidth, bounds.min, bounds.max);
  }

  width = resolveWidth();

  return {
    getBounds,
    getWidth: () => width,
    beginResize(clientX) {
      resizeStartX = clientX;
      resizeStartWidth = width;
      resizing = true;
    },
    resizeTo(clientX) {
      if (!resizing) return width;
      width = clamp(resizeStartWidth + clientX - resizeStartX, getBounds().min, getBounds().max);
      return width;
    },
    endResize() {
      if (!resizing) return;
      resizing = false;
      options.setPreferredWidth(width);
    },
    refresh() {
      width = resolveWidth();
      return width;
    },
  };
}
