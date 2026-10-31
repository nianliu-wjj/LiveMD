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
