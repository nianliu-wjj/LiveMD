<script setup lang="ts">
import { ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { Tab } from "@/typings/tab";

const props = defineProps<{ tab: Tab; isActive: boolean }>();
const previewUrl = ref("");
const error = ref("");
const isMobile = window.electronAPI.isMobile;
let generation = 0;
watch(
  () => props.tab.filePath,
  async (filePath) => {
    const current = ++generation;
    previewUrl.value = "";
    error.value = "";
    if (isMobile || !filePath) return;
    try {
      const url = await invoke<string>("ensure_html_preview", { filePath });
      if (current === generation) previewUrl.value = url;
    } catch (cause) {
      if (current === generation) error.value = String(cause);
    }
  },
  { immediate: true }
);
</script>

<template>
  <div class="html-document-view">
    <p v-if="error" role="alert">{{ error }}</p>
    <iframe
      v-else-if="previewUrl"
      :src="previewUrl"
      sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
      :title="tab.name"
    />
    <iframe
      v-else-if="isMobile || !tab.filePath"
      :srcdoc="tab.content"
      sandbox="allow-scripts allow-forms allow-modals"
      :title="tab.name"
    />
    <p v-else>正在打开 HTML...</p>
  </div>
</template>

<style scoped>
.html-document-view {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: white;
}
iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
}
p {
  padding: 16px;
}
</style>
