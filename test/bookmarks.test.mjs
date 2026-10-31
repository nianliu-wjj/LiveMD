import assert from "node:assert/strict";
import test from "node:test";
import {
  BOOKMARKS_STORAGE_KEY,
  listBookmarks,
  parseBookmarks,
  removeBookmarkFromMap,
  serializeBookmarks,
  toggleBookmarkInMap,
} from "../src/renderer/utils/bookmarks.ts";

test("storage key stays stable", () => {
  assert.equal(BOOKMARKS_STORAGE_KEY, "livemd-bookmarks");
});

test("toggles a bookmark on and off", () => {
  const file = "D:/notes/demo.md";
  const first = toggleBookmarkInMap({}, file, {
    index: 2,
    text: "第二段",
    type: "paragraph",
  });
  assert.equal(first.added, true);
  assert.equal(first.map[file].length, 1);
  assert.equal(first.map[file][0].text, "第二段");
  assert.ok(first.map[file][0].createdAt > 0);

  const second = toggleBookmarkInMap(first.map, file, {
    index: 2,
    text: "第二段",
    type: "paragraph",
  });
  assert.equal(second.added, false);
  assert.equal(second.map[file], undefined);
});

test("keeps bookmarks sorted by block index and removes selected entries", () => {
  const file = "demo.md";
  let map = toggleBookmarkInMap({}, file, { index: 5, text: "five", type: "paragraph" }).map;
  map = toggleBookmarkInMap(map, file, { index: 1, text: "one", type: "heading" }).map;

  assert.deepEqual(
    map[file].map((entry) => entry.index),
    [1, 5]
  );

  map = removeBookmarkFromMap(map, file, 1);
  assert.deepEqual(
    map[file].map((entry) => entry.index),
    [5]
  );

  map = removeBookmarkFromMap(map, file, 5);
  assert.equal(map[file], undefined);
});

test("parses only valid stored bookmarks", () => {
  const raw = JSON.stringify({
    "a.md": [
      { index: 0, text: "ok", type: "paragraph", createdAt: 1 },
      { index: -1, text: "bad", type: "paragraph", createdAt: 1 },
      { index: 2, text: 1, type: "paragraph", createdAt: 1 },
    ],
    "b.md": "not-an-array",
    "c.md": [{ index: 3, text: "valid", type: "code_block", createdAt: 2 }],
  });

  const map = parseBookmarks(raw);
  assert.deepEqual(Object.keys(map).sort(), ["a.md", "c.md"]);
  assert.equal(map["a.md"].length, 1);
  assert.equal(map["c.md"][0].index, 3);
  assert.deepEqual(parseBookmarks("not json"), {});
  assert.deepEqual(parseBookmarks(null), {});
});

test("round-trips through serialization and flattens rows", () => {
  const map = toggleBookmarkInMap({}, "demo.md", {
    index: 0,
    text: "标题",
    type: "heading",
  }).map;
  const parsed = parseBookmarks(serializeBookmarks(map));
  const rows = listBookmarks(parsed);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].filePath, "demo.md");
  assert.equal(rows[0].entry.text, "标题");
});
