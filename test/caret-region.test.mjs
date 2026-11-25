import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "./helpers/core-module-server.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  testModules: ["/src/core/parser/index.ts", "/src/core/decorations/caret-style.ts"],
  root: projectRoot,
  server: { middlewareMode: true },
});

const { defaultParser } = await server.ssrLoadModule("/src/core/parser/index.ts");
const { computeCaretRegions } = await server.ssrLoadModule("/src/core/decorations/caret-style.ts");

after(async () => {
  await server.close();
});

/** 收集文档中的 syntax_marker 区域（decorations/index.findSyntaxMarkerRegions 的测试内副本） */
function collectSyntaxMarkerRegions(doc) {
  const regions = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const mark = node.marks.find((m) => m.type.name === "syntax_marker");
    if (mark) {
      regions.push({ from: pos, to: pos + node.nodeSize, syntaxType: mark.attrs.syntaxType });
    }
    return true;
  });
  return regions;
}

/** 解析 markdown 并返回 { doc, syntaxRegions } */
function parseDoc(markdown) {
  const doc = defaultParser.parse(markdown).doc;
  return { doc, syntaxRegions: collectSyntaxMarkerRegions(doc) };
}

/** 文档首个 textblock 的内容起始绝对位置（光标定位基准） */
function firstTextblockContentStart(doc) {
  let start = null;
  doc.descendants((node, pos) => {
    if (start === null && node.isTextblock) {
      start = pos + 1;
      return false;
    }
    return true;
  });
  return start;
}

/** 光标绝对位置 = 首个 textblock 内容起始 + 块内内容偏移 */
function caretAt(doc, contentOffset) {
  return firstTextblockContentStart(doc) + contentOffset;
}

// ============ 语义 mark 区域（邻接命中语义） ============

test("光标在粗体内容内部：恰 1 个语义区域，覆盖开标记起点到闭标记终点", () => {
  const { doc } = parseDoc("aa**bold**bb");
  // 内容偏移 6 = "aa**bo|ld**bb"，位于粗体内容内
  const regions = computeCaretRegions(doc, caretAt(doc, 6));

  assert.equal(regions.length, 1);
  assert.equal(regions[0].kind, "semantic");
  assert.equal(regions[0].from, 3); // 开标记 "**" 起点
  assert.equal(regions[0].to, 11); // 闭标记 "**" 终点
});

test("光标在粗体外（相隔 ≥1 字符）：空集合", () => {
  const { doc } = parseDoc("aa**bold**bb");
  // 内容偏移 11 = 闭标记后隔 1 个字符（"bb" 内部）
  const regions = computeCaretRegions(doc, caretAt(doc, 11));

  assert.deepEqual(regions, []);
});

test("光标紧贴闭标记之后：命中", () => {
  const { doc } = parseDoc("aa**bold**bb");
  // 内容偏移 10 = "aa**bold**|bb"，紧贴闭标记
  const regions = computeCaretRegions(doc, caretAt(doc, 10));

  assert.equal(regions.length, 1);
  assert.equal(regions[0].kind, "semantic");
  assert.equal(regions[0].from, 3);
  assert.equal(regions[0].to, 11);
});

test("光标紧贴开标记之前：命中", () => {
  const { doc } = parseDoc("aa**bold**bb");
  // 内容偏移 3 = "aa|**bold**bb"，紧贴开标记
  const regions = computeCaretRegions(doc, caretAt(doc, 3));

  assert.equal(regions.length, 1);
  assert.equal(regions[0].kind, "semantic");
});

test("嵌套粗斜体：strong 外层 + emphasis 内层双区域，外层覆盖内层", () => {
  const { doc } = parseDoc("**outer *inner* tail**");
  // 内容偏移 11 = 位于 "inner" 内容内
  const regions = computeCaretRegions(doc, caretAt(doc, 11));

  assert.equal(regions.length, 2);
  const outer = regions.find((r) => r.to - r.from > r.from) ?? regions[0];
  const extents = regions.map((r) => [r.from, r.to]);
  // 外层 strong 覆盖全部（含标记），内层 emphasis 仅覆盖 *inner* 段
  assert.deepEqual(
    extents.sort((a, b) => a[0] - b[0]),
    [
      [1, 23],
      [9, 16],
    ]
  );
  assert.equal(outer.kind, "semantic");
});

