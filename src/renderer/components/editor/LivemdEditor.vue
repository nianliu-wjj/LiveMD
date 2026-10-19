<script setup lang="ts">
/**
 * Livemd 编辑器 Vue 组件
 * 基于自研 ProseMirror 内核的即时渲染 Markdown 编辑器
 * 每个 tab 拥有独立的编辑器实例（v-for + v-show 模式）
 */
import type { Tab } from "@/types/tab";
import { computed, ref, onMounted, onUnmounted, watch, nextTick } from "vue";
import {
  LivemdEditor,
  createLivemdEditor,
  type LivemdConfig,
  getImagePasteMethod,
  setGlobalMermaidDefaultMode,
} from "@/core";
import { undo, redo } from "prosemirror-history";
import { uploadImage } from "@/renderer/services/api";
import useEditorZoom from "@/renderer/hooks/useEditorZoom";
import useReadOnlyMode from "@/renderer/hooks/useReadOnlyMode";
import {
  formatInsertedImagePath,
  isCopyAction,
  parseImageYamlOverrides,
  resolveImageSaveTarget,
  toCorePasteMethod,
  type ImageSaveTarget,
} from "@/shared/utils/imageInsert";
import useBookmarks from "@/renderer/hooks/useBookmarks";
import useTab from "@/renderer/hooks/useTab";
import { useConfig } from "@/renderer/hooks/useConfig";
import useUiLoading from "@/renderer/hooks/useUiLoading";
import useAnnotations from "@/renderer/hooks/useAnnotations";
import { annotationDocKey, type AnnotationEntry } from "@/shared/utils/annotations";
import LoadingIcon from "@/renderer/components/ui/LoadingIcon.vue";
import InsertLinkDialog from "@/renderer/components/dialogs/InsertLinkDialog.vue";
import emitter from "@/renderer/events";
import autodialog from "autodialog.js";
import autotoast from "autotoast.js";
import "@/core/styles/livemd.css";
import { normalizeMarkdownForDirtyCheck } from "@/renderer/utils/markdown";
import { getFoldForDoc, migrateFoldDocKey, setFoldForDoc } from "@/renderer/utils/foldStates";
import useAppCommands from "@/renderer/hooks/useAppCommands";

interface Props {
  tab: Tab;
  isActive: boolean;
}

const props = defineProps<Props>();
const { contentStyleFor } = useEditorZoom();
const editorContentStyle = computed(() => contentStyleFor(props.tab));

const LARGE_DOCUMENT_CHAR_THRESHOLD = 200_000;
const LARGE_DOCUMENT_LINE_THRESHOLD = 4_000;

const { config: appConfig, watchConf } = useConfig();
const { isReadOnlyMode } = useReadOnlyMode();
/** 有效只读态 = 文件系统只读（tab.readOnly）∪ 状态栏开启的只读模式 */
const effectiveReadOnly = computed(() => Boolean(props.tab.readOnly) || isReadOnlyMode.value);
const { nextFrame } = useUiLoading();

// 初始化 mermaid 默认显示模式
setGlobalMermaidDefaultMode(appConfig.value.mermaid?.defaultDisplayMode || "diagram");
watchConf("mermaid", (val) => {
  setGlobalMermaidDefaultMode(val?.defaultDisplayMode || "diagram");
});

const containerRef = ref<HTMLElement | null>(null);
const scrollViewRef = ref<HTMLElement | null>(null);
const isEditorInitializing = ref(false);
const isLargeDocument = computed(() => {
  const content = props.tab.content || "";
  if (content.length >= LARGE_DOCUMENT_CHAR_THRESHOLD) return true;

  let lineCount = 1;
  for (let index = 0; index < content.length; index++) {
    if (content.charCodeAt(index) === 10) {
      lineCount++;
      if (lineCount >= LARGE_DOCUMENT_LINE_THRESHOLD) return true;
    }
  }

  return false;
});

function isLargeMarkdown(content: string): boolean {
  if (content.length >= LARGE_DOCUMENT_CHAR_THRESHOLD) return true;

  let lineCount = 1;
  for (let index = 0; index < content.length; index++) {
    if (content.charCodeAt(index) === 10) {
      lineCount++;
      if (lineCount >= LARGE_DOCUMENT_LINE_THRESHOLD) return true;
    }
  }

  return false;
}

function getFileNameFromPath(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || "Untitled";
}

/** 当前文档 YAML front matter 中的图片覆盖项（typora-copy-images-to / typora-upload-image） */
function currentImageYamlOverrides() {
  const markdown = editor?.getMarkdown() ?? props.tab.content ?? "";
  return parseImageYamlOverrides(markdown);
}

/** 文档 YAML 要求自动上传（且设置里允许）时，插入图片走图床上传 */
function shouldUploadByYaml(): boolean {
  if (!appConfig.value.image.autoUploadByYaml) return false;
  return Boolean(currentImageYamlOverrides().uploadImage);
}

/** 当前应使用的 core 粘贴方式（含 YAML 上传覆盖） */
function resolvePasteMethod() {
  return toCorePasteMethod(appConfig.value.image, shouldUploadByYaml());
}

/** 渲染层注入的图片地址整形：./ 前缀与插入时 URL 转义 */
function formatImageSrc(src: string): string {
  return formatInsertedImagePath(src, appConfig.value.image);
}

/** 按扩展名推断图片 MIME（主进程 read_file_base64 返回的是裸 base64） */
function mimeFromFileName(name: string): string {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  switch (extension) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "bmp":
      return "image/bmp";
    case "ico":
      return "image/x-icon";
    default:
      return "image/png";
  }
}

