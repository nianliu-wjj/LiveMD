<script setup lang="ts">
/**
 * 导出弹窗（移植自参考项目 web/src/pages/Edit/components/Export.vue）
 *
 * - 监听 showExport 打开弹窗；左侧导出类型取 config 的 downTypeList（去掉引擎不支持的 xlsx、mm），
 *   右侧文件名与各类型选项与参考项目一致：
 *   · smm / json：是否包含主题、结构等配置数据；
 *   · png：图片格式（仅 PNG）、内边距、底部文字、背景透明、完整背景图片；
 *   · pdf：内边距、底部文字、背景透明、完整背景图片；
 *   · svg：内边距、底部文字；
 *   · md / xmind / txt：无选项。
 * - 「导出」与参考项目一样派发 export(type, true, 文件名, ...参数) 后关闭弹窗：根组件 exportFile 调用
 *   mindMap.export(type, false, …) 拿到结果，用 utils 的 saveExportFile 走原生「另存为」（不用 <a download>），
 *   导出期间显示加载遮罩，失败时 autotoast 提示；
 * - 内边距修改与参考项目一样派发 paddingChange（根组件 updateConfig）；
 * - 底部文字：参考项目存进 store，由根组件创建引擎时的 addContentToFooter 读取；本项目根组件没有该选项，
 *   这里在导出前通过 updateConfig 设置 addContentToFooter（同样对之后的其它导出生效，与参考项目一致）。
 *
 * 监听：showExport；派发：export、paddingChange。
 */
import { computed, ref } from "vue";
import { downTypeList } from "../config";
import { useBusEvent, useMindMapContext } from "../context";
import MmDialog from "../ui/MmDialog.vue";
import formatSmm from "../assets/export-format/1.png";
import formatPng from "../assets/export-format/2.png";
import formatSvg from "../assets/export-format/3.png";
import formatPdf from "../assets/export-format/4.png";
import formatMd from "../assets/export-format/5.png";
import formatXmind from "../assets/export-format/6.png";
import formatTxt from "../assets/export-format/7.png";
import formatJson from "../assets/export-format/10.png";

/** 默认导出文件名（参考项目 export.defaultFileName） */
const DEFAULT_FILE_NAME = "思维导图";
/** 引擎默认导出内边距（defaultOptions.exportPaddingX / Y） */
const DEFAULT_EXPORT_PADDING = 10;
/** 导出格式示意图（对应参考项目 assets/img/foramt/*.png 的 typeIcon 背景图） */
const FORMAT_ICON_MAP: Record<string, string> = {
  smm: formatSmm,
  png: formatPng,
  svg: formatSvg,
  pdf: formatPdf,
  md: formatMd,
  xmind: formatXmind,
  txt: formatTxt,
  json: formatJson,
};
/** 底部文字样式（与参考项目 Edit.vue addContentToFooter 的 cssText 一致） */
const FOOTER_CSS_TEXT = `
  .smm-export-footer {
    width: 100%;
    height: 30px;
    display: flex;
    justify-content: center;
    align-items: center;
    font-size: 12px;
    color: #979797;
  }
`;

const { mindMap, bus } = useMindMapContext();

/** 可选导出类型：xlsx 需要额外依赖、mm（FreeMind）引擎不支持，与参考项目一样去掉 */
const typeList = downTypeList.filter((item) => item.type !== "mm" && item.type !== "xlsx");

const dialogVisible = ref(false);
const exportType = ref("smm");
const fileName = ref(DEFAULT_FILE_NAME);
/** 是否包含主题、结构等配置数据（参考项目 widthConfig） */
const withConfig = ref(true);
const isTransparent = ref(false);
// 内边距初始值取引擎当前配置（引擎默认 10，与参考项目初始值一致）
const paddingX = ref<number | string>(
  Number(mindMap.value?.opt.exportPaddingX ?? DEFAULT_EXPORT_PADDING)
);
const paddingY = ref<number | string>(
  Number(mindMap.value?.opt.exportPaddingY ?? DEFAULT_EXPORT_PADDING)
);
/** 底部添加文字 */
const extraText = ref("");
/** 是否显示完整背景图片 */
const isFitBg = ref(true);
/** 图片格式（参考项目只提供 PNG） */
const imageFormat = ref("png");

