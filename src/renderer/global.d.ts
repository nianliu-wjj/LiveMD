type FileTraitsDTO = import("../shared/types/tearoff").FileTraitsDTO;
type TearOffTabData = import("../shared/types/tearoff").TearOffTabData;

interface Window {
  electronAPI: {
    openFile: () => Promise<{
      filePath: string;
      content: string;
      fileTraits: FileTraitsDTO;
    } | null>;
    getIsReadOnly: (filePath: string) => Promise<boolean>;
    saveFile: (
      filePath: string | null,
      content: string,
      fileTraits?: FileTraitsDTO,
      imageLocalPath?: string,
      imageUseFileNameFolder?: boolean,
      imagePreferRelative?: boolean,
      imageAddDotSlash?: boolean
    ) => Promise<{ filePath: string; content: string } | null>;
    saveFileAs: (
      content: string,
      fileTraits?: FileTraitsDTO,
      imageLocalPath?: string,
      imageUseFileNameFolder?: boolean,
      imagePreferRelative?: boolean,
      imageAddDotSlash?: boolean
    ) => Promise<{ filePath: string; content: string } | null>;
    setTitle: (filePath: string | null) => void;
    changeSaveStatus: (isSaved: boolean) => void;
    on: (channel: string, listener: (...args: any[]) => void) => void;
    removeListener: (channel: string, listener: (...args: any[]) => void) => void;
    windowControl: (action: "minimize" | "maximize" | "close") => void;
    closeDiscard: () => void;
    onOpenFileAtLaunch: (
      cb: (payload: {
        filePath: string;
        content: string;
        fileTraits?: FileTraitsDTO;
        files?: Array<{ filePath: string; content: string; fileTraits?: FileTraitsDTO }>;
      }) => void
    ) => void;
    openExternal: (url: string) => Promise<void>;
    openLink: (href: string, currentFilePath?: string | null) => Promise<void>;
    revealFileInFolder: (filePath: string) => Promise<boolean>;
    openImagePreview: (
      src: string,
      alt?: string,
      options?: { items?: Array<{ src: string; alt?: string }>; index?: number }
    ) => Promise<void>;
    getFilePathInClipboard: () => Promise<string | null>;
    writeTextToClipboard: (text: string) => Promise<boolean>;
    writeToClipboard: (payload: { text: string; html: string }) => Promise<boolean>;
    writeTempImage: (
      file: Uint8Array<ArrayBuffer>,
      targetPath: string,
      currentFilePath?: string | null,
      fileName?: string,
      mimeType?: string,
      useFileNameFolder?: boolean,
      saveToTemp?: boolean,
      preferRelative?: boolean,
      addDotSlash?: boolean
    ) => Promise<string>;
    /** 本地图片按插入规则复制到文档目录，返回写入 Markdown 的图片地址 */
    copyLocalImage: (
      sourcePath: string,
      targetPath: string,
      currentFilePath?: string | null,
      useFileNameFolder?: boolean,
      preferRelative?: boolean,
      addDotSlash?: boolean
    ) => Promise<string | null>;
    /** 网络图片下载并按插入规则落盘，返回写入 Markdown 的图片地址 */
    downloadNetworkImage: (
      url: string,
      targetPath: string,
      currentFilePath?: string | null,
      useFileNameFolder?: boolean,
      preferRelative?: boolean,
      addDotSlash?: boolean
    ) => Promise<string | null>;
    showImageUnsavedChoice: () => Promise<"save" | "fallback" | "cancel">;
    // 图片路径解析
    resolveImagePath: (markdownFilePath: string, imagePath: string) => Promise<string>;
    // 导出为 PDF
    exportAsPDF: (
      elementSelector: string,
      outputName: string,
      options?: ExportPDFOptions
    ) => Promise<void>;
    // 导出为 Word
    exportAsWord: (blocks: Block, outputName: string) => Promise<void>;
    // 通过路径读取文件（用于拖拽）
    readFileBase64: (filePath: string) => Promise<string>;
    /** 移动文件到目标目录（目标同名文件需调用方先行确认覆盖），返回新路径 */
    moveFile: (filePath: string, targetDir: string) => Promise<string | null>;
    /** 复制文件到目标路径，返回新路径 */
    copyFile: (sourcePath: string, targetPath: string) => Promise<string | null>;
    /** 携带 Tab 数据打开新窗口（tabData 额外携带 workspaceDir 时由渲染层设为工作区） */
    createWindowWithTab: (tabData: unknown) => Promise<boolean>;
    readFileByPath: (filePath: string) => Promise<{
      filePath: string;
      content: string;
      fileTraits: FileTraitsDTO;
    } | null>;
    // 显示文件覆盖确认对话框
    showOverwriteConfirm: (fileName: string) => Promise<number>;
    // 显示关闭确认对话框
    showCloseConfirm: (fileName: string) => Promise<number>;
    // 显示文件选择对话框
    showOpenDialog: (
      options: any
    ) => Promise<{ canceled: boolean; filePaths: string[] } | undefined>;
    // 获取拖拽文件的真实路径
    getPathForFile: (file: File) => string | undefined;
    // 字体相关
    getSystemFonts: () => Promise<string[]>;
    // 文件夹相关
    getDirectoryFiles: (
      dirPath: string
    ) => Promise<
      Array<{ name: string; path: string; isDirectory: boolean; mtime: number; children?: any[] }>
    >;
    workspaceExists: (dirPath: string) => Promise<boolean>;
    // 工作区全文搜索
    searchWorkspace: (options: {
      root: string;
      query: string;
      caseSensitive?: boolean;
      useRegex?: boolean;
      maxResults?: number;
    }) => Promise<{
      matches: Array<{
        path: string;
        line: number;
        column: number;
        preview: string;
        matchStart: number;
        matchLength: number;
      }>;
      truncated: boolean;
      scannedFiles: number;
    }>;
    // 监听文件变化
    watchFiles: (filePaths: string[]) => void;

    // 目录监听
    watchDirectory: (dirPath: string) => void;
    unwatchDirectory: () => void;

    // 文件操作
    createFile: (dirPath: string, fileName: string) => Promise<string | null>;
    createFolder: (dirPath: string, folderName: string) => Promise<string | null>;
    deleteFile: (filePath: string) => Promise<boolean>;
    renameFile: (oldPath: string, newName: string) => Promise<string | null>;
    cleanupLocalImages: (content: string) => Promise<boolean>;
    // 主题编辑器相关
    openThemeEditor: (theme?: any) => void;
    themeEditorWindowControl: (action: "minimize" | "maximize" | "close") => void;
    saveCustomTheme: (theme: any) => void;
    platform: NodeJS.Platform;
    rendererReady: () => void;
    // Tab 拖拽分离
    tearOffTabStart: (
      tabData: TearOffTabData,
      screenX: number,
      screenY: number,
      offsetX: number,
      offsetY: number
    ) => Promise<boolean>;
    tearOffTabEnd: (
      screenX: number,
      screenY: number
    ) => Promise<{ action: "created" | "merged" | "failed" }>;
    tearOffTabCancel: () => Promise<boolean>;
    focusFileIfOpen: (filePath: string) => Promise<{ found: boolean }>;
    getInitialTabData: () => Promise<TearOffTabData | null>;
    /** 打开新的空白编辑器窗口（不进入拖拽会话，窗口停在默认位置） */
    createBlankWindow: () => Promise<boolean>;
    getWindowBounds: () => Promise<{ x: number; y: number; width: number; height: number } | null>;
    // 单 Tab 窗口拖拽
    startWindowDrag: (tabData: TearOffTabData, offsetX: number, offsetY: number) => void;
    stopWindowDrag: () => void;
    dropMerge: (
      tabData: TearOffTabData,
      screenX: number,
      screenY: number
    ) => Promise<{ action: "merged" | "none" }>;
    // 自动更新相关
    checkForUpdates: () => Promise<any>;
    downloadUpdate: () => Promise<any>;
    cancelUpdate: () => Promise<void>;
    quitAndInstall: () => Promise<void>;
    onUpdateStatus: (callback: (status: any) => void) => void;
    onDownloadProgress: (callback: (progress: any) => void) => void;
  };
}
