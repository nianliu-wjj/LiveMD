<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import autotoast from "autotoast.js";
import AppIcon from "@/renderer/components/ui/AppIcon.vue";
import { toggleShowOutline } from "@/renderer/hooks/useOutline";
import useReadOnlyMode from "@/renderer/hooks/useReadOnlyMode";
import useSourceCode from "@/renderer/hooks/useSourceCode";
import useTab from "@/renderer/hooks/useTab";
import { applyPanguSpacing, needsPanguSpacing } from "@/core/utils/pangu";
import useDocumentLint from "@/renderer/hooks/useDocumentLint";
import { openWorkspaceSearch } from "@/renderer/hooks/useWorkspaceSearch";
import {
  countDocumentStats,
  countMarkdownChars,
  countMarkdownLines,
  formatReadingTime,
} from "@/renderer/utils/wordCount";

const props = defineProps<{
  content: string;
  updateStatus?: "idle" | "downloading" | "downloaded" | "error";
  downloadProgress?: number;
  isUpdateDialogVisible?: boolean;
}>();
const emit = defineEmits<{
  (e: "restore-update"): void;
}>();

const { isShowSource, toggleSourceCode } = useSourceCode();

// ============ 只读模式（状态栏右侧锁形按钮）============
const { isReadOnlyMode, toggleReadOnlyMode } = useReadOnlyMode();
const readOnlyTitle = computed(() =>
  isReadOnlyMode.value ? "只读模式已开启（点击恢复编辑）" : "开启只读模式（禁止修改文档内容）"
);

function handleToggleReadOnly(): void {
  toggleReadOnlyMode();
  autotoast.show(isReadOnlyMode.value ? "已开启只读模式" : "已退出只读模式");
}
const mode = ref<"chars" | "words" | "lines">("chars");
const isStatsVisible = ref(false);
const statsWrapperRef = ref<HTMLElement | null>(null);

const modeOptions = [
  { value: "chars", label: "字符数" },
  { value: "words", label: "字数" },
  { value: "lines", label: "行数" },
] as const;

const stats = computed(() => countDocumentStats(props.content ?? ""));

const displayText = computed(() => {
  const text = props.content ?? "";
  switch (mode.value) {
    case "chars":
      return `${countMarkdownChars(text)} 字符`;
    case "words":
      return `${stats.value.words} 字数`;
    case "lines":
      return `${countMarkdownLines(text)} 行`;
    default:
      return "";
  }
});

function handleRestore() {
  emit("restore-update");
}

// ============ 保存状态指示（状态栏最右，未保存时点击即保存）============

const { currentTab, saveCurrentTab, updateCurrentTabContent } = useTab();

/**
 * 盘古之白：在中文与英文/数字的边界补一个空格（围栏代码块与链接目标跳过）
 *
 * 不需要调整时直接提示并返回，避免写入文档、污染撤销栈；
 * 需要调整时写回当前标签页内容并标记为已修改，编辑器经 watch 自动同步新内容。
 */
async function handlePanguSpacing(): Promise<void> {
  const content = props.content ?? "";
  if (!content || !needsPanguSpacing(content)) {
    autotoast.show("排版已规范，无需调整");
    return;
  }

  const spaced = applyPanguSpacing(content);
  updateCurrentTabContent(spaced, true);
  autotoast.show("已完成中英文排版规范化", "success");
}

const {
  runCheck,
  isLintRunning,
  openLintPanel,
  isLintPanelVisible,
  resultTabId,
  closeLintPanel,
  totalIssueCount,
  currentError,
} = useDocumentLint();

/**
 * 文档检查：拼写（nspell）+ 格式（markdownlint）
 *
 * 结果写入 useDocumentLint 的 store，由结果面板渲染；面板已打开时再次点击即重新检查。
 */
