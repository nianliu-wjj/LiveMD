import assert from "node:assert/strict";
import test from "node:test";
import {
  formatCode,
  getFormatSupport,
  normalizeFormatterLanguage,
} from "../src/core/utils/code-formatter.ts";

test("normalizeFormatterLanguage: 常见别名归一", () => {
  assert.equal(normalizeFormatterLanguage("JS"), "javascript");
  assert.equal(normalizeFormatterLanguage(" tsx "), "typescript");
  assert.equal(normalizeFormatterLanguage("yml"), "yaml");
  assert.equal(normalizeFormatterLanguage("node"), "javascript");
  assert.equal(normalizeFormatterLanguage("Go"), "go");
  assert.equal(normalizeFormatterLanguage(""), "");
});

test("getFormatSupport: 支持的语言与不支持的语言", () => {
  for (const language of ["js", "ts", "json", "css", "html", "markdown", "yml", "sql"]) {
    assert.equal(getFormatSupport(language), true, `${language} 应支持格式化`);
  }
  for (const language of ["go", "rust", "java", "python", "sh", ""]) {
    assert.equal(getFormatSupport(language), false, `${language} 不应支持格式化`);
  }
});

test("formatCode: JavaScript 格式化成功", async () => {
  const result = await formatCode("const a=1;function f(){return  a+1}", "js");
  assert.equal(result.ok, true);
  assert.match(result.code, /const a = 1;/);
  assert.match(result.code, /function f\(\) \{/);
});

test("formatCode: JSON 格式化并保持可解析", async () => {
  const result = await formatCode('{"a":1,"b":[1,2]}', "json");
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(result.code), { a: 1, b: [1, 2] });
});

test("formatCode: SQL 大写关键字", async () => {
  const result = await formatCode("select id,name from users where id=1", "sql");
  assert.equal(result.ok, true);
  // sql-formatter 会把子句换行缩进，因此分别断言关键字与表名
  assert.match(result.code, /SELECT/);
  assert.match(result.code, /FROM/);
  assert.match(result.code, /users/);
});

test("formatCode: 空内容直接返回失败原因", async () => {
  const result = await formatCode("   \n", "js");
  assert.equal(result.ok, false);
  assert.match(result.reason, /内容为空/);
});

test("formatCode: 语法错误返回可读原因而非抛异常", async () => {
  const result = await formatCode("const = )", "js");
  assert.equal(result.ok, false);
  assert.match(result.reason, /格式化失败/);
});

test("formatCode: 不支持的语言给出明确提示", async () => {
  const result = await formatCode("package main", "go");
  assert.equal(result.ok, false);
  assert.match(result.reason, /暂不支持格式化/);
});
