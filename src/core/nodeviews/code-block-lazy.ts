/**
 * 代码块 CodeMirror 懒创建基础设施
 *
 * 打开大文档时对每个 code_block 同步 `new EditorView` + 语言解析 + gutter 是打开耗时的头号因素
 * （对照 Typora：CodeMirror fence 同样是 IntersectionObserver 懒初始化、每批 ≤8 个；
 * nomo：renderTaskQueue 并发 2）。本模块提供三件事：
 *
 * 1. `CODE_BLOCK_LAZY` 回退开关：false 时 NodeView 构造即同步建 CodeMirror（旧行为）；
 * 2. 全局共享的「接近视口」IntersectionObserver（按 rootMargin 分组）：几百个块不建几百个 observer；
 * 3. 全局构建队列：进入视口的任务入队，每帧最多 build `CODE_BLOCK_BUILD_CONCURRENCY` 个，
 *    避免一次滚动命中几十个块时全部同步构建把一帧撑爆。
 */

/** 回退开关：false 走原同步直建路径（NodeView 构造即建 CodeMirror） */
export const CODE_BLOCK_LAZY = true;

/** 代码块提前预热距离：进入视口前 600px 即开始构建，正常滚动速度下无感 */
export const CODE_BLOCK_ROOT_MARGIN = "600px 0px";

/** 每帧最多构建的代码块数（参照 nomo renderTaskQueue(2)） */
const CODE_BLOCK_BUILD_CONCURRENCY = 2;

type LazyCallback = () => void;

interface SharedObserver {
  observer: IntersectionObserver;
  callbacks: Map<Element, LazyCallback>;
}

/** 按 rootMargin 分组的共享观察器：代码块与 Mermaid 预览各自的预热距离互不干扰 */
const sharedObservers = new Map<string, SharedObserver>();

function getSharedObserver(rootMargin: string): SharedObserver {
  let shared = sharedObservers.get(rootMargin);
  if (shared) return shared;

  const callbacks = new Map<Element, LazyCallback>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const run = callbacks.get(entry.target);
        if (!run) continue;
        // 一次性触发：进入视口即取消观察，回调只执行一次
        callbacks.delete(entry.target);
        observer.unobserve(entry.target);
        run();
      }
    },
    { rootMargin, threshold: 0.01 }
  );

  shared = { observer, callbacks };
  sharedObservers.set(rootMargin, shared);
  return shared;
}

/**
 * 观察元素接近视口，首次进入时触发一次回调并自动取消观察。
 *
 * 环境不支持 IntersectionObserver（测试 / 老内核）时立即执行回调。
 * 返回取消函数，NodeView 销毁时调用。
 */
export function observeNearViewport(
  element: Element,
  callback: LazyCallback,
  rootMargin = "360px 0px"
): () => void {
  if (typeof IntersectionObserver === "undefined") {
    callback();
    return () => {};
  }

  const shared = getSharedObserver(rootMargin);
  shared.callbacks.set(element, callback);
  shared.observer.observe(element);

  return () => {
    shared.callbacks.delete(element);
    shared.observer.unobserve(element);
  };
}

/** 待执行的构建任务（FIFO） */
const buildQueue: Array<() => void> = [];
let drainScheduled = false;

function scheduleDrain(): void {
  if (drainScheduled) return;
  drainScheduled = true;
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(drainBuildQueue);
  } else {
    setTimeout(drainBuildQueue, 0);
  }
}

/** 每帧按并发预算消费队列，剩余任务顺延到下一帧，让帧之间有机会绘制与响应输入 */
function drainBuildQueue(): void {
  drainScheduled = false;
  let budget = CODE_BLOCK_BUILD_CONCURRENCY;
  while (buildQueue.length > 0 && budget > 0) {
    const task = buildQueue.shift()!;
    budget -= 1;
    try {
      task();
    } catch (error) {
      console.error("[code-block-lazy] 代码块构建失败:", error);
    }
  }
  if (buildQueue.length > 0) scheduleDrain();
}

/**
 * 入队一个构建任务（NodeView 已进入视口）。
 *
 * 返回取消函数：NodeView 在任务执行前被销毁时移除未执行任务。
 * 需要立即建实例的场景（光标落进块内 / 点击骨架）不走队列，直接调用 ensureCodeMirror。
 */
export function scheduleCodeBlockBuild(task: () => void): () => void {
  buildQueue.push(task);
  scheduleDrain();
  return () => {
    const index = buildQueue.indexOf(task);
    if (index >= 0) buildQueue.splice(index, 1);
  };
}

/** 当前排队中的构建任务数（调试 / 测试用） */
export function getPendingCodeBlockBuildCount(): number {
  return buildQueue.length;
}
