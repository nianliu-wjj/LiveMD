import { Prec } from "@codemirror/state";
import { EditorView as CodeMirrorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import type { Fragment } from "prosemirror-model";
import type { EditorView as ProseMirrorView } from "prosemirror-view";
import { decodeHtmlEntity, HTML_ENTITY_SYNTAX_TYPE } from "./utils/html-entities.ts";
import { resolveImageSrc } from "./utils/image-path.ts";
import type { ImagePasteMethod } from "./plugins/paste";

const CELL_BORDER = "1px solid #cccccc";
const CLIPBOARD_TREEWALKER_SHOW_TEXT = typeof NodeFilter === "undefined" ? 4 : NodeFilter.SHOW_TEXT;

export const RENDERED_CLIPBOARD_NODE_TYPES = new Set([
  "table",
  "image",
  "code_block",
  "math_block",
  "html_block",
]);

export function hasRenderedClipboardNode(fragment: Fragment): boolean {
  let found = false;
  fragment.descendants((node) => {
    if (RENDERED_CLIPBOARD_NODE_TYPES.has(node.type.name)) found = true;
    return !found;
  });
  return found;
}

export interface ClipboardBuildOptions {
  sourceView?: boolean;
  fontFamily?: string;
  codeFontFamily?: string;
  imageMode?: ImagePasteMethod;
}

export interface ClipboardPayload {
  plain: string;
  html: string;
  richRequired?: boolean;
}

export type ClipboardWriteStatus = "rich" | "plain" | "failed";

export interface ClipboardWriteResult {
  status: ClipboardWriteStatus;
}

export interface CodeClipboardOptions {
  fontFamily?: string;
  codeFontFamily?: string;
  codeStyle?: string;
  blockStyle?: string;
}

export function canDeleteAfterClipboardWrite(
  payload: ClipboardPayload,
  result: ClipboardWriteResult
): boolean {
  const richRequired = payload.richRequired ?? !!payload.html;
  return result.status !== "failed" && (!richRequired || result.status === "rich");
}

function cleanFontFamily(value: string): string {
  return value.trim().replace(/;+\s*$/, "");
}

export function getClipboardFontFamilies(
  element: HTMLElement,
  codeElement?: HTMLElement
): Pick<ClipboardBuildOptions, "fontFamily" | "codeFontFamily"> {
  if (typeof getComputedStyle !== "function") return {};

  try {
    const style = getComputedStyle(element);
    const codeStyle = codeElement ? getComputedStyle(codeElement) : style;
    const fontFamily =
      cleanFontFamily(style.getPropertyValue("--livemd-font-default")) ||
      cleanFontFamily(style.fontFamily);
    const codeFontFamily =
      cleanFontFamily(codeStyle.getPropertyValue("--livemd-font-code")) ||
      (codeElement ? cleanFontFamily(codeStyle.fontFamily) : "");
    return {
      ...(fontFamily ? { fontFamily } : {}),
      ...(codeFontFamily ? { codeFontFamily } : {}),
    };
  } catch {
    return {};
  }
}

export function getCodeClipboardOptions(view: CodeMirrorView): CodeClipboardOptions {
  const options: CodeClipboardOptions = getClipboardFontFamilies(view.dom, view.contentDOM);
  try {
    if (typeof getComputedStyle === "function") {
      options.codeStyle = getComputedStyle(view.contentDOM).cssText;
      const block = view.dom.closest<HTMLElement>(".livemd-code-block");
      if (block) options.blockStyle = getComputedStyle(block).cssText;
    }
  } catch {
    // Font information is still useful when computed styles are unavailable.
  }
  return options;
}

export function isClipboardElementHidden(element: Element): boolean {
  let current: Element | null = element;
  while (current) {
    if (current.hasAttribute("hidden") || current.getAttribute("aria-hidden") === "true")
      return true;
    const inlineStyle = (current as HTMLElement).style;
    if (inlineStyle.display === "none" || inlineStyle.visibility === "hidden") return true;

    if (typeof getComputedStyle === "function") {
      try {
        const computed = getComputedStyle(current);
        if (computed.display === "none" || computed.visibility === "hidden") return true;
      } catch {
        // Inline visibility is still usable when computed styles are unavailable.
      }
    }
    current = current.parentElement;
  }
  return false;
}

export function isClipboardElementVisible(element: Element): boolean {
  return !isClipboardElementHidden(element);
}

export function getRenderedSelectionRoot(
  view: ProseMirrorView,
  imageMode?: ImagePasteMethod
): HTMLElement | null {
  const document = view.dom.ownerDocument;
  if (view.state?.selection?.empty) return null;

  const range = getSelectionRange(view, document);
  if (!range || !view.dom.contains(range.commonAncestorContainer)) return null;

  const sourceClone = cloneWithInlineStyles(view.dom, imageMode);
  const start = getNodeAtPath(sourceClone, getNodePath(view.dom, range.startContainer));
  const end = getNodeAtPath(sourceClone, getNodePath(view.dom, range.endContainer));
  if (!start || !end) return null;

  try {
    const clonedRange = document.createRange();
    clonedRange.setStart(start, range.startOffset);
    clonedRange.setEnd(end, range.endOffset);
    const host = document.createElement("div");
    host.appendChild(clonedRange.extractContents());
    cleanRenderedClipboardDom(host);
    copyProseMirrorSliceMarker(host, view);
    return host;
  } catch {
    return null;
  }
}

function getSelectionRange(view: ProseMirrorView, document: Document): Range | null {
  try {
    const start = view.domAtPos(view.state.selection.from);
    const end = view.domAtPos(view.state.selection.to);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    if (!range.collapsed && view.dom.contains(range.commonAncestorContainer)) return range;
  } catch {
    // The browser selection below is the fallback for DOM positions PM cannot map.
  }

  const selection = document.getSelection();
  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    if (!range.collapsed && view.dom.contains(range.commonAncestorContainer)) return range;
  }
  return null;
}

