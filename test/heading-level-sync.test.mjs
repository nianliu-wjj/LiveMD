import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { EditorState } from "prosemirror-state";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  configFile: false,
  root: projectRoot,
  server: { middlewareMode: true },
});

const { livemdSchema } = await server.ssrLoadModule("/src/core/schema/index.ts");
const { defaultParser } = await server.ssrLoadModule("/src/core/parser/index.ts");
const { serializeMarkdown } = await server.ssrLoadModule("/src/core/serializer/index.ts");
const { createSyntaxFixerPlugin } = await server.ssrLoadModule("/src/core/plugins/syntax-fixer.ts");
const { createHeadingSyncPlugin } = await server.ssrLoadModule("/src/core/plugins/heading-sync.ts");
const { createSyntaxDetectorPlugin } = await server.ssrLoadModule(
  "/src/core/plugins/syntax-detector.ts"
);

after(async () => {
  await server.close();
});

/** 组装与修复后 editor.ts 一致的插件装配序（syntax-fixer → heading-sync → syntax-detector） */
function createState(markdown) {
  return EditorState.create({
    doc: defaultParser.parse(markdown).doc,
    schema: livemdSchema,
    plugins: [createSyntaxFixerPlugin(), createHeadingSyncPlugin(), createSyntaxDetectorPlugin()],
  });
}

/** 提取标题的大纲文本（剥 marker，同 OutlineBar 口径：非 syntax_marker 文本拼接后 trim） */
function outlineTextOf(node) {
  let text = "";
  node.forEach((child) => {
    if (child.isText && !child.marks.some((m) => m.type.name === "syntax_marker")) {
      text += child.text || "";
    }
  });
  return text.trim();
}

/** 收集标题前缀 hash 字符上的 syntax_marker(heading) 数量 */
function countHeadingMarkedHashes(state, headingPos) {
  const node = state.doc.nodeAt(headingPos);
  let count = 0;
  let offset = 0;
  node.forEach((child) => {
    if (child.isText) {
      const hasMark = child.marks.some(
        (m) => m.type.name === "syntax_marker" && m.attrs.syntaxType === "heading"
      );
      if (hasMark) {
        count += (child.text || "").split("").filter((ch) => ch === "#").length;
      }
    }
    offset += child.nodeSize;
  });
  return count;
}

function headingAt(state) {
  const node = state.doc.nodeAt(0);
  assert.ok(node, "文档首位应有节点");
  return node;
}

test("三级标题行首插入 # 后 level 同步为 4", () => {
  const state = createState("### 标题内容");
  // 行首插入 #（inclusive:false → 新字符不带任何 mark）
  const next = state.apply(state.tr.insertText("#", 1));
  const node = headingAt(next);

  assert.equal(node.type.name, "heading");
  assert.equal(node.attrs.level, 4, "level 应同步为 4");
  assert.equal(countHeadingMarkedHashes(next, 0), 4, "4 个 # 都应带 syntax_marker(heading)");
  assert.equal(outlineTextOf(node), "标题内容", "大纲文本应为纯内容（无 # 污染）");
  assert.equal(serializeMarkdown(next.doc).trimEnd(), "#### 标题内容");
});

test("三级标题 ### 与空格之间插入 # 后 level 同步为 4", () => {
  const state = createState("### 标题内容");
  // 在第 4 个位置（### 之后、空格之前）插入 #
  const next = state.apply(state.tr.insertText("#", 1 + 3));
  const node = headingAt(next);

  assert.equal(node.type.name, "heading");
  assert.equal(node.attrs.level, 4, "level 应同步为 4");
  assert.equal(countHeadingMarkedHashes(next, 0), 4, "4 个 # 都应带 syntax_marker(heading)");
  assert.equal(outlineTextOf(node), "标题内容");
  assert.equal(serializeMarkdown(next.doc).trimEnd(), "#### 标题内容");
});

test("四级标题删除一个 # 后 level 镜像降回 3", () => {
  const state = createState("#### 标题内容");
  // 删除行首一个 #
  const next = state.apply(state.tr.delete(1, 1 + 1));
  const node = headingAt(next);

  assert.equal(node.type.name, "heading");
  assert.equal(node.attrs.level, 3, "level 应镜像降回 3");
  assert.equal(countHeadingMarkedHashes(next, 0), 3);
  assert.equal(serializeMarkdown(next.doc).trimEnd(), "### 标题内容");
});

test("含加粗的标题升级时 strong 结构与大纲文本不损坏", () => {
  const state = createState("### **重点**标题");
  const next = state.apply(state.tr.insertText("#", 1));
  const node = headingAt(next);

  assert.equal(node.type.name, "heading");
  assert.equal(node.attrs.level, 4);

  // strong mark 之于非标记文本完整保留
  const strongTexts = [];
  node.forEach((child) => {
    if (
      child.isText &&
      child.marks.some((m) => m.type.name === "strong") &&
      !child.marks.some((m) => m.type.name === "syntax_marker")
    ) {
      strongTexts.push(child.text || "");
    }
  });
  assert.equal(strongTexts.join(""), "重点", "加粗内容应完整保留");

  assert.equal(outlineTextOf(node), "重点标题");
  assert.equal(serializeMarkdown(next.doc).trimEnd(), "#### **重点**标题");
});

test("标题前缀空白被破坏后降级为段落且文本一字不丢", () => {
  const state = createState("### 标题内容");
  // 用户删除 "### " 与内容之间的空格（### 与内容粘连，合法标题语法被破坏）
  const next = state.apply(state.tr.delete(1 + 3, 1 + 3 + 1));
  const node = headingAt(next);

  // 降级为 paragraph，且文本逐字保留（旧实现会吞掉 ### 产出 "标题内容"）
  assert.equal(node.type.name, "paragraph");
  assert.equal(node.textContent, "###标题内容", "降级后文本必须一字不丢");
  assert.equal(serializeMarkdown(next.doc).trimEnd(), "###标题内容");
});

test("对照：未编辑的标题 level 与序列化逐字节不变", () => {
  const state = createState("### 标题内容");
  const node = headingAt(state);

  assert.equal(node.type.name, "heading");
  assert.equal(node.attrs.level, 3);
  assert.equal(countHeadingMarkedHashes(state, 0), 3);
  assert.equal(outlineTextOf(node), "标题内容");
  assert.equal(serializeMarkdown(state.doc).trimEnd(), "### 标题内容");
});