async function handleDocumentLint(): Promise<void> {
  if (isLintRunning.value) return;
  const content = props.content ?? "";
  if (!content) {
    autotoast.show("当前文档为空，无需检查");
    return;
  }

  // 先开面板：立即给用户反馈（无结果归属时面板会自动发起检查）
  const panelWillRunCheck = resultTabId.value === null;
  openLintPanel();
  if (panelWillRunCheck) return;

  const result = await runCheck();
  if (!result) {
    // null：检查失败（面板已显示原因）或被更新的检查抢占，都不能提示「未发现问题」
    if (currentError.value) autotoast.show(`检查失败：${currentError.value}`, "error");
    return;
  }
  const total = result.formatIssues.length + result.spellIssues.length;
  autotoast.show(
    total > 0 ? `检查完成，发现 ${total} 处问题` : "检查完成，未发现问题",
    total > 0 ? "info" : "success"
  );
}

/** 面板已打开时按钮显示激活态 */
const lintButtonActive = computed(() => isLintPanelVisible.value);

/** 状态栏常驻徽标：当前文档问题数，不必打开面板即可感知检查结果；超过 99 显示 99+ */
const lintBadgeText = computed(() =>
  totalIssueCount.value > 99 ? "99+" : String(totalIssueCount.value)
);
const lintButtonTitle = computed(() =>
  totalIssueCount.value > 0
    ? `检查文档：发现 ${totalIssueCount.value} 处问题（点击查看）`
    : "检查文档（拼写与格式）"
);

const isModified = computed(() => currentTab.value?.isModified ?? false);
const saveHint = computed(() => (isModified.value ? "未保存，点击保存" : "已保存"));

async function handleSaveClick(): Promise<void> {
  if (!isModified.value) return;
  const saved = await saveCurrentTab();
  if (saved) {
    autotoast.show("保存成功", "success");
  } else {
    autotoast.show("保存失败", "error");
  }
}

function toggleStats() {
  isStatsVisible.value = !isStatsVisible.value;
}

function selectMode(value: "chars" | "words" | "lines") {
  mode.value = value;
  isStatsVisible.value = false;
}

function handleDocumentClick(event: MouseEvent) {
  if (!isStatsVisible.value) return;
  const target = event.target as Node | null;
  if (statsWrapperRef.value && target && !statsWrapperRef.value.contains(target)) {
    isStatsVisible.value = false;
  }
}

onMounted(() => document.addEventListener("click", handleDocumentClick));
onUnmounted(() => document.removeEventListener("click", handleDocumentClick));

window.electronAPI.on("view:toggleView", () => {
  toggleSourceCode();
});
</script>