function copyProseMirrorSliceMarker(host: HTMLElement, view: ProseMirrorView): void {
  if (typeof view.serializeForClipboard !== "function" || !view.state?.selection) return;

  try {
    const { dom } = view.serializeForClipboard(view.state.selection.content());
    const marker =
      dom.firstElementChild?.getAttribute("data-pm-slice") ||
      dom.querySelector("[data-pm-slice]")?.getAttribute("data-pm-slice");
    if (!marker) return;
    host.setAttribute("data-pm-slice", marker);
    if (host.firstElementChild) host.firstElementChild.setAttribute("data-pm-slice", marker);
  } catch {
    // External clipboard consumers do not need the ProseMirror marker.
  }
}

export function getRenderedNodeRoot(
  view: ProseMirrorView,
  pos: number,
  imageMode?: ImagePasteMethod
): HTMLElement | null {
  const node = view.nodeDOM(pos);
  if (!node || node.nodeType !== 1) return null;
  const clonedNode = cloneWithInlineStyles(node as HTMLElement, imageMode);
  const document = view.dom?.ownerDocument || node.ownerDocument;
  if (!document) return null;
  const root = document.createElement("div");
  root.appendChild(clonedNode);
  cleanRenderedClipboardDom(root);
  root.setAttribute("data-pm-slice", "0 0 []");
  if (root.firstElementChild) root.firstElementChild.setAttribute("data-pm-slice", "0 0 []");
  return root;
}

function cloneWithInlineStyles(source: HTMLElement, imageMode?: ImagePasteMethod): HTMLElement {
  const clone = source.cloneNode(true) as HTMLElement;
  copyComputedStyles(source, clone, imageMode);
  return clone;
}

function getClipboardImageSource(image: HTMLImageElement): string {
  return image.currentSrc || image.src || image.getAttribute("src") || "";
}

function isRemoteClipboardImageSource(src: string): boolean {
  return /^(?:https?:|data:)/i.test(src);
}

function resolveLocalClipboardImageSource(src: string): string {
  try {
    return resolveImageSrc(src) || src;
  } catch {
    return src;
  }
}

/**
 * Resolve an image for the clipboard without changing the document source.
 * `local` may use a cached local Data URL, `base64` always tries to produce
 * one, and `remote` never replaces a remote URL with embedded image data.
 */
export function resolveClipboardImageSource(
  image: HTMLImageElement,
  mode: ImagePasteMethod
): string | null {
  const source = getClipboardImageSource(image);
  if (!source) return null;

  const cached = image.getAttribute("data-clipboard-src");
  switch (mode) {
    case "remote":
      return isRemoteClipboardImageSource(source)
        ? source
        : resolveLocalClipboardImageSource(source);
    case "local":
      return cached || resolveLocalClipboardImageSource(source);
    case "base64":
      return cached || getLoadedImageDataUrl(image) || resolveLocalClipboardImageSource(source);
  }
}

function copyClipboardImageSource(
  source: Element,
  target: Element,
  imageMode?: ImagePasteMethod
): void {
  if (!imageMode || source.tagName.toLowerCase() !== "img") return;
  const resolved = resolveClipboardImageSource(source as HTMLImageElement, imageMode);
  if (resolved) target.setAttribute("src", resolved);
  target.removeAttribute("data-clipboard-src");
}

