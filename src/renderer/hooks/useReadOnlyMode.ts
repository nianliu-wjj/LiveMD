/**
 * 只读模式（窗口级开关）
 *
 * - 由状态栏右侧的锁形按钮切换，不持久化：每次启动默认可编辑，避免忘记开关后"怎么都打不了字"；
 * - 生效范围：
 *   1. 所有标签页的编辑器实例——LivemdEditor 把它与文件系统只读（tab.readOnly）合并为 effectiveReadOnly；
 *   2. 核心编辑器 dispatchTransaction 拦截一切改动文档的事务（键入、右键菜单、命令面板的程序化修改）；
 *   3. 右键菜单中的修改类项（剪切 / 粘贴 / 表格增删行列 / 插入）置灰；
 *   4. 状态栏「排版规范化」、检查面板「修复」等经 useTab.updateCurrentTabContent 写回的操作被拒绝。
 */
import { ref } from "vue";

/** 当前窗口是否处于只读模式 */
const isReadOnlyMode = ref(false);

/**
 * 切换只读模式
 * @param next 指定目标状态；缺省时取反
 */
function toggleReadOnlyMode(next?: boolean): void {
  const target = next ?? !isReadOnlyMode.value;
  if (target === isReadOnlyMode.value) return;
  isReadOnlyMode.value = target;
  console.info(`[readonly] 只读模式${target ? "开启" : "关闭"}`);
}

export default function useReadOnlyMode() {
  return { isReadOnlyMode, toggleReadOnlyMode };
}

export { isReadOnlyMode, toggleReadOnlyMode };
