import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as vue from "vue";

const hookSource = readFileSync(
  new URL("../src/renderer/hooks/useTab.ts", import.meta.url),
  "utf8"
);
const hookCode = ts.transpileModule(hookSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ESNext,
    esModuleInterop: true,
  },
}).outputText;

function tabData(overrides = {}) {
  return {
    id: "source-tab",
    name: "Untitled",
    filePath: null,
    content: "unsaved source content",
    originalContent: "original source content",
    isModified: true,
    scrollRatio: 0.45,
    readOnly: false,
    ...overrides,
  };
}

function createWindow(t, apiOverrides = {}) {
  const handlers = new Map();
  const calls = [];
  const timers = new Map();
  const scope = vue.effectScope();
  let nextId = 0;
  let nextTimerId = 0;
  let imagePath = null;
  const api = {
    getInitialTabData: async () => null,
    onOpenFileAtLaunch() {},
    on: (event, handler) => handlers.set(event, handler),
    watchFiles() {},
    startWindowDrag: (...args) => calls.push(["startWindowDrag", ...args]),
    stopWindowDrag: () => calls.push(["stopWindowDrag"]),
    dropMerge: async (...args) => {
      calls.push(["dropMerge", ...args]);
      return { action: "merged" };
    },
    closeDiscard: () => calls.push(["closeDiscard"]),
    ...apiOverrides,
  };
  const dependencies = {
    vue,
    "autotoast.js": { show() {} },
    "@/plugins/imagePathPlugin": {
      setCurrentMarkdownFilePath: (value) => {
        imagePath = value;
      },
    },
    "@/renderer/events": { emit() {} },
    "@/renderer/services/fileService": {},
    "@/renderer/utils/inertiaScroll": {},
    "@/renderer/utils/markdown": { normalizeMarkdownForDirtyCheck: (value) => value },
    "@/renderer/utils/tool": { randomUUID: () => `local-tab-${++nextId}` },
    "./useConfig": { useConfig: () => ({ config: vue.ref({ other: { autoSave: false } }) }) },
    "./useRecentFiles": { recordRecentFile() {} },
    "./useUiLoading": () => ({
      showLoading() {},
      hideLoading: async () => {},
      nextFrame: async () => {},
    }),
    // 只读模式开关（状态栏锁形按钮）：测试中恒为关闭
    "@/renderer/hooks/useReadOnlyMode": { isReadOnlyMode: vue.ref(false) },
    // 图片插入规则：本文件用例不涉及图片落盘，返回不落盘的默认目标
    "@/shared/utils/imageInsert": {
      resolveImageSaveTarget: () => ({
        targetPath: "",
        useFileNameFolder: false,
        saveToTemp: false,
      }),
    },
  };
  const exports = {};
  scope.run(() =>
    runInNewContext(
      hookCode,
      {
        exports,
        require: (name) => {
          assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
          return dependencies[name];
        },
        window: { electronAPI: api, screenX: 0 },
        document: { querySelectorAll: () => [] },
        console: { error: (...args) => calls.push(["error", ...args]) },
        setTimeout: (callback) => {
          const id = ++nextTimerId;
          timers.set(id, callback);
          return id;
        },
        clearTimeout: (id) => timers.delete(id),
      },
      { filename: "useTab.ts" }
    )
  );
  t.after(() => {
    scope.stop();
    timers.clear();
  });

  const win = {
    ...exports.default(),
    calls,
    emit: (event, ...args) => {
      assert.ok(handlers.has(event), `Missing event handler: ${event}`);
      return handlers.get(event)(...args);
    },
    get imagePath() {
      return imagePath;
    },
  };

  // 应用启动不再预置空白 Tab（无标签页时内容区展示首页，见 components/home/HomePage.vue），
  // 而本文件用例描述的都是「窗口里已经打开了一个文档」时的拖拽/合并语义，
  // 因此这里显式补一个空白 Tab：与旧实现的启动状态等价，随机 id 计数同样从 local-tab-1 起。
  win.createNewTab();

  return win;
}

test("dropping an unsaved tab promotes its preview without adding a third tab", (t) => {
  const target = createWindow(t);
  const data = tabData();
  target.emit("tab:merge-preview", data);
  const previewId = target.currentTab.value.id;

  target.emit("tab:merge-in", data);

  assert.equal(target.tabs.value.length, 2);
  assert.equal(target.currentTab.value.id, previewId);
  assert.equal(target.currentTab.value.isMergePreview, false);
  assert.equal(target.currentTab.value.content, data.content);
  assert.equal(target.currentTab.value.originalContent, data.originalContent);
  assert.equal(target.currentTab.value.isModified, true);
  assert.equal(target.currentTab.value.isNewlyLoaded, false);
  assert.equal(target.currentTab.value.scrollRatio, data.scrollRatio);
});

