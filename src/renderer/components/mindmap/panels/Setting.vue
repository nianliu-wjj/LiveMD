<script setup lang="ts">
/**
 * 设置面板（对应参考项目 Setting.vue），面板名 setting
 *
 * - 水印：是否显示 / 仅导出时显示 / 显示在节点下方 / 文字 / 颜色 / 透明度 / 字号 / 旋转角度 / 行间距 / 文字间距，
 *   修改后 300ms 合并一次调用 watermark.updateWatermark 立即生效；水印不随 getData(true) 写回文档，属于引擎选项，
 *   用 setEngineConfig({ watermarkConfig }) 持久化引擎合并后的完整配置（编辑器关闭时防抖中的修改立即保存）；
 * - 引擎选项（性能模式、自由拖拽、实时渲染、一直显示展开按钮、键盘输入进入编辑、连线样式继承、
 *   鼠标滚轮行为与缩放方向、创建新节点的行为、图片与文本间隔、内容间隔）：打开面板时从 mindMap.opt 读取，
 *   修改时 setEngineConfig（立即作用于当前实例并持久化，对应参考项目 updateConfig + storeConfig），
 *   部分选项需要 reRender 才能生效；
 * - 界面偏好（是否显示滚动条、是否允许拖入文件导入）：setLocalConfig，根组件据此加载插件 / 处理拖入；
 * - 节点富文本：切换前确认（会清空历史记录并转换数据），确认后 setLocalConfig，插件由根组件动态加载；
 *   监听 toggleOpenNodeRichText（根组件导入富文本数据时派发）同步勾选状态。
 *
 * 参考项目的「是否开启 AI 功能」不做。
 */
import { onBeforeUnmount, reactive, ref, watch } from "vue";
import MmPanel from "../ui/MmPanel.vue";
import MmDialog from "../ui/MmDialog.vue";
import MmColor from "../ui/MmColor.vue";
import { useBusEvent, useMindMapContext, type MindMapLocalConfig } from "../context";

/** 面板直接修改的引擎选项（默认值与参考项目 data.config 一致，打开面板时以引擎实际值为准） */
interface EngineSettings {
  openPerformance: boolean;
  enableFreeDrag: boolean;
  mousewheelAction: string;
  mousewheelZoomActionReverse: boolean;
  createNewNodeBehavior: string;
  openRealtimeRenderOnNodeTextEdit: boolean;
  alwaysShowExpandBtn: boolean;
  enableAutoEnterTextEditWhenKeydown: boolean;
  imgTextMargin: number;
  textContentMargin: number;
  enableInheritAncestorLineStyle: boolean;
}

interface WatermarkSettings {
  /** 界面状态：是否显示水印（引擎以 text 是否为空判断） */
  show: boolean;
  onlyExport: boolean;
  belowNode: boolean;
  text: string;
  lineSpacing: number;
  textSpacing: number;
  angle: number;
  textStyle: {
    color: string;
    opacity: number;
    fontSize: number;
  };
}

type WatermarkNumberKey = "lineSpacing" | "textSpacing" | "angle" | "fontSize";
type LocalSettingKey = "isShowScrollbar" | "enableDragImport";

/** 修改后需要重新渲染才能生效的选项（与参考项目一致） */
const RERENDER_KEYS: Array<keyof EngineSettings> = [
  "alwaysShowExpandBtn",
  "imgTextMargin",
  "textContentMargin",
  "enableInheritAncestorLineStyle",
];

/** 水印数值输入的范围（对应参考项目 el-input-number 的 min / max） */
const WATERMARK_NUMBER_LIMITS: Record<
  WatermarkNumberKey,
  { min?: number; max?: number; fallback: number }
> = {
  fontSize: { min: 0, max: 50, fallback: 14 },
  angle: { min: 0, max: 90, fallback: 30 },
  lineSpacing: { fallback: 100 },
  textSpacing: { fallback: 100 },
};

/** 打开水印时的默认文字（参考项目 setting.watermarkDefaultText） */
const WATERMARK_DEFAULT_TEXT = "水印文字";

const { mindMap, activeSidebar, localConfig, setLocalConfig, setEngineConfig } =
  useMindMapContext();

