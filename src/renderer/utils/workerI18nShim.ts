/**
 * Worker 线程的 i18n 兜底：必须作为 lintWorker.worker.ts 的第一个 import
 *
 * vite-auto-i18n-plugin 会把 src 下源码里的中文字符串改写为 `$t(key, 原文, 命名空间)` 调用，
 * 但 `$t` 只在主线程入口注册；检查 Worker 是独立的全局作用域，没有这个函数，
 * 一执行到被改写的提示文案就抛 `ReferenceError: $t is not defined`，整次检查失败。
 *
 * 这里在 Worker 全局注入一个返回原文的 `$t`：Worker 内的提示文案保持中文原文，
 * 与界面语言无关的检查逻辑不受影响。主线程已有真实实现时不覆盖。
 */

type TranslateFn = (key: string, original?: string, namespace?: string) => string;

const scope = globalThis as typeof globalThis & { $t?: TranslateFn };

if (typeof scope.$t !== "function") {
  scope.$t = (key, original) => (typeof original === "string" ? original : key);
}

export {};
