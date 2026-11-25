import assert from "node:assert/strict";
import test, { after } from "node:test";
import { Window } from "happy-dom";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");

const window = new Window();
for (const key of ["document", "Node", "Element", "HTMLElement", "DOMParser"])
  globalThis[key] = window[key];
const temp = mkdtempSync(path.resolve("test/.html-preview-"));
after(() => {
  rmSync(temp, { recursive: true, force: true });
  window.happyDOM.abort();
});
await build({
  entryPoints: [
    "src/core/nodeviews/html-markdown-preview.ts",
    "src/core/nodeviews/html-block-highlight.ts",
  ],
  bundle: true,
  format: "esm",
  platform: "node",
  outdir: temp,
  outExtension: { ".js": ".mjs" },
  packages: "external",
});
const { extractMarkdownCodeFences, restoreMarkdownCodeFences, renderMarkdownWithinHtmlFragment } =
  await import(pathToFileURL(path.join(temp, "html-markdown-preview.mjs")));
const { highlightHtmlPreviewCodeBlocks } = await import(
  pathToFileURL(path.join(temp, "html-block-highlight.mjs"))
);

function render(source) {
  const { html, fences } = extractMarkdownCodeFences(source);
  const root = document.createElement("div");
  root.innerHTML = html;
  const fragment = document.createDocumentFragment();
  fragment.append(...root.childNodes);
  restoreMarkdownCodeFences(fragment, fences);
  renderMarkdownWithinHtmlFragment(fragment);
  root.append(fragment);
  return root;
}

for (const [name, code] of [
  ["纯文本", "hello"],
  ["HTML 标签", "<div>hello</div>"],
  ["Vue 模板", "<template>\n  <div>{{ title }}</div>\n</template>"],
  ["实体保真", "&lt;div&gt; & < >"],
]) {
  test(`HTML 内栅栏保留${name}`, () => {
    const root = render(
      `<details>\n<summary>标题</summary>\n\n\`\`\`html\n${code}\n\`\`\`\n</details>`
    );
    assert.equal(root.querySelector("pre code")?.textContent, code);
    assert.equal(root.querySelectorAll("pre div, pre template").length, 0);
  });
}
test("真实元素与混合文本保留", () => {
  const root = render("<div><span>真实元素</span>\n段落\n\n```js\nconst x = 1\n```\n结束</div>");
  assert.equal(root.querySelector("span").textContent, "真实元素");
  assert.equal(root.querySelector("pre code").textContent, "const x = 1");
  assert.ok(root.textContent.includes("结束"));
});
test("pre 内栅栏和未闭合栅栏不抽离", () => {
  for (const source of ["<pre>\n```html\nhello\n```\n</pre>", "<div>\n```js\nhello\n</div>"]) {
    assert.equal(extractMarkdownCodeFences(source).html, source);
    assert.equal(extractMarkdownCodeFences(source).fences.size, 0);
  }
});
test("占位字符串不与文档原文冲突", () => {
  const root = render("<div>LIVEMD-FENCE-0-END\n```js\nx\n```\n</div>");
  assert.ok(root.textContent.includes("LIVEMD-FENCE-0-END"));
  assert.equal(root.querySelector("code").textContent, "x");
});

test("静态高亮保留源码并生成稳定类名", async () => {
  const root = render("<div>\n```js\nconst answer = 42;\n```\n</div>");
  document.body.append(root);
  await highlightHtmlPreviewCodeBlocks(root);
  assert.equal(root.querySelector("code").textContent, "const answer = 42;");
  assert.ok(root.querySelector('span[class*="tok-"]'));
  root.remove();
});
