import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";

import type { Block, ExportPDFOptions } from "@/main/types";
import { isMindMapEditorOpen } from "@/renderer/utils/mindmapEditorState";

type Listener = (...args: any[]) => void;

type Registration = {
  channel: string;
  listener: Listener;
  dispose: () => void;
};

const registrations = new Map<Listener, Map<string, Registration>>();
const droppedFilePaths = new WeakMap<File, string>();
const pendingSubscriptions = new Set<Promise<unknown>>();

const platform: NodeJS.Platform = /Mac/i.test(navigator.userAgent)
  ? "darwin"
  : /Linux/i.test(navigator.userAgent)
    ? "linux"
    : "win32";

function subscribe(channel: string, listener: Listener): void {
  let disposed = false;
  let unlisten: UnlistenFn | null = null;
  const promise = listen<unknown>(channel, (event) => {
    const payload = event.payload;
    if (Array.isArray(payload)) {
      listener(...payload);
    } else {
      listener(payload);
    }
  });
  promise
    .then((stop) => {
      unlisten = stop;
      if (disposed) stop();
    })
    .catch((error) => console.error(`[tauri] 监听 ${channel} 失败:`, error));
  pendingSubscriptions.add(promise);
  void promise.then(
    () => pendingSubscriptions.delete(promise),
    () => pendingSubscriptions.delete(promise)
  );

  let byChannel = registrations.get(listener);
  if (!byChannel) {
    byChannel = new Map();
    registrations.set(listener, byChannel);
  }
  byChannel.set(channel, {
    channel,
    listener,
    dispose: () => {
      disposed = true;
      if (unlisten) unlisten();
    },
  });
}

function unsubscribe(channel: string, listener: Listener): void {
  const byChannel = registrations.get(listener);
  const registration = byChannel?.get(channel);
  if (!registration) return;
  registration.dispose();
  byChannel!.delete(channel);
  if (byChannel!.size === 0) registrations.delete(listener);
}

function dispatchLocal(channel: string, ...args: any[]): void {
  for (const byChannel of registrations.values()) {
    const registration = byChannel.get(channel);
    if (registration) registration.listener(...args);
  }
}

function fire(command: string, args?: Record<string, unknown>): void {
  void invoke(command, args).catch((error) => {
    console.error(`[tauri] ${command} 失败:`, error);
  });
}

function joinPath(dir: string, relative: string): string {
  const separator = dir.includes("\\") ? "\\" : "/";
  let rel = relative;
  while (rel.startsWith("./") || rel.startsWith(".\\")) rel = rel.slice(2);
  while (rel.startsWith("/") || rel.startsWith("\\")) rel = rel.slice(1);
  return `${dir}${separator}${rel}`.replace(/\\/g, "/");
}

function dirname(filePath: string): string {
  const separator = filePath.includes("\\") ? "\\" : "/";
  const index = filePath.lastIndexOf(separator);
  return index === -1 ? "." : filePath.slice(0, index);
}

function toTauriAssetUrl(path: string): string {
  if (!path) return path;
  try {
    return convertFileSrc(path.replace(/\\/g, "/"));
  } catch (error) {
    console.error("[tauri] 转换本地图片地址失败:", path, error);
    return path;
  }
}

function fileUrlToPath(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "file:") return null;
    let path = decodeURIComponent(parsed.pathname);
    if (parsed.host) {
      path = `\\\\${parsed.host}${path.replace(/\//g, "\\")}`;
    } else if (/^\/[a-zA-Z]:/.test(path)) {
      path = path.slice(1);
    }
    return path;
  } catch {
    return null;
  }
}

function resolveLivemdUrl(src: string): string | null {
  let raw = src.slice("livemd://".length);
  if (raw.startsWith("/")) raw = raw.slice(1);
  const slash = raw.indexOf("/");
  if (slash === -1) return null;

  const encodedMarkdownPath = raw.slice(0, slash);
  const relativePath = raw.slice(slash + 1);
  try {
    const bytes = Uint8Array.from(atob(encodedMarkdownPath), (char) => char.charCodeAt(0));
    const markdownPath = new TextDecoder().decode(bytes);
    const absolutePath = joinPath(dirname(markdownPath), decodeURIComponent(relativePath));
    return toTauriAssetUrl(absolutePath);
  } catch (error) {
    console.error("[tauri] 解析 livemd:// 图片地址失败:", src, error);
    return null;
  }
}

