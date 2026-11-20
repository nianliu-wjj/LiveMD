import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { setImmediate } from "node:timers/promises";
import {
  deleteMobileDocuments,
  listMobileDocuments,
  readMobileDocument,
  sanitizeMobileDocumentName,
  saveMobileDocument,
} from "../src/service/mobileDocuments.ts";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const storageKey = "livemd-mobile-documents";
let values;

beforeEach(() => {
  values = new Map();
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  });
});

afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else delete globalThis.window;
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else delete globalThis.localStorage;
});

test("文档标识移除路径和非法字符，并避免 Windows 设备名", () => {
  assert.equal(sanitizeMobileDocumentName(" ../../中文.MD "), "中文.MD");
  assert.equal(sanitizeMobileDocumentName("C:\\fakepath\\笔记.markdown"), "笔记.markdown");
  assert.equal(sanitizeMobileDocumentName("../.."), "");
  assert.equal(sanitizeMobileDocumentName("a:\u0000\u007f?. "), "a____.md");
  assert.equal(sanitizeMobileDocumentName("CON.md"), "_CON.md");
  assert.equal(sanitizeMobileDocumentName("lpt²"), "_lpt².md");
});

test("浏览器文档完整保存 UTF-8、BOM、CRLF，覆盖短内容并删除指定文档", async () => {
  const traits = { hasBOM: true, lineEnding: "crlf", hasTrailingNewline: true };
  const content = "# 中文🙂\n正文\n";
  const raw = "\uFEFF# 中文🙂\r\n正文\r\n";
  const saved = await saveMobileDocument("笔记", content, traits);
  assert.equal(saved.name, "笔记.md");
  assert.equal(saved.size, Buffer.byteLength(raw));
  assert.equal(JSON.parse(values.get(storageKey))["笔记.md"].content, raw);
  assert.deepEqual(await readMobileDocument("笔记.md"), { content, fileTraits: traits });

  await saveMobileDocument("笔记.md", "短");
  await saveMobileDocument("空.md", "");
  assert.equal((await readMobileDocument("笔记.md")).content, "短");
  assert.equal((await readMobileDocument("空.md")).content, "");
  assert.equal((await listMobileDocuments()).length, 2);
  assert.equal(await deleteMobileDocuments(["笔记.md", "笔记.md", "不存在.md"]), 1);
  assert.equal(await readMobileDocument("笔记.md"), null);
  assert.equal((await readMobileDocument("空.md")).content, "");
});

test("存储写入失败和损坏数据不得报告保存成功或覆盖已有数据", async () => {
  await saveMobileDocument("保留.md", "原内容");
  const original = values.get(storageKey);
  const setItem = localStorage.setItem;
  localStorage.setItem = () => {
    throw new Error("quota");
  };
  await assert.rejects(saveMobileDocument("保留.md", "新内容"), /保存文档失败/);
  assert.equal(values.get(storageKey), original);
  assert.equal((await readMobileDocument("保留.md")).content, "原内容");
  localStorage.setItem = setItem;
  await saveMobileDocument("保留.md", "重试成功");
  assert.equal((await readMobileDocument("保留.md")).content, "重试成功");

  values.set(storageKey, '{"损坏.md":null}');
  await assert.rejects(saveMobileDocument("新文档.md", "正文"), /数据已损坏/);
  assert.equal(values.get(storageKey), '{"损坏.md":null}');
});

test("鸿蒙桥保存原始 UTF-8 格式，并区分空文档、缺失文档与读取错误", async () => {
  const documents = new Map();
  window.harmonyBridge = {
    listDocuments: () => JSON.stringify({ ok: true, documents: [] }),
    saveDocument(name, content) {
      documents.set(name, content);
      return JSON.stringify({
        ok: true,
        document: { name, size: Buffer.byteLength(content), modifiedAt: Date.now() },
      });
    },
    readDocument: (name) =>
      JSON.stringify({ ok: true, found: documents.has(name), content: documents.get(name) }),
    deleteDocuments: (names) =>
      JSON.stringify({
        ok: true,
        deleted: JSON.parse(names).filter((name) => documents.delete(name)).length,
      }),
  };
  const traits = { hasBOM: true, lineEnding: "crlf", hasTrailingNewline: true };
  await saveMobileDocument("桥接.md", "中文\n", traits);
  assert.equal(documents.get("桥接.md"), "\uFEFF中文\r\n");
  assert.deepEqual(await readMobileDocument("桥接.md"), { content: "中文\n", fileTraits: traits });
  assert.equal(await readMobileDocument("缺失.md"), null);
  await saveMobileDocument("空.md", "");
  assert.equal((await readMobileDocument("空.md")).content, "");
  assert.equal(await deleteMobileDocuments(["桥接.md"]), 1);

  window.harmonyBridge.readDocument = () => JSON.stringify({ ok: false, error: "读取被拒绝" });
  await assert.rejects(readMobileDocument("空.md"), /读取被拒绝/);
  window.harmonyBridge.readDocument = () => "invalid";
  await assert.rejects(readMobileDocument("空.md"), /无法解析/);
});

test("Tauri 同名保存按提交顺序执行，其他文档不被阻塞，删除等待保存结束", async () => {
  const calls = [];
  const stored = new Map();
  let finishFirst;
  window.__TAURI_INTERNALS__ = {
    async invoke(command, args) {
      calls.push({ command, ...args });
      if (command === "save_mobile_document") {
        if (args.content === "自动保存") await new Promise((resolve) => (finishFirst = resolve));
        stored.set(args.name, args.content);
        return { name: args.name, size: Buffer.byteLength(args.content), modifiedAt: Date.now() };
      }
      if (command === "delete_mobile_documents") {
        return args.names.filter((name) => stored.delete(name)).length;
      }
    },
  };
  const traits = { hasBOM: true, lineEnding: "crlf", hasTrailingNewline: false };
  const first = saveMobileDocument("同名.md", "自动保存", traits);
  const second = saveMobileDocument("同名.md", "手动保存", traits);
  traits.hasBOM = false;
  const other = saveMobileDocument("其他.md", "独立文档");
  await setImmediate();
  assert.equal(calls.filter((call) => call.name === "同名.md").length, 1);
  await other;
  const deletion = deleteMobileDocuments(["同名.md"]);
  finishFirst();
  await Promise.all([first, second]);
  assert.equal(await deletion, 1);
  assert.equal(stored.has("同名.md"), false);
  assert.equal(stored.get("其他.md"), "独立文档");
  assert.deepEqual(
    calls.filter((call) => call.name === "同名.md").map((call) => call.content),
    ["自动保存", "手动保存"]
  );
  assert.equal(calls[0].fileTraits.hasBOM, true);
});

test("Tauri 保存失败后队列继续处理后续保存", async () => {
  const calls = [];
  window.__TAURI_INTERNALS__ = {
    async invoke(command, args) {
      calls.push(args.content);
      if (args.content === "失败") throw new Error("磁盘写入失败");
      return { name: args.name, size: 2, modifiedAt: Date.now() };
    },
  };
  const first = saveMobileDocument("文档.md", "失败");
  const second = saveMobileDocument("文档.md", "成功");
  await assert.rejects(first, /磁盘写入失败/);
  assert.equal((await second).name, "文档.md");
  assert.deepEqual(calls, ["失败", "成功"]);
});
