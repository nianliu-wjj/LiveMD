import { invoke } from "@tauri-apps/api/core";
import { decodeMobileMarkdown } from "./mobileFile.ts";

/**
 * 移动端应用文档库
 *
 * 两条后端：
 * - Android（Tauri）：Rust 命令读写应用文档目录（Android/data/<包名>/files/Documents）
 * - 鸿蒙（ArkWeb）：Index.ets 注入的 harmonyBridge，读写 filesDir/documents
 *
 * 文档以「文件名」为唯一标识，不使用 content:// URI；浏览器预览时回退到 localStorage。
 */

export interface MobileDocumentInfo {
  name: string;
  size: number;
  modifiedAt: number;
}

export interface MobileDocumentContent {
  content: string;
  fileTraits: FileTraitsDTO;
}

interface HarmonyBridge {
  listDocuments(): string;
  readDocument(name: string): string;
  saveDocument(name: string, content: string): string;
  deleteDocuments(namesJson: string): string;
}

interface BridgeResult {
  ok: boolean;
  error?: string;
}

interface BridgeListResult extends BridgeResult {
  documents?: MobileDocumentInfo[];
}

interface BridgeReadResult extends BridgeResult {
  found?: boolean;
  content?: string;
}

interface BridgeSaveResult extends BridgeResult {
  document?: MobileDocumentInfo;
}

interface BridgeDeleteResult extends BridgeResult {
  deleted?: number;
}

const RECENT_KEY = "livemd-mobile-document-recents";
const LOCAL_DOCS_KEY = "livemd-mobile-documents";
const MAX_RECENT = 20;

function harmonyBridge(): HarmonyBridge | null {
  const candidate = (window as unknown as { harmonyBridge?: HarmonyBridge }).harmonyBridge;
  if (
    candidate &&
    typeof candidate.listDocuments === "function" &&
    typeof candidate.readDocument === "function" &&
    typeof candidate.saveDocument === "function" &&
    typeof candidate.deleteDocuments === "function"
  ) {
    return candidate;
  }
  return null;
}

function isTauriRuntime(): boolean {
  return (
    typeof (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !==
    "undefined"
  );
}

function parseBridge<T extends BridgeResult>(raw: string): T {
  let parsed: T;
  try {
    parsed = JSON.parse(raw) as T;
  } catch {
    throw new Error("鸿蒙文件桥返回了无法解析的结果");
  }
  if (!parsed || parsed.ok !== true) {
    throw new Error(parsed?.error || "鸿蒙文件操作失败");
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// 浏览器预览回退（仅用于脱离移动壳调试界面）
// ---------------------------------------------------------------------------

type LocalDocumentMap = Record<string, { content: string; modifiedAt: number }>;

function readLocalDocuments(): LocalDocumentMap {
  let raw: string | null;
  try {
    raw = localStorage.getItem(LOCAL_DOCS_KEY);
  } catch {
    throw new Error("无法读取浏览器文档库");
  }
  if (!raw) return Object.create(null) as LocalDocumentMap;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("浏览器文档库数据已损坏");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("浏览器文档库数据已损坏");
  }
  const documents = Object.create(null) as LocalDocumentMap;
  for (const [name, value] of Object.entries(parsed)) {
    const entry = value as LocalDocumentMap[string] | null;
    if (
      sanitizeMobileDocumentName(name) !== name ||
      !entry ||
      typeof entry.content !== "string" ||
      !Number.isFinite(entry.modifiedAt) ||
      entry.modifiedAt < 0
    ) {
      throw new Error("浏览器文档库数据已损坏");
    }
    documents[name] = { content: entry.content, modifiedAt: entry.modifiedAt };
  }
  return documents;
}

function writeLocalDocuments(documents: LocalDocumentMap): void {
  try {
    localStorage.setItem(LOCAL_DOCS_KEY, JSON.stringify(documents));
  } catch {
    throw new Error("保存文档失败：浏览器存储空间不足或不可用");
  }
}

function byteSize(content: string): number {
  try {
    return new TextEncoder().encode(content).length;
  } catch {
    return content.length;
  }
}

// ---------------------------------------------------------------------------
// 公共 API
// ---------------------------------------------------------------------------

export function sanitizeMobileDocumentName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const base = (trimmed.split(/[/\\]/).pop() ?? trimmed).trim();
  let cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f<>:"|?*]/g, "_")
    .trim()
    .replace(/[. ]+$/g, "");
  if (!cleaned || cleaned === "." || cleaned === "..") return "";
  if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(cleaned)) {
    cleaned = "_" + cleaned;
  }
  return /\.(md|markdown)$/i.test(cleaned) ? cleaned : `${cleaned}.md`;
}

