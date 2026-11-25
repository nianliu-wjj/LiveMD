import assert from "node:assert/strict";
import test from "node:test";
import { createTabDataFromFile, isHtmlFilePath } from "../src/service/fileService.ts";
import { decodeMobileMarkdown } from "../src/service/mobileFile.ts";

test("HTML 扩展名创建只读标签，Markdown 标签保持可写", () => {
  for (const file of ["C:/docs/中文.HTML", "page.htm"]) {
    assert.equal(isHtmlFilePath(file), true);
    const tab = createTabDataFromFile(file, "<h1>hello</h1>");
    assert.equal(tab.kind, "html");
    assert.equal(tab.readOnly, true);
  }
  const tab = createTabDataFromFile("notes.md", "# hello");
  assert.equal(tab.kind, "markdown");
  assert.equal(tab.readOnly, false);
  assert.equal(isHtmlFilePath("notes.html.md"), false);
});
test("移动端 HTML 文件保留脚本及原文实体", () => {
  const source = "<h1>&lt;hello&gt;</h1><script>window.answer = 42</script>";
  assert.equal(decodeMobileMarkdown("page.HTM", source).content, source);
});
