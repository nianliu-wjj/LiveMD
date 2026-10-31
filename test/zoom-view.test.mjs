import test from "node:test";
import assert from "node:assert/strict";
import {
  clamp,
  clampScale,
  scaleAtPoint,
  clampPan,
  fitScale,
  centerTransform,
  fitTransform,
  modeScale,
  parseViewBox,
  parseSvgLength,
  computeRootAdjustedViewBox,
} from "../src/core/viewers/zoomView.ts";

const EPSILON = 1e-9;

function assertClose(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < EPSILON, `${message}: ${actual} !== ${expected}`);
}

test("clamp and clampScale keep values inside the configured range", () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
  assert.equal(clamp(Number.NaN, 3, 10), 3);

  assert.equal(clampScale(2), 2);
  assert.equal(clampScale(0.01), 0.1);
  assert.equal(clampScale(20), 8);
  assert.equal(clampScale(0.5, { min: 0.25, max: 4 }), 0.5);
  assert.equal(clampScale(0.1, { min: 0.25, max: 4 }), 0.25);
  assert.equal(clampScale(9, { min: 0.25, max: 4 }), 4);
});

test("scaleAtPoint keeps the pointer anchored on the same content point", () => {
  const before = { scale: 1.5, x: 20, y: -10 };
  const pointer = { x: 300, y: 200 };
  const after = scaleAtPoint(before, 2.5, pointer.x, pointer.y);

  assert.equal(after.scale, 2.5);
  const contentX = (pointer.x - before.x) / before.scale;
  const contentY = (pointer.y - before.y) / before.scale;
  assertClose(contentX * after.scale + after.x, pointer.x, "x anchor");
  assertClose(contentY * after.scale + after.y, pointer.y, "y anchor");
});

test("scaleAtPoint respects limits and ignores invalid current scale", () => {
  const clamped = scaleAtPoint({ scale: 1, x: 0, y: 0 }, 100, 10, 20, { min: 0.25, max: 4 });
  assert.equal(clamped.scale, 4);

  const invalid = scaleAtPoint({ scale: 0, x: 7, y: 9 }, 2, 10, 20);
  assert.deepEqual(invalid, { scale: 2, x: 7, y: 9 });
});

test("clampPan centers small content and clamps oversized content", () => {
  const centered = clampPan({ scale: 1, x: 999, y: -999 }, { width: 100, height: 50 }, {
    width: 400,
    height: 300,
  });
  assert.deepEqual(centered, { scale: 1, x: 150, y: 125 });

  const left = clampPan({ scale: 1, x: -100, y: -100 }, { width: 1000, height: 1000 }, {
    width: 400,
    height: 300,
  });
  assert.deepEqual(left, { scale: 1, x: -100, y: -100 });

  const tooFar = clampPan({ scale: 1, x: 100, y: 100 }, { width: 1000, height: 1000 }, {
    width: 400,
    height: 300,
  });
  assert.deepEqual(tooFar, { scale: 1, x: 0, y: 0 });

  const negative = clampPan({ scale: 1, x: -900, y: -900 }, { width: 1000, height: 1000 }, {
    width: 400,
    height: 300,
  });
  assert.deepEqual(negative, { scale: 1, x: -600, y: -700 });
});

test("fitScale fits inside the viewport without upscaling by default", () => {
  assertClose(
    fitScale({ width: 1000, height: 500 }, { width: 800, height: 600 }, { padding: 0 }),
    0.8,
    "wide content"
  );
  assertClose(
    fitScale({ width: 100, height: 100 }, { width: 800, height: 600 }, { padding: 0 }),
    1,
    "small content stays original"
  );
  assertClose(
    fitScale(
      { width: 100, height: 100 },
      { width: 800, height: 600 },
      { padding: 0, allowUpscale: true }
    ),
    6,
    "upscale when requested"
  );
  assertClose(
    fitScale({ width: 1000, height: 500 }, { width: 800, height: 600 }, { padding: 20 }),
    0.76,
    "padding is applied on both sides"
  );
});

test("centerTransform and fitTransform center content in the viewport", () => {
  const centered = centerTransform({ width: 400, height: 200 }, { width: 1000, height: 600 }, 0.5);
  assert.deepEqual(centered, { scale: 0.5, x: 400, y: 250 });

  const fitted = fitTransform(
    { width: 400, height: 200 },
    { width: 1000, height: 600 },
    { padding: 0 }
  );
  assert.equal(fitted.scale, 1);
  assert.equal(fitted.x, 300);
  assert.equal(fitted.y, 200);
});

test("modeScale implements readable, fit, original and custom modes", () => {
  const content = { width: 1000, height: 500 };
  const viewport = { width: 500, height: 500 };

  assertClose(modeScale("readable", content, viewport, { padding: 0 }), 0.85, "readable min 85%");
  assertClose(modeScale("fit", content, viewport, { padding: 0 }), 0.5, "fit");
  assertClose(modeScale("original", content, viewport, { padding: 0 }), 1, "original");
  assertClose(
    modeScale("custom", content, viewport, { padding: 0, fallbackScale: 2.25 }),
    2.25,
    "custom keeps current scale"
  );

  assertClose(
    modeScale("readable", { width: 200, height: 200 }, viewport, { padding: 0 }),
    1,
    "readable does not upscale"
  );
});

test("parseViewBox and parseSvgLength reject malformed values", () => {
  assert.deepEqual(parseViewBox("0 0 640 480"), { x: 0, y: 0, width: 640, height: 480 });
  assert.deepEqual(parseViewBox("-10, -20, 100.5, 50"), {
    x: -10,
    y: -20,
    width: 100.5,
    height: 50,
  });
  assert.equal(parseViewBox("0 0 0 100"), null);
  assert.equal(parseViewBox("0 0 100"), null);
  assert.equal(parseViewBox(null), null);

  assert.equal(parseSvgLength("800"), 800);
  assert.equal(parseSvgLength("800px"), 800);
  assert.equal(parseSvgLength(" 12.5px "), 12.5);
  assert.equal(parseSvgLength("100%"), null);
  assert.equal(parseSvgLength("10em"), null);
  assert.equal(parseSvgLength("-5"), null);
  assert.equal(parseSvgLength("0"), null);
});

test("computeRootAdjustedViewBox shrinks blank Mermaid borders only", () => {
  const adjusted = computeRootAdjustedViewBox(
    { x: 0, y: 0, width: 1000, height: 1000 },
    { left: 0, top: 0, width: 500, height: 500 },
    { left: 50, top: 50, width: 400, height: 400 },
    0
  );
  assert.deepEqual(adjusted, { x: 100, y: 100, width: 800, height: 800 });

  const full = computeRootAdjustedViewBox(
    { x: 0, y: 0, width: 1000, height: 1000 },
    { left: 0, top: 0, width: 500, height: 500 },
    { left: 0, top: 0, width: 500, height: 500 },
    0
  );
  assert.equal(full, null);

  const invalid = computeRootAdjustedViewBox(
    { x: 0, y: 0, width: 1000, height: 1000 },
    { left: 0, top: 0, width: 0, height: 500 },
    { left: 0, top: 0, width: 400, height: 400 },
    0
  );
  assert.equal(invalid, null);
});
