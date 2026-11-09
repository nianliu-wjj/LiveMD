/**
 * 文档检查 Web Worker：拼写检查 + 格式检查在独立线程执行
 *
 * 主线程只负责收发消息与超时控制，markdownlint / nspell 的全文档扫描
 * 完全移出 UI 线程，长文档检查不再冻结编辑器。
 *
 * 消息协议：
 * - 入站  { type: "lint"; id; content; ruleConfig; spellEnabled?; dictionaryBaseUrl? }
 * - 出站  { type: "result"; id; result: DocumentLintResult }
 *        { type: "error";  id; message: string }
 *
 * 词典在 worker 内加载（首次任务时懒加载并常驻），与主线程各自独立。
 */
// 必须是第一个 import：为 Worker 注入 $t 兜底（见 workerI18nShim.ts）
import "./workerI18nShim.ts";
import { runDocumentLint, type DocumentLintResult, type RuleConfig } from "./documentLint.ts";

interface LintRequest {
  type: "lint";
  id: number;
  content: string;
  ruleConfig: RuleConfig;
  /** 拼写检查开关（默认开启） */
  spellEnabled?: boolean;
  /** 主线程的 base（vite base: "./"），词典 fetch 路径以主文档位置解析 */
  dictionaryBaseUrl?: string;
}

interface LintResultMessage {
  type: "result";
  id: number;
  result: DocumentLintResult;
}

interface LintErrorMessage {
  type: "error";
  id: number;
  message: string;
}

/**
 * worker 全局作用域的收窄视图
 *
 * tsconfig 的 lib 只有 DOM（self 被推断为 Window），而 Window.postMessage 需要
 * targetOrigin 参数，与 worker 的 postMessage(message) 签名不符；这里按 worker 语义收窄。
 */
const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<LintRequest>) => void) | null;
  postMessage: (message: LintResultMessage | LintErrorMessage) => void;
};

workerScope.onmessage = async (event: MessageEvent<LintRequest>) => {
  const request = event.data;
  if (request?.type !== "lint") return;

  try {
    const result = await runDocumentLint(
      request.content,
      request.ruleConfig,
      request.dictionaryBaseUrl,
      request.spellEnabled ?? true
    );
    const response: LintResultMessage = { type: "result", id: request.id, result };
    workerScope.postMessage(response);
  } catch (error) {
    const response: LintErrorMessage = {
      type: "error",
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
    };
    workerScope.postMessage(response);
  }
};
