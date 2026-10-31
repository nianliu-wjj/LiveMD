import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { AllSelection, EditorState, TextSelection } from "prosemirror-state";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  configFile: false,
  root: projectRoot,
  server: { middlewareMode: true },
});

const { defaultParser } = await server.ssrLoadModule("/src/core/parser/index.ts");
const { livemdSchema } = await server.ssrLoadModule("/src/core/schema/index.ts");
const { createChangeHeadingLevelCommand } = await server.ssrLoadModule(
  "/src/core/commands/enhanced-commands.ts"
);
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

function run(state, direction) {
  let next = state;
  const command = createChangeHeadingLevelCommand(direction);
  const applied = command(next, (tr) => {
    next = next.apply(tr);
  });
  return { applied, state: next };
}

function selectAll(state) {
  return state.apply(state.tr.setSelection(new AllSelection(state.doc)));
}

function caretAtStart(state) {
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)));
}

test("promotes every selected block and turns paragraphs into heading 6", () => {
  const state = selectAll(createState("## 二级标题\n\n普通段落\n\n### 三级标题\n"));
  const result = run(state, "promote");

  assert.equal(result.applied, true);
  assert.equal(
    serializeMarkdown(result.state.doc),
    "# 二级标题\n\n###### 普通段落\n\n## 三级标题\n"
  );
});

test("demotes headings and turns heading 6 back into a paragraph", () => {
  const state = selectAll(createState("# 一级标题\n\n普通段落\n\n###### 六级标题\n"));
  const result = run(state, "demote");

  assert.equal(result.applied, true);
  assert.equal(
    serializeMarkdown(result.state.doc),
    "## 一级标题\n\n普通段落\n\n六级标题\n"
  );
});

test("only changes the block under a collapsed selection", () => {
  const state = caretAtStart(createState("## 标题\n\n段落\n"));
  const result = run(state, "promote");

  assert.equal(result.applied, true);
  assert.equal(serializeMarkdown(result.state.doc), "# 标题\n\n段落\n");
});

test("reports no change when heading level cannot move further", () => {
  const h1 = caretAtStart(createState("# 一级标题\n"));
  assert.equal(run(h1, "promote").applied, false);
  assert.equal(serializeMarkdown(run(h1, "promote").state.doc), "# 一级标题\n");

  const paragraph = caretAtStart(createState("普通段落\n"));
  assert.equal(run(paragraph, "demote").applied, false);
  assert.equal(serializeMarkdown(run(paragraph, "demote").state.doc), "普通段落\n");
});
