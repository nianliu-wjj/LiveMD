<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import AppIcon from "@/renderer/components/ui/AppIcon.vue";
import useTheme from "@/renderer/hooks/useTheme";
import useUiLoading from "@/renderer/hooks/useUiLoading";
import type { Theme, ThemeName } from "@/types/theme";

const { themes, currentTheme, getThemes, setTheme, addTempTheme, removeTheme, exportTheme } =
  useTheme();
const { runWithLoading, nextFrame } = useUiLoading();

onMounted(() => {
  if (!themes.value.length) {
    themes.value = getThemes();
  }
});

/** 下拉列表展开状态（点击触发器切换，选中或点击外部收起） */
const isDropdownOpen = ref(false);

/** 当前主题对应的完整条目（用于取色圆点、标签与自定义主题判定） */
const currentThemeOption = computed(() =>
  themes.value.find((theme) => theme.name === currentTheme.value)
);

/**
 * 主题取色圆点：主底色 / 次级底色斜向各半
 * 等价于原圆形色块传达的「底色 + 次级底色」信息，但尺寸更小、适应下拉列表
 */
function swatchStyle(option?: Theme) {
  const properties = option?.data?.themeProperties ?? {};
  const mainColor = properties["--background-color"] ?? "transparent";
  const secondColor = properties["--background-color-2"] ?? mainColor;
  return { background: `linear-gradient(135deg, ${mainColor} 0 50%, ${secondColor} 50% 100%)` };
}

/** 下拉选中：先收起列表再切换主题（切换过程有全局 loading） */
async function selectTheme(themeName: ThemeName) {
  isDropdownOpen.value = false;
  await handleThemeSelect(themeName);
}

async function handleThemeSelect(themeName: ThemeName) {
  if (themeName === currentTheme.value) return;

  await runWithLoading(
    async () => {
      await nextFrame();
      await setTheme(themeName);
      await nextFrame();
    },
    "正在切换主题...",
    220
  );
}
</script>