/** data:URL（或裸 base64）转 File，供上传图床使用 */
function dataUrlToFile(dataUrl: string, name: string): File {
  const [meta, payload] = dataUrl.includes(",") ? dataUrl.split(",") : ["", dataUrl];
  const mime = /:(.*?);/.exec(meta)?.[1] || mimeFromFileName(name);
  const binary = atob(payload ?? "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], name, { type: mime });
}

/** 保存图片到本地：按插入动作解析目标目录（./assets、自定义目录、同名 .assets 文件夹等） */
async function saveImageWithCurrentConfig(file: File): Promise<string> {
  const imageConfig = appConfig.value.image;
  const currentMarkdown = editor?.getMarkdown() ?? props.tab.content ?? "";
  const target = resolveImageSaveTarget(imageConfig, currentImageYamlOverrides().copyImagesTo);

  // 同名文件夹与自定义相对目录都依赖已保存的文件路径；未保存时先询问处理方式
  if (target.useFileNameFolder && !props.tab.filePath) {
    const choice = await window.electronAPI.showImageUnsavedChoice();
    if (choice === "cancel") {
      throw new Error("用户取消插入图片");
    }

    if (choice === "save") {
      const saved = await window.electronAPI.saveFile(
        props.tab.filePath,
        currentMarkdown,
        props.tab.fileTraits,
        target.targetPath,
        target.useFileNameFolder,
        imageConfig.preferRelativePath,
        imageConfig.addDotSlashPrefix
      );

      if (!saved) {
        throw new Error("用户取消保存文件");
      }

      props.tab.filePath = saved.filePath;
      props.tab.name = getFileNameFromPath(saved.filePath);
      props.tab.content = saved.content;
      props.tab.originalContent = saved.content;
      props.tab.isModified = false;
      (window as any).__currentFilePath = saved.filePath;
      emitter.emit("file:Change");
    } else {
      // fallback：不建同名文件夹，直接落到当前文件目录
      return writeImageFile(file, { targetPath: "", useFileNameFolder: false, saveToTemp: false });
    }
  }

  return writeImageFile(file, target);
}

/** 把内存中的图片字节写到磁盘，返回写入 Markdown 的图片地址 */
async function writeImageFile(file: File, target?: ImageSaveTarget): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const buffer = new Uint8Array(arrayBuffer);
  const imageConfig = appConfig.value.image;
  const currentFilePath = props.tab.filePath || (window as any).__currentFilePath || null;
  const saveTarget = target ?? resolveImageSaveTarget(imageConfig);
  const imagePath = await window.electronAPI.writeTempImage(
    buffer,
    saveTarget.targetPath,
    currentFilePath,
    file.name,
    file.type,
    saveTarget.useFileNameFolder,
    saveTarget.saveToTemp,
    imageConfig.preferRelativePath,
    imageConfig.addDotSlashPrefix
  );

  if (!imagePath) {
    throw new Error("图片保存失败");
  }

  return formatInsertedImagePath(imagePath, imageConfig);
}

/** 本地磁盘图片：按规则复制到文档目录（"对本地位置的图片应用上述规则"） */
async function copyLocalImageWithConfig(sourcePath: string): Promise<string | null> {
  const imageConfig = appConfig.value.image;
  const target = resolveImageSaveTarget(imageConfig, currentImageYamlOverrides().copyImagesTo);
  const currentFilePath = props.tab.filePath || (window as any).__currentFilePath || null;
  const copied = await window.electronAPI.copyLocalImage(
    sourcePath,
    target.targetPath,
    currentFilePath,
    target.useFileNameFolder,
    imageConfig.preferRelativePath,
    imageConfig.addDotSlashPrefix
  );
  if (!copied) return null;
  return formatInsertedImagePath(copied, imageConfig);
}

/** 网络图片：下载并按规则落盘（"对网络位置的图片应用上述规则"） */
async function downloadNetworkImageWithConfig(url: string): Promise<string | null> {
  const imageConfig = appConfig.value.image;
  const target = resolveImageSaveTarget(imageConfig, currentImageYamlOverrides().copyImagesTo);
  const currentFilePath = props.tab.filePath || (window as any).__currentFilePath || null;
  const downloaded = await window.electronAPI.downloadNetworkImage(
    url,
    target.targetPath,
    currentFilePath,
    target.useFileNameFolder,
    imageConfig.preferRelativePath,
    imageConfig.addDotSlashPrefix
  );
  if (!downloaded) return null;
  return formatInsertedImagePath(downloaded, imageConfig);
}

/**
 * 拖入本地图片文件：按插入动作上传 / 复制 / 保持原路径，再插入到当前光标处
 * 由 useFile 的窗口级 drop 监听转发（core 只负责落盘与插入，规则在渲染层）
 */
async function handleInsertImagePaths({ paths }: { paths: string[] }): Promise<void> {
  if (!props.isActive || !editor || !paths?.length) return;
  if (effectiveReadOnly.value) {
    autotoast.show(isReadOnlyMode.value ? "只读模式下无法插入图片" : "只读文档无法插入图片");
    return;
  }

  const imageConfig = appConfig.value.image;
  for (const sourcePath of paths) {
    const name = sourcePath.split(/[\\/]/).pop() || "image";
    try {
      let src: string | null = null;

      if (imageConfig.insertAction === "upload" || shouldUploadByYaml()) {
        const dataUrl = await window.electronAPI.readFileBase64(sourcePath);
        src = await uploadImage(dataUrlToFile(dataUrl, name));
      } else if (imageConfig.insertAction === "base64") {
        src = await window.electronAPI.readFileBase64(sourcePath);
      } else if (imageConfig.applyToLocalImages && isCopyAction(imageConfig.insertAction)) {
        src = await copyLocalImageWithConfig(sourcePath);
      } else {
        // 无特殊操作：保留原路径，仅按语法偏好整形
        src = formatInsertedImagePath(sourcePath, imageConfig);
      }

      if (!src) continue;
      editor.insertImage(src, name);
    } catch (error) {
      console.error("[image] 插入本地图片失败:", sourcePath, error);
      autotoast.show("图片插入失败，请检查文件是否存在", "error");
    }
  }
}

