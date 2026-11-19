<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch } from "vue";
import useTab from "@/hooks/useTab";
import useFile from "@/hooks/useFile";
import useRecentFiles from "@/hooks/useRecentFiles";
import useReadOnlyMode from "@/hooks/useReadOnlyMode";
import useSourceCode from "@/hooks/useSourceCode";
import emitter from "@/events";
import useAnnotations from "@/hooks/useAnnotations";
import { hideOtherEdgeBars } from "@/utils/rightEdgeBars";
import MobileSettings from "./MobileSettings.vue";
import AppIcon from "@/components/ui/AppIcon.vue";
defineProps<{ browsing: boolean }>();
const emit = defineEmits<{ (e: "browse", value: boolean): void }>();
const { tabs, currentTab, switchToTab, openFile } = useTab();
const { onOpen, createNewFile, onSave } = useFile();
const { recentFiles } = useRecentFiles();
const { isShowSource, toggleSourceCode } = useSourceCode();
const { isReadOnlyMode, toggleReadOnlyMode } = useReadOnlyMode();
const reading = computed(() => isReadOnlyMode.value || Boolean(currentTab.value?.readOnly));
function toggleEditing() {
  if (currentTab.value?.readOnly) return;
  toggleReadOnlyMode();
  if (isReadOnlyMode.value) {
    (document.activeElement as HTMLElement | null)?.blur();
    if (isShowSource.value) toggleSourceCode();
  }
}
watch(reading, (value) => document.documentElement.classList.toggle("mobile-reading", value), {
  immediate: true,
});
const { setBarVisible } = useAnnotations();
function annotations() {
  hideOtherEdgeBars("annotations");
  setBarVisible(true);
}
const query = ref("");
const menu = ref(false);
const settings = ref(false);
const keyboard = ref(false);
const files = computed(() =>
  tabs.value.filter((tab) => tab.name.toLowerCase().includes(query.value.toLowerCase()))
);
const recent = computed(() =>
  recentFiles.value.filter(
    (file) =>
      !tabs.value.some((tab) => tab.filePath === file.path) &&
      file.name.toLowerCase().includes(query.value.toLowerCase())
  )
);
async function select(id: string) {
  await switchToTab(id);
  emit("browse", false);
}
async function importFile() {
  menu.value = false;
  await onOpen();
  if (currentTab.value) emit("browse", false);
}
async function newFile() {
  menu.value = false;
  await createNewFile();
  emit("browse", false);
}
async function openRecent(path: string) {
  if (await openFile(path)) emit("browse", false);
}
function command(id: string) {
  if (!reading.value) emitter.emit("editor:command", { id });
}
function viewport() {
  const view = window.visualViewport;
  const bottom = view ? Math.max(0, window.innerHeight - view.height - view.offsetTop) : 0;
  keyboard.value = bottom > 120;
  document.documentElement.style.setProperty("--mobile-keyboard-offset", `${bottom}px`);
}
watch(settings, (value) => {
  if (value) menu.value = false;
});
onMounted(() => {
  document.documentElement.classList.add("mobile-layout");
  window.visualViewport?.addEventListener("resize", viewport);
  window.visualViewport?.addEventListener("scroll", viewport);
  viewport();
});
onUnmounted(() => {
  document.documentElement.classList.remove("mobile-layout", "mobile-reading");
  window.visualViewport?.removeEventListener("resize", viewport);
  window.visualViewport?.removeEventListener("scroll", viewport);
  document.documentElement.style.removeProperty("--mobile-keyboard-offset");
});
</script>
<template>
  <header class="mobile-header">
    <template v-if="browsing"
      ><h1>文件</h1>
      <span class="mobile-subtitle">本地文档</span></template
    >
    <template v-else
      ><button aria-label="返回文件列表" @click="emit('browse', true)">‹</button
      ><span class="mobile-document-name">{{ currentTab?.name || "文档" }}</span
      ><span class="mobile-subtitle">{{ currentTab?.content.length ?? 0 }} 字</span
      ><button v-if="!reading" aria-label="保存文件" @click="onSave()">
        <AppIcon name="save" /></button
    ></template>
    <button v-if="browsing" aria-label="文件操作" :aria-expanded="menu" @click="menu = !menu">
      ＋
    </button>
    <div v-if="menu" class="mobile-file-menu">
      <button @click="newFile">新建 Markdown</button><button @click="importFile">导入文件</button
      ><button @click="settings = true">设置</button>
    </div>
  </header>
  <main v-if="browsing" class="mobile-files">
    <input v-model="query" type="search" placeholder="搜索文件名" aria-label="搜索文件名" />
    <h2 v-if="files.length">已打开</h2>
    <button v-for="tab in files" :key="tab.id" class="mobile-file-row" @click="select(tab.id)">
      <AppIcon name="markdown" /><span
        ><strong>{{ tab.name }}</strong
        ><small
          >{{ tab.isModified ? "未保存" : "已保存" }} · {{ tab.content.length }} 字符</small
        ></span
      ><span>›</span>
    </button>
    <h2 v-if="recent.length">最近打开</h2>
    <button
      v-for="file in recent"
      :key="file.path"
      class="mobile-file-row"
      @click="openRecent(file.path)"
    >
      <AppIcon name="markdown" /><span
        ><strong>{{ file.name }}</strong
        ><small>{{ new Date(file.openedAt).toLocaleDateString() }}</small></span
      ><span>›</span>
    </button>
    <div v-if="!files.length && !recent.length" class="mobile-files-empty">
      <AppIcon name="markdown" />
      <h2>{{ query ? "没有匹配的文件" : "开始写作" }}</h2>
      <p>创建文档，或导入已有 Markdown 文件</p>
      <button @click="newFile">新建文档</button><button @click="importFile">导入文件</button>
    </div>
  </main>
  <nav v-if="browsing" class="mobile-navigation" aria-label="移动导航">
    <button class="active" @click="emit('browse', true)"><AppIcon name="markdown" />文件</button
    ><button @click="emitter.emit('bookmarks:show-bar')"><AppIcon name="bookmark" />书签</button
    ><button @click="settings = true"><AppIcon name="config-props" />设置</button>
  </nav>
  <div
    v-else
    class="mobile-editor-tools"
    :class="{ 'keyboard-open': keyboard && !reading, 'reading-tools': reading }"
  >
    <div v-if="!reading" class="mobile-format-tools" @pointerdown.prevent>
      <button aria-label="撤销" @click="command('undo')">↶</button
      ><button aria-label="重做" @click="command('redo')">↷</button
      ><button aria-label="加粗" @click="command('toggleStrong')"><b>B</b></button
      ><button aria-label="斜体" @click="command('toggleEmphasis')"><i>I</i></button
      ><button aria-label="行内代码" @click="command('toggleCodeInline')">&lt;/&gt;</button
      ><button aria-label="删除线" @click="command('toggleStrikethrough')"><s>S</s></button>
    </div>
    <nav aria-label="文档工具">
      <button
        :disabled="Boolean(currentTab?.readOnly)"
        :aria-pressed="!reading"
        @click="toggleEditing"
      >
        {{ reading ? "编辑" : "只读" }}
      </button>
      <button @click="emitter.emit('outline:show-bar')">大纲</button
      ><button v-if="!reading" @click="toggleSourceCode()">
        {{ isShowSource ? "即时渲染" : "源码" }}</button
      ><button @click="emitter.emit('bookmarks:show-bar')">书签</button
      ><button v-if="!reading" @click="annotations">批注</button>
      <button @click="settings = true">设置</button>
    </nav>
  </div>
  <MobileSettings v-if="settings" @close="settings = false" />