test("finalizing a preview uses the latest source content and document traits", (t) => {
  const target = createWindow(t);
  target.emit("tab:merge-preview", tabData());
  const previewId = target.currentTab.value.id;
  const data = tabData({
    content: "latest source content",
    filePath: "D:/notes/source.md",
    name: "source.md",
    fileTraits: { hasBOM: true, lineEnding: "crlf", hasTrailingNewline: true },
  });

  target.emit("tab:merge-preview-finalize", data);

  assert.equal(target.tabs.value.length, 2);
  assert.equal(target.currentTab.value.id, previewId);
  assert.equal(target.currentTab.value.content, data.content);
  assert.equal(target.currentTab.value.filePath, data.filePath);
  assert.equal(target.currentTab.value.fileTraits.hasBOM, true);
  assert.equal(target.currentTab.value.isModified, true);
  assert.equal(target.imagePath, data.filePath);
});

test("repeated hover events leave one preview and cancellation restores the original tab", (t) => {
  const target = createWindow(t);
  const originalId = target.activeTabId.value;
  target.emit("tab:merge-preview", tabData());
  target.emit("tab:merge-preview", tabData());

  assert.equal(target.tabs.value.length, 2);
  assert.equal(target.tabs.value.filter((tab) => tab.isMergePreview).length, 1);

  target.emit("tab:merge-preview-cancel");

  assert.equal(target.tabs.value.length, 1);
  assert.equal(target.activeTabId.value, originalId);
});

test("switching a preview to an already open file removes the previous preview", (t) => {
  const target = createWindow(t);
  const originalId = target.activeTabId.value;
  const existing = target.add({ ...tabData({ id: "existing", filePath: "D:/notes/existing.md" }) });
  target.switchToTab(originalId);
  target.emit("tab:merge-preview", tabData());
  target.emit("tab:merge-preview", tabData({ filePath: existing.filePath }));

  assert.equal(target.tabs.value.length, 2);
  assert.equal(
    target.tabs.value.some((tab) => tab.isMergePreview),
    false
  );
  assert.equal(target.activeTabId.value, existing.id);

  target.emit("tab:merge-preview-cancel");
  assert.equal(target.activeTabId.value, originalId);
});

test("merging an already open file keeps a single tab for that path", (t) => {
  const target = createWindow(t);
  const existing = target.add({ ...tabData({ id: "existing", filePath: "D:/notes/existing.md" }) });
  target.emit("tab:merge-preview", tabData());
  target.emit("tab:merge-in", tabData({ filePath: existing.filePath }));

  assert.equal(target.tabs.value.length, 2);
  assert.equal(target.tabs.value.filter((tab) => tab.filePath === existing.filePath).length, 1);
  assert.equal(
    target.tabs.value.some((tab) => tab.isMergePreview),
    false
  );
  assert.equal(target.activeTabId.value, existing.id);
});

test("merging keeps the tracked preview and removes orphan previews", (t) => {
  const target = createWindow(t);
  target.emit("tab:merge-preview", tabData());
  const previewId = target.currentTab.value.id;
  target.tabs.value.unshift({ ...tabData({ id: "orphan" }), isMergePreview: true });

  target.emit("tab:merge-in", tabData());

  assert.equal(target.tabs.value.length, 2);
  assert.equal(target.currentTab.value.id, previewId);
  assert.equal(
    target.tabs.value.some((tab) => tab.id === "orphan"),
    false
  );
});

test("a late cancellation after promotion leaves the merged tab intact", (t) => {
  const target = createWindow(t);
  target.emit("tab:merge-preview", tabData());
  const previewId = target.currentTab.value.id;
  target.emit("tab:merge-in", tabData());
  target.emit("tab:merge-preview-cancel");

  assert.equal(target.tabs.value.length, 2);
  assert.equal(target.activeTabId.value, previewId);
});

test("dropping without a hover preview inserts exactly one tab", (t) => {
  const target = createWindow(t);
  target.emit("tab:merge-in", tabData());

  assert.equal(target.tabs.value.length, 2);
  assert.equal(target.currentTab.value.content, tabData().content);
});

test("single-tab window drop commits the merge before closing the source window", async (t) => {
  const source = createWindow(t);
  source.startSingleTabDrag(source.activeTabId.value, 12, 8);
  await source.endSingleTabDrag(320, 160);

  assert.deepEqual(
    source.calls.map(([name]) => name),
    ["startWindowDrag", "dropMerge", "closeDiscard"]
  );
  assert.equal(source.calls[1][2], 320);
  assert.equal(source.calls[1][3], 160);
});

test("dropping away from other windows stops dragging and keeps the source open", async (t) => {
  const source = createWindow(t, { dropMerge: async () => ({ action: "none" }) });
  await source.endSingleTabDrag(320, 160);

  assert.deepEqual(
    source.calls.map(([name]) => name),
    ["stopWindowDrag"]
  );
  assert.equal(source.tabs.value.length, 1);
});

test("a failed merge stops dragging and preserves the source tab", async (t) => {
  const source = createWindow(t, {
    dropMerge: async () => {
      throw new Error("IPC failed");
    },
  });
  await source.endSingleTabDrag(320, 160);

  assert.deepEqual(
    source.calls.map(([name]) => name),
    ["error", "stopWindowDrag"]
  );
  assert.equal(source.tabs.value.length, 1);
});
