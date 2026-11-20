<script setup lang="ts">
import { computed, ref } from "vue";
import { ArrowLeft, ChevronRight, Info } from "lucide-vue-next";
import AppIcon from "@/components/ui/AppIcon.vue";
import AutoSaveSetting from "@/components/settings/AutoSaveSetting.vue";
import ImageConfig from "@/components/settings/ImageConfig.vue";
import SpellCheckSetter from "@/components/settings/SpellCheckSetter.vue";
import FontPage from "@/components/settings/FontPage.vue";
import HeadingAlignSetting from "@/components/settings/HeadingAlignSetting.vue";
import OtherSetting from "@/components/settings/OtherSetting.vue";
import ThemePage from "@/components/settings/ThemePage.vue";
import Language from "@/components/settings/Language.vue";
import About from "@/components/settings/About.vue";
import { version } from "../../../package.json";

const emit = defineEmits<{ (e: "close"): void }>();

/**
 * 移动端「我的」页：应用信息 + 设置分类（与参考图一致，底部导航由外壳统一承载）。
 */
const groups = [
  {
    id: "files",
    title: "文件",
    desc: "自动保存 · 图片",
    icon: "folder-opened",
    sections: [
      { title: "自动保存", component: AutoSaveSetting },
      { title: "图片", component: ImageConfig },
    ],
  },
  {
    id: "reading",
    title: "阅读",
    desc: "字体 · 边距 · 标题位置",
    icon: "document",
    sections: [
      { title: "字体", component: FontPage },
      { title: "标题位置", component: HeadingAlignSetting },
      { title: "阅读与边距", component: OtherSetting },
    ],
  },
  {
    id: "editing",
    title: "编辑",
    desc: "拼写检查",
    icon: "markdown",
    sections: [{ title: "拼写检查", component: SpellCheckSetter }],
  },
  {
    id: "appearance",
    title: "个性",
    desc: "主题 · 语言",
    icon: "waiguan",
    sections: [
      { title: "主题", component: ThemePage },
      { title: "语言", component: Language },
    ],
  },
];

const aboutGroup = {
  id: "about",
  title: "关于",
  desc: "版本信息与开源许可",
  sections: [{ title: "关于 LiveMD", component: About }],
};

const active = ref<string | null>(null);
const selected = computed(() => {
  if (active.value === "about") return aboutGroup;
  return groups.find((group) => group.id === active.value);
});

function back(): void {
  if (active.value) {
    active.value = null;
    return;
  }
  emit("close");
}
</script>

<template>
  <section class="mobile-settings-page">
    <!-- 概览 -->
    <div v-if="!selected" class="m-me-scroll">
      <header class="m-me-header">
        <h1>我的</h1>
      </header>

      <div class="m-profile-card">
        <span class="m-profile-logo"><AppIcon name="markdown" /></span>
        <span class="m-profile-text">
          <strong>LiveMD</strong>
          <small>本地优先的 Markdown 编辑器</small>
        </span>
        <span class="m-profile-version">v{{ version }}</span>
      </div>

      <div class="m-setting-group">
        <button
          v-for="group in groups"
          :key="group.id"
          type="button"
          class="m-setting-row"
          @click="active = group.id"
        >
          <span class="m-setting-icon"><AppIcon :name="group.icon" /></span>
          <span class="m-setting-text">
            <strong>{{ group.title }}</strong>
            <small>{{ group.desc }}</small>
          </span>
          <ChevronRight class="m-setting-arrow" :size="18" />
        </button>
      </div>

      <div class="m-setting-group">
        <button type="button" class="m-setting-row" @click="active = 'about'">
          <span class="m-setting-icon"><Info :size="20" /></span>
          <span class="m-setting-text">
            <strong>关于</strong>
            <small>{{ aboutGroup.desc }}</small>
          </span>
          <span class="m-about-version">v{{ version }}</span>
          <ChevronRight class="m-setting-arrow" :size="18" />
        </button>
      </div>

      <p class="m-me-footnote">文档保存在应用文档目录，卸载应用前请先导出备份。</p>
    </div>

    <!-- 设置详情 -->
    <div v-else class="m-detail">
      <header class="m-detail-header">
        <button type="button" aria-label="返回我的" @click="back">
          <ArrowLeft :size="22" />
        </button>
        <h1>{{ selected.title }}</h1>
      </header>
      <main class="m-detail-scroll">
        <section v-for="section in selected.sections" :key="section.title" class="m-detail-section">
          <h2>{{ section.title }}</h2>
          <component :is="section.component" />
        </section>
      </main>
    </div>
  </section>
</template>

<style scoped lang="less">
button {
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.mobile-settings-page {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  background: var(--background-color-1);
  color: var(--text-color);
}

.m-me-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: calc(env(safe-area-inset-top, 0px) + 18px) 16px
    calc(env(safe-area-inset-bottom, 0px) + 112px);
}

.m-me-header h1 {
  margin: 0 0 16px;
  font-size: 34px;
  line-height: 1.15;
  font-weight: 700;
  letter-spacing: -0.6px;
}

