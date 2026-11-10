<script setup lang="ts">
/**
 * 导入弹窗（移植自参考项目 web/src/pages/Edit/components/Import.vue）
 *
 * - 监听 showImport 打开弹窗；监听 importFile 直接导入指定文件（根组件拖入文件、工具栏「打开」都走这里）；
 * - 支持 .smm / .json（思绪文件 / JSON）、.xmind（新版 content.json 与 XMind 8 的 content.xml）、
 *   .md（按标题 / 列表层级转换）；.xlsx 需要额外依赖，不支持；
 *   参考项目从地址栏参数 fileURL 打开文件（handle_file_url）在本场景不适用，未移植；
 * - 解析结果通过 setData 交给根组件载入：带 root 的完整数据会同时替换结构 / 主题，只有节点树时只替换节点；
 * - XMind 文件包含多个画布时弹出画布选择框（与参考项目一致）。
 *
 * 监听：showImport、importFile；派发：setData；导入后收起右侧面板（setActiveSidebar(null)，与参考项目一致）。
 */
import { onBeforeUnmount, ref, watch } from "vue";
import autotoast from "autotoast.js";
import MindMap from "@/core/mindmap-engine/full.js";
import { useBusEvent, useMindMapContext } from "../context";
import { pickFile, readFileAsText } from "../utils";
import MmDialog from "../ui/MmDialog.vue";

/** XMind content.json 里的一个画布（界面只用到标题） */
interface XmindSheet {
  title?: string;
  [key: string]: unknown;
}

/** 支持的文件类型（参考项目 supportFileStr） */
const SUPPORT_FILE_STR = ".smm,.json,.xmind,.md";
const SUPPORT_FILE_REG = /\.(smm|json|xmind|md)$/i;
/** 用户关闭画布选择框时用来中断 XMind 解析的标记（据此区分「取消」与「解析失败」） */
const CANVAS_SELECT_CANCELED = Symbol("xmindCanvasSelectCanceled");

const { bus, setActiveSidebar } = useMindMapContext();

const dialogVisible = ref(false);
/** 「选取文件」按钮（移除已选文件时把焦点交给它，见 onRemove） */
const selectBtnRef = ref<HTMLButtonElement | null>(null);
/** 已选择的文件（与参考项目 el-upload 一致，最多一个） */
const fileList = ref<File[]>([]);
const xmindCanvasSelectDialogVisible = ref(false);
const canvasList = ref<XmindSheet[]>([]);
const selectCanvas = ref(0);
/** 等待用户选择画布的 Promise 回调（参考项目 selectPromiseResolve，这里额外保留 reject 以便取消） */
let pendingCanvasSelect: {
  resolve: (sheet: XmindSheet) => void;
  reject: (reason: unknown) => void;
} | null = null;

// 弹窗关闭后清空已选文件（参考项目 watch dialogVisible）
watch(dialogVisible, (visible, oldVisible) => {
  if (!visible && oldVisible) fileList.value = [];
});

function handleShowImport(): void {
  console.debug("[MindMap/Import] 打开导入弹窗");
  // 打开时由 MmDialog 把焦点移进弹窗（工具栏按钮不抢焦点，焦点留在 body 时按键会穿透到引擎）
  dialogVisible.value = true;
}

/** 取扩展名（小写） */
function getFileExt(fileName: string): string {
  return SUPPORT_FILE_REG.exec(fileName)?.[1].toLowerCase() ?? "";
}

/** 校验文件类型（参考项目 onChange 中的校验） */
function checkFileType(file: File): boolean {
  if (SUPPORT_FILE_REG.test(file.name)) return true;
  console.warn("[MindMap/Import] 不支持的文件类型:", file.name);
  autotoast.show(`请选择${SUPPORT_FILE_STR}文件`, "error");
  return false;
}

/** 「选取文件」：与参考项目 el-upload（limit=1）一致，已有文件时提示先移除 */
async function selectFile(): Promise<void> {
  const file = await pickFile(SUPPORT_FILE_STR);
  if (!file) return;
  if (fileList.value.length >= 1) {
    autotoast.show("最多只能选择一个文件", "error");
    return;
  }
  if (!checkFileType(file)) {
    fileList.value = [];
    return;
  }
  console.info("[MindMap/Import] 已选择文件:", file.name);
  fileList.value = [file];
}

/** 移除已选文件（参考项目 onRemove） */
function onRemove(index: number): void {
  // 「移除」按钮会随列表一起消失，焦点随之掉回 body，之后的按键会穿透到弹窗背后的引擎
  // （Delete 删除节点、按字母自动进入节点文字编辑等）：移除前先把焦点交给「选取文件」
  selectBtnRef.value?.focus();
  fileList.value = fileList.value.filter((_, i) => i !== index);
}

