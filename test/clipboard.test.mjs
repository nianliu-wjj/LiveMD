import assert from "node:assert/strict";
import test, { after } from "node:test";
import { Window } from "happy-dom";
import {
  buildClipboardPayload,
  buildCodeClipboardPayload,
  buildSelfContainedMarkup,
  cacheClipboardPng,
  canDeleteAfterClipboardWrite,
  getClipboardFontFamilies,
  getCodeClipboardSelection,
  getRenderedNodeRoot,
  hasRenderedClipboardNode,
  getRenderedSelectionRoot,
  isClipboardElementVisible,
  refreshClipboardFallbacks,
  semanticizeClipboardDom,
  resolveClipboardImageSource,
  writeClipboardEvent,
  writeClipboardPayload,
} from "../src/core/clipboard.ts";

const window = new Window();
const previousGlobals = {
  window: globalThis.window,
  document: globalThis.document,
  Node: globalThis.Node,
  NodeFilter: globalThis.NodeFilter,
  HTMLElement: globalThis.HTMLElement,
};

Object.assign(globalThis, {
  window,
  document: window.document,
  Node: window.Node,
  NodeFilter: window.NodeFilter,
  HTMLElement: window.HTMLElement,
});

after(() => {
  window.close();
  Object.assign(globalThis, previousGlobals);
});

