import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "./helpers/core-module-server.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  testModules: ["/src/hooks/useProgrammaticGuard.ts"],
  root: projectRoot,
  server: { middlewareMode: true },
});

const { useProgrammaticGuard } = await server.ssrLoadModule("/src/hooks/useProgrammaticGuard.ts");

after(async () => {
  await server.close();
});

/** 测试用 PM doc 替身：eq 按 version 判等（模拟 doc 深相等语义） */
function fakeDoc(version) {
  return {
    version,
    eq(other) {
      return Boolean(other) && other.version === this.version;
    },
  };
}

test("首次 change（无基线）：判真并重建基线", () => {
  const guard = useProgrammaticGuard(() => ({ doc: fakeDoc(1), markdown: "v1" }));
  const doc1 = fakeDoc(1);

  assert.equal(guard.isRealEdit(doc1, "v1"), true);
  // 同 doc 同串的再次 change → 假编辑（基线命中）
  assert.equal(guard.isRealEdit(doc1, "v1"), false);
});

test("doc 深相等但序列化串变化：真实编辑", () => {
  const guard = useProgrammaticGuard(() => ({ doc: fakeDoc(2), markdown: "v2" }));
  const doc1 = fakeDoc(1);

  assert.equal(guard.isRealEdit(doc1, "v1"), true);
  // 用户打字：doc 结构没变到判不等（测试替身简化为 version 相同）、内容变了
  assert.equal(guard.isRealEdit(doc1, "v2"), true);
});

test("序列化串相同但 doc 变化：真实编辑（eq 被实际核对）", () => {
  const guard = useProgrammaticGuard(() => ({ doc: fakeDoc(9), markdown: "same" }));

  assert.equal(guard.isRealEdit(fakeDoc(1), "same"), true);
  // markdown 相同但 doc 深不等（如仅 mark/属性变化的旁路路径）→ 不判假
  assert.equal(guard.isRealEdit(fakeDoc(2), "same"), true);
  // doc 深相等 + 串相同 → 假编辑
  assert.equal(guard.isRealEdit(fakeDoc(2), "same"), false);
});

test("runProgrammatic 期间 change 判假，结束后基线对齐快照", () => {
  const snapshot = { doc: fakeDoc(1), markdown: "v1" };
  const guard = useProgrammaticGuard(() => snapshot);

  assert.equal(guard.isRealEdit(fakeDoc(1), "v1"), true);

  let ran = false;
  guard.runProgrammatic(() => {
    // 程序化写入期间的 change 回声（内容甚至没变）→ 抑制判假
    assert.equal(guard.isRealEdit(fakeDoc(1), "v1"), false);
    assert.equal(guard.isSuppressing(), true);
    ran = true;
  });
  assert.equal(ran, true);
  assert.equal(guard.isSuppressing(), false);

  // 结束后基线已对齐快照：同内容迟到回声判假
  assert.equal(guard.isRealEdit(fakeDoc(1), "v1"), false);
});

test("watcher 回写场景：包裹期内判假，之后真实用户编辑判真", () => {
  let snapshot = { doc: fakeDoc(1), markdown: "磁盘内容" };
  const guard = useProgrammaticGuard(() => snapshot);

  // 用户已编辑到 v2
  assert.equal(guard.isRealEdit(fakeDoc(1), "v2"), true);

  // 外部 watcher 回写：doc 被替换为磁盘内容的注入结果
  snapshot = { doc: fakeDoc(3), markdown: "磁盘内容" };
  guard.runProgrammatic(() => {});

  // 回写后用户继续编辑 → 真实编辑
  assert.equal(guard.isRealEdit(fakeDoc(3), "磁盘内容+用户输入"), true);
});

test("真实编辑后再删回原样：第二次仍是真实编辑（基线已前移）", () => {
  const guard = useProgrammaticGuard(() => ({ doc: fakeDoc(9), markdown: "" }));

  assert.equal(guard.isRealEdit(fakeDoc(1), "a"), true); // 打入 a
  assert.equal(guard.isRealEdit(fakeDoc(2), ""), true); // 删回空：基线是 "a"，判真
});