function cancel(): void {
  dialogVisible.value = false;
}

/** 确定：按扩展名分发解析，随后关闭弹窗并收起右侧面板（与参考项目一致，解析在后台继续） */
function confirm(): void {
  const file = fileList.value[0];
  if (!file) {
    autotoast.show("请选择要导入的文件", "error");
    return;
  }
  const ext = getFileExt(file.name);
  console.info("[MindMap/Import] 开始导入:", file.name);
  if (ext === "smm" || ext === "json") {
    void handleSmm(file);
  } else if (ext === "xmind") {
    void handleXmind(file);
  } else if (ext === "md") {
    void handleMd(file);
  }
  // 显式清空：经 importFile 导入时弹窗本就是关闭的，上面的 watch 不会触发，文件会残留到下次打开弹窗
  fileList.value = [];
  cancel();
  setActiveSidebar(null);
}

/** 是否为可载入的思维导图数据：完整数据（含 root 节点树）或单独的节点树（含 data） */
function isMindMapData(data: unknown): data is Record<string, any> {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const record = data as Record<string, any>;
  return Boolean(record.root?.data || record.data);
}

/** 解析成功：交给根组件载入 */
function applyData(data: unknown, fileName: string): void {
  bus.emit("setData", data);
  console.info("[MindMap/Import] 导入成功:", fileName);
  autotoast.show("导入成功", "success");
}

/** 处理 .smm / .json 文件 */
async function handleSmm(file: File): Promise<void> {
  try {
    const data: unknown = JSON.parse(await readFileAsText(file));
    if (!isMindMapData(data)) throw new Error("文件内容有误");
    applyData(data, file.name);
  } catch (error) {
    console.error("[MindMap/Import] 解析 .smm / .json 失败:", error);
    autotoast.show("文件解析失败", "error");
  }
}

/** 处理 .xmind 文件（多画布时先让用户选择画布） */
async function handleXmind(file: File): Promise<void> {
  try {
    const data = await MindMap.xmind.parseXmindFile(file, (content: XmindSheet[]) =>
      showSelectXmindCanvasDialog(content)
    );
    if (!isMindMapData(data)) throw new Error("文件内容有误");
    applyData(data, file.name);
  } catch (error) {
    if (error === CANVAS_SELECT_CANCELED) {
      console.info("[MindMap/Import] 未选择 XMind 画布，已取消导入:", file.name);
      return;
    }
    console.error("[MindMap/Import] 解析 .xmind 失败:", error);
    autotoast.show("文件解析失败", "error");
  }
}

/** 显示 XMind 多画布选择框，返回用户选择的画布（引擎解析器的 handleMultiCanvas 回调） */
function showSelectXmindCanvasDialog(content: XmindSheet[]): Promise<XmindSheet> {
  // 上一次的选择还没完成就开始了新的导入：先取消旧的，避免其 Promise 永远挂起
  pendingCanvasSelect?.reject(CANVAS_SELECT_CANCELED);
  console.info("[MindMap/Import] XMind 文件包含多个画布:", content.length);
  canvasList.value = content;
  // 默认选中第一个画布：MmDialog 打开时聚焦第一个单选框，正好是选中项，可直接用方向键切换、Esc 取消
  selectCanvas.value = 0;
  xmindCanvasSelectDialogVisible.value = true;
  return new Promise((resolve, reject) => {
    pendingCanvasSelect = { resolve, reject };
  });
}

/** 画布显示名（XMind 画布一般都有标题，缺失时按序号兜底） */
function getCanvasTitle(sheet: XmindSheet, index: number): string {
  return sheet.title || `画布 ${index + 1}`;
}

function resetCanvasSelect(): void {
  xmindCanvasSelectDialogVisible.value = false;
  canvasList.value = [];
  selectCanvas.value = 0;
  pendingCanvasSelect = null;
}

/** 确认导入选中的画布（参考项目 confirmSelect） */
function confirmSelect(): void {
  const sheet = canvasList.value[selectCanvas.value];
  console.info("[MindMap/Import] 选择 XMind 画布:", selectCanvas.value, sheet?.title ?? "");
  pendingCanvasSelect?.resolve(sheet);
  resetCanvasSelect();
}

/**
 * 关闭画布选择框（× / 遮罩 / Esc）：放弃本次导入
 * 参考项目的选择框不显示关闭按钮，但点遮罩或 Esc 关闭后 Promise 会一直挂起；这里明确中断解析
 */
