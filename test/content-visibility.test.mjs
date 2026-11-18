import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/components/editor/LivemdEditor.vue", import.meta.url),
  "utf8"
);

const block = source.match(/&\.large-document-mode\s*\{([\s\S]*?)\n {2}\}/)?.[1] ?? "";

test("large-document-mode 只对纯静态长块启用 content-visibility", () => {
  assert.ok(block.length > 0, "未找到 large-document-mode 样式块");

  const allowed = [
    "> hr)",
    "> .livemd-code-block)",
    "> .livemd-image-block)",
    "> .html-block)",
    "> .math-block)",
  ];
  for (const selector of allowed) {
    assert.ok(block.includes(selector), `缺少静态长块选择器: ${selector}`);
  }

  // WKWebView 对 content-visibility:auto 子树内的类名变化不恢复绘制，
  // 这些可承载光标的 textblock 宿主一旦加回就会出现“幽灵态”整行隐藏。
  const forbidden = [
    "> p)",
    "> h1)",
    "> h2)",
    "> h3)",
    "> h4)",
    "> h5)",
    "> h6)",
    "> blockquote)",
    "blockquote > *)",
    "> ul)",
    "> ol)",
    "> table)",
  ];
  for (const selector of forbidden) {
    assert.ok(!block.includes(selector), `可承载光标的 textblock 不得启用裁剪: ${selector}`);
  }
});