/** 同名时生成「文件名 (2).md」 */
export function ensureUniqueDocumentName(raw: string, existing: string[]): string {
  const base = sanitizeMobileDocumentName(raw);
  if (!base) return "";
  const taken = new Set(existing.map((name) => name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;

  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : ".md";
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${stem} (${index})${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${stem} (${Date.now()})${ext}`;
}

export function formatMobileDocumentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatMobileDocumentDate(timestamp: number): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(timestamp) || Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDiff = Math.round((startOfToday - startOfDate) / 86_400_000);
  if (dayDiff <= 0) {
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  if (dayDiff === 1) return "昨天";
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

/** 同一文档的读写和删除按请求顺序执行，避免自动保存覆盖更新的手动保存。 */
const pendingDocumentOperations = new Map<string, Promise<unknown>>();

function withDocumentOperation<T>(names: string[], run: () => Promise<T>): Promise<T> {
  const keys = [...new Set(names.map((name) => name.toLowerCase()))];
  const previous = keys.map((key) => pendingDocumentOperations.get(key));
  const operation = Promise.all(previous.map((pending) => pending?.catch(() => undefined))).then(
    run
  );
  for (const key of keys) pendingDocumentOperations.set(key, operation);
  return operation.finally(() => {
    for (const key of keys) {
      if (pendingDocumentOperations.get(key) === operation) pendingDocumentOperations.delete(key);
    }
  });
}

function restoreMobileContent(content: string, fileTraits?: FileTraitsDTO): string {
  if (!fileTraits) return content;
  let restored = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (fileTraits.hasTrailingNewline) {
    if (!restored.endsWith("\n")) restored += "\n";
  } else {
    restored = restored.replace(/\n+$/, "");
  }
  if (fileTraits.lineEnding === "crlf") restored = restored.replace(/\n/g, "\r\n");
  return fileTraits.hasBOM ? "\uFEFF" + restored : restored;
}

export async function listMobileDocuments(): Promise<MobileDocumentInfo[]> {
  await Promise.allSettled(pendingDocumentOperations.values());
  const bridge = harmonyBridge();
  if (bridge) {
    const result = parseBridge<BridgeListResult>(bridge.listDocuments());
    return (result.documents ?? []).slice().sort((a, b) => b.modifiedAt - a.modifiedAt);
  }

  if (isTauriRuntime()) {
    return await invoke<MobileDocumentInfo[]>("list_mobile_documents");
  }

  return Object.entries(readLocalDocuments())
    .map(([name, entry]) => ({
      name,
      size: byteSize(entry.content),
      modifiedAt: entry.modifiedAt,
    }))
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
}

export async function readMobileDocument(name: string): Promise<MobileDocumentContent | null> {
  const safeName = sanitizeMobileDocumentName(name);
  if (!safeName) return null;

  return withDocumentOperation([safeName], async () => {
    const bridge = harmonyBridge();
    if (bridge) {
      const result = parseBridge<BridgeReadResult>(bridge.readDocument(safeName));
      if (result.found === false) return null;
      if (typeof result.content !== "string") throw new Error("鸿蒙文件桥未返回文档内容");
      return decodeMobileMarkdown(safeName, result.content);
    }

    if (isTauriRuntime()) {
      const loaded = await invoke<MobileDocumentContent | null>("read_mobile_document", {
        name: safeName,
      });
      if (!loaded) return null;
      return { content: loaded.content, fileTraits: loaded.fileTraits };
    }

    const document = readLocalDocuments()[safeName];
    return document ? decodeMobileMarkdown(safeName, document.content) : null;
  });
}

export async function saveMobileDocument(
  name: string,
  content: string,
  fileTraits?: FileTraitsDTO
): Promise<MobileDocumentInfo> {
  const safeName = sanitizeMobileDocumentName(name);
  if (!safeName) throw new Error("文件名不能为空");

  // 在排队前捕获格式参数，调用方随后修改标签不会影响本次保存。
  const traits = fileTraits ? { ...fileTraits } : undefined;
  return withDocumentOperation([safeName], async () => {
    const bridge = harmonyBridge();
    if (bridge) {
      const result = parseBridge<BridgeSaveResult>(
        bridge.saveDocument(safeName, restoreMobileContent(content, traits))
      );
      if (!result.document) throw new Error("鸿蒙文件桥未返回文档信息");
      return result.document;
    }

    if (isTauriRuntime()) {
      return await invoke<MobileDocumentInfo>("save_mobile_document", {
        name: safeName,
        content,
        fileTraits: traits,
      });
    }

    const documents = readLocalDocuments();
    const modifiedAt = Date.now();
    const restored = restoreMobileContent(content, traits);
    documents[safeName] = { content: restored, modifiedAt };
    writeLocalDocuments(documents);
    return { name: safeName, size: byteSize(restored), modifiedAt };
  });
}

export async function deleteMobileDocuments(names: string[]): Promise<number> {
  const safeNames = [...new Set(names.map(sanitizeMobileDocumentName).filter(Boolean))];
  if (!safeNames.length) return 0;

  return withDocumentOperation(safeNames, async () => {
    const bridge = harmonyBridge();
    if (bridge) {
      const result = parseBridge<BridgeDeleteResult>(
        bridge.deleteDocuments(JSON.stringify(safeNames))
      );
      return result.deleted ?? 0;
    }

    if (isTauriRuntime()) {
      return await invoke<number>("delete_mobile_documents", { names: safeNames });
    }

    const documents = readLocalDocuments();
    let deleted = 0;
    for (const name of safeNames) {
      if (documents[name]) {
        delete documents[name];
        deleted += 1;
      }
    }
    if (deleted) writeLocalDocuments(documents);
    return deleted;
  });
}

// ---------------------------------------------------------------------------
// 接续阅读（最近打开的移动端文档）
// ---------------------------------------------------------------------------

export interface RecentMobileDocument {
  name: string;
  openedAt: number;
}

export function getRecentMobileDocuments(): RecentMobileDocument[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is RecentMobileDocument =>
        Boolean(item) && typeof item.name === "string" && typeof item.openedAt === "number"
    );
  } catch {
    return [];
  }
}

export function recordMobileDocumentOpened(name: string): void {
  const safeName = sanitizeMobileDocumentName(name);
  if (!safeName) return;
  const next = getRecentMobileDocuments().filter((item) => item.name !== safeName);
  next.unshift({ name: safeName, openedAt: Date.now() });
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next.slice(0, MAX_RECENT)));
  } catch {
    // localStorage 不可用时不记录
  }
}

export function removeMobileDocumentRecents(names: string[]): void {
  const removed = new Set(names);
  const next = getRecentMobileDocuments().filter((item) => !removed.has(item.name));
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}
