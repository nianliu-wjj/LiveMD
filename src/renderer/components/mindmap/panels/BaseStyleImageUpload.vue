<script setup lang="ts">
/**
 * 背景图片选择（基础样式面板专用，对应参考项目 web/src/components/ImgUpload）
 *
 * - 点击区域选择图片，或把图片拖到区域内：读取为 data URL 嵌入主题配置，随思维导图数据写回文档，
 *   文档自包含、不依赖外部文件；图片超过 2MB 时先确认（data URL 会让代码块体积明显变大）；
 * - 也可填写网络图片地址（http / https，回车或点「应用」生效）；
 * - 已设置时显示预览，可更换（也可直接把新图片拖到预览上）或移除（移除即清空背景图片）。
 *
 * 拖放事件阻止冒泡：根组件在 dragenter 时会显示「拖入文件导入思维导图」的遮罩。
 */
import { computed, ref, watch } from "vue";
import autotoast from "autotoast.js";
import { pickFile, readFileAsDataUrl } from "../utils";

/** 超过该大小的图片嵌入前先确认 */
const LARGE_IMAGE_BYTES = 2 * 1024 * 1024;

/**
 * 引擎以 background-image: url(...) 不加引号的形式写入样式，
 * 地址里的空白、括号、引号会截断 CSS，需要百分号转义（encodeURIComponent 不处理括号和单引号）
 */
const CSS_URL_ESCAPES: Record<string, string> = {
  "(": "%28",
  ")": "%29",
  "'": "%27",
  '"': "%22",
};

const props = defineProps<{
  modelValue: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
}>();

/** 图片地址输入框（只回显网络地址，不把 data URL 放进输入框） */
const urlInput = ref("");
/** 拖动图片经过上传区域 / 预览 */
const dragOver = ref(false);
/** 正在读取文件 */
const reading = ref(false);

const previewBackground = computed(() => `url("${props.modelValue.replace(/"/g, "%22")}")`);

watch(
  () => props.modelValue,
  (value) => {
    urlInput.value = /^https?:\/\//i.test(value) ? value : "";
  },
  { immediate: true }
);

/** 读取图片文件为 data URL 并应用 */
async function useFile(file: File): Promise<void> {
  if (!file.type.startsWith("image/")) {
    autotoast.show("请选择图片文件", "error");
    return;
  }
  if (file.size > LARGE_IMAGE_BYTES) {
    const sizeMb = (file.size / 1024 / 1024).toFixed(1);
    const confirmed = window.confirm(
      `图片较大（${sizeMb} MB），将以 data URL 嵌入文档，会明显增加文档体积。是否继续？`
    );
    if (!confirmed) {
      console.info("[MindMap/BaseStyle] 用户取消嵌入较大的背景图片:", file.name);
      return;
    }
  }
  reading.value = true;
  try {
    const dataUrl = await readFileAsDataUrl(file);
    console.info(
      "[MindMap/BaseStyle] 已读取背景图片:",
      file.name,
      `${Math.round(file.size / 1024)}KB`
    );
    emit("update:modelValue", dataUrl);
  } catch (error) {
    console.error("[MindMap/BaseStyle] 读取背景图片失败:", error);
    autotoast.show("图片读取失败", "error");
  } finally {
    reading.value = false;
  }
}

async function pick(): Promise<void> {
  if (props.disabled || reading.value) return;
  const file = await pickFile("image/*");
  if (file) await useFile(file);
}

function onDragOver(event: DragEvent): void {
  if (props.disabled || reading.value) return;
  dragOver.value = true;
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
}

async function onDrop(event: DragEvent): Promise<void> {
  dragOver.value = false;
  if (props.disabled || reading.value) return;
  const file = event.dataTransfer?.files?.[0];
  if (file) await useFile(file);
}

/** 应用输入的网络图片地址 */
function applyUrl(): void {
  if (props.disabled) return;
  const url = urlInput.value.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) {
    autotoast.show(
      "请输入以 http:// 或 https:// 开头的图片地址，本地图片请点击上方区域选择",
      "error"
    );
    return;
  }
  const safeUrl = url.replace(
    /[\s()'"]/g,
    (char) => CSS_URL_ESCAPES[char] ?? encodeURIComponent(char)
  );
  if (safeUrl === props.modelValue) return;
  console.info("[MindMap/BaseStyle] 使用网络背景图片:", safeUrl);
  emit("update:modelValue", safeUrl);
}

function remove(): void {
  if (props.disabled) return;
  console.info("[MindMap/BaseStyle] 移除背景图片");
  emit("update:modelValue", "");
}
</script>

<template>
  <div class="mm-bg-upload">
    <div
      v-if="props.modelValue"
      class="mm-bg-upload__preview"
      :class="{ 'is-dragover': dragOver }"
      :style="{ backgroundImage: previewBackground }"
      role="img"
      aria-label="背景图片预览"
      @dragenter.stop.prevent="onDragOver"
      @dragover.stop.prevent="onDragOver"
      @dragleave.stop.prevent="dragOver = false"
      @drop.stop.prevent="onDrop"
    />
    <button
      v-else
      type="button"
      class="mm-bg-upload__drop"
      :class="{ 'is-dragover': dragOver }"
      :disabled="props.disabled || reading"
      @click="pick"
      @dragenter.stop.prevent="onDragOver"
      @dragover.stop.prevent="onDragOver"
      @dragleave.stop.prevent="dragOver = false"
      @drop.stop.prevent="onDrop"
    >
      {{ reading ? "正在读取图片…" : "点击此处选择图片、或拖动图片到此" }}
    </button>
    <div v-if="props.modelValue" class="mm-bg-upload__actions">
      <button
        type="button"
        class="mm-btn mm-btn--small"
        :disabled="props.disabled || reading"
        @click="pick"
      >
        更换图片
      </button>
      <button
        type="button"
        class="mm-btn mm-btn--small mm-btn--danger"
        :disabled="props.disabled"
        @click="remove"
      >
        移除
      </button>
    </div>
    <div class="mm-bg-upload__url">
      <input
        v-model="urlInput"
        class="mm-input"
        type="url"
        placeholder="或输入网络图片地址"
        :disabled="props.disabled"
        @keydown.enter.prevent="applyUrl"
      />
      <button
        type="button"
        class="mm-btn mm-btn--small"
        :disabled="props.disabled || !urlInput.trim()"
        @click="applyUrl"
      >
        应用
      </button>
    </div>
  </div>
</template>

<style lang="less" scoped>
.mm-bg-upload {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 10px;
}

.mm-bg-upload__drop {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 110px;
  padding: 10px;
  border: 1px dashed var(--border-color-2, #ccc);
  border-radius: 6px;
  background: var(--background-color-2, #f5f7fa);
  color: var(--text-color-3, #999);
  font-family: inherit;
  font-size: 12px;
  line-height: 1.6;
  text-align: center;
  cursor: pointer;

  &:hover:not(:disabled),
  &.is-dragover {
    border-color: var(--primary-color, #409eff);
    color: var(--primary-color, #409eff);
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
}

.mm-bg-upload__preview {
  height: 110px;
  border: 1px solid var(--border-color-1, #e1e4e8);
  border-radius: 6px;
  background-color: var(--background-color-2, #f5f7fa);
  background-position: center;
  background-repeat: no-repeat;
  background-size: contain;

  &.is-dragover {
    border-color: var(--primary-color, #409eff);
  }
}

.mm-bg-upload__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.mm-bg-upload__url {
  display: flex;
  gap: 6px;

  .mm-input {
    flex: 1;
    min-width: 0;
  }
}
</style>