const config = reactive<EngineSettings>({
  openPerformance: false,
  enableFreeDrag: false,
  mousewheelAction: "zoom",
  mousewheelZoomActionReverse: false,
  createNewNodeBehavior: "default",
  openRealtimeRenderOnNodeTextEdit: true,
  alwaysShowExpandBtn: false,
  enableAutoEnterTextEditWhenKeydown: true,
  imgTextMargin: 0,
  textContentMargin: 0,
  enableInheritAncestorLineStyle: false,
});

const watermarkConfig = reactive<WatermarkSettings>({
  show: false,
  onlyExport: false,
  belowNode: false,
  text: "",
  lineSpacing: 100,
  textSpacing: 100,
  angle: 30,
  textStyle: { color: "", opacity: 0, fontSize: 1 },
});
let updateWatermarkTimer: ReturnType<typeof setTimeout> | null = null;

/** 富文本勾选状态（确认前先勾上，取消时恢复，对应参考项目 enableNodeRichText） */
const enableNodeRichText = ref(localConfig.openNodeRichText);
const richTextDialogVisible = ref(false);
const richTextDialogTitle = ref("");
/** 确认框打开期间等待生效的富文本开关 */
let pendingRichText: boolean | null = null;

/** 从引擎读取选项（对应参考项目 initConfig） */
function initConfig(): void {
  const opt = mindMap.value?.opt;
  if (!opt) return;
  const target = config as unknown as Record<string, unknown>;
  for (const key of Object.keys(config)) {
    if (opt[key] !== undefined) target[key] = opt[key];
  }
}

/** 从引擎读取水印配置（对应参考项目 initWatermark，补上参考项目漏读的 belowNode） */
function initWatermark(): void {
  const watermark = mindMap.value?.opt.watermarkConfig;
  if (!watermark) return;
  watermarkConfig.text = watermark.text ?? "";
  watermarkConfig.lineSpacing = watermark.lineSpacing ?? 100;
  watermarkConfig.textSpacing = watermark.textSpacing ?? 100;
  watermarkConfig.angle = watermark.angle ?? 30;
  watermarkConfig.onlyExport = Boolean(watermark.onlyExport);
  watermarkConfig.belowNode = Boolean(watermark.belowNode);
  watermarkConfig.show = Boolean(watermark.text);
  watermarkConfig.textStyle = { ...watermarkConfig.textStyle, ...watermark.textStyle };
}

/** 修改引擎选项（对应参考项目 updateOtherConfig） */
function updateOtherConfig<K extends keyof EngineSettings>(key: K, value: EngineSettings[K]): void {
  const instance = mindMap.value;
  if (!instance) return;
  console.info("[MindMap/Setting] 修改引擎选项:", key, value);
  setEngineConfig({ [key]: value });
  if (RERENDER_KEYS.includes(key)) instance.reRender();
}

/** 修改水印（对应参考项目 updateWatermarkConfig：300ms 内的连续修改合并为一次） */
function updateWatermarkConfig(): void {
  if (updateWatermarkTimer) clearTimeout(updateWatermarkTimer);
  updateWatermarkTimer = setTimeout(() => {
    updateWatermarkTimer = null;
    flushWatermarkConfig();
  }, 300);
}

/**
 * 应用并持久化水印配置
 *
 * 水印不随 getData(true) 写回文档，属于引擎选项：updateWatermark 立即重绘，setEngineConfig 持久化
 * （之后打开的思维导图同样生效）。Watermark.handleConfig 只读取本次传入的配置，所以每次都传完整的一组。
 * 引擎已销毁时（编辑器关闭：根组件先于子组件销毁引擎）只持久化面板里的配置，下次打开时生效。
 */
function flushWatermarkConfig(): void {
  const { onlyExport, belowNode, text, lineSpacing, textSpacing, angle, textStyle } =
    watermarkConfig;
  const config = {
    onlyExport,
    belowNode,
    text,
    lineSpacing,
    textSpacing,
    angle,
    textStyle: { ...textStyle },
  };
  const instance = mindMap.value;
  if (instance?.watermark) {
    instance.watermark.updateWatermark(config);
    // 持久化引擎合并后的完整水印配置（深拷贝，避免与引擎内部对象共用引用）
    setEngineConfig({ watermarkConfig: JSON.parse(JSON.stringify(instance.opt.watermarkConfig)) });
    console.info("[MindMap/Setting] 水印已更新，显示:", Boolean(text));
  } else {
    setEngineConfig({ watermarkConfig: config });
    console.warn("[MindMap/Setting] 引擎或水印插件不可用，水印配置仅保存，下次打开时生效");
  }
}

