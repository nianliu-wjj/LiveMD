<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, shallowRef } from "vue";
import { loadMindMapEngine } from "@/core/nodeviews/mindmap-preview";
import { parseMindMapDocument, serializeMindMapDocument } from "@/core/utils/mindmap-document";
import type { MindMapInstance, MindMapNodeInstance } from "@/core/mindmap-engine/full";
import Themes from "@/core/mindmap-engine/themes/index.js";
const props = defineProps<{ source: string; onClose: (result: string | null) => void }>();
const canvas = ref<HTMLElement>();
const engine = shallowRef<MindMapInstance>();
const selected = shallowRef<MindMapNodeInstance[]>([]);
const text = ref("");
const error = ref("");
const ready = ref(false);
const layout = ref("logicalStructure");
const theme = ref("default");
const dirty = ref(false);
const themes = [{ name: "默认", value: "default" }, ...Themes.lightList, ...Themes.darkList];
const layouts = {
  logicalStructure: "逻辑结构图",
  mindMap: "思维导图",
  organizationStructure: "组织结构图",
  catalogOrganization: "目录组织图",
  timeline: "时间轴",
  verticalTimeline: "垂直时间轴",
  fishbone: "鱼骨图",
};
let observer: ResizeObserver | undefined;
let disposed = false;
onMounted(async () => {
  try {
    const doc = parseMindMapDocument(props.source);
    const { default: MindMap } = await loadMindMapEngine();
    if (disposed || !canvas.value) return;
    layout.value = doc.layout;
    theme.value = doc.theme.template;
    const instance = new MindMap({
      el: canvas.value,
      data: doc.root,
      layout: doc.layout,
      theme: doc.theme.template,
      themeConfig: doc.theme.config,
      fit: true,
    });
    engine.value = instance;
    instance.on("node_active", (_node: unknown, nodes: MindMapNodeInstance[]) => {
      selected.value = nodes;
      text.value = nodes[0]?.getData("text") ?? "";
    });
    instance.on("data_change", () => {
      dirty.value = true;
    });
    instance.on("node_tree_render_end", () => {
      ready.value = true;
    });
    observer = new ResizeObserver(() => instance.resize());
    observer.observe(canvas.value);
  } catch (e) {
    error.value = String(e);
  }
});
onBeforeUnmount(() => {
  disposed = true;
  observer?.disconnect();
  engine.value?.destroy();
});
function command(name: string) {
  engine.value?.execCommand(name);
}
function updateText() {
  for (const node of selected.value) engine.value?.execCommand("SET_NODE_TEXT", node, text.value);
}
function changeLayout() {
  engine.value?.setLayout(layout.value);
  dirty.value = true;
}
function changeTheme() {
  engine.value?.setTheme(theme.value);
  dirty.value = true;
}
function save() {
  if (!engine.value || !ready.value) return;
  engine.value.renderer.textEdit?.hideEditTextBox();
  props.onClose(serializeMindMapDocument(engine.value.getData(true)));
}
function cancel() {
  if (!dirty.value || window.confirm("放弃未保存的思维导图修改？")) props.onClose(null);
}
function keydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    e.stopPropagation();
    save();
  }
}
</script>
<template>
  <div class="mindmap-editor" @keydown="keydown">
    <header>
      <strong>编辑思维导图</strong><button @click="cancel">取消</button
      ><button :disabled="!ready" @click="save">保存</button>
    </header>
    <nav>
      <button @click="command('INSERT_CHILD_NODE')">子主题 (Tab)</button>
      <button @click="command('INSERT_NODE')">同级主题 (Enter)</button>
      <button @click="command('REMOVE_NODE')">删除</button>
      <button @click="command('BACK')">撤销</button
      ><button @click="command('FORWARD')">重做</button>
      <button @click="engine?.view.narrow()">−</button
      ><button @click="engine?.view.enlarge()">＋</button
      ><button @click="engine?.view.fit()">适应画布</button>
    </nav>
    <div class="body">
      <div ref="canvas" class="canvas" />
      <aside>
        <label
          >结构<select v-model="layout" @change="changeLayout">
            <option v-for="(name, value) in layouts" :key="value" :value="value">{{ name }}</option>
          </select></label
        >
        <label
          >主题<select v-model="theme" @change="changeTheme">
            <option v-for="item in themes" :key="item.value" :value="item.value">
              {{ item.name }}
            </option>
          </select></label
        >
        <label
          >选中主题<textarea v-model="text" :disabled="!selected.length" @change="updateText" />
        </label>
        <p>双击主题编辑文字，拖动主题调整位置。滚轮缩放，拖动画布移动视图。</p>
        <p v-if="error" role="alert">{{ error }}</p>
      </aside>
    </div>
  </div>
</template>
<style scoped>
.mindmap-editor {
  width: min(1400px, 96vw);
  height: 92vh;
  display: flex;
  flex-direction: column;
  background: var(--background-color-1, #fff);
  color: var(--text-color, #333);
  border-radius: 8px;
  overflow: hidden;
}
header,
nav {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid #8884;
  flex-wrap: wrap;
}
header strong {
  margin-right: auto;
}
button,
select,
textarea {
  color: inherit;
  background: var(--background-color-2, #f5f5f5);
  border: 1px solid #8885;
  border-radius: 4px;
  padding: 6px;
}
button {
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
}
.body {
  display: flex;
  flex: 1;
  min-height: 0;
}
.canvas {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
aside {
  width: 220px;
  padding: 16px;
  overflow: auto;
  border-left: 1px solid #8884;
}
label {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 18px;
}
textarea {
  min-height: 90px;
}
p {
  font-size: 12px;
  line-height: 1.7;
}
@media (max-width: 760px) {
  .mindmap-editor {
    width: 100vw;
    height: 100dvh;
    border-radius: 0;
  }
  aside {
    width: 150px;
    padding: 8px;
  }
}
</style>
