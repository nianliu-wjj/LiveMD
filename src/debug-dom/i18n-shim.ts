/**
 * i18n 全局直通 shim：调试/冒烟页不经主应用的 lang bootstrap，
 * 而 vite-auto-i18n（deepScan 模式）会把模块链中任何含中文的字符串字面量
 * 替换为 $t("key") / $deepScan("key") 运行时调用——缺这组全局时模块装载当场炸掉。
 *
 * ⚠️ 必须保持为 main.ts 的第一个 import：ESM 的 import 提升按声明顺序求值，
 * 编辑器链（内含中文字面量模块）先于一切函数体执行，函数内兜底来不及。
 * 冒烟只断言机制不校验文案，直通回译（原样返回 key 对应原文）即可。
 */
(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  if (typeof g.$t !== "function") g.$t = (text: string) => text;
  if (typeof g.$deepScan !== "function") g.$deepScan = (text: string) => text;
})();

export {};
