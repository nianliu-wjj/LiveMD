<script setup lang="ts">
/**
 * 语言设置项（设置页内的配置行）
 *
 * 原独立语言页调整为设置页配置项（设置页「语言」区块）；
 * 切换语言需重启应用生效，沿用 ReloadConfirmDialog 确认流程
 * （全部保存并重启 / 稍后手动重启 / 取消）。
 */
import autodialog from "autodialog.js";
import { ref } from "vue";
import ReloadConfirmDialog from "@/renderer/components/dialogs/ReloadConfirmDialog.vue";
import Selector from "@/renderer/components/ui/selector/Selector.vue";
import useTab from "@/renderer/hooks/useTab";

type LanguageCode = "zh-cn" | "ja" | "ko" | "ru" | "en" | "fr";

const languages = [
  { code: "zh-cn", name: "中文" },
  { code: "ja", name: "日本語" },
  { code: "ko", name: "한국어" },
  { code: "ru", name: "Русский язык" },
  { code: "en", name: "English" },
  { code: "fr", name: "En français" },
];

const { tabs, saveTab } = useTab();

const selectedLanguage = ref<LanguageCode>(
  (localStorage.getItem("lang") as LanguageCode) || "zh-cn"
);

async function selectLanguage() {
  const currentLang = (localStorage.getItem("lang") as LanguageCode) || "zh-cn";
  if (selectedLanguage.value === currentLang) {
    return;
  }
  const res = await autodialog.show(ReloadConfirmDialog);
  if (res === "cancel" || res === undefined) {
    selectedLanguage.value = currentLang;
    return;
  }

  localStorage.setItem("lang", selectedLanguage.value);

  if (res === "saveAndReload") {
    // 保存所有标签页
    let allSaved = true;
    for (const tab of tabs.value) {
      if (tab.isModified) {
        const success = await saveTab(tab);
        if (!success) {
          allSaved = false;
        }
      }
    }
    if (allSaved) {
      window.location.reload(); // 刷新页面以应用语言更改
    }
  }
  // res === 'reloadLater' do nothing
}
</script>

<template>
  <div class="language-setting">
    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-title">显示语言</span>
        <span class="setting-desc">切换界面语言，重启应用后生效。</span>
      </div>
      <Selector
        v-model="selectedLanguage"
        class="language-selector"
        :items="languages.map((lang) => ({ value: lang.code, label: lang.name }))"
        placeholder="选择语言"
        @change="selectLanguage"
      />
    </div>
  </div>
</template>

<style lang="less" scoped>
.language-setting {
  border: 1px solid var(--border-color-1);
  border-radius: 8px;
  background: var(--background-color-2);

  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 16px 20px;
  }

  .setting-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .setting-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-color);
  }

  .setting-desc {
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-color-2);
  }

  .language-selector {
    width: 220px;
    flex-shrink: 0;
  }
}
</style>