let editor: LivemdEditor | null = null;
/** 第二阶段内容注入是否已完成（非活跃 tab 延迟到首次激活） */
let hasHydrated = false;
/** restoreDoc 注入期间抑制 change 回调的脏检查与 tab.content 回写（注入不是用户修改） */
let isHydrating = false;
/** 两阶段挂载进行中（含大文档等待一帧的窗口），防止激活 watcher 与挂载重入 */
let isMounting = false;
let isUnmounted = false;
const lastEmittedValue = ref<string | null>(null);
let isSourceViewToggling = false;
let preservedSourceView = false;
/** 用户主动 cancel/remove 时抑制下一次"批注自动移除"提示（store 清理仍幂等执行） */
let suppressAutoRemoveToast = false;

const { getBookmarkIndices, toggleFileBookmark } = useBookmarks();
// 表格工具栏等内核侧入口通过该命令表调用渲染层能力（如「格式化表格代码」）
const { commands: appCommands } = useAppCommands();
const { createNewTab, saveTab, close: closeTab } = useTab();
const { annotationMap, addEntry, removeEntries, applyAnchors, setBarVisible, setActiveAnnotation } =
  useAnnotations();
const bookmarkedIndices = computed(() => getBookmarkIndices(props.tab.filePath));

watch(
  bookmarkedIndices,
  (indices) => {
    editor?.setBookmarkedBlocks(indices);
  },
  { deep: true }
);

/** Alt+点击顶层块：添加或移除书签 */
function toggleBookmarkForTarget(target: { index: number; text: string; type: string } | null) {
  if (!target) return false;

  const filePath = props.tab.filePath;
  if (!filePath) {
    autotoast.show("请先保存文件后再添加书签");
    return false;
  }

  const added = toggleFileBookmark(filePath, target);
  autotoast.show(added ? "已添加书签" : "已移除书签");
  return true;
}

function handleContainerClick(event: MouseEvent) {
  if (!event.altKey || event.ctrlKey || event.metaKey || !editor) return;

  const target = editor.getBlockBookmarkAt(event.clientX, event.clientY);
  if (toggleBookmarkForTarget(target)) {
    event.preventDefault();
  }
}

/** 命令面板：切换光标所在块的书签 */
function handleToggleBookmark() {
  if (!props.isActive || !editor) return;
  toggleBookmarkForTarget(editor.getCurrentBlockBookmark());
}

// ============ 批注 emitter 命令（渲染层 → 编辑器，仅活跃编辑器响应）============

/** 锚定文字的屏幕坐标（x 取选区右缘，y 取垂直中点；取不到时兜底） */
function annotationScreenPoint(from: number): { x: number; y: number } {
  try {
    if (!editor) throw new Error("no editor");
    const coords = editor.view.coordsAtPos(from);
    const x = typeof coords.right === "number" ? coords.right : coords.left + 20;
    const y = (coords.top + coords.bottom) / 2;
    return { x, y };
  } catch {
    return { x: window.innerWidth - 420, y: 160 };
  }
}

function handleAnnotationCommit(payload?: { id?: string }) {
  if (!props.isActive || !editor || !payload?.id) return;
  editor.commitAnnotation(payload.id);
}

/** 卡片"编辑"：定位文档 + 高亮转编辑样式 + 携坐标弹对话框回显 */
function handleAnnotationEdit(payload?: { id?: string }) {
  if (!props.isActive || !editor || !payload?.id) return;
  const id = payload.id;
  editor.revealAnnotation(id);
  editor.editAnnotation(id);
  const item = editor.listAnnotationItems().find((entry) => entry.id === id);
  if (!item) return;
  const point = annotationScreenPoint(item.from);
  emitter.emit("annotation:open-editor", {
    id,
    docKey: annotationDocKey(props.tab.filePath, props.tab.id),
    x: point.x,
    y: point.y,
  });
}

function handleAnnotationCancel(payload?: { id?: string }) {
  if (!props.isActive || !editor || !payload?.id) return;
  // 用户主动取消（非"锚定文字被删"）：抑制自动移除提示，避免误导性 toast
  suppressAutoRemoveToast = true;
  editor.removeAnnotation(payload.id);
}

function handleAnnotationRemove(payload?: { id?: string }) {
  if (!props.isActive || !editor || !payload?.id) return;
  // 同 cancel：用户主动删除不应提示"文字已被删除"
  suppressAutoRemoveToast = true;
  editor.removeAnnotation(payload.id);
}

function handleAnnotationReveal(payload?: { id?: string }) {
  if (!props.isActive || !editor || !payload?.id) return;
  editor.revealAnnotation(payload.id);
}

/** 命令面板：把当前选区提取为新文件 */
async function handleExtractSelection() {
  if (!props.isActive || !editor) return;
  if (effectiveReadOnly.value) {
    autotoast.show(isReadOnlyMode.value ? "只读模式下无法提取选区" : "只读文档无法提取选区");
    return;
  }

  const selected = editor.getSelectionMarkdown();
  if (!selected) {
    autotoast.show("请先选择要提取的内容");
    return;
  }

  const sourceEditor = editor;
  const tab = createNewTab();
  tab.name = "提取片段.md";
  tab.content = selected;
  tab.originalContent = "";
  tab.isModified = true;

  await nextTick();
  const saved = await saveTab(tab);
  if (!saved) {
    closeTab(tab.id);
    autotoast.show("已取消提取");
    return;
  }

  sourceEditor.deleteSelection();
  autotoast.show("已将选区提取为新文件", "success");
}

