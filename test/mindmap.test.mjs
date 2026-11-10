import assert from "node:assert/strict";
import test from "node:test";
import { parseMindMap } from "../src/core/utils/mindmap-markdown.ts";
import {
  countMindMap,
  createMindMapTemplate,
  isMindMapJson,
  parseMindMapDocument,
  serializeMindMapDocument,
} from "../src/core/utils/mindmap-document.ts";

const LEGACY = ["中心", "  分支A", "    A1", "    A2", "  分支B"].join("\n");

test("旧格式 parseMindMap：按缩进解析层级并生成路径 id", () => {
  const root = parseMindMap(LEGACY);
  assert.equal(root.text, "中心");
  assert.deepEqual(
    root.children.map((child) => child.text),
    ["分支A", "分支B"]
  );
  assert.equal(root.children[0].children[1].id, "root-0-1");
});

test("旧格式 parseMindMap：Tab 缩进、列表符号、缩进跳级、多个顶层行均能得到合法树", () => {
  const root = parseMindMap("根\n\t- 子\n\t\t\t* 孙\n另一个顶层");
  assert.equal(root.children[0].text, "子");
  assert.equal(root.children[0].children[0].text, "孙");
  assert.equal(root.children[1].text, "另一个顶层");
  assert.equal(parseMindMap("  \n\n").text, "中心主题");
});

test("parseMindMapDocument：旧缩进文本自动转为引擎节点数据", () => {
  const doc = parseMindMapDocument(LEGACY);
  assert.equal(doc.layout, "logicalStructure");
  assert.equal(doc.theme.template, "default");
  assert.equal(doc.root.data.text, "中心");
  assert.equal(doc.root.children[0].children[1].data.text, "A2");
  assert.equal(doc.view, null);
});

test("parseMindMapDocument：完整 .smm 文档原样保留结构、主题与视图", () => {
  const source = JSON.stringify({
    layout: "mindMap",
    root: { data: { text: "根", expand: true, fillColor: "#fff" }, children: [] },
    theme: { template: "classic4", config: { lineWidth: 3 } },
    view: { transform: { scaleX: 1 } },
  });
  const doc = parseMindMapDocument(source);
  assert.equal(doc.layout, "mindMap");
  assert.equal(doc.root.data.fillColor, "#fff");
  assert.deepEqual(doc.theme, { template: "classic4", config: { lineWidth: 3 } });
  assert.deepEqual(doc.view, { transform: { scaleX: 1 } });
});

test("parseMindMapDocument：只有节点树的 JSON、缺字段的节点均补齐默认值", () => {
  const doc = parseMindMapDocument('{"data":{"text":"根"},"children":[{"data":{}},{}]}');
  assert.equal(doc.layout, "logicalStructure");
  assert.equal(doc.root.children.length, 2);
  assert.equal(doc.root.children[0].data.text, "");
  assert.deepEqual(doc.root.children[1].children, []);
});

test("parseMindMapDocument：JSON 损坏时抛错而不是静默丢内容", () => {
  assert.throws(() => parseMindMapDocument('{"root": '), SyntaxError);
  assert.ok(isMindMapJson('  {"a":1}'));
  assert.ok(!isMindMapJson("中心\n  分支"));
});

test("serializeMindMapDocument：与解析往返一致，模板可直接解析", () => {
  const template = createMindMapTemplate();
  const doc = parseMindMapDocument(template);
  assert.equal(doc.root.data.text, "中心主题");
  assert.equal(serializeMindMapDocument(doc), template);
});

test("countMindMap：统计节点数与去掉富文本标签后的字数", () => {
  const doc = parseMindMapDocument(
    JSON.stringify({ root: { data: { text: "<p><strong>根</strong>节点</p>" }, children: [{ data: { text: "子 一" }, children: [] }] } })
  );
  assert.deepEqual(countMindMap(doc.root), { nodes: 2, words: 5 });
});
