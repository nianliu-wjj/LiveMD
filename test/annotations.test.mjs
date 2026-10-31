import assert from "node:assert/strict";
import test from "node:test";
import {
  ANNOTATIONS_STORAGE_KEY,
  addAnnotationToMap,
  buildAnnotationAnchor,
  createAnnotationId,
  parseAnnotations,
  removeAnnotationFromMap,
  resolveAnnotationAnchor,
  resolveAnnotationEntries,
  serializeAnnotations,
  updateAnnotationInMap,
} from "../src/shared/utils/annotations.ts";

/** 构造一个最小块桩（AnchorBlockInfo 的合法形状） */
function block(text) {
  return { text, contentSize: text.length };
}

/** 构造一条合法批注条目（供存储/CRUD 用例复用） */
function entry(overrides = {}) {
  return {
    id: "ann-1",
    anchor: buildAnnotationAnchor({
      startBlockIndex: 0,
      startOffset: 0,
      endBlockIndex: 0,
      endOffset: 4,
      selectedText: "测试文本",
    }),
    content: "内容",
    state: "done",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

test("storage key stays stable", () => {
  assert.equal(ANNOTATIONS_STORAGE_KEY, "livemd-annotations");
});

test("parses null, invalid JSON and invalid entries tolerantly", () => {
  assert.deepEqual(parseAnnotations(null), {});
  assert.deepEqual(parseAnnotations("not json"), {});

  const raw = JSON.stringify({
    "a.md": [
      entry({ id: "ok-1" }),
      entry({ id: "bad-anchor", anchor: { startBlockIndex: -1 } }),
      entry({ id: "bad-state", state: "draft" }),
      "not-an-object",
    ],
    "b.md": "not-an-array",
    "c.md": [entry({ id: "ok-2" })],
  });

  const map = parseAnnotations(raw);
  assert.deepEqual(Object.keys(map).sort(), ["a.md", "c.md"]);
  assert.deepEqual(
    map["a.md"].map((item) => item.id),
    ["ok-1"]
  );
  assert.equal(map["c.md"].length, 1);
});

test("CRUD helpers keep the map immutable", () => {
  const file = "D:/notes/demo.md";
  const first = entry({ id: "ann-a" });
  const second = entry({ id: "ann-b" });

  const added = addAnnotationToMap({}, file, first);
  assert.notEqual(added, {});
  assert.equal(added[file].length, 1);

  const addedTwice = addAnnotationToMap(added, file, second);
  assert.equal(added[file].length, 1); // 原 map 未被修改
  assert.equal(addedTwice[file].length, 2);

  const updated = updateAnnotationInMap(addedTwice, file, "ann-a", {
    content: "更新后的内容",
    state: "done",
  });
  assert.equal(addedTwice[file][0].content, "内容"); // 原 map 未被修改
  assert.equal(updated[file][0].content, "更新后的内容");
  assert.ok(updated[file][0].updatedAt >= updated[file][0].createdAt);

  const removed = removeAnnotationFromMap(updated, file, "ann-a");
  assert.deepEqual(
    removed[file].map((item) => item.id),
    ["ann-b"]
  );
  const removedLast = removeAnnotationFromMap(removed, file, "ann-b");
  assert.equal(removedLast[file], undefined);
});

test("buildAnnotationAnchor truncates head/tail samples to 40 chars", () => {
  const text = "字".repeat(100);
  const anchor = buildAnnotationAnchor({
    startBlockIndex: 0,
    startOffset: 0,
    endBlockIndex: 0,
    endOffset: 100,
    selectedText: text,
  });
  assert.equal(anchor.anchorText.length, 100);
  assert.equal(anchor.headText.length, 40);
  assert.equal(anchor.tailText.length, 40);
  assert.equal(anchor.headText, text.slice(0, 40));
  assert.equal(anchor.tailText, text.slice(-40));

  const short = buildAnnotationAnchor({
    startBlockIndex: 0,
    startOffset: 0,
    endBlockIndex: 0,
    endOffset: 4,
    selectedText: "测试文本",
  });
  assert.equal(short.headText, "测试文本");
  assert.equal(short.tailText, "测试文本");
});

test("relocation trusts offsets inside the block without validating text", () => {
  const blocks = [block("内容已经完全变了"), block("第二段")];
  const anchor = {
    startBlockIndex: 0,
    endBlockIndex: 0,
    startOffset: 2,
    endOffset: 5,
    anchorText: "已消失的文字",
    headText: "已消失的文字",
    tailText: "已消失的文字",
  };
  const resolved = resolveAnnotationAnchor(blocks, anchor);
  assert.deepEqual(resolved, {
    startBlockIndex: 0,
    endBlockIndex: 0,
    startOffset: 2,
    endOffset: 5,
  });
});

test("relocation searches inside the original block when offsets are out of range", () => {
  const blocks = [block("这是一段全新的文字，批注的目标文字在这里")];
  const anchor = {
    startBlockIndex: 0,
    endBlockIndex: 0,
    startOffset: 999, // 越界 → 回退文本搜索
    endOffset: 999,
    anchorText: "批注的目标文字在这里",
    headText: "批注的目标文字",
    tailText: "目标文字在这里",
  };
  const resolved = resolveAnnotationAnchor(blocks, anchor);
  assert.ok(resolved);
  // 起点 = "批注的目标文字" 命中位置
  assert.equal(resolved.startOffset, blocks[0].text.indexOf("批注的目标文字"));
  // 终点 = tail 命中位置 + 样本长度（否则起点终点同位被误判坍缩）
  const tailFound = blocks[0].text.indexOf("目标文字在这里");
  assert.equal(resolved.endOffset, tailFound + "目标文字在这里".length);
});

test("relocation spreads to neighbor blocks (radius 3, left first) when the block is gone", () => {
  const blocks = [
    block("第一段"),
    block("第二段"),
    block("第三段"),
    block("目标文字搬到了邻块"),
  ];
  const anchor = {
    startBlockIndex: 6, // 原块已不存在（越界索引）
    endBlockIndex: 6,
    startOffset: 999,
    endOffset: 999,
    anchorText: "目标文字搬到了邻块",
    headText: "目标文字搬到了邻块",
    tailText: "目标文字搬到了邻块",
  };
  const resolved = resolveAnnotationAnchor(blocks, anchor);
  assert.ok(resolved);
  assert.equal(resolved.startBlockIndex, 3);
  assert.equal(resolved.endBlockIndex, 3);
  assert.equal(resolved.startOffset, blocks[3].text.indexOf("目标文字搬到了邻块"));
  assert.equal(resolved.endOffset, blocks[3].text.length);
});

test("relocation drops the annotation when nothing can be found", () => {
  const blocks = [block("完全无关的内容")];
  const anchor = {
    startBlockIndex: 2,
    endBlockIndex: 2,
    startOffset: 0,
    endOffset: 4,
    anchorText: "找不到的文字",
    headText: "找不到的文字",
    tailText: "找不到的文字",
  };
  assert.equal(resolveAnnotationAnchor(blocks, anchor), null);
});

test("relocation rejects an anchor whose start block comes after its end block", () => {
  const blocks = [block("第一段"), block("第二段")];
  const anchor = {
    startBlockIndex: 1,
    endBlockIndex: 0,
    startOffset: 0,
    endOffset: 3,
    anchorText: "倒序",
    headText: "倒序",
    tailText: "倒序",
  };
  assert.equal(resolveAnnotationAnchor(blocks, anchor), null);
});

test("relocation rejects a zero-length range collapsed inside one block", () => {
  const blocks = [block("同一段文字")];
  const anchor = {
    startBlockIndex: 0,
    endBlockIndex: 0,
    startOffset: 3,
    endOffset: 3,
    anchorText: "同一段文字",
    headText: "同一段文字",
    tailText: "同一段文字",
  };
  assert.equal(resolveAnnotationAnchor(blocks, anchor), null);
});

test("resolveAnnotationEntries splits resolved ranges and dropped ids", () => {
  const blocks = [block("第一段的目标文字"), block("第二段")];
  const entries = [
    entry({ id: "ann-hit" }),
    entry({
      id: "ann-drop",
      anchor: {
        startBlockIndex: 9,
        endBlockIndex: 9,
        startOffset: 0,
        endOffset: 2,
        anchorText: "丢失",
        headText: "丢失",
        tailText: "丢失",
      },
    }),
  ];

  const { resolved, droppedIds } = resolveAnnotationEntries(blocks, entries);
  assert.deepEqual(droppedIds, ["ann-drop"]);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].entry.id, "ann-hit");
  assert.equal(resolved[0].range.startBlockIndex, 0);
});

test("round-trips through serialization and generates unique ids", () => {
  const file = "demo.md";
  const map = addAnnotationToMap({}, file, entry({ id: "ann-x" }));
  const parsed = parseAnnotations(serializeAnnotations(map));
  assert.equal(parsed[file][0].id, "ann-x");
  assert.equal(parsed[file][0].anchor.anchorText, "测试文本");

  const idA = createAnnotationId();
  const idB = createAnnotationId();
  assert.match(idA, /^ann-[0-9a-f]+-[0-9a-f]+$/);
  assert.notEqual(idA, idB);
});
