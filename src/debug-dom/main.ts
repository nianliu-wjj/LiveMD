/**
 * 冒烟调试页入口：挂真实 LivemdEditor 并暴露探针全局
 *
 * - window.__debugEditor：编辑器实例（caret-smoke.mjs / render-smoke 经 CDP 驱动）；
 * - window.__TextSelection：prosemirror-state 的 TextSelection（冒烟脚本免动态
 *   import 的时序坑——页面内直接取模块引用）；
 * - __caretDebug 观测口由 caret-style.ts 在 DEV 构建下挂在编辑器根元素上。
 *
 * 冒烟文档一律 ASCII（vite-auto-i18n 会把中文内容替换为回译 key，
 * 探针按中文子串定位光标会全部失配——见 BUGFIX-CARET-REGION.md 坑 5）。
 */
import "./i18n-shim"; // ⚠️ 必须最先（见文件头注释）
import "../core/styles/livemd.css";
import { createLivemdEditor } from "../core/editor";
import { TextSelection } from "prosemirror-state";

const content = [
  "aa**bold**bb",
  "",
  "> quote **bold2** tail",
  "",
  "### heading-text",
  "",
  "aa**bold**cc==hl==dd",
  "",
  "- list-item **lb** tail",
  "",
  "",
].join("\n");

const container = document.getElementById("app");
if (!container) throw new Error("#app mount point missing");

const editor = createLivemdEditor(container, { content: "" });
editor.restoreDoc(content);

(window as unknown as Record<string, unknown>).__debugEditor = editor;
(window as unknown as Record<string, unknown>).__TextSelection = TextSelection;
(window as unknown as Record<string, unknown>).__debugContent = content;