// Text, tables, and code reflow in the target; media keeps intrinsic dimensions.
const CLIPBOARD_LAYOUT_PROPERTIES = new Set([
  "width",
  "min-width",
  "max-width",
  "height",
  "min-height",
  "max-height",
  "display",
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "inset",
  "overflow",
  "overflow-x",
  "overflow-y",
  "white-space",
  "word-break",
  "overflow-wrap",
  "flex",
  "flex-basis",
  "flex-grow",
  "flex-shrink",
  "flex-direction",
  "flex-wrap",
  "grid-template-columns",
  "grid-template-rows",
  "transform",
]);

// Only intrinsic media/code formatting survives; editor viewport geometry does not.
const CLIPBOARD_LAYOUT_TAGS = new Set(["img", "svg", "canvas", "pre", "code"]);
const CLIPBOARD_LAYOUT_CONTAINERS =
  ".livemd-code-block-editor, .livemd-html-block-editor, .livemd-image-block, .livemd-mermaid-preview";
const CLIPBOARD_FLOW_WRAP_STYLES = {
  "white-space": "normal",
  "word-break": "normal",
  "overflow-wrap": "break-word",
} as const;
const CLIPBOARD_VIEWPORT_GEOMETRY_ATTRIBUTES = ["width", "height", "cellwidth", "cellheight"];
const CLIPBOARD_CODE_TAGS = new Set(["pre", "code"]);
const CLIPBOARD_CODE_WRAP_STYLES = {
  "white-space": "pre-wrap",
  "word-break": "normal",
  "overflow-wrap": "break-word",
} as const;

function shouldPreserveClipboardLayout(source: Element): boolean {
  const tag = source.tagName.toLowerCase();
  return CLIPBOARD_LAYOUT_TAGS.has(tag) || !!source.closest(CLIPBOARD_LAYOUT_CONTAINERS);
}

function copyElementTree(
  source: Element,
  target: Element,
  visit: (source: Element, target: Element) => void
): void {
  visit(source, target);
  const sourceChildren = Array.from(source.children);
  const targetChildren = Array.from(target.children);
  for (let index = 0; index < sourceChildren.length; index += 1) {
    copyElementTree(sourceChildren[index], targetChildren[index], visit);
  }
}

function copyComputedStyles(source: Element, target: Element, imageMode?: ImagePasteMethod): void {
  copyElementTree(source, target, (sourceElement, targetElement) => {
    if (isClipboardElementHidden(sourceElement)) {
      targetElement.setAttribute("data-clipboard-hidden", "true");
    }
    copyClipboardImageSource(sourceElement, targetElement, imageMode);
    const preserveLayout = shouldPreserveClipboardLayout(sourceElement);
    if (!preserveLayout) {
      for (const property of CLIPBOARD_LAYOUT_PROPERTIES) {
        (targetElement as HTMLElement).style.removeProperty(property);
      }
    }
    // Flow nodes stay semantic; copying Chromium's full computed declaration set bloats CF_HTML.
    if (preserveLayout && typeof getComputedStyle === "function") {
      const computed = getComputedStyle(sourceElement);
      for (const property of Array.from(computed)) {
        const value = computed.getPropertyValue(property);
        if (value) (targetElement as HTMLElement).style.setProperty(property, value);
      }
    }
  });
}

function getNodePath(root: Node, target: Node): number[] | null {
  const path: number[] = [];
  let current: Node | null = target;
  while (current && current !== root) {
    const parent: Node | null = current.parentNode;
    if (!parent) return null;
    path.unshift(Array.prototype.indexOf.call(parent.childNodes, current));
    current = parent;
  }
  return current === root ? path : null;
}

function getNodeAtPath(root: Node, path: number[] | null): Node | null {
  if (!path) return null;
  let current: Node = root;
  for (const index of path) {
    current = current.childNodes[index];
    if (!current) return null;
  }
  return current;
}

function normalizeClipboardCodeLayout(element: Element): void {
  for (const attribute of CLIPBOARD_VIEWPORT_GEOMETRY_ATTRIBUTES) {
    element.removeAttribute(attribute);
  }
  for (const property of CLIPBOARD_LAYOUT_PROPERTIES) {
    (element as HTMLElement).style.removeProperty(property);
  }
  for (const [property, value] of Object.entries(CLIPBOARD_CODE_WRAP_STYLES)) {
    (element as HTMLElement).style.setProperty(property, value);
  }
}

