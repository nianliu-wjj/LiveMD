import assert from "node:assert/strict";
import test from "node:test";
import {
  getSidebarContextKey,
  readSidebarVisibility,
  resolveSidebarVisibility,
  STANDALONE_SIDEBAR_CONTEXT,
  writeSidebarVisibility,
} from "../src/renderer/utils/sidebarVisibility.ts";

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    values,
  };
}

test("sidebar context keys distinguish workspaces and standalone mode", () => {
  assert.equal(getSidebarContextKey("C:\\Project\\"), "c:/project");
  assert.equal(getSidebarContextKey("C:/Project///"), "c:/project");
  assert.equal(getSidebarContextKey("C:\\"), "c:/");
  assert.equal(getSidebarContextKey("/"), "/");
  assert.equal(getSidebarContextKey("/WorkSpace/"), "/WorkSpace");
  assert.equal(getSidebarContextKey(""), STANDALONE_SIDEBAR_CONTEXT);
  assert.equal(getSidebarContextKey(null), STANDALONE_SIDEBAR_CONTEXT);
});

test("saved sidebar visibility wins over the startup fallback", () => {
  assert.equal(resolveSidebarVisibility(false, true), false);
  assert.equal(resolveSidebarVisibility(true, false), true);
  assert.equal(resolveSidebarVisibility(undefined, true), true);
  assert.equal(resolveSidebarVisibility("false", true), true);
});

test("workspace visibility writes stay independent", () => {
  const storage = createStorage();

  writeSidebarVisibility("project-a", false, storage);
  writeSidebarVisibility("project-b", true, storage);

  assert.equal(readSidebarVisibility("project-a", storage), false);
  assert.equal(readSidebarVisibility("project-b", storage), true);
  assert.equal(readSidebarVisibility("project-c", storage), undefined);

  writeSidebarVisibility("project-a", true, storage);
  assert.equal(readSidebarVisibility("project-a", storage), true);
});
