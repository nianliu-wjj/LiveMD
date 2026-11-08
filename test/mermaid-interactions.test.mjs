import assert from "node:assert/strict";
import test from "node:test";
import {
  extractMermaidPositions,
  isFlowchartSource,
  parsePositionsAttr,
  renameFlowchartNode,
  serializeMermaidPositions,
  stringifyPositionsAttr,
} from "../src/core/utils/diagram-meta.ts";
import {
  buildBasisPath,
  clipToBox,
  moveEdgePoints,
  parseEdgeEnds,
  parseNodeId,
} from "../src/core/nodeviews/mermaid-interactions.ts";
import { MarkdownParser } from "../src/core/parser/index.ts";
import { MarkdownSerializer } from "../src/core/serializer/index.ts";

test("positions 注释：提取后正文不含注释，序列化往返一致", () => {
  const line = '%% livemd:positions {"A":{"dx":12,"dy":-4}} %%';
  const [positions, stripped] = extractMermaidPositions(`graph TD\nA-->B\n${line}`);
  assert.deepEqual(positions, { A: { dx: 12, dy: -4 } });
  assert.equal(stripped, "graph TD\nA-->B");
  assert.equal(serializeMermaidPositions(positions), line);
});

test("positions 注释：被改坏时按普通注释保留，不丢内容", () => {
  const source = "graph TD\n%% livemd:positions {bad} %%\nA-->B";
  assert.deepEqual(extractMermaidPositions(source), [null, source]);
});

test("positions 属性：零位移与非法项被丢弃，全空时为 null", () => {
  assert.equal(stringifyPositionsAttr({ A: { dx: 0, dy: 0 } }), null);
  assert.deepEqual(parsePositionsAttr('{"A":{"dx":1,"dy":2},"B":{"dx":"x"}}'), {
    A: { dx: 1, dy: 2 },
  });
  assert.equal(parsePositionsAttr("not json"), null);
  assert.equal(parsePositionsAttr(null), null);
});

test("Markdown 往返：位置写入注释、解析回属性，文件内容不变", () => {
  const parser = new MarkdownParser();
  const markdown =
    '```mermaid\ngraph TD\nA-->B\n%% livemd:positions {"A":{"dx":5,"dy":6}} %%\n```\n';
  const { doc } = parser.parse(markdown);
  const block = doc.firstChild;
  assert.equal(block.textContent, "graph TD\nA-->B");
  assert.equal(block.attrs.mermaidLayout, '{"A":{"dx":5,"dy":6}}');
  assert.equal(new MarkdownSerializer().serialize(doc).trim(), markdown.trim());
});

test("isFlowchartSource：识别 graph/flowchart，跳过注释与 frontmatter", () => {
  assert.ok(isFlowchartSource("graph TD\nA-->B"));
  assert.ok(isFlowchartSource("---\ntitle: x\n---\n%% c\nflowchart LR\nA-->B"));
  assert.ok(!isFlowchartSource("sequenceDiagram\nA->>B: hi"));
  assert.ok(!isFlowchartSource("graphviz"));
});

test("renameFlowchartNode：保持形状，只替换文字", () => {
  assert.equal(renameFlowchartNode("graph TD\nA[旧] --> B", "A", "新"), "graph TD\nA[新] --> B");
  assert.equal(
    renameFlowchartNode("graph TD\nA((圆)) --> B", "A", "新"),
    "graph TD\nA((新)) --> B"
  );
  assert.equal(renameFlowchartNode('graph TD\nA{"a ] b"}', "A", "新"), "graph TD\nA{新}");
  assert.equal(renameFlowchartNode("graph TD\nA([x])", "A", "y z"), "graph TD\nA([y z])");
});

test("renameFlowchartNode：特殊字符加引号，引号转义为实体", () => {
  assert.equal(renameFlowchartNode("graph TD\nA[x]", "A", "a(b)"), 'graph TD\nA["a(b)"]');
  assert.equal(renameFlowchartNode("graph TD\nA[x]", "A", 'a"b'), 'graph TD\nA["a#quot;b"]');
});

test("renameFlowchartNode：无文字节点在首次出现处补上", () => {
  assert.equal(
    renameFlowchartNode("graph TD\nA --> B\nB --> C", "B", "新"),
    "graph TD\nA --> B[新]\nB --> C"
  );
  assert.equal(renameFlowchartNode("graph TD\nA---B", "B", "新"), "graph TD\nA---B[新]");
});

test("renameFlowchartNode：不误伤标签文字、更长 id 与非节点语句", () => {
  const source = "graph TD\nstyle A fill:#fff\nAB[A] -->|A| A[目标]";
  assert.equal(
    renameFlowchartNode(source, "A", "新"),
    "graph TD\nstyle A fill:#fff\nAB[A] -->|A| A[新]"
  );
  assert.equal(renameFlowchartNode("graph TD\nAB --> C", "A", "新"), null);
  assert.equal(renameFlowchartNode("graph TD\nA[x]", "A", "   "), null);
});

test("renameFlowchartNode：支持 @{} 对象语法", () => {
  assert.equal(
    renameFlowchartNode('graph TD\nA@{ shape: rect, label: "旧" }', "A", "新"),
    'graph TD\nA@{ shape: rect, label: "新" }'
  );
});

test("parseNodeId：兼容带图表 id 前缀的 DOM id", () => {
  assert.equal(parseNodeId("flowchart-A-0"), "A");
  assert.equal(parseNodeId("mermaid-12-flowchart-my_node-3"), "my_node");
  assert.equal(parseNodeId("other"), null);
});

test("parseEdgeEnds：节点 id 含分隔符时按已知节点切分", () => {
  assert.deepEqual(parseEdgeEnds("L_A_B_0", ["A", "B"]), ["A", "B"]);
  assert.deepEqual(parseEdgeEnds("L-A-B-0", ["A", "B"]), ["A", "B"]);
  assert.deepEqual(parseEdgeEnds("L_a_b_c_1", ["a", "b", "a_b", "c"]), ["a_b", "c"]);
  assert.deepEqual(parseEdgeEnds("mermaid-1_L_A_B_0", ["A", "B"]), ["A", "B"]);
  assert.equal(parseEdgeEnds("L_X_Y_0", ["A", "B"]), null);
});

test("buildBasisPath：两点为直线，多点为 basis 曲线", () => {
  assert.equal(
    buildBasisPath([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]),
    "M0,0L10,0"
  );
  const path = buildBasisPath([
    { x: 0, y: 0 },
    { x: 6, y: 0 },
    { x: 12, y: 0 },
  ]);
  assert.match(path, /^M0,0L1,0C/);
  assert.match(path, /L12,0$/);
});

test("clipToBox：返回边框交点，目标在框内时为 null", () => {
  assert.deepEqual(clipToBox({ x: 0, y: 0 }, 10, 5, { x: 100, y: 0 }), { x: 10, y: 0 });
  assert.equal(clipToBox({ x: 0, y: 0 }, 10, 5, { x: 3, y: 3 }), null);
});

test("moveEdgePoints：两端按各自位移，中点取平均", () => {
  const base = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 20, y: 0 },
  ];
  assert.deepEqual(moveEdgePoints(base, { dx: 0, dy: 0 }, { dx: 10, dy: 20 }), [
    { x: 0, y: 0 },
    { x: 15, y: 10 },
    { x: 30, y: 20 },
  ]);
});