function sanitizeClipboardFlowDom(root: HTMLElement): void {
  const elements: Element[] = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const element of elements) {
    if (isClipboardElementHidden(element)) {
      element.remove();
      continue;
    }
    if (shouldPreserveClipboardLayout(element)) {
      if (CLIPBOARD_CODE_TAGS.has(element.tagName.toLowerCase())) {
        normalizeClipboardCodeLayout(element);
      }
      continue;
    }
    for (const attribute of CLIPBOARD_VIEWPORT_GEOMETRY_ATTRIBUTES) {
      element.removeAttribute(attribute);
    }
    for (const property of CLIPBOARD_LAYOUT_PROPERTIES) {
      (element as HTMLElement).style.removeProperty(property);
    }
    for (const [property, value] of Object.entries(CLIPBOARD_FLOW_WRAP_STYLES)) {
      (element as HTMLElement).style.setProperty(property, value);
    }
  }
}

function cleanRenderedClipboardDom(root: HTMLElement): void {
  const controls = [
    ".livemd-code-block-header",
    ".livemd-code-block-copy-btn",
    ".livemd-html-block-header",
    ".livemd-list-marker",
    ".cm-gutters",
    ".cm-lineNumbers",
  ].join(",");

  for (const element of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
    if (element.matches(controls)) {
      element.remove();
      continue;
    }
    if (
      element.hasAttribute("data-clipboard-hidden") ||
      element.hasAttribute("hidden") ||
      element.getAttribute("aria-hidden") === "true" ||
      element.style.display === "none" ||
      element.style.visibility === "hidden"
    ) {
      element.remove();
      continue;
    }
    element.removeAttribute("contenteditable");
    element.removeAttribute("data-clipboard-pending");
  }

  for (const checkbox of Array.from(root.querySelectorAll<HTMLElement>(".livemd-task-checkbox"))) {
    const input = root.ownerDocument.createElement("input");
    input.type = "checkbox";
    input.checked = checkbox.getAttribute("aria-checked") === "true";
    input.disabled = true;
    input.style.cssText = checkbox.getAttribute("style") || "";
    checkbox.replaceWith(input);
  }

  for (const editor of Array.from(
    root.querySelectorAll<HTMLElement>(".livemd-code-block-editor, .livemd-html-block-editor")
  )) {
    if (editor.style.display === "none") {
      editor.remove();
      continue;
    }
    const content = editor.querySelector<HTMLElement>(".cm-content");
    if (!content) {
      editor.remove();
      continue;
    }
    const text = Array.from(content.querySelectorAll(".cm-line"))
      .map((line) => line.textContent || "")
      .join("\n");
    if (editor.classList.contains("livemd-html-block-editor")) {
      try {
        const Parser =
          root.ownerDocument.defaultView?.DOMParser ??
          (typeof DOMParser !== "undefined" ? DOMParser : null);
        if (Parser) {
          const parsed = new Parser().parseFromString(text, "text/html");
          const rendered = root.ownerDocument.createElement("div");
          while (parsed.body.firstChild) rendered.appendChild(parsed.body.firstChild);
          editor.replaceWith(rendered);
          continue;
        }
      } catch {
        // Fall through to a source-code fragment if the browser cannot parse it.
      }
    }

    const pre = root.ownerDocument.createElement("pre");
    const code = root.ownerDocument.createElement("code");
    code.textContent = text;
    pre.style.cssText = content.style.cssText;
    code.style.cssText = content.style.cssText;
    pre.appendChild(code);
    editor.replaceWith(pre);
  }

  for (const preview of Array.from(root.querySelectorAll<HTMLElement>(".livemd-image-preview"))) {
    const content = preview.querySelector<HTMLElement>("a, img");
    if (content) preview.replaceWith(content);
  }

  for (const input of Array.from(
    root.querySelectorAll<HTMLInputElement>(".livemd-image-source-input")
  )) {
    const text = root.ownerDocument.createElement("span");
    text.textContent = input.value;
    input.replaceWith(text);
  }
}

export function semanticizeClipboardDom(
  dom: HTMLElement,
  options: ClipboardBuildOptions = {}
): HTMLElement | null {
  if (options.sourceView) return null;

  const root = dom.cloneNode(true) as HTMLElement;
  const document = root.ownerDocument;
  const headingsWithMarker = new Set<Element>();

  for (const marker of Array.from(root.querySelectorAll("span.livemd-syntax"))) {
    const syntaxType = marker.getAttribute("data-syntax-type");
    if (syntaxType === "heading") {
      const heading = marker.closest("h1,h2,h3,h4,h5,h6");
      if (heading) headingsWithMarker.add(heading);
    }

    if (syntaxType === HTML_ENTITY_SYNTAX_TYPE) {
      const decoded = decodeHtmlEntity(marker.textContent ?? "") ?? marker.textContent ?? "";
      const children = Array.from(marker.childNodes);
      const firstText = document
        .createTreeWalker(marker, CLIPBOARD_TREEWALKER_SHOW_TEXT)
        .nextNode();
      if (firstText) firstText.textContent = decoded;
      marker.replaceWith(...(children.length > 0 ? children : [document.createTextNode(decoded)]));
    } else {
      // 语法标记自身可能包着 strong/em 等语义节点；这些节点只承载 Markdown 符号。
      marker.remove();
    }
  }

  for (const heading of headingsWithMarker) {
    const walker = document.createTreeWalker(heading, CLIPBOARD_TREEWALKER_SHOW_TEXT);
    const firstText = walker.nextNode();
    if (firstText?.textContent?.startsWith(" ")) {
      firstText.textContent = firstText.textContent.slice(1);
    }
  }

  sanitizeClipboardFlowDom(root);
  return root;
}