/** 命令面板/快捷键/右键菜单：插入或编辑链接 */
async function handleInsertLink() {
  if (!props.isActive || !editor) return;
  if (effectiveReadOnly.value) {
    autotoast.show(isReadOnlyMode.value ? "只读模式下无法插入链接" : "只读文档无法插入链接");
    return;
  }

  const existing = editor.getLinkAtSelection();
  const initialText = existing?.text || editor.getSelectionText();
  const initialUrl = existing?.href || "";

  const result = (await autodialog.show(InsertLinkDialog, {
    props: { initialText, initialUrl },
  })) as { text: string; url: string } | null | undefined;

  if (!result) {
    editor.focus();
    return;
  }

  if (!editor.insertLink(result.text, result.url)) {
    autotoast.show("插入链接失败，请重试");
    return;
  }

  autotoast.show(existing ? "已更新链接" : "已插入链接", "success");
}

/** 编辑器右键菜单请求插入链接 */
function handleInsertLinkRequest() {
  if (!props.isActive) return;
  void handleInsertLink();
}

/** 将应用的视图模式配置同步到编辑器实例 */
function syncViewModesToEditor() {
  if (!editor) return;
  editor.updateConfig({
    viewModes: {
      focusMode: Boolean(appConfig.value.view?.focusMode),
      typewriterMode: Boolean(appConfig.value.view?.typewriterMode),
    },
  });
}

watch(
  () => [appConfig.value.view?.focusMode, appConfig.value.view?.typewriterMode],
  () => syncViewModesToEditor()
);
// 快捷键配置变化：失效内核的快捷键映射缓存，无需重建编辑器即可生效
watch(
  () => appConfig.value.shortcuts,
  () => editor?.invalidateCustomKeyMapCache(),
  { deep: true }
);

// isNewlyLoaded 归一化清理定时器
let newlyLoadedTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleNewlyLoadedCleanup() {
  if (newlyLoadedTimer) clearTimeout(newlyLoadedTimer);
  newlyLoadedTimer = setTimeout(() => {
    newlyLoadedTimer = null;
    props.tab.isNewlyLoaded = false;
  }, 150);
}

// 更新滚动比例（rAF 节流）
let scrollRafId: number | null = null;
function updateScrollRatio(e: Event) {
  if (scrollRafId !== null) return;
  const target = e.target as HTMLElement;
  scrollRafId = requestAnimationFrame(() => {
    scrollRafId = null;
    const scrollTop = target.scrollTop;
    const scrollHeight = target.scrollHeight - target.clientHeight;
    const ratio = scrollHeight === 0 ? 0 : scrollTop / scrollHeight;
    props.tab.scrollRatio = ratio;
  });
}

// 预处理内容（主进程已完成图片路径转换，这里仅处理空格编码供编辑器渲染）
function preprocessContent(content: string): string {
  if (!content) return "";
  // 将图片路径中的空格转换为 %20（编辑器渲染需要，postprocessContent 会还原）
  return content.replace(/!\[([^\]]*)\]\(([^)]*)\)/g, (match, alt, src) => {
    if (src.includes(" ")) {
      const encodedSrc = src.replace(/ /g, "%20");
      return `![${alt}](${encodedSrc})`;
    }
    return match;
  });
}

// 处理图片路径（保存前）
function postprocessContent(content: string): string {
  // 开启"插入时自动转义图片 URL"时，%20 是用户期望的落盘形式，不再还原为空格
  if (appConfig.value.image.escapeUrlOnInsert) return content;

  // 将图片路径中的 %20 还原为空格
  return content.replace(/!\[([^\]]*)\]\(([^)]*)\)/g, (match, alt, src) => {
    if (src.includes("%20")) {
      const decodedSrc = src.replace(/%20/g, " ");
      return `![${alt}](${decodedSrc})`;
    }
    return match;
  });
}

// 发送大纲更新事件（防抖，避免大文件每次按键都遍历文档）
let outlineTimer: ReturnType<typeof setTimeout> | null = null;
function emitOutlineUpdate() {
  if (outlineTimer !== null) {
    clearTimeout(outlineTimer);
  }
  outlineTimer = setTimeout(() => {
    outlineTimer = null;
    if (!editor || !props.isActive) return;

    const doc = editor.getDoc();
    const headings: Array<{ level: number; text: string; id: string; pos: number }> = [];

    doc.descendants((node, pos) => {
      if (node.type.name === "heading") {
        // 提取不含语法标记的纯文本
        let text = "";
        node.forEach((child) => {
          if (child.isText && !child.marks.some((m) => m.type.name === "syntax_marker")) {
            text += child.text || "";
          }
        });
        headings.push({
          level: node.attrs.level,
          text: text.trim(),
          id: `heading-${pos}`,
          pos,
        });
      }
      return true;
    });

    emitter.emit("outline:Update", headings);
  }, 150);
}

/** 折叠状态持久化键（与批注/大纲一致：已保存文档用路径，未保存用 tab id） */
function foldDocKeyOf(): string {
  return props.tab.filePath ? `file:${props.tab.filePath}` : `tab:${props.tab.id}`;
}