<template>
  <div class="ThemePageBox">
    <div class="theme-select-area">
      <span class="theme-select-label">主题</span>

      <div class="theme-select-control">
        <button
          type="button"
          class="theme-select-trigger"
          aria-haspopup="listbox"
          :aria-expanded="isDropdownOpen"
          @click.stop="isDropdownOpen = !isDropdownOpen"
          @keydown.esc="isDropdownOpen = false"
        >
          <span class="theme-swatch" :style="swatchStyle(currentThemeOption)"></span>
          <span class="theme-select-value">{{ currentThemeOption?.label ?? currentTheme }}</span>
          <AppIcon
            name="chevron-down"
            class="theme-select-arrow"
            :class="{ open: isDropdownOpen }"
          />
        </button>

        <!-- 点击外部收起 -->
        <div
          v-if="isDropdownOpen"
          class="theme-select-backdrop"
          @click.stop="isDropdownOpen = false"
        />

        <div v-if="isDropdownOpen" class="theme-select-menu" role="listbox">
          <button
            v-for="option in themes"
            :key="option.name"
            type="button"
            role="option"
            class="theme-option"
            :class="{ active: option.name === currentTheme }"
            :aria-selected="option.name === currentTheme"
            :title="option.description"
            @click.stop="selectTheme(option.name)"
          >
            <span class="theme-swatch" :style="swatchStyle(option)"></span>
            <span class="theme-option-label">{{ option.label }}</span>
            <span v-if="option.isCustom" class="theme-option-tag">自定义</span>
            <AppIcon
              v-if="option.name === currentTheme"
              name="circle-check"
              class="theme-option-check"
            />
          </button>
        </div>
      </div>

      <!-- 选中的是自定义主题时：编辑 / 下载 / 删除 -->
      <div v-if="currentThemeOption?.isCustom" class="theme-selected-actions">
        <AppIcon
          name="edit"
          class="theme-action-icon edit-icon"
          title="编辑主题"
          @click.stop="addTempTheme(currentTheme)"
        />
        <AppIcon
          name="download"
          class="theme-action-icon download-icon"
          title="下载主题"
          @click.stop="exportTheme(currentTheme)"
        />
        <AppIcon
          name="close"
          class="theme-action-icon delete-icon"
          title="删除主题"
          @click.stop="removeTheme(currentTheme)"
        />
      </div>

      <button
        type="button"
        class="theme-select-add"
        title="新建自定义主题"
        @click.stop="addTempTheme()"
      >
        <AppIcon name="plus" />
        <span>新建</span>
      </button>
    </div>

    <div class="theme-preview-frame">
      <div class="theme-preview-page">
        <div class="theme-preview-container">
          <div class="theme-preview-tabbar">
            <div class="theme-preview-tabbar-item active">
              <p>readme.md</p>
              <div class="closeIcon">
                <AppIcon name="close" />
              </div>
              <!-- pre -->
              <svg
                class="pre active"
                viewBox="0 0 5 5"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M5 5L0 5C3.33333 5 5 3.33333 5 -2.18557e-07L5 5Z" />
              </svg>
              <!-- after -->
              <svg
                class="after active"
                viewBox="0 0 5 5"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M0 5L5 5C1.66667 5 7.28523e-08 3.33333 2.18557e-07 -2.18557e-07L0 5Z" />
              </svg>
            </div>

            <div class="addTab">
              <div class="addTabLine"></div>
              <AppIcon name="plus" />
            </div>
          </div>
          <div class="theme-preview-content">
            <div class="preview-header"></div>
            <div class="preview-lines">
              <div class="preview-line"></div>
              <div class="preview-line"></div>
              <div class="preview-line"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.ThemePageBox {
  width: 100%;
  height: 100%;
  padding: 0px;

  .theme-select-area {
    position: relative;
    width: 100%;
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 12px;
    box-sizing: border-box;

    .theme-select-label {
      min-width: 100px;
      font-size: 14px;
      color: var(--text-color-1);
      flex-shrink: 0;
    }

    .theme-select-control {
      position: relative;
      flex: 1;
      min-width: 0;
    }

    .theme-select-trigger {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      height: 40px;
      padding: 0 12px;
      cursor: pointer;
      border: 1px solid var(--border-color-1);
      border-radius: var(--sketch-radius-sm, 4px);
      background: var(--background-color-1);
      color: var(--text-color-1);
      transition:
        border-color 0.2s ease,
        background-color 0.2s ease;

      &:hover {
        border-color: var(--border-color-2);
      }

      &:focus-visible {
        outline: var(--sketch-stroke, 2px) solid var(--primary-color);
        outline-offset: 1px;
      }

      .theme-select-value {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        text-align: left;
      }

      .theme-select-arrow {
        flex-shrink: 0;
        font-size: 14px;
        color: var(--text-color-3);
        transition: transform 0.2s ease;

        &.open {
          transform: rotate(180deg);
        }
      }
    }

    .theme-swatch {
      flex-shrink: 0;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      border: 1px solid var(--border-color-1);
    }

    .theme-select-backdrop {
      position: fixed;
      inset: 0;
      z-index: 20;
    }

    .theme-select-menu {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      right: 0;
      z-index: 21;
      max-height: 280px;
      overflow-y: auto;
      padding: 6px;
      border: var(--sketch-stroke, 1px) solid var(--border-color-1);
      border-radius: var(--sketch-radius-wobble-sm, 6px);
      background: var(--background-color-1);
      box-shadow:
        var(--sketch-shadow, 0 4px 12px rgba(0, 0, 0, 0.15)),
        0 12px 28px -18px rgba(0, 0, 0, 0.45);

      .theme-option {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        padding: 8px 10px;
        border: none;
        border-radius: var(--sketch-radius-xs, 4px);
        background: transparent;
        color: var(--text-color-1);
        font-size: 13px;
        text-align: left;
        cursor: pointer;
        transition: background-color 0.12s ease;

        &:hover {
          background: var(--hover-color);
        }

        &.active {
          background: color-mix(in srgb, var(--primary-color) 12%, transparent);
        }

        .theme-option-label {
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .theme-option-tag {
          flex-shrink: 0;
          padding: 0 6px;
          border-radius: var(--sketch-radius-xs, 4px);
          background: var(--background-color-3);
          color: var(--text-color-3);
          font-size: 10px;
          line-height: 16px;
        }

        .theme-option-check {
          flex-shrink: 0;
          font-size: 15px;
          color: var(--primary-color);
        }
      }
    }

    .theme-selected-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;

      .theme-action-icon {
        font-size: 16px;
        color: var(--text-color-3);
        cursor: pointer;
        transition:
          color 0.2s ease,
          transform 0.2s ease;

        &:hover {
          transform: scale(1.1);
        }

        &.edit-icon:hover {
          color: var(--primary-color);
        }

        &.download-icon:hover {
          color: #10b981;
        }

        &.delete-icon:hover {
          color: var(--error-color, #ef4444);
        }
      }
    }

    .theme-select-add {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
      height: 40px;
      padding: 0 14px;
      cursor: pointer;
      border: 1px dashed var(--border-color-2);
      border-radius: var(--sketch-radius-pill, 100px);
      background: transparent;
      color: var(--text-color-2);
      font-size: 12px;
      transition:
        color 0.2s ease,
        border-color 0.2s ease,
        background-color 0.2s ease;

      &:hover {
        color: var(--primary-color);
        border-color: var(--primary-color);
        background: var(--hover-color);
      }
    }
  }

  .theme-preview-frame {
    // background: #000;
    width: 100%;
    // max-width: 700px;
    height: 100%;
    padding: 10px 0px 0 0;
    box-sizing: border-box;
    margin-top: 15px;

    position: relative;

    // 添加下方淡黑色渐变阴影
    &::after {
      content: "";
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 70px;
      background: linear-gradient(to bottom, transparent, var(--background-color));
      border-radius: 0 0 4px 4px;
      pointer-events: none;
    }

    .theme-preview-page {
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
      align-items: center;
      width: 100%;
      height: 280px;
      border-radius: 4px;
      box-shadow: rgba(0, 0, 0, 0.14) 0px 0px 3px;
      background-color: var(--background-color-3);
      // margin: 20px 0;
      padding: 10px 20px;
      box-sizing: border-box;

      .theme-preview-container {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        justify-content: flex-start;
        align-items: center;
      }

      .theme-preview-tabbar {
        width: 100%;
        height: 35px;
        background-color: var(--background-color-2);
        display: flex;
        border-radius: 5px 5px 0 0;
        justify-content: flex-start;
        position: relative;
        padding: 0 30px;
        box-sizing: border-box;
        overflow: hidden;

        .theme-preview-tabbar-item {
          position: absolute;
          bottom: 0px;
          // max-width: 120px;
          min-width: 100px;
          width: 100px;
          height: 26px;
          flex-shrink: 0;
          // background: var(--background-color-2);
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0 8px;
          cursor: pointer;
          gap: 6px;
          border-radius: 6px 6px 0 0;
          // transition: all 0.3s ease;
          user-select: none;
          z-index: 0;

          .closeIcon {
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            flex-shrink: 0;

            svg {
              font-size: 10px;
              line-height: 20px;
              cursor: pointer;
              color: var(--text-color-3);
            }
          }

          p {
            margin: 0;
            font-size: 10px;
            color: var(--text-color-3);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            flex: 1;
            min-width: 0;
          }

          &.active {
            background: var(--background-color-1);
            box-shadow: 0 0px 6px rgba(0, 0, 0, 0.1);
            z-index: 2;

            p {
              color: var(--text-color-1);
            }

            .closeIcon svg {
              color: var(--text-color-1);
            }
          }

          .pre {
            position: absolute;
            left: -10px;
            top: 17px;
            width: 10px;
            height: 10px;
            fill: var(--background-color-2);
            // transition: all 0.3s ease;

            &.active {
              fill: var(--background-color-1);
            }
          }

          .after {
            position: absolute;
            right: -10px;
            top: 17px;
            width: 10px;
            height: 10px;
            fill: var(--background-color-2);
            // transition: all 0.3s ease;

            &.active {
              fill: var(--background-color-1);
            }
          }
        }

        .addTab {
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          gap: 4px;
          flex-shrink: 0;
          min-width: 30px;

          svg {
            border-radius: 3px;
            font-size: 10px;
            font-weight: bold;
            cursor: pointer;
            color: var(--text-color-3);
            padding: 2px 6px;
          }

          .addTabLine {
            width: 0px;
            height: 15px;
            background: var(--border-color-1);
          }
        }
      }

      .theme-preview-content {
        width: 100%;
        height: calc(100% - 30px);
        border-radius: 0 0 5px 5px;
        background-color: var(--background-color-1);
        color: var(--text-color-2);
        padding: 20px;
        box-sizing: border-box;
        position: relative;
        z-index: 1;

        .preview-header {
          height: 12px;
          width: 30%;
          background-color: currentColor;
          opacity: 0.7;
          border-radius: 4px;
          margin-bottom: 12px;
        }

        .preview-lines {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-top: 20px;

          .preview-line {
            height: 8px;
            background-color: currentColor;
            opacity: 0.5;
            border-radius: 4px;

            &:nth-child(1) {
              width: 60%;
            }

            &:nth-child(2) {
              width: 55%;
            }

            &:nth-child(3) {
              width: 45%;
            }
          }
        }
      }
    }
  }
}
</style>
