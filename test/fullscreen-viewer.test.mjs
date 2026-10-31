import assert from "node:assert/strict";
import test, { after } from "node:test";
import { Window } from "happy-dom";
import {
  openFullscreenViewer,
  closeActiveFullscreenViewer,
} from "../src/core/viewers/fullscreenViewer.ts";
import {
  normalizeMermaidSvgSize,
  normalizeRenderedMermaidViewport,
  restoreMermaidExportSize,
} from "../src/core/viewers/zoomView.ts";

const window = new Window();
const previousGlobals = {
  window: globalThis.window,
  document: globalThis.document,
  Node: globalThis.Node,
  Element: globalThis.Element,
  HTMLElement: globalThis.HTMLElement,
  HTMLInputElement: globalThis.HTMLInputElement,
  HTMLTextAreaElement: globalThis.HTMLTextAreaElement,
  HTMLSelectElement: globalThis.HTMLSelectElement,
  SVGElement: globalThis.SVGElement,
  requestAnimationFrame: globalThis.requestAnimationFrame,
  cancelAnimationFrame: globalThis.cancelAnimationFrame,
};

Object.assign(globalThis, {
  window,
  document: window.document,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLInputElement: window.HTMLInputElement,
  HTMLTextAreaElement: window.HTMLTextAreaElement,
  HTMLSelectElement: window.HTMLSelectElement,
  SVGElement: window.SVGElement,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
});

after(() => {
  window.close();
  Object.assign(globalThis, previousGlobals);
});

test("fullscreen viewer opens, zooms, switches mode and closes with Escape", () => {
  const content = document.createElement("div");
  const handle = openFullscreenViewer({
    kind: "image",
    title: "示例图片",
    content,
    contentSize: { width: 400, height: 200 },
    modes: ["fit", "original"],
    initialMode: "fit",
  });

  assert.equal(handle.isOpen, true);
  assert.ok(document.body.contains(handle.element));
  assert.equal(document.body.classList.contains("livemd-fullscreen-open"), true);
  assert.equal(handle.element.dataset.mode, "fit");
  assert.equal(
    handle.element.querySelector(".livemd-fullscreen-viewer__badge")?.textContent,
    "100%"
  );
  assert.equal(
    handle.element.querySelector(".livemd-fullscreen-viewer__mode-select")?.value,
    "fit"
  );

  handle.element.querySelector('[aria-label="zoom-in"]')?.click();
  assert.equal(handle.element.dataset.mode, "custom");
  assert.equal(
    handle.element.querySelector(".livemd-fullscreen-viewer__badge")?.textContent,
    "125%"
  );

  const select = handle.element.querySelector(".livemd-fullscreen-viewer__mode-select");
  select.value = "original";
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(handle.element.dataset.mode, "original");
  assert.equal(
    handle.element.querySelector(".livemd-fullscreen-viewer__badge")?.textContent,
    "100%"
  );

  window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
  assert.equal(handle.isOpen, false);
  assert.equal(document.body.contains(handle.element), false);
  assert.equal(document.body.classList.contains("livemd-fullscreen-open"), false);
});

test("opening a second viewer closes the first one", () => {
  const first = openFullscreenViewer({
    kind: "image",
    content: document.createElement("div"),
    contentSize: { width: 200, height: 200 },
  });
  const second = openFullscreenViewer({
    kind: "mermaid",
    content: document.createElement("div"),
    contentSize: { width: 300, height: 150 },
  });

  assert.equal(first.isOpen, false);
  assert.equal(second.isOpen, true);
  assert.equal(document.body.classList.contains("livemd-image-fullscreen"), false);
  assert.equal(document.body.classList.contains("livemd-mermaid-fullscreen"), true);

  closeActiveFullscreenViewer();
  assert.equal(second.isOpen, false);
});

test("normalizeMermaidSvgSize writes viewBox dimensions back to numeric width and height", () => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 640 480");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");

  const size = normalizeMermaidSvgSize(svg);
  assert.deepEqual(size, { width: 640, height: 480 });
  assert.equal(svg.getAttribute("width"), "640");
  assert.equal(svg.getAttribute("height"), "480");
  assert.equal(svg.getAttribute("preserveAspectRatio"), "xMidYMid meet");
  assert.equal(svg.getAttribute("data-livemd-mermaid"), "true");
  assert.equal(svg.style.maxWidth, "none");
});

test("normalizeRenderedMermaidViewport rewrites viewBox from g.root bounds", () => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 1000 1000");
  const root = document.createElementNS("http://www.w3.org/2000/svg", "g");
  root.setAttribute("class", "root");
  svg.appendChild(root);

  const rect = (left, top, width, height) => ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  });
  svg.getBoundingClientRect = () => rect(0, 0, 500, 500);
  root.getBoundingClientRect = () => rect(50, 50, 400, 400);

  assert.equal(normalizeRenderedMermaidViewport(svg, 0), true);
  assert.equal(svg.getAttribute("viewBox"), "100 100 800 800");
  assert.equal(svg.dataset.livemdIntrinsicWidth, "800");
  assert.equal(svg.dataset.livemdIntrinsicHeight, "800");

  // 第二次调用时根节点已经铺满 viewBox，不应继续收缩
  svg.getBoundingClientRect = () => rect(0, 0, 400, 400);
  root.getBoundingClientRect = () => rect(0, 0, 400, 400);
  assert.equal(normalizeRenderedMermaidViewport(svg, 0), false);
});

test("restoreMermaidExportSize removes screen sizing and restores intrinsic size", () => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 320 200");
  svg.setAttribute("data-livemd-mermaid", "true");
  svg.setAttribute("data-livemd-fullscreen", "true");
  svg.style.width = "1280px";
  svg.style.height = "800px";
  svg.style.maxWidth = "none";

  restoreMermaidExportSize(svg);

  assert.equal(svg.getAttribute("width"), "320");
  assert.equal(svg.getAttribute("height"), "200");
  assert.equal(svg.style.width, "");
  assert.equal(svg.style.height, "");
  assert.equal(svg.style.maxWidth, "");
  assert.equal(svg.hasAttribute("data-livemd-fullscreen"), false);
});