function cancelSelect(): void {
  pendingCanvasSelect?.reject(CANVAS_SELECT_CANCELED);
  resetCanvasSelect();
}

/** 处理 .md 文件（引擎按标题 / 列表层级转换为节点树，取第一棵树） */
async function handleMd(file: File): Promise<void> {
  try {
    const data = MindMap.markdown.transformMarkdownTo(await readFileAsText(file));
    // 文档里没有标题和列表时转换结果为空，不能交给根组件载入
    if (!isMindMapData(data)) throw new Error("Markdown 中没有可转换为节点的标题或列表");
    applyData(data, file.name);
  } catch (error) {
    console.error("[MindMap/Import] 解析 .md 失败:", error);
    autotoast.show("文件解析失败", "error");
  }
}

/** 直接导入指定文件（参考项目 handleImportFile：校验通过后等同于选择该文件并点击确定） */
function handleImportFile(file: File | null | undefined): void {
  if (!file) return;
  console.info("[MindMap/Import] 导入指定文件:", file.name);
  if (!checkFileType(file)) {
    fileList.value = [];
    return;
  }
  // 直接替换为该文件（参考项目这里 push，弹窗里已选过文件时会误导入旧文件）
  fileList.value = [file];
  confirm();
}

useBusEvent("showImport", handleShowImport);
useBusEvent("importFile", handleImportFile);

onBeforeUnmount(() => {
  // 编辑器关闭时仍在等待选择画布：中断解析，避免 Promise 挂起
  pendingCanvasSelect?.reject(CANVAS_SELECT_CANCELED);
  pendingCanvasSelect = null;
});
</script>

<template>
  <div class="mm-import-dialogs">
    <MmDialog v-model="dialogVisible" title="导入" width="350px" @confirm="confirm">
      <div class="mm-import">
        <button
          ref="selectBtnRef"
          type="button"
          class="mm-btn mm-btn--primary mm-btn--small"
          @click="selectFile"
        >
          选取文件
        </button>
        <div class="mm-import__tip">支持{{ SUPPORT_FILE_STR }}文件</div>
        <ul v-if="fileList.length > 0" class="mm-import__files">
          <li
            v-for="(file, index) in fileList"
            :key="`${file.name}-${index}`"
            class="mm-import__file"
          >
            <span class="mm-import__file-icon mm-iconfont iconwenjian1" />
            <span class="mm-import__file-name" :title="file.name">{{ file.name }}</span>
            <button
              type="button"
              class="mm-import__file-remove"
              title="移除"
              @click="onRemove(index)"
            >
              ×
            </button>
          </li>
        </ul>
      </div>
    </MmDialog>

    <!-- XMind 多画布选择 -->
    <MmDialog
      v-model="xmindCanvasSelectDialogVisible"
      title="选择要导入的画布"
      width="300px"
      @cancel="cancelSelect"
    >
      <div class="mm-import__canvas-list">
        <label v-for="(item, index) in canvasList" :key="index" class="mm-import__canvas">
          <input v-model="selectCanvas" type="radio" name="mm-xmind-canvas" :value="index" />
          <span class="mm-import__canvas-title">{{ getCanvasTitle(item, index) }}</span>
        </label>
      </div>
      <template #footer>
        <button type="button" class="mm-btn mm-btn--primary" @click="confirmSelect">确定</button>
      </template>
    </MmDialog>
  </div>
</template>

<style lang="less" scoped>
.mm-import__tip {
  margin-top: 7px;
  font-size: 12px;
  color: var(--text-color-2, #606266);
}

.mm-import__files {
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
}

.mm-import__file {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 4px;
  font-size: 13px;
  color: var(--text-color-1, #606266);

  &:hover {
    background: var(--hover-background-color, #f5f7fa);
    color: var(--primary-color, #409eff);

    .mm-import__file-remove {
      opacity: 1;
    }
  }
}

.mm-import__file-icon {
  flex-shrink: 0;
  font-size: 14px;
  color: var(--text-color-3, #909399);
}

.mm-import__file-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mm-import__file-remove {
  flex-shrink: 0;
  padding: 0 2px;
  border: none;
  background: transparent;
  color: var(--text-color-3, #909399);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;

  &:hover {
    color: var(--primary-color, #409eff);
  }

  &:focus-visible {
    opacity: 1;
  }
}

.mm-import__canvas-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mm-import__canvas {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--text-color-1, #606266);
  cursor: pointer;

  input {
    flex-shrink: 0;
    margin: 0;
    accent-color: var(--primary-color, #409eff);
  }
}

.mm-import__canvas-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