export function buildClipboardPayload(
  plain: string,
  selectionRoot: HTMLElement | null,
  options: ClipboardBuildOptions = {}
): ClipboardPayload {
  const richRequired = !options.sourceView;
  const root = selectionRoot ? semanticizeClipboardDom(selectionRoot, options) : null;
  if (!root) return { plain, html: "", richRequired };

  stripUnsafeContent(root);
  applyTableBorders(root);
  applyClipboardFonts(root, options);
  applyClipboardImages(root, options.imageMode);
  applyClipboardPngFallback(root);
  return { plain, html: root.outerHTML, richRequired };
}

export function buildCodeClipboardPayload(
  text: string,
  options: CodeClipboardOptions = {}
): ClipboardPayload {
  const root = document.createElement("div");
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = text;
  if (options.blockStyle) pre.style.cssText = options.blockStyle;
  if (options.codeStyle) {
    if (!options.blockStyle) pre.style.cssText = options.codeStyle;
    code.style.cssText = options.codeStyle;
  }
  if (options.fontFamily && !options.blockStyle) pre.style.fontFamily = options.fontFamily;
  if (options.codeFontFamily) {
    if (!options.blockStyle) pre.style.fontFamily = options.codeFontFamily;
    code.style.fontFamily = options.codeFontFamily;
  }
  pre.appendChild(code);
  root.appendChild(pre);
  return buildClipboardPayload(text, root, options);
}

export function writeClipboardEvent(
  event: ClipboardEvent,
  payload: ClipboardPayload
): ClipboardWriteResult {
  const data = event.clipboardData;
  if (!data) return { status: "failed" };

  let plainWritten = false;
  try {
    data.clearData();
    data.setData("text/plain", payload.plain);
    plainWritten = true;
    if (payload.html) data.setData("text/html", payload.html);
    event.preventDefault();
    return { status: payload.html ? "rich" : "plain" };
  } catch (error) {
    console.error("写入剪贴板失败", error);
    if (!plainWritten) return { status: "failed" };

    // Keep the successful plain-text write usable, but report that the
    // requested rich representation was not available.
    event.preventDefault();
    return { status: "plain" };
  }
}

type ElectronClipboardApi = {
  writeToClipboard?: (payload: { text: string; html: string }) => Promise<boolean>;
  writeTextToClipboard?: (text: string) => Promise<boolean>;
};

function getBrowserClipboard(): Clipboard | null {
  if (typeof navigator === "undefined" || !navigator.clipboard) return null;
  return navigator.clipboard;
}

function getElectronClipboardApi(): ElectronClipboardApi | null {
  if (typeof window === "undefined") return null;
  return window.electronAPI ?? null;
}

async function writeBrowserRichClipboard(payload: ClipboardPayload): Promise<boolean> {
  const clipboard = getBrowserClipboard();
  if (
    !payload.html ||
    !clipboard ||
    typeof clipboard.write !== "function" ||
    typeof ClipboardItem === "undefined"
  ) {
    return false;
  }

  try {
    await clipboard.write([
      new ClipboardItem({
        "text/plain": new Blob([payload.plain], { type: "text/plain" }),
        "text/html": new Blob([payload.html], { type: "text/html" }),
      }),
    ]);
    return true;
  } catch {
    return false;
  }
}

async function writeElectronRichClipboard(payload: ClipboardPayload): Promise<boolean> {
  const api = getElectronClipboardApi();
  if (!payload.html || !api?.writeToClipboard) return false;

  try {
    return (await api.writeToClipboard({ text: payload.plain, html: payload.html })) === true;
  } catch {
    return false;
  }
}

