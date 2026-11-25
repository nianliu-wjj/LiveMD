import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Window } from "happy-dom";
import { TextSelection } from "prosemirror-state";
import { undo } from "prosemirror-history";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = createRequire(require.resolve("vite"))("esbuild");
const directory = mkdtempSync(join(projectRoot, ".git", "mobile-mode-test-"));
const window = new Window({ url: "http://localhost" });
const globals = {
  window,
  document: window.document,
  Node: window.Node,
  NodeFilter: window.NodeFilter,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  localStorage: window.localStorage,
  navigator: window.navigator,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
};
const previousGlobals = new Map(
  Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
);
for (const [key, value] of Object.entries(globals)) {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}
const editorModule = join(directory, "editor.mjs");
await esbuild.build({
  stdin: {
    contents: [
      'export { LivemdEditor } from "./src/core/editor.ts";',
      'export { getInstantRenderState } from "./src/core/plugins/instant-render.ts";',
      'export { createMobileEditorPresentation } from "./src/hooks/useMobileViewMode.ts";',
    ].join("\n"),
    resolveDir: projectRoot,
    loader: "ts",
  },
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  outfile: editorModule,
  define: { "import.meta.env.DEV": "true" },
  plugins: [
    {
      name: "omit-css",
      setup(build) {
        build.onResolve({ filter: /\.css$/ }, (args) => ({
          path: args.path,
          namespace: "css-stub",
        }));
        build.onLoad({ filter: /.*/, namespace: "css-stub" }, () => ({
          contents: "",
          loader: "js",
        }));
      },
    },
  ],
});
const { LivemdEditor, getInstantRenderState, createMobileEditorPresentation } = await import(
  pathToFileURL(editorModule).href
);
const styles = document.createElement("style");
styles.textContent = readFileSync(
  new URL("../src/core/styles/livemd.css", import.meta.url),
  "utf8"
);
document.head.appendChild(styles);