function resolveLocalImagePath(markdownFilePath: string, imagePath: string): string {
  return joinPath(dirname(markdownFilePath), imagePath);
}

function dispatchSyntheticDrag(type: string, paths: string[]): void {
  const files = paths.map((path) => {
    const name = path.split(/[\\/]/).pop() || path;
    const file = new File([], name);
    droppedFilePaths.set(file, path);
    return file;
  });

  let dataTransfer: DataTransfer;
  try {
    dataTransfer = new DataTransfer();
    for (const file of files) dataTransfer.items.add(file);
  } catch (error) {
    console.error("[tauri] 创建拖拽数据失败:", error);
    return;
  }

  const event = new DragEvent(type, {
    bubbles: true,
    cancelable: true,
    dataTransfer,
  });
  window.dispatchEvent(event);
}

let dragDropInstalled = false;

async function installDragDropBridge(): Promise<void> {
  if (dragDropInstalled) return;
  dragDropInstalled = true;
  try {
    await getCurrentWebview().onDragDropEvent((event) => {
      const payload = event.payload as any;
      if (payload.type === "enter") {
        dispatchSyntheticDrag("dragover", payload.paths ?? []);
      } else if (payload.type === "over") {
        dispatchSyntheticDrag("dragover", []);
      } else if (payload.type === "drop") {
        dispatchSyntheticDrag("dragover", payload.paths ?? []);
        dispatchSyntheticDrag("drop", payload.paths ?? []);
      } else if (payload.type === "leave") {
        dispatchSyntheticDrag("dragleave", []);
      }
    });
  } catch (error) {
    dragDropInstalled = false;
    console.error("[tauri] 注册拖拽监听失败:", error);
  }
}

function installKeyboardShortcuts(): void {
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.isComposing) return;
      // 思维导图全屏编辑器打开时让出全局快捷键（Ctrl+S 等由编辑器自行处理）
      if (isMindMapEditorOpen()) return;
      const modifier = platform === "darwin" ? event.metaKey : event.ctrlKey;

      if (event.key === "F11") {
        event.preventDefault();
        fire("toggle_fullscreen");
        return;
      }

      if (!modifier || event.altKey) return;
      const key = event.key.toLowerCase();

      // macOS 上文件与窗口快捷键由原生菜单接管，避免菜单和键盘监听重复触发。
      if (platform === "darwin" && (key === "o" || key === "s" || key === "m")) {
        return;
      }

      if (key === "o") {
        event.preventDefault();
        event.stopPropagation();
        dispatchLocal("menu-open");
      } else if (key === "s") {
        event.preventDefault();
        event.stopPropagation();
        dispatchLocal(event.shiftKey ? "menu-save-as" : "menu-save");
      } else if (key === "/") {
        event.preventDefault();
        event.stopPropagation();
        dispatchLocal("view:toggleView");
      } else if (key === "m") {
        event.preventDefault();
        event.stopPropagation();
        fire("window_control", { action: "minimize" });
      } else if (key === "0") {
        event.preventDefault();
      }
    },
    true
  );
}

const PDF_STYLE = `
  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  pre { page-break-inside: avoid; }
  code { page-break-inside: avoid; }
  .ͼo .cm-line { display: flex!important; flex-wrap: wrap; }
  .livemd-code-block .cm-editor span {
    word-break: break-word;
    white-space: break-spaces;
    display: inline-block;
    max-width: 100%;
  }
  .ͼo .cm-content[contenteditable=true] { width: 0px; flex: 1; }
`;

