import { computed } from "vue";
import autotoast from "autotoast.js";
import type { ShortcutActionId } from "@/core";
import { DEFAULT_SHORTCUTS } from "@/core";
import emitter from "@/renderer/events";
import useFile from "./useFile";
import { toggleShowOutline } from "./useOutline";
import useSourceCode from "./useSourceCode";
import useTab from "./useTab";
import useWorkSpace from "./useWorkSpace";
import useEditorZoom from "./useEditorZoom";
import useContent from "./useContent";
import { useConfig } from "./useConfig";
import { openQuickOpen } from "./useQuickOpen";
import { openWorkspaceSearch } from "./useWorkspaceSearch";
import { formatKeyForDisplay } from "./useShortcutConfig";
import { formatCjkSpacing } from "@/renderer/utils/markdownFormat";
import { formatMarkdownTables } from "@/renderer/utils/tableFormat";

/** 命令面板中的一条命令 */
export interface PaletteCommand {
  id: string;
  title: string;
  category: string;
  keywords?: string[];
  shortcut?: string;
  enabled?: boolean;
  run: () => void | Promise<void>;
}

/**
 * 应用级命令注册表
 *
 * 命令面板（Ctrl+Shift+P）与应用内其他入口共用同一份命令列表，
 * 编辑器相关命令通过 editor:command / editor:search 事件转交给活跃编辑器执行。
 */