after(() => {
  window.close();
  rmSync(directory, { recursive: true, force: true });
  for (const [key, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

async function loadModeHook(name) {
  const output = join(directory, `${name}.mjs`);
  esbuild.buildSync({
    entryPoints: [join(projectRoot, "src/hooks/useMobileViewMode.ts")],
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
    outfile: output,
  });
  return (await import(pathToFileURL(output).href)).default;
}

function createEditor(content, config = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const editor = new LivemdEditor(container, { content, ...config });
  return {
    editor,
    dispose: () => {
      editor.destroy();
      container.remove();
    },
  };
}

function putCaretInside(editor, text) {
  let position;
  editor.view.state.doc.descendants((node, pos) => {
    if (position === undefined && node.isText && node.text?.includes(text)) {
      position = pos + node.text.indexOf(text) + 1;
    }
  });
  assert.notEqual(position, undefined, `应找到 ${text} 的光标位置`);
  editor.view.dispatch(
    editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, position))
  );
}

function markerDisplay(editor, type) {
  const marker = editor.view.dom.querySelector(`[data-syntax-type="${type}"] .livemd-syntax-meta`);
  assert.ok(marker, `应存在 ${type} 语法标记`);
  return getComputedStyle(marker).display;
}

function applyPresentation(presentation, editor, readOnly, instantRender) {
  editor.updateConfig({ readonly: readOnly });
  presentation.sync(editor, readOnly, instantRender, (enabled) => {
    if (editor.isSourceViewEnabled() !== enabled) editor.toggleSourceView();
  });
}

test("移动只读预览在各编辑模式下都隐藏光标附近标题、强调和公式源码", () => {
  const source = "## 标题\n\n**粗体** 与 $x^2$ 公式";
  for (const mode of ["instant", "split", "wysiwyg"]) {
    for (const savedSourceView of [false, true]) {
      const presentation = createMobileEditorPresentation(true);
      const { editor, dispose } = createEditor(source, {
        readonly: true,
        ...presentation.initialConfig(true, savedSourceView, mode === "instant"),
      });
      try {
        const markdown = editor.getMarkdown();
        const doc = editor.view.state.doc;
        assert.equal(editor.view.editable, false);
        assert.equal(editor.isSourceViewEnabled(), false);
        assert.equal(getInstantRenderState(editor.view.state).enabled, false);

        putCaretInside(editor, "标题");
        assert.equal(markerDisplay(editor, "heading"), "none", mode);
        putCaretInside(editor, "粗体");
        assert.equal(markerDisplay(editor, "strong"), "none", mode);
        putCaretInside(editor, "x^2");
        assert.ok(editor.view.dom.querySelector(".livemd-math-source-hidden"));
        assert.ok(editor.view.dom.querySelector(".livemd-math-rendered, .livemd-math-pending"));
        assert.equal(editor.view.dom.querySelector(".livemd-focus-block"), null);

        const state = editor.view.state;
        applyPresentation(presentation, editor, true, true);
        assert.equal(editor.view.state, state, "模式事件不能重新打开只读预览的语法标记");
        assert.equal(editor.view.state.doc, doc);
        assert.equal(editor.getMarkdown(), markdown);
      } finally {
        dispose();
      }
    }
  }
});

test("移动阅读与编辑切换恢复选择的编辑模式，保持正文、选区和撤销历史", () => {
  const presentation = createMobileEditorPresentation(true);
  const { editor, dispose } = createEditor("## 标题\n\n**粗体** 与普通文本", {
    ...presentation.initialConfig(false, false, true),
  });
  try {
    putCaretInside(editor, "粗体");
    assert.equal(markerDisplay(editor, "strong"), "inline");
    const doc = editor.view.state.doc;
    const selection = editor.view.state.selection;
    const markdown = editor.getMarkdown();

    applyPresentation(presentation, editor, true, true);
    assert.equal(editor.view.editable, false);
    assert.equal(markerDisplay(editor, "strong"), "none");
    assert.equal(editor.view.state.doc, doc);
    assert.ok(editor.view.state.selection.eq(selection));

    applyPresentation(presentation, editor, false, false);
    assert.equal(editor.view.editable, true);
    assert.equal(markerDisplay(editor, "strong"), "none", "所见即所得编辑仍隐藏源码");
    applyPresentation(presentation, editor, false, true);
    assert.equal(markerDisplay(editor, "strong"), "inline", "即时渲染编辑恢复光标区域源码");
    applyPresentation(presentation, editor, true, true);
    assert.equal(markerDisplay(editor, "strong"), "none");
    assert.equal(editor.view.state.doc, doc);
    assert.ok(editor.view.state.selection.eq(selection));
    assert.equal(editor.getMarkdown(), markdown);
    assert.equal(undo(editor.view.state), false);
  } finally {
    dispose();
  }
});

test("移动阅读临时退出源码视图，重建后进入编辑仍恢复原有源码视图", () => {
  const source = "## 标题\n\n**粗体** 与普通文本";
  const presentation = createMobileEditorPresentation(true);
  const first = createEditor(source, presentation.initialConfig(false, true, true));
  let recreated;
  try {
    const markdown = first.editor.getMarkdown();
    assert.equal(first.editor.isSourceViewEnabled(), true);
    applyPresentation(presentation, first.editor, true, true);
    assert.equal(first.editor.isSourceViewEnabled(), false);
    assert.equal(getInstantRenderState(first.editor.view.state).enabled, false);
    assert.equal(first.editor.getMarkdown(), markdown);

    recreated = createEditor(markdown, {
      readonly: true,
      ...presentation.initialConfig(true, false, true),
    });
    putCaretInside(recreated.editor, "标题");
    assert.equal(markerDisplay(recreated.editor, "heading"), "none");
    applyPresentation(presentation, recreated.editor, false, true);
    assert.equal(recreated.editor.isSourceViewEnabled(), true);
    assert.equal(recreated.editor.view.editable, true);
    assert.equal(recreated.editor.getMarkdown(), markdown);
  } finally {
    first.dispose();
    recreated?.dispose();
  }
});

test("移动阅读控制独立于其它文档，桌面的只读与源码行为保持不变", () => {
  const source = "## 标题\n\n**粗体** 与普通文本";
  const readingPresentation = createMobileEditorPresentation(true);
  const editingPresentation = createMobileEditorPresentation(true);
  const desktopPresentation = createMobileEditorPresentation(false);
  const reading = createEditor(source, {
    readonly: true,
    ...readingPresentation.initialConfig(true, false, true),
  });
  const editing = createEditor(source, editingPresentation.initialConfig(false, false, true));
  const desktop = createEditor(source, {
    readonly: true,
    ...desktopPresentation.initialConfig(true, true, false),
  });
  try {
    putCaretInside(reading.editor, "粗体");
    putCaretInside(editing.editor, "粗体");
    assert.equal(markerDisplay(reading.editor, "strong"), "none");
    assert.equal(markerDisplay(editing.editor, "strong"), "inline");
    assert.equal(desktop.editor.isSourceViewEnabled(), true);
    const desktopState = desktop.editor.view.state;
    desktopPresentation.sync(desktop.editor, true, false, () => {
      assert.fail("移动阅读控制不能改变桌面源码模式");
    });
    assert.equal(desktop.editor.view.state, desktopState);
    assert.equal(getInstantRenderState(desktop.editor.view.state).enabled, true);
    assert.equal(desktop.editor.view.editable, false);
  } finally {
    reading.dispose();
    editing.dispose();
    desktop.dispose();
  }
});

test("即时渲染切换会实际隐藏语法标记，保留文档、选区与文本 DOM", () => {
  const { editor, dispose } = createEditor("## 标题\n\n**粗体** 与普通文本");
  try {
    putCaretInside(editor, "粗体");
    assert.equal(markerDisplay(editor, "strong"), "inline");
    const marker = editor.view.dom.querySelector('[data-syntax-type="strong"]');
    const doc = editor.view.state.doc;
    const selection = editor.view.state.selection;

    editor.setInstantRenderEnabled(false);
    assert.equal(markerDisplay(editor, "strong"), "none");
    assert.equal(editor.view.dom.querySelector(".livemd-focus-block"), null);
    assert.equal(getInstantRenderState(editor.view.state).enabled, false);
    assert.equal(editor.view.state.doc, doc);
    assert.ok(editor.view.state.selection.eq(selection));
    assert.equal(editor.view.dom.querySelector('[data-syntax-type="strong"]'), marker);

    const disabledState = editor.view.state;
    editor.setInstantRenderEnabled(false);
    assert.equal(editor.view.state, disabledState, "重复同步模式不应产生额外事务");

    editor.setInstantRenderEnabled(true);
    assert.equal(markerDisplay(editor, "strong"), "inline");
    assert.equal(editor.view.state.doc, doc);
    assert.equal(editor.view.dom.querySelector('[data-syntax-type="strong"]'), marker);
    assert.equal(undo(editor.view.state), false, "模式切换不应产生撤销历史");
  } finally {
    dispose();
  }
});

test("所见即所得从创建到光标移动均隐藏标题与公式源码，多文档互不影响", () => {
  const source = "## 标题\n\n**粗体** 与 $x^2$ 公式";
  const first = createEditor(source, { instantRender: false });
  const second = createEditor(source);
  try {
    const editor = first.editor;
    putCaretInside(editor, "标题");
    assert.equal(markerDisplay(editor, "heading"), "none");
    putCaretInside(editor, "粗体");
    assert.equal(markerDisplay(editor, "strong"), "none");
    putCaretInside(editor, "x^2");
    assert.ok(editor.view.dom.querySelector(".livemd-math-source-hidden"));
    assert.ok(editor.view.dom.querySelector(".livemd-math-rendered, .livemd-math-pending"));

    putCaretInside(second.editor, "粗体");
    assert.equal(markerDisplay(second.editor, "strong"), "inline");
    assert.equal(markerDisplay(editor, "strong"), "none");

    editor.updateConfig({ instantRender: true });
    putCaretInside(editor, "标题");
    assert.equal(markerDisplay(editor, "heading"), "inline");
    editor.updateConfig({ instantRender: false });
    assert.equal(markerDisplay(editor, "heading"), "none");
    assert.equal(editor.getConfig().instantRender, false);
  } finally {
    first.dispose();
    second.dispose();
  }
});

test("源码视图显示标记，退出后恢复所见即所得状态", () => {
  const source = "## 标题\n\n**粗体** 与普通文本";
  const { editor, dispose } = createEditor(source, { instantRender: false });
  try {
    const originalMarkdown = editor.getMarkdown();
    putCaretInside(editor, "粗体");
    editor.updateConfig({ sourceView: true });
    assert.ok(editor.view.dom.classList.contains("source-view"));
    assert.equal(markerDisplay(editor, "strong"), "inline");
    editor.updateConfig({ sourceView: false });
    assert.equal(editor.view.dom.classList.contains("source-view"), false);
    // happy-dom 会保留被搬移节点的样式缓存；用当前 DOM 快照验证最终 CSS 匹配。
    // Chromium 的同步 source-view 进入/退出显隐另由浏览器场景验证。
    const snapshot = editor.view.dom.cloneNode(true);
    document.body.appendChild(snapshot);
    try {
      const marker = snapshot.querySelector('[data-syntax-type="strong"] .livemd-syntax-meta');
      assert.equal(getComputedStyle(marker).display, "none");
    } finally {
      snapshot.remove();
    }
    assert.equal(getInstantRenderState(editor.view.state).enabled, false);
    assert.equal(editor.getMarkdown(), originalMarkdown);
  } finally {
    dispose();
  }
});

test("移动视图模式恢复、共享与存储不可用时的内存切换保持一致", async () => {
  localStorage.setItem("livemd-mobile-view-mode", "split");
  const useMobileViewMode = await loadModeHook("saved-mode");
  const first = useMobileViewMode();
  const second = useMobileViewMode();
  assert.equal(first.mobileViewMode.value, "split");
  assert.equal(first.mobileInstantRenderEnabled.value, false);

  first.setMobileViewMode("instant");
  assert.equal(second.mobileViewMode.value, "instant");
  assert.equal(second.mobileInstantRenderEnabled.value, true);
  assert.equal(localStorage.getItem("livemd-mobile-view-mode"), "instant");

  const savedStorage = globalThis.localStorage;
  try {
    globalThis.localStorage = {
      setItem() {
        throw new Error("Storage unavailable");
      },
    };
    second.setMobileViewMode("wysiwyg");
    assert.equal(first.mobileViewMode.value, "wysiwyg");
    assert.equal(first.mobileInstantRenderEnabled.value, false);
    first.setMobileViewMode("instant");
    assert.equal(second.mobileInstantRenderEnabled.value, true);
  } finally {
    globalThis.localStorage = savedStorage;
    first.setMobileViewMode("instant");
  }
});

test("无效或不可读取的移动视图偏好回退到即时渲染", async () => {
  localStorage.setItem("livemd-mobile-view-mode", "unknown");
  const invalid = (await loadModeHook("invalid-mode"))();
  assert.equal(invalid.mobileViewMode.value, "instant");
  assert.equal(invalid.mobileInstantRenderEnabled.value, true);

  const savedStorage = globalThis.localStorage;
  try {
    globalThis.localStorage = {
      getItem() {
        throw new Error("Storage unavailable");
      },
    };
    const unavailable = (await loadModeHook("unavailable-mode"))();
    assert.equal(unavailable.mobileViewMode.value, "instant");
    assert.equal(unavailable.mobileInstantRenderEnabled.value, true);
  } finally {
    globalThis.localStorage = savedStorage;
  }
});