function makeRoot(html) {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

test("semanticizeClipboardDom removes syntax markers but keeps semantic elements", () => {
  const root = makeRoot(
    '<h1 data-pm-slice="0 0 []"><span class="livemd-syntax" data-syntax-type="heading">#</span> Title</h1>' +
      '<p><span class="livemd-syntax" data-syntax-type="strong"><strong>**</strong></span><strong>bold</strong>' +
      '<span class="livemd-syntax" data-syntax-type="strong"><strong>**</strong></span>' +
      '<span class="livemd-syntax" data-syntax-type="link"><a>[</a></span><a href="/target">site</a>' +
      '<span class="livemd-syntax" data-syntax-type="link"><a>](/target)</a></span>' +
      '<span class="livemd-syntax" data-syntax-type="html_inline"><u>&lt;u&gt;</u></span><u>under</u>' +
      '<span class="livemd-syntax" data-syntax-type="html_entity"><strong>&amp;</strong></span></p>'
  );

  const result = semanticizeClipboardDom(root);

  assert.ok(result);
  assert.equal(result.querySelector("h1")?.textContent, "Title");
  assert.equal(result.querySelector("strong")?.textContent, "bold");
  assert.equal(result.querySelector("a")?.getAttribute("href"), "/target");
  assert.equal(result.querySelector("a")?.textContent, "site");
  assert.equal(result.querySelector("u")?.textContent, "under");
  assert.equal(result.querySelectorAll("strong")[1]?.textContent, "&");
  assert.equal(result.querySelector("p")?.textContent, "boldsiteunder&");
  assert.equal(result.innerHTML.includes("**"), false);
  assert.equal(result.querySelectorAll(".livemd-syntax").length, 0);
  assert.equal(result.querySelector("[data-pm-slice]")?.getAttribute("data-pm-slice"), "0 0 []");
  assert.equal(root.querySelectorAll(".livemd-syntax").length, 7);
});

test("buildClipboardPayload adds table borders", () => {
  const root = makeRoot("<table><tbody><tr><th>名称</th><td>合同</td></tr></tbody></table>");

  const payload = buildClipboardPayload("| 名称 | 合同 |", root);
  const parsed = new window.DOMParser().parseFromString(payload.html, "text/html");

  assert.equal(payload.plain, "| 名称 | 合同 |");
  assert.equal(parsed.querySelector("table")?.getAttribute("border"), "1");
  assert.equal(parsed.querySelector("th")?.style.border, "1px solid #cccccc");
  assert.equal(parsed.querySelector("td")?.style.border, "1px solid #cccccc");
});

test("buildClipboardPayload carries the configured fonts into HTML", () => {
  const root = makeRoot("<p>中文</p><pre><code>const value = 1</code></pre>");
  const payload = buildClipboardPayload("中文", root, {
    fontFamily: '"UserConfiguredSans", sans-serif',
    codeFontFamily: '"UserConfiguredCode", monospace',
  });
  const parsed = new window.DOMParser().parseFromString(payload.html, "text/html");
  const host = parsed.body.firstElementChild;
  const paragraph = parsed.querySelector("p");
  const pre = parsed.querySelector("pre");

  assert.match(host?.style.fontFamily ?? "", /UserConfiguredSans/);
  assert.match(host?.style.fontFamily ?? "", /sans-serif/);
  assert.match(paragraph?.style.fontFamily ?? "", /UserConfiguredSans/);
  assert.match(pre?.style.fontFamily ?? "", /UserConfiguredCode/);
});

test("reads font families from the current runtime CSS", () => {
  const previous = globalThis.getComputedStyle;
  globalThis.getComputedStyle = () => ({
    fontFamily: "runtime-fallback",
    getPropertyValue(name) {
      if (name === "--livemd-font-default") return '"ConfiguredSans", sans-serif;';
      if (name === "--livemd-font-code") return '"ConfiguredCode", monospace;';
      return "";
    },
  });

  try {
    assert.deepEqual(getClipboardFontFamilies(document.createElement("div")), {
      fontFamily: '"ConfiguredSans", sans-serif',
      codeFontFamily: '"ConfiguredCode", monospace',
    });
  } finally {
    if (previous === undefined) delete globalThis.getComputedStyle;
    else globalThis.getComputedStyle = previous;
  }
});

test("buildClipboardPayload prefers a cached local image data URL", () => {
  const root = makeRoot(
    '<img data-clipboard-src="data:image/png;base64,cached" src="file:///local.png">'
  );
  const payload = buildClipboardPayload("![图](local.png)", root, { imageMode: "local" });
  assert.match(payload.html, /src="data:image\/png;base64,cached"/);
});

test("resolveClipboardImageSource makes the three image modes explicit", () => {
  const local = makeRoot(
    '<img src="local.png" data-clipboard-src="data:image/png;base64,local">'
  ).querySelector("img");
  const remote = makeRoot(
    '<img src="https://example.com/image.png" data-clipboard-src="data:image/png;base64,remote">'
  ).querySelector("img");
  const base64 = makeRoot('<img src="local.png">').querySelector("img");
  const base64Cached = makeRoot(
    '<img src="local.png" data-clipboard-src="data:image/png;base64,base64">'
  ).querySelector("img");

  assert.equal(resolveClipboardImageSource(local, "local"), "data:image/png;base64,local");
  assert.equal(resolveClipboardImageSource(remote, "remote"), "https://example.com/image.png");
  assert.equal(resolveClipboardImageSource(base64, "base64"), "local.png");
  assert.equal(resolveClipboardImageSource(base64Cached, "base64"), "data:image/png;base64,base64");
  assert.equal(local.getAttribute("data-clipboard-src"), "data:image/png;base64,local");
  assert.equal(remote.getAttribute("data-clipboard-src"), "data:image/png;base64,remote");

  const payload = buildClipboardPayload(
    "![图](remote.png)",
    makeRoot(
      '<img src="https://example.com/image.png" data-clipboard-src="data:image/png;base64,remote">'
    ),
    { imageMode: "remote" }
  );
  const parsed = new window.DOMParser().parseFromString(payload.html, "text/html");
  assert.equal(parsed.querySelector("img")?.getAttribute("src"), "https://example.com/image.png");
});

test("rendered flow content does not inline the editor's full computed style", () => {
  const previousGetComputedStyle = globalThis.getComputedStyle;
  const computedValues = {
    color: "rgb(1, 2, 3)",
    backgroundColor: "rgb(4, 5, 6)",
    fontSize: "18px",
    textAlign: "left",
    cursor: "default",
    userSelect: "none",
    caretColor: "transparent",
    display: "block",
    visibility: "visible",
    width: "640px",
    whiteSpace: "pre",
  };
  for (let index = 0; index < 300; index += 1) {
    computedValues[`--editor-internal-${index}`] = `${index}px`;
  }
  computedValues[Symbol.iterator] = function* () {
    yield* Object.keys(computedValues);
  };
  const computedStyle = {
    ...computedValues,
    length: Object.keys(computedValues).length,
    item: (index) => Object.keys(computedValues)[index] ?? "",
    getPropertyValue: (property) => computedValues[property] ?? "",
  };
  globalThis.getComputedStyle = () => computedStyle;

  const editorDom = makeRoot(
    "<p>flow text</p><table><tbody><tr><td>cell</td></tr></tbody></table>"
  );
  document.body.appendChild(editorDom);
  const range = document.createRange();
  range.selectNodeContents(editorDom);
  const selection = document.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  try {
    const rendered = getRenderedSelectionRoot({ dom: editorDom });
    const payload = buildClipboardPayload("flow text\ncell", rendered);
    const parsed = new window.DOMParser().parseFromString(payload.html, "text/html");
    assert.ok(payload.html.length < 10_000, `clipboard HTML expanded to ${payload.html.length} characters`);
    assert.doesNotMatch(payload.html, /--editor-internal-/);
    assert.equal(parsed.querySelector("p")?.style.color, "");
    assert.equal(parsed.querySelector("p")?.style.cursor, "");
    assert.equal(parsed.querySelector("p")?.style.whiteSpace, "normal");
    assert.equal(parsed.querySelector("table")?.style.width, "");
  } finally {
    editorDom.remove();
    if (previousGetComputedStyle === undefined) delete globalThis.getComputedStyle;
    else globalThis.getComputedStyle = previousGetComputedStyle;
  }
});

test("getRenderedSelectionRoot clones visible DOM and drops editor controls", () => {
  const editorDom = makeRoot(
    '<div class="livemd-code-block"><div class="livemd-code-block-header">JavaScript</div>' +
      '<div class="livemd-code-block-editor"><div class="cm-gutters">1</div>' +
      '<div class="cm-content"><div class="cm-line">one</div><div class="cm-line">two</div></div></div></div>'
  );
  document.body.appendChild(editorDom);
  const range = document.createRange();
  range.selectNodeContents(editorDom);
  const selection = document.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  const result = getRenderedSelectionRoot({ dom: editorDom });
  assert.ok(result);
  assert.equal(result.querySelector("pre code")?.textContent, "one\ntwo");
  assert.equal(result.querySelector(".livemd-code-block-header"), null);
  assert.equal(result.querySelector(".cm-gutters"), null);
  editorDom.remove();
});

test("hasRenderedClipboardNode detects bounded nodes in cross-block slices", () => {
  const fragment = (names) => ({
    descendants(callback) {
      for (const name of names) callback({ type: { name } });
    },
  });

  assert.equal(hasRenderedClipboardNode(fragment(["paragraph", "code_block"])), true);
  assert.equal(hasRenderedClipboardNode(fragment(["paragraph", "html_block"])), true);
  assert.equal(hasRenderedClipboardNode(fragment(["paragraph"])), false);
});

test("semantic clipboard flow removes editor hard-wrap and width styles", () => {
  const root = makeRoot(
    '<p style="white-space: pre-wrap; word-break: break-all; overflow-wrap: normal; width: 320px; max-width: 320px; height: 100px;">这是一段需要自适应换行的长文本。</p>'
  );
  root.style.whiteSpace = "pre-wrap";
  root.style.width = "800px";
  const payload = buildClipboardPayload("这是一段需要自适应换行的长文本。", root);
  const parsed = new window.DOMParser().parseFromString(payload.html, "text/html");
  const host = parsed.body.firstElementChild;
  const paragraph = parsed.querySelector("p");

  assert.equal(host?.style.whiteSpace, "normal");
  assert.equal(host?.style.width, "");
  assert.equal(paragraph?.style.whiteSpace, "normal");
  assert.equal(paragraph?.style.wordBreak, "normal");
  assert.equal(paragraph?.style.overflowWrap, "break-word");
  assert.equal(paragraph?.style.width, "");
  assert.equal(paragraph?.style.maxWidth, "");
  assert.equal(paragraph?.style.height, "");
});

test("rendered mixed selections keep code layout without leaking it into prose", () => {
  const editorDom = makeRoot(
    '<p style="white-space: pre-wrap; word-break: break-all; width: 320px">before</p>' +
      '<pre style="white-space: pre"><code>const value = 1</code></pre>'
  );
  document.body.appendChild(editorDom);
  const range = document.createRange();
  range.selectNodeContents(editorDom);
  const selection = document.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  const result = getRenderedSelectionRoot({ dom: editorDom });
  assert.equal(result?.querySelector("p")?.style.whiteSpace, "");
  assert.equal(result?.querySelector("p")?.style.wordBreak, "");
  assert.equal(result?.querySelector("pre")?.style.whiteSpace, "pre");

  const payload = buildClipboardPayload("before\\nconst value = 1", result);
  const parsed = new window.DOMParser().parseFromString(payload.html, "text/html");
  assert.equal(parsed.querySelector("p")?.style.whiteSpace, "normal");
  assert.equal(parsed.querySelector("pre")?.style.whiteSpace, "pre-wrap");
  editorDom.remove();
});

test("mixed rendered selections do not carry source table geometry", () => {
  const editorDom = makeRoot(
    '<p>before</p><table width="640" style="width: 640px"><tbody><tr><td width="600" style="min-width: 600px">cell</td></tr></tbody></table>'
  );
  document.body.appendChild(editorDom);
  const range = document.createRange();
  range.selectNodeContents(editorDom);
  const selection = document.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  const rendered = getRenderedSelectionRoot({ dom: editorDom });
  const payload = buildClipboardPayload("before\\ncell", rendered);
  const parsed = new window.DOMParser().parseFromString(payload.html, "text/html");

  assert.equal(parsed.querySelector("table")?.style.width, "");
  assert.equal(parsed.querySelector("table")?.getAttribute("width"), null);
  assert.equal(parsed.querySelector("td")?.style.minWidth, "");
  assert.equal(parsed.querySelector("td")?.getAttribute("width"), null);
  editorDom.remove();
});

test("code blocks drop source geometry and reflow long lines in final HTML", () => {
  const editorDom = makeRoot(
    '<pre style="width: 640px; white-space: pre"><code style="min-width: 600px">const longLine = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";</code></pre>'
  );
  document.body.appendChild(editorDom);
  const range = document.createRange();
  range.selectNodeContents(editorDom);
  const selection = document.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  const rendered = getRenderedSelectionRoot({ dom: editorDom });
  const payload = buildClipboardPayload("code", rendered);
  const parsed = new window.DOMParser().parseFromString(payload.html, "text/html");
  const pre = parsed.querySelector("pre");
  const code = parsed.querySelector("pre code");

  assert.equal(pre?.style.width, "");
  assert.equal(pre?.style.whiteSpace, "pre-wrap");
  assert.equal(code?.style.minWidth, "");
  assert.equal(code?.style.whiteSpace, "pre-wrap");
  editorDom.remove();
});

test("getRenderedSelectionRoot drops prose and table viewport geometry", () => {
  const editorDom = makeRoot(
    '<p style="width: 320px; max-width: 320px; height: 100px; white-space: pre-wrap; font-size: 18px;">text</p>' +
      '<table style="width: 640px"><tbody><tr><td>cell</td></tr></tbody></table>'
  );
  document.body.appendChild(editorDom);
  const range = document.createRange();
  range.selectNodeContents(editorDom);
  const selection = document.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  const result = getRenderedSelectionRoot({ dom: editorDom });
  const paragraph = result?.querySelector("p");
  const table = result?.querySelector("table");
  assert.equal(paragraph?.style.width, "");
  assert.equal(paragraph?.style.maxWidth, "");
  assert.equal(paragraph?.style.height, "");
  assert.equal(paragraph?.style.whiteSpace, "");
  assert.equal(paragraph?.style.wordBreak, "");
  assert.equal(paragraph?.style.fontSize, "18px");
  assert.equal(table?.style.width, "");
  editorDom.remove();
});

test("getRenderedSelectionRoot removes hidden source widgets", () => {
  const editorDom = makeRoot(
    '<div class="math-block"><div class="math-preview">visible</div>' +
      '<div class="math-source-container" style="display: none">secret source</div></div>'
  );
  document.body.appendChild(editorDom);
  const range = document.createRange();
  range.selectNodeContents(editorDom);
  const selection = document.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  const result = getRenderedSelectionRoot({ dom: editorDom });
  assert.equal(result?.textContent?.includes("visible"), true);
  assert.equal(result?.textContent?.includes("secret source"), false);
  assert.equal(result?.querySelector(".math-source-container"), null);
  editorDom.remove();
});

test("refreshClipboardFallbacks skips hidden targets and retries after visibility returns", async () => {
  const root = makeRoot('<div class="math-preview">formula</div>');
  document.body.appendChild(root);
  const calls = [];
  const rasterize = async (element) => {
    calls.push(element);
    return null;
  };

  try {
    assert.equal(isClipboardElementVisible(root.firstElementChild), true);
    refreshClipboardFallbacks(root, rasterize);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(calls.length, 1);

    root.style.display = "none";
    refreshClipboardFallbacks(root, rasterize);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(calls.length, 1);

    root.style.display = "";
    refreshClipboardFallbacks(root, rasterize);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(calls.length, 2);
  } finally {
    root.remove();
  }
});

test("getRenderedSelectionRoot keeps prose-to-code selections in one rich fragment", () => {
  const editorDom = makeRoot(
    '<p>before</p><div class="livemd-code-block"><div class="livemd-code-block-header">JavaScript</div>' +
      '<div class="livemd-code-block-editor"><div class="cm-gutters">1</div>' +
      '<div class="cm-content"><div class="cm-line">const value = 1</div></div></div></div>'
  );
  document.body.appendChild(editorDom);
  const range = document.createRange();
  range.setStart(editorDom.querySelector("p").firstChild, 0);
  range.setEnd(
    editorDom.querySelector(".cm-line").firstChild,
    editorDom.querySelector(".cm-line").textContent.length
  );
  const selection = document.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  const result = getRenderedSelectionRoot({ dom: editorDom });
  assert.equal(result?.querySelector("p")?.textContent, "before");
  assert.equal(result?.querySelector("pre code")?.textContent, "const value = 1");
  assert.equal(result?.querySelector(".livemd-code-block-header"), null);
  assert.equal(result?.querySelector(".cm-gutters"), null);
  editorDom.remove();
});

test("getRenderedSelectionRoot keeps prose-to-HTML selections rendered", () => {
  const editorDom = makeRoot(
    '<p>before</p><div class="livemd-html-block"><div class="livemd-html-block-preview"><b>after</b></div>' +
      '<div class="livemd-html-block-editor" style="display:none"><div class="cm-content"><div class="cm-line">&lt;b&gt;after&lt;/b&gt;</div></div></div></div>'
  );
  document.body.appendChild(editorDom);
  const range = document.createRange();
  range.setStart(editorDom.querySelector("p").firstChild, 0);
  range.setEnd(editorDom.querySelector("b").firstChild, 5);
  const selection = document.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  const result = getRenderedSelectionRoot({ dom: editorDom });
  assert.equal(result?.querySelector("p")?.textContent, "before");
  assert.equal(result?.querySelector("b")?.textContent, "after");
  assert.equal(result?.querySelector(".livemd-html-block-editor"), null);
  editorDom.remove();
});

test("getRenderedSelectionRoot renders an HTML block editor semantically", () => {
  const editorDom = makeRoot(
    '<div class="livemd-html-block-editor"><div class="cm-gutters">1</div>' +
      '<div class="cm-content"><div class="cm-line">&lt;b&gt;x&lt;/b&gt;</div></div></div>'
  );
  document.body.appendChild(editorDom);
  const range = document.createRange();
  range.selectNodeContents(editorDom);
  const selection = document.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  const result = getRenderedSelectionRoot({ dom: editorDom });
  assert.equal(result?.querySelector("b")?.textContent, "x");
  assert.equal(result?.querySelector("pre code"), null);
  assert.equal(result?.querySelector(".cm-gutters"), null);
  editorDom.remove();
});

test("getRenderedSelectionRoot turns task markers into semantic checkboxes", () => {
  const editorDom = makeRoot(
    '<ul><li><span class="livemd-task-checkbox" aria-checked="true">✓</span>' +
      '<span class="livemd-list-marker">- [x] </span>done</li></ul>'
  );
  document.body.appendChild(editorDom);
  const range = document.createRange();
  range.selectNodeContents(editorDom);
  const selection = document.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  const result = getRenderedSelectionRoot({ dom: editorDom });
  assert.equal(result?.querySelector("input[type=checkbox]")?.checked, true);
  assert.equal(result?.querySelector(".livemd-list-marker"), null);
  editorDom.remove();
});

test("getRenderedSelectionRoot falls back to ProseMirror DOM positions", () => {
  const editorDom = makeRoot("<p>one</p><p>two</p>");
  document.body.appendChild(editorDom);
  const selection = document.getSelection();
  selection.removeAllRanges();
  const collapsed = document.createRange();
  collapsed.setStart(editorDom, 0);
  collapsed.collapse(true);
  selection.addRange(collapsed);

  const result = getRenderedSelectionRoot({
    dom: editorDom,
    state: { selection: { empty: false, from: 1, to: 7 } },
    domAtPos(pos) {
      return { node: editorDom, offset: pos === 1 ? 0 : 2 };
    },
  });
  assert.equal(result?.textContent, "onetwo");
  editorDom.remove();
});

test("getRenderedSelectionRoot preserves the ProseMirror slice marker", () => {
  const editorDom = makeRoot("<p>text</p>");
  document.body.appendChild(editorDom);
  const range = document.createRange();
  range.selectNodeContents(editorDom);
  const selection = document.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  const result = getRenderedSelectionRoot({
    dom: editorDom,
    state: { selection: { empty: false, content: () => ({}) } },
    serializeForClipboard: () => ({
      dom: makeRoot('<p data-pm-slice="0 1 []">text</p>'),
    }),
  });
  assert.equal(result?.getAttribute("data-pm-slice"), "0 1 []");
  assert.equal(result?.firstElementChild?.getAttribute("data-pm-slice"), "0 1 []");
  editorDom.remove();
});

test("getRenderedNodeRoot keeps the visible image element", () => {
  const imageNode = makeRoot(
    '<div class="livemd-image-block"><div class="livemd-image-preview"><img src="image.png" alt="图"></div></div>'
  );
  const result = getRenderedNodeRoot({ nodeDOM: () => imageNode }, 0);
  assert.equal(result?.querySelector("img")?.getAttribute("src"), "image.png");
});

test("buildClipboardPayload keeps an SVG primary and one PNG fallback", () => {
  const root = makeRoot(
    '<svg data-clipboard-png="data:image/png;base64,fallback"><path></path></svg>'
  );
  const payload = buildClipboardPayload("![图表](chart.svg)", root);
  const parsed = new window.DOMParser().parseFromString(payload.html, "text/html");
  const source = parsed.querySelector("picture source");
  const image = parsed.querySelector("picture img");

  assert.equal(source?.getAttribute("type"), "image/svg+xml");
  assert.equal(image?.getAttribute("src"), "data:image/png;base64,fallback");
  assert.equal(source?.getAttribute("srcset")?.includes("data-clipboard-png"), false);
  assert.equal((payload.html.match(/data:image\/png;base64,fallback/g) || []).length, 1);
});

test("buildClipboardPayload keeps KaTeX HTML and a single PNG fallback", () => {
  const root = makeRoot(
    '<div class="math-preview" data-clipboard-png="data:image/png;base64,math"><span class="katex">x</span></div>'
  );
  const payload = buildClipboardPayload("$$x$$", root);
  const parsed = new window.DOMParser().parseFromString(payload.html, "text/html");

  assert.equal(parsed.querySelector(".math-preview .katex")?.textContent, "x");
  assert.equal(
    parsed.querySelector("img[data-clipboard-fallback-image]")?.getAttribute("src"),
    "data:image/png;base64,math"
  );
  assert.equal((payload.html.match(/data:image\/png;base64,math/g) || []).length, 1);
});

test("self-contained raster markup includes runtime styles without mutating the source", () => {
  const fontStyle = document.createElement("style");
  fontStyle.textContent =
    "@font-face { font-family: RuntimeClipboardFont; src: url(runtime.woff2); }";
  document.head.appendChild(fontStyle);
  const element = makeRoot('<svg style="color: red"><path></path></svg>').firstElementChild;

  try {
    const result = buildSelfContainedMarkup(element);
    assert.equal(result.isSvg, true);
    assert.match(result.markup, /color: red/);
    assert.match(result.markup, /@font-face/);
    assert.equal(element.getAttribute("data-clipboard-png"), null);
  } finally {
    fontStyle.remove();
  }
});

test("cacheClipboardPng leaves the primary usable when rasterization fails", async () => {
  const element = makeRoot(
    '<div class="math-preview" data-clipboard-png="old"><span class="katex">x</span></div>'
  ).firstElementChild;
  const result = await cacheClipboardPng(element);

  assert.equal(result, null);
  assert.equal(element.querySelector(".katex")?.textContent, "x");
  assert.equal(element.getAttribute("data-clipboard-png"), null);
});

test("buildClipboardPayload keeps plain text only in source view", () => {
  const root = makeRoot('<p data-list-id="list-1">- item</p>');
  const payload = buildClipboardPayload("- item", root, { sourceView: true });

  assert.equal(payload.plain, "- item");
  assert.equal(payload.html, "");
});

test("buildCodeClipboardPayload creates a semantic pre/code fragment", () => {
  const payload = buildCodeClipboardPayload("const answer = 42");
  const parsed = new window.DOMParser().parseFromString(payload.html, "text/html");

  assert.equal(payload.plain, "const answer = 42");
  assert.equal(parsed.querySelector("pre code")?.textContent, "const answer = 42");
});

test("buildCodeClipboardPayload carries the current code style", () => {
  const payload = buildCodeClipboardPayload("const answer = 42", {
    codeStyle: "font-size: 20px; line-height: 1.6; white-space: pre;",
  });
  const parsed = new window.DOMParser().parseFromString(payload.html, "text/html");
  assert.equal(parsed.querySelector("pre")?.style.fontSize, "20px");
  assert.equal(parsed.querySelector("code")?.style.whiteSpace, "pre-wrap");
});

test("getCodeClipboardSelection preserves CodeMirror linewise copy semantics", () => {
  const view = {
    state: {
      selection: { ranges: [{ empty: true, from: 2 }] },
      doc: {
        length: 8,
        lineAt: () => ({ number: 1, from: 0, to: 3, text: "one" }),
      },
      lineBreak: "\n",
    },
  };

  assert.deepEqual(getCodeClipboardSelection(view), {
    text: "one",
    ranges: [{ from: 0, to: 4 }],
  });
});

test("writeClipboardEvent writes both formats and reports a rich result", () => {
  const values = new Map();
  const event = {
    clipboardData: {
      clearData() {
        values.clear();
      },
      setData(type, value) {
        values.set(type, value);
      },
    },
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };

  const result = writeClipboardEvent(event, { plain: "# Title", html: "<h1>Title</h1>" });

  assert.deepEqual(result, { status: "rich" });
  assert.equal(event.defaultPrevented, true);
  assert.equal(values.get("text/plain"), "# Title");
  assert.equal(values.get("text/html"), "<h1>Title</h1>");
});

test("writeClipboardEvent falls back to plain text when HTML cannot be written", () => {
  const values = new Map();
  const event = {
    clipboardData: {
      clearData() {
        values.clear();
      },
      setData(type, value) {
        if (type === "text/html") throw new Error("HTML is unavailable");
        values.set(type, value);
      },
    },
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };

  const result = writeClipboardEvent(event, { plain: "# Title", html: "<h1>Title</h1>" });

  assert.deepEqual(result, { status: "plain" });
  assert.equal(event.defaultPrevented, true);
  assert.equal(values.get("text/plain"), "# Title");
  assert.equal(values.has("text/html"), false);
});

test("writeClipboardPayload writes both formats through the browser Clipboard API", async () => {
  let writtenItem;
  const restore = installClipboardEnvironment({
    write: async (items) => {
      writtenItem = items[0];
    },
    writeText: async () => {
      throw new Error("plain fallback should not be used");
    },
    electronAPI: {},
  });

  try {
    const result = await writeClipboardPayload({ plain: "# Title", html: "<h1>Title</h1>" });

    assert.deepEqual(result, { status: "rich" });
    assert.deepEqual(Object.keys(writtenItem.data).sort(), ["text/html", "text/plain"]);
  } finally {
    restore();
  }
});

test("writeClipboardPayload uses the Electron bridge for dual-format fallback", async () => {
  let electronPayload;
  let plainWriteCount = 0;
  const restore = installClipboardEnvironment({
    write: async () => {
      throw new Error("browser rich clipboard is unavailable");
    },
    writeText: async () => {
      plainWriteCount += 1;
    },
    electronAPI: {
      writeToClipboard: async (payload) => {
        electronPayload = payload;
        return true;
      },
    },
  });

  try {
    const result = await writeClipboardPayload({ plain: "# Title", html: "<h1>Title</h1>" });

    assert.deepEqual(result, { status: "rich" });
    assert.deepEqual(electronPayload, { text: "# Title", html: "<h1>Title</h1>" });
    assert.equal(plainWriteCount, 0);
  } finally {
    restore();
  }
});

test("writeClipboardPayload distinguishes plain fallback from failure", async () => {
  const restore = installClipboardEnvironment({
    write: async () => {
      throw new Error("rich clipboard is unavailable");
    },
    writeText: async () => undefined,
    electronAPI: {
      writeToClipboard: async () => false,
    },
  });

  try {
    assert.deepEqual(await writeClipboardPayload({ plain: "plain", html: "<p>rich</p>" }), {
      status: "plain",
    });
  } finally {
    restore();
  }

  const restoreFailure = installClipboardEnvironment({
    write: async () => {
      throw new Error("rich clipboard is unavailable");
    },
    writeText: async () => {
      throw new Error("plain clipboard is unavailable");
    },
    electronAPI: {
      writeToClipboard: async () => false,
      writeTextToClipboard: async () => false,
    },
  });

  try {
    assert.deepEqual(await writeClipboardPayload({ plain: "plain", html: "<p>rich</p>" }), {
      status: "failed",
    });
  } finally {
    restoreFailure();
  }
});

test("canDeleteAfterClipboardWrite only accepts rich writes for rich payloads", () => {
  assert.equal(
    canDeleteAfterClipboardWrite({ plain: "text", html: "<p>text</p>" }, { status: "rich" }),
    true
  );
  assert.equal(
    canDeleteAfterClipboardWrite({ plain: "text", html: "<p>text</p>" }, { status: "plain" }),
    false
  );
  assert.equal(
    canDeleteAfterClipboardWrite(
      { plain: "source", html: "", richRequired: false },
      { status: "plain" }
    ),
    true
  );
  assert.equal(
    canDeleteAfterClipboardWrite(
      { plain: "text", html: "", richRequired: true },
      { status: "plain" }
    ),
    false
  );
  assert.equal(
    canDeleteAfterClipboardWrite({ plain: "text", html: "<p>text</p>" }, { status: "failed" }),
    false
  );
});

function installClipboardEnvironment({ write, writeText, electronAPI }) {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const previousClipboardItem = Object.getOwnPropertyDescriptor(globalThis, "ClipboardItem");
  const previousElectronAPI = window.electronAPI;
  const clipboard = {};
  if (write) clipboard.write = write;
  if (writeText) clipboard.writeText = writeText;

  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard },
  });
  Object.defineProperty(globalThis, "ClipboardItem", {
    configurable: true,
    value: class MockClipboardItem {
      constructor(data) {
        this.data = data;
      }
    },
  });
  window.electronAPI = electronAPI;

  return () => {
    if (previousNavigator) {
      Object.defineProperty(globalThis, "navigator", previousNavigator);
    } else {
      delete globalThis.navigator;
    }
    if (previousClipboardItem) {
      Object.defineProperty(globalThis, "ClipboardItem", previousClipboardItem);
    } else {
      delete globalThis.ClipboardItem;
    }
    if (previousElectronAPI === undefined) delete window.electronAPI;
    else window.electronAPI = previousElectronAPI;
  };
}
