/**
 * 渲染调度器：昂贵渲染与打字路径的帧预算隔离（无感渲染 P1）
 *
 * 依据 docs/REA-MARKDOWN-RENDER-TIMING.md 公理 E（Typora busy 抑制 / 范围化 /
 * 遮罩类）与 docs/SEAMLESS-RENDER-DESIGN.md 4.1 节设计：Mermaid、KaTeX 大公式、
 * 代码高亮重建属百毫秒级任务，与键入同帧执行会吃满输入帧。本调度器提供：
 *
 * - **busy 协议**：输入路径（dispatchTransaction 的 docChanged 分支）调用
 *   notifyTyping() 置忙，静默窗口（BUSY_IDLE_MS 无输入）后泄洪——打字期间
 *   background 档任务挂起，用户停下才执行；
 * - **双档位**：interactive（光标所在块，用户正在看）只顺延到当前帧之后，
 *   永不被 busy 挂起；background（视口外/非活跃块）在 busy 期间排队；
 * - **孤儿取消**：文档切换 / 块删除时按 blockKey 取消排队中的任务，
 *   防旧渲染回写已删除节点。
 *
 * 调度器只决定「何时开始」，不改变任务内部语义：Mermaid 的模块级串行队列、
 * 缓存与懒加载保持原样（见 code-block.ts）。任务执行帧内不得触碰文本 DOM
 * （WKWebView 幽灵态纪律）；渲染遮罩类 livemd-render-pending 由发起方
 * （nodeview）在入队时挂上、任务落定后摘除，先按住、算完放开。
 */

/** busy 静默窗口：最后一次输入后多久泄洪挂起的 background 任务 */
const BUSY_IDLE_MS = 300;

/** 渲染任务 */
export interface RenderTask {
  /** 任务归属块标识（PM pos 派生），用于范围化与孤儿取消 */
  blockKey: string;
  /** interactive：仅顺延到当前帧后；background：busy 期间挂起 */
  kind: "interactive" | "background";
  run: (signal: AbortSignal) => void | Promise<void>;
}

interface QueueEntry {
  task: RenderTask;
  controller: AbortController;
}

/** 下一帧待执行队列 */
let frameQueue: QueueEntry[] = [];
let frameScheduled = false;

/** busy 期间挂起的 background 任务 */
let heldBackground: QueueEntry[] = [];

/** 排队中（frameQueue + heldBackground）任务按 blockKey 的索引，供孤儿取消 */
const queuedByBlock = new Map<string, Set<QueueEntry>>();

/** busy 标志与静默计时器 */
let busy = false;
let busyTimer: ReturnType<typeof setTimeout> | null = null;

function removeFromQueued(entry: QueueEntry): void {
  const set = queuedByBlock.get(entry.task.blockKey);
  if (!set) return;
  set.delete(entry);
  if (set.size === 0) queuedByBlock.delete(entry.task.blockKey);
}

/** Node 环境兜底：无 requestAnimationFrame 时退化为宏任务 */
function nextFrame(callback: () => void): void {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => callback());
  } else {
    setTimeout(callback, 16);
  }
}

function flushFrameQueue(): void {
  frameScheduled = false;
  const entries = frameQueue;
  frameQueue = [];
  for (const entry of entries) {
    removeFromQueued(entry);
    if (entry.controller.signal.aborted) continue;
    try {
      const result = entry.task.run(entry.controller.signal);
      // 异步任务的失败只记日志：渲染失败不允许击穿调度器或编辑器主流程
      if (result instanceof Promise) {
        result.catch((error) => console.error("[livemd-render-scheduler]", error));
      }
    } catch (error) {
      console.error("[livemd-render-scheduler]", error);
    }
  }
}

/** 入队到下一帧（合并同帧多次入队） */
function scheduleFrame(entry: QueueEntry): void {
  frameQueue.push(entry);
  if (!frameScheduled) {
    frameScheduled = true;
    nextFrame(() => flushFrameQueue());
  }
}

/** 静默窗口到期：busy 解除，泄洪挂起的 background 任务 */
function drainHeld(): void {
  busyTimer = null;
  busy = false;
  if (heldBackground.length === 0) return;
  const entries = heldBackground;
  heldBackground = [];
  for (const entry of entries) {
    scheduleFrame(entry);
  }
}

export const renderScheduler = {
  /**
   * 输入开始（编辑器 dispatchTransaction 检测到 docChanged 时）置忙。
   * busy 期间 background 任务挂起；静默 BUSY_IDLE_MS 后泄洪。
   */
  notifyTyping(): void {
    busy = true;
    if (busyTimer !== null) clearTimeout(busyTimer);
    busyTimer = setTimeout(drainHeld, BUSY_IDLE_MS);
  },

  /** 入队一个渲染任务（interactive 只顺延到帧后；background 在 busy 期间挂起） */
  enqueue(task: RenderTask): void {
    const entry: QueueEntry = { task, controller: new AbortController() };
    let set = queuedByBlock.get(task.blockKey);
    if (!set) {
      set = new Set();
      queuedByBlock.set(task.blockKey, set);
    }
    set.add(entry);

    if (task.kind === "background" && busy) {
      heldBackground.push(entry);
    } else {
      scheduleFrame(entry);
    }
  },

  /** 文档切换 / 块删除时取消该块的排队中任务（防旧渲染回写已删除节点） */
  cancelBlock(blockKey: string): void {
    const set = queuedByBlock.get(blockKey);
    if (!set) return;
    for (const entry of set) {
      entry.controller.abort();
    }
    heldBackground = heldBackground.filter((entry) => !set.has(entry));
    frameQueue = frameQueue.filter((entry) => !set.has(entry));
    queuedByBlock.delete(blockKey);
  },

  /** 当前是否处于 busy 窗口（测试 / 冒烟观测用） */
  isBusy(): boolean {
    return busy;
  },
};

/**
 * 渲染遮罩：入队时按住块当前内容（visibility:hidden + 锁定现有高度），
 * 返回幂等的释放函数（任务落定后调用）。
 *
 * - 用 visibility 而非 display:none：锁高期间布局不塌陷、滚动位置不跳（REA 公理 E-4）；
 * - min-height 由调用方现场取 getBoundingClientRect 写入行内样式，摘除时一并清除；
 * - 任何不落定的路径（取消 / 销毁 / 被 newer 遮罩超越）都必须先释放旧遮罩，
 *   泄漏 = 预览永久不可见。
 */
export function applyRenderPendingMask(el: HTMLElement): () => void {
  const height = el.getBoundingClientRect().height;
  el.classList.add("livemd-render-pending");
  if (height > 0) el.style.minHeight = `${Math.round(height)}px`;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    el.classList.remove("livemd-render-pending");
    el.style.minHeight = "";
  };
}
