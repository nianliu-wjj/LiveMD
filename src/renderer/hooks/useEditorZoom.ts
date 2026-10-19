import { createEditorZoomController } from "@/renderer/utils/editorZoom";
import useTab from "./useTab";

let controller: ReturnType<typeof createEditorZoomController> | undefined;

export default function useEditorZoom() {
  if (!controller) controller = createEditorZoomController(useTab().currentTab);

  return controller;
}
