/**
 * 节点内容弹窗的按键守卫（NodeImage / NodeHyperlink / NodeIcon / NodeNote / NodeTag 共用）
 *
 * 焦点掉回 body 时穿透到引擎的按键（KeyCommand 快捷键、enableAutoEnterTextEditWhenKeydown 的自动进入
 * 文本编辑）由 MmDialog 统一在 window 捕获阶段拦截（见 ui/MmDialog.vue 文件头），这里只补两件事：
 * 1. 派发 startTextEdit / endTextEdit，暂停 / 恢复引擎快捷键表（参考项目 NodeNote / NodeTag 的做法，
 *    这里推广到全部节点内容弹窗）；
 * 2. 可选 initialFocus：打开时优先聚焦指定控件（MmDialog 默认聚焦第一个输入控件，子组件已聚焦时它不再处理）。
 *
 * 注：默认的「鼠标在画布内才响应快捷键」检查，会因上游 KeyCommand.recoveryCheckInSvg 把标志设反，
 * 在编辑过一次节点文字后失效，所以不能指望它挡住弹窗打开期间的按键。
 */
import { nextTick, onBeforeUnmount, watch, type Ref } from "vue";
import { useMindMapContext } from "../context";

export interface NodeDialogGuardOptions {
  /** 打开时优先聚焦的控件；不传则由 MmDialog 聚焦第一个输入控件 */
  initialFocus?: () => HTMLElement | null | undefined;
}

/**
 * 弹窗按键守卫（在组件 setup 中调用）
 * @param visible 弹窗显示状态（即传给 MmDialog 的 v-model）
 */
export function useNodeDialogGuard(
  visible: Ref<boolean>,
  options: NodeDialogGuardOptions = {}
): void {
  const { bus } = useMindMapContext();

  function activate(): void {
    bus.emit("startTextEdit");
    // 等弹窗内容渲染后聚焦；早于 MmDialog 的默认聚焦执行，MmDialog 发现焦点已在弹窗内就不再处理
    if (options.initialFocus) {
      void nextTick(() => {
        if (visible.value) options.initialFocus?.()?.focus();
      });
    }
  }

  function deactivate(): void {
    bus.emit("endTextEdit");
  }

  watch(visible, (value, oldValue) => {
    if (value && !oldValue) activate();
    else if (!value && oldValue) deactivate();
  });

  // 弹窗打开时组件被卸载：恢复引擎快捷键
  onBeforeUnmount(() => {
    if (visible.value) deactivate();
  });
}