async function exportAsPDF(
  elementSelector: string,
  outputName: string,
  options?: ExportPDFOptions
): Promise<void> {
  const target = document.querySelector(elementSelector);
  if (!(target instanceof HTMLElement)) {
    throw new Error("Element not found");
  }

  const style = document.createElement("style");
  style.textContent = PDF_STYLE;
  document.head.appendChild(style);

  const container = document.createElement("div");
  container.className = "electron-export-container";
  container.style.position = "absolute";
  container.style.top = "0";
  container.style.left = "0";
  container.style.width = "100vw";
  container.style.padding = "20px";
  container.style.boxSizing = "border-box";
  container.style.visibility = "visible";
  container.appendChild(target.cloneNode(true));

  const previousVisibility = document.body.style.visibility;
  document.body.style.visibility = "hidden";
  document.body.appendChild(container);

  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

  try {
    await invoke("export_pdf", {
      elementSelector,
      outputName,
      options,
    });
  } finally {
    container.remove();
    document.body.style.visibility = previousVisibility;
    style.remove();
  }
}

async function exportAsWord(blocks: Block[], outputName: string): Promise<void> {
  const sectionChildren: Paragraph[] = [];

  blocks.forEach((block) => {
    if (block.type === "heading") {
      sectionChildren.push(
        new Paragraph({
          text: block.text,
          heading:
            block.level === 1
              ? HeadingLevel.HEADING_1
              : block.level === 2
                ? HeadingLevel.HEADING_2
                : HeadingLevel.HEADING_3,
        })
      );
    } else if (block.type === "paragraph") {
      sectionChildren.push(new Paragraph({ text: block.text }));
    } else if (block.type === "list") {
      block.items.forEach((item) =>
        sectionChildren.push(
          new Paragraph({
            text: item,
            numbering: {
              reference: block.ordered ? "my-numbered" : "my-bullet",
              level: 0,
            },
          })
        )
      );
    } else if (block.type === "code") {
      block.lines.forEach((line, index) => {
        const lineChildren: TextRun[] = [
          new TextRun({
            text: `${String(index + 1).padStart(3, "0")} | `,
            color: "999999",
          }),
        ];

        const keywordRegex = /\b(?:const|let|var|function|return|if|else)\b/g;
        let lastIndex = 0;
        let match: RegExpExecArray | null = keywordRegex.exec(line);
        while (match) {
          if (match.index > lastIndex) {
            lineChildren.push(
              new TextRun({
                text: line.slice(lastIndex, match.index),
                font: "Courier New",
              })
            );
          }
          lineChildren.push(
            new TextRun({
              text: match[0],
              bold: true,
              color: "0000FF",
              font: "Courier New",
            })
          );
          lastIndex = match.index + match[0].length;
          match = keywordRegex.exec(line);
        }

        if (lastIndex < line.length) {
          lineChildren.push(new TextRun({ text: line.slice(lastIndex), font: "Courier New" }));
        }

        sectionChildren.push(new Paragraph({ children: lineChildren, spacing: { after: 100 } }));
      });
    }
  });

  const doc = new Document({
    sections: [{ children: sectionChildren }],
    numbering: {
      config: [
        {
          reference: "my-bullet",
          levels: [{ level: 0, format: "bullet", text: "•", alignment: "left" }],
        },
        {
          reference: "my-numbered",
          levels: [{ level: 0, format: "decimal", text: "%1.", alignment: "left" }],
        },
      ],
    },
  });

  const blob = await Packer.toBlob(doc);
  const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
  const result = await invoke<string | null>("save_binary_file", {
    bytes,
    defaultName: outputName || "export.docx",
    filterName: "Word Document",
    extensions: ["docx"],
  });
  if (!result) throw new Error("用户取消了保存");
}

