import test from "node:test";
import assert from "node:assert/strict";
import { ref } from "vue";
import { createEditorZoomController } from "../src/renderer/utils/editorZoom.ts";

function createTab(overrides = {}) {
  return {
    id: "tab-1",
    name: "Note",
    filePath: null,
    content: "# Note",
    originalContent: "# Note",
    isModified: false,
    readOnly: false,
    zoomPercent: 100,
    ...overrides,
  };
}

test("editor zoom starts at the 100% baseline", () => {
  const activeTab = ref(createTab());
  const controller = createEditorZoomController(activeTab);

  assert.equal(controller.zoomPercent.value, 100);
  assert.deepEqual(controller.contentStyle.value, { zoom: 1 });
});

test("editor zoom changes in ten-percent steps and resets to 100%", () => {
  const activeTab = ref(createTab());
  const controller = createEditorZoomController(activeTab);

  controller.zoomIn();
  assert.equal(controller.zoomPercent.value, 110);
  assert.deepEqual(controller.contentStyle.value, { zoom: 1.1 });

  controller.zoomOut();
  controller.zoomOut();
  assert.equal(controller.zoomPercent.value, 90);

  controller.resetZoom();
  assert.equal(controller.zoomPercent.value, 100);
});

test("editor zoom clamps to 50–300% and exposes action availability", () => {
  const activeTab = ref(createTab());
  const controller = createEditorZoomController(activeTab);

  for (let index = 0; index < 10; index += 1) controller.zoomOut();
  assert.equal(controller.zoomPercent.value, 50);
  assert.equal(controller.canZoomOut.value, false);
  assert.equal(controller.canZoomIn.value, true);

  for (let index = 0; index < 30; index += 1) controller.zoomIn();
  assert.equal(controller.zoomPercent.value, 300);
  assert.equal(controller.canZoomIn.value, false);
  assert.equal(controller.canZoomOut.value, true);
});

test("editor zoom stays isolated per tab without changing document state", () => {
  const firstTab = createTab({ id: "tab-1", filePath: "D:/notes/note.md" });
  const secondTab = createTab({
    id: "tab-2",
    name: "Other",
    content: "Other",
    originalContent: "Other",
  });
  const activeTab = ref(firstTab);
  const controller = createEditorZoomController(activeTab);
  const firstTabBeforeZoom = { ...firstTab };

  controller.zoomIn();
  assert.equal(firstTab.zoomPercent, 110);
  assert.equal(secondTab.zoomPercent, 100);
  assert.deepEqual(
    { ...firstTab, zoomPercent: firstTabBeforeZoom.zoomPercent },
    firstTabBeforeZoom
  );
  assert.deepEqual(controller.contentStyleFor(firstTab), { zoom: 1.1 });

  activeTab.value = secondTab;
  assert.equal(controller.zoomPercent.value, 100);

  activeTab.value = firstTab;
  assert.equal(controller.zoomPercent.value, 110);

  activeTab.value = null;
  controller.zoomIn();
  assert.equal(controller.hasActiveTab.value, false);
  assert.equal(controller.canZoomIn.value, false);
  assert.equal(firstTab.zoomPercent, 110);
});
