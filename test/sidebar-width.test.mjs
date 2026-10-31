import assert from "node:assert/strict";
import test from "node:test";
import { createSidebarWidthController } from "../src/renderer/hooks/useSidebarWidth.ts";

test("sidebar width defaults to 25 percent and clamps to the allowed range", () => {
  const controller = createSidebarWidthController({
    getContainerWidth: () => 1200,
    getPreferredWidth: () => null,
    setPreferredWidth: () => {},
  });

  assert.deepEqual(controller.getBounds(), { min: 200, max: 600 });
  assert.equal(controller.getWidth(), 300);

  controller.beginResize(500);
  assert.equal(controller.resizeTo(-1000), 200);
  assert.equal(controller.resizeTo(2000), 600);
  controller.endResize();
});

test("sidebar width changes live and persists only when dragging ends", () => {
  let preferredWidth = 320;
  const writes = [];
  const controller = createSidebarWidthController({
    getContainerWidth: () => 1200,
    getPreferredWidth: () => preferredWidth,
    setPreferredWidth: (width) => {
      preferredWidth = width;
      writes.push(width);
    },
  });

  assert.equal(controller.getWidth(), 320);
  controller.beginResize(500);
  assert.equal(controller.resizeTo(560), 380);
  assert.equal(controller.getWidth(), 380);
  assert.deepEqual(writes, []);

  controller.endResize();
  assert.equal(controller.getWidth(), 380);
  assert.deepEqual(writes, [380]);

  const restoredController = createSidebarWidthController({
    getContainerWidth: () => 1200,
    getPreferredWidth: () => preferredWidth,
    setPreferredWidth: () => {},
  });
  assert.equal(restoredController.getWidth(), 380);
});

test("sidebar width adapts its bounds to a small editor area without changing the preference", () => {
  let containerWidth = 400;
  let preferredWidth = 320;
  let writes = 0;
  const controller = createSidebarWidthController({
    getContainerWidth: () => containerWidth,
    getPreferredWidth: () => preferredWidth,
    setPreferredWidth: () => {
      writes += 1;
    },
  });

  assert.deepEqual(controller.getBounds(), { min: 200, max: 200 });
  assert.equal(controller.getWidth(), 200);

  containerWidth = 1200;
  assert.equal(controller.refresh(), 320);
  assert.equal(preferredWidth, 320);
  assert.equal(writes, 0);
});