const electronAPI = {
  openFile: () => invoke("open_file"),
  getIsReadOnly: (filePath: string) => invoke("is_file_read_only", { filePath }),
  saveFile: (
    filePath: string | null,
    content: string,
    fileTraits?: any,
    imageLocalPath?: string,
    imageUseFileNameFolder?: boolean,
    imagePreferRelative?: boolean,
    imageAddDotSlash?: boolean
  ) =>
    invoke("save_file", {
      payload: {
        filePath,
        content,
        fileTraits,
        imageLocalPath,
        imageUseFileNameFolder,
        imagePreferRelative,
        imageAddDotSlash,
      },
    }),
  saveFileAs: (
    content: string,
    fileTraits?: any,
    imageLocalPath?: string,
    imageUseFileNameFolder?: boolean,
    imagePreferRelative?: boolean,
    imageAddDotSlash?: boolean
  ) =>
    invoke("save_file_as", {
      payload: {
        content,
        fileTraits,
        imageLocalPath,
        imageUseFileNameFolder,
        imagePreferRelative,
        imageAddDotSlash,
      },
    }),
  on: subscribe,
  removeListener: unsubscribe,
  setTitle: (filePath: string | null) => fire("set_title", { filePath }),
  changeSaveStatus: (isSaved: boolean) => fire("change_save_status", { isSaved }),
  windowControl: (action: "minimize" | "maximize" | "close") => fire("window_control", { action }),
  closeDiscard: () => fire("close_discard"),
  onOpenFileAtLaunch: (callback: Listener) => subscribe("open-file-at-launch", callback),
  openExternal: (url: string) => fire("open_external", { url }),
  openLink: (href: string, currentFilePath?: string | null) =>
    invoke("open_link", { href, currentFilePath }),
  revealFileInFolder: (filePath: string) => invoke("reveal_file_in_folder", { filePath }),
  openImagePreview: (
    src: string,
    alt?: string,
    options?: { items?: Array<{ src: string; alt?: string }>; index?: number }
  ) => invoke("open_image_preview", { payload: { src, alt, ...options } }),
  getFilePathInClipboard: () => invoke("get_file_path_in_clipboard"),
  writeTextToClipboard: (text: string) => invoke("write_text_to_clipboard", { text }),
  writeToClipboard: (payload: { text: string; html: string }) =>
    invoke("write_to_clipboard", { payload }),
  writeTempImage: (
    file: Uint8Array,
    targetPath: string,
    currentFilePath?: string | null,
    fileName?: string,
    mimeType?: string,
    useFileNameFolder?: boolean,
    saveToTemp?: boolean,
    preferRelative?: boolean,
    addDotSlash?: boolean
  ) =>
    invoke("write_temp_image", {
      payload: {
        file: Array.from(file),
        targetPath,
        currentFilePath,
        fileName,
        mimeType,
        useFileNameFolder,
        saveToTemp,
        preferRelative,
        addDotSlash,
      },
    }),
  /** 本地图片按插入规则复制到文档目录（"对本地位置的图片应用上述规则"） */
  copyLocalImage: (
    sourcePath: string,
    targetPath: string,
    currentFilePath?: string | null,
    useFileNameFolder?: boolean,
    preferRelative?: boolean,
    addDotSlash?: boolean
  ) =>
    invoke<string | null>("copy_local_image", {
      payload: {
        sourcePath,
        targetPath,
        currentFilePath,
        useFileNameFolder,
        preferRelative,
        addDotSlash,
      },
    }),
  /** 网络图片下载并按插入规则落盘（"对网络位置的图片应用上述规则"） */
  downloadNetworkImage: (
    url: string,
    targetPath: string,
    currentFilePath?: string | null,
    useFileNameFolder?: boolean,
    preferRelative?: boolean,
    addDotSlash?: boolean
  ) =>
    invoke<string | null>("download_network_image", {
      payload: {
        url,
        targetPath,
        currentFilePath,
        useFileNameFolder,
        preferRelative,
        addDotSlash,
      },
    }),
  showImageUnsavedChoice: () => invoke("show_image_unsaved_choice"),
  resolveImagePath: (markdownFilePath: string, imagePath: string) =>
    Promise.resolve(toTauriAssetUrl(resolveLocalImagePath(markdownFilePath, imagePath))),
  exportAsPDF,
  exportAsWord,
  readFileByPath: (filePath: string) => invoke("read_file_by_path", { filePath }),
  readFileBase64: (filePath: string) => invoke<string>("read_file_base64", { filePath }),
  /** 弹出「另存为」对话框并写入二进制内容（思维导图导出等），用户取消时返回 null */
  saveBinaryFile: (
    bytes: Uint8Array,
    defaultName: string,
    filterName: string,
    extensions: string[]
  ) =>
    invoke<string | null>("save_binary_file", {
      bytes: Array.from(bytes),
      defaultName,
      filterName,
      extensions,
    }),
  showOverwriteConfirm: (fileName: string) => invoke("show_overwrite_confirm", { fileName }),
  showCloseConfirm: (fileName: string) => invoke("show_close_confirm", { fileName }),
  showOpenDialog: (options: any) => invoke("show_open_dialog", { options }),
  getPathForFile: (file: File) => droppedFilePaths.get(file) ?? (file as any).path,
  getSystemFonts: () => invoke("get_system_fonts"),
  getDirectoryFiles: (dirPath: string) => invoke("workspace_get_directory_files", { dirPath }),
  searchWorkspace: (options: {
    root: string;
    query: string;
    caseSensitive?: boolean;
    useRegex?: boolean;
    maxResults?: number;
  }) => invoke("search_workspace", { options }),
  workspaceExists: (dirPath: string) => invoke("workspace_exists", { dirPath }),
  watchFiles: (filePaths: string[]) => fire("watch_files", { filePaths }),
  watchDirectory: (dirPath: string) => fire("watch_directory", { dirPath }),
  unwatchDirectory: () => fire("unwatch_directory"),
  createFile: (dirPath: string, fileName: string) => invoke("create_file", { dirPath, fileName }),
  createFolder: (dirPath: string, folderName: string) =>
    invoke("create_folder", { dirPath, folderName }),
  deleteFile: (filePath: string) => invoke("delete_file", { filePath }),
  renameFile: (oldPath: string, newName: string) => invoke("rename_file", { oldPath, newName }),
  moveFile: (filePath: string, targetDir: string) =>
    invoke<string | null>("move_file", { filePath, targetDir }),
  copyFile: (sourcePath: string, targetPath: string) =>
    invoke<string | null>("copy_file", { sourcePath, targetPath }),
  cleanupLocalImages: (content: string) => invoke("cleanup_local_images", { content }),
  openThemeEditor: (_theme?: any) => fire("open_theme_editor"),
  themeEditorWindowControl: (action: "minimize" | "maximize" | "close") =>
    fire("theme_editor_window_control", { action }),
  saveCustomTheme: (theme: any) => fire("save_custom_theme", { theme }),
  platform,
  rendererReady: async () => {
    await Promise.allSettled(pendingSubscriptions);
    return invoke("renderer_ready");
  },
  tearOffTabStart: (
    tabData: any,
    screenX: number,
    screenY: number,
    offsetX: number,
    offsetY: number
  ) =>
    invoke("tear_off_start", {
      tabData,
      screenX,
      screenY,
      offsetX,
      offsetY,
    }),
  tearOffTabEnd: (screenX: number, screenY: number) => invoke("tear_off_end", { screenX, screenY }),
  tearOffTabCancel: () => invoke("tear_off_cancel"),
  focusFileIfOpen: (filePath: string) => invoke("focus_file_if_open", { filePath }),
  getInitialTabData: () => invoke("get_initial_tab_data"),
  /** 打开新的空白编辑器窗口（不进入拖拽会话，窗口停在默认位置） */
  createBlankWindow: () => invoke("create_blank_window"),
  /** 携带 Tab 数据打开新窗口（「在新窗口打开」用；workspaceDir 由渲染层消费） */
  createWindowWithTab: (tabData: unknown) => invoke<boolean>("create_window_with_tab", { tabData }),
  getWindowBounds: () => invoke("get_window_bounds"),
  startWindowDrag: (tabData: any, offsetX: number, offsetY: number) =>
    fire("start_window_drag", { tabData, offsetX, offsetY }),
  stopWindowDrag: () => fire("stop_window_drag"),
  dropMerge: (tabData: any, screenX: number, screenY: number) =>
    invoke("drop_merge", { tabData, screenX, screenY }),
  checkForUpdates: () => invoke("check_for_updates"),
  downloadUpdate: () => invoke("download_update"),
  cancelUpdate: () => invoke("cancel_update"),
  quitAndInstall: () => invoke("install_update"),
  onUpdateStatus: (callback: (status: any) => void) => subscribe("update:status", callback),
  onDownloadProgress: (callback: (progress: any) => void) =>
    subscribe("update:download-progress", callback),
};

declare global {
  interface Window {
    __currentFilePath?: string;
  }
}

window.electronAPI = electronAPI as any;

installKeyboardShortcuts();
void installDragDropBridge();
