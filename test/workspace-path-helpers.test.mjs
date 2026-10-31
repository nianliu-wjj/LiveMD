import assert from "node:assert/strict";
import test from "node:test";
import {
  dirnameOfPath,
  fileExtensionOfPath,
  fileNameOfPath,
  fileStemOfPath,
  joinPathOf,
  relativeToWorkspace,
} from "../src/renderer/utils/workspacePathHelpers.ts";

test("fileNameOfPath / dirnameOfPath: Windows 与 POSIX 路径", () => {
  assert.equal(fileNameOfPath("C:\\docs\\a.md"), "a.md");
  assert.equal(fileNameOfPath("/home/u/a.md"), "a.md");
  assert.equal(dirnameOfPath("C:\\docs\\a.md"), "C:/docs");
  assert.equal(dirnameOfPath("/home/u/a.md"), "/home/u");
  assert.equal(dirnameOfPath("a.md"), "");
});

test("fileStemOfPath / fileExtensionOfPath: 后缀拆分", () => {
  assert.equal(fileStemOfPath("C:\\docs\\readme.md"), "readme");
  assert.equal(fileStemOfPath("C:\\docs\\archive.tar.md"), "archive.tar");
  assert.equal(fileStemOfPath("C:\\docs\\noext"), "noext");
  assert.equal(fileExtensionOfPath("C:\\docs\\readme.md"), ".md");
  assert.equal(fileExtensionOfPath("C:\\docs\\noext"), "");
});

test("joinPathOf: 按目录风格拼接并去掉尾部分隔符", () => {
  assert.equal(joinPathOf("C:\\docs\\", "a.md"), "C:\\docs\\a.md");
  assert.equal(joinPathOf("/home/u/", "a.md"), "/home/u/a.md");
  assert.equal(joinPathOf("", "a.md"), "a.md");
});

test("relativeToWorkspace: 工作区内返回相对路径", () => {
  assert.equal(relativeToWorkspace("C:\\proj\\docs\\a.md", "C:\\proj"), "docs/a.md");
  assert.equal(relativeToWorkspace("C:\\proj\\a.md", "C:\\proj\\"), "a.md");
  assert.equal(relativeToWorkspace("/home/u/proj/a.md", "/home/u/proj"), "a.md");
});

test("relativeToWorkspace: 大小写与越界处理", () => {
  // Windows 路径大小写不敏感
  assert.equal(relativeToWorkspace("c:\\Proj\\Docs\\A.md", "C:\\proj"), "Docs/A.md");
  // POSIX 路径大小写敏感
  assert.equal(relativeToWorkspace("/home/u/Proj/a.md", "/home/u/proj"), null);
  // 工作区之外
  assert.equal(relativeToWorkspace("C:\\other\\a.md", "C:\\proj"), null);
  // 自身与空值
  assert.equal(relativeToWorkspace("C:\\proj", "C:\\proj"), null);
  assert.equal(relativeToWorkspace("", "C:\\proj"), null);
  assert.equal(relativeToWorkspace("C:\\proj\\a.md", ""), null);
});