/** 切换是否显示水印（对应参考项目 watermarkShowChange） */
function watermarkShowChange(): void {
  watermarkConfig.text = watermarkConfig.show ? watermarkConfig.text || WATERMARK_DEFAULT_TEXT : "";
  updateWatermarkConfig();
}

function onWatermarkColorChange(color: string): void {
  watermarkConfig.textStyle.color = color;
  updateWatermarkConfig();
}

/** 水印数值输入：非数字恢复默认值，并限制在范围内（原生数字框不会像 el-input-number 那样自动限制） */
function onWatermarkNumberChange(key: WatermarkNumberKey): void {
  const limit = WATERMARK_NUMBER_LIMITS[key];
  const raw = key === "fontSize" ? watermarkConfig.textStyle.fontSize : watermarkConfig[key];
  let value = Number(raw);
  if (!Number.isFinite(value)) value = limit.fallback;
  if (limit.min !== undefined) value = Math.max(limit.min, value);
  if (limit.max !== undefined) value = Math.min(limit.max, value);
  if (key === "fontSize") {
    watermarkConfig.textStyle.fontSize = value;
  } else {
    watermarkConfig[key] = value;
  }
  updateWatermarkConfig();
}

/** 切换节点富文本：先确认（对应参考项目 enableNodeRichTextChange 中的 $confirm） */
function enableNodeRichTextChange(): void {
  pendingRichText = enableNodeRichText.value;
  richTextDialogTitle.value = pendingRichText
    ? "是否切换为富文本模式？"
    : "是否切换为非富文本模式？";
  richTextDialogVisible.value = true;
}

function onRichTextConfirm(): void {
  const value = pendingRichText;
  pendingRichText = null;
  richTextDialogVisible.value = false;
  if (value === null) return;
  try {
    mindMap.value?.renderer.textEdit.hideEditTextBox();
  } catch (error) {
    console.warn("[MindMap/Setting] 结束文字编辑失败:", error);
  }
  console.info("[MindMap/Setting] 节点富文本:", value ? "开启" : "关闭");
  setLocalConfig({ openNodeRichText: value });
}

/** 取消 / 关闭确认框：恢复勾选状态（对应参考项目 catch 分支） */
function onRichTextCancel(): void {
  pendingRichText = null;
  enableNodeRichText.value = localConfig.openNodeRichText;
}

/** 界面偏好（对应参考项目 updateLocalConfig） */
function updateLocalConfig(key: LocalSettingKey, event: Event): void {
  const value = (event.target as HTMLInputElement).checked;
  console.info("[MindMap/Setting] 修改界面偏好:", key, value);
  setLocalConfig({ [key]: value } as Partial<MindMapLocalConfig>);
}

watch(
  activeSidebar,
  (value) => {
    if (value !== "setting") return;
    initConfig();
    initWatermark();
  },
  { immediate: true }
);

// 其它途径（根组件自动开启等）修改了富文本偏好：确认框未打开时同步勾选状态
watch(
  () => localConfig.openNodeRichText,
  (value) => {
    if (pendingRichText === null) enableNodeRichText.value = value;
  }
);

// 根组件导入富文本数据时派发（对应参考项目 onToggleOpenNodeRichText）
useBusEvent("toggleOpenNodeRichText", (value: boolean) => {
  if (localConfig.openNodeRichText !== value) setLocalConfig({ openNodeRichText: value });
  enableNodeRichText.value = value;
});

onBeforeUnmount(() => {
  if (!updateWatermarkTimer) return;
  // 防抖期间关闭了编辑器（改完水印立即退出）：立即保存，避免这次修改丢失
  clearTimeout(updateWatermarkTimer);
  updateWatermarkTimer = null;
  flushWatermarkConfig();
});
</script>

