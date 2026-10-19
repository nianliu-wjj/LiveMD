<script setup lang="ts">
/**
 * 图片设置（Typora 式）
 *
 * - 「插入图片时…」下拉框决定插入动作（复制到 ./assets、当前文件夹、同名 .assets、自定义目录、上传、Base64）
 * - 「对本地位置的图片应用上述规则」/「对网络位置的图片应用上述规则」分别控制拖入本地图片与粘贴网络图片
 * - 「允许根据 YAML 设置自动上传图片」读取 front matter 的 typora-upload-image
 * - 「图片语法偏好」三项：优先相对路径 / 添加 ./ 前缀 / 插入时转义 URL
 */
import { computed } from "vue";
import { Switch } from "@renderer/components/ui/switch";
import Input from "@renderer/components/ui/input/Input.vue";
import Selector from "@renderer/components/ui/selector/Selector.vue";
import { useConfig } from "@/renderer/hooks/useConfig";
import {
  IMAGE_INSERT_ACTION_OPTIONS,
  type ImageInsertAction,
  type ImageInsertConfig,
} from "@/shared/utils/imageInsert";
import UploadConfig from "./UploadConfig.vue";

const { config, setConf } = useConfig();

const imageConfig = computed<ImageInsertConfig>(() => config.value.image);
const insertAction = computed<ImageInsertAction>(() => imageConfig.value.insertAction);
const customDir = computed<string>(() => imageConfig.value.customDir);
const actionItems = IMAGE_INSERT_ACTION_OPTIONS.map((item) => ({ ...item }));

/** 只有"复制到自定义文件夹"才需要填写目录 */
const showCustomDir = computed(() => insertAction.value === "copyToCustomDir");
/** 上传动作需要图床配置 */
const showUploadConfig = computed(() => insertAction.value === "upload");

function setAction(value: string): void {
  setConf("image", "insertAction", value as ImageInsertAction);
}

function setCustomDir(value: string): void {
  setConf("image", "customDir", value.trim());
}

/** 通用布尔项写入 */
function setFlag(key: keyof ImageInsertConfig, value: boolean): void {
  setConf("image", key as string, value);
}

async function handleSelectDirectory(): Promise<void> {
  const result = await window.electronAPI.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
    defaultPath: /^[a-zA-Z]:[\\/]/.test(customDir.value) ? customDir.value : undefined,
  });

  if (!result || result.canceled || result.filePaths.length === 0) return;
  setCustomDir(result.filePaths[0]);
}

/** 动作相关的提示语 */
const actionHint = computed(() => {
  switch (insertAction.value) {
    case "none":
      return "不做特殊处理：粘贴的位图先落在应用临时目录，本地/网络图片保持原地址。";
    case "copyToCurrentDir":
      return "图片会保存到当前 Markdown 文件所在目录，并在文档中写入相对路径。";
    case "copyToAssets":
      return "图片会保存到当前文件目录下的 assets 文件夹，例如 ./assets/image.png。";
    case "copyToFileNameFolder":
      return "图片会保存到以文件名命名的文件夹（demo.md → demo.assets/），便于整篇文档连同图片一起移动。";
    case "copyToCustomDir":
      return "相对路径基于当前文件目录（如 assets/note），绝对路径直接保存到该目录。";
    case "upload":
      return "图片会上传到下方配置的图床，文档中写入返回的图片地址。";
    default:
      return "图片会以 base64 内嵌到文档中，体积会明显增大。";
  }
});
</script>

