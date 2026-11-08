<script setup lang="ts">
/**
 * 文档检查结果面板
 *
 * 结构对齐 docs/2026-10-29-md-editor-fix-guide-from-livemd.md 修复 3 的 LiveMD 参考实现：
 * - 拼写与格式结果**合并为同一列表**并按行号排序（比双表格更省 DOM）；
 * - 渲染截断：最多渲染前 500 条，超出部分在底部提示总数（数组保持完整，定位/修复不受影响）；
 * - 操作列：定位（emit reveal）、修复（仅格式问题且可修复时显示，emit fix）。
 *
 * 纯展示组件：不读写文档，修复与持久化由 useDocumentLint / 编辑器承担。
 */
import { computed, ref } from "vue";
import AppIcon from "@/renderer/components/ui/AppIcon.vue";
import type { DocumentLintResult, FormatIssue, SpellIssue } from "@/renderer/utils/documentLint";

const props = defineProps<{
  result: DocumentLintResult;
  /** 正在检查中（禁用操作并提示） */
  isRunning?: boolean;
  /** 检查失败原因：非空时展示「检查失败」，不能显示成「没有发现问题」 */
  error?: string | null;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "reveal", line: number): void;
  (e: "fix", issue: FormatIssue): void;
  (e: "fix-all"): void;
}>();

/** 合并列表的一行：拼写与格式统一成同一视图模型，便于按行号混排 */
interface LintRow {
  key: string;
  kind: "spell" | "format";
  line: number;
  code: string;
  description: string;
  fixable: boolean;
  formatIndex: number;
}

const activeTab = ref<"all" | "format" | "spell">("all");

const formatIssues = computed(() => props.result.formatIssues);
const spellIssues = computed(() => props.result.spellIssues);

const rows = computed<LintRow[]>(() => {
  const spellRows: LintRow[] = spellIssues.value.map((issue: SpellIssue, index: number) => ({
    key: `spell:${issue.line}:${issue.column}:${issue.word}`,
    kind: "spell",
    line: issue.line,
    code: "SPELL",
    description: `拼写疑问「${issue.word}」${
      issue.suggestions.length > 0 ? `，建议：${issue.suggestions.join(" / ")}` : ""
    }`,
    fixable: false,
    formatIndex: index,
  }));
  const formatRows: LintRow[] = formatIssues.value.map((issue: FormatIssue, index: number) => ({
    key: `format:${issue.line}:${issue.ruleCode}:${index}`,
    kind: "format",
    line: issue.line,
    code: issue.ruleCode,
    description: issue.detail ? `${issue.description}（${issue.detail}）` : issue.description,
    fixable: issue.fixInfo !== null,
    formatIndex: index,
  }));
  return [...spellRows, ...formatRows].sort((left, right) => left.line - right.line);
});

/** 页签过滤后的行（默认「全部」按行号混排） */
const filteredRows = computed<LintRow[]>(() => {
  if (activeTab.value === "all") return rows.value;
  return rows.value.filter((row) => row.kind === activeTab.value);
});

/** 面板最多渲染的条目数：超出部分只提示总数，避免万级 DOM 一次创建 */
const MAX_RENDER_ROWS = 500;
const visibleRows = computed<LintRow[]>(() => filteredRows.value.slice(0, MAX_RENDER_ROWS));
const overflowCount = computed(() => Math.max(0, filteredRows.value.length - MAX_RENDER_ROWS));

const fixableCount = computed(() => formatIssues.value.filter((i) => i.fixInfo !== null).length);
const totalCount = computed(() => rows.value.length);

/** 点击「修复」：把格式问题交回上层（拼写问题不提供自动修复） */
function handleFix(row: LintRow): void {
  const issue = formatIssues.value[row.formatIndex];
  if (!issue || issue.fixInfo === null) return;
  emit("fix", issue);
}
</script>