async function writeBrowserPlainClipboard(text: string): Promise<boolean> {
  const clipboard = getBrowserClipboard();
  if (!clipboard || typeof clipboard.writeText !== "function") return false;

  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

async function writeElectronPlainClipboard(text: string): Promise<boolean> {
  const api = getElectronClipboardApi();
  if (!api?.writeTextToClipboard) return false;

  try {
    return (await api.writeTextToClipboard(text)) === true;
  } catch {
    return false;
  }
}

export async function writeClipboardPayload(
  payload: ClipboardPayload
): Promise<ClipboardWriteResult> {
  if (payload.html) {
    if (await writeBrowserRichClipboard(payload)) return { status: "rich" };
    if (await writeElectronRichClipboard(payload)) return { status: "rich" };
  }

  if (await writeBrowserPlainClipboard(payload.plain)) return { status: "plain" };
  if (await writeElectronPlainClipboard(payload.plain)) return { status: "plain" };
  return { status: "failed" };
}

type CodeClipboardRange = { from: number; to: number };
type CodeClipboardPayloadBuilder = (text: string, view: CodeMirrorView) => ClipboardPayload;

export function createCodeClipboardExtension(
  isReadOnly: () => boolean = () => false,
  buildPayload: CodeClipboardPayloadBuilder = (text, view) =>
    buildCodeClipboardPayload(text, getCodeClipboardOptions(view))
): Extension {
  return Prec.highest(
    CodeMirrorView.domEventHandlers({
      copy: (event, view) =>
        writeCodeClipboard(event as ClipboardEvent, view, isReadOnly, buildPayload),
      cut: (event, view) =>
        writeCodeClipboard(event as ClipboardEvent, view, isReadOnly, buildPayload),
    })
  );
}

export function getCodeClipboardSelection(view: CodeMirrorView): {
  text: string;
  ranges: CodeClipboardRange[];
} {
  const selectedRanges = view.state.selection.ranges.filter((range) => !range.empty);
  if (selectedRanges.length > 0) {
    return {
      text: selectedRanges
        .map((range) => view.state.sliceDoc(range.from, range.to))
        .join(view.state.lineBreak),
      ranges: selectedRanges.map((range) => ({ from: range.from, to: range.to })),
    };
  }

  const ranges: CodeClipboardRange[] = [];
  const lines: string[] = [];
  let lastLineNumber = -1;
  for (const range of view.state.selection.ranges) {
    const line = view.state.doc.lineAt(range.from);
    if (line.number <= lastLineNumber) continue;
    lastLineNumber = line.number;
    ranges.push({ from: line.from, to: Math.min(view.state.doc.length, line.to + 1) });
    lines.push(line.text);
  }

  return { text: lines.join(view.state.lineBreak), ranges };
}

function writeCodeClipboard(
  event: ClipboardEvent,
  view: CodeMirrorView,
  isReadOnly: () => boolean,
  buildPayload: CodeClipboardPayloadBuilder
): boolean {
  const selection = document.getSelection();
  const anchor = selection?.anchorNode;
  const focus = selection?.focusNode;
  const selectionIsInside =
    !!anchor && !!focus && view.contentDOM.contains(anchor) && view.contentDOM.contains(focus);

  if (!selectionIsInside) return false;

  // CodeMirror 的默认 cut handler 仍会删除内容；只读时必须由这里拦截。
  if (event.type === "cut" && isReadOnly()) {
    event.preventDefault();
    return true;
  }

  const { text, ranges } = getCodeClipboardSelection(view);
  if (!event.clipboardData || ranges.length === 0) {
    if (event.type === "cut") {
      event.preventDefault();
      return true;
    }
    return false;
  }

  const payload = buildPayload(text, view);
  const result = writeClipboardEvent(event, payload);
  if (event.type === "cut" && !canDeleteAfterClipboardWrite(payload, result)) {
    event.preventDefault();
    return true;
  }
  if (result.status === "failed") return false;

  if (event.type === "cut") {
    view.dispatch({
      changes: ranges,
      scrollIntoView: true,
      userEvent: "delete.cut",
    });
  }
  return true;
}

function stripUnsafeContent(root: HTMLElement): void {
  root
    .querySelectorAll("script,style,iframe,object,embed,link,meta")
    .forEach((node) => node.remove());

  for (const element of root.querySelectorAll<HTMLElement>("*")) {
    element.removeAttribute("contenteditable");
    for (const attribute of Array.from(element.attributes)) {
      if (/^on/i.test(attribute.name)) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (["href", "src", "action"].includes(attribute.name)) {
        const value = attribute.value.trim();
        if (
          /^(javascript|vbscript):/i.test(value) ||
          (/^data:/i.test(value) && !/^data:image\//i.test(value))
        ) {
          element.removeAttribute(attribute.name);
        }
      }
    }
  }
}

function applyClipboardFonts(root: HTMLElement, options: ClipboardBuildOptions): void {
  const { fontFamily, codeFontFamily } = options;
  if (fontFamily) root.style.fontFamily = fontFamily;

  for (const element of root.querySelectorAll<HTMLElement>("*")) {
    if (element.style.fontFamily && !element.style.fontFamily.includes("var(")) continue;
    const tag = element.tagName.toLowerCase();
    const family = ["pre", "code", "kbd", "samp"].includes(tag) ? codeFontFamily : fontFamily;
    if (family) element.style.fontFamily = family;
  }
}

function applyClipboardImages(root: HTMLElement, mode: ImagePasteMethod | undefined): void {
  if (!mode) return;

  for (const image of Array.from(root.querySelectorAll<HTMLImageElement>("img"))) {
    const resolved = resolveClipboardImageSource(image, mode);
    if (resolved) image.setAttribute("src", resolved);
    image.removeAttribute("data-clipboard-src");
  }
}

function getLoadedImageDataUrl(image: HTMLImageElement): string | null {
  if (!image.complete || !image.naturalWidth || !image.naturalHeight) return null;

  try {
    const canvas = image.ownerDocument.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(image, 0, 0);
    return canvas.toDataURL();
  } catch {
    return null;
  }
}

export async function cacheClipboardImage(image: HTMLImageElement): Promise<string | null> {
  const dataUrl =
    getLoadedImageDataUrl(image) || (await fetchImageAsDataUrl(image.currentSrc || image.src));
  if (dataUrl && image.isConnected) image.setAttribute("data-clipboard-src", dataUrl);
  return dataUrl;
}

async function fetchImageAsDataUrl(src: string): Promise<string | null> {
  if (!src || src.startsWith("data:")) return null;
  try {
    const response = await fetch(src);
    if (!response.ok && response.status !== 0) return null;
    return await blobToDataUrl(await response.blob());
  } catch {
    return null;
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => resolve("");
    reader.readAsDataURL(blob);
  });
}

export async function cacheClipboardPng(element: Element): Promise<string | null> {
  element.removeAttribute("data-clipboard-png");
  const dataUrl = await rasterizeElement(element);
  if (dataUrl && element.isConnected) element.setAttribute("data-clipboard-png", dataUrl);
  return dataUrl;
}

export type ClipboardFallbackRasterizer = (element: Element) => Promise<string | null>;

export function requestClipboardPngFallback(
  element: Element,
  rasterize: ClipboardFallbackRasterizer = cacheClipboardPng
): void {
  if (
    !isClipboardElementVisible(element) ||
    element.hasAttribute("data-clipboard-png") ||
    element.hasAttribute("data-clipboard-pending")
  ) {
    return;
  }
  element.setAttribute("data-clipboard-pending", "true");
  void Promise.resolve()
    .then(() => rasterize(element))
    .catch(() => null)
    .finally(() => element.removeAttribute("data-clipboard-pending"));
}

export function refreshClipboardFallbacks(
  root: ParentNode,
  rasterize: ClipboardFallbackRasterizer = cacheClipboardPng
): void {
  const targets = root.querySelectorAll<HTMLElement>(".math-preview, .livemd-mermaid-preview svg");
  for (const target of Array.from(targets)) {
    requestClipboardPngFallback(target, rasterize);
  }
}

function inlineRuntimeStylesForRaster(source: Element, target: Element): void {
  if (typeof getComputedStyle !== "function") return;

  copyElementTree(source, target, (sourceElement, targetElement) => {
    try {
      const computed = getComputedStyle(sourceElement);
      for (let index = 0; index < computed.length; index += 1) {
        const property = computed.item(index);
        const value = computed.getPropertyValue(property);
        if (value) (targetElement as HTMLElement).style.setProperty(property, value);
      }
    } catch {
      // A best-effort inline style is still useful when computed styles are partial.
    }
  });
}

function absolutizeFontFaceCssUrls(css: string, baseUri: string): string {
  return css.replace(/url\((['"]?)([^)'"\s]+)\1\)/gi, (match, quote, value) => {
    if (/^(?:data:|blob:|https?:|file:)/i.test(value)) return match;
    try {
      return `url(${quote}${new URL(value, baseUri).href}${quote})`;
    } catch {
      return match;
    }
  });
}

function getRuntimeFontFaceCss(document: Document): string {
  const rules: string[] = [];
  const sheets = document.styleSheets;

  if (sheets) {
    for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex += 1) {
      try {
        const sheet = sheets.item(sheetIndex);
        if (!sheet) continue;
        let sheetRules = 0;
        for (const rule of Array.from(sheet.cssRules)) {
          const cssText = rule.cssText || "";
          if (/^@font-face\b/i.test(cssText.trim())) {
            rules.push(absolutizeFontFaceCssUrls(cssText, document.baseURI));
            sheetRules += 1;
          }
        }
        if (sheetRules === 0) {
          const styleText = sheet.ownerNode?.textContent || "";
          rules.push(
            ...(styleText.match(/@font-face\s*\{[\s\S]*?\}/gi) || []).map((rule) =>
              absolutizeFontFaceCssUrls(rule, document.baseURI)
            )
          );
        }
      } catch {
        // Cross-origin stylesheets are intentionally left to the browser fallback.
      }
    }
  }
  if (rules.length === 0) {
    for (const style of Array.from(document.querySelectorAll("style"))) {
      rules.push(
        ...(style.textContent?.match(/@font-face\s*\{[\s\S]*?\}/gi) || []).map((rule) =>
          absolutizeFontFaceCssUrls(rule, document.baseURI)
        )
      );
    }
  }
  return rules.join("\n");
}

export function buildSelfContainedMarkup(element: Element): { markup: string; isSvg: boolean } {
  const isSvg = element.tagName.toLowerCase() === "svg";
  const clone = element.cloneNode(true) as Element;
  inlineRuntimeStylesForRaster(element, clone);
  removeClipboardPngAttributes(clone);

  const fontFaceCss = getRuntimeFontFaceCss(element.ownerDocument);
  if (fontFaceCss) {
    const style = isSvg
      ? element.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "style")
      : element.ownerDocument.createElement("style");
    style.textContent = fontFaceCss;
    clone.insertBefore(style, clone.firstChild);
  }

  return { markup: clone.outerHTML, isSvg };
}

async function rasterizeElement(element: Element): Promise<string | null> {
  if (
    typeof Image === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return null;
  }

  let url: string | undefined;
  try {
    const width = Math.ceil(element.getBoundingClientRect?.().width || 0);
    const height = Math.ceil(element.getBoundingClientRect?.().height || 0);
    if (width <= 0 || height <= 0) return null;

    const originalMarkup = element.outerHTML;
    const { markup, isSvg } = buildSelfContainedMarkup(element);
    const svgMarkup =
      isSvg && !/\sxmlns=/.test(markup)
        ? markup.replace(/^<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"')
        : markup;
    const source = isSvg
      ? svgMarkup
      : `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml">${markup}</div></foreignObject></svg>`;
    const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);
    url = objectUrl;

    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("PNG fallback image failed to load"));
      image.src = objectUrl;
    });

    const canvas = element.ownerDocument.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(image, 0, 0, width, height);
    if (element.outerHTML !== originalMarkup) return null;
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

