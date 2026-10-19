import mitt from "mitt";

type Events = {
  "file:Change": void; // Triggered when a file is changed
  "spellcheck:Update": boolean; // Triggered when spellcheck is updated
  "outline:Update": Array<{ text: string; level: number; id: string; pos: number }>; // Triggered when the outline is updated
  "outline:scrollTo": number; // Triggered when user clicks an outline item, value is document position
  "close:confirm": void; // Triggered when need to show close confirmation dialog
  "close:discard": void; // Triggered when user chooses to discard changes
  "menu-save": boolean; // Triggered when user wants to save
  "trigger-save": boolean; // Triggered when main process requests save
  "tab:close-confirm": {
    tabId: string;
    tabName: string;
    resolver?: (closed: boolean) => void;
  }; // Triggered when tab close confirmation is needed
  "tab:switch": {
    id: string;
    name: string;
    filePath: string | null;
    content: string;
    originalContent: string;
    isModified: boolean;
    scrollRatio?: number;
    readOnly: boolean;
  }; // Triggered when switching tabs
  "file:overwrite-confirm": {
    fileName: string;
    resolver: (choice: "cancel" | "save" | "overwrite") => void;
  }; // Triggered when file overwrite confirmation is needed
  "file:changed-confirm": { fileName: string; resolver: (choice: "cancel" | "overwrite") => void }; // Triggered when file changed confirmation is needed
  "update:available": { version: string; url: string; notes: string }; // Triggered when an update is available
  "sourceView:toggle": void; // Triggered when source view mode is toggled
  "sourceView:changed": boolean; // Triggered when source view mode state changes
  "editor:reload": void; // Triggered when active editor should reload its internal ProseMirror instance
  "editor:command": { id: string }; // Triggered when a shortcut action command should run on the active editor
  "editor:search": { replace?: boolean; query?: string }; // Triggered when the active editor should open find/replace
  "editor:reveal-block": { index: number; text?: string }; // Triggered when the active editor should reveal a bookmarked block
  "editor:toggle-bookmark": void; // Triggered when the active editor should toggle a bookmark on the current block
  "editor:extract-selection": void; // Triggered when the active editor should extract the selection into a new file
  "editor:insert-link": void; // Triggered when the active editor should insert or edit a link
  "editor:insert-image-paths": { paths: string[] }; // Triggered when local image files are dropped and should be inserted per image rules
  "sidebar:set-tab": { tab: "file" | "outline"; show?: boolean }; // Switch sidebar tab
  // ============ 批注事件（annotation:* = 编辑器→渲染层；editor:annotation-* = 渲染层→编辑器）============
  // restore 不走事件：LivemdEditor.vue 创建编辑器实例后直接调用 editor.restoreAnnotations
  "editor:annotation-commit": { id: string }; // 提交批注（editing → done，装饰切常规高亮）
  "editor:annotation-edit": { id: string }; // 重新编辑（reveal + 切编辑样式 + 弹对话框回显）
  "editor:annotation-cancel": { id: string }; // 未保存批注的取消 = 删装饰 + 删 store
  "editor:annotation-remove": { id: string }; // 删除批注（与 cancel 同实现）
  "editor:annotation-reveal": { id: string }; // 滚动定位 + flash
  "annotation:request-create": {
    id: string;
    anchorText: string;
    docKey: string;
    x: number;
    y: number;
  }; // 右键新建（x/y=选区屏幕坐标）
  "annotation:open-editor": { id: string; docKey: string; x: number; y: number }; // 编辑入口（对话框回显）
  "annotation:auto-removed": { ids: string[]; docKey: string }; // 整段删除自动移除
  "annotation:clicked": { id: string }; // 点击文档高亮
  // ============ 右缘栏互斥协议（大纲/批注/书签同占窗口右缘，展开一方前收起另两方）============
  "outline:hide-bar": void; // 请求收起大纲栏
  "annotations:hide-bar": void; // 请求收起批注栏
  "bookmarks:hide-bar": void; // 请求收起书签栏
  "outline:show-bar": void; // 外部展开大纲栏入口（便签/命令面板）
  "bookmarks:show-bar": void; // 外部展开书签栏入口（便签/命令面板）
  // ============ 文档检查（拼写 / 格式）============
  "lint:reveal-line": number; // 结果面板 → 活跃编辑器：按 1-based 行号滚动并放置光标
  foldChange: { indices: number[] }; // 编辑器 → 渲染层：折叠状态变化，需按文件持久化
  "workspace:open-path": string; // useTab → App：新窗口携带的工作区路径，需要加载
} & Record<string, unknown>;

const emitter = mitt<Events>();

export default emitter;