const currentTypeData = computed(() => typeList.find((item) => item.type === exportType.value));
const formatText = computed(() => (currentTypeData.value ? `.${currentTypeData.value.type}` : ""));
/** 数据文件：可选是否包含配置 */
const isDataType = computed(() => ["smm", "json"].includes(exportType.value));
/** 图形导出：可设置内边距与底部文字 */
const isGraphicType = computed(() => ["svg", "png", "pdf"].includes(exportType.value));
/** 位图导出：可设置背景透明 */
const isBitmapType = computed(() => ["png", "pdf"].includes(exportType.value));
const showFitBgOption = computed(() => isBitmapType.value && !isTransparent.value);
const noOptions = computed(() => ["md", "xmind", "txt", "xlsx", "mm"].includes(exportType.value));

function handleShowExport(): void {
  console.debug("[MindMap/Export] 打开导出弹窗");
  // 打开时由 MmDialog 把焦点移进弹窗（聚焦文件名输入框），按键不会穿透到背后的引擎
  dialogVisible.value = true;
}

function cancel(): void {
  dialogVisible.value = false;
}

/** 内边距输入值 → 非负数（参考项目直接 Number()，非法输入会得到 NaN） */
function toPadding(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

/** 修改导出内边距（参考项目 onPaddingChange） */
function onPaddingChange(): void {
  const exportPaddingX = toPadding(paddingX.value);
  const exportPaddingY = toPadding(paddingY.value);
  paddingX.value = exportPaddingX;
  paddingY.value = exportPaddingY;
  console.debug("[MindMap/Export] 导出内边距:", exportPaddingX, exportPaddingY);
  bus.emit("paddingChange", { exportPaddingX, exportPaddingY });
}

/** 生成底部文字节点（对应参考项目 Edit.vue 的 addContentToFooter） */
function createFooterContent(text: string): { el: HTMLElement; cssText: string; height: number } {
  const el = document.createElement("div");
  el.className = "smm-export-footer";
  // 参考项目用 innerHTML；这里按纯文本写入，避免输入内容被当作 HTML 解析执行
  el.textContent = text;
  return { el, cssText: FOOTER_CSS_TEXT, height: 30 };
}

/** 已设置到引擎的底部文字（未变化时不重复 updateConfig） */
let appliedFooterText = "";

/** 把底部文字设置到引擎（对应参考项目 setExtraTextOnExport；空文字时不追加内容） */
function applyFooterText(text: string): void {
  const footerText = text.trim();
  if (footerText === appliedFooterText) return;
  appliedFooterText = footerText;
  mindMap.value?.updateConfig({
    addContentToFooter: footerText ? () => createFooterContent(footerText) : null,
  });
  console.debug("[MindMap/Export] 导出底部文字:", footerText || "（无）");
}

/** 文件名：去掉 Windows 文件名不允许的字符，为空时使用默认名 */
function normalizeFileName(value: string): string {
  const name = value.trim().replace(/[\\/:*?"<>|]/g, "_");
  return name || DEFAULT_FILE_NAME;
}

/** 导出：参数与参考项目 confirm 一致，交给根组件执行并保存 */
function confirm(): void {
  const type = exportType.value;
  const name = normalizeFileName(fileName.value);
  applyFooterText(extraText.value);
  console.info("[MindMap/Export] 导出:", type, name);
  if (type === "svg") {
    // 参考项目额外传了一段重置 CSS，当前引擎 svg(name) 不接收该参数（富文本重置样式由引擎 resetCss 选项处理）
    bus.emit("export", type, true, name);
  } else if (type === "smm" || type === "json") {
    bus.emit("export", type, true, name, withConfig.value);
  } else if (type === "png") {
    // png(name, transparent, node, fitBg)：node 传 null 表示导出整张图
    bus.emit("export", imageFormat.value, true, name, isTransparent.value, null, isFitBg.value);
  } else if (type === "pdf") {
    bus.emit("export", type, true, name, isTransparent.value, isFitBg.value);
  } else {
    bus.emit("export", type, true, name);
  }
  cancel();
}

useBusEvent("showExport", handleShowExport);
</script>

<template>
  <MmDialog v-model="dialogVisible" class="mm-export-dialog" title="导出" width="800px" hide-footer>
    <div class="mm-export">
      <!-- 导出类型列表 -->
      <div class="mm-export__types">
        <div
          v-for="item in typeList"
          :key="item.type"
          class="mm-export__type"
          :class="{ 'is-active': exportType === item.type }"
          @click="exportType = item.type"
        >
          <img
            class="mm-export__type-icon"
            :src="FORMAT_ICON_MAP[item.type]"
            alt=""
            draggable="false"
          />
          <span class="mm-export__type-name">{{ item.name }}</span>
          <svg
            v-if="exportType === item.type"
            class="mm-export__type-check"
            viewBox="0 0 1024 1024"
            aria-hidden="true"
          >
            <path
              fill="currentColor"
              d="M406.656 706.944 195.84 496.256a32 32 0 1 0-45.248 45.248l256 256 512-512a32 32 0 0 0-45.248-45.248L406.592 706.944z"
            />
          </svg>
        </div>
      </div>

      <!-- 类型内容 -->
      <div class="mm-export__content">
        <!-- 文件名称 -->
        <div class="mm-export__name">
          <span class="mm-export__name-label">导出文件名称</span>
          <input v-model="fileName" class="mm-input mm-export__name-input" />
        </div>

        <!-- 配置 -->
        <div class="mm-export__body">
          <div class="mm-export__row">
            <div class="mm-export__label">格式</div>
            <div class="mm-export__info">{{ formatText }}</div>
          </div>
          <div class="mm-export__row">
            <div class="mm-export__label">说明</div>
            <div class="mm-export__info">{{ currentTypeData?.desc ?? "" }}</div>
          </div>
          <div class="mm-export__row">
            <div class="mm-export__label">选项</div>
            <div v-if="noOptions" class="mm-export__info">无</div>
            <div v-else class="mm-export__options">
              <label
                v-if="isDataType"
                class="mm-export__check"
                :class="{ 'is-checked': withConfig }"
              >
                <input v-model="withConfig" type="checkbox" />
                <span>是否包含主题、结构等配置数据</span>
              </label>
              <template v-if="isGraphicType">
                <div v-if="exportType === 'png'" class="mm-export__option">
                  <span class="mm-export__option-name">格式</span>
                  <div class="mm-segment">
                    <span
                      class="mm-segment__item"
                      :class="{ 'is-active': imageFormat === 'png' }"
                      @click="imageFormat = 'png'"
                    >
                      PNG
                    </span>
                  </div>
                </div>
                <div class="mm-export__option">
                  <span class="mm-export__option-name">水平内边距</span>
                  <input
                    v-model.number="paddingX"
                    type="number"
                    min="0"
                    class="mm-input mm-export__option-input"
                    @change="onPaddingChange"
                  />
                </div>
                <div class="mm-export__option">
                  <span class="mm-export__option-name">垂直内边距</span>
                  <input
                    v-model.number="paddingY"
                    type="number"
                    min="0"
                    class="mm-input mm-export__option-input"
                    @change="onPaddingChange"
                  />
                </div>
                <div class="mm-export__option">
                  <span class="mm-export__option-name">底部添加文字</span>
                  <input
                    v-model="extraText"
                    class="mm-input mm-export__option-input"
                    placeholder="比如：来自 LiveMD"
                  />
                </div>
                <label
                  v-if="isBitmapType"
                  class="mm-export__check"
                  :class="{ 'is-checked': isTransparent }"
                >
                  <input v-model="isTransparent" type="checkbox" />
                  <span>背景是否透明</span>
                </label>
                <label
                  v-if="showFitBgOption"
                  class="mm-export__check"
                  :class="{ 'is-checked': isFitBg }"
                >
                  <input v-model="isFitBg" type="checkbox" />
                  <span>是否显示完整背景图片（使用了背景图片时生效）</span>
                </label>
              </template>
            </div>
          </div>
        </div>

        <!-- 按钮 -->
        <div class="mm-export__footer">
          <button type="button" class="mm-btn mm-btn--small mm-export__btn" @click="cancel">
            取消
          </button>
          <button
            type="button"
            class="mm-btn mm-btn--primary mm-btn--small mm-export__btn"
            @click="confirm"
          >
            导出
          </button>
        </div>
      </div>
    </div>
  </MmDialog>
</template>

<style lang="less" scoped>
/* 弹窗主体去掉内边距，让左侧类型列表贴边（参考项目同样去掉了 el-dialog__body 的内边距） */
.mm-export-dialog :deep(.mm-dialog__body) {
  padding: 0;
}

.mm-export {
  display: flex;
  height: min(552px, calc(100vh - 160px));
  overflow: hidden;
  color: var(--text-color, #333);

  /* 嵌套一层提高优先级，覆盖公共样式 .mindmap-editor .mm-input / .mm-btn--small */
  .mm-export__name-input {
    max-width: 250px;
  }

  .mm-export__option-input {
    width: 200px;
  }

  .mm-export__btn {
    height: 25px;
    padding: 0 30px;
    border-radius: 5px;
  }

  /* 选项区行高 23px 会把单选按钮组撑高，收回到与输入框等高 */
  .mm-segment {
    line-height: 18px;
  }
}

.mm-export__types {
  flex-shrink: 0;
  width: 208px;
  padding: 16px 0;
  overflow-x: hidden;
  overflow-y: auto;
  background: var(--background-color-2, #f2f4f7);
}

.mm-export__type {
  display: flex;
  align-items: center;
  height: 52px;
  padding: 0 30px;
  overflow: hidden;
  cursor: pointer;

  &.is-active {
    background: var(--background-color-1, #fff);
  }
}

.mm-export__type-icon {
  flex-shrink: 0;
  width: 23px;
  height: 26px;
  margin-right: 18px;
  object-fit: cover;
}

.mm-export__type-name {
  min-width: 0;
  overflow: hidden;
  font-size: 15px;
  font-weight: bold;
  color: var(--text-color, #333);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mm-export__type-check {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  margin-left: auto;
  color: var(--primary-color, #409eff);
}

.mm-export__content {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.mm-export__name {
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  height: 67px;
  padding: 16px 20px 0 40px;
  border-bottom: 1px solid var(--border-color-1, #f2f4f7);
  box-sizing: border-box;
}

.mm-export__name-label {
  font-size: 15px;
  font-weight: bold;
  color: var(--text-color, #333);
}

.mm-export__body {
  flex: 1;
  min-height: 0;
  padding: 15px 40px;
  overflow-x: hidden;
  overflow-y: auto;
}

.mm-export__row {
  display: flex;
  margin-bottom: 20px;
  font-size: 14px;

  &:last-child {
    margin-bottom: 0;
  }
}

.mm-export__label {
  flex-shrink: 0;
  min-width: 40px;
  margin-right: 12px;
  font-size: 13px;
  font-weight: 500;
  line-height: 25px;
  color: var(--text-color-3, #808080);
}

.mm-export__info {
  padding: 0 16px;
  border: 1px solid var(--primary-color, rgb(90, 158, 247));
  border-radius: 5px;
  background: color-mix(in srgb, var(--primary-color, rgb(90, 158, 247)) 6%, transparent);
  font-size: 14px;
  font-weight: 500;
  line-height: 23px;
  color: var(--primary-color, rgb(90, 158, 247));
}

.mm-export__options {
  min-width: 0;
  font-size: 14px;
  font-weight: 500;
  line-height: 23px;
  color: var(--text-color-2, #808080);
}

.mm-export__option {
  display: flex;
  align-items: center;
  margin-bottom: 12px;
}

.mm-export__option-name {
  flex-shrink: 0;
  min-width: 85px;
  margin-right: 12px;
}

.mm-export__check {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 12px;
  color: var(--text-color-1, #1a1a1a);
  cursor: pointer;

  input {
    flex-shrink: 0;
    margin: 0;
    accent-color: var(--primary-color, #409eff);
  }

  &.is-checked {
    color: var(--primary-color, #409eff);
  }
}

.mm-export__footer {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  height: 69px;
  padding: 0 40px;
  border-top: 1px solid var(--border-color-1, #f2f4f7);
}

/* 窄屏（参考项目 isMobile 样式）：类型列表横向滚动，选项改为上下排列 */
@media (max-width: 760px) {
  .mm-export {
    flex-direction: column;
    height: auto;
    max-height: calc(100vh - 140px);

    .mm-export__option-input {
      width: 100%;
    }
  }

  .mm-export__types {
    display: flex;
    align-items: center;
    width: 100%;
    height: 60px;
    padding: 0;
    overflow-x: auto;
    overflow-y: hidden;
  }

  .mm-export__type {
    flex-shrink: 0;
    width: 100px;
    padding: 0 5px;
  }

  .mm-export__type-icon {
    margin-right: 5px;
  }

  .mm-export__type-check {
    display: none;
  }

  .mm-export__name {
    height: auto;
    padding: 12px 16px;
  }

  .mm-export__body {
    padding: 15px 16px;
  }

  .mm-export__row {
    flex-direction: column;
  }

  .mm-export__label {
    margin-bottom: 10px;
  }

  .mm-export__option {
    flex-direction: column;
    align-items: flex-start;

    .mm-export__option-name {
      margin-bottom: 5px;
    }
  }

  .mm-export__footer {
    padding: 0 16px;
  }
}
</style>