function removeClipboardPngAttributes(element: Element): void {
  for (const node of [element, ...Array.from(element.querySelectorAll("*"))]) {
    node.removeAttribute("data-clipboard-png");
  }
}

function applyClipboardPngFallback(root: HTMLElement): void {
  const elements: Element[] = [];
  if (root.hasAttribute("data-clipboard-png")) elements.push(root);
  elements.push(...Array.from(root.querySelectorAll("[data-clipboard-png]")));

  for (const element of elements) {
    const png = element.getAttribute("data-clipboard-png");
    if (!png) continue;

    const document = element.ownerDocument;
    const image = document.createElement("img");
    image.src = png;
    image.alt = element.getAttribute("aria-label") || element.getAttribute("alt") || "";
    image.style.cssText = element.getAttribute("style") || "";
    image.className = "livemd-clipboard-png-fallback";
    image.setAttribute("data-clipboard-fallback-image", "true");
    image.setAttribute("aria-hidden", "true");

    if (element.tagName.toLowerCase() === "svg") {
      const picture = document.createElement("picture");
      const source = document.createElement("source");
      const primary = element.cloneNode(true) as Element;
      removeClipboardPngAttributes(primary);
      source.type = "image/svg+xml";
      source.srcset = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(primary.outerHTML)}`;
      picture.append(source, image);
      element.replaceWith(picture);
      continue;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "livemd-clipboard-fallback";
    wrapper.setAttribute("data-clipboard-fallback", "png");
    const primary = element.cloneNode(true) as Element;
    removeClipboardPngAttributes(primary);
    image.style.display = "none";
    wrapper.append(primary, image);
    element.replaceWith(wrapper);
  }
}

/** 表格是本次剪贴板验收明确需要的唯一额外样式。 */
function applyTableBorders(root: HTMLElement): void {
  for (const table of root.querySelectorAll<HTMLElement>("table")) {
    if (!table.getAttribute("border")) table.setAttribute("border", "1");
    if (!table.style.borderCollapse) table.style.borderCollapse = "collapse";
  }

  for (const cell of root.querySelectorAll<HTMLElement>("th,td")) {
    if (!cell.style.border) cell.style.border = CELL_BORDER;
  }
}
