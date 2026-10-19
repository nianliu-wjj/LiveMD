<script setup lang="ts">
/**
 * 检查规则开关列表（markdownlint 规则）
 *
 * - 逐条规则一个开关，编码可点开官方文档；
 * - 通过 v-model:config 暴露规则启用表（上层持久化到 localStorage）；
 * - 提供「全部启用 / 全部关闭」快捷操作。
 */
import AppIcon from "@/renderer/components/ui/AppIcon.vue";
import { MARKDOWNLINT_DOC_URL_BASE, MARKDOWNLINT_RULES } from "@/renderer/utils/markdownLintRules";
import type { RuleConfig } from "@/renderer/utils/documentLint";

const props = defineProps<{
  config: RuleConfig;
}>();

const emit = defineEmits<{
  (e: "update:config", config: RuleConfig): void;
}>();

/** 单条规则是否启用（未显式配置时默认启用） */
function isEnabled(code: string): boolean {
  return props.config[code] !== false;
}

function toggle(code: string): void {
  const next: RuleConfig = { ...props.config, [code]: !isEnabled(code) };
  emit("update:config", next);
}

function setAll(enabled: boolean): void {
  const next: RuleConfig = {};
  for (const rule of MARKDOWNLINT_RULES) {
    next[rule.code] = enabled;
  }
  emit("update:config", next);
}
</script>

<template>
  <div class="lint-rule-settings">
    <div class="lint-rule-settings__actions">
      <button type="button" class="rule-action" @click="setAll(true)">全部启用</button>
      <button type="button" class="rule-action" @click="setAll(false)">全部关闭</button>
    </div>

    <ul class="lint-rule-list">
      <li v-for="rule in MARKDOWNLINT_RULES" :key="rule.code" class="lint-rule-item">
        <label class="lint-rule-item__main">
          <input
            type="checkbox"
            class="lint-rule-checkbox"
            :checked="isEnabled(rule.code)"
            @change="toggle(rule.code)"
          />
          <span class="lint-rule-code">{{ rule.code }}</span>
          <span class="lint-rule-desc">{{ rule.description }}</span>
          <a
            class="lint-rule-link"
            :href="`${MARKDOWNLINT_DOC_URL_BASE}/${rule.alias}.md`"
            target="_blank"
            rel="noreferrer"
            :title="`查看 ${rule.alias} 规则文档`"
            @click.stop
          >
            <AppIcon name="link" />
          </a>
        </label>
      </li>
    </ul>
  </div>
</template>

<style lang="less" scoped>
.lint-rule-settings {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 320px;
  overflow-y: auto;
}

.lint-rule-settings__actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.rule-action {
  padding: 3px 10px;
  border: 1px solid var(--border-color-1);
  border-radius: var(--sketch-radius-xs, 4px);
  background: var(--background-color-1);
  color: var(--text-color-2);
  font-size: 12px;
  cursor: pointer;

  &:hover {
    color: var(--primary-color);
    border-color: var(--primary-color);
  }
}

.lint-rule-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.lint-rule-item__main {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 2px;
  cursor: pointer;

  &:hover {
    background: var(--hover-background-color);
  }
}

.lint-rule-checkbox {
  flex-shrink: 0;
}

.lint-rule-code {
  flex-shrink: 0;
  width: 52px;
  color: var(--text-color-2);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.lint-rule-desc {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-color-1);
  font-size: 12px;
}

.lint-rule-link {
  flex-shrink: 0;
  color: var(--text-color-3);

  &:hover {
    color: var(--primary-color);
  }
}
</style>
