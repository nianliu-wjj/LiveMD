<script setup lang="ts">
/**
 * 节点图片弹窗（移植自参考项目 NodeImage.vue）
 *
 * - 总线 showNodeImage 打开，回显第一个激活节点的图片：http(s) 地址放进「方式二」，
 *   其它（data URL 等）放进「方式一」的预览；
 * - 方式一：本地图片（NodeImgUpload：点击选择或拖入），以 data URL 嵌入节点数据，保证 Markdown 文件自包含；
 *   方式二：网络图片地址；两者都填时以方式一为准，都为空则删除图片（与参考项目一致）；
 * - 可选：图片标题、显示尺寸。尺寸留空时按图片原始尺寸设置（显示时受主题最大宽高限制，与参考项目一致）；
 *   填写后以自定义尺寸显示（引擎 imageSize.custom），只填一项时按原图比例计算另一项。
 * 确定后设置到全部激活节点。打开期间暂停引擎快捷键（useNodeDialogGuard）；选完图片后上传区被预览
 * 替换、焦点掉回 body 时的按键由 MmDialog 拦截。
 */
import { ref } from "vue";
import autotoast from "autotoast.js";
import type { MindMapNodeInstance } from "@/core/mindmap-engine/full";
import { useBusEvent, useMindMapContext } from "../context";
import MmDialog from "../ui/MmDialog.vue";
import NodeImgUpload from "./NodeImgUpload.vue";
import { isImeComposing, loadImageSize, type ImageSize } from "./nodeContentUtils";
import { useNodeDialogGuard } from "./useNodeDialogGuard";

/** 读取不到图片尺寸时的默认值（与参考项目一致） */
const DEFAULT_IMAGE_SIZE = 100;

const { activeNodes, isReadonly } = useMindMapContext();

const dialogVisible = ref(false);
const contentRef = ref<HTMLElement | null>(null);
/** 方式一：本地图片（data URL），也用于回显非网络地址的已有图片 */
const img = ref("");
/** 方式二：网络图片地址 */
const imgUrl = ref("");
const imgTitle = ref("");
/** 自定义显示尺寸（v-model.number：清空时为空字符串） */
const customWidth = ref<number | string>("");
const customHeight = ref<number | string>("");
const saving = ref(false);
let nodes: MindMapNodeInstance[] = [...activeNodes.value];

useBusEvent("node_active", (_node: unknown, list: MindMapNodeInstance[] = []) => {
  nodes = [...list];
});

