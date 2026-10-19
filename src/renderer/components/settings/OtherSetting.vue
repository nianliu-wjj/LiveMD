<script setup lang="ts">
import { computed, ref } from "vue";
import AppIcon from "@/renderer/components/ui/AppIcon.vue";
import { Input } from "@/renderer/components/ui/input";
import useOtherConfig from "@/renderer/hooks/useOtherConfig";
import { useConfig } from "@/renderer/hooks/useConfig";

const { currentEditorPadding, setEditorPadding } = useOtherConfig();
const { config, setConf } = useConfig();

const paddingSettingsExpanded = ref(false);
const mermaidSettingsExpanded = ref(false);
const viewSettingsExpanded = ref(false);

const focusMode = computed(() => Boolean(config.value.view?.focusMode));
const typewriterMode = computed(() => Boolean(config.value.view?.typewriterMode));

function toggleViewSettings() {
  viewSettingsExpanded.value = !viewSettingsExpanded.value;
}

function setViewMode(key: "focusMode" | "typewriterMode", value: boolean) {
  setConf("view", { ...config.value.view, [key]: value });
}

// 从完整值中提取数字部分用于显示（如 "20px" -> "20"）
const displayPaddingValue = computed(() => {
  const value = currentEditorPadding.value || "";
  // 提取数字部分（包括小数点）
  const match = value.match(/^(\d+\.?\d*)/);
  return match ? match[1] : "";
});

function togglePaddingSettings() {
  paddingSettingsExpanded.value = !paddingSettingsExpanded.value;
}

function handlePaddingChange(value: string) {
  // 如果提取到数字，自动添加 "px" 单位

  setEditorPadding(`${value}px`);
}

function toggleMermaidSettings() {
  mermaidSettingsExpanded.value = !mermaidSettingsExpanded.value;
}

const mermaidModeOptions = [
  { value: "code", label: "代码" },
  { value: "mixed", label: "混合" },
  { value: "diagram", label: "图表" },
];

function setMermaidMode(mode: string) {
  config.value = {
    ...config.value,
    mermaid: { ...config.value.mermaid, defaultDisplayMode: mode as "code" | "mixed" | "diagram" },
  };
}
</script>