<template>
  <MmPanel name="setting" title="设置">
    <div class="mm-setting">
      <!-- 水印 -->
      <label class="mm-setting__check">
        <input v-model="watermarkConfig.show" type="checkbox" @change="watermarkShowChange" />
        <span>是否显示水印</span>
      </label>
      <template v-if="watermarkConfig.show">
        <label class="mm-setting__check">
          <input
            v-model="watermarkConfig.onlyExport"
            type="checkbox"
            @change="updateWatermarkConfig"
          />
          <span>是否仅在导出时显示</span>
        </label>
        <label class="mm-setting__check">
          <input
            v-model="watermarkConfig.belowNode"
            type="checkbox"
            @change="updateWatermarkConfig"
          />
          <span>显示在节点下方</span>
        </label>
        <div class="mm-row">
          <span class="mm-row__label">水印文字</span>
          <div class="mm-row__control mm-setting__grow">
            <input
              v-model="watermarkConfig.text"
              class="mm-input"
              type="text"
              @change="updateWatermarkConfig"
            />
          </div>
        </div>
        <div class="mm-row">
          <span class="mm-row__label">文字颜色</span>
          <div class="mm-row__control">
            <MmColor
              :model-value="watermarkConfig.textStyle.color"
              @update:model-value="onWatermarkColorChange"
            />
          </div>
        </div>
        <div class="mm-row">
          <span class="mm-row__label">文字透明度</span>
          <div class="mm-row__control">
            <input
              v-model.number="watermarkConfig.textStyle.opacity"
              class="mm-setting__range"
              type="range"
              min="0"
              max="1"
              step="0.1"
              @change="updateWatermarkConfig"
            />
            <span class="mm-setting__value">{{ watermarkConfig.textStyle.opacity }}</span>
          </div>
        </div>
        <div class="mm-row">
          <span class="mm-row__label">文字字号</span>
          <div class="mm-row__control">
            <input
              v-model.number="watermarkConfig.textStyle.fontSize"
              class="mm-number"
              type="number"
              min="0"
              max="50"
              step="1"
              @change="onWatermarkNumberChange('fontSize')"
            />
          </div>
        </div>
        <div class="mm-row">
          <span class="mm-row__label">旋转角度</span>
          <div class="mm-row__control">
            <input
              v-model.number="watermarkConfig.angle"
              class="mm-number"
              type="number"
              min="0"
              max="90"
              step="10"
              @change="onWatermarkNumberChange('angle')"
            />
          </div>
        </div>
        <div class="mm-row">
          <span class="mm-row__label">水印行间距</span>
          <div class="mm-row__control">
            <input
              v-model.number="watermarkConfig.lineSpacing"
              class="mm-number"
              type="number"
              step="10"
              @change="onWatermarkNumberChange('lineSpacing')"
            />
          </div>
        </div>
        <div class="mm-row">
          <span class="mm-row__label">水印文字间距</span>
          <div class="mm-row__control">
            <input
              v-model.number="watermarkConfig.textSpacing"
              class="mm-number"
              type="number"
              step="10"
              @change="onWatermarkNumberChange('textSpacing')"
            />
          </div>
        </div>
      </template>

      <!-- 引擎选项与界面偏好（顺序与参考项目一致） -->
      <label class="mm-setting__check">
        <input
          v-model="config.openPerformance"
          type="checkbox"
          @change="updateOtherConfig('openPerformance', config.openPerformance)"
        />
        <span>开启性能模式(Beta)</span>
      </label>
      <label class="mm-setting__check">
        <input
          v-model="config.enableFreeDrag"
          type="checkbox"
          @change="updateOtherConfig('enableFreeDrag', config.enableFreeDrag)"
        />
        <span>是否开启节点自由拖拽</span>
      </label>
      <label class="mm-setting__check">
        <input v-model="enableNodeRichText" type="checkbox" @change="enableNodeRichTextChange" />
        <span>是否开启节点富文本编辑</span>
      </label>
      <label class="mm-setting__check">
        <input
          v-model="config.openRealtimeRenderOnNodeTextEdit"
          type="checkbox"
          @change="
            updateOtherConfig(
              'openRealtimeRenderOnNodeTextEdit',
              config.openRealtimeRenderOnNodeTextEdit
            )
          "
        />
        <span>开启文本编辑实时渲染效果</span>
      </label>
      <label class="mm-setting__check">
        <input
          :checked="localConfig.isShowScrollbar"
          type="checkbox"
          @change="updateLocalConfig('isShowScrollbar', $event)"
        />
        <span>是否显示滚动条</span>
      </label>
      <label class="mm-setting__check">
        <input
          v-model="config.alwaysShowExpandBtn"
          type="checkbox"
          @change="updateOtherConfig('alwaysShowExpandBtn', config.alwaysShowExpandBtn)"
        />
        <span>是否一直显示展开收起按钮</span>
      </label>
      <label class="mm-setting__check">
        <input
          v-model="config.enableAutoEnterTextEditWhenKeydown"
          type="checkbox"
          @change="
            updateOtherConfig(
              'enableAutoEnterTextEditWhenKeydown',
              config.enableAutoEnterTextEditWhenKeydown
            )
          "
        />
        <span>键盘输入时自动进入文本编辑</span>
      </label>
      <label class="mm-setting__check">
        <input
          :checked="localConfig.enableDragImport"
          type="checkbox"
          @change="updateLocalConfig('enableDragImport', $event)"
        />
        <span>是否允许直接拖拽文件到页面进行导入</span>
      </label>
      <label class="mm-setting__check">
        <input
          v-model="config.enableInheritAncestorLineStyle"
          type="checkbox"
          @change="
            updateOtherConfig(
              'enableInheritAncestorLineStyle',
              config.enableInheritAncestorLineStyle
            )
          "
        />
        <span>节点连线样式继承祖先节点的样式</span>
      </label>

      <div class="mm-row">
        <span class="mm-row__label">鼠标滚轮行为</span>
        <div class="mm-row__control">
          <select
            v-model="config.mousewheelAction"
            class="mm-select"
            @change="updateOtherConfig('mousewheelAction', config.mousewheelAction)"
          >
            <option value="zoom">缩放视图</option>
            <option value="move">上下移动视图</option>
          </select>
        </div>
      </div>
      <div v-if="config.mousewheelAction === 'zoom'" class="mm-row">
        <span class="mm-row__label">鼠标滚轮缩放</span>
        <div class="mm-row__control">
          <select
            v-model="config.mousewheelZoomActionReverse"
            class="mm-select"
            @change="
              updateOtherConfig('mousewheelZoomActionReverse', config.mousewheelZoomActionReverse)
            "
          >
            <option :value="false">向前缩小向后放大</option>
            <option :value="true">向前放大向后缩小</option>
          </select>
        </div>
      </div>
      <div class="mm-row">
        <span class="mm-row__label">创建新节点的行为</span>
        <div class="mm-row__control">
          <select
            v-model="config.createNewNodeBehavior"
            class="mm-select"
            @change="updateOtherConfig('createNewNodeBehavior', config.createNewNodeBehavior)"
          >
            <option value="default">激活新节点及进入编辑</option>
            <option value="notActive">不激活新节点</option>
            <option value="activeOnly">只激活新节点，不进入编辑</option>
          </select>
        </div>
      </div>
      <div class="mm-row">
        <span class="mm-row__label">节点图片和文本间隔</span>
        <div class="mm-row__control">
          <input
            v-model.number="config.imgTextMargin"
            class="mm-setting__range"
            type="range"
            min="0"
            max="100"
            step="1"
            @change="updateOtherConfig('imgTextMargin', config.imgTextMargin)"
          />
          <span class="mm-setting__value">{{ config.imgTextMargin }}</span>
        </div>
      </div>
      <div class="mm-row">
        <span class="mm-row__label">节点各种内容间隔</span>
        <div class="mm-row__control">
          <input
            v-model.number="config.textContentMargin"
            class="mm-setting__range"
            type="range"
            min="0"
            max="100"
            step="1"
            @change="updateOtherConfig('textContentMargin', config.textContentMargin)"
          />
          <span class="mm-setting__value">{{ config.textContentMargin }}</span>
        </div>
      </div>
    </div>
  </MmPanel>

  <!-- 放在面板外：面板是定位元素，放在里面时遮罩只能盖住面板 -->
  <MmDialog
    v-model="richTextDialogVisible"
    :title="richTextDialogTitle"
    width="420px"
    @confirm="onRichTextConfirm"
    @cancel="onRichTextCancel"
  >
    <p class="mm-setting__tip">该操作会清空所有历史修改记录，并且修改思维导图数据，是否继续？</p>
  </MmDialog>
</template>

<style lang="less" scoped>
.mm-setting__check {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 13px;
  line-height: 18px;
  color: var(--text-color-1, #333);
  cursor: pointer;

  input {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    margin: 2px 0 0;
    accent-color: var(--primary-color, #409eff);
    cursor: pointer;
  }
}

.mm-setting__grow {
  flex: 1;
}

.mm-setting__range {
  width: 130px;
  accent-color: var(--primary-color, #409eff);
  cursor: pointer;
}

.mm-setting__value {
  min-width: 26px;
  font-size: 12px;
  text-align: right;
  color: var(--text-color-2, #666);
}

.mm-setting__tip {
  margin: 0;
  line-height: 1.7;
}
</style>
