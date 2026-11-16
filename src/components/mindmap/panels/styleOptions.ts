/**
 * 节点样式（Style.vue）/ 基础样式（BaseStyle.vue）面板共用的选项工具
 *
 * 参考项目直接把 config 里的数组交给 el-select，el-select 在当前值不在选项里时仍会显示原始值；
 * 这里换成原生 <select> / StyleOptionSelect 后需要自己保证「当前值可回显」：
 * - numberOptions / namedOptions：把配置数组（数字、{ name, value }）统一成 { value, label }；
 * - ensureOption：主题或旧数据使用了列表外的值（如字号 15）时追加一项，避免下拉框显示空白；
 * - linePaths：从连线风格示意 SVG 字符串里提取 path，模板直接渲染 <path>，无需 v-html。
 */

/** 下拉选项（value 可为字符串 / 数字 / 布尔，其余字段供预览插槽使用） */
export interface StyleSelectOption {
  value: any;
  label: string;
  [key: string]: any;
}

/** 数字数组 → 选项（字号、线宽、圆角等） */
export function numberOptions(list: readonly number[]): StyleSelectOption[] {
  return list.map((value) => ({ value, label: String(value) }));
}

/** { name, value } 数组 → 选项（保留原有字段，如渐变方向的 start / end） */
export function namedOptions(
  list: ReadonlyArray<{ name: string; value: unknown; [key: string]: unknown }>
): StyleSelectOption[] {
  return list.map((item) => ({ ...item, label: item.name }));
}

/** 当前值不在选项中时追加一项（空值不追加，保持与参考项目一致的空白显示） */
export function ensureOption(options: StyleSelectOption[], value: unknown): StyleSelectOption[] {
  if (value === undefined || value === null || value === "") return options;
  if (options.some((option) => option.value === value)) return options;
  return [...options, { value, label: String(value) }];
}

/** 提取 SVG 字符串中所有 path 的 d 属性（连线风格示意图） */
export function linePaths(svg: string): string[] {
  return Array.from(svg.matchAll(/\sd="([^"]+)"/g), (match) => match[1]);
}
