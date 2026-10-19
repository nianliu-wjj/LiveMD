/**
 * 文档检查 Store（拼写 + 格式）
 *
 * 单例设计（模块级 ref）：状态栏按钮、结果面板与设置页共享同一份规则配置与检查结果。
 *
 * 三项关键机制（对齐 docs/2026-10-29-md-editor-fix-guide-from-livemd.md 修复 4）：
 * 1. **立即反馈**：openLintPanel() 先开面板，无结果归属时立刻发起检查；
 * 2. **tab 归属**：结果记录归属 tab，切 tab 后旧结果不再展示（currentResult 视为空）；
 * 3. **版本化防竞态**：每次检查带自增 generation，切 tab 或新检查发起时旧结果直接丢弃。
 *
 * 另含面板打开时的「内容变化防抖重查」（600ms），配合修复 1/2 的分批扫描避免卡顿。
 */
import { computed, ref, watch } from "vue";
import useSpellCheck from "@/renderer/hooks/useSpellCheck";
import useTab from "@/renderer/hooks/useTab";
import { runLintOffThread } from "@/renderer/utils/lintWorkerClient";
import {
  applyAllFixes,
  readRuleConfig,
  writeRuleConfig,
  type DocumentLintResult,
  type FormatIssue,
  type RuleConfig,
} from "@/renderer/utils/documentLint";

const { isSpellCheckEnabled } = useSpellCheck();

/** 空结果常量：多个分支复用同一对象，便于引用比较 */
const EMPTY_RESULT: DocumentLintResult = { spellIssues: [], formatIssues: [] };

/** 规则启用表（初始化即读取持久化配置） */
const ruleConfig = ref<RuleConfig>(readRuleConfig());

/** 最近一次检查结果（未做 tab 归属校验，展示请用 currentResult） */
const lintResult = ref<DocumentLintResult>(EMPTY_RESULT);

/** 是否正在检查（按钮禁用与面板提示用） */
const isLintRunning = ref(false);

/** 结果面板是否可见 */
const isLintPanelVisible = ref(false);

/** 结果归属的 tab id（切 tab 后旧结果不再展示） */
const resultTabId = ref<string | null>(null);

/** 检查版本号：每次发起检查 +1，完成时版本不符则丢弃结果 */
let checkGeneration = 0;

/** 结果按 tab 缓存：key 为 tab.id，value 为该内容检查过的结果与内容快照 */
const resultCache = new Map<string, { content: string; result: DocumentLintResult }>();

/** 结果缓存容量上限：按 tab.id 的 LRU 顺序淘汰 */
const RESULT_CACHE_LIMIT = 20;

function cacheResult(tabId: string, content: string, nextResult: DocumentLintResult): void {
  resultCache.delete(tabId);
  resultCache.set(tabId, { content, result: nextResult });
  if (resultCache.size > RESULT_CACHE_LIMIT) {
    const oldest = resultCache.keys().next().value;
    if (oldest !== undefined) resultCache.delete(oldest);
  }
}

/** 内容变化自动重查的防抖定时器 */
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** 面板打开时的自动重查防抖间隔（ms） */
const AUTO_CHECK_DEBOUNCE_MS = 600;

/** 更新并持久化规则配置（规则变化后旧结果不可信：清缓存并立即重查） */
function setRuleConfig(next: RuleConfig): void {
  ruleConfig.value = { ...next };
  writeRuleConfig(ruleConfig.value);
  resultCache.clear();
  void runCheck();
}

/** 当前 tab 是否就是结果归属的 tab（修复动作的前置校验） */
function isResultForCurrentTab(): boolean {
  const tabId = useTab().currentTab.value?.id ?? null;
  return resultTabId.value !== null && resultTabId.value === tabId;
}

/**
 * 执行一次检查（读取当前 tab 内容自行发起，带版本化防竞态）
 */
