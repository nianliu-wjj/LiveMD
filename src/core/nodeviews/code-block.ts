/**
 * Livemd 代码块 NodeView
 *
 * 使用 CodeMirror 6 实现代码块编辑
 * 支持语法高亮和 Mermaid 图表预览
 * 支持源码模式显示完整 Markdown 语法
 */

import { Node as ProseMirrorNode } from "prosemirror-model";
import { EditorView as ProseMirrorView, NodeView } from "prosemirror-view";
import { Selection, TextSelection } from "prosemirror-state";
import {
  EditorView,
  keymap as cmKeymap,
  ViewUpdate,
  lineNumbers,
  Decoration as CMDecoration,
} from "@codemirror/view";
import { EditorState as CMEditorState, Compartment, Extension } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  HighlightStyle,
  indentOnInput,
  indentUnit,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import {
  CODE_BLOCK_LAZY,
  CODE_BLOCK_ROOT_MARGIN,
  observeNearViewport,
  scheduleCodeBlockBuild,
} from "./code-block-lazy";
import { getLoadedLanguageExtension, loadLanguageExtension } from "./code-block-languages";
import { sourceViewManager } from "../decorations";
import { searchPluginKey } from "../plugins/search";
import {
  buildCodeClipboardPayload,
  canDeleteAfterClipboardWrite,
  createCodeClipboardExtension,
  getCodeClipboardOptions,
  requestClipboardPngFallback,
  writeClipboardPayload,
} from "../clipboard";
import { canFoldCodeBlock, getCodeBlockFoldHeight } from "./code-block-fold";
import { formatCode, getFormatSupport } from "../utils/code-formatter";
import { describeIndentRule, getIndentRule, reindentCode } from "../utils/code-indent";
import { openMermaidFullscreen, normalizeRenderedMermaidViewport } from "./mermaid-fullscreen";
import { FULLSCREEN_ICONS, type FullscreenViewerHandle } from "../viewers/fullscreenViewer";

