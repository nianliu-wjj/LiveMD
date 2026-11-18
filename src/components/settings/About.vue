<script setup lang="ts">
import autotoast from "autotoast.js";
import logoSvg from "../../../public/logo.svg";
import emitter from "@/events";
import { checkUpdate } from "@/service/api/update";
import { version } from "../../../package.json";
import { ref } from "vue";
import AppIcon from "@/components/ui/AppIcon.vue";
import LoadingIcon from "../ui/LoadingIcon.vue";
import { maintainer, repositoryUrl } from "@/shared/project";

function openByDefaultBrowser(url: string) {
  window.electronAPI.openExternal(url);
}
const isMobile = window.electronAPI.isMobile;
const storedUpdateInfo = JSON.parse(localStorage.getItem("updateInfo") || "{}");
// 移动端没有应用内更新通道：不展示更新徽标，版本号也不作为检查入口
const hasNewVersion =
  !isMobile && storedUpdateInfo.version && isNewerVersion(storedUpdateInfo.version, version);

function isNewerVersion(stored: string, current: string): boolean {
  const s = stored.replace(/^v/, "").split(".").map(Number);
  const c = current.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(s.length, c.length); i++) {
    const sv = s[i] || 0;
    const cv = c[i] || 0;
    if (sv > cv) return true;
    if (sv < cv) return false;
  }
  return false;
}
const isChecking = ref(false);

function handleCheckUpdate() {
  if (isMobile) return;
  if (isChecking.value) {
    console.log("[About] Already checking for updates, skipping...");
    return;
  }

  console.log("[About] Starting update check...");
  isChecking.value = true;
  localStorage.removeItem("ignoredVersion");

  checkUpdate()
    .then((info) => {
      console.log("[About] Update check completed:", info);
      isChecking.value = false;

      if (info && info.version) {
        console.log("[About] New version available:", info.version);
        localStorage.setItem("updateInfo", JSON.stringify(info));
        emitter.emit("update:available", info);
      } else {
        console.log("[About] Already on latest version");
        autotoast.show("当前已为最新版本", "success");
      }
    })
    .catch((err) => {
      console.error("[About] checkUpdate error:", err);
      autotoast.show(`检查更新失败: ${err.message || "Unknown error"}`, "error");
      isChecking.value = false;
    })
    .finally(() => {
      // 确保状态总是被重置
      console.log("[About] Update check finished, resetting state");
      isChecking.value = false;
    });
}
</script>

<template>
  <div class="AboutBox">
    <h1 class="link" @click="openByDefaultBrowser(repositoryUrl)">
      <img :src="logoSvg" class="logo" /> LiveMD
    </h1>
    <p>
      <span class="version" :class="{ link: !isMobile }" @click="handleCheckUpdate">
        <span>version: v{{ version }} </span>
        <span v-if="!isMobile && isChecking" class="updateTip loading">
          <LoadingIcon />
        </span>
        <span v-else-if="!isMobile && hasNewVersion" class="updateTip">new</span>
      </span>
    </p>
    <p>维护者：{{ maintainer.name }} &lt;{{ maintainer.email }}&gt;</p>
    <p>MIT Copyright © 2025 {{ maintainer.name }}</p>
    <p>
      Powered by
      <span class="link" @click="openByDefaultBrowser(repositoryUrl)"
        >Tauri 2 · Vue 3 · ProseMirror</span
      >
    </p>
    <p class="thanks">
      <span class="link" @click="openByDefaultBrowser(`${repositoryUrl}/graphs/contributors`)">
        Thank you for the contribution from
        <span class="contributor-link">
          <AppIcon name="github" />
          {{ maintainer.name }}
        </span></span
      >
    </p>
    <p class="tip">LiveMD 是完全免费开源的软件</p>
  </div>
</template>

<style lang="less" scoped>
.AboutBox {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;

  .version {
    font-size: 12px;
    color: var(--text-color-2);
    margin-top: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }

  .updateTip {
    background: var(--secondary-color);
    color: white;
    font-size: 12px;
    border-radius: 4px;
    padding: 2px 8px;
    margin-left: 4px;
    vertical-align: middle;
    display: inline-flex;
    align-items: center;
    justify-content: center;

    &.loading {
      background: transparent;
      padding: 0;

      svg {
        font-size: 12px;
        color: var(--primary-color);
      }
    }
  }

  .spin {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .tip {
    position: absolute;
    bottom: 30px;
    font-size: 10px;
    color: var(--primary-color-transparent);
  }

  h1 {
    font-size: 20px;
    margin: 0;
    color: var(--text-color);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  h1 .logo {
    width: 64px;
    height: 64px;
    vertical-align: middle;
    margin-right: 8px;
  }

  p {
    font-size: 14px;
    color: var(--text-color-2);
  }
}

@media (max-width: 640px) {
  .AboutBox {
    justify-content: flex-start;
    padding: 32px 16px 72px;
    overflow-y: auto;

    .tip {
      position: static;
      margin-top: 20px;
      text-align: center;
    }

    h1 .logo {
      width: 52px;
      height: 52px;
    }

    p {
      max-width: 100%;
      text-align: center;
      line-height: 1.6;
      overflow-wrap: anywhere;
    }
  }
}
</style>