<template>
  <div class="ImageConfigBox">
    <div class="setting-row">
      <span class="row-label">插入图片时…</span>
      <div class="row-body">
        <Selector
          :model-value="insertAction"
          :items="actionItems"
          class="action-selector"
          @change="setAction"
        />
        <p class="setting-hint">{{ actionHint }}</p>
      </div>
    </div>

    <div v-if="showCustomDir" class="setting-row">
      <span class="row-label">自定义文件夹</span>
      <div class="row-body">
        <div class="path-row">
          <Input
            :model-value="customDir"
            placeholder="如 assets/note 或 D:/Pictures/note"
            @update:model-value="setCustomDir"
          />
          <button type="button" class="action-btn" @click="handleSelectDirectory">选择位置</button>
        </div>
        <p class="setting-hint">相对路径基于当前文件目录；绝对路径会直接保存到指定目录。</p>
      </div>
    </div>

    <div class="setting-row switch-row">
      <div class="row-body">
        <Switch
          :model-value="imageConfig.applyToLocalImages"
          label="对本地位置的图片应用上述规则"
          @update:model-value="(value: boolean) => setFlag('applyToLocalImages', value)"
        />
        <p class="setting-hint">
          拖入磁盘上的图片、或粘贴本地图片路径时，同样按上面的动作复制 / 上传。
        </p>
      </div>
    </div>

    <div class="setting-row switch-row">
      <div class="row-body">
        <Switch
          :model-value="imageConfig.applyToNetworkImages"
          label="对网络位置的图片应用上述规则"
          @update:model-value="(value: boolean) => setFlag('applyToNetworkImages', value)"
        />
        <p class="setting-hint">
          粘贴图片网址或含网络图片的 Markdown 时，先把图片下载到本地再写入文档。
        </p>
      </div>
    </div>

    <div class="setting-row switch-row">
      <div class="row-body">
        <Switch
          :model-value="imageConfig.autoUploadByYaml"
          label="允许根据 YAML 设置自动上传图片"
          @update:model-value="(value: boolean) => setFlag('autoUploadByYaml', value)"
        />
        <p class="setting-hint">
          front matter 中写
          <code>typora-upload-image: true</code> 的文档，插入图片时自动走图床上传。
        </p>
      </div>
    </div>

    <div v-if="showUploadConfig" class="setting-row">
      <span class="row-label">图床配置</span>
      <div class="row-body">
        <UploadConfig />
      </div>
    </div>

    <div class="setting-row">
      <span class="row-label">图片语法偏好</span>
      <div class="row-body grammar-group">
        <Switch
          :model-value="imageConfig.preferRelativePath"
          label="优先使用相对路径"
          @update:model-value="(value: boolean) => setFlag('preferRelativePath', value)"
        />
        <p class="setting-hint">即使保存目录填写的是绝对路径，只要与文档同盘就写成相对路径。</p>

        <Switch
          :model-value="imageConfig.addDotSlashPrefix"
          label="为相对路径添加 ./"
          @update:model-value="(value: boolean) => setFlag('addDotSlashPrefix', value)"
        />
        <p class="setting-hint">写入形如 <code>./assets/image.png</code> 的相对路径。</p>

        <Switch
          :model-value="imageConfig.escapeUrlOnInsert"
          label="插入时自动转义图片 URL"
          @update:model-value="(value: boolean) => setFlag('escapeUrlOnInsert', value)"
        />
        <p class="setting-hint">
          空格转义为 <code>%20</code>、括号转义为
          <code>%28</code>/<code>%29</code>，避免含特殊字符的路径断句。
        </p>
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.ImageConfigBox {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  color: var(--text-color-1);

  .setting-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 0 10px;

    &.switch-row {
      padding-left: 10px;
    }
  }

  .row-label {
    min-width: 100px;
    padding-top: 8px;
    font-size: 14px;
    color: var(--text-color);
    flex-shrink: 0;
  }

  .row-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .action-selector {
    max-width: 420px;
  }

  .path-row {
    display: flex;
    align-items: center;
    gap: 10px;

    .action-btn {
      height: 40px;
      padding: 0 14px;
      border: 1px solid var(--border-color-1);
      border-radius: 4px;
      background: var(--background-color-2);
      color: var(--text-color-1);
      cursor: pointer;
      flex-shrink: 0;

      &:hover {
        border-color: var(--primary-color);
      }
    }
  }

  .grammar-group {
    gap: 10px;

    // 偏好项之间的说明文字跟随各自的开关
    .setting-hint {
      margin-bottom: 6px;
    }
  }

  .setting-hint {
    font-size: 12px;
    line-height: 1.6;
    color: var(--text-color-2);
    white-space: normal;

    code {
      padding: 0 4px;
      border-radius: 3px;
      background: var(--background-color-2);
      color: var(--text-color-1);
      font-size: 12px;
    }
  }
}
</style>
