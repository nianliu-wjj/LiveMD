/**
 * 自动保存开关（设置页开关与标题栏项目菜单共用）
 *
 * 关闭时给出黄色警示 toast，提醒用户手动保存（对齐实现指南 §10.1）。
 */
import autotoast from "autotoast.js";
import { useConfig } from "./useConfig";

/** 设置自动保存开关并给出反馈 */
export function applyAutoSave(value: boolean): void {
  const { setConf } = useConfig();
  setConf("other", "autoSave", value);
  autotoast.show(
    value ? "已开启自动保存" : "已关闭自动保存，请记得手动保存",
    value ? "success" : "warn"
  );
}
