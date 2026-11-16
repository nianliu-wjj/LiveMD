export type ThemeName = string;

export interface Theme {
  name: ThemeName;
  label: string;
  description: string;
  isCustom?: boolean;
  /** 明暗模式；自定义主题未声明时沿用 baseTheme 的取值 */
  dark?: boolean;
  /** Typora 官方主题所属家族 */
  family?: string;
  /** 转换后主题 CSS 的 URL（相对 renderer public 根）；存量变量主题为空 */
  cssFile?: string;
  /** 自定义主题引用的内置主题 */
  baseTheme?: string;
  data: {
    // Record 值放宽为 string | undefined：内置主题 JSON 数组字面量在各主题对象上有
    // 形状差异（部分缺可选键），TS 联合推断把这些键推成 "?: undefined"（§7.6 存量修复，
    // JSON 文件本身不可能含 undefined，纯类型层问题）
    themeProperties?: Record<string, string | undefined>;
    appCssProperties: Record<string, string | undefined>;
    appCssPropertiesArray?: string[];
    milkdownCssProperties: Record<string, string | undefined>;
    milkdownCssPropertiesArray?: string[];
  };
}

// 检查对象是否为Theme类型
export function isThemeObject(value: unknown): value is Theme {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const theme = value as Partial<Theme>;
  const validProperties = (properties: unknown) =>
    Boolean(
      properties &&
      typeof properties === "object" &&
      !Array.isArray(properties) &&
      Object.entries(properties).every(
        ([key, val]) => key.startsWith("--") && typeof val === "string"
      )
    );
  return (
    typeof theme.name === "string" &&
    /^[a-zA-Z0-9_-]+$/.test(theme.name) &&
    typeof theme.label === "string" &&
    typeof theme.description === "string" &&
    Boolean(theme.data) &&
    validProperties(theme.data?.themeProperties) &&
    validProperties(theme.data?.appCssProperties) &&
    validProperties(theme.data?.milkdownCssProperties)
  );
}
