<script setup lang="ts">
/**
 * 首页（无打开标签页时占据内容区）
 *
 * 设计：沿用默认主题的「手绘纸感」语言——纸面、墨线描边、偏移硬阴影、手写标题；
 * 视觉令牌全部走 var(--sketch-*, 回退值)，因此其它主题下自动退回常规样式。
 *
 * 职责边界：
 * - 只做「入口聚合」，不引入新能力：新建文档、打开文件、打开文件夹、
 *   最近文件、快捷键速查，全部复用既有 hook（useFile / useWorkSpace / useTab / useRecentFiles）；
 * - 不参与标签页与编辑器生命周期，标签页由 useTab 管理；有标签页时本组件不渲染。
 */
import { computed } from "vue";
import AppIcon from "@/renderer/components/ui/AppIcon.vue";
import useFile from "@/renderer/hooks/useFile";
import useRecentFiles from "@/renderer/hooks/useRecentFiles";
import useTab from "@/renderer/hooks/useTab";
import useWorkSpace from "@/renderer/hooks/useWorkSpace";

const { createNewFile, onOpen } = useFile();
const { setWorkSpace } = useWorkSpace();
const { openFile } = useTab();
const { recentFiles } = useRecentFiles();

/** 首页最多展示的最近文件条数（完整列表仍由快速打开面板提供） */
const RECENT_LIMIT = 6;

const recentItems = computed(() => recentFiles.value.slice(0, RECENT_LIMIT));

/** 取路径中最后一段作为文件名（与 useTab 的取名规则保持一致） */
function fileNameOf(filePath: string, fallback: string): string {
  return fallback || filePath.split(/[/\\]/).pop() || filePath;
}

/** 取上级目录的末两段，作为文件名下方的路径提示 */
function dirHintOf(filePath: string): string {
  const segments = filePath.split(/[/\\]+/).filter(Boolean);
  if (segments.length <= 1) return "";
  return segments.slice(-3, -1).join(" / ");
}

