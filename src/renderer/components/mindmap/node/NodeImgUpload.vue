<script setup lang="ts">
/**
 * 节点图片上传区（移植自参考项目 web/src/components/ImgUpload）
 *
 * - 点击选择（utils.pickFile）或把图片拖进虚线框；读成 data URL 通过 v-model 回传，
 *   设置到节点后嵌入思维导图数据，保证 Markdown 文件自包含（不引用本地路径）；
 * - 有图片时显示预览与删除按钮。
 *
 * LiveMD 桌面端（Tauri）的系统文件拖放不会派发到元素上：tauriElectronCompat 只在 window 上派发
 * 「空内容 File + 路径」的合成 drop 事件，且 LiveMD 自己会把拖入的图片插入背后的 Markdown 文档。
 * 因此本组件挂载期间（即图片弹窗打开期间）在 window 捕获阶段接管这类事件：按路径读取图片内容，
 * 并阻止事件继续传给 LiveMD 的处理逻辑。
 */
import { onBeforeUnmount, onMounted, ref } from "vue";
import autotoast from "autotoast.js";
import { pickFile, readFileAsDataUrl } from "../utils";

const props = defineProps<{
  /** 图片地址（data URL 或其它地址） */
  modelValue: string;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
}>();

/** 超过该大小提示：图片以 base64 嵌入文档，会明显增大文档体积 */
const LARGE_IMAGE_BYTES = 2 * 1024 * 1024;

/** 图片扩展名 → MIME（按路径读取时无法从 File 得到类型） */
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  avif: "image/avif",
  ico: "image/x-icon",
};

const areaRef = ref<HTMLElement | null>(null);
const isDragOver = ref(false);
const reading = ref(false);

function getExt(name: string): string {
  return /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || getExt(file.name) in IMAGE_MIME_BY_EXT;
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.ceil(bytes / 1024)} KB`;
}

/** 读取图片为 data URL：Tauri 合成拖放事件里的 File 没有内容，按路径读取 */
async function fileToDataUrl(file: File): Promise<{ url: string; bytes: number }> {
  const path = file.size === 0 ? window.electronAPI?.getPathForFile?.(file) : undefined;
  if (path) {
    const base64 = await window.electronAPI.readFileBase64(path);
    const mime = IMAGE_MIME_BY_EXT[getExt(file.name)] ?? "application/octet-stream";
    return { url: `data:${mime};base64,${base64}`, bytes: Math.floor((base64.length * 3) / 4) };
  }
  return { url: await readFileAsDataUrl(file), bytes: file.size };
}

/** 选中图片文件（对应参考项目 selectImg） */
async function selectImg(file: File | null | undefined): Promise<void> {
  if (!file) return;
  if (!isImageFile(file)) {
    autotoast.show("请选择图片文件", "error");
    return;
  }
  reading.value = true;
  try {
    const { url, bytes } = await fileToDataUrl(file);
    console.info("[MindMap/NodeImgUpload] 已读取图片:", file.name, formatSize(bytes));
    if (bytes > LARGE_IMAGE_BYTES) {
      autotoast.show(`图片较大（${formatSize(bytes)}），将以 base64 形式嵌入文档`, "info");
    }
    emit("update:modelValue", url);
  } catch (error) {
    console.error("[MindMap/NodeImgUpload] 读取图片失败:", error);
    autotoast.show("读取图片失败", "error");
  } finally {
    reading.value = false;
  }
}

async function onAreaClick(): Promise<void> {
  if (reading.value) return;
  await selectImg(await pickFile("image/*"));
}

function onDragLeave(event: DragEvent): void {
  // 在子元素之间移动也会触发 dragleave，只有真正离开虚线框才取消高亮
  if (!areaRef.value?.contains(event.relatedTarget as Node | null)) isDragOver.value = false;
}

/** 拖放到虚线框（浏览器环境的原生拖放，对应参考项目 onDrop） */
function onDrop(event: DragEvent): void {
  isDragOver.value = false;
  void selectImg(event.dataTransfer?.files?.[0]);
}

/** 接管 Tauri 在 window 上派发的合成 drop 事件（见文件头说明） */
function onWindowDrop(event: DragEvent): void {
  if (event.target !== window) return;
  const file = Array.from(event.dataTransfer?.files ?? []).find(isImageFile);
  if (!file) return;
  // 阻止 LiveMD 的 window drop 监听把图片插入 Markdown 文档
  event.preventDefault();
  event.stopImmediatePropagation();
  console.info("[MindMap/NodeImgUpload] 接收系统拖入的图片:", file.name);
  void selectImg(file);
}

function deleteImg(): void {
  emit("update:modelValue", "");
}

onMounted(() => window.addEventListener("drop", onWindowDrop, true));
onBeforeUnmount(() => window.removeEventListener("drop", onWindowDrop, true));
</script>

<template>
  <div class="node-img-upload">
    <div
      v-if="!props.modelValue"
      ref="areaRef"
      class="node-img-upload__area"
      :class="{ 'is-dragover': isDragOver, 'is-reading': reading }"
      role="button"
      tabindex="0"
      @click="onAreaClick"
      @keydown.enter.prevent="onAreaClick"
      @dragenter.stop.prevent="isDragOver = true"
      @dragover.stop.prevent
      @dragleave.stop.prevent="onDragLeave"
      @drop.stop.prevent="onDrop"
    >
      <span class="mm-iconfont iconimage node-img-upload__icon" />
      <span>{{ reading ? "图片读取中…" : "点击此处选择图片、或拖动图片到此" }}</span>
    </div>
    <div v-else class="node-img-upload__preview">
      <img :src="props.modelValue" alt="" draggable="false" />
      <button type="button" class="node-img-upload__delete" title="删除图片" @click="deleteImg">
        ×
      </button>
    </div>
  </div>
</template>

<style lang="less" scoped>
.node-img-upload__area {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 120px;
  border: 1px dashed var(--border-color-2, #c0c4cc);
  border-radius: 6px;
  background: var(--background-color-2, #fafafa);
  color: var(--text-color-2, #666);
  font-size: 13px;
  cursor: pointer;
  outline: none;
  transition:
    border-color 0.2s,
    color 0.2s;

  &:hover,
  &:focus-visible,
  &.is-dragover {
    border-color: var(--primary-color, #409eff);
    color: var(--primary-color, #409eff);
  }

  &.is-reading {
    cursor: progress;
  }
}

.node-img-upload__icon {
  font-size: 28px;
}

.node-img-upload__preview {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 160px;
  padding: 8px;
  border: 1px solid var(--border-color-1, #e4e7ed);
  border-radius: 6px;
  background:
    repeating-conic-gradient(rgba(127, 127, 127, 0.12) 0% 25%, transparent 0% 50%) 50% / 16px 16px,
    var(--background-color-1, #fff);

  img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
}

.node-img-upload__delete {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  font-size: 16px;
  line-height: 24px;
  cursor: pointer;

  &:hover {
    background: rgba(0, 0, 0, 0.65);
  }
}
</style>