</template>
<style scoped lang="less">
.mobile-header {
  height: 56px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  position: relative;
  border-bottom: 1px solid var(--border-color-1);
  background: var(--background-color-1);
  h1 {
    font-size: 24px;
    margin: 0;
  }
  button {
    min-width: 44px;
    height: 44px;
  }
}
button {
  border: 0;
  color: inherit;
  background: transparent;
  cursor: pointer;
}
.mobile-subtitle {
  font-size: 12px;
  color: var(--text-color-3);
}
.mobile-header > button:last-of-type {
  margin-left: auto;
}
.mobile-document-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mobile-file-menu {
  position: absolute;
  right: 16px;
  top: 52px;
  z-index: 60;
  background: var(--background-color-2);
  border: 1px solid var(--border-color-1);
  border-radius: 12px;
  padding: 6px;
  box-shadow: 0 8px 24px #0003;
  button {
    display: block;
    width: 100%;
    text-align: left;
    padding: 0 16px;
  }
}
.mobile-files {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px 16px 90px;
  background: var(--background-color-1);
  input {
    box-sizing: border-box;
    width: 100%;
    height: 44px;
    border: 1px solid var(--border-color-1);
    border-radius: 12px;
    background: var(--background-color-2);
    color: inherit;
    padding: 0 14px;
    font-size: 16px;
  }
  h2 {
    font-size: 13px;
    color: var(--text-color-3);
    margin: 24px 0 10px;
  }
}
.mobile-file-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 14px 12px;
  margin-bottom: 10px;
  text-align: left;
  border-radius: 14px;
  background: var(--background-color-2);
  border: 1px solid var(--border-color-1);
  > span:first-of-type {
    flex: 1;
    min-width: 0;
  }
  strong {
    display: block;
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  small {
    display: block;
    color: var(--text-color-3);
    font-size: 11px;
    margin-top: 6px;
  }
  > svg {
    color: var(--primary-color);
  }
}
.mobile-files-empty {
  text-align: center;
  padding-top: 20vh;
  > svg {
    width: 48px;
    height: 48px;
    color: var(--primary-color);
  }
  p {
    color: var(--text-color-3);
    font-size: 13px;
  }
  button {
    padding: 12px 18px;
    margin: 8px;
    border: 1px solid var(--border-color-1);
    border-radius: 12px;
  }
}
.mobile-navigation,
.mobile-editor-tools {
  position: fixed;
  left: 12px;
  right: 12px;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 8px);
  z-index: 25;
  background: var(--background-color-2);
  border: 1px solid var(--border-color-1);
  border-radius: 18px;
  box-shadow: 0 4px 24px #0002;
}
.mobile-navigation,
.mobile-editor-tools nav {
  display: flex;
  justify-content: space-around;
}
.mobile-navigation button {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  padding: 10px 24px;
}
.active {
  color: var(--primary-color);
}
.mobile-editor-tools {
  bottom: calc(var(--mobile-keyboard-offset, 0px) + env(safe-area-inset-bottom, 0px) + 8px);
}
.mobile-format-tools {
  display: flex;
  justify-content: space-around;
  border-bottom: 1px solid var(--border-color-1);
  button {
    height: 44px;
    min-width: 44px;
    font-size: 18px;
  }
}
.mobile-editor-tools nav button {
  height: 44px;
  font-size: 12px;
}
.keyboard-open nav {
  display: none;
}
.mobile-settings {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  background: var(--background-color-1);
  header {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 8px 16px;
    min-height: 44px;
    h2 {
      font-size: 18px;
    }
  }
  :deep(.MenubarBox) {
    flex: 1;
    height: 0;
    min-height: 0;
  }
}
</style>

<style scoped>
.mobile-header :deep(svg),
.mobile-navigation :deep(svg),
.mobile-file-row :deep(svg) {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
}
</style>

<style scoped>
.reading-tools {
  max-width: 340px;
  margin-inline: auto;
}
button:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
