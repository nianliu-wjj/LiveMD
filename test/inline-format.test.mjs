import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { EditorState, TextSelection } from "prosemirror-state";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  configFile: false,
  root: projectRoot,
  server: { middlewareMode: true },
});

const { defaultParser } = await server.ssrLoadModule("/src/core/parser/index.ts");
const { livemdSchema } = await server.ssrLoadModule("/src/core/schema/index.ts");
const {
  createEnhancedHtmlTagCommand,
  createEnhancedToggleMark,
} = await server.ssrLoadModule("/src/core/commands/enhanced-commands.ts");
const { serializeMarkdown } = await server.ssrLoadModule("/src/core/serializer/index.ts");

after(async () => {
  await server.close();
});

function createState(markdown) {
  return EditorState.create({
    doc: defaultParser.parse(markdown).doc,
    schema: livemdSchema,
  });
}

function select(state, from, to) {
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
}

function run(state, command) {
  let next = state;
  const applied = command(state, (tr) => {
    next = state.apply(tr);
  });
  return { applied, state: next };
}

test("wraps a selection in superscript and removes it on the second toggle", () => {
  const superscript = createEnhancedToggleMark(livemdSchema.marks.sup);
  const initial = select(createState("内容"), 1, 3);
  const wrapped = run(initial, superscript);

  assert.equal(wrapped.applied, true);
  assert.equal(serializeMarkdown(wrapped.state.doc).trimEnd(), "<sup>内容</sup>");

  const reparsed = createState("<sup>内容</sup>");
  const contentFrom = 1 + "<sup>".length;
  const unwrapped = run(select(reparsed, contentFrom, contentFrom + 2), superscript);

  assert.equal(unwrapped.applied, true);
  assert.equal(serializeMarkdown(unwrapped.state.doc).trimEnd(), "内容");
});

test("inserts an empty subscript pair and places the cursor inside", () => {
  const subscript = createEnhancedToggleMark(livemdSchema.marks.sub);
  const result = run(select(createState("abc"), 2, 2), subscript);

  assert.equal(result.applied, true);
  assert.equal(serializeMarkdown(result.state.doc).trimEnd(), "a<sub></sub>bc");
  assert.equal(result.state.selection.from, 2 + "<sub>".length);
});

test("toggles underline through inline HTML tags", () => {
  const underline = createEnhancedHtmlTagCommand("u");
  const wrapped = run(select(createState("文字"), 1, 3), underline);

  assert.equal(wrapped.applied, true);
  assert.equal(serializeMarkdown(wrapped.state.doc).trimEnd(), "<u>文字</u>");

  const reparsed = createState("<u>文字</u>");
  const contentFrom = 1 + "<u>".length;
  const unwrapped = run(select(reparsed, contentFrom, contentFrom + 2), underline);

  assert.equal(unwrapped.applied, true);
  assert.equal(serializeMarkdown(unwrapped.state.doc).trimEnd(), "文字");
});

/**
 * 收集行内代码/行内公式内部错误长出的行内语法标记。
 * 合法嵌套（如 ==`code`== 中 code 外层带 highlight）不会产生
 * 位于代码/公式内部的 syntax_marker，因此不会误报。
 */
function collectStraySyntaxInCodeMarks(doc, straySyntaxType) {
  const offending = [];
  doc.descendants((node) => {
    if (!node.isText) return true;
    const insideLiteralMark =
      node.marks.some((m) => m.type.name === "code_inline") ||
      node.marks.some((m) => m.type.name === "math_inline");
    const hasStraySyntaxMarker = node.marks.some(
      (m) => m.type.name === "syntax_marker" && m.attrs?.syntaxType === straySyntaxType
    );
    if (insideLiteralMark && hasStraySyntaxMarker) {
      offending.push(node.text || "");
    }
    return true;
  });
  return offending;
}

test("行内代码内的 == 不再被解析为高亮语法", () => {
  const source =
    "- `equals` 源码： `return this.scale == val.scale && this.infl == val.infl && ...`，scale 参与判等；";
  const { doc } = defaultParser.parse(source);

  // 行内代码内部不应出现 highlight mark
  assert.deepEqual(collectStraySyntaxInCodeMarks(doc, "highlight"), []);

  // 往返序列化应保留原文
  assert.equal(serializeMarkdown(doc).trimEnd(), source);
});

test("行内公式内的 == 不再被解析为高亮语法", () => {
  const source = "系数 $a == b$ 且 $c == d == e$ 测试";
  const { doc } = defaultParser.parse(source);

  assert.deepEqual(collectStraySyntaxInCodeMarks(doc, "highlight"), []);
  assert.equal(serializeMarkdown(doc).trimEnd(), source);
});

test("正文中的 ==text== 高亮语法仍然正常工作", () => {
  const source = "前缀 ==重点内容== 后缀";
  const { doc } = defaultParser.parse(source);

  const highlights = [];
  doc.descendants((node) => {
    if (node.isText && node.marks.some((m) => m.type.name === "highlight")) {
      // 排除语法标记文本（"==" 前后缀），只收集内容
      const isSyntaxMarker = node.marks.some((m) => m.type.name === "syntax_marker");
      if (!isSyntaxMarker) {
        highlights.push(node.text || "");
      }
    }
    return true;
  });
  assert.deepEqual(
    highlights.filter((t) => t.trim() !== ""),
    ["重点内容"]
  );
  assert.equal(serializeMarkdown(doc).trimEnd(), source);
});

test("行内代码可继续嵌套于加粗斜体等语法", () => {
  const source = "外层 ***`code == x == y`*** 加粗斜体";
  const { doc } = defaultParser.parse(source);

  assert.deepEqual(collectStraySyntaxInCodeMarks(doc, "highlight"), []);
  assert.equal(serializeMarkdown(doc).trimEnd(), source);
});
