import assert from "node:assert/strict";
import test from "node:test";
import { decodeMobileMarkdown } from "../src/service/mobileFile.ts";

test("移动文件保留 BOM、换行特征并归一化内容", () => {
  const result = decodeMobileMarkdown("中文.MD", "\uFEFF# 标题\r\n内容\r\n");
  assert.equal(result.content, "# 标题\n内容\n");
  assert.deepEqual(result.fileTraits, {
    hasBOM: true,
    lineEnding: "crlf",
    hasTrailingNewline: true,
  });
});
test("空 Markdown 可打开，非 Markdown 文件拒绝导入", () => {
  assert.equal(decodeMobileMarkdown("empty.markdown", "").content, "");
  assert.throws(() => decodeMobileMarkdown("image.png", "abc"), /Markdown/);
});