useBusEvent("showNodeImage", () => {
  if (isReadonly.value) {
    console.info("[MindMap/NodeImage] 只读模式，不打开图片弹窗");
    return;
  }
  reset();
  const first = nodes[0];
  if (first) {
    // getImageUrl：NodeBase64ImageStorage 插件下节点数据里存的是 key，这里取真实地址
    const url: string = first.getImageUrl?.() || "";
    if (/^https?:\/\//i.test(url)) imgUrl.value = url;
    else img.value = url;
    imgTitle.value = first.getData("imageTitle") || "";
    const size = first.getData("imageSize");
    if (url && size?.custom) {
      customWidth.value = size.width;
      customHeight.value = size.height;
    }
  }
  dialogVisible.value = true;
  console.debug("[MindMap/NodeImage] 打开图片弹窗，激活节点数:", nodes.length);
});

function reset(): void {
  img.value = "";
  imgUrl.value = "";
  imgTitle.value = "";
  customWidth.value = "";
  customHeight.value = "";
}

function cancel(): void {
  dialogVisible.value = false;
  reset();
}

useNodeDialogGuard(dialogVisible);

/** 计算设置到节点的尺寸：未填自定义尺寸时用原始尺寸，否则按自定义尺寸（缺项按原图比例补齐） */
function resolveImageSize(natural: ImageSize): ImageSize & { custom: boolean } {
  const width = natural.width || DEFAULT_IMAGE_SIZE;
  const height = natural.height || DEFAULT_IMAGE_SIZE;
  const inputWidth = Number(customWidth.value) > 0 ? Number(customWidth.value) : 0;
  const inputHeight = Number(customHeight.value) > 0 ? Number(customHeight.value) : 0;
  if (!inputWidth && !inputHeight) return { width, height, custom: false };
  const ratio = width / height;
  return {
    width: Math.round(inputWidth || inputHeight * ratio),
    height: Math.round(inputHeight || inputWidth / ratio),
    custom: true,
  };
}

async function confirm(): Promise<void> {
  if (saving.value) return;
  const targets = [...nodes];
  const url = img.value || imgUrl.value.trim();
  // 两种方式都为空：删除图片
  if (!url) {
    cancel();
    targets.forEach((node) => node.setImage(null));
    console.info("[MindMap/NodeImage] 已删除节点图片，节点数:", targets.length);
    return;
  }
  saving.value = true;
  try {
    const natural = await loadImageSize(url);
    // 等待读取尺寸期间用户已关闭弹窗：放弃设置
    if (!dialogVisible.value) {
      console.info("[MindMap/NodeImage] 弹窗已关闭，放弃设置图片");
      return;
    }
    if (!natural.width && imgUrl.value && !img.value) {
      console.warn("[MindMap/NodeImage] 网络图片加载失败，使用默认尺寸:", url);
    }
    const size = resolveImageSize(natural);
    const title = imgTitle.value.trim();
    targets.forEach((node) => node.setImage({ url, title, ...size }));
    console.info("[MindMap/NodeImage] 已设置节点图片:", size, "节点数:", targets.length);
    cancel();
  } catch (error) {
    console.error("[MindMap/NodeImage] 设置图片失败:", error);
    autotoast.show("设置图片失败", "error");
  } finally {
    saving.value = false;
  }
}

/** 输入框回车即确定（输入法组字时的回车除外） */
function onEnter(event: KeyboardEvent): void {
  if (isImeComposing(event)) return;
  event.preventDefault();
  void confirm();
}
</script>

<template>
  <!-- 拖放事件在弹窗内截住：避免冒泡到根组件触发「拖入文件导入」遮罩 -->
  <MmDialog
    v-model="dialogVisible"
    title="图片"
    width="600px"
    :confirm-text="saving ? '处理中…' : '确定'"
    @confirm="confirm"
    @cancel="reset"
    @dragenter.stop.prevent
    @dragover.stop.prevent
    @drop.stop.prevent
  >
    <div ref="contentRef" class="node-image" tabindex="-1">
      <div class="node-image__title">方式一</div>
      <NodeImgUpload v-model="img" />

      <div class="node-image__title">方式二</div>
      <div class="mm-row">
        <span class="mm-row__label node-image__label">请输入图片地址</span>
        <input
          v-model="imgUrl"
          class="mm-input"
          placeholder="http://xxx.com/xx.jpg"
          spellcheck="false"
          @keydown.enter="onEnter"
        />
      </div>

      <div class="node-image__title">可选</div>
      <div class="mm-row">
        <span class="mm-row__label node-image__label">图片标题</span>
        <input v-model="imgTitle" class="mm-input" @keydown.enter="onEnter" />
      </div>
      <div class="mm-row">
        <span class="mm-row__label node-image__label">显示尺寸</span>
        <div class="node-image__size">
          <input
            v-model.number="customWidth"
            type="number"
            min="1"
            class="mm-number"
            placeholder="宽（自动）"
          />
          <span>×</span>
          <input
            v-model.number="customHeight"
            type="number"
            min="1"
            class="mm-number"
            placeholder="高（自动）"
          />
          <span>px</span>
        </div>
      </div>
      <p class="node-image__tip">
        尺寸留空时按图片原始尺寸显示（受主题的最大宽高限制），只填一项时按原图比例计算另一项；本地图片会嵌入文档。
      </p>
    </div>
  </MmDialog>
</template>

<style lang="less" scoped>
.node-image {
  // 内容容器可聚焦（tabindex="-1"，焦点元素被移除 / 禁用时的兜底落点），不显示焦点框
  outline: none;
}

.node-image__title {
  margin: 16px 0 10px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color, #333);

  &:first-child {
    margin-top: 0;
  }
}

.node-image__label {
  width: 110px;
}

.node-image__size {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 6px;
  color: var(--text-color-2, #666);

  .mm-number {
    width: 110px;
  }
}

.node-image__tip {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-color-3, #999);
}
</style>