/** 相对时间：最近 7 天内用「今天/昨天/N 天前」，更早显示日期 */
function relativeTimeOf(openedAt: number): string {
  if (!openedAt) return "";
  const day = 24 * 60 * 60 * 1000;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((startOfToday.getTime() - openedAt) / day);

  if (diffDays <= -1) return "";
  if (diffDays === 0) return "今天";
  if (diffDays === 1) return "昨天";
  if (diffDays < 7) return `${diffDays} 天前`;

  const date = new Date(openedAt);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

/** 快捷键速查：仅列出应用内已注册的组合，避免与真实行为不符 */
const shortcutGroups: Array<{ title: string; items: Array<{ keys: string[]; label: string }> }> = [
  {
    title: "打开",
    items: [
      { keys: ["Ctrl", "P"], label: "快速打开文件" },
      { keys: ["Ctrl", "Shift", "P"], label: "命令面板" },
      { keys: ["Ctrl", "Shift", "F"], label: "在工作区中搜索" },
    ],
  },
  {
    title: "编辑",
    items: [
      { keys: ["Ctrl", "S"], label: "保存" },
      { keys: ["Ctrl", "Shift", "S"], label: "另存为" },
      { keys: ["Ctrl", "K"], label: "插入链接" },
      { keys: ["Ctrl", "F"], label: "查找" },
      { keys: ["Ctrl", "H"], label: "替换" },
    ],
  },
  {
    title: "文档",
    items: [
      { keys: ["Alt", "点击段落"], label: "添加书签" },
      { keys: ["拖入文件"], label: "直接打开文档" },
    ],
  },
];
</script>

<template>
  <div class="home-page">
    <div class="home-page__sheet">
      <!-- 报头：手写体字标 + 波浪分隔线 -->
      <header class="home-page__hero">
        <p class="home-page__eyebrow">本地 Markdown 写作台</p>
        <h1 class="home-page__wordmark">LiveMD</h1>
        <p class="home-page__tagline">
          文档保存在本地磁盘：写作、大纲、批注、书签都在同一个窗口里完成。
        </p>
        <div class="home-page__rule" aria-hidden="true"></div>
      </header>

      <!-- 主入口：三张并排的纸片按钮 -->
      <section class="home-page__actions" aria-label="开始">
        <button type="button" class="home-page__action" @click="createNewFile()">
          <span class="home-page__action-icon"><AppIcon name="plus" /></span>
          <span class="home-page__action-text">
            <span class="home-page__action-title">新建文档</span>
            <span class="home-page__action-hint">从空白页开始写</span>
          </span>
        </button>

        <button type="button" class="home-page__action" @click="onOpen()">
          <span class="home-page__action-icon"><AppIcon name="document" /></span>
          <span class="home-page__action-text">
            <span class="home-page__action-title">打开文件</span>
            <span class="home-page__action-hint">打开已有的 Markdown 文件</span>
          </span>
        </button>

        <button type="button" class="home-page__action" @click="setWorkSpace()">
          <span class="home-page__action-icon"><AppIcon name="folder-opened" /></span>
          <span class="home-page__action-text">
            <span class="home-page__action-title">打开文件夹</span>
            <span class="home-page__action-hint">把整个目录作为工作区</span>
          </span>
        </button>
      </section>

      <div class="home-page__columns">
        <!-- 最近文件 -->
        <section class="home-page__panel" aria-label="最近打开">
          <h2 class="home-page__panel-title">最近打开</h2>

          <ul v-if="recentItems.length > 0" class="home-page__recent">
            <li v-for="item in recentItems" :key="item.path">
              <button
                type="button"
                class="home-page__recent-row"
                :title="item.path"
                @click="openFile(item.path)"
              >
                <AppIcon name="markdown" class="home-page__recent-icon" />
                <span class="home-page__recent-name">{{ fileNameOf(item.path, item.name) }}</span>
                <span v-if="dirHintOf(item.path)" class="home-page__recent-dir">
                  {{ dirHintOf(item.path) }}
                </span>
                <span class="home-page__recent-time">{{ relativeTimeOf(item.openedAt) }}</span>
              </button>
            </li>
          </ul>

          <p v-else class="home-page__empty">
            还没有最近打开的文件。打开一个文档后，这里会留下记录，方便下次直接回来。
          </p>
        </section>

        <!-- 快捷键速查 -->
        <section class="home-page__panel" aria-label="快捷键">
          <h2 class="home-page__panel-title">快捷键</h2>

          <div v-for="group in shortcutGroups" :key="group.title" class="home-page__keys">
            <p class="home-page__keys-title">{{ group.title }}</p>
            <div v-for="item in group.items" :key="item.label" class="home-page__key-row">
              <span class="home-page__key-combo">
                <template v-for="(key, index) in item.keys" :key="key">
                  <span v-if="index > 0" class="home-page__key-plus">+</span>
                  <kbd class="home-page__key">{{ key }}</kbd>
                </template>
              </span>
              <span class="home-page__key-label">{{ item.label }}</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
// 首页整体：铺满内容区并可纵向滚动（窄窗口下不裁切）
.home-page {
  height: 100%;
  overflow-y: auto;
  background: var(--background-color-1);
  color: var(--text-color);
  font-family: var(--sketch-font-ui, inherit);

  &__sheet {
    max-width: 880px;
    margin: 0 auto;
    padding: 56px 40px 64px;
  }

  /* ── 报头 ── */
  &__hero {
    position: relative;
  }

  &__eyebrow {
    margin: 0 0 6px;
    font-size: 12px;
    letter-spacing: 2px;
    color: var(--text-color-3);
  }

  &__wordmark {
    margin: 0;
    font-family: var(--sketch-font-hand, inherit);
    font-size: 44px;
    font-weight: 600;
    line-height: 1.1;
    letter-spacing: 0.5px;
    color: var(--text-color);
  }

  &__tagline {
    max-width: 34em;
    margin: 10px 0 0;
    font-size: 14px;
    line-height: 1.7;
    color: var(--text-color-2);
  }

  // 手绘波浪分隔线：无令牌时回退为一条实线
  &__rule {
    height: 6px;
    margin: 22px 0 30px;
    background: var(--sketch-wave-line) repeat-x left center;
    background-size: 24px 6px;
    border-bottom: 1px solid var(--border-color-1);
  }

  /* ── 主入口按钮 ── */
  &__actions {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
    gap: 14px;
  }

  &__action {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 18px;
    text-align: left;
    cursor: pointer;
    border: var(--sketch-stroke, 1px) solid var(--border-color-1);
    border-radius: var(--sketch-radius-wobble-sm, 8px);
    background: var(--background-color-1);
    color: var(--text-color-1);
    box-shadow: var(--sketch-shadow, 0 1px 3px rgba(0, 0, 0, 0.08));
    transition:
      background-color 0.14s ease,
      transform 0.14s ease,
      box-shadow 0.14s ease,
      color 0.14s ease;

    &:hover {
      background: var(--hover-color);
      color: var(--primary-color);
    }

    &:active {
      transform: translate(1px, 1px);
      box-shadow: none;
    }

    &:focus-visible {
      outline: var(--sketch-stroke, 2px) solid var(--primary-color);
      outline-offset: 2px;
    }
  }

  &__action-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 34px;
    height: 34px;
    font-size: 17px;
    border: var(--sketch-stroke, 1px) solid var(--border-color-1);
    border-radius: var(--sketch-radius-sm, 8px);
    background: var(--background-color-2);
    color: var(--primary-color);
  }

  &__action-text {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  &__action-title {
    font-family: var(--sketch-font-hand, inherit);
    font-size: 16px;
    letter-spacing: 0.3px;
  }

  &__action-hint {
    font-size: 12px;
    color: var(--text-color-3);
    line-height: 1.4;
  }

  /* ── 两栏：最近打开 / 快捷键 ── */
  &__columns {
    display: grid;
    grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
    gap: 30px;
    margin-top: 38px;
  }

  &__panel {
    min-width: 0;
  }

  &__panel-title {
    margin: 0 0 12px;
    font-family: var(--sketch-font-hand, inherit);
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.6px;
    color: var(--text-color-2);
  }

  &__panel-title::after {
    content: "";
    display: block;
    width: 46px;
    height: 5px;
    margin-top: 4px;
    background: var(--sketch-wave-line) repeat-x left center;
    background-size: 24px 5px;
  }

  /* 最近文件 */
  &__recent {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  &__recent-row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 9px 10px;
    text-align: left;
    cursor: pointer;
    border: none;
    border-radius: var(--sketch-radius-xs, 4px);
    background: transparent;
    color: var(--text-color-1);
    transition: background-color 0.12s ease;

    &:hover {
      background: var(--background-color-2);
      box-shadow: inset 0 0 0 var(--sketch-stroke, 1px) var(--border-color-1);
    }

    &:focus-visible {
      outline: var(--sketch-stroke, 2px) solid var(--primary-color);
      outline-offset: 1px;
    }
  }

  &__recent-icon {
    flex-shrink: 0;
    font-size: 14px;
    color: var(--text-color-3);
  }

  &__recent-name {
    flex-shrink: 0;
    max-width: 46%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
  }

  &__recent-dir {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    color: var(--text-color-3);
  }

  &__recent-time {
    flex-shrink: 0;
    font-size: 11px;
    color: var(--text-color-3);
    opacity: 0.85;
  }

  &__empty {
    margin: 0;
    padding: 14px 12px;
    border: 1px dashed var(--border-color-2);
    border-radius: var(--sketch-radius-wobble-sm, 8px);
    font-size: 12px;
    line-height: 1.7;
    color: var(--text-color-3);
  }

  /* 快捷键 */
  &__keys {
    margin-bottom: 14px;
  }

  &__keys-title {
    margin: 0 0 6px;
    font-size: 11px;
    letter-spacing: 1px;
    color: var(--text-color-3);
  }

  &__key-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 4px 0;
  }

  &__key-combo {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
  }

  &__key {
    padding: 1px 6px;
    border: 1px dashed var(--border-color-2);
    border-radius: var(--sketch-radius-xs, 4px);
    background: var(--background-color-2);
    color: var(--text-color-2);
    font-family: var(--sketch-font-ui, inherit);
    font-size: 11px;
    line-height: 18px;
  }

  &__key-plus {
    font-size: 10px;
    color: var(--text-color-3);
  }

  &__key-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    color: var(--text-color-2);
  }
}

/* 窄窗口：两栏折为单栏 */
@media (max-width: 860px) {
  .home-page {
    &__sheet {
      padding: 40px 24px 48px;
    }

    &__columns {
      grid-template-columns: minmax(0, 1fr);
      gap: 24px;
    }
  }
}
</style>
