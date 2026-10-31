import assert from "node:assert/strict";
import test from "node:test";
import {
  CODE_BLOCK_FOLD_PREVIEW_LINES,
  canFoldCodeBlock,
  getCodeBlockFoldHeight,
} from "../src/core/nodeviews/code-block-fold.ts";

test("code block folding keeps five preview lines and ignores diagrams", () => {
  assert.equal(CODE_BLOCK_FOLD_PREVIEW_LINES, 5);
  assert.equal(canFoldCodeBlock(0, false), false);
  assert.equal(canFoldCodeBlock(5, false), false);
  assert.equal(canFoldCodeBlock(6, false), true);
  assert.equal(canFoldCodeBlock(100, true), false);
  assert.equal(canFoldCodeBlock(Number.NaN, false), false);
});

test("code block fold height uses measured line height and content padding", () => {
  assert.equal(getCodeBlockFoldHeight(20, 8), 108);
  assert.equal(getCodeBlockFoldHeight(22.5, 8), 121);
  assert.equal(getCodeBlockFoldHeight(0, 8), 108);
  assert.equal(getCodeBlockFoldHeight(20, -4), 100);
});
