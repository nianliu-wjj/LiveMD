<script setup lang="ts">
import { computed, ref } from "vue";
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
const groups = [
  {
    id: "files",
    title: "文件",
    icon: "folder-opened",
    sections: [
      { title: "自动保存", component: AutoSaveSetting },
      { title: "图片", component: ImageConfig },
    ],
  },
  {
    id: "reading",
    title: "阅读",
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
    icon: "markdown",
    sections: [{ title: "拼写检查", component: SpellCheckSetter }],
  },
  {
    id: "appearance",
    title: "个性",
    icon: "waiguan",
    sections: [
      { title: "主题", component: ThemePage },
      { title: "语言", component: Language },
    ],
  },
  {
    id: "about",
    title: "关于",
    icon: "github",
    sections: [{ title: "关于 LiveMD", component: About }],
  },
];
const active = ref<string | null>(null);
const selected = computed(() => groups.find((group) => group.id === active.value));
function back() {
  if (active.value) active.value = null;
  else emit("close");
}
</script>
<template>
  <section class="mobile-settings-page">
    <header>
      <button aria-label="返回" @click="back">‹</button>
      <h1>{{ selected?.title || "我的" }}</h1>
    </header>
    <main v-if="!selected" class="settings-overview">
      <div class="app-card">
        <AppIcon name="markdown" />
        <div><strong>LiveMD</strong><small>本地 Markdown 写作</small></div>
      </div>
      <div class="settings-group">
        <button v-for="group in groups.slice(0, 4)" :key="group.id" @click="active = group.id">
          <AppIcon :name="group.icon" /><span>{{ group.title }}</span
          ><span class="arrow">›</span>
        </button>
      </div>
      <div class="settings-group">
        <button @click="active = 'about'">
          <AppIcon name="github" /><span
            >关于<small>v{{ version }}</small></span
          ><span class="arrow">›</span>
        </button>
      </div>
    </main>
    <main v-else class="settings-details">
      <section v-for="section in selected.sections" :key="section.title" class="settings-section">
        <h2>{{ section.title }}</h2>
        <component :is="section.component" />
      </section>
    </main>
    <nav v-if="!selected" aria-label="设置导航">
      <button @click="emit('close')"><AppIcon name="markdown" />返回文件</button
      ><button class="active"><AppIcon name="config-props" />我的</button>
    </nav>
  </section>
</template>
<style scoped lang="less">
.mobile-settings-page {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  background: var(--background-color-1);
  color: var(--text-color);
}
header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  min-height: 48px;
  h1 {
    font-size: 28px;
    margin: 0;
  }
  button {
    font-size: 30px;
    width: 44px;
    height: 44px;
  }
}
button {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
main {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px 20px 100px;
}
.app-card,
.settings-group,
.settings-section {
  background: var(--background-color-2);
  border-radius: 20px;
  border: 1px solid var(--border-color-1);
  margin-bottom: 20px;
}
.app-card {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 24px;
  > svg {
    width: 48px;
    height: 48px;
    color: var(--primary-color);
  }
  strong {
    font-size: 22px;
  }
  small {
    display: block;
    margin-top: 6px;
    color: var(--text-color-3);
  }
}
.settings-group button {
  display: flex;
  align-items: center;
  gap: 18px;
  width: 100%;
  min-height: 72px;
  padding: 16px 20px;
  text-align: left;
  font-size: 18px;
  > svg {
    width: 24px;
    height: 24px;
    color: var(--text-color-2);
  }
  small {
    display: block;
    font-size: 12px;
    color: var(--text-color-3);
    margin-top: 4px;
  }
  .arrow {
    margin-left: auto;
    color: var(--text-color-3);
  }
}
.settings-section {
  padding: 20px;
  h2 {
    font-size: 16px;
    margin: 0 0 20px;
    color: var(--text-color-2);
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
nav {
  position: fixed;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 8px);
  left: 20px;
  right: 20px;
  display: flex;
  justify-content: space-around;
  background: var(--background-color-2);
  border: 1px solid var(--border-color-1);
  border-radius: 20px;
  padding: 8px;
  button {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    min-width: 80px;
    min-height: 44px;
    font-size: 12px;
  }
  svg {
    width: 22px;
    height: 22px;
  }
  .active {
    color: var(--primary-color);
  }
}
</style>
