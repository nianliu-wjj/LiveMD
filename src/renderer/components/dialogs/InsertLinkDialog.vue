<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";

interface LinkResult {
  text: string;
  url: string;
}

const props = defineProps<{
  initialText?: string;
  initialUrl?: string;
  onClose: (result: LinkResult | null) => void;
}>();

const label = ref(props.initialText ?? "");
const url = ref(props.initialUrl ?? "");
const error = ref("");
const labelInput = ref<HTMLInputElement | null>(null);
const urlInput = ref<HTMLInputElement | null>(null);

onMounted(async () => {
  await nextTick();
  const target = props.initialText ? urlInput.value : labelInput.value;
  target?.focus();
  if (props.initialUrl) {
    urlInput.value?.select();
  }
});

function cancel() {
  props.onClose(null);
}

function submit() {
  const nextUrl = url.value.trim();
  if (!nextUrl) {
    error.value = "请输入链接地址";
    urlInput.value?.focus();
    return;
  }

  props.onClose({
    text: label.value.trim(),
    url: nextUrl,
  });
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Enter") {
    event.preventDefault();
    submit();
  } else if (event.key === "Escape") {
    event.preventDefault();
    cancel();
  }
}
</script>

<template>
  <div class="link-dialog" @keydown="handleKeydown">
    <div class="link-dialog-header">
      <h3>插入链接</h3>
    </div>
    <div class="link-dialog-body">
      <label class="link-field">
        <span>链接文字</span>
        <input
          ref="labelInput"
          v-model="label"
          type="text"
          autocomplete="off"
          spellcheck="false"
          placeholder="留空则使用链接地址"
        />
      </label>
      <label class="link-field">
        <span>链接地址</span>
        <input
          ref="urlInput"
          v-model="url"
          type="text"
          autocomplete="off"
          spellcheck="false"
          placeholder="https://example.com 或 #锚点"
        />
      </label>
      <p v-if="error" class="link-error">{{ error }}</p>
    </div>
    <div class="link-dialog-footer">
      <button type="button" class="btn btn-secondary" @click="cancel">取消</button>
      <button type="button" class="btn btn-primary" @click="submit">插入</button>
    </div>
  </div>
</template>

<style scoped lang="less">
.link-dialog {
  box-sizing: border-box;
  width: 440px;
  max-width: calc(100vw - 48px);
  background: var(--background-color-1, #fff);
  color: var(--text-color, #333);
  border: 1px solid var(--border-color-1, #e1e4e8);
  border-radius: 8px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
  overflow: hidden;
}

.link-dialog-header {
  padding: 20px 24px 0;

  h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: var(--text-color, #333);
  }
}

.link-dialog-body {
  padding: 18px 24px 6px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.link-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--text-color-2, #666);

  input {
    box-sizing: border-box;
    width: 100%;
    height: 34px;
    padding: 0 10px;
    border: 1px solid var(--border-color-1, #d9dce1);
    border-radius: 6px;
    background: var(--background-color-2, #f7f8fa);
    color: var(--text-color, #333);
    font-size: 13px;
    outline: none;
    transition:
      border-color 0.15s ease,
      box-shadow 0.15s ease;

    &:focus {
      border-color: var(--primary-color, #3b82f6);
      box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.12);
    }

    &::placeholder {
      color: var(--text-color-3, #9aa0a6);
    }
  }
}

.link-error {
  margin: 0;
  font-size: 12px;
  color: #e53e3e;
}

.link-dialog-footer {
  padding: 8px 24px 20px;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background 0.2s ease,
    opacity 0.2s ease;

  &:active {
    transform: translateY(1px);
  }
}

.btn-secondary {
  background: var(--background-color-2, #f1f3f5);
  color: var(--text-color-3, #666);
  border: 1px solid var(--border-color-1, #e1e4e8);

  &:hover {
    background: var(--hover-background-color, #e9ecef);
    color: var(--text-color, #333);
  }
}

.btn-primary {
  background: var(--primary-color, #3b82f6);
  color: #fff;

  &:hover {
    opacity: 0.88;
  }
}
</style>