.m-profile-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px;
  margin-bottom: 18px;
  border-radius: 22px;
  border: 1px solid var(--border-color-1);
  background:
    radial-gradient(
      120% 140% at 0% 0%,
      color-mix(in srgb, var(--primary-color) 18%, transparent) 0%,
      transparent 56%
    ),
    var(--background-color-2);
  box-shadow: 0 10px 30px #00000012;
}

.m-profile-logo {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 54px;
  height: 54px;
  border-radius: 17px;
  background: var(--primary-color);
  color: #fff;
  box-shadow: 0 8px 20px color-mix(in srgb, var(--primary-color) 35%, transparent);

  :deep(svg) {
    width: 28px;
    height: 28px;
  }
}

.m-profile-text {
  flex: 1;
  min-width: 0;

  strong {
    display: block;
    font-size: 19px;
    letter-spacing: -0.2px;
  }

  small {
    display: block;
    margin-top: 4px;
    color: var(--text-color-3);
    font-size: 12px;
  }
}

.m-profile-version {
  flex-shrink: 0;
  padding: 4px 9px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--background-color-1) 80%, transparent);
  border: 1px solid var(--border-color-1);
  color: var(--text-color-3);
  font-size: 11px;
}

.m-setting-group {
  margin-bottom: 16px;
  overflow: hidden;
  border-radius: 22px;
  border: 1px solid var(--border-color-1);
  background: var(--background-color-2);
}

.m-setting-row {
  display: flex;
  align-items: center;
  gap: 13px;
  width: 100%;
  min-height: 70px;
  padding: 12px 16px;
  text-align: left;
}

.m-setting-row + .m-setting-row {
  border-top: 1px solid var(--border-color-1);
}

.m-setting-row:active {
  background: var(--background-color-1);
}

.m-setting-icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 13px;
  background: color-mix(in srgb, var(--primary-color) 13%, transparent);
  color: var(--primary-color);

  :deep(svg) {
    width: 21px;
    height: 21px;
  }
}

.m-setting-text {
  flex: 1;
  min-width: 0;

  strong {
    display: block;
    font-size: 15.5px;
    font-weight: 600;
  }

  small {
    display: block;
    margin-top: 3px;
    overflow: hidden;
    color: var(--text-color-3);
    font-size: 11.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.m-setting-arrow {
  flex-shrink: 0;
  color: var(--text-color-3);
}

.m-about-version {
  flex-shrink: 0;
  color: var(--text-color-3);
  font-size: 12px;
}

.m-me-footnote {
  margin: 22px 8px 0;
  color: var(--text-color-3);
  font-size: 11.5px;
  line-height: 1.6;
  text-align: center;
}

/* ===================== 详情 ===================== */
.m-detail {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.m-detail-header {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 8px;
  height: calc(env(safe-area-inset-top, 0px) + 56px);
  padding: env(safe-area-inset-top, 0px) 10px 0;
  background: var(--background-color-1);

  button {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 12px;
    color: var(--text-color-2);
  }

  button:active {
    background: var(--background-color-2);
  }

  h1 {
    min-width: 0;
    margin: 0;
    overflow: hidden;
    font-size: 18px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.m-detail-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 10px 16px calc(env(safe-area-inset-bottom, 0px) + 112px);
}

.mobile-settings-page .m-detail .m-detail-section {
  margin-bottom: 16px;
  padding: 16px;
  border-radius: 20px;
  border: 1px solid var(--border-color-1);
  background: var(--background-color-2);

  h2 {
    margin: 0 0 16px;
    color: var(--text-color-2);
    font-size: 14px;
    font-weight: 600;
  }

  :deep(.setting-row) {
    gap: 16px;
    flex-wrap: wrap;
  }

  :deep(input),
  :deep(select),
  :deep(textarea) {
    font-size: 16px;
    max-width: 100%;
    box-sizing: border-box;
  }

  :deep(input:not([type="checkbox"]):not([type="range"])) {
    min-height: 44px;
  }

  :deep(.row-label) {
    min-width: 0;
    width: 100%;
    padding-top: 0;
  }

  :deep(.row-body) {
    flex-basis: 100%;
  }

  :deep(.path-row) {
    flex-wrap: wrap;
  }

  :deep(.setting-info) {
    min-width: 0;
  }

  :deep(.language-selector) {
    width: 100%;
    max-width: 100%;
    flex-basis: 100%;
  }

  :deep(.theme-select-area) {
    flex-wrap: wrap;
  }

  :deep(.theme-select-label) {
    width: 100%;
    min-width: 0;
  }

  :deep(.theme-select-control) {
    flex: 1 1 150px;
  }

  :deep(.theme-selected-actions) {
    min-height: 44px;
  }

  :deep(.AboutBox) {
    padding: 16px 0;
    box-sizing: border-box;
    overflow-wrap: anywhere;
  }

  :deep(.setting-desc) {
    line-height: 1.6;
  }

  :deep(.setting-title) {
    font-size: 15px;
  }

  :deep(.appearance),
  :deep(.SettingBaseBox) {
    padding: 0;
  }

  :deep(button) {
    min-height: 44px;
  }

  :deep(.config-row),
  :deep(.form-row) {
    flex-wrap: wrap;
    gap: 12px;
  }
}
</style>
