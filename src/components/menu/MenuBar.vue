<script setup lang="ts">
import { ref } from "vue";
import About from "@/components/settings/About.vue";
import appearancePage from "@/components/settings/AppearancePage.vue";
import SettingBase from "@/components/settings/SettingBase.vue";
import ShortcutPage from "@/components/settings/ShortcutPage.vue";
import AppIcon from "@/components/ui/AppIcon.vue";
import emitter from "@/events";
import { checkUpdate } from "@/service/api/update.js";

const activeTab = ref<"settings" | "about" | "appearance" | "shortcut">("settings");
const isMobile = window.electronAPI.isMobile;
const MenuComponents = {
  settings: SettingBase,
  about: About,
  appearance: appearancePage,
  shortcut: ShortcutPage,
};
const MenuOptions = [
  {
    label: "设置",
    action: () => (activeTab.value = "settings"),
    icon: "config-props",
    value: "settings",
  },
  {
    label: "外观",
    action: () => (activeTab.value = "appearance"),
    icon: "waiguan",
    value: "appearance",
  },
  {
    label: "快捷键",
    action: () => (activeTab.value = "shortcut"),
    icon: "shortcut-key",
    value: "shortcut",
  },
  { label: "关于", action: () => (activeTab.value = "about"), icon: "github", value: "about" },
];
if (!isMobile) {
  checkUpdate()
    .then((updateInfo) => {
      if (updateInfo) {
        emitter.emit("update:available", updateInfo);
      }
    })
    .catch((error) => {
      console.warn("[MenuBar] Auto update check failed silently:", error);
    });
}
</script>

<template>
  <div class="MenubarBox">
    <div class="optionsContainer">
      <button
        v-for="option in MenuOptions"
        :key="option.label"
        class="menu-option"
        :class="{ active: activeTab === option.value }"
        @click="option.action"
      >
        <AppIcon :name="option.icon" class="menu-option-icon" />
        {{ option.label }}
      </button>
    </div>
    <div class="detailContainer">
      <div class="scrollView">
        <div class="components">
          <component :is="MenuComponents[activeTab]" />
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.MenubarBox {
  height: 100%;
  display: flex;

  .detailContainer {
    flex: 1;
    padding: 12px;
    padding-top: 0;
    padding-right: 0;
    background: var(--background-color-2);

    .scrollView {
      height: 100%;
      overflow-y: auto;
      background: var(--background-color-2);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .components {
      height: 100%;
      padding-top: 12px;
    }
  }

  .optionsContainer {
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: flex-start;
    width: 200px;
    gap: 4px;
    -webkit-app-region: drag;
    background: var(--background-color);

    .menu-option {
      cursor: pointer;
      width: 100%;
      -webkit-app-region: no-drag;
      padding: 16px 12px;
      font-size: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
      border: none;
      background: transparent;
      text-align: left;
      color: var(--text-color);

      .menu-option-icon {
        font-size: 18px;
        flex-shrink: 0;
      }

      &:hover {
        background: var(--hover-color);
      }

      &.active {
        background: var(--active-color);
        font-weight: bold;
      }
    }
  }
}

/* 触屏：设置/外观/快捷键/关于 入口保持足够大的点按区域 */
@media (pointer: coarse) {
  .MenubarBox .optionsContainer .menu-option {
    min-height: 48px;
  }
}

/* 手机竖屏：左侧竖排导航改为顶部横向标签栏，内容区占满剩余高度 */
@media (max-width: 640px) {
  .MenubarBox {
    flex-direction: column;

    .optionsContainer {
      flex-direction: row;
      align-items: center;
      width: 100%;
      gap: 2px;
      padding: 6px 56px 6px 8px;
      overflow-x: auto;
      border-bottom: 1px solid var(--border-color-1);
      background: var(--background-color-2);
      -webkit-app-region: no-drag;
      scrollbar-width: none;

      &::-webkit-scrollbar {
        display: none;
      }

      .menu-option {
        flex: 0 0 auto;
        width: auto;
        min-height: 44px;
        padding: 8px 14px;
        border-radius: 8px;
        font-size: 14px;
        white-space: nowrap;
      }
    }

    .detailContainer {
      min-height: 0;
      padding: 8px;
      padding-top: 0;

      .components {
        height: auto;
        min-height: 100%;
        padding-top: 8px;
      }
    }
  }
}
</style>
