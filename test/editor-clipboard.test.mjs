import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { AllSelection } from "prosemirror-state";
import { createServer } from "vite";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const window = new Window({ url: "http://localhost" });
const previousGlobals = new Map(
  ["window", "document", "Node", "NodeFilter", "HTMLElement", "localStorage", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]
  )
);

Object.assign(globalThis, {
  window,
  document: window.document,
  Node: window.Node,
  NodeFilter: window.NodeFilter,
  HTMLElement: window.HTMLElement,
  localStorage: window.localStorage,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
});
Object.defineProperty(globalThis, "navigator", {
  value: window.navigator,
  configurable: true,
});

const server = await createServer({
  configFile: false,
  root: projectRoot,
  server: { middlewareMode: true },
});
const { LivemdEditor } = await server.ssrLoadModule("/src/core/editor.ts");

after(async () => {
  window.close();
  await server.close();
  for (const [key, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

test("mixed editor copy writes reflowable HTML without viewport geometry", () => {
  const editorStyles = document.createElement("style");
  editorStyles.textContent = readFileSync(
    new URL("../src/core/styles/livemd.css", import.meta.url),
    "utf8"
  );
  document.head.appendChild(editorStyles);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const editor = new LivemdEditor(container, {
    content: [
      "## 标题",
      "",
      "这是一段用于验证复制行为的普通文字。",
      "",
      "| 模块 | 状态 | 说明 |",
      "| --- | --- | --- |",
      "| 测试 | 进行中 | 这是一段比较长的单元格内容，用于检查窄窗口中的换行。 |",
    ].join("\n"),
  });

  try {
    editor.view.dispatch(editor.view.state.tr.setSelection(new AllSelection(editor.view.state.doc)));
    const writes = new Map();
    const event = new window.Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: {
        clearData: () => writes.clear(),
        setData: (type, value) => writes.set(type, value),
      },
    });

    const handled = editor.view.someProp("handleDOMEvents", (handlers) =>
      handlers.copy ? handlers.copy(editor.view, event) : false
    );

    assert.equal(handled, true);
    assert.equal(event.defaultPrevented, true);
    assert.deepEqual([...writes.keys()], ["text/plain", "text/html"]);

    const html = writes.get("text/html");
    assert.ok(html.length < 50_000, `clipboard HTML expanded to ${html.length} characters`);
    const parsed = new window.DOMParser().parseFromString(html, "text/html");
    const table = parsed.querySelector("table");
    const cell = parsed.querySelector("td");
    assert.ok(table);
    assert.ok(cell);
    assert.equal(table.style.width, "");
    assert.equal(table.getAttribute("width"), null);
    assert.equal(cell.style.minWidth, "");
    assert.equal(cell.style.whiteSpace, "normal");
    assert.equal(parsed.querySelectorAll("br").length, 0);
  } finally {
    editor.destroy();
    container.remove();
    editorStyles.remove();
  }
});