<template>
  <div class="StatusBarBox">
    <div class="left-section">
      <div>
        <span
          class="status-icon-btn"
          title="在工作区中搜索 (Ctrl+Shift+F)"
          @click.stop="openWorkspaceSearch()"
        >
          <AppIcon name="search" />
        </span>
        <span class="status-icon-btn" @click="toggleShowOutline()">
          <AppIcon name="List-outlined" />
        </span>
        <span class="status-icon-btn" @click.stop="toggleSourceCode()">
          <AppIcon :name="isShowSource ? 'input' : 'markdown'" />
        </span>
      </div>

      <!-- Update Progress (Centered-ish or just after icons) -->
      <div
        v-if="updateStatus === 'downloading' && !isUpdateDialogVisible"
        class="update-progress-bar"
        @click="handleRestore"
        title="点击恢复下载弹窗"
      >
        <AppIcon name="download" class="status-inline-icon" />
        <span>正在下载 {{ downloadProgress }}%</span>
        <div class="mini-progress-bg">
          <div class="mini-progress-fill" :style="{ width: `${downloadProgress}%` }"></div>
        </div>
      </div>
      <div
        v-else-if="updateStatus === 'downloaded' && !isUpdateDialogVisible"
        class="update-progress-bar success"
        @click="handleRestore"
      >
        <AppIcon name="check-circle" class="status-inline-icon" />
        <span>下载完成，点击安装</span>
      </div>
    </div>

    <div class="right-section">
      <!-- 保存状态（状态栏最右）：未保存时高亮、点击即保存 -->
      <span
        class="save-status"
        :class="{ 'save-status--modified': isModified }"
        :title="saveHint"
        @click.stop="handleSaveClick"
      >
        <span class="save-status__dot" />
        {{ isModified ? "未保存" : "已保存" }}
      </span>
      <div ref="statsWrapperRef" class="stats-wrapper">
        <span class="statusBarText" title="点击查看文档统计" @click.stop="toggleStats">
          {{ displayText }}
        </span>
        <Transition name="stats-fade">
          <div v-if="isStatsVisible" class="stats-popup" @click.stop>
            <div class="stats-title">文档统计</div>
            <div class="stats-row">
              <div class="stats-label">字数</div>
              <div class="stats-value">{{ stats.words }}</div>
            </div>
            <div class="stats-row">
              <div class="stats-label">字符数（含空格）</div>
              <div class="stats-value">{{ stats.characters }}</div>
            </div>
            <div class="stats-row">
              <div class="stats-label">字符数（不含空格）</div>
              <div class="stats-value">{{ stats.charactersWithoutSpaces }}</div>
            </div>
            <div class="stats-row">
              <div class="stats-label">段落数</div>
              <div class="stats-value">{{ stats.paragraphs }}</div>
            </div>
            <div class="stats-row">
              <div class="stats-label">行数</div>
              <div class="stats-value">{{ stats.lines }}</div>
            </div>
            <div class="stats-row">
              <div class="stats-label">阅读时间</div>
              <div class="stats-value">{{ formatReadingTime(stats.readingSeconds) }}</div>
            </div>
            <div class="stats-divider"></div>
            <div class="stats-modes">
              <div class="stats-modes-label">状态栏显示</div>
              <div class="stats-mode-options">
                <button
                  v-for="opt in modeOptions"
                  :key="opt.value"
                  type="button"
                  class="stats-mode-btn"
                  :class="{ active: mode === opt.value }"
                  @click="selectMode(opt.value)"
                >
                  {{ opt.label }}
                </button>
              </div>
            </div>
          </div>
        </Transition>
      </div>
      <span
        class="status-icon-btn"
        title="排版规范化（中英文之间插入空格）"
        @click.stop="handlePanguSpacing()"
      >
        <AppIcon name="pangu" />
      </span>
      <span
        class="status-icon-btn lint-btn"
        :class="{
          'lint-active': lintButtonActive,
          'lint-running': isLintRunning,
          'lint-has-issues': totalIssueCount > 0,
        }"
        :title="lintButtonTitle"
        @click.stop="handleDocumentLint()"
      >
        <AppIcon name="check-circle" />
        <span v-if="totalIssueCount > 0" class="lint-badge">{{ lintBadgeText }}</span>
      </span>
      <!-- 只读模式：开启后编辑器、右键菜单与改写类操作全部禁止修改文档 -->
      <span
        class="status-icon-btn readonly-btn"
        :class="{ 'readonly-active': isReadOnlyMode }"
        :title="readOnlyTitle"
        @click.stop="handleToggleReadOnly()"
      >
        <AppIcon :name="isReadOnlyMode ? 'lock' : 'lock-open'" />
      </span>
    </div>
  </div>
</template>

