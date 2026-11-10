/**
 * 当前打开的 MmDialog 栈（按打开顺序，末尾为最上层）
 *
 * 所有 MmDialog 实例共享：焦点掉回 body 时的按键兜底只交给最上层弹窗处理，
 * 避免叠加弹窗（如导入 + XMind 画布选择）时一次 Esc 关掉多个。
 */
export const openDialogStack: symbol[] = [];
