import assert from "node:assert/strict";
import test from "node:test";
import { annotationDocKey } from "../src/shared/utils/annotations.ts";

/**
 * docKey 前缀契约
 *
 * 批注 / 书签 / 大纲折叠三处都按「已保存文档用 file:、未保存文档用 tab:」归档，
 * 且 useAnnotations 的「保存后迁移」（tab:{id} → file:{path}）依赖这两个前缀，
 * 因此这里把契约固定下来，避免日后改前缀导致迁移静默失效。
 */
test("annotationDocKey: 已保存文档使用 file: 前缀", () => {
  assert.equal(annotationDocKey("/a/b.md", "t1"), "file:/a/b.md");
  assert.equal(annotationDocKey("C:\\docs\\b.md", "t1"), "file:C:\\docs\\b.md");
});

test("annotationDocKey: 未保存文档使用 tab: 前缀", () => {
  assert.equal(annotationDocKey(null, "t1"), "tab:t1");
  assert.equal(annotationDocKey(undefined, "t1"), "tab:t1");
  assert.equal(annotationDocKey("", "t1"), "tab:t1");
});

test("annotationDocKey: 同一文件的不同 tab 归到同一键，同一 tab 的不同文件相互独立", () => {
  assert.equal(annotationDocKey("/a/b.md", "t1"), annotationDocKey("/a/b.md", "t2"));
  assert.notEqual(annotationDocKey("/a/b.md", "t1"), annotationDocKey("/a/c.md", "t1"));
});