<style lang="less" scoped>
.StatusBarBox {
  user-select: none;
  cursor: pointer;
  font-size: 14px;
  color: var(--text-color-1);
  text-align: right;
  background: var(--background-color-2);
  display: flex;
  justify-content: space-between;
  align-items: center;
  // 固定高度：右缘三栏以 --statusbar-height 为底部基准（与 style.less 的变量保持一致）
  height: var(--statusbar-height, 28px);
  flex-shrink: 0;

  .left-section {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  span {
    padding: 2px 8px;
    display: inline-block;

    &:hover {
      background: var(--hover-color);
    }
  }

  // 圆点指示符不参与全局 span 的 padding/hover（否则被拉成椭圆，第 9 节踩坑）
  span.save-status__dot {
    padding: 0;

    &:hover {
      background: none;
    }
  }
}

.save-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text-color-3);
  cursor: default;
  border-radius: 4px;
  flex-shrink: 0;

  &__dot {
    width: 6px;
    height: 6px;
    padding: 0; // 双保险（全局 span padding 会被拉成椭圆）
    border-radius: 50%;
    background: var(--success-color, #4caf7d); // 已保存 = 绿色
    flex-shrink: 0;
  }

  &--modified {
    color: var(--warn-color, #d9852d); // 未保存 = 橙黄
    cursor: pointer;

    .save-status__dot {
      background: var(--warn-color, #d9852d);
    }

    &:hover {
      background: var(--hover-color);
    }
  }
}

.right-section {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 只读模式开启：锁形按钮以主色高亮，提示当前不可编辑 */
.status-icon-btn.readonly-active {
  color: var(--primary-color);
}

/* 检查进行中：按钮缓慢旋转，提示「正在检查」 */
.status-icon-btn.lint-running svg {
  animation: lint-spin 0.9s linear infinite;
}

@keyframes lint-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

/* 问题计数徽标：贴在检查按钮右上角，橙色只读色提示「有问题」（与未保存指示同色系） */
.status-icon-btn.lint-btn {
  position: relative;
}

.lint-badge {
  position: absolute;
  top: -4px;
  right: -6px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 7px;
  font-size: 9px;
  line-height: 14px;
  text-align: center;
  color: #fff;
  background: var(--warn-color, #d9852d);
  pointer-events: none;
}

.statusBarText {
  font-size: 12px;
  margin: 2px 0;
  color: var(--text-color-3);
}

.update-progress-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-color-2);
  padding: 2px 8px;
  border-radius: 4px;
  transition: background 0.2s;

  &:hover {
    background: var(--hover-color);
  }

  &.success {
    color: var(--primary-color);
  }

  .mini-progress-bg {
    width: 60px;
    height: 4px;
    background: var(--border-color-1);
    border-radius: 2px;
    overflow: hidden;
  }

  .mini-progress-fill {
    height: 100%;
    background: var(--primary-color);
    transition: width 0.3s;
  }
}

.stats-wrapper {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.stats-popup {
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  width: 248px;
  padding: 10px 12px;
  border: 1px solid var(--border-color-1);
  border-radius: 8px;
  background: var(--background-color-1);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
  text-align: left;
  cursor: default;
  z-index: 50;
}

.stats-title {
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-color-2);
}

.stats-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  line-height: 22px;
  color: var(--text-color-3);
}

.stats-value {
  color: var(--text-color-1);
  font-variant-numeric: tabular-nums;
}

.stats-divider {
  height: 1px;
  margin: 8px 0;
  background: var(--border-color-1);
}

.stats-modes-label {
  margin-bottom: 6px;
  font-size: 11px;
  color: var(--text-color-3);
}

.stats-mode-options {
  display: flex;
  gap: 6px;
}

.stats-mode-btn {
  flex: 1;
  padding: 3px 0;
  border: 1px solid var(--border-color-1);
  border-radius: 5px;
  background: transparent;
  color: var(--text-color-2);
  font-size: 12px;
  cursor: pointer;

  &:hover {
    background: var(--hover-color);
  }

  &.active {
    color: var(--primary-color);
    border-color: var(--primary-color);
    background: color-mix(in srgb, var(--primary-color) 10%, transparent);
  }
}

.stats-fade-enter-active,
.stats-fade-leave-active {
  transition:
    opacity 0.12s ease,
    transform 0.12s ease;
}

.stats-fade-enter-from,
.stats-fade-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>