<template>
  <div class="other-setting-page">
    <!-- 边距设置折叠抽屉 -->
    <div class="collapsible-section">
      <div class="section-header" @click="togglePaddingSettings">
        <div class="section-content-wrapper">
          <h2 class="section-title">
            <span class="title-icon">
              <AppIcon name="waiguan" />
            </span>
            <span class="title-text">编辑器其他外观设置</span>
          </h2>
          <p class="section-desc">配置编辑器其他外观设置</p>
        </div>
        <AppIcon
          name="arrow-right"
          class="section-arrow"
          :class="{ active: paddingSettingsExpanded }"
        />
      </div>
      <div class="section-content" :class="{ expanded: paddingSettingsExpanded }">
        <div class="setting-list">
          <div class="setting-item">
            <label class="setting-label">左右边距(PX)</label>
            <div class="setting-input-wrapper">
              <Input
                type="number"
                :model-value="displayPaddingValue"
                placeholder="请输入数字"
                @update:model-value="handlePaddingChange"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Mermaid 设置折叠抽屉 -->
    <div class="collapsible-section">
      <div class="section-header" @click="toggleMermaidSettings">
        <div class="section-content-wrapper">
          <h2 class="section-title">
            <span class="title-icon accent">
              <AppIcon name="magic-wand" />
            </span>
            <span class="title-text">Mermaid 图表设置</span>
          </h2>
          <p class="section-desc">配置 Mermaid 代码块的默认显示模式</p>
        </div>
        <AppIcon
          name="arrow-right"
          class="section-arrow"
          :class="{ active: mermaidSettingsExpanded }"
        />
      </div>
      <div class="section-content" :class="{ expanded: mermaidSettingsExpanded }">
        <div class="setting-list">
          <div class="setting-item">
            <label class="setting-label">默认显示模式</label>
            <div class="setting-input-wrapper mode-select">
              <span
                v-for="opt in mermaidModeOptions"
                :key="opt.value"
                class="mode-option"
                :class="{ active: config.mermaid?.defaultDisplayMode === opt.value }"
                @click="setMermaidMode(opt.value)"
              >
                {{ opt.label }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 写作模式设置折叠抽屉 -->
    <div class="collapsible-section">
      <div class="section-header" @click="toggleViewSettings">
        <div class="section-content-wrapper">
          <h2 class="section-title">
            <span class="title-icon">
              <AppIcon name="edit" />
            </span>
            <span class="title-text">写作模式</span>
          </h2>
          <p class="section-desc">专注模式与打字机模式，对应 Typora 的视图选项</p>
        </div>
        <AppIcon
          name="arrow-right"
          class="section-arrow"
          :class="{ active: viewSettingsExpanded }"
        />
      </div>
      <div class="section-content" :class="{ expanded: viewSettingsExpanded }">
        <div class="setting-list">
          <div class="setting-item">
            <label class="setting-label">专注模式</label>
            <div class="setting-input-wrapper toggle">
              <button
                type="button"
                class="switch"
                :class="{ on: focusMode }"
                :aria-pressed="focusMode"
                @click="setViewMode('focusMode', !focusMode)"
              >
                <span class="switch-knob" />
              </button>
            </div>
          </div>
          <div class="setting-item">
            <label class="setting-label">打字机模式</label>
            <div class="setting-input-wrapper toggle">
              <button
                type="button"
                class="switch"
                :class="{ on: typewriterMode }"
                :aria-pressed="typewriterMode"
                @click="setViewMode('typewriterMode', !typewriterMode)"
              >
                <span class="switch-knob" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.other-setting-page {
  display: flex;
  flex-direction: column;
  gap: 16px;

  // 折叠抽屉样式
  .collapsible-section {
    background: var(--background-color-2);
    border: 1px solid var(--border-color-1);
    border-radius: 8px;
    transition: all 0.2s ease;

    &:hover {
      border-color: var(--border-color-2);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    .section-header {
      padding: 16px 20px;
      cursor: pointer;
      transition: all 0.2s ease;
      border-bottom: 1px solid var(--border-color-1);
      display: flex;
      align-items: center;
      justify-content: space-between;

      &:hover {
        background: var(--background-color-3);
      }

      .section-content-wrapper {
        flex: 1;
      }

      .section-title {
        font-size: 16px;
        font-weight: 600;
        color: var(--text-color);
        margin: 0 0 4px 0;
        line-height: 1.4;
        display: flex;
        align-items: center;
        gap: 10px;

        .title-text {
          display: block;
        }

        .title-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 30px;
          border-radius: 10px;
          background: color-mix(in srgb, var(--primary-color) 14%, transparent);
          color: var(--primary-color);

          &.accent {
            background: color-mix(in srgb, #14b8a6 14%, transparent);
            color: #14b8a6;
          }
        }
      }

      .section-desc {
        font-size: 12px;
        color: var(--text-color-2);
        margin: 0;
        line-height: 1.4;
      }

      .section-arrow {
        font-size: 20px;
        color: var(--text-color-2);
        transition: transform 0.2s ease;
        margin-left: 12px;
        flex-shrink: 0;

        &.active {
          transform: rotate(90deg);
        }
      }
    }

    .section-content {
      max-height: 0;
      overflow: hidden;
      transition:
        max-height 0.3s ease,
        opacity 0.3s ease;
      opacity: 0;

      &.expanded {
        max-height: 1500px;
        opacity: 1;
      }
    }
  }

  // 设置列表样式
  .setting-list {
    padding: 20px;

    .setting-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 0;
      border-bottom: 1px solid var(--border-color-1);

      &:last-child {
        border-bottom: none;
      }

      .setting-label {
        min-width: 120px;
        font-size: 14px;
        font-weight: 500;
        color: var(--text-color-3);
        margin: 0;
        padding-right: 16px;
        flex-shrink: 0;
      }

      .setting-input-wrapper {
        flex: 1;
        min-width: 0;

        :deep(.input-container) {
          .label {
            display: none;
          }
        }

        &.mode-select {
          display: flex;
          gap: 8px;

          .mode-option {
            padding: 6px 16px;
            border-radius: 6px;
            font-size: 13px;
            cursor: pointer;
            border: 1px solid var(--border-color-1);
            color: var(--text-color-3);
            transition: all 0.2s ease;

            &:hover {
              border-color: var(--border-color-2);
              background: var(--background-color-3);
            }

            &.active {
              background: var(--primary-color, #4a9eff);
              color: #fff;
              border-color: var(--primary-color, #4a9eff);
            }
          }
        }

        &.toggle {
          display: flex;
          justify-content: flex-end;

          .switch {
            position: relative;
            width: 40px;
            height: 22px;
            padding: 0;
            border: 1px solid var(--border-color-1);
            border-radius: 11px;
            background: var(--background-color-3);
            cursor: pointer;
            transition:
              background 0.2s ease,
              border-color 0.2s ease;

            .switch-knob {
              position: absolute;
              top: 2px;
              left: 2px;
              width: 16px;
              height: 16px;
              border-radius: 50%;
              background: #fff;
              box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
              transition: left 0.2s ease;
            }

            &.on {
              background: var(--primary-color, #4a9eff);
              border-color: var(--primary-color, #4a9eff);

              .switch-knob {
                left: 20px;
              }
            }
          }
        }
      }
    }
  }
}

// 响应式设计
@media (max-width: 768px) {
  .other-setting-page {
    gap: 12px;

    .collapsible-section {
      .section-header {
        padding: 12px 16px;

        .section-title {
          font-size: 14px;
        }

        .section-desc {
          font-size: 11px;
        }
      }
    }

    .setting-list {
      padding: 16px;

      .setting-item {
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;

        .setting-label {
          min-width: auto;
          padding-right: 0;
        }

        .setting-input-wrapper {
          width: 100%;
        }
      }
    }
  }
}
</style>
