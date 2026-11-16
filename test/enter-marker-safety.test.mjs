import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { EditorState, TextSelection } from "prosemirror-state";
import { baseKeymap } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  configFile: false,
  root: projectRoot,
  server: { middlewareMode: true },
});

const { livemdSchema } = await server.ssrLoadModule("/src/core/schema/index.ts");
const { defaultParser } = await server.ssrLoadModule("/src/core/parser/index.ts");
const { serializeMarkdown } = await server.ssrLoadModule("/src/core/serializer/index.ts");
const { createListKeymap } = await server.ssrLoadModule("/src/core/keymap/index.ts");
const { createSyntaxFixerPlugin } = await server.ssrLoadModule("/src/core/plugins/syntax-fixer.ts");
const { createHeadingSyncPlugin } = await server.ssrLoadModule("/src/core/plugins/heading-sync.ts");
const { createSyntaxDetectorPlugin } = await server.ssrLoadModule(
  "/src/core/plugins/syntax-detector.ts"
);
const { createBlockquoteAlertSyncPlugin } = await server.ssrLoadModule(
  "/src/core/plugins/blockquote-alert-sync.ts"
);

after(async () => {
  await server.close();
});

/** 组装与真实编辑器一致的插件链（keymap + 全部 appendTransaction 插件） */
function createPlugins() {
  return [
    // 不可自定义的快捷键（块级 Enter、列表操作等）
    keymap(createListKeymap(livemdSchema)),
    // 基础快捷键
    keymap(baseKeymap),
    // 引用告示块同步
    createBlockquoteAlertSyncPlugin(),
    // 语法修复插件
    createSyntaxFixerPlugin(),
    // 标题同步插件（与 editor.ts 修复后装配序一致：先于语法检测）
    createHeadingSyncPlugin(),
    // 语法检测插件
    createSyntaxDetectorPlugin(),
  ];
}

function createState(markdown) {
  return EditorState.create({
    doc: defaultParser.parse(markdown).doc,
    schema: livemdSchema,
    plugins: createPlugins(),
  });
}

/** 在 state 上运行 Enter 命令（与 keymap 插件对 Enter 的分发等价），返回最终 state */
function pressEnter(state) {
  const enter = createListKeymap(livemdSchema)["Enter"];
  assert.ok(enter, "列表 keymap 应提供 Enter 处理器");
  let next = state;
  const handled = enter(state, (tr) => {
    next = state.apply(tr);
  });
  assert.equal(handled, true, "Enter 应被列表 keymap 消费");
  return next;
}

/** 在指定文本起点（紧跟其前缀标记之后）放置光标，并断言 nodeBefore 是语法标记 */
function cursorAfterMarker(state, needle) {
  let found = null;
  state.doc.descendants((node, pos) => {
    if (!found && node.isText && node.text === needle) {
      found = pos;
    }
    return !found;
  });
  assert.ok(found !== null, `文档中应存在文本节点 ${JSON.stringify(needle)}`);
  const $from = state.doc.resolve(found);
  assert.ok(
    $from.nodeBefore?.marks?.some((m) => m.type.name === "syntax_marker"),
    "光标 nodeBefore 应是 syntax_marker（保证用例模拟了 caret 吸附到标记边界的场景）"
  );
  return found;
}

test("列表项中光标吸附在 ** 开标记后按回车不产生孤立标记", () => {
  const source = "- **推论一**：存在边界毛刺\n- **推论二**：框架标配的原因";
  const state = createState(source);
  const pos = cursorAfterMarker(state, "推论二");

  const withCursor = state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
  const next = pressEnter(withCursor);
  const output = serializeMarkdown(next.doc);

  // 不得出现被劈出来单独成行的孤立 **
  assert.doesNotMatch(output, /\n\s*\*\*\s*\n/, `不应产生孤立 ** 行，实际：\n${output}`);
  // 后续项的加粗结构完整
  assert.ok(output.includes("**推论二**：框架标配的原因"), `推论二加粗应完整，实际：\n${output}`);
  // 兄弟项不得被吸入新空项（4 空格缩进无标记形态）
  assert.doesNotMatch(output, /\n {4}\*\*推论二/, `兄弟项不应被吸入新空项，实际：\n${output}`);

  // 往返序列化后重新解析应稳定（畸形结构不会在编辑中自我放大）
  const reparsed = createState(output);
  assert.equal(serializeMarkdown(reparsed.doc), output);
});

test("列表项中光标吸附在反引号开标记后按回车不产生孤立反引号", () => {
  const source = "- 记录 `code` 片段\n- 第二项内容";
  const state = createState(source);
  const pos = cursorAfterMarker(state, "code");

  const withCursor = state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
  const next = pressEnter(withCursor);
  const output = serializeMarkdown(next.doc);

  // 不得出现被劈出来单独成行的孤立反引号
  assert.doesNotMatch(output, /\n\s*`\s*\n/, `不应产生孤立反引号行，实际：\n${output}`);
  // 行内代码结构完整
  assert.ok(output.includes("`code`"), `行内代码应完整，实际：\n${output}`);
});

test("对照：安全位置（普通文本末尾）按回车行为逐字节不变", () => {
  const source = "- 第一项内容\n- **推论二**：框架标配的原因";
  const state = createState(source);

  // 光标放在「第一项内容」文本末尾（普通文本 | 行尾，安全分割点）
  let pos = null;
  state.doc.descendants((node, p) => {
    if (pos === null && node.isText && node.text === "第一项内容") {
      pos = p + node.nodeSize;
    }
    return pos === null;
  });
  assert.ok(pos !== null, "应找到对照位置");

  const withCursor = state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
  const next = pressEnter(withCursor);
  const output = serializeMarkdown(next.doc);

  // 分割产物：原项 + 新空项 + 后续项，逐字节稳定
  assert.equal(
    output.trimEnd(),
    "- 第一项内容\n- \n- **推论二**：框架标配的原因",
    `安全位置的回车行为应保持原样，实际：\n${output}`
  );
  assert.doesNotMatch(output, /\n {4}\*\*推论二/, "不应出现兄弟项被吸入新空项的形态");
});
