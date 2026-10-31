import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAllFixes,
  buildLintConfig,
  readRuleConfig,
  runDocumentLint,
  runFormatCheck,
  runSpellCheck,
  writeRuleConfig,
} from "../src/renderer/utils/documentLint.ts";
import { MARKDOWNLINT_RULES } from "../src/renderer/utils/markdownLintRules.ts";

/** 内存版 storage：只实现配置读写用到的两个成员 */
function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

test("MARKDOWNLINT_RULES: 规则编码唯一且格式规范", () => {
  assert.ok(MARKDOWNLINT_RULES.length >= 45, `规则数量偏少：${MARKDOWNLINT_RULES.length}`);
  const codes = MARKDOWNLINT_RULES.map((rule) => rule.code);
  assert.equal(new Set(codes).size, codes.length, "存在重复规则编码");
  for (const rule of MARKDOWNLINT_RULES) {
    assert.match(rule.code, /^MD\d{3}$/);
    assert.ok(rule.alias.length > 0);
    assert.ok(rule.description.length > 0);
  }
});

test("buildLintConfig: 默认全开，显式关闭的规则置 false", () => {
  const config = buildLintConfig({ MD013: false, MD041: true });
  assert.equal(config.default, true);
  assert.equal(config.MD013, false);
  assert.equal(config.MD041, undefined);
});

test("readRuleConfig / writeRuleConfig: 注入存储时往返一致", () => {
  const storage = createStorage();
  writeRuleConfig({ MD013: false }, storage);
  assert.deepEqual(readRuleConfig(storage), { MD013: false });
});

test("readRuleConfig: 非法内容与不可用存储均回退为空表", () => {
  assert.deepEqual(readRuleConfig(createStorage({ "livemd-lint-rule-config": "{oops" })), {});
  assert.deepEqual(readRuleConfig(createStorage({ "livemd-lint-rule-config": "[1,2]" })), {});
  const throwing = {
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("denied");
    },
  };
  assert.deepEqual(readRuleConfig(throwing), {});
});

test("runFormatCheck: 命中连续空行规则并携带可修复信息", async () => {
  const issues = await runFormatCheck("# Title\n\n\n\nText\n", {});
  const blankIssue = issues.find((issue) => issue.ruleCode === "MD012");
  assert.ok(blankIssue, "应命中 MD012（连续空行）");
  assert.equal(blankIssue.ruleAlias, "no-multiple-blanks");
  assert.ok(blankIssue.fixInfo, "MD012 应提供 fixInfo");
  assert.ok(blankIssue.description.length > 0);
  assert.match(blankIssue.infoUrl, /^https?:\/\//);
});

test("runFormatCheck: 关闭规则后不再报该规则", async () => {
  const issues = await runFormatCheck("# Title\n\n\n\nText\n", { MD012: false });
  assert.equal(
    issues.some((issue) => issue.ruleCode === "MD012"),
    false
  );
});

test("applyAllFixes: 连续空行被修复为单个空行", async () => {
  const content = "# Title\n\n\n\nText\n";
  const issues = await runFormatCheck(content, {});
  const fixed = applyAllFixes(content, issues);
  assert.equal(fixed, "# Title\n\nText\n");
});

test("applyAllFixes: 无可修复项时返回原文", () => {
  assert.equal(applyAllFixes("abc", []), "abc");
});

test("runSpellCheck: 报告拼写错误并跳过围栏代码块", async () => {
  const issues = await runSpellCheck("This is zzqqx text.\n");
  assert.ok(
    issues.some((issue) => issue.word === "zzqqx"),
    "应报告 zzqqx"
  );
  const target = issues.find((issue) => issue.word === "zzqqx");
  assert.equal(target.line, 1);
  assert.ok(target.column > 0);
  assert.ok(Array.isArray(target.suggestions));

  // 代码块内的同一词元应被屏蔽
  const maskedIssues = await runSpellCheck("```\nzzqqx\n```\n");
  assert.equal(maskedIssues.length, 0);
});

test("runDocumentLint: 同时返回拼写与格式结果", async () => {
  const result = await runDocumentLint("# Title\n\n\n\nzzqqx\n", {});
  assert.ok(Array.isArray(result.spellIssues));
  assert.ok(Array.isArray(result.formatIssues));
  assert.ok(result.formatIssues.some((issue) => issue.ruleCode === "MD012"));
  assert.ok(result.spellIssues.some((issue) => issue.word === "zzqqx"));
});

test("runSpellCheck: 同一错词跨行只报告一次（按词去重）", async () => {
  const issues = await runSpellCheck("zzqqx here\nanother zzqqx line\n");
  const hits = issues.filter((issue) => issue.word === "zzqqx");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 1);
});

test("runSpellCheck: 超过 200 行的文档仍能完成扫描（分批让出主线程）", async () => {
  const lines = [];
  for (let index = 0; index < 260; index += 1) lines.push("plain line " + index);
  lines.push("tail zzqqx");
  const issues = await runSpellCheck(lines.join("\n"));
  assert.ok(issues.some((issue) => issue.word === "zzqqx"));
});