function createEditorInstance() {
  if (!containerRef.value) return;

  // 设置全局文件路径供插件使用
  if (props.isActive) {
    (window as any).__currentFilePath = props.tab.filePath || null;
  }

  // 第一阶段只建空壳：插件 / NodeView / 事件全部就绪但不解析内容，让壳先绘制首帧；
  // 内容在 hydrateEditorContent 里以单事务注入（见 mountEditorTwoPhase）
  const config: LivemdConfig = {
    content: "",
    readonly: effectiveReadOnly.value,
    sourceView: preservedSourceView,
    viewModes: {
      focusMode: Boolean(appConfig.value.view?.focusMode),
      typewriterMode: Boolean(appConfig.value.view?.typewriterMode),
    },
    placeholder: "写点什么吧...",
    // 图片插入规则：core 只负责落盘与插入，方向（本地/网络/上传/YAML）由渲染层按设置决定
    pasteConfig: {
      getImagePasteMethod: resolvePasteMethod,
      imageUploader: async (file: File) => {
        return await uploadImage(file);
      },
      localImageSaver: async (file: File) => {
        return await saveImageWithCurrentConfig(file);
      },
      formatImageSrc,
      resolveNetworkImage: async (url: string) => {
        if (!appConfig.value.image.applyToNetworkImages) return null;
        return await downloadNetworkImageWithConfig(url);
      },
      resolveLocalImage: async (sourcePath: string) => {
        if (!appConfig.value.image.applyToLocalImages) return null;
        return await copyLocalImageWithConfig(sourcePath);
      },
    },
  };

  editor = createLivemdEditor(containerRef.value, config);

  // ============ 批注桥接（与书签的 emitter 桥完全同构）============
  // ① 持久化批注 / 折叠 / 书签 / 光标的恢复都在 hydrateEditorContent 中随内容一次性完成

  // ② 右键"批注" → 编辑器已建装饰并发出 id，这里只补 store 记录 + 通知对话框弹出
  editor.on(
    "annotationRequestCreate",
    (payload: { id: string; anchor: AnnotationEntry["anchor"]; from: number; to: number }) => {
      const currentDocKey = annotationDocKey(props.tab.filePath, props.tab.id);
      addEntry(currentDocKey, {
        id: payload.id,
        anchor: payload.anchor,
        content: "",
        state: "editing",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const point = annotationScreenPoint(payload.from);
      emitter.emit("annotation:request-create", {
        id: payload.id,
        anchorText: payload.anchor.anchorText,
        docKey: currentDocKey,
        x: point.x,
        y: point.y,
      });
    }
  );

  // ③ 编辑过程中持续上报最新锚点 → store 防抖 500ms 持久化（写路径的关键回写通道）
  editor.on(
    "annotationPositions",
    (payload: { positions: Array<{ id: string; anchor: AnnotationEntry["anchor"] }> }) => {
      applyAnchors(annotationDocKey(props.tab.filePath, props.tab.id), payload.positions);
    }
  );

  // ④ 整段文字被删除 → 插件剔除区间，这里清理 store 并提示
  editor.on("annotationAutoRemoved", (payload: { ids: string[] }) => {
    const currentDocKey = annotationDocKey(props.tab.filePath, props.tab.id);
    removeEntries(currentDocKey, payload.ids);
    emitter.emit("annotation:auto-removed", { ids: payload.ids, docKey: currentDocKey });
    if (suppressAutoRemoveToast) {
      // 用户主动 cancel/remove 也会走这条感知（store 清理幂等），但不提示
      suppressAutoRemoveToast = false;
      return;
    }
    autotoast.show("批注锚定的文字已被删除，批注已自动移除", "warn");
  });

  // ⑤ 点击文档高亮 → 激活对应卡片并展开批注栏
  editor.on("annotationClicked", (payload: { id: string }) => {
    setActiveAnnotation(payload.id);
    setBarVisible(true);
    emitter.emit("annotation:clicked", { id: payload.id });
  });

  // 折叠状态变化：按文档键持久化（core 不知道文件路径，索引由编辑器回传）
  // 内核（表格工具栏等）请求执行渲染层命令：按 id 找到命令并执行
  editor.on("rendererCommand", ({ id }: { id: string }) => {
    const command = appCommands.value.find((item) => item.id === id);
    if (!command) return;
    void command.run();
  });

  editor.on("foldChange", ({ indices }: { indices: number[] }) => {
    setFoldForDoc(foldDocKeyOf(), indices);
  });

  // 未保存文档保存后迁移折叠记录，避免折叠状态丢失
  watch(
    () => props.tab.filePath,
    (nextPath, previousPath) => {
      if (nextPath && !previousPath) {
        migrateFoldDocKey(`tab:${props.tab.id}`, `file:${nextPath}`);
      }
    }
  );

  // 监听变更事件
  editor.on("change", ({ markdown }: { markdown: string }) => {
    // 源码模式切换是视图变换，不是内容修改，跳过；
    // 两阶段挂载的内容注入同样不是用户修改，不参与脏检查与 tab.content 回写
    if (isSourceViewToggling || isHydrating) return;
    const restoredMarkdown = postprocessContent(markdown);
    lastEmittedValue.value = restoredMarkdown;

    // 直接写入 tab 对象
    const tab = props.tab;
    tab.content = restoredMarkdown;

    if (tab.readOnly) {
      tab.isModified = false;
      return;
    }

    // 刚加载的 tab，吸收编辑器归一化产生的变化
    if (tab.isNewlyLoaded) {
      tab.originalContent = restoredMarkdown;
      tab.isModified = false;
      // 归一化每步都可能触发 change，重置定时器等待全部完成
      scheduleNewlyLoadedCleanup();
      return;
    }

    tab.isModified =
      normalizeMarkdownForDirtyCheck(restoredMarkdown) !==
      normalizeMarkdownForDirtyCheck(tab.originalContent);
    emitOutlineUpdate();
  });

  // 监听选区变更
  editor.on("selectionChange", (data: { from: number; to: number }) => {
    props.tab.milkdownCursorOffset = data.from;
    // 源码偏移量按 PM 偏移对文档大小取钳制：PM 位置与 Markdown 位置共享同一字符流，
    // 不再为每次选区变化做全量序列化（此前这里是文档键入卡顿的主因之一）
    const docSize = editor?.view.state.doc.content.size ?? 0;
    props.tab.codeMirrorCursorOffset = docSize > 0 ? Math.min(data.from, docSize) : 0;
  });
}

/** 按 tab 记录的滚动比例还原滚动位置（内容注入 / 外部重载后调用） */
function restoreScrollPosition(): void {
  nextTick(() => {
    if (!scrollViewRef.value) return;
    const scrollRatio = props.tab.scrollRatio ?? 0;
    const targetScrollTop =
      scrollRatio * (scrollViewRef.value.scrollHeight - scrollViewRef.value.clientHeight);
    scrollViewRef.value.scrollTop = targetScrollTop;
  });
}

/**
 * 第二阶段：注入内容
 *
 * 内容 + 折叠 + 书签 + 光标合并为一条 restoreDoc 事务（原来 setMarkdown + setBookmarkedBlocks +
 * setFoldedBlocks 三连调 = 3 条事务 = 3 次 appendTransaction 插件全文档跑 + 3 次全量 decorate），
 * 随后恢复持久化批注（需要文档内容就绪后重定位）、大纲与滚动位置。
 */
function hydrateEditorContent(): void {
  if (!editor || hasHydrated) return;
  hasHydrated = true;

  const contentForRendering = preprocessContent(props.tab.content);
  const savedFolds = getFoldForDoc(foldDocKeyOf());

  isHydrating = true;
  try {
    editor.restoreDoc(contentForRendering, {
      folded: savedFolds.length > 0 ? savedFolds : undefined,
      bookmarks: bookmarkedIndices.value,
      cursorOffset: props.tab.milkdownCursorOffset || undefined,
    });
  } finally {
    isHydrating = false;
  }

  // 恢复持久化批注；重定位失败的 id 同步清除存储（restore 不走事件，直接调方法）
  const docKey = annotationDocKey(props.tab.filePath, props.tab.id);
  const savedEntries = annotationMap.value[docKey] ?? [];
  if (savedEntries.length > 0) {
    const droppedIds = editor.restoreAnnotations([...savedEntries] as AnnotationEntry[]);
    if (droppedIds.length > 0) {
      removeEntries(docKey, droppedIds);
    }
  }

  if (props.isActive) {
    emitOutlineUpdate();
    void nextTick().then(() => editor?.refreshClipboardFallbacks());
  }

  restoreScrollPosition();
}

/**
 * 两阶段挂载：先建空壳绘制首帧，切出一个宏任务后再注入内容
 * （与 Typora macOS hotfix 同构：parse 全文档不再阻塞首帧）
 */
async function mountEditorTwoPhase(): Promise<void> {
  if (!containerRef.value || editor || isMounting) return;
  isMounting = true;
  try {
    if (isLargeDocument.value && props.isActive) {
      isEditorInitializing.value = true;
      await nextFrame();
    }
    if (isUnmounted) return;
    createEditorInstance();
    // 第二阶段：切出宏任务，让壳先绘制首帧
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (!isUnmounted && editor) hydrateEditorContent();
  } finally {
    isMounting = false;
    if (isEditorInitializing.value) {
      await nextFrame();
      isEditorInitializing.value = false;
    }
  }
}

function syncEditorFromTab(content: string) {
  // 尚未注入内容的壳（极短窗口）不做同步：hydrate 会读取最新的 tab.content
  if (!editor || !hasHydrated) return;
  const shouldShowLoading = props.isActive && isLargeMarkdown(content);
  if (shouldShowLoading) {
    isEditorInitializing.value = true;
  }

  requestAnimationFrame(async () => {
    if (props.isActive) {
      (window as any).__currentFilePath = props.tab.filePath || null;
    }

    try {
      if (shouldShowLoading) {
        await nextFrame();
      }

      const contentForRendering = preprocessContent(content);
      // 外部内容更新（文件 watcher / 检查修复写回等）同样走单事务：内容 + 书签 + 持久化折叠一次注入
      const savedFolds = getFoldForDoc(foldDocKeyOf());
      editor?.restoreDoc(contentForRendering, {
        bookmarks: bookmarkedIndices.value,
        folded: savedFolds.length > 0 ? savedFolds : undefined,
      });

      // 写回后保持视口：按记录的滚动比例还原（修复写回后视口不跳）
      restoreScrollPosition();
    } finally {
      if (shouldShowLoading) {
        await nextFrame();
        isEditorInitializing.value = false;
      }
    }
  });
}

onMounted(async () => {
  if (!containerRef.value) return;
  await nextTick();
  // 非活跃 tab 懒创建：宿主对所有 tab v-show 挂载，后台 tab 不必在挂载时付出解析成本，
  // 等首次激活（isActive watcher）再创建并注入内容
  if (!props.isActive) return;
  await mountEditorTwoPhase();
});

// 非活跃 tab 首次激活时才创建编辑器（两阶段挂载）；已创建但尚未注入内容时补注入
watch(
  () => props.isActive,
  (active) => {
    if (!active || isUnmounted) return;
    if (!editor) {
      void mountEditorTwoPhase();
    } else if (!hasHydrated && !isMounting) {
      hydrateEditorContent();
    }
  }
);

onUnmounted(() => {
  isUnmounted = true;
  editor?.destroy();
  editor = null;
  isEditorInitializing.value = false;
  if (newlyLoadedTimer) clearTimeout(newlyLoadedTimer);
  if (outlineTimer) clearTimeout(outlineTimer);
  emitter.off("sourceView:toggle", handleSourceViewToggle);
  emitter.off("outline:scrollTo", handleOutlineScrollTo);
  emitter.off("editor:reload", handleEditorReload);
  emitter.off("editor:command", handleEditorCommand);
  emitter.off("editor:search", handleEditorSearch);
  emitter.off("editor:reveal-block", handleRevealBlock);
  emitter.off("lint:reveal-line", handleLintReveal);
  emitter.off("editor:toggle-bookmark", handleToggleBookmark);
  emitter.off("editor:extract-selection", handleExtractSelection);
  emitter.off("editor:insert-link", handleInsertLink);
  emitter.off("editor:insert-image-paths", handleInsertImagePaths);
  emitter.off("editor:annotation-commit", handleAnnotationCommit);
  emitter.off("editor:annotation-edit", handleAnnotationEdit);
  emitter.off("editor:annotation-cancel", handleAnnotationCancel);
  emitter.off("editor:annotation-remove", handleAnnotationRemove);
  emitter.off("editor:annotation-reveal", handleAnnotationReveal);
  window.removeEventListener("livemd:insert-link", handleInsertLinkRequest);
  window.electronAPI.removeListener?.("editor:undo", handleMenuUndo);
  window.electronAPI.removeListener?.("editor:redo", handleMenuRedo);
});

// 处理源码模式切换事件（仅活跃编辑器响应）
function handleSourceViewToggle() {
  if (!props.isActive || !editor) return;
  isSourceViewToggling = true;
  editor.toggleSourceView();
  isSourceViewToggling = false;
  emitter.emit("sourceView:changed", editor.isSourceViewEnabled());
}

/**
 * 文档检查结果定位：把 1-based 行号换算为顶层块序号后复用 revealBlock
 *
 * 行号来自 Markdown 源码（markdownlint / 拼写检查），这里按「每个顶层块占用的行数 + 块间空行」
 * 逐块累计定位，命中即滚动到该块；找不到时退回文档末尾。
 * 说明：块间空行的实际数量因文档而异，定位为近似命中（首行必准），足以让用户看到问题所在。
 */
function handleLintReveal(line: number): void {
  if (!props.isActive || !editor || typeof line !== "number") return;

  const doc = editor.view.state.doc;
  let currentLine = 1;
  let targetIndex = -1;

  doc.forEach((node, _offset, index) => {
    if (targetIndex !== -1) return;
    const blockLines = Math.max(1, node.textContent.split("\n").length);
    if (line >= currentLine && line < currentLine + blockLines) {
      targetIndex = index;
    }
    currentLine += blockLines + 1;
  });

  if (targetIndex === -1) targetIndex = Math.max(0, doc.childCount - 1);
  editor.revealBlock({ index: targetIndex });
}
emitter.on("sourceView:toggle", handleSourceViewToggle);

// 处理大纲点击滚动（仅活跃编辑器响应）
function handleOutlineScrollTo(pos: unknown) {
  if (!props.isActive || !editor || typeof pos !== "number") return;
  const view = editor.view;
  const dom = view.domAtPos(pos + 1);
  if (dom.node) {
    const el = dom.node instanceof HTMLElement ? dom.node : dom.node.parentElement;
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}
emitter.on("outline:scrollTo", handleOutlineScrollTo);

// 处理菜单栏的撤销/重做（仅活跃编辑器响应）
function handleMenuUndo() {
  if (!props.isActive || !editor) return;
  const view = editor.view;
  undo(view.state, view.dispatch.bind(view));
}
function handleMenuRedo() {
  if (!props.isActive || !editor) return;
  const view = editor.view;
  redo(view.state, view.dispatch.bind(view));
}
window.electronAPI.on?.("editor:undo", handleMenuUndo);
window.electronAPI.on?.("editor:redo", handleMenuRedo);

// 处理命令面板/菜单转发的编辑器命令（仅活跃编辑器响应）
function handleEditorCommand(payload: { id?: string } | string | undefined) {
  if (!props.isActive || !editor) return;
  const id = typeof payload === "string" ? payload : payload?.id;
  if (!id) return;
  editor.executeAction(id);
}
function handleEditorSearch(payload?: { replace?: boolean; query?: string }) {
  if (!props.isActive || !editor) return;
  editor.openSearch(Boolean(payload?.replace), payload?.query);
}
function handleRevealBlock(payload?: { index?: number; text?: string }) {
  if (!props.isActive || !editor || typeof payload?.index !== "number") return;
  editor.revealBlock({ index: payload.index, text: payload.text });
}
emitter.on("editor:command", handleEditorCommand);
emitter.on("editor:search", handleEditorSearch);
emitter.on("editor:reveal-block", handleRevealBlock);
emitter.on("lint:reveal-line", handleLintReveal);
emitter.on("editor:toggle-bookmark", handleToggleBookmark);
emitter.on("editor:extract-selection", handleExtractSelection);
emitter.on("editor:insert-link", handleInsertLink);
emitter.on("editor:insert-image-paths", handleInsertImagePaths);
emitter.on("editor:annotation-commit", handleAnnotationCommit);
emitter.on("editor:annotation-edit", handleAnnotationEdit);
emitter.on("editor:annotation-cancel", handleAnnotationCancel);
emitter.on("editor:annotation-remove", handleAnnotationRemove);
emitter.on("editor:annotation-reveal", handleAnnotationReveal);
window.addEventListener("livemd:insert-link", handleInsertLinkRequest);

// 处理编辑器重载事件（仅活跃编辑器响应）
async function handleEditorReload() {
  if (!props.isActive || !containerRef.value) return;
  preservedSourceView = editor?.isSourceViewEnabled() ?? false;
  editor?.destroy();
  editor = null;
  hasHydrated = false;
  // 清空容器
  if (containerRef.value) {
    containerRef.value.innerHTML = "";
  }
  // 重载同样走两阶段挂载（壳 → 宏任务后注入内容）
  await mountEditorTwoPhase();
}
emitter.on("editor:reload", handleEditorReload);

// 监听 tab.content 变化（处理外部内容更新，如文件 watcher、useFile 打开文件等）
watch(
  () => props.tab.content,
  (newValue) => {
    if (newValue === lastEmittedValue.value) {
      return;
    }
    if (editor && newValue !== undefined) {
      syncEditorFromTab(newValue);
    }
  }
);

watch(
  () => props.tab.filePath,
  (newValue, oldValue) => {
    if (!editor || newValue === oldValue) return;
    if (props.isActive) {
      (window as any).__currentFilePath = newValue || null;
    }
    if (props.tab.content !== undefined) {
      lastEmittedValue.value = null;
      syncEditorFromTab(props.tab.content);
    }
  }
);

// 监听有效只读态变化（文件只读 / 状态栏只读模式），两者任一开启即不可编辑
watch(effectiveReadOnly, (newValue) => {
  editor?.updateConfig({ readonly: newValue });
});

// 监听 isActive 变化：激活时同步全局状态
watch(
  () => props.isActive,
  (isActive) => {
    if (isActive) {
      // 更新全局文件路径
      (window as any).__currentFilePath = props.tab.filePath || null;
      // 发送大纲更新
      emitOutlineUpdate();
      // 通知源码模式状态
      emitter.emit("sourceView:changed", editor?.isSourceViewEnabled() ?? false);
      void nextTick().then(() => editor?.refreshClipboardFallbacks());
    }
  }
);

// 暴露方法
defineExpose({
  getEditor: () => editor,
  focus: () => editor?.focus(),
  getMarkdown: () => editor?.getMarkdown() ?? "",
  setMarkdown: (content: string) => editor?.setMarkdown(content),
  toggleSourceView: () => editor?.toggleSourceView(),
});
</script>

<template>
  <div
    class="editor-box livemd-editor-instance"
    :class="{ 'large-document-mode': isLargeDocument }"
    :data-tab-id="tab.id"
    :data-active="isActive ? 'true' : 'false'"
  >
    <div ref="scrollViewRef" class="scrollView livemd" @scroll="updateScrollRatio">
      <div class="editor-zoom-surface" :style="editorContentStyle">
        <div ref="containerRef" class="livemd-container" @click="handleContainerClick"></div>
      </div>
    </div>
    <div v-if="isEditorInitializing" class="editor-loading-overlay">
      <div class="editor-loading-card">
        <LoadingIcon class="editor-loading-icon" />
        <span>正在加载大文件...</span>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
.editor-box {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;

  .scrollView {
    flex: 1;
    height: 100%;
    overflow-y: auto;
    background: var(--background-color-1);
  }

  .editor-zoom-surface {
    min-height: 100%;
    display: flex;
    flex-direction: column;
  }

  .livemd-container {
    min-height: 100%;
    display: flex;
    flex-direction: column;
  }

  .editor-loading-overlay {
    position: absolute;
    inset: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--background-color-1) 72%, rgba(0, 0, 0, 0.16));
    backdrop-filter: blur(2px);
    pointer-events: none;
  }

  .editor-loading-card {
    padding: 14px 18px;
    border: 1px solid var(--border-color-1);
    border-radius: 10px;
    background: var(--background-color-1);
    color: var(--text-color-1);
    box-shadow: 0 12px 34px rgba(0, 0, 0, 0.18);
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
  }

  .editor-loading-icon {
    color: var(--primary-color);
    font-size: 20px;
  }

  &.large-document-mode {
    :deep(.livemd-editor > p),
    :deep(.livemd-editor > h1),
    :deep(.livemd-editor > h2),
    :deep(.livemd-editor > h3),
    :deep(.livemd-editor > h4),
    :deep(.livemd-editor > h5),
    :deep(.livemd-editor > h6),
    :deep(.livemd-editor > blockquote),
    :deep(.livemd-editor > ul),
    :deep(.livemd-editor > ol),
    :deep(.livemd-editor > table),
    :deep(.livemd-editor > hr),
    :deep(.livemd-editor > .livemd-code-block),
    :deep(.livemd-editor > .livemd-image-block),
    :deep(.livemd-editor > .html-block),
    :deep(.livemd-editor > .math-block),
    :deep(.livemd-editor li),
    :deep(.livemd-editor blockquote > *) {
      content-visibility: auto;
      contain-intrinsic-size: auto 36px;
    }

    /* 分级估高：按块类型给出接近真实渲染高度的占位尺寸。统一 36px 兜底与真实高度
       （标题按字号、表格/图片几百像素）误差过大，快速滚动时会出现超过一帧的空白。
       代码块由 NodeView 按行数写入精确的内联 contain-intrinsic-size，这里只是兜底。 */
    :deep(.livemd-editor > h1) {
      contain-intrinsic-size: auto 2.8em;
    }
    :deep(.livemd-editor > h2) {
      contain-intrinsic-size: auto 2.4em;
    }
    :deep(.livemd-editor > h3) {
      contain-intrinsic-size: auto 2em;
    }
    :deep(.livemd-editor > h4) {
      contain-intrinsic-size: auto 1.8em;
    }
    :deep(.livemd-editor > table) {
      contain-intrinsic-size: auto 120px;
    }
    :deep(.livemd-editor > .livemd-image-block) {
      contain-intrinsic-size: auto 20px;
    }
    :deep(.livemd-editor > .livemd-code-block) {
      contain-intrinsic-size: auto 120px;
    }
  }
}
</style>

<style>
/* Livemd 编辑器全局样式覆盖 */
.livemd-editor {
  background: var(--background-color-1);
  color: var(--text-color-1);
  font-family: var(--font-family);
  font-size: var(--font-size);
  line-height: var(--line-height);
}

.livemd-editor h1,
.livemd-editor h2,
.livemd-editor h3,
.livemd-editor h4,
.livemd-editor h5,
.livemd-editor h6 {
  color: var(--text-color-1);
}

.livemd-editor blockquote {
  border-left-color: var(--border-color-1);
}

.livemd-code-block {
  background: var(--background-color-2);
  border-color: var(--border-color-1);
}

/* 代码块 header 已改为右下角悬浮控件群（见 livemd.css），不再渲染灰条背景 */
.livemd-editor table th,
.livemd-editor table td {
  border-color: var(--border-color-1);
}

.livemd-editor table th {
  background: var(--background-color-2);
}

.livemd-editor hr {
  background: var(--border-color-1);
}

.livemd-syntax-marker {
  color: var(--text-color-3);
}

.livemd-link {
  color: var(--link-color);
}
</style>