test("行内代码内容内：命中 code_inline 区域", () => {
  const { doc } = parseDoc("x `code y` z");
  // 内容偏移 5 = 行内代码内容 "code y" 内部
  const regions = computeCaretRegions(doc, caretAt(doc, 5));

  assert.equal(regions.length, 1);
  assert.equal(regions[0].kind, "semantic");
  assert.equal(regions[0].from, 3); // 开反引号
  assert.equal(regions[0].to, 11); // 闭反引号终点
});

// ============ 引用块："> " 前缀永不入选 ============

test("引用块：光标贴在 > 前缀标记上 → 空集合（前缀永不显示）", () => {
  const { doc } = parseDoc("> quote **b2** tail");
  // 内容偏移 1 = 前缀 "> " 内部；内容偏移 2 = 紧贴前缀之后
  assert.deepEqual(computeCaretRegions(doc, caretAt(doc, 1)), []);
  assert.deepEqual(computeCaretRegions(doc, caretAt(doc, 2)), []);
});

test("引用块：光标在引用普通文字上 → 空集合", () => {
  const { doc } = parseDoc("> quote **b2** tail");
  // 内容偏移 4 = "quote" 文字内部
  assert.deepEqual(computeCaretRegions(doc, caretAt(doc, 4)), []);
});

test("引用块：引用内粗体 → 仅 strong 区域，> 前缀不在集合中", () => {
  const { doc } = parseDoc("> quote **b2** tail");
  // 内容偏移 10 = "b2" 内容内
  const regions = computeCaretRegions(doc, caretAt(doc, 10));

  assert.equal(regions.length, 1);
  assert.equal(regions[0].kind, "semantic");
  // 区域从粗体开标记开始（内容偏移 8 → 绝对 10），不含块首的 "> " 前缀
  assert.equal(regions[0].from, 10);
  assert.equal(regions[0].to, 16);
});

// ============ heading：由焦点块 CSS 承担，不进区域集合 ============

test("标题块内任意位置：空集合（heading 由焦点块 CSS 显示）", () => {
  const { doc } = parseDoc("### head");
  // 前缀标记上与标题文字内都不产生区域
  assert.deepEqual(computeCaretRegions(doc, caretAt(doc, 1)), []);
  assert.deepEqual(computeCaretRegions(doc, caretAt(doc, 5)), []);
});

// ============ 微区域：escape / html_entity ============

test("转义序列：紧邻命中 escape 微区域，远处空", () => {
  const { doc, syntaxRegions } = parseDoc("a \\* b");
  // 转义区域 = "\" 字符（绝对 3-4）
  const escapeRegion = syntaxRegions.find((r) => r.syntaxType === "escape");
  assert.ok(escapeRegion, "解析器应产出 escape 标记区域");

  const near = computeCaretRegions(doc, caretAt(doc, 2), syntaxRegions);
  assert.equal(near.length, 1);
  assert.equal(near[0].kind, "escape");
  assert.equal(near[0].from, escapeRegion.from);
  assert.equal(near[0].to, escapeRegion.to);

  // 远处（"b" 之后）不命中
  assert.deepEqual(computeCaretRegions(doc, caretAt(doc, 6), syntaxRegions), []);
});

test("HTML entity：紧邻命中 html_entity 微区域", () => {
  const { doc, syntaxRegions } = parseDoc("&amp; x");
  const entityRegion = syntaxRegions.find((r) => r.syntaxType === "html_entity");
  assert.ok(entityRegion, "解析器应产出 html_entity 标记区域");

  const near = computeCaretRegions(doc, caretAt(doc, 2), syntaxRegions);
  assert.equal(near.length, 1);
  assert.equal(near[0].kind, "html_entity");
  assert.equal(near[0].from, entityRegion.from);
  assert.equal(near[0].to, entityRegion.to);
});

// ============ 普通文本 ============

test("普通文本：空集合", () => {
  const { doc } = parseDoc("plain text only");
  assert.deepEqual(computeCaretRegions(doc, caretAt(doc, 7)), []);
});