<template>
  <div class="lint-panel">
    <div class="lint-panel__header">
      <div class="lint-panel__tabs">
        <button
          type="button"
          class="lint-tab"
          :class="{ active: activeTab === 'all' }"
          @click="activeTab = 'all'"
        >
          全部 {{ totalCount }}
        </button>
        <button
          type="button"
          class="lint-tab"
          :class="{ active: activeTab === 'format' }"
          @click="activeTab = 'format'"
        >
          格式 {{ formatIssues.length }}
        </button>
        <button
          type="button"
          class="lint-tab"
          :class="{ active: activeTab === 'spell' }"
          @click="activeTab = 'spell'"
        >
          拼写 {{ spellIssues.length }}
        </button>
      </div>

      <div class="lint-panel__actions">
        <button
          type="button"
          class="lint-action"
          :disabled="fixableCount === 0 || isRunning"
          :title="`修复全部可自动修复项（${fixableCount} 项）`"
          @click="emit('fix-all')"
        >
          全部修复
        </button>
        <button type="button" class="lint-action" title="关闭面板" @click="emit('close')">
          <AppIcon name="close" />
        </button>
      </div>
    </div>

    <div class="lint-panel__body">
      <div v-if="isRunning" class="lint-panel__hint">正在检查…</div>
      <div v-if="error && !isRunning" class="lint-panel__error">检查失败：{{ error }}</div>
      <div v-for="notice in result.notices ?? []" :key="notice" class="lint-panel__notice">
        {{ notice }}
      </div>

      <template v-if="visibleRows.length > 0">
        <div v-for="row in visibleRows" :key="row.key" class="lint-row">
          <span class="lint-row__line">{{ row.line }}</span>
          <span class="lint-row__code" :class="`lint-row__code--${row.kind}`">{{ row.code }}</span>
          <span class="lint-row__desc">{{ row.description }}</span>
          <span class="lint-row__actions">
            <button
              type="button"
              class="lint-icon-btn"
              title="定位到该行"
              @click="emit('reveal', row.line)"
            >
              <AppIcon name="locate" />
            </button>
            <button
              v-if="row.fixable"
              type="button"
              class="lint-icon-btn"
              title="修复该项"
              @click="handleFix(row)"
            >
              <AppIcon name="magic-wand" />
            </button>
          </span>
        </div>

        <div v-if="overflowCount > 0" class="lint-panel__overflow">
          还有 {{ overflowCount }} 条未展示，请修复已有问题或缩小文档范围
        </div>
      </template>

      <p v-else-if="!isRunning && !error" class="lint-empty">没有发现问题</p>
    </div>

    <div class="lint-panel__footer">共 {{ totalCount }} 项 · 可自动修复 {{ fixableCount }} 项</div>
  </div>
</template>

<style lang="less" scoped>
.lint-panel__error,
.lint-panel__notice {
  margin: 8px 12px;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.5;
  word-break: break-word;
}

.lint-panel__error {
  color: #c53030;
  background: rgba(229, 62, 62, 0.1);
}

.lint-panel__notice {
  color: var(--text-color-2, #666);
  background: var(--hover-background-color, rgba(0, 0, 0, 0.05));
}

.lint-panel {
  display: flex;
  flex-direction: column;
  max-height: 320px;
  border: var(--sketch-stroke, 1px) solid var(--border-color-1);
  border-radius: var(--sketch-radius-wobble-sm, 8px);
  background: var(--background-color-1);
  box-shadow: var(--sketch-shadow, 0 4px 12px rgba(0, 0, 0, 0.12));
  overflow: hidden;
}

.lint-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  border-bottom: 1px dashed var(--border-color-1);
}

.lint-panel__tabs {
  display: flex;
  gap: 6px;
}

.lint-tab {
  padding: 3px 10px;
  border: none;
  border-radius: var(--sketch-radius-xs, 4px);
  background: transparent;
  color: var(--text-color-2);
  font-size: 12px;
  cursor: pointer;

  &:hover {
    background: var(--hover-color);
  }

  &.active {
    background: color-mix(in srgb, var(--primary-color) 14%, transparent);
    color: var(--primary-color);
  }
}

.lint-panel__actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.lint-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border: 1px solid var(--border-color-1);
  border-radius: var(--sketch-radius-xs, 4px);
  background: var(--background-color-1);
  color: var(--text-color-2);
  font-size: 12px;
  cursor: pointer;

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }

  &:hover:not(:disabled) {
    color: var(--primary-color);
    border-color: var(--primary-color);
  }
}

.lint-panel__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 6px;
}

.lint-panel__hint {
  padding: 4px 6px;
  color: var(--text-color-3);
  font-size: 11px;
}

.lint-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 5px 6px;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color-1) 55%, transparent);
  font-size: 12px;
}

.lint-row__line {
  flex-shrink: 0;
  width: 36px;
  color: var(--text-color-2);
  font-variant-numeric: tabular-nums;
}

.lint-row__code {
  flex-shrink: 0;
  min-width: 52px;
  color: var(--text-color-3);

  &--format {
    color: var(--primary-color);
  }
}

.lint-row__desc {
  flex: 1;
  min-width: 0;
  color: var(--text-color-1);
  word-break: break-word;
}

.lint-row__actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.lint-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 20px;
  border: none;
  border-radius: var(--sketch-radius-xs, 4px);
  background: transparent;
  color: var(--text-color-2);
  cursor: pointer;

  &:hover {
    background: var(--hover-color);
    color: var(--primary-color);
  }
}

.lint-empty {
  margin: 12px 4px;
  color: var(--text-color-3);
  font-size: 12px;
}

.lint-panel__overflow {
  flex-shrink: 0;
  padding: 8px 12px;
  border-top: 1px solid var(--border-color-1);
  font-size: 11px;
  color: var(--text-color-3);
  user-select: none;
}

.lint-panel__footer {
  padding: 6px 10px;
  border-top: 1px dashed var(--border-color-1);
  color: var(--text-color-3);
  font-size: 11px;
}
</style>