const FOLD_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>`;
const UNFOLD_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;

/** Mermaid 显示模式 */
type MermaidDisplayMode = "code" | "mixed" | "diagram";

/** 暗色主题高亮样式 */
export const darkHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#ff7b72" },
  { tag: tags.operator, color: "#79c0ff" },
  { tag: tags.special(tags.variableName), color: "#ffa657" },
  { tag: tags.typeName, color: "#ffa657" },
  { tag: tags.atom, color: "#79c0ff" },
  { tag: tags.number, color: "#79c0ff" },
  { tag: tags.definition(tags.variableName), color: "#d2a8ff" },
  { tag: tags.string, color: "#a5d6ff" },
  { tag: tags.special(tags.string), color: "#a5d6ff" },
  { tag: tags.comment, color: "#8b949e", fontStyle: "italic" },
  { tag: tags.variableName, color: "#c9d1d9" },
  { tag: tags.tagName, color: "#7ee787" },
  { tag: tags.propertyName, color: "#79c0ff" },
  { tag: tags.attributeName, color: "#79c0ff" },
  { tag: tags.className, color: "#ffa657" },
  { tag: tags.labelName, color: "#d2a8ff" },
  { tag: tags.namespace, color: "#ff7b72" },
  { tag: tags.macroName, color: "#d2a8ff" },
  { tag: tags.literal, color: "#79c0ff" },
  { tag: tags.bool, color: "#79c0ff" },
  { tag: tags.null, color: "#79c0ff" },
  { tag: tags.punctuation, color: "#c9d1d9" },
  { tag: tags.bracket, color: "#c9d1d9" },
  { tag: tags.meta, color: "#8b949e" },
  { tag: tags.link, color: "#58a6ff", textDecoration: "underline" },
  { tag: tags.heading, color: "#79c0ff", fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
]);

/**
 * 检测当前主题是否为暗色模式
 */
export function detectDarkTheme(): boolean {
  const htmlElement = document.documentElement;
  const themeClass = Array.from(htmlElement.classList).find((c) => c.startsWith("theme-"));
  if (!themeClass) return false;
  return themeClass.includes("dark");
}

/**
 * 全局 mermaid 渲染队列，保证同一时刻只有一个 render 在执行
 */
let mermaidRenderQueue: Promise<void> = Promise.resolve();
/** 全局唯一展开中的代码块下拉框（语言 / Mermaid 模式）的关闭函数：打开新的下拉框前先关闭旧的 */
let activeCustomSelectClose: (() => void) | null = null;
let mermaidIdCounter = 0;

/** Mermaid 原始 SVG 缓存：键为「主题签名 + 图表源码」，避免滚动/切换时重复渲染 */
const MERMAID_SVG_CACHE_LIMIT = 96;
const mermaidSvgCache = new Map<string, string>();

/** 动态 import 只发起一次；失败后清空，允许用户下次重试 */
let mermaidModulePromise: Promise<typeof import("mermaid")> | null = null;

function loadMermaidModule(): Promise<typeof import("mermaid")> {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import("mermaid").catch((error) => {
      mermaidModulePromise = null;
      throw error;
    });
  }
  return mermaidModulePromise;
}

function getMermaidCacheKey(content: string): string {
  if (typeof getComputedStyle !== "function") return `light::${content}`;
  const style = getComputedStyle(document.documentElement);
  const signature = [
    detectDarkTheme() ? "dark" : "light",
    style.getPropertyValue("--primary-color").trim(),
    style.getPropertyValue("--background-color-1").trim(),
    style.getPropertyValue("--text-color").trim(),
  ].join("|");
  return `${signature}::${content}`;
}

function readMermaidCache(key: string): string | undefined {
  const cached = mermaidSvgCache.get(key);
  if (cached === undefined) return undefined;
  mermaidSvgCache.delete(key);
  mermaidSvgCache.set(key, cached);
  return cached;
}

function writeMermaidCache(key: string, svg: string): void {
  mermaidSvgCache.set(key, svg);
  if (mermaidSvgCache.size > MERMAID_SVG_CACHE_LIMIT) {
    const oldest = mermaidSvgCache.keys().next().value;
    if (oldest !== undefined) mermaidSvgCache.delete(oldest);
  }
}

// 「接近视口」共享观察器与分帧构建队列见 ./code-block-lazy.ts

/** 骨架估高：代码行高（14px 等宽字体 × CodeMirror 默认 line-height 1.4 ≈ 20px） */
const CODE_LINE_HEIGHT_PX = 20;
/** 骨架估高：编辑区上下内边距（12 + 34）+ 边框（2）+ 底部点击区（12 − 4） */
const CODE_BLOCK_CHROME_HEIGHT_PX = 56;

/**
 * 共享主题观察器：主题切换时统一通知所有代码块，避免每个 NodeView 都挂一个
 * MutationObserver（大文档中数百个代码块会产生数百个观察器）。
 */
const themeChangeListeners = new Set<() => void>();
let sharedThemeObserver: MutationObserver | null = null;

function subscribeThemeChange(listener: () => void): () => void {
  themeChangeListeners.add(listener);

  if (!sharedThemeObserver && typeof MutationObserver !== "undefined") {
    sharedThemeObserver = new MutationObserver((mutations) => {
      if (!mutations.some((m) => m.type === "attributes" && m.attributeName === "class")) {
        return;
      }
      for (const notify of Array.from(themeChangeListeners)) notify();
    });
    sharedThemeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }

  return () => {
    themeChangeListeners.delete(listener);
    if (themeChangeListeners.size === 0 && sharedThemeObserver) {
      sharedThemeObserver.disconnect();
      sharedThemeObserver = null;
    }
  };
}

/**
 * 从当前 CSS 变量中生成 Mermaid 主题变量，实现与编辑器主题的精确适配
 */
/**
 * 将任意 CSS 颜色值解析为 [r, g, b]，解析失败返回 null
 */
function parseColorToRGB(color: string): [number, number, number] | null {
  if (!color || color === "none" || color === "transparent" || color.startsWith("url("))
    return null;
  const s = color.trim().toLowerCase();

  // #rgb / #rrggbb
  const hexMatch = s.match(/^#([0-9a-f]{3,8})$/);
  if (hexMatch) {
    const h = hexMatch[1];
    if (h.length === 3 || h.length === 4) {
      return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
    }
    if (h.length >= 6) {
      return [
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16),
      ];
    }
  }

  // rgb(r, g, b) / rgba(r, g, b, a)
  const rgbMatch = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    return [parseInt(rgbMatch[1]), parseInt(rgbMatch[2]), parseInt(rgbMatch[3])];
  }

  return null;
}

/**
 * 根据背景色亮度返回适合的文字颜色
 */
function contrastTextColor(color: string): string {
  const rgb = parseColorToRGB(color);
  if (!rgb) return "#ffffff";
  const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  return luminance > 0.5 ? "#222222" : "#ffffff";
}

/**
 * 渲染后修正：仅处理用户在图表语法中通过 style 自定义了 fill 的元素，
 * 根据其实际背景色调整文本颜色。mermaid 主题自动派生的颜色不干预。
 */
function fixMermaidTextContrast(container: HTMLElement): void {
  // 找所有有行内 style.fill 的形状（用户自定义颜色）
  const shapes = container.querySelectorAll(
    "rect[style], circle[style], polygon[style], path[style], ellipse[style]"
  );

  shapes.forEach((shape) => {
    const el = shape as SVGElement;
    // 只处理行内 style 中显式设置了 fill 的元素
    if (!el.style.fill) return;
    const rgb = parseColorToRGB(el.style.fill);
    if (!rgb) return;

    const textColor = contrastTextColor(el.style.fill);
    const group = el.closest("g");
    if (!group) return;

    group.querySelectorAll(".nodeLabel, .label div").forEach((label) => {
      (label as HTMLElement).style.color = textColor;
    });
    group.querySelectorAll("text").forEach((text) => {
      text.setAttribute("fill", textColor);
    });
  });
}

function padMermaidSvgBounds(container: HTMLElement): void {
  const svg = container.querySelector("svg");
  if (!svg) return;

  const padding = 8;
  svg.style.overflow = "visible";

  const viewBox = svg.getAttribute("viewBox");
  if (viewBox) {
    const values = viewBox
      .trim()
      .split(/[\s,]+/)
      .map((value) => Number(value));

    if (values.length === 4 && values.every(Number.isFinite)) {
      const [x, y, width, height] = values;
      svg.setAttribute(
        "viewBox",
        `${x - padding} ${y - padding} ${width + padding * 2} ${height + padding * 2}`
      );
    }
  }

  const expandNumericAttr = (element: Element, attr: "x" | "width", delta: number) => {
    const rawValue = element.getAttribute(attr);
    if (!rawValue) return;

    const value = Number(rawValue);
    if (!Number.isFinite(value)) return;

    element.setAttribute(attr, String(value + delta));
  };

  container.querySelectorAll("foreignObject").forEach((foreignObject) => {
    (foreignObject as SVGElement).style.overflow = "visible";
    expandNumericAttr(foreignObject, "x", -padding / 2);
    expandNumericAttr(foreignObject, "width", padding);
  });

  container.querySelectorAll(".nodeLabel, .edgeLabel, .label").forEach((label) => {
    (label as HTMLElement).style.overflow = "visible";
  });
}

function getMermaidThemeVariables(): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  const get = (prop: string) => style.getPropertyValue(prop).trim();

  const primaryColor = get("--primary-color");
  const secondaryColor = get("--secondary-color");
  const backgroundColor = get("--background-color-1");
  const bgColor2 = get("--background-color-2");
  const bgColor3 = get("--background-color-3");
  const textColor = get("--text-color");
  const textColor2 = get("--text-color-2");
  const borderColor = get("--border-color");

  const isDark = detectDarkTheme();

  // 文字色（primaryTextColor / secondaryTextColor / tertiaryTextColor）
  // 不手动覆盖，交给 mermaid 根据 darkMode 自动从背景色推算对比色

  return {
    // ---- 基色 ----
    primaryColor,
    primaryBorderColor: borderColor,
    secondaryColor: bgColor2,
    secondaryBorderColor: borderColor,
    tertiaryColor: bgColor3,
    tertiaryBorderColor: borderColor,
    lineColor: textColor2,
    textColor,
    background: backgroundColor,
    mainBkg: isDark ? textColor2 : backgroundColor,
    nodeBorder: borderColor,
    titleColor: textColor,
    edgeLabelBackground: backgroundColor,

    // ---- Sequence ----
    actorBkg: backgroundColor,
    actorBorder: borderColor,
    actorTextColor: textColor,
    actorLineColor: textColor2,
    signalColor: textColor2,
    signalTextColor: textColor,
    labelBoxBkgColor: backgroundColor,
    labelBoxBorderColor: borderColor,
    labelTextColor: textColor,
    loopTextColor: textColor,
    activationBorderColor: borderColor,
    activationBkgColor: bgColor2,

    // ---- Note ----
    noteBkgColor: bgColor2,
    noteBorderColor: borderColor,

    // ---- Cluster / Subgraph ----
    clusterBkg: bgColor2,
    clusterBorder: borderColor,

    // ---- State Diagram ----
    altBackground: bgColor2,

    // ---- ER Diagram ----
    attributeBackgroundColorEven: backgroundColor,
    attributeBackgroundColorOdd: bgColor2,

    // ---- Pie Chart ----
    pie1: primaryColor,
    pie2: secondaryColor || bgColor2,
    pie3: bgColor3,
    pie4: textColor2,
    pieTitleTextColor: textColor,
    pieLegendTextColor: textColor,
    pieStrokeColor: borderColor,
    pieOuterStrokeColor: borderColor,
    pieOpacity: "0.9",

    // ---- Gantt ----
    gridColor: borderColor,
    todayLineColor: primaryColor,
    taskTextOutsideColor: textColor,
    taskTextClickableColor: primaryColor,
    activeTaskBkgColor: primaryColor,
    activeTaskBorderColor: borderColor,
    doneTaskBkgColor: bgColor3,
    doneTaskBorderColor: borderColor,
    critBkgColor: isDark ? "#bf616a" : "#d08770",
    critBorderColor: isDark ? "#bf616a" : "#d08770",
    sectionBkgColor: bgColor2,
    sectionBkgColor2: bgColor3,
    taskBkgColor: bgColor2,
    taskBorderColor: borderColor,

    // ---- Git Graph ----
    git0: primaryColor,
    git1: secondaryColor || bgColor2,
    git2: bgColor3,
    git3: textColor2,
    gitInv0: backgroundColor,
    commitLabelColor: textColor,
    commitLabelBackground: backgroundColor,
    tagLabelColor: textColor,
    tagLabelBackground: bgColor2,
    tagLabelBorder: borderColor,

    // ---- Journey ----
    fillType0: primaryColor,
    fillType1: bgColor2,
    fillType2: bgColor3,
    fillType3: textColor2,
  };
}

/**
 * 创建 CodeMirror 主题扩展（使用 CSS 变量）
 */
export function createThemeExtension(isDark: boolean): Extension[] {
  const baseTheme = EditorView.theme(
    {
      "&": {
        backgroundColor: "transparent",
        color: "var(--text-color)",
      },
      ".cm-content": {
        caretColor: "var(--text-color)",
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "var(--text-color)",
      },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: "var(--selected-background-color)",
      },
      ".cm-activeLine": {
        backgroundColor: "transparent",
      },
      ".cm-gutters": {
        backgroundColor: "transparent",
        color: "var(--text-color-3)",
        border: "none",
      },
      ".cm-activeLineGutter": {
        backgroundColor: "transparent",
      },
      ".cm-lineNumbers .cm-gutterElement": {
        color: "var(--text-color-3)",
      },
    },
    { dark: isDark }
  );

  const highlightStyle = isDark ? darkHighlightStyle : defaultHighlightStyle;
  return [baseTheme, syntaxHighlighting(highlightStyle)];
}

// 语言扩展映射与按需加载见 ./code-block-languages.ts（动态 import + 实例缓存）

/** 语言别名映射（用于显示） */
const languageAliases: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  py: "python",
  md: "markdown",
  "c++": "cpp",
  rs: "rust",
  yml: "yaml",
  rb: "ruby",
  sh: "shell",
  "c#": "csharp",
  cs: "csharp",
  kt: "kotlin",
  objc: "objective-c",
  m: "matlab",
  pl: "perl",
  ps1: "powershell",
};

/** 支持的语言列表 */
const supportedLanguages = [
  { value: "", label: "plain text" },
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "python", label: "Python" },
  { value: "java", label: "Java" },
  { value: "cpp", label: "C++" },
  { value: "c", label: "C" },
  { value: "csharp", label: "C#" },
  { value: "php", label: "PHP" },
  { value: "ruby", label: "Ruby" },
  { value: "go", label: "Go" },
  { value: "rust", label: "Rust" },
  { value: "swift", label: "Swift" },
  { value: "kotlin", label: "Kotlin" },
  { value: "scala", label: "Scala" },
  { value: "objective-c", label: "Objective-C" },
  { value: "html", label: "HTML" },
  { value: "css", label: "CSS" },
  { value: "sql", label: "SQL" },
  { value: "shell", label: "Shell" },
  { value: "bash", label: "Bash" },
  { value: "powershell", label: "PowerShell" },
  { value: "json", label: "JSON" },
  { value: "xml", label: "XML" },
  { value: "yaml", label: "YAML" },
  { value: "toml", label: "TOML" },
  { value: "markdown", label: "Markdown" },
  { value: "dockerfile", label: "Dockerfile" },
  { value: "lua", label: "Lua" },
  { value: "matlab", label: "MATLAB" },
  { value: "perl", label: "Perl" },
  { value: "octave", label: "Octave" },
  { value: "r", label: "R" },
  { value: "mermaid", label: "Mermaid" },
];

/** Mermaid 显示模式选项 */
const mermaidDisplayModes = [
  { value: "code", label: "代码" },
  { value: "mixed", label: "混合" },
  { value: "diagram", label: "图表" },
];

/** 全局 Mermaid 默认显示模式 */
let globalMermaidDefaultMode: MermaidDisplayMode = "diagram";

/** 设置全局 Mermaid 默认显示模式 */
export function setGlobalMermaidDefaultMode(mode: MermaidDisplayMode): void {
  globalMermaidDefaultMode = mode;
}

/**
 * 规范化语言名称
 */
function normalizeLanguage(language: string): string {
  const lower = language.toLowerCase();
  return languageAliases[lower] || lower;
}

/**
 * 同步获取已可用的语言扩展（legacy 模式或已缓存的动态包）。
 * 未加载的动态包先返回空扩展，由 CodeBlockView.applyLanguageExtension 异步加载后再注入 Compartment。
 */
function getLanguageExtension(language: string): Extension {
  return getLoadedLanguageExtension(language) ?? [];
}

/**
 * 按语言构建缩进扩展：indentUnit 决定 Enter 自动缩进与 Tab / Shift-Tab 每级插入的内容，
 * tabSize 决定制表符显示宽度；indentOnInput 让输入 `}` `]` 等字符时按语法自动回退缩进。
 * 各语言包（如 Python）的缩进服务会读取 indentUnit，因此配置 4 空格即满足 PEP 8。
 */
function buildIndentExtension(language: string): Extension {
  const rule = getIndentRule(language);
  return [indentUnit.of(rule.unit), CMEditorState.tabSize.of(rule.tabSize), indentOnInput()];
}

/**
 * 代码块 NodeView 类
 */
export class CodeBlockView implements NodeView {
  dom: HTMLElement;
  /** CodeMirror 实例按需创建；未创建时显示轻量静态 <pre> 占位 */
  cm: EditorView | null = null;
  node: ProseMirrorNode;
  view: ProseMirrorView;
  getPos: () => number | undefined;
  updating = false;
  languageCompartment: Compartment;
  themeCompartment: Compartment;
  lineNumbersCompartment: Compartment;
  searchHighlightCompartment: Compartment;
  /** 缩进规则（随语言切换 reconfigure） */
  indentCompartment: Compartment;
  mermaidPreview: HTMLElement | null = null;
  mermaidDisplayMode: MermaidDisplayMode = globalMermaidDefaultMode;
  headerElement: HTMLElement | null = null;
  foldButton: HTMLButtonElement | null = null;
  /** Mermaid 全屏查看按钮 */
  mermaidExpandButton: HTMLButtonElement | null = null;
  /** 当前打开的 Mermaid 全屏查看器 */
  private mermaidViewer: FullscreenViewerHandle | null = null;
  editorContainer: HTMLElement | null = null;
  contextMenu: HTMLElement | null = null;
  private folded = false;
  sourceTextElement: HTMLElement | null = null; // 源码模式下的纯文本显示元素
  /** 未创建 CodeMirror 时的静态代码占位 */
  private staticPreview: HTMLElement | null = null;
  /** 取消「接近视口」观察 */
  private lazyUnobserve: (() => void) | null = null;
  /** 撤销已入队但尚未执行的构建任务 */
  private cancelQueuedBuild: (() => void) | null = null;
  /** NodeView 已销毁：队列中迟到的构建任务与异步语言包回调据此丢弃 */
  private destroyed = false;
  /** 语言包异步加载令牌：期间语言又变时丢弃过期结果 */
  private languageLoadToken = 0;
  /** 取消 Mermaid 预览的「接近视口」观察 */
  private mermaidLazyUnobserve: (() => void) | null = null;
  /** Mermaid 异步渲染令牌：内容变化后丢弃过期结果 */
  private mermaidRenderToken = 0;
  /** 取消共享主题变化订阅 */
  private themeUnsubscribe: (() => void) | null = null;
  /** 本代码块当前展开的下拉框关闭函数（弹层挂在 body 上，销毁/重建头部时需主动关闭） */
  private openSelectClosers = new Set<() => void>();
  // 源码模式相关
  private sourceViewMode: boolean = false;
  private sourceViewUnsubscribe: (() => void) | null = null;
  private readonly isReadOnly: () => boolean;

  constructor(
    node: ProseMirrorNode,
    view: ProseMirrorView,
    getPos: () => number | undefined,
    isReadOnly: () => boolean = () => false
  ) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.isReadOnly = isReadOnly;
    this.languageCompartment = new Compartment();
    this.themeCompartment = new Compartment();
    this.lineNumbersCompartment = new Compartment();
    this.searchHighlightCompartment = new Compartment();
    this.indentCompartment = new Compartment();

    // 规范化语言名称仅用于本地渲染（头部 / 高亮 / Mermaid 识别）。
    // 不在构造阶段回写文档：大文档中数百个代码块会因此触发数百次事务与全量语法扫描。
    const normalizedLang = normalizeLanguage(node.attrs.language);

    // 用户手动创建的 mermaid 代码块（内容为空），使用混合模式方便编辑
    if (normalizedLang === "mermaid" && !node.textContent) {
      this.mermaidDisplayMode = "mixed";
    }

    // 创建容器
    this.dom = document.createElement("div");
    this.dom.className = "livemd-code-block";

    // 创建头部（语言选择器）
    this.headerElement = this.createHeader(normalizedLang);
    this.dom.appendChild(this.headerElement);

    // 头部右键菜单
    this.headerElement.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.showContextMenu(e);
    });

    // 创建 CodeMirror 编辑器容器
    this.editorContainer = document.createElement("div");
    this.editorContainer.className = "livemd-code-block-editor";
    this.dom.appendChild(this.editorContainer);

    // 先渲染轻量静态骨架（含按行数估算的 contain-intrinsic-size），CodeMirror 在接近视口 /
    // 用户交互时再实例化；CODE_BLOCK_LAZY 关闭时回退为构造即同步直建（旧行为）
    this.setupStaticPreview();
    this.applyIntrinsicSizeEstimate();
    if (CODE_BLOCK_LAZY) {
      this.setupLazyRendering(normalizedLang);
    } else {
      this.ensureCodeMirror();
    }

    // 监听主题变化
    this.setupThemeObserver();

    // Mermaid 预览
    if (normalizedLang === "mermaid") {
      this.createMermaidPreview(node.textContent);
    }

    // 如果代码块是空的，自动聚焦（空块必须立即创建编辑器，否则用户无法输入）
    if (!node.textContent) {
      requestAnimationFrame(() => {
        this.ensureCodeMirror().focus();
      });
    }

    // 源码模式初始化
    this.initSourceViewMode(normalizedLang);

    // 初始化折叠按钮状态
    this.updateFoldAvailability();
  }

  /**
   * 创建静态代码占位
   *
   * 大文档中每个代码块都构造 CodeMirror 是首屏卡顿的主因；先渲染纯文本 <pre>，
   * 等块接近视口或用户点击时再替换为 CodeMirror。
   */
  private setupStaticPreview(): void {
    if (!this.editorContainer) return;

    const preview = document.createElement("pre");
    preview.className = "livemd-code-block-static";
    preview.textContent = this.node.textContent || " ";
    preview.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const { clientX, clientY } = event;
      const editor = this.ensureCodeMirror();
      editor.focus();
      requestAnimationFrame(() => {
        const pos = editor.posAtCoords({ x: clientX, y: clientY });
        if (pos !== null) {
          editor.dispatch({ selection: { anchor: pos } });
        }
      });
    });

    this.staticPreview = preview;
    this.editorContainer.appendChild(preview);
  }

  /**
   * 观察代码块是否接近视口，接近时再创建 CodeMirror。
   *
   * Mermaid 纯图表模式下编辑区被隐藏，此时不创建编辑器；用户切换模式 / 点击时再创建。
   */
  private setupLazyRendering(normalizedLang: string): void {
    const isMermaidDiagramOnly =
      normalizedLang === "mermaid" && this.mermaidDisplayMode === "diagram";
    if (isMermaidDiagramOnly) return;

    this.lazyUnobserve = observeNearViewport(
      this.dom,
      () => {
        this.lazyUnobserve = null;
        // 进入视口不立即建实例：交给全局队列按帧分批构建，一次滚动命中几十个块时不撑爆单帧
        this.cancelQueuedBuild = scheduleCodeBlockBuild(() => {
          this.cancelQueuedBuild = null;
          if (this.destroyed || this.cm) return;
          this.ensureCodeMirror();
        });
      },
      CODE_BLOCK_ROOT_MARGIN
    );
  }

  /**
   * 骨架阶段按行数估算块高度写入 contain-intrinsic-size，供 content-visibility 估高：
   * 几百行的代码块若按 CSS 兜底的 120px 占位，快速滚动时会出现大片空白。
   */
  private applyIntrinsicSizeEstimate(): void {
    const text = this.node.textContent;
    let lineCount = 1;
    for (let index = 0; index < text.length; index += 1) {
      if (text.charCodeAt(index) === 10) lineCount += 1;
    }
    const estimated = lineCount * CODE_LINE_HEIGHT_PX + CODE_BLOCK_CHROME_HEIGHT_PX;
    this.dom.style.setProperty("contain-intrinsic-size", `auto ${estimated}px`);
  }

  /**
   * 语言扩展注入：legacy 模式 / 已缓存的动态包同步生效；未加载的动态包异步 import 后再
   * reconfigure（期间语言又变或实例已销毁则丢弃结果）
   */
  private applyLanguageExtension(language: string): void {
    // 缩进规则同步切换（与语言包是否已加载无关，立即生效）
    this.cm?.dispatch({
      effects: this.indentCompartment.reconfigure(
        buildIndentExtension(normalizeLanguage(language))
      ),
    });
    const token = ++this.languageLoadToken;
    const loaded = getLoadedLanguageExtension(language);
    if (loaded) {
      this.cm?.dispatch({ effects: this.languageCompartment.reconfigure(loaded) });
      return;
    }
    void loadLanguageExtension(language).then((extension) => {
      if (token !== this.languageLoadToken || !this.cm || this.destroyed) return;
      this.cm.dispatch({ effects: this.languageCompartment.reconfigure(extension ?? []) });
    });
  }

  /**
   * 创建 CodeMirror 状态（首次进入视口或用户交互时调用）
   */
  private createCodeMirrorState(): CMEditorState {
    const isDark = detectDarkTheme();
    const normalizedLang = normalizeLanguage(this.node.attrs.language);

    return CMEditorState.create({
      doc: this.node.textContent,
      extensions: [
        history(),
        cmKeymap.of([
          {
            key: "Ctrl-Enter",
            run: () => {
              // 检查是否在列表中
              const pos = this.getPos();
              if (pos !== undefined) {
                const $pos = this.view.state.doc.resolve(pos);
                // 检查祖先节点中是否有 list_item
                let inList = false;
                for (let d = $pos.depth; d > 0; d--) {
                  const node = $pos.node(d);
                  if (node.type.name === "list_item" || node.type.name === "task_item") {
                    inList = true;
                    break;
                  }
                }
                if (inList) {
                  // 在列表中，创建新的列表项
                  this.exitCodeBlockAndCreateListItem();
                  return true;
                }
              }
              // 不在列表中，使用默认行为
              this.exitCodeBlock(1);
              return true;
            },
          },
          {
            key: "ArrowDown",
            run: (cmView) => {
              const { state } = cmView;
              const { main } = state.selection;
              const line = state.doc.lineAt(main.head);
              if (line.number === state.doc.lines) {
                this.exitCodeBlock(1);
                return true;
              }
              return false;
            },
          },
          {
            key: "ArrowUp",
            run: (cmView) => {
              const { state } = cmView;
              const { main } = state.selection;
              const line = state.doc.lineAt(main.head);
              if (line.number === 1) {
                this.exitCodeBlock(-1);
                return true;
              }
              return false;
            },
          },
          {
            key: "ArrowLeft",
            run: (cmView) => {
              const { state } = cmView;
              const { main } = state.selection;
              if (main.head === 0 && main.empty) {
                this.exitCodeBlock(-1);
                return true;
              }
              return false;
            },
          },
          {
            key: "ArrowRight",
            run: (cmView) => {
              const { state } = cmView;
              const { main } = state.selection;

              // 在第一位按右箭头，跳出代码块到开始围栏之前
              if (main.head === 0 && main.empty) {
                this.exitCodeBlock(-1);
                return true;
              }

              // 在最后一位按右箭头，跳出代码块
              if (main.head === state.doc.length && main.empty) {
                this.exitCodeBlock(1);
                return true;
              }

              return false;
            },
          },
          {
            key: "Backspace",
            run: (cmView) => {
              if (cmView.state.doc.length === 0) {
                this.deleteCodeBlock();
                return true;
              }
              return false;
            },
          },
          {
            key: "Mod-[",
            run: () => {
              if (!this.isFoldable()) return false;
              this.setFolded(!this.folded);
              return true;
            },
          },
          // Tab / Shift-Tab 按当前语言的缩进单位增减缩进（未命中上方自定义按键时生效）
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        this.indentCompartment.of(buildIndentExtension(normalizedLang)),
        this.themeCompartment.of(createThemeExtension(isDark)),
        this.languageCompartment.of(getLanguageExtension(normalizedLang)),
        this.lineNumbersCompartment.of(lineNumbers()),
        this.searchHighlightCompartment.of([]),
        createCodeClipboardExtension(() => this.isReadOnly()),
        EditorView.updateListener.of((update) => this.onCMUpdate(update)),
        EditorView.domEventHandlers({
          focus: () => this.forwardSelection(),
          blur: () => {},
          contextmenu: (e) => {
            e.preventDefault();
            this.showContextMenu(e);
            return true;
          },
        }),
      ],
    });
  }

  /**
   * 确保 CodeMirror 已创建，并返回实例
   */
  private ensureCodeMirror(): EditorView {
    if (this.cm) return this.cm;

    this.lazyUnobserve?.();
    this.lazyUnobserve = null;

    if (this.staticPreview) {
      this.staticPreview.style.display = "none";
    }

    const editor = new EditorView({
      state: this.createCodeMirrorState(),
      parent: this.editorContainer ?? this.dom,
    });
    this.cm = editor;

    // 动态语言包未就绪时先以无高亮建实例，加载完成后再注入（不阻塞实例创建）
    const normalizedLang = normalizeLanguage(this.node.attrs.language);
    if (normalizedLang && !getLoadedLanguageExtension(normalizedLang)) {
      this.applyLanguageExtension(normalizedLang);
    }

    this.updateSearchHighlights();
    this.updateFoldAvailability();
    if (this.folded) this.applyFoldHeight();

    return editor;
  }

  /**
   * 初始化源码模式
   */
  private initSourceViewMode(language: string): void {
    // 订阅源码模式状态变化
    this.sourceViewUnsubscribe = sourceViewManager.subscribe((sourceView) => {
      this.setSourceViewMode(sourceView);
    });
  }

  /**
   * 设置源码模式
   */
  private setSourceViewMode(enabled: boolean): void {
    if (this.sourceViewMode === enabled) return;
    this.sourceViewMode = enabled;

    if (enabled) {
      // 进入源码模式
      this.dom.classList.add("source-view");

      // 隐藏头部
      if (this.headerElement) {
        this.headerElement.style.display = "none";
      }

      // 隐藏 Mermaid 预览
      if (this.mermaidPreview) {
        this.mermaidPreview.style.display = "none";
      }

      // 隐藏 CodeMirror
      if (this.editorContainer) {
        this.editorContainer.style.display = "none";
      }

      // 创建源码容器（拆分成多行以参与行号计数）
      if (!this.sourceTextElement) {
        this.sourceTextElement = document.createElement("div");
        this.sourceTextElement.className = "livemd-code-block-source-container";
        this.sourceTextElement.contentEditable = "true";
        this.sourceTextElement.spellcheck = false;
        this.sourceTextElement.style.cssText = `
          position: relative;
          font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
          font-size: 14px;
          line-height: 1.6;
          padding: 0;
          margin: 0;
          color: inherit;
          background: transparent;
          border: none;
          outline: none;
        `;

        // 监听输入事件
        this.sourceTextElement.addEventListener("input", () => {
          this.handleSourceTextInput();
        });

        // 监听键盘事件
        this.sourceTextElement.addEventListener("keydown", (e) => {
          this.handleSourceTextKeydown(e);
        });

        // 阻止默认的粘贴行为，使用纯文本粘贴
        this.sourceTextElement.addEventListener("paste", (e) => {
          e.preventDefault();
          const text = e.clipboardData?.getData("text/plain") || "";
          document.execCommand("insertText", false, text);
        });
        this.sourceTextElement.addEventListener("copy", (e) => {
          this.handleSourceClipboard(e as ClipboardEvent, false);
        });
        this.sourceTextElement.addEventListener("cut", (e) => {
          this.handleSourceClipboard(e as ClipboardEvent, true);
        });

        this.dom.insertBefore(this.sourceTextElement, this.editorContainer);
      }

      // 更新源码内容（拆分成多行）
      const language = this.node.attrs.language || "";
      const content = this.node.textContent;
      const fullMarkdown = `\`\`\`${language}\n${content}\n\`\`\``;
      const lines = fullMarkdown.split("\n");

      // 清空容器
      this.sourceTextElement.innerHTML = "";

      // 为每一行创建一个 div 元素以参与行号计数
      lines.forEach((line) => {
        const lineDiv = document.createElement("div");
        lineDiv.className = "livemd-with-line-number";
        lineDiv.style.cssText = `
          white-space: pre;
          min-height: 1.6em;
        `;
        lineDiv.textContent = line;
        this.sourceTextElement!.appendChild(lineDiv);
      });

      this.sourceTextElement.style.display = "block";
    } else {
      // 退出源码模式
      this.dom.classList.remove("source-view");

      // 显示 CodeMirror
      if (this.editorContainer) {
        this.editorContainer.style.display = "";
      }

      // 显示头部
      if (this.headerElement) {
        this.headerElement.style.display = "";
      }

      // 隐藏源码文本元素
      if (this.sourceTextElement) {
        this.sourceTextElement.style.display = "none";
      }

      // 恢复 Mermaid 预览
      if (this.mermaidPreview && this.node.attrs.language === "mermaid") {
        this.updateMermaidDisplay();
      }
    }
  }

  /**
   * 处理源码文本输入
   */
  private handleSourceTextInput(): void {
    if (!this.sourceTextElement || this.updating) return;

    // 从所有子 div 中收集文本内容
    const lines: string[] = [];
    const childDivs = this.sourceTextElement.querySelectorAll("div.livemd-with-line-number");
    childDivs.forEach((div) => {
      lines.push(div.textContent || "");
    });
    const text = lines.join("\n");

    const pos = this.getPos();
    if (pos === undefined) return;

    // 保存光标位置
    const selection = window.getSelection();
    let cursorOffset = 0;
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (range.startContainer.nodeType === Node.TEXT_NODE) {
        cursorOffset = range.startOffset;
        // 计算相对于整个文本的偏移量
        let node: Node | null = range.startContainer;
        while (node && node !== this.sourceTextElement && node.previousSibling) {
          node = node.previousSibling;
          cursorOffset += node.textContent?.length || 0;
        }
      }
    }

    this.updating = true;

    // 检查是否是完整的代码块格式（必须有开头和结尾的 ```）
    const fenceMatch = text.match(/^```([^\n]*?)\n([\s\S]*?)\n```$/);

    if (fenceMatch) {
      // 仍然是完整的代码块格式，更新内容
      const [, language, content] = fenceMatch;
      const tr = this.view.state.tr;
      let needsUpdate = false;

      // 更新语言属性
      const normalizedLang = language || "";
      if (normalizedLang !== this.node.attrs.language) {
        tr.setNodeMarkup(pos, null, {
          ...this.node.attrs,
          language: normalizedLang,
        });
        needsUpdate = true;
      }

      // 更新内容
      if (content !== this.node.textContent) {
        const start = pos + 1;
        const end = pos + 1 + this.node.content.size;
        tr.replaceWith(start, end, content ? this.view.state.schema.text(content) : []);
        needsUpdate = true;
      }

      if (needsUpdate) {
        this.view.dispatch(tr);
      }

      // 更新行显示（重新拆分成多行）
      const newLines = text.split("\n");
      this.sourceTextElement.innerHTML = "";
      newLines.forEach((line) => {
        const lineDiv = document.createElement("div");
        lineDiv.className = "livemd-with-line-number";
        lineDiv.style.cssText = `
          white-space: pre;
          min-height: 1.6em;
        `;
        lineDiv.textContent = line;
        this.sourceTextElement!.appendChild(lineDiv);
      });
    } else {
      // 不是完整的代码块格式，转换为段落
      const tr = this.view.state.tr;
      const nodeEnd = pos + this.node.nodeSize;

      tr.delete(pos, nodeEnd);

      if (text.trim()) {
        const textLines = text.split("\n").filter((line) => line.trim());
        const paragraphs = textLines.map((line) =>
          this.view.state.schema.nodes.paragraph.create(
            null,
            line ? this.view.state.schema.text(line) : null
          )
        );

        if (paragraphs.length === 0) {
          paragraphs.push(this.view.state.schema.nodes.paragraph.create());
        }

        tr.insert(pos, paragraphs);
        const newPos = pos + 1;
        tr.setSelection(TextSelection.create(tr.doc, newPos));
      } else {
        const paragraph = this.view.state.schema.nodes.paragraph.create();
        tr.insert(pos, paragraph);
        const newPos = pos + 1;
        tr.setSelection(TextSelection.create(tr.doc, newPos));
      }

      this.view.dispatch(tr);
      this.view.focus();
    }

    this.updating = false;

    // 如果仍然是代码块,恢复光标位置
    if (fenceMatch) {
      requestAnimationFrame(() => {
        if (this.sourceTextElement && selection) {
          try {
            // 找到光标应该在的位置
            let remainingOffset = cursorOffset;
            let targetDiv: HTMLElement | null = null;
            let targetOffset = 0;

            const divs = this.sourceTextElement.querySelectorAll("div.livemd-with-line-number");
            for (let i = 0; i < divs.length; i++) {
              const div = divs[i] as HTMLElement;
              const textNode = div.firstChild;
              if (!textNode || textNode.nodeType !== Node.TEXT_NODE) continue;

              const textLength = textNode.textContent?.length || 0;
              if (remainingOffset <= textLength) {
                targetDiv = div;
                targetOffset = remainingOffset;
                break;
              }
              remainingOffset -= textLength + 1; // +1 for newline
            }

            if (targetDiv && targetDiv.firstChild) {
              const range = document.createRange();
              const textNode = targetDiv.firstChild;
              const offset = Math.min(targetOffset, textNode.textContent?.length || 0);
              range.setStart(textNode, offset);
              range.collapse(true);
              selection.removeAllRanges();
              selection.addRange(range);
            }
          } catch (e) {
            // 忽略光标恢复错误
          }
        }
      });
    }
  }

  /**
   * 处理源码文本键盘事件
   */
  private handleSourceTextKeydown(e: KeyboardEvent): void {
    // 允许基本的编辑操作
    if (e.key === "Tab") {
      e.preventDefault();
      // 按代码块语言插入一级缩进（Python 4 空格、Go 制表符、前端 2 空格……）
      document.execCommand("insertText", false, getIndentRule(this.node.attrs.language).unit);
    }
  }

  private handleSourceClipboard(event: ClipboardEvent, cut: boolean): void {
    const element = this.sourceTextElement;
    const selection = window.getSelection();
    if (!element || !selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return;

    const data = event.clipboardData;
    if (!data) {
      if (cut) event.preventDefault();
      return;
    }

    try {
      data.clearData();
      data.setData("text/plain", selection.toString());
      event.preventDefault();
    } catch {
      if (cut) event.preventDefault();
      return;
    }

    if (cut && !this.isReadOnly()) {
      document.execCommand("delete");
    }
  }

  /**
   * 创建头部（语言选择器和 Mermaid 模式选择器）
   */
  private createHeader(language: string): HTMLElement {
    const header = document.createElement("div");
    header.className = "livemd-code-block-header";
    // 重建头部前关闭旧下拉框，避免 body 上残留孤立弹层
    this.closeOpenSelects();
    // 全屏按钮挂在代码块容器右上角，而不是底部工具栏里，保证图表卡片右上角可发现
    this.mermaidExpandButton?.remove();
    this.mermaidExpandButton = null;

    // 语言选择器
    const langSelector = this.createCustomSelect(supportedLanguages, language, (value) =>
      this.setLanguage(value)
    );
    langSelector.classList.add("livemd-code-block-lang-select");
    header.appendChild(langSelector);

    // Mermaid 模式选择器（仅在 mermaid 语言时显示）
    if (language === "mermaid") {
      const modeSelector = this.createCustomSelect(
        mermaidDisplayModes,
        this.mermaidDisplayMode,
        (value) => this.setMermaidDisplayMode(value as MermaidDisplayMode)
      );
      modeSelector.classList.add("livemd-code-block-mode-select");
      header.appendChild(modeSelector);
      this.dom.appendChild(this.createMermaidExpandButton());
    }

    // 格式化按钮（该语言支持格式化时显示）
    if (getFormatSupport(language)) {
      header.appendChild(this.createFormatButton());
    }

    // 折叠按钮（长代码块可用）
    header.appendChild(this.createFoldButton());

    // 复制按钮（hover 时显示）
    const copyBtn = document.createElement("button");
    copyBtn.className = "livemd-code-block-copy-btn";
    copyBtn.type = "button";
    copyBtn.title = "复制代码块";
    copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void this.copyCodeBlock().then((copied) => {
        if (!copied) return;
        // 短暂显示已复制反馈
        copyBtn.classList.add("copied");
        copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
        setTimeout(() => {
          copyBtn.classList.remove("copied");
          copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
        }, 1500);
      });
    });
    header.appendChild(copyBtn);

    return header;
  }

  /**
   * 创建 Mermaid 全屏查看按钮
   */
  private createMermaidExpandButton(): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "livemd-code-block-expand-btn";
    button.title = "全屏查看图表";
    button.setAttribute("aria-label", "全屏查看图表");
    button.innerHTML = FULLSCREEN_ICONS.maximize;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.openMermaidFullscreen();
    });
    this.mermaidExpandButton = button;
    return button;
  }

  /**
   * 打开 Mermaid 全屏查看器
   */
  private async openMermaidFullscreen(): Promise<void> {
    // 渲染失败时卡片内已经展示错误与源码，不再等待不存在的 SVG
    if (this.mermaidPreview?.querySelector(".livemd-mermaid-error")) return;
    const svg = await this.ensureMermaidSvg();
    if (!svg) return;

    this.mermaidViewer?.close();
    this.mermaidViewer = openMermaidFullscreen(svg, {
      title: "Mermaid 图表",
      source: this.node.textContent,
      onClose: () => {
        this.mermaidViewer = null;
      },
    });
  }

  /**
   * 确保图表已经渲染；纯代码模式下临时切到混合模式再渲染
   */
  private async ensureMermaidSvg(): Promise<SVGSVGElement | null> {
    const existing = this.mermaidPreview?.querySelector("svg");
    if (existing) return existing as SVGSVGElement;

    if (this.mermaidDisplayMode === "code") {
      this.setMermaidDisplayMode("mixed");
    }
    if (!this.mermaidPreview?.querySelector("svg")) {
      this.createMermaidPreview(this.node.textContent);
    }

    return new Promise((resolve) => {
      const startedAt = performance.now();
      const check = () => {
        const svg = this.mermaidPreview?.querySelector("svg") as SVGSVGElement | null;
        if (svg) {
          resolve(svg);
          return;
        }
        if (performance.now() - startedAt > 10000) {
          resolve(null);
          return;
        }
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
  }

  /**
   * 创建折叠/展开按钮
   */
  private createFoldButton(): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "livemd-code-block-fold-btn";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.toggleFold();
    });

    this.foldButton = button;
    this.updateFoldButtonState();
    return button;
  }

  /**
   * 创建「格式化」按钮
   *
   * 成功：短暂加 .formatted 做绿色反馈；
   * 失败：加 .format-error 并把原因写入 title（提示文案留给 DOM，避免 core 依赖 UI 层 toast）。
   */
  private createFormatButton(): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "livemd-code-block-format-btn";
    button.title = "格式化代码";
    button.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h10"/><path d="M4 12h16"/><path d="M4 17h7"/><path d="M17 15l3 3-3 3"/></svg>';

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.formatCodeBlock().then((outcome) => {
        button.title = outcome.ok ? "格式化完成" : outcome.reason;
        button.classList.toggle("formatted", outcome.ok);
        button.classList.toggle("format-error", !outcome.ok);
        window.setTimeout(() => {
          button.classList.remove("formatted", "format-error");
          button.title = "格式化代码";
        }, 1500);
      });
    });

    return button;
  }

  /**
   * 按代码块声明的语言格式化内容并写回文档
   *
   * 写回走单条事务（可一步撤销），与 onCMUpdate 的替换区间保持一致；
   * PM → CM 的同步由 update(node) 承担，无需在此手动改 CodeMirror。
   */
  private async formatCodeBlock(): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (!this.cm) return { ok: false, reason: "代码编辑器未就绪" };

    const code = this.cm.state.doc.toString();
    const result = await formatCode(code, this.node.attrs.language ?? "");
    if (!result.ok) return result;

    const pos = this.getPos();
    if (pos === undefined) return { ok: false, reason: "代码块位置已失效" };

    const { tr } = this.view.state;
    const start = pos + 1;
    const end = pos + 1 + this.node.content.size;
    tr.replaceWith(start, end, result.code ? this.view.state.schema.text(result.code) : []);
    this.view.dispatch(tr);
    return { ok: true };
  }

  /**
   * 按当前语言的缩进规则重排整段代码的行首缩进（层级结构保持不变），单条事务可一步撤销
   */
  private reindentCodeBlock(): void {
    if (this.isReadOnly()) return;
    const code = this.cm ? this.cm.state.doc.toString() : this.node.textContent;
    const rule = getIndentRule(this.node.attrs.language);
    const next = reindentCode(code, rule);
    if (next === code) {
      console.debug("[CodeBlock] 缩进已符合规则，无需调整:", describeIndentRule(rule));
      return;
    }

    const pos = this.getPos();
    if (pos === undefined) return;
    console.debug(
      "[CodeBlock] 调整缩进为",
      describeIndentRule(rule),
      "语言:",
      this.node.attrs.language
    );
    const { tr } = this.view.state;
    tr.replaceWith(
      pos + 1,
      pos + 1 + this.node.content.size,
      next ? this.view.state.schema.text(next) : []
    );
    this.view.dispatch(tr);
  }

  /**
   * 判断当前代码块是否允许折叠
   */
  private isFoldable(): boolean {
    if (!this.cm) return false;

    const isDiagram =
      normalizeLanguage(this.node.attrs.language) === "mermaid" &&
      this.mermaidDisplayMode === "diagram";

    return canFoldCodeBlock(this.cm.state.doc.lines, isDiagram);
  }

  /**
   * 根据行数和 Mermaid 模式刷新折叠入口
   */
  private updateFoldAvailability(): void {
    if (!this.cm) return;

    const foldable = this.isFoldable();
    this.dom.classList.toggle("can-fold", foldable);

    if (!foldable && this.folded) {
      this.setFolded(false);
    }
    this.updateFoldButtonState();
  }

  /**
   * 更新折叠按钮图标、提示和可访问性状态
   */
  private updateFoldButtonState(): void {
    if (!this.foldButton) return;

    this.foldButton.classList.toggle("folded", this.folded);
    this.foldButton.innerHTML = this.folded ? UNFOLD_ICON : FOLD_ICON;
    this.foldButton.title = this.folded ? "展开代码块" : "折叠代码块";
    this.foldButton.setAttribute("aria-label", this.foldButton.title);
    this.foldButton.setAttribute("aria-expanded", String(!this.folded));
  }

  /**
   * 在折叠和展开之间切换
   */
  private toggleFold(): void {
    if (!this.isFoldable()) return;
    this.setFolded(!this.folded);
  }

  /**
   * 设置折叠状态
   */
  private setFolded(folded: boolean): void {
    if (this.folded === folded) {
      this.updateFoldButtonState();
      return;
    }

    this.folded = folded;
    this.dom.classList.toggle("folded", folded);

    if (folded) {
      this.applyFoldHeight();
    }

    this.updateFoldButtonState();
    this.cm?.requestMeasure();
  }

  /**
   * 使用 CodeMirror 的实际行高计算折叠高度
   */
  private applyFoldHeight(): void {
    if (!this.cm) return;

    const contentStyle = getComputedStyle(this.cm.contentDOM);
    const paddingTop = Number.parseFloat(contentStyle.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(contentStyle.paddingBottom) || 0;
    const height = getCodeBlockFoldHeight(this.cm.defaultLineHeight, paddingTop + paddingBottom);

    this.dom.style.setProperty("--livemd-code-fold-height", `${height}px`);
  }

  /** 关闭本代码块所有已展开的下拉框 */
  private closeOpenSelects(): void {
    // close() 会从集合中删除自身；Set 迭代期间删除当前元素是安全的
    for (const close of this.openSelectClosers) close();
    this.openSelectClosers.clear();
  }

  /**
   * 创建自定义下拉选择器
   */
  private createCustomSelect(
    options: { value: string; label: string }[],
    currentValue: string,
    onChange: (value: string) => void
  ): HTMLElement {
    const container = document.createElement("div");
    container.className = "livemd-custom-select";

    const button = document.createElement("button");
    button.className = "livemd-custom-select-button";
    button.type = "button";
    const currentOption = options.find((o) => o.value === currentValue);
    button.textContent = currentOption?.label || options[0].label;

    // 下拉弹层挂到 document.body（portal）+ fixed 定位，原因：
    // 1. 头部 .livemd-code-block-header 仅在代码块 hover 时可见（opacity/pointer-events），
    //    鼠标从按钮移到向下展开的列表时离开了代码块，列表随头部一起被隐藏、无法点击；
    // 2. 大文档模式下顶层代码块带 content-visibility:auto（隐含绘制裁剪），短代码块的列表被裁掉；
    // 3. 头部 z-index 形成局部层叠上下文，列表会被后续内容遮挡，单纯加大 z-index 无效。
    const dropdown = document.createElement("div");
    dropdown.className = "livemd-custom-select-dropdown livemd-custom-select-dropdown--portal";

    // 选项 DOM 延迟到首次展开时创建：语言列表有 37 项，若每个代码块都立即创建，
    // 数百个代码块会在首屏生成上万个节点。
    let populated = false;
    let outsideHandler: ((event: MouseEvent) => void) | null = null;
    let keydownHandler: ((event: KeyboardEvent) => void) | null = null;

    // 按按钮位置定位弹层：下方空间不足且上方更充裕时向上弹出；水平方向溢出视口右缘时左收
    const reposition = () => {
      const rect = button.getBoundingClientRect();
      // 按钮已滚出视口（或节点已被移除）时直接关闭，避免弹层悬空
      if (!button.isConnected || rect.bottom < 0 || rect.top > window.innerHeight) {
        close();
        return;
      }
      const gap = 4;
      const margin = 8;
      const dropdownHeight = Math.min(dropdown.scrollHeight || 240, 240);
      const dropdownWidth = Math.max(dropdown.offsetWidth, rect.width, 120);
      const spaceBelow = window.innerHeight - rect.bottom - margin;
      const spaceAbove = rect.top - margin;
      const openUp = spaceBelow < dropdownHeight && spaceAbove > spaceBelow;
      container.classList.toggle("dropup", openUp);

      let top = openUp ? rect.top - gap - dropdownHeight : rect.bottom + gap;
      top = Math.max(margin, Math.min(top, window.innerHeight - margin - dropdownHeight));
      let left = rect.left;
      if (left + dropdownWidth > window.innerWidth - margin) {
        left = Math.max(margin, window.innerWidth - margin - dropdownWidth);
      }
      dropdown.style.top = `${Math.round(top)}px`;
      dropdown.style.left = `${Math.round(left)}px`;
      dropdown.style.minWidth = `${Math.round(rect.width)}px`;
    };

    const close = () => {
      container.classList.remove("open");
      dropdown.remove();
      if (outsideHandler) {
        document.removeEventListener("click", outsideHandler, true);
        outsideHandler = null;
      }
      if (keydownHandler) {
        document.removeEventListener("keydown", keydownHandler, true);
        keydownHandler = null;
      }
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      this.openSelectClosers.delete(close);
      if (activeCustomSelectClose === close) activeCustomSelectClose = null;
    };

    const populate = () => {
      if (populated) return;
      populated = true;

      for (const option of options) {
        const item = document.createElement("div");
        item.className = "livemd-custom-select-item";
        if (option.value === currentValue) {
          item.classList.add("selected");
        }
        item.textContent = option.label;
        item.dataset.value = option.value;
        item.addEventListener("click", (e) => {
          e.stopPropagation();
          button.textContent = option.label;
          dropdown.querySelectorAll(".livemd-custom-select-item").forEach((el) => {
            el.classList.remove("selected");
          });
          item.classList.add("selected");
          close();
          onChange(option.value);
        });
        dropdown.appendChild(item);
      }
    };

    button.addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = !container.classList.contains("open");

      if (!willOpen) {
        close();
        return;
      }

      // 同一时刻只保留一个展开的下拉框（跨代码块）
      activeCustomSelectClose?.();

      populate();
      container.classList.add("open");
      document.body.appendChild(dropdown);
      reposition();
      // 当前项滚动到可视区域，便于在 37 种语言中定位
      dropdown.querySelector<HTMLElement>(".livemd-custom-select-item.selected")?.scrollIntoView({
        block: "nearest",
      });

      activeCustomSelectClose = close;
      this.openSelectClosers.add(close);
      window.addEventListener("resize", reposition);
      // 捕获阶段监听滚动：编辑区任意祖先容器滚动都需要重新定位
      window.addEventListener("scroll", reposition, true);

      // 外部点击关闭：弹层已不在 container 内，需同时判断两者
      outsideHandler = (event: MouseEvent) => {
        const target = event.target as Node;
        if (!container.contains(target) && !dropdown.contains(target)) close();
      };
      keydownHandler = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          close();
          button.focus();
        }
      };
      // 延迟注册，避免当前这次点击立即触发关闭
      window.setTimeout(() => {
        if (outsideHandler) document.addEventListener("click", outsideHandler, true);
        if (keydownHandler) document.addEventListener("keydown", keydownHandler, true);
      }, 0);
    });

    container.appendChild(button);
    return container;
  }

  /**
   * 复制代码块到剪贴板
   */
  private createCodeClipboardPayload(text: string) {
    return buildCodeClipboardPayload(text, this.cm ? getCodeClipboardOptions(this.cm) : {});
  }

  private async copyCodeBlock(): Promise<boolean> {
    const editor = this.ensureCodeMirror();
    const result = await writeClipboardPayload(
      this.createCodeClipboardPayload(editor.state.doc.toString())
    );
    return result.status !== "failed";
  }

  /**
   * 显示右键菜单
   */
  private async showContextMenu(e: MouseEvent): Promise<void> {
    // 移除已存在的右键菜单
    this.hideContextMenu();

    const editor = this.ensureCodeMirror();
    const isHeaderContextMenu = !!(e.target instanceof HTMLElement
      ? e.target.closest(".livemd-code-block-header")
      : null);

    const menu = document.createElement("div");
    menu.className = "livemd-context-menu";

    // 检查是否有选区
    const { main } = editor.state.selection;
    const hasSelection = !main.empty;

    // 复制
    const copyItem = this.createContextMenuItem("复制", !hasSelection, async () => {
      const selectedText = editor.state.sliceDoc(main.from, main.to);
      await writeClipboardPayload(this.createCodeClipboardPayload(selectedText));
      this.hideContextMenu();
    });
    menu.appendChild(copyItem);

    // 剪切
    const cutItem = this.createContextMenuItem(
      "剪切",
      !hasSelection || this.isReadOnly(),
      async () => {
        if (this.isReadOnly()) return;
        const state = editor.state;
        const { from, to } = state.selection.main;
        const selectedText = state.sliceDoc(from, to);
        const payload = this.createCodeClipboardPayload(selectedText);
        const result = await writeClipboardPayload(payload);
        const current = editor.state.selection.main;
        if (
          !this.isReadOnly() &&
          canDeleteAfterClipboardWrite(payload, result) &&
          editor.state.doc === state.doc &&
          current.eq(state.selection.main)
        ) {
          editor.dispatch({
            changes: { from, to, insert: "" },
            userEvent: "delete.cut",
          });
        }
        this.hideContextMenu();
      }
    );
    menu.appendChild(cutItem);

    // 粘贴 - 点击时再读取剪贴板，避免打开菜单就触发权限弹窗
    const pasteItem = this.createContextMenuItem("粘贴", this.isReadOnly(), async () => {
      this.hideContextMenu();
      editor.focus();
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          const { main } = editor.state.selection;
          editor.dispatch({
            changes: { from: main.from, to: main.to, insert: text },
          });
        }
      } catch {
        console.warn("无法访问剪贴板");
      }
    });
    menu.appendChild(pasteItem);

    // 分隔线
    const separator = document.createElement("div");
    separator.className = "livemd-context-menu-separator";
    menu.appendChild(separator);

    // 复制代码块
    const copyBlockItem = this.createContextMenuItem("复制代码块", false, () => {
      void this.copyCodeBlock();
      this.hideContextMenu();
    });
    menu.appendChild(copyBlockItem);

    // 调整缩进：把整段代码的行首缩进统一为当前语言的惯例缩进
    const indentRule = getIndentRule(this.node.attrs.language);
    const reindentItem = this.createContextMenuItem(
      `调整缩进（${describeIndentRule(indentRule)}）`,
      this.isReadOnly(),
      () => {
        this.reindentCodeBlock();
        this.hideContextMenu();
      }
    );
    menu.appendChild(reindentItem);

    if (this.isFoldable()) {
      const foldItem = this.createContextMenuItem(
        this.folded ? "展开代码块" : "折叠代码块",
        false,
        () => {
          this.toggleFold();
          this.hideContextMenu();
        }
      );
      menu.appendChild(foldItem);
    }

    if (isHeaderContextMenu) {
      const separator = document.createElement("div");
      separator.className = "livemd-context-menu-separator";
      menu.appendChild(separator);

      const deleteBlockItem = this.createContextMenuItem("删除此代码块", false, () => {
        this.deleteCodeBlock();
        this.hideContextMenu();
      });
      menu.appendChild(deleteBlockItem);
    }

    // 定位菜单
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;

    document.body.appendChild(menu);
    this.contextMenu = menu;

    // 调整位置，确保菜单在视口内
    const menuRect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    if (menuRect.right > viewportWidth) {
      menu.style.left = `${viewportWidth - menuRect.width - 8}px`;
    }
    if (menuRect.bottom > viewportHeight) {
      menu.style.top = `${viewportHeight - menuRect.height - 8}px`;
    }

    // 点击外部关闭
    const closeHandler = (event: MouseEvent) => {
      if (!menu.contains(event.target as Node)) {
        this.hideContextMenu();
        document.removeEventListener("click", closeHandler);
      }
    };
    setTimeout(() => {
      document.addEventListener("click", closeHandler);
    }, 0);
  }

  /**
   * 创建右键菜单项
   */
  private createContextMenuItem(
    label: string,
    disabled: boolean,
    onClick: () => void | Promise<void>
  ): HTMLElement {
    const item = document.createElement("div");
    item.className = "livemd-context-menu-item";
    if (disabled) {
      item.classList.add("disabled");
    }
    item.textContent = label;

    if (!disabled) {
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        void onClick();
      });
    }

    return item;
  }

  /**
   * 隐藏右键菜单
   */
  private hideContextMenu(): void {
    if (this.contextMenu) {
      this.contextMenu.remove();
      this.contextMenu = null;
    }
    // 移除其他可能存在的右键菜单
    document.querySelectorAll(".livemd-context-menu").forEach((el) => el.remove());
  }

  /**
   * 订阅共享主题变化（不按代码块创建 MutationObserver）
   */
  private setupThemeObserver(): void {
    this.themeUnsubscribe = subscribeThemeChange(() => {
      const isDark = detectDarkTheme();
      this.updateTheme(isDark);

      // 更新 Mermaid 预览
      if (this.node.attrs.language === "mermaid" && this.mermaidPreview) {
        this.createMermaidPreview(this.node.textContent);
      }
    });
  }

  /**
   * 更新主题
   */
  private updateTheme(isDark: boolean): void {
    this.cm?.dispatch({
      effects: this.themeCompartment.reconfigure(createThemeExtension(isDark)),
    });
  }

  /**
   * 更新搜索高亮（将 ProseMirror 搜索状态映射到 CodeMirror 装饰）
   */
  private updateSearchHighlights(): void {
    const cm = this.cm;
    if (!cm) return;

    const pos = this.getPos();
    if (pos === undefined) return;

    const searchState = searchPluginKey.getState(this.view.state);
    if (!searchState || !searchState.query || searchState.matches.length === 0) {
      cm.dispatch({
        effects: this.searchHighlightCompartment.reconfigure([]),
      });
      return;
    }

    const nodeStart = pos + 1;
    const nodeEnd = pos + 1 + this.node.content.size;

    const cmRanges = searchState.matches
      .map((m, i) => ({ ...m, index: i }))
      .filter((m) => m.from >= nodeStart && m.to <= nodeEnd)
      .map((m) => {
        const cls =
          m.index === searchState.currentIndex
            ? "livemd-search-match livemd-search-match-current"
            : "livemd-search-match";
        return CMDecoration.mark({ class: cls }).range(m.from - nodeStart, m.to - nodeStart);
      });

    const decoSet = cmRanges.length > 0 ? CMDecoration.set(cmRanges, true) : CMDecoration.none;

    cm.dispatch({
      effects: this.searchHighlightCompartment.reconfigure(EditorView.decorations.of(decoSet)),
    });
  }

  /**
   * 设置语言
   */
  private setLanguage(language: string): void {
    const pos = this.getPos();
    if (pos === undefined) return;

    const prevLanguage = this.node.attrs.language;

    // 更新 ProseMirror 节点属性
    this.view.dispatch(
      this.view.state.tr.setNodeMarkup(pos, null, {
        ...this.node.attrs,
        language,
      })
    );

    // 更新 CodeMirror 语言扩展（编辑器尚未创建时无需处理；动态包按需异步加载后注入）
    if (this.cm) this.applyLanguageExtension(language);

    // 更新头部（添加或移除 Mermaid 模式选择器）
    if ((prevLanguage === "mermaid") !== (language === "mermaid")) {
      this.updateHeader(language);
    }

    // 更新 Mermaid 预览
    if (language === "mermaid") {
      this.createMermaidPreview(this.node.textContent);
    } else {
      this.dom.classList.remove("mermaid-diagram-only");
      if (this.mermaidPreview) {
        this.mermaidPreview.remove();
        this.mermaidPreview = null;
      }
    }

    this.updateFoldAvailability();
  }

  /**
   * 更新头部
   */
  private updateHeader(language: string): void {
    if (this.headerElement) {
      const newHeader = this.createHeader(language);
      this.dom.replaceChild(newHeader, this.headerElement);
      this.headerElement = newHeader;
      this.updateFoldAvailability();
    }
  }

  /**
   * 设置 Mermaid 显示模式
   */
  private setMermaidDisplayMode(mode: MermaidDisplayMode): void {
    this.mermaidDisplayMode = mode;

    // 从纯图表模式切到代码 / 混合模式时，编辑区需要 CodeMirror
    if (mode !== "diagram") this.ensureCodeMirror();

    this.updateMermaidDisplay();

    if (mode !== "code" && this.mermaidPreview && !this.mermaidPreview.querySelector("svg")) {
      this.createMermaidPreview(this.node.textContent);
    }

    this.updateFoldAvailability();
  }

  /**
   * 更新 Mermaid 显示
   */
  private updateMermaidDisplay(): void {
    if (!this.editorContainer || !this.mermaidPreview) return;

    // 纯图表模式下隐藏编辑容器，块级类名供 CSS 精修使用
    this.dom.classList.toggle("mermaid-diagram-only", this.mermaidDisplayMode === "diagram");
    this.mermaidExpandButton?.classList.toggle("is-hidden", this.mermaidDisplayMode === "code");

    switch (this.mermaidDisplayMode) {
      case "code":
        this.editorContainer.style.display = "block";
        this.mermaidPreview.style.display = "none";
        break;
      case "diagram":
        this.editorContainer.style.display = "none";
        this.mermaidPreview.style.display = "block";
        break;
      case "mixed":
      default:
        this.editorContainer.style.display = "block";
        this.mermaidPreview.style.display = "block";
        break;
    }

    if (this.mermaidDisplayMode !== "code") {
      const renderedSvg = this.mermaidPreview.querySelector("svg");
      if (renderedSvg && !renderedSvg.hasAttribute("data-clipboard-png")) {
        requestClipboardPngFallback(renderedSvg);
      }
    }
  }

  /**
   * 创建 / 更新 Mermaid 预览
   *
   * 只登记「接近视口时渲染」的任务，不再让所有 Mermaid 块在文档打开时排队渲染。
   */
  private createMermaidPreview(content: string): void {
    if (!this.mermaidPreview) {
      this.mermaidPreview = document.createElement("div");
      this.mermaidPreview.className = "livemd-mermaid-preview";
      this.dom.appendChild(this.mermaidPreview);
    }

    const preview = this.mermaidPreview;
    this.mermaidLazyUnobserve?.();
    this.mermaidLazyUnobserve = null;
    const token = ++this.mermaidRenderToken;

    if (!content.trim()) {
      preview.innerHTML = '<div class="livemd-mermaid-placeholder">输入 Mermaid 语法后预览</div>';
      this.updateMermaidDisplay();
      return;
    }

    const cacheKey = getMermaidCacheKey(content);
    const cached = readMermaidCache(cacheKey);
    if (cached !== undefined) {
      preview.innerHTML = cached;
      this.afterMermaidRendered(preview);
      this.updateMermaidDisplay();
      return;
    }

    preview.innerHTML = '<div class="livemd-mermaid-placeholder">图表将在进入可视区域后渲染</div>';
    this.updateMermaidDisplay();

    if (this.mermaidDisplayMode === "code") return;

    this.mermaidLazyUnobserve = observeNearViewport(
      preview,
      () => {
        this.mermaidLazyUnobserve = null;
        this.enqueueMermaidRender(content, cacheKey, token);
      },
      "320px 0px"
    );
  }

  /** 将 Mermaid 渲染任务追加到全局串行队列 */
  private enqueueMermaidRender(content: string, cacheKey: string, token: number): void {
    mermaidRenderQueue = mermaidRenderQueue
      .then(async () => {
        if (token !== this.mermaidRenderToken) return;

        // renderId 需要在 try 外声明，以便 catch 中清理 mermaid 遗留的临时元素
        const renderId = `mermaid-${++mermaidIdCounter}`;
        try {
          const mermaid = await loadMermaidModule();
          const isDark = detectDarkTheme();

          mermaid.default.initialize({
            startOnLoad: false,
            darkMode: isDark,
            theme: "base",
            themeVariables: getMermaidThemeVariables(),
          });

          const { svg } = await mermaid.default.render(renderId, content);
          writeMermaidCache(cacheKey, svg);

          if (token !== this.mermaidRenderToken || !this.mermaidPreview) return;
          this.mermaidPreview.innerHTML = svg;
          this.afterMermaidRendered(this.mermaidPreview);
        } catch (error) {
          // mermaid.render() 语法错误时会在 removeTempElements() 之前抛出异常，
          // 导致临时 DOM 元素（<div id="d..."> / <svg> / <iframe>）遗留在 document.body 中。
          // 这些孤儿元素不断累积会干扰页面布局，导致 tab 栏等 UI 元素显示异常。
          document.getElementById(`d${renderId}`)?.remove();
          document.getElementById(renderId)?.remove();
          document.getElementById(`i${renderId}`)?.remove();

          if (token === this.mermaidRenderToken && this.mermaidPreview) {
            this.renderMermaidError(this.mermaidPreview, error, content);
          }
        }
      })
      .catch(() => {
        // 保持队列可继续消费后续任务
      });
  }

  /** 渲染完成后的统一收尾：补齐边距、修正空白边界与文字对比度、生成 PNG 兜底 */
  private afterMermaidRendered(preview: HTMLElement): void {
    padMermaidSvgBounds(preview);
    const renderedSvg = preview.querySelector("svg") as SVGSVGElement | null;
    if (renderedSvg) {
      normalizeRenderedMermaidViewport(renderedSvg);
      renderedSvg.setAttribute("data-livemd-mermaid", "true");
    }
    fixMermaidTextContrast(preview);
    if (renderedSvg) requestClipboardPngFallback(renderedSvg);
  }

  /**
   * 渲染失败时展示错误信息与源码，避免静默吞错
   */
  private renderMermaidError(preview: HTMLElement, error: unknown, content: string): void {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : String(error ?? "");
    preview.innerHTML = "";

    const container = document.createElement("div");
    container.className = "livemd-mermaid-error";

    const title = document.createElement("div");
    title.className = "livemd-mermaid-error-title";
    title.textContent = "Mermaid 渲染失败";

    const detail = document.createElement("div");
    detail.className = "livemd-mermaid-error-message";
    detail.textContent = message.trim() || "请检查图表语法";

    const source = document.createElement("pre");
    source.className = "livemd-mermaid-error-source";
    source.textContent = content;

    container.append(title, detail, source);
    preview.appendChild(container);
  }

  /**
   * CodeMirror 更新回调
   */
  private onCMUpdate(update: ViewUpdate): void {
    if (this.updating) return;

    if (update.docChanged) {
      const pos = this.getPos();
      if (pos === undefined) return;

      const newText = update.state.doc.toString();

      // 更新 ProseMirror 文档
      const tr = this.view.state.tr;
      const start = pos + 1;
      const end = pos + 1 + this.node.content.size;

      tr.replaceWith(start, end, newText ? this.view.state.schema.text(newText) : []);

      this.view.dispatch(tr);

      // 更新 Mermaid 预览
      if (this.node.attrs.language === "mermaid") {
        this.createMermaidPreview(newText);
      }
    }
  }

  /**
   * 转发选区到 ProseMirror
   */
  private forwardSelection(): void {
    const pos = this.getPos();
    if (pos === undefined || !this.cm) return;

    const { from, to } = this.cm.state.selection.main;
    const start = pos + 1 + from;
    const end = pos + 1 + to;

    const selection = TextSelection.create(this.view.state.doc, start, end);

    if (!this.view.state.selection.eq(selection)) {
      this.view.dispatch(this.view.state.tr.setSelection(selection));
    }
  }

  /**
   * 跳出代码块
   */
  private exitCodeBlock(direction: 1 | -1): void {
    const pos = this.getPos();
    if (pos === undefined) return;

    const { state } = this.view;
    const nodeEnd = pos + this.node.nodeSize;

    if (direction === 1) {
      const isLastNode = nodeEnd >= state.doc.content.size;

      if (isLastNode) {
        const paragraph = state.schema.nodes.paragraph.create();
        const tr = state.tr.insert(nodeEnd, paragraph);
        tr.setSelection(TextSelection.create(tr.doc, nodeEnd + 1));
        this.view.dispatch(tr);
        this.view.focus();
        return;
      }

      const selection = Selection.near(state.doc.resolve(nodeEnd), 1);
      this.view.dispatch(state.tr.setSelection(selection));
      this.view.focus();
    } else {
      const selection = Selection.near(state.doc.resolve(pos), -1);
      // 如果找到的选区不在代码块之前，说明前方无可用位置，需创建段落
      if (selection.from >= pos) {
        const paragraph = state.schema.nodes.paragraph.create();
        const tr = state.tr.insert(pos, paragraph);
        tr.setSelection(TextSelection.create(tr.doc, pos + 1));
        this.view.dispatch(tr);
        this.view.focus();
        return;
      }
      this.view.dispatch(state.tr.setSelection(selection));
      this.view.focus();
    }
  }

  /**
   * 跳出代码块并创建新的列表项
   */
  private exitCodeBlockAndCreateListItem(): void {
    const pos = this.getPos();
    if (pos === undefined) return;

    const { state } = this.view;
    const $pos = state.doc.resolve(pos);

    // 查找列表项节点
    let listItemDepth = -1;
    for (let d = $pos.depth; d > 0; d--) {
      const node = $pos.node(d);
      if (node.type.name === "list_item" || node.type.name === "task_item") {
        listItemDepth = d;
        break;
      }
    }

    // 确认在列表项中
    if (listItemDepth === -1) {
      this.exitCodeBlock(1);
      return;
    }

    // 获取列表项之后的位置（而非内容末尾）
    const listItemAfter = $pos.after(listItemDepth);

    // 创建新的列表项
    const newListItem = state.schema.nodes.list_item.create(
      null,
      state.schema.nodes.paragraph.create()
    );

    const tr = state.tr;
    tr.insert(listItemAfter, newListItem);
    tr.setSelection(TextSelection.create(tr.doc, listItemAfter + 2));
    this.view.dispatch(tr);
    this.view.focus();
  }

  /**
   * 删除代码块
   */
  private deleteCodeBlock(): void {
    const pos = this.getPos();
    if (pos === undefined) return;

    const { state } = this.view;
    const nodeEnd = pos + this.node.nodeSize;

    const tr = state.tr.delete(pos, nodeEnd);

    if (tr.doc.content.size === 0) {
      const paragraph = state.schema.nodes.paragraph.create();
      tr.insert(0, paragraph);
      tr.setSelection(TextSelection.create(tr.doc, 1));
    } else {
      const $pos = tr.doc.resolve(Math.min(pos, tr.doc.content.size));
      tr.setSelection(Selection.near($pos, -1));
    }

    this.view.dispatch(tr);
    this.view.focus();
  }

  /**
   * 更新节点
   */
  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false;

    const prevLanguage = this.node.attrs.language;
    const prevText = this.node.textContent;
    this.node = node;
    const newText = node.textContent;

    // 图表内容或语言变化时关闭旧的全屏视图，避免展示过期内容
    if (this.mermaidViewer && (newText !== prevText || node.attrs.language !== prevLanguage)) {
      this.mermaidViewer.close();
      this.mermaidViewer = null;
    }

    // CodeMirror 可能尚未因懒加载而创建：此时同步轻量静态占位即可
    if (this.staticPreview) {
      this.staticPreview.textContent = newText || " ";
    }
    // 行数变化时刷新骨架估高（尚未渲染过的块靠它占位）
    if (newText !== prevText) {
      this.applyIntrinsicSizeEstimate();
    }
    if (this.cm && newText !== this.cm.state.doc.toString()) {
      this.updating = true;
      this.cm.dispatch({
        changes: {
          from: 0,
          to: this.cm.state.doc.length,
          insert: newText,
        },
      });
      this.updating = false;
    }

    // 更新源码模式下的文本内容
    if (this.sourceViewMode && this.sourceTextElement) {
      const language = node.attrs.language || "";
      const content = node.textContent;
      const fullMarkdown = `\`\`\`${language}\n${content}\n\`\`\``;
      const lines = fullMarkdown.split("\n");

      // 收集当前的文本内容
      const currentLines: string[] = [];
      const childDivs = this.sourceTextElement.querySelectorAll("div.livemd-with-line-number");
      childDivs.forEach((div) => {
        currentLines.push(div.textContent || "");
      });
      const currentText = currentLines.join("\n");

      // 只在内容真正变化时更新
      if (currentText !== fullMarkdown) {
        // 保存光标位置
        const selection = window.getSelection();
        let cursorOffset = 0;
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          if (range.startContainer.nodeType === Node.TEXT_NODE) {
            cursorOffset = range.startOffset;
            // 计算相对于整个文本的偏移量
            let node: Node | null = range.startContainer;
            while (node && node !== this.sourceTextElement && node.previousSibling) {
              node = node.previousSibling;
              cursorOffset += node.textContent?.length || 0;
            }
          }
        }

        this.updating = true;

        // 清空容器并重新创建行
        this.sourceTextElement.innerHTML = "";
        lines.forEach((line) => {
          const lineDiv = document.createElement("div");
          lineDiv.className = "livemd-with-line-number";
          lineDiv.style.cssText = `
            white-space: pre;
            min-height: 1.6em;
          `;
          lineDiv.textContent = line;
          this.sourceTextElement!.appendChild(lineDiv);
        });

        this.updating = false;

        // 恢复光标位置
        if (selection && cursorOffset > 0) {
          requestAnimationFrame(() => {
            if (!this.sourceTextElement) return;
            try {
              // 找到光标应该在的位置
              let remainingOffset = cursorOffset;
              let targetDiv: HTMLElement | null = null;
              let targetOffset = 0;

              const divs = this.sourceTextElement.querySelectorAll("div.livemd-with-line-number");
              for (let i = 0; i < divs.length; i++) {
                const div = divs[i] as HTMLElement;
                const textNode = div.firstChild;
                if (!textNode || textNode.nodeType !== Node.TEXT_NODE) continue;

                const textLength = textNode.textContent?.length || 0;
                if (remainingOffset <= textLength) {
                  targetDiv = div;
                  targetOffset = remainingOffset;
                  break;
                }
                remainingOffset -= textLength + 1; // +1 for newline
              }

              if (targetDiv && targetDiv.firstChild) {
                const range = document.createRange();
                const textNode = targetDiv.firstChild;
                const offset = Math.min(targetOffset, textNode.textContent?.length || 0);
                range.setStart(textNode, offset);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
              }
            } catch (e) {
              // 忽略光标恢复错误
            }
          });
        }
      }
    }

    // 更新语言（动态包按需异步加载后注入）
    if (node.attrs.language !== prevLanguage) {
      if (this.cm) this.applyLanguageExtension(node.attrs.language);

      // mermaid 状态变化时，更新头部和预览
      const language = node.attrs.language;
      if ((prevLanguage === "mermaid") !== (language === "mermaid")) {
        this.updateHeader(language);
      }
      if (language === "mermaid") {
        this.mermaidDisplayMode = globalMermaidDefaultMode;
        this.createMermaidPreview(newText);
      } else {
        this.dom.classList.remove("mermaid-diagram-only");
        if (this.mermaidPreview) {
          this.mermaidPreview.remove();
          this.mermaidPreview = null;
        }
        // 恢复编辑器容器的显示（diagram 模式下会被隐藏）
        if (this.editorContainer) {
          this.editorContainer.style.display = "block";
        }
      }
    }

    // 更新搜索高亮
    this.updateSearchHighlights();

    // 内容行数或 Mermaid 状态变化后刷新折叠入口
    this.updateFoldAvailability();

    return true;
  }

  /**
   * 设置选区
   */
  setSelection(anchor: number, head: number): void {
    const cm = this.ensureCodeMirror();
    cm.focus();
    cm.dispatch({
      selection: { anchor, head },
    });
  }

  /**
   * 选区是否在此节点内
   */
  selectNode(): void {
    this.ensureCodeMirror().focus();
  }

  /**
   * 停止事件传播
   * 复制/剪切交给 CodeMirror 或跨块选区的 ProseMirror，其余事件留在 NodeView 内处理。
   */
  stopEvent(event: Event): boolean {
    // 跨代码块选区需要让 ProseMirror 处理；块内事件由 CodeMirror 自己的 handler 拦截。
    if (event.type === "copy" || event.type === "cut") return false;

    // 允许头部区域的鼠标事件（下拉选择器）
    if (event.target instanceof HTMLElement) {
      const isInHeader = event.target.closest(".livemd-code-block-header");
      if (isInHeader) {
        return false;
      }
    }
    return true;
  }

  /**
   * 忽略变更
   */
  ignoreMutation(): boolean {
    return true;
  }

  /**
   * 销毁
   */
  destroy(): void {
    this.destroyed = true;
    this.mermaidViewer?.close();
    this.mermaidViewer = null;
    this.cm?.destroy();
    this.lazyUnobserve?.();
    this.lazyUnobserve = null;
    // 已入队但尚未执行的构建任务一并撤销
    this.cancelQueuedBuild?.();
    this.cancelQueuedBuild = null;
    this.mermaidLazyUnobserve?.();
    this.mermaidLazyUnobserve = null;
    if (this.mermaidPreview) {
      this.mermaidPreview.remove();
    }
    this.themeUnsubscribe?.();
    this.themeUnsubscribe = null;
    this.closeOpenSelects();
    this.hideContextMenu();
    // 取消订阅源码模式状态
    if (this.sourceViewUnsubscribe) {
      this.sourceViewUnsubscribe();
      this.sourceViewUnsubscribe = null;
    }
  }
}

/**
 * 创建代码块 NodeView 工厂函数
 */
export function createCodeBlockNodeView(
  node: ProseMirrorNode,
  view: ProseMirrorView,
  getPos: () => number | undefined,
  isReadOnly: () => boolean = () => false
): CodeBlockView {
  return new CodeBlockView(node, view, getPos, isReadOnly);
}
