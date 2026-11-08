import assert from "node:assert/strict";
import test from "node:test";
import {
  addChild,
  addSibling,
  cloneMindMap,
  countNodes,
  findNode,
  moveNode,
  parseMindMap,
  removeNode,
  serializeMindMap,
  updateNodeText,
} from "../src/core/utils/mindmap-markdown.ts";
import { layoutMindMap, renderMindMapSvg } from "../src/core/nodeviews/mindmap.ts";

const SAMPLE = ["中心", "  分支A", "    A1", "    A2", "  分支B"].join("\n");

test("parseMindMap：按缩进解析层级并生成路径 id", () => {
  const root = parseMindMap(SAMPLE);
  assert.equal(root.text, "中心");
  assert.equal(root.id, "root");
  assert.deepEqual(
    root.children.map((child) => child.text),
    ["分支A", "分支B"]
  );
  assert.equal(root.children[0].children[1].id, "root-0-1");
  assert.equal(countNodes(root), 5);
});

test("parseMindMap：Tab 缩进、列表符号、缩进跳级、多个顶层行均能得到合法树", () => {
  const root = parseMindMap("根\n\t- 子\n\t\t\t* 孙\n另一个顶层");
  assert.equal(root.children[0].text, "子");
  assert.equal(root.children[0].children[0].text, "孙");
  assert.equal(root.children[1].text, "另一个顶层");
});

test("parseMindMap：空内容返回默认中心主题", () => {
  const root = parseMindMap("  \n\n");
  assert.equal(root.text, "中心主题");
  assert.equal(root.children.length, 0);
});

test("serializeMindMap：与 parseMindMap 往返一致，文本中的换行被压平", () => {
  assert.equal(serializeMindMap(parseMindMap(SAMPLE)), SAMPLE);
  const root = parseMindMap("根");
  root.text = "多\n行";
  assert.equal(serializeMindMap(root), "多 行");
});

test("编辑操作：增子节点 / 同级 / 删除 / 移动 / 改文本", () => {
  const root = cloneMindMap(parseMindMap(SAMPLE));
  const childId = addChild(root, "root-1", "B1");
  assert.equal(childId, "root-1-0");
  const siblingId = addSibling(root, "root-0", "插入");
  assert.equal(siblingId, "root-1");
  assert.equal(root.children[2].text, "分支B");
  assert.equal(moveNode(root, "root-2", -1), "root-1");
  assert.equal(root.children[1].text, "分支B");
  assert.equal(removeNode(root, "root-0"), "root-0");
  assert.equal(removeNode(root, "root"), null);
  assert.ok(updateNodeText(root, "root-0", "改名"));
  assert.equal(findNode(root, "root-0")?.text, "改名");
});

test("layoutMindMap：一级分支左右分布，节点互不重叠", () => {
  const source = ["中心", "  一", "  二", "  三", "  四"].join("\n");
  const layout = layoutMindMap(parseMindMap(source));
  const rootNode = layout.nodes.find((node) => node.depth === 0);
  const sides = new Set(layout.nodes.filter((node) => node.depth === 1).map((node) => node.side));
  assert.ok(sides.has(1) && sides.has(-1), "应同时有左右分支");
  assert.equal(layout.edges.length, 4);
  for (const node of layout.nodes) {
    assert.ok(node.x >= 0 && node.y >= 0, "坐标应平移到正区间");
  }
  const branches = layout.nodes.filter((node) => node.depth === 1 && node.side === 1);
  for (let i = 1; i < branches.length; i++) {
    assert.ok(branches[i].y >= branches[i - 1].y + branches[i - 1].height, "同侧兄弟不重叠");
  }
  assert.ok(rootNode);
});

test("renderMindMapSvg：输出 SVG 并转义特殊字符", () => {
  const svg = renderMindMapSvg('<根> & "引号"\n  子', { selectedId: "root" });
  assert.match(svg, /^<svg /);
  assert.match(svg, /&lt;根&gt; &amp; &quot;引号&quot;/);
  assert.match(svg, /is-selected/);
  assert.doesNotMatch(svg, /<根>/);
});
