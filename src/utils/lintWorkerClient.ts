/**
 * 文档检查 Worker 客户端：单 worker 通道 + 超时熔断 + 切文档抢占
 *
 * - 所有检查走同一个 worker 串行执行，避免多 worker 重复加载词典/规则；
 * - 每个任务带超时（LINT_TASK_TIMEOUT_MS）：超时后 terminate 旧 worker 并新建，
 *   防止病态输入让线程一直处于运行态占用资源；
 * - 新任务到来时旧任务立即作废：terminate 当前 worker 换新线程处理新文档，
 *   旧文档的残余计算随线程销毁，不排队、不阻塞新文档；
 * - Worker 不可用的环境（Node 测试 / 老内核）自动降级为主线程直跑。
 */
import type { DocumentLintResult, RuleConfig } from "./documentLint.ts";

/** 单次检查任务超时：大文档 markdownlint 全规则通常在秒级，超时视为线程异常 */
const LINT_TASK_TIMEOUT_MS = 30_000;

/** worker 不可用时的同步兜底实现（动态 import，避免主线程无谓加载 lint 依赖） */
let fallbackRunner: Promise<typeof import("./documentLint.ts")> | null = null;

function loadFallback(): Promise<typeof import("./documentLint.ts")> {
  fallbackRunner ??= import("./documentLint.ts");
  return fallbackRunner;
}

/** worker 是否可用于当前环境（Node 测试环境无 Worker 构造器） */
function isWorkerAvailable(): boolean {
  return typeof Worker !== "undefined";
}

interface PendingTask {
  id: number;
  resolve: (result: DocumentLintResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  onProgress?: (result: DocumentLintResult) => void;
}

let worker: Worker | null = null;
let nextTaskId = 1;
let pending: PendingTask | null = null;

function createWorker(): Worker {
  const instance = new Worker(new URL("./lintWorker.worker.ts", import.meta.url), {
    type: "module",
  });

  instance.onmessage = (event: MessageEvent) => {
    const data = event.data as {
      type: string;
      id: number;
      result?: DocumentLintResult;
      message?: string;
    };
    if (!pending || data.id !== pending.id) return;
    if (data.type === "progress" && data.result) {
      pending.onProgress?.(data.result);
      return;
    }
    clearTimeout(pending.timer);
    const task = pending;
    pending = null;
    if (data.type === "result" && data.result) {
      task.resolve(data.result);
    } else {
      task.reject(new Error(data.message ?? "文档检查 worker 返回错误"));
    }
  };

  instance.onerror = (event: ErrorEvent) => {
    // 脚本加载/运行失败：拒绝当前任务并销毁线程，下次任务重建
    console.error("[lintWorkerClient] worker 加载或运行失败:", event.message);
    const task = pending;
    pending = null;
    if (task) {
      clearTimeout(task.timer);
      task.reject(new Error(event.message || "文档检查 worker 加载失败"));
    }
    instance.terminate();
    if (worker === instance) worker = null;
  };

  return instance;
}

/**
 * 抢占在途任务：有任务在跑时销毁线程（残余计算随线程结束），任务以取消收场
 *
 * 空闲线程保留：其中已加载的规则与拼写词典可复用，否则每次防抖重查都要重新初始化词典。
 */
function killWorker(): void {
  if (!pending) return;
  clearTimeout(pending.timer);
  pending.reject(new Error("文档检查任务已取消"));
  pending = null;
  if (worker) {
    worker.terminate();
    worker = null;
  }
}

function runInWorker(
  content: string,
  ruleConfig: RuleConfig,
  spellEnabled: boolean,
  dictionaryBaseUrl?: string,
  onProgress?: (result: DocumentLintResult) => void
): Promise<DocumentLintResult> {
  // 新任务抢占：立即废弃旧任务并重建线程（换文档场景——旧文档检查直接终止）
  killWorker();
  const instance = worker ?? createWorker();
  worker = instance;

  const id = nextTaskId++;
  return new Promise<DocumentLintResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      // 超时熔断：terminate 卡死的线程并新建，防止一直处于运行态占用资源
      if (worker === instance) {
        worker = null;
      }
      instance.terminate();
      if (pending?.id === id) {
        pending = null;
      }
      console.error("[lintWorkerClient] 文档检查超时，已终止 worker，任务:", id);
      reject(new Error(`文档检查超时（${Math.round(LINT_TASK_TIMEOUT_MS / 1000)}s）`));
    }, LINT_TASK_TIMEOUT_MS);

    pending = { id, resolve, reject, timer, onProgress };
    instance.postMessage({
      type: "lint",
      id,
      content,
      // 调用方传入的通常是 Vue 响应式代理，结构化克隆不支持 Proxy（报 could not be cloned），
      // 这里展开成普通对象再发送（规则配置只有一层 boolean 值）
      ruleConfig: { ...ruleConfig },
      spellEnabled,
      dictionaryBaseUrl,
    });
  });
}

/** 主线程文档 base（vite base: "./"），供 worker 内词典 fetch 使用 */
function getDictionaryBaseUrl(): string | undefined {
  if (typeof location === "undefined") return undefined;
  // 以当前页面目录为准（location.href 去掉文件名部分），与 BASE_URL: "./" 的解析一致
  return location.href.replace(/[^/]*$/, "");
}

/**
 * 执行文档检查：优先 worker 线程，不可用时降级主线程直跑（Node 测试环境）
 *
 * spellEnabled 为 false 时跳过拼写阶段（拼写开关关闭）。
 */
export async function runLintOffThread(
  content: string,
  ruleConfig: RuleConfig,
  spellEnabled = true,
  dictionaryBaseUrl?: string,
  onProgress?: (result: DocumentLintResult) => void
): Promise<DocumentLintResult> {
  const base = dictionaryBaseUrl ?? getDictionaryBaseUrl();
  if (!isWorkerAvailable()) {
    const { runDocumentLint } = await loadFallback();
    return runDocumentLint(content, ruleConfig, base, spellEnabled, onProgress, false);
  }
  return runInWorker(content, ruleConfig, spellEnabled, base, onProgress);
}

/** 当前是否有任务在途（供调用方判断竞态） */
export function hasInFlightLintTask(): boolean {
  return pending !== null;
}

/** 主动取消在途任务（关闭面板等场景可选调用） */
export function cancelLintTask(): void {
  killWorker();
}