async function runCheck(): Promise<void> {
  const tab = useTab().currentTab.value;
  if (!tab) {
    lintResult.value = EMPTY_RESULT;
    resultTabId.value = null;
    return;
  }

  const generation = ++checkGeneration;
  const tabId = tab.id;
  const content = tab.content ?? "";

  // 内容未变化且已有缓存结果时直接复用（切回 tab / 重复点按钮秒出结果）
  const cached = resultCache.get(tabId);
  if (cached && cached.content === content) {
    if (generation !== checkGeneration) return;
    lintResult.value = cached.result;
    resultTabId.value = tabId;
    isLintRunning.value = false;
    return;
  }

  isLintRunning.value = true;
  try {
    // 检查在 Web Worker 中执行（主线程只收发消息）：拼写开关关闭时跳过拼写阶段
    const nextResult = await runLintOffThread(content, ruleConfig.value, isSpellCheckEnabled.value);
    // 期间 tab 已切换或发起了更新的检查时丢弃本次结果
    if (generation !== checkGeneration) return;
    lintResult.value = nextResult;
    resultTabId.value = tabId;
    cacheResult(tabId, content, nextResult);
  } catch {
    if (generation === checkGeneration) {
      lintResult.value = EMPTY_RESULT;
      resultTabId.value = tabId;
    }
  } finally {
    if (generation === checkGeneration) {
      isLintRunning.value = false;
    }
  }
}

/** 当前 tab 的检查结果（归属不匹配时视为空，避免展示别的文档的问题） */
const currentResult = computed<DocumentLintResult>(() =>
  isResultForCurrentTab() ? lintResult.value : EMPTY_RESULT
);

/** 当前 tab 的问题总数：状态栏徽标常驻展示，不必打开面板即可感知检查结果（归属不符时为 0） */
const totalIssueCount = computed(
  () => currentResult.value.spellIssues.length + currentResult.value.formatIssues.length
);

// 打开/切换文档：立即在后台自动检查（不等面板打开）——检查途中再切文档时，
// worker 客户端会终止旧线程、开新线程处理新文档；结果已缓存的 tab 秒出结果
watch(
  () => useTab().currentTab.value?.id,
  (tabId) => {
    resultTabId.value = null;
    if (tabId) void runCheck();
  },
  { immediate: true }
);

// 拼写开关变化：清缓存并立即重查（拼写阶段跳过/恢复）
watch(isSpellCheckEnabled, () => {
  resultCache.clear();
  void runCheck();
});

/** 打开面板：无结果归属时立刻检查，避免出现空面板让人误解 */
function openLintPanel(): void {
  isLintPanelVisible.value = true;
  if (resultTabId.value === null && useTab().currentTab.value) {
    void runCheck();
  }
}

/** 关闭面板并取消待执行的重查 */
function closeLintPanel(): void {
  isLintPanelVisible.value = false;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

/**
 * 内容变化时的防抖重查（仅面板打开时生效）
 *
 * 由渲染层在编辑器 change 事件里调用；600ms 防抖足以吸收连续击键。
 */
function scheduleAutoCheck(): void {
  if (!isLintPanelVisible.value) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void runCheck();
  }, AUTO_CHECK_DEBOUNCE_MS);
}

/**
 * 修复单条格式问题，返回修复后的文本
 *
 * 结果不属于当前 tab 时直接返回原文（防止把 A 文档的修复写到 B 文档）。
 */
function applyIssueFix(content: string, issue: FormatIssue): string {
  if (!isResultForCurrentTab()) return content;
  return applyAllFixes(content, [issue]);
}

/** 修复全部可自动修复的格式问题，返回修复后的文本（同样带归属校验） */
function applyAllFixableFixes(content: string): string {
  if (!isResultForCurrentTab()) return content;
  return applyAllFixes(content, lintResult.value.formatIssues);
}

export default function useDocumentLint() {
  return {
    // 状态
    ruleConfig,
    lintResult,
    currentResult,
    totalIssueCount,
    isLintRunning,
    isLintPanelVisible,
    resultTabId,
    // 配置
    setRuleConfig,
    // 面板
    openLintPanel,
    closeLintPanel,
    // 检查
    runCheck,
    scheduleAutoCheck,
    isResultForCurrentTab,
    // 修复
    applyIssueFix,
    applyAllFixableFixes,
  };
}