export function useAppCommands() {
  const { onOpen, onSave, onSaveAs, createNewFile } = useFile();
  const { setWorkSpace } = useWorkSpace();
  const { toggleSourceCode } = useSourceCode();
  const { currentTab, activeTabId, tabs, closeWithConfirm, switchToTab } = useTab();
  const { zoomIn, zoomOut, resetZoom } = useEditorZoom();
  const { config, setConf } = useConfig();
  const { markdown } = useContent();

  function toggleViewMode(key: "focusMode" | "typewriterMode"): void {
    const next = !config.value.view?.[key];
    setConf("view", { ...config.value.view, [key]: next });
    const label = key === "focusMode" ? "专注模式" : "打字机模式";
    autotoast.show(next ? `已开启${label}` : `已关闭${label}`);
  }

  /** 在中英文之间插入空格（对应 typora_plugin 的 md_padding） */
  function formatDocumentCjkSpacing(): void {
    const source = markdown.value;
    if (!source) return;
    const formatted = formatCjkSpacing(source);
    if (formatted === source) {
      autotoast.show("当前文档无需调整中英文间距");
      return;
    }
    markdown.value = formatted;
    autotoast.show("已在中英文之间插入空格", "success");
  }

  /** 格式化文档中的所有表格（对应 typora_plugin easy_modify 的 reformatTable） */
  function formatDocumentTables(): void {
    const source = markdown.value;
    if (!source) return;
    const formatted = formatMarkdownTables(source);
    if (formatted === source) {
      autotoast.show("当前文档没有需要格式化的表格");
      return;
    }
    markdown.value = formatted;
    autotoast.show("已格式化所有表格", "success");
  }

  /** 复制当前文件的完整路径（对应 typora_plugin easy_modify 的 copyFullPath） */
  async function copyCurrentFilePath(): Promise<void> {
    const filePath = currentTab.value?.filePath;
    if (!filePath) {
      autotoast.show("当前文档尚未保存");
      return;
    }

    try {
      if (window.electronAPI?.writeTextToClipboard) {
        await window.electronAPI.writeTextToClipboard(filePath);
      } else {
        await navigator.clipboard.writeText(filePath);
      }
      autotoast.show("已复制文件完整路径", "success");
    } catch {
      autotoast.show("复制路径失败", "error");
    }
  }

  function formatShortcut(id: ShortcutActionId): string {
    const def = DEFAULT_SHORTCUTS.find((item) => item.id === id);
    if (!def) return "";
    const customKey = config.value.shortcuts?.[id];
    const key = customKey === undefined ? def.defaultKey : (customKey ?? "");
    if (!key) return "";
    return formatKeyForDisplay(key);
  }

  function runEditorAction(id: ShortcutActionId): void {
    emitter.emit("editor:command", { id });
  }

  function runEditorSearch(replace: boolean): void {
    emitter.emit("editor:search", { replace });
  }

  const commands = computed<PaletteCommand[]>(() => {
    const hasTab = Boolean(currentTab.value);

    const list: PaletteCommand[] = [
      // 文件
      {
        id: "file:new",
        title: "新建文件",
        category: "文件",
        keywords: ["new", "xinjian"],
        run: () => void createNewFile(),
      },
      {
        id: "file:open",
        title: "打开文件…",
        category: "文件",
        keywords: ["open", "dakai"],
        run: () => void onOpen(),
      },
      {
        id: "file:open-folder",
        title: "打开文件夹…",
        category: "文件",
        keywords: ["workspace", "folder", "dakao wenjianjia"],
        run: () => {
          void setWorkSpace().catch(() => {
            /* 用户取消选择 */
          });
        },
      },
      {
        id: "file:save",
        title: "保存",
        category: "文件",
        keywords: ["save", "baocun"],
        shortcut: "Ctrl+S",
        enabled: hasTab,
        run: () => void onSave(),
      },
      {
        id: "file:save-as",
        title: "另存为…",
        category: "文件",
        keywords: ["save as", "lingcunwei"],
        shortcut: "Ctrl+Shift+S",
        enabled: hasTab,
        run: () => void onSaveAs(),
      },
      {
        id: "file:copy-path",
        title: "复制文件完整路径",
        category: "文件",
        keywords: ["copy path", "full path", "fuzhi lujing"],
        enabled: hasTab && Boolean(currentTab.value?.filePath),
        run: () => void copyCurrentFilePath(),
      },
      {
        id: "file:extract-selection",
        title: "提取选区为新文件",
        category: "文件",
        keywords: ["extract", "selection", "new file", "tiqu xuanqu"],
        enabled: hasTab,
        run: () => emitter.emit("editor:extract-selection"),
      },
      {
        id: "file:close-tab",
        title: "关闭当前标签页",
        category: "文件",
        keywords: ["close tab", "guanbi"],
        enabled: hasTab && Boolean(activeTabId.value),
        run: () => {
          if (activeTabId.value) {
            void closeWithConfirm(activeTabId.value);
          }
        },
      },
      {
        id: "file:quick-open",
        title: "快速打开文件…",
        category: "文件",
        keywords: ["quick open", "kuaisu dakai"],
        shortcut: "Ctrl+P",
        run: () => openQuickOpen("files"),
      },
      {
        id: "workspace:search",
        title: "在工作区中搜索…",
        category: "搜索",
        keywords: ["search workspace", "grep", "quanwen jiansuo", "全文搜索"],
        shortcut: "Ctrl+Shift+F",
        run: () => openWorkspaceSearch(),
      },
      {
        id: "bookmark:toggle",
        title: "添加/移除当前块书签",
        category: "书签",
        keywords: ["bookmark", "shuqian", "标记"],
        enabled: hasTab,
        run: () => emitter.emit("editor:toggle-bookmark"),
      },
      {
        id: "bookmark:list",
        title: "打开书签列表",
        category: "书签",
        keywords: ["bookmarks", "shuqian liebiao"],
        run: () => emitter.emit("bookmarks:show-bar"),
      },
      {
        id: "outline:show",
        title: "打开大纲栏",
        category: "大纲",
        keywords: ["outline", "dagang", "mulu", "biaoti"],
        run: () => emitter.emit("outline:show-bar"),
      },

      // 编辑
      {
        id: "edit:undo",
        title: "撤销",
        category: "编辑",
        keywords: ["undo", "chexiao"],
        shortcut: formatShortcut("undo"),
        enabled: hasTab,
        run: () => runEditorAction("undo"),
      },
      {
        id: "edit:redo",
        title: "重做",
        category: "编辑",
        keywords: ["redo", "chongzuo"],
        shortcut: formatShortcut("redo"),
        enabled: hasTab,
        run: () => runEditorAction("redo"),
      },
      {
        id: "edit:find",
        title: "查找",
        category: "编辑",
        keywords: ["find", "search", "chazhao"],
        shortcut: "Ctrl+F",
        enabled: hasTab,
        run: () => runEditorSearch(false),
      },
      {
        id: "edit:replace",
        title: "替换",
        category: "编辑",
        keywords: ["replace", "tihuan"],
        shortcut: "Ctrl+H",
        enabled: hasTab,
        run: () => runEditorSearch(true),
      },

      // 格式
      {
        id: "format:strong",
        title: "粗体",
        category: "格式",
        keywords: ["bold", "cuti"],
        shortcut: formatShortcut("toggleStrong"),
        enabled: hasTab,
        run: () => runEditorAction("toggleStrong"),
      },
      {
        id: "format:emphasis",
        title: "斜体",
        category: "格式",
        keywords: ["italic", "xieti"],
        shortcut: formatShortcut("toggleEmphasis"),
        enabled: hasTab,
        run: () => runEditorAction("toggleEmphasis"),
      },
      {
        id: "format:strikethrough",
        title: "删除线",
        category: "格式",
        keywords: ["strikethrough", "shanchuxian"],
        shortcut: formatShortcut("toggleStrikethrough"),
        enabled: hasTab,
        run: () => runEditorAction("toggleStrikethrough"),
      },
      {
        id: "format:highlight",
        title: "高亮",
        category: "格式",
        keywords: ["highlight", "gaoliang"],
        shortcut: formatShortcut("toggleHighlight"),
        enabled: hasTab,
        run: () => runEditorAction("toggleHighlight"),
      },
      {
        id: "format:code-inline",
        title: "行内代码",
        category: "格式",
        keywords: ["inline code", "hangnei daima"],
        shortcut: formatShortcut("toggleCodeInline"),
        enabled: hasTab,
        run: () => runEditorAction("toggleCodeInline"),
      },
      {
        id: "format:underline",
        title: "下划线",
        category: "格式",
        keywords: ["underline", "xiahuaxian"],
        shortcut: formatShortcut("toggleUnderline"),
        enabled: hasTab,
        run: () => runEditorAction("toggleUnderline"),
      },
      {
        id: "format:superscript",
        title: "上标",
        category: "格式",
        keywords: ["superscript", "shangbiao"],
        shortcut: formatShortcut("toggleSuperscript"),
        enabled: hasTab,
        run: () => runEditorAction("toggleSuperscript"),
      },
      {
        id: "format:subscript",
        title: "下标",
        category: "格式",
        keywords: ["subscript", "xiabiao"],
        shortcut: formatShortcut("toggleSubscript"),
        enabled: hasTab,
        run: () => runEditorAction("toggleSubscript"),
      },
      {
        id: "format:insert-link",
        title: "插入链接",
        category: "格式",
        keywords: ["link", "hyperlink", "lianjie", "url"],
        shortcut: "Ctrl+K",
        enabled: hasTab,
        run: () => emitter.emit("editor:insert-link"),
      },
      {
        id: "format:cjk-spacing",
        title: "中英文之间加空格",
        category: "格式",
        keywords: ["md_padding", "cjk", "spacing", "空格", "zhongyingwen"],
        enabled: hasTab,
        run: () => formatDocumentCjkSpacing(),
      },
      {
        id: "format:table-format",
        title: "格式化所有表格",
        category: "格式",
        keywords: ["table", "reformat", "biaoge", "对齐"],
        enabled: hasTab,
        run: () => formatDocumentTables(),
      },

      // 段落
      ...([1, 2, 3, 4, 5, 6] as const).map((level) => ({
        id: `paragraph:heading-${level}`,
        title: `${level} 级标题`,
        category: "段落",
        keywords: ["heading", `标题${level}`],
        shortcut: formatShortcut(`setHeading${level}` as ShortcutActionId),
        enabled: hasTab,
        run: () => runEditorAction(`setHeading${level}` as ShortcutActionId),
      })),
      {
        id: "paragraph:promote-heading",
        title: "提升标题级别",
        category: "段落",
        keywords: ["heading", "promote", "increase", "shengji biaoti"],
        shortcut: formatShortcut("promoteHeading"),
        enabled: hasTab,
        run: () => runEditorAction("promoteHeading"),
      },
      {
        id: "paragraph:demote-heading",
        title: "降低标题级别",
        category: "段落",
        keywords: ["heading", "demote", "decrease", "jiangji biaoti"],
        shortcut: formatShortcut("demoteHeading"),
        enabled: hasTab,
        run: () => runEditorAction("demoteHeading"),
      },
      {
        id: "paragraph:text",
        title: "正文段落",
        category: "段落",
        keywords: ["paragraph", "zhengwen"],
        enabled: hasTab,
        run: () => runEditorAction("setParagraph"),
      },
      {
        id: "paragraph:code-block",
        title: "代码块",
        category: "段落",
        keywords: ["code block", "daimakuai"],
        enabled: hasTab,
        run: () => runEditorAction("setCodeBlock"),
      },
      {
        id: "paragraph:blockquote",
        title: "引用",
        category: "段落",
        keywords: ["quote", "yinyong"],
        enabled: hasTab,
        run: () => runEditorAction("wrapInBlockquote"),
      },
      {
        id: "paragraph:bullet-list",
        title: "无序列表",
        category: "段落",
        keywords: ["bullet list", "wuxu liebiao"],
        enabled: hasTab,
        run: () => runEditorAction("wrapInBulletList"),
      },
      {
        id: "paragraph:ordered-list",
        title: "有序列表",
        category: "段落",
        keywords: ["ordered list", "youxu liebiao"],
        enabled: hasTab,
        run: () => runEditorAction("wrapInOrderedList"),
      },
      {
        id: "paragraph:horizontal-rule",
        title: "插入分割线",
        category: "段落",
        keywords: ["horizontal rule", "fengexian"],
        enabled: hasTab,
        run: () => runEditorAction("insertHorizontalRule"),
      },
      {
        id: "paragraph:table",
        title: "插入表格",
        category: "段落",
        keywords: ["table", "biaoge"],
        enabled: hasTab,
        run: () => runEditorAction("insertTable"),
      },
      {
        id: "paragraph:math-block",
        title: "插入数学公式块",
        category: "段落",
        keywords: ["math", "katex", "shuxue"],
        enabled: hasTab,
        run: () => runEditorAction("insertMathBlock"),
      },

      // 视图
      {
        id: "view:toggle-source",
        title: "切换源码模式",
        category: "视图",
        keywords: ["source mode", "yuanma"],
        enabled: hasTab,
        run: () => toggleSourceCode(),
      },
      {
        id: "view:toggle-focus",
        title: "切换专注模式",
        category: "视图",
        keywords: ["focus mode", "zhuanzhu", "聚焦"],
        enabled: hasTab,
        run: () => toggleViewMode("focusMode"),
      },
      {
        id: "view:toggle-typewriter",
        title: "切换打字机模式",
        category: "视图",
        keywords: ["typewriter mode", "daziji"],
        enabled: hasTab,
        run: () => toggleViewMode("typewriterMode"),
      },
      {
        id: "view:toggle-outline",
        title: "切换侧边栏",
        category: "视图",
        keywords: ["outline", "sidebar", "dagang"],
        run: () => toggleShowOutline(),
      },
      {
        id: "view:zoom-in",
        title: "放大编辑区",
        category: "视图",
        keywords: ["zoom in", "fangda"],
        run: () => zoomIn(),
      },
      {
        id: "view:zoom-out",
        title: "缩小编辑区",
        category: "视图",
        keywords: ["zoom out", "suoxiao"],
        run: () => zoomOut(),
      },
      {
        id: "view:zoom-reset",
        title: "重置编辑区缩放",
        category: "视图",
        keywords: ["zoom reset", "chongzhi"],
        run: () => resetZoom(),
      },
    ];

    // 动态命令：切换到已打开的标签页
    if (tabs.value.length > 1) {
      for (const tab of tabs.value) {
        list.push({
          id: `tab:switch:${tab.id}`,
          title: `切换到：${tab.name}`,
          category: "标签页",
          keywords: ["switch tab", "qiehuan"],
          enabled: tab.id !== activeTabId.value,
          run: () => void switchToTab(tab.id),
        });
      }
    }

    return list;
  });

  return { commands };
}

export default useAppCommands;
