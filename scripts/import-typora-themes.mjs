/**
 * Typora 官方主题导入脚本
 *
 * 将 third-party/typora-official/themes/ 下的官方主题（Typora 安装目录
 * resources/style/themes 拷贝产物，不入库）转换为 LiveMD 专属应用主题：
 *   ① adaptCss       选择器重写进 html[data-typora-theme="<name>"] 作用域
 *   ② extractPalette :root 变量 + body/a 语义声明 → 双层调色板
 *   ③ 合并存量变量主题（解析 src/themes 下各 theme.less 生成 catalog 条目）
 *
 * 产物：
 *   src/renderer/public/typora-themes/typora/ 下的转换后 CSS 与资源目录
 *   src/themes/builtin-themes.json                     # 主题统一目录（catalog）
 *   src/renderer/public/theme-bootstrap.js             # 启动引导（防闪屏）
 */
import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";

const workspace = path.resolve(import.meta.dirname, "..");
const source = process.argv[2] ?? path.join(workspace, "third-party/typora-official/themes");
const sourceRoot = fs.realpathSync(source);
const output = path.join(workspace, "src/renderer/public/typora-themes");
const actualSource = fs.existsSync(path.join(sourceRoot, "themes"))
  ? path.join(sourceRoot, "themes")
  : sourceRoot;
const family = "typora";
const outDir = path.join(output, family);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

/** App 层 21 个界面变量 */
const appKeys = [
  "primary-color",
  "secondary-color",
  "background-color",
  "background-color-1",
  "background-color-2",
  "background-color-3",
  "text-color",
  "text-color-1",
  "text-color-2",
  "text-color-3",
  "placeholder-color",
  "border-color",
  "border-color-1",
  "border-color-2",
  "hover-color",
  "hover-background-color",
  "active-color",
  "active-line-color",
  "selected-color",
  "selected-background-color",
  "primary-color-transparent",
];

/** Typora 内部类 → LiveMD 编辑器类 */
const classMap = {
  "md-fences": "livemd-code-block",
  "md-code-block": "livemd-code-block",
  "md-image": "livemd-image-block",
  "md-math-block": "math-block",
  "md-alert": "livemd-alert",
  "md-alert-text": "livemd-alert-title",
  "md-focus": "livemd-focus-current",
  "task-list-item": "task-item",
  CodeMirror: "cm-editor",
  "cm-s-inner": "cm-editor",
  "CodeMirror-lines": "cm-content",
  "CodeMirror-line": "cm-line",
  "CodeMirror-gutters": "cm-gutters",
  "CodeMirror-linenumber": "cm-lineNumbers",
  "CodeMirror-selected": "cm-selectionBackground",
  "CodeMirror-cursor": "cm-cursor",
  "CodeMirror-scroll": "cm-scroller",
  "CodeMirror-code": "cm-content",
};

/**
 * 选择器重写：所有规则进入 html[data-typora-theme="<name>"] 作用域。
 * #write → .editor-zoom-surface（内容缩放面，Typora 内容容器的语义等价物；
 * 不能映射到 .livemd-editor——它是 flex:1 的 ProseMirror 根，#write 的
 * max-width + auto margin 打在 flex item 上会吸干自由空间导致占位符竖排）。
 */
export function adaptCss(css, name) {
  const root = postcss.parse(css);
  const scope = `html[data-typora-theme="${name}"]`;
  root.walkAtRules("charset", (rule) => rule.remove());
  root.walkAtRules("include-when-export", (rule) => rule.remove());
  root.walkRules((rule) => {
    if (rule.parent.type === "atrule" && /keyframes$/i.test(rule.parent.name)) return;
    const parsed = selectorParser().astSync(rule.selector);
    const selectors = [];
    parsed.each((selector) => {
      let editor = false;
      selector.walkIds((node) => {
        if (node.value === "write") {
          node.replaceWith(selectorParser.className({ value: "editor-zoom-surface" }));
          editor = true;
        }
      });
      selector.walkClasses((node) => {
        if (classMap[node.value]) {
          node.value = classMap[node.value];
          editor = true;
        }
      });
      selector.walkAttributes((node) => {
        if (node.attribute === "md-alert") node.attribute = "data-alert-type";
      });
      selector.walkTags((node) => {
        if (node.value === "content") {
          node.remove();
          return;
        }
        if (node.value === "html" || node.value === "body")
          node.replaceWith(selectorParser.pseudo({ value: ":root" }));
      });
      let text = selector.toString().trim().replace(/^>\s*/, "");
      if (text === ":root" || text === ":root :root") text = scope;
      else if (text.startsWith(":root")) text = text.replace(/^:root(?:\s+:root)?/, scope);
      else if (editor || /[#.[\]]/.test(text) || text.startsWith("::")) text = `${scope} ${text}`;
      else text = `${scope} .livemd-editor ${text}`;
      selectors.push(text);
    });
    rule.selector = [...new Set(selectors)].join(",\n");
  });
  return root.toString();
}

function resolveVar(value, vars, depth = 0) {
  if (depth > 12) return value;
  return value.replace(/var\((--[\w-]+)(?:,\s*([^()]*))?\)/g, (match, key, fallback) =>
    vars[key] ? resolveVar(vars[key], vars, depth + 1) : fallback || match
  );
}

function relativeLuminance(color) {
  const hex = /#([0-9a-f]{3,8})/i.exec(color);
  if (hex) {
    let value = hex[1];
    if (value.length === 3 || value.length === 4)
      value = [...value].map((char) => char + char).join("");
    const r = parseInt(value.slice(0, 2), 16) / 255;
    const g = parseInt(value.slice(2, 4), 16) / 255;
    const b = parseInt(value.slice(4, 6), 16) / 255;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const rgb = /rgba?\(([^)]+)\)/i.exec(color);
  if (rgb) {
    const [r, g, b] = rgb[1].split(/[\s,/]+/).map(Number);
    if ([r, g, b].every(Number.isFinite))
      return (0.2126 * r) / 255 + (0.7152 * g) / 255 + (0.0722 * b) / 255;
  }
  return null;
}

/** 官方主题 :root 变量不全，从 :root/html/body 的 --* 变量与语义声明两段提取 */
export function extractPalette(css) {
  const root = postcss.parse(css);
  const vars = {};
  const semantic = { bg: null, text: null, accent: null };

  root.walkRules((rule) => {
    if (rule.parent !== root) return;
    const selector = rule.selector.toLowerCase();
    if (/(^|,|\s)(:root|html|body)(\s|,|$)/.test(selector)) {
      rule.walkDecls((decl) => {
        if (decl.prop.startsWith("--")) vars[decl.prop] = decl.value;
      });
    }
    const mode =
      selector === "body" ? "body" : selector === "html" ? "html" : selector === "a" ? "a" : null;
    if (mode) {
      rule.walkDecls((decl) => {
        const prop = decl.prop.toLowerCase();
        if (mode === "a" && prop === "color" && !semantic.accent) semantic.accent = decl.value;
        if ((mode === "body" || mode === "html") && prop === "color" && !semantic.text)
          semantic.text = decl.value;
        if (
          (mode === "body" || mode === "html") &&
          (prop === "background" || prop === "background-color") &&
          !semantic.bg
        )
          semantic.bg = decl.value;
      });
    }
  });

  return { vars, semantic };
}

/** stripComments: theme.less 使用 LESS 语法注释（// 与 块注释），postcss 无法直接解析 */
function stripComments(css) {
  let result = css.replace(/\/\*[\s\S]*?\*\//g, "");
  result = result.replace(/(^|[^:"'\w\\])\/\/[^\n]*/gm, "$1");
  return result;
}

function parseLegacyTheme(slug) {
  const file = path.join(workspace, "src/themes", slug, "theme.less");
  const raw = fs.readFileSync(file, "utf8");
  const css = stripComments(raw);
  const root = postcss.parse(css);
  const appVars = {};
  const milkdownVars = {};
  for (const rule of root.nodes) {
    if (rule.type !== "rule") continue;
    if (rule.selector === `html.theme-${slug}`) {
      for (const decl of rule.nodes ?? []) {
        if (decl.type === "decl" && decl.prop.startsWith("--")) appVars[decl.prop] = decl.value;
      }
      for (const nested of rule.nodes ?? []) {
        if (nested.type !== "rule" || nested.selector !== ".milkdown") continue;
        for (const decl of nested.nodes ?? []) {
          if (decl.type === "decl" && decl.prop.startsWith("--crepe"))
            milkdownVars[decl.prop] = decl.value;
        }
      }
    }
  }
  return { appVars, milkdownVars };
}

/** catalog 顺序：先存量变量主题，后 Typora 官方主题 */
const legacyOrder = [
  "normal",
  "normal-dark",
  "crepe",
  "crepe-dark",
  "frame",
  "frame-dark",
  "dracula",
  "dracula-dark",
  "one",
  "one-dark",
  "solarized",
  "solarized-dark",
];
const legacyLabels = {
  normal: { label: "亮色", description: "明亮清新的标准主题，适合日常使用" },
  "normal-dark": { label: "暗色", description: "深色风格主题，减少夜间使用时的眼睛疲劳" },
  crepe: { label: "Github白色", description: "类似GitHub风格的明亮主题，干净整洁" },
  "crepe-dark": { label: "Github暗色", description: "GitHub深色模式风格，适合夜间或弱光环境" },
  frame: { label: "护眼色", description: "纸张护眼色，适合长时间阅读" },
  "frame-dark": { label: "暖色", description: "暖色风格主题，适合长时间阅读" },
  dracula: { label: "德古拉浅色", description: "Dracula 风格浅色变体，紫青强调的明亮配色" },
  "dracula-dark": { label: "德古拉暗色", description: "Dracula 官方暗色主题，紫色强调的经典配色" },
  one: { label: "Atom亮色", description: "Atom One Light 官方亮色主题，中性清爽" },
  "one-dark": { label: "Atom暗色", description: "Atom One Dark 官方暗色主题，开发者经典" },
  solarized: {
    label: "Solarized亮色",
    description: "Solarized Light 学术亮色主题，米色底柔和护眼",
  },
  "solarized-dark": {
    label: "Solarized暗色",
    description: "Solarized Dark 学术暗色主题，深青灰底低对比",
  },
};
const typoraLabels = {
  github: "Typora GitHub",
  gothic: "Typora 哥特风",
  newsprint: "Typora 新闻纸",
  night: "Typora 夜晚",
  pixyll: "Typora Pixyll",
  whitey: "Typora 素白",
};

const catalog = [];

for (const slug of legacyOrder) {
  const dir = path.join(workspace, "src/themes", slug);
  if (!fs.existsSync(dir)) continue;
  const { appVars, milkdownVars } = parseLegacyTheme(slug);
  const dark = slug.endsWith("-dark");
  if (!appVars["--primary-color"] || !appVars["--background-color"]) {
    throw new Error(`存量主题 ${slug} 缺少 App 层必要变量`);
  }
  catalog.push({
    name: slug,
    label: legacyLabels[slug]?.label ?? slug,
    description: legacyLabels[slug]?.description ?? "",
    dark,
    data: {
      appCssProperties: appVars,
      milkdownCssProperties: milkdownVars,
      themeProperties: { ...appVars, ...milkdownVars },
    },
  });
}

const seen = new Set();
let imported = 0;
for (const file of fs
  .readdirSync(actualSource)
  .filter((entry) => entry.endsWith(".css"))
  .sort()) {
  const css = fs.readFileSync(path.join(actualSource, file), "utf8");
  const originalName = file.replace(/\.css$/, "");
  const name = originalName.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  if (seen.has(name)) {
    console.warn(`跳过重复主题：${name}`);
    continue;
  }
  seen.add(name);

  // 资源目录随主题一起拷贝（字体 / 附属暗色 CSS / 光标图）
  const assetsDir = path.join(actualSource, originalName);
  if (fs.existsSync(assetsDir) && fs.statSync(assetsDir).isDirectory()) {
    fs.cpSync(assetsDir, path.join(outDir, originalName), { recursive: true });
  }

  const { vars, semantic } = extractPalette(css);
  const get = (names, semanticValue, fallback) => {
    for (const item of names) {
      if (vars[`--${item}`]) return resolveVar(vars[`--${item}`], vars);
    }
    return semanticValue || fallback;
  };

  // 明暗判定：--bg-color 亮度优先，文件名兜底
  const bgVar = vars["--bg-color"] ?? semantic.bg;
  const bgLuminance = bgVar ? relativeLuminance(bgVar) : null;
  const darkMode = bgLuminance !== null ? bgLuminance < 0.4 : /night|-dark\b/i.test(originalName);

  const accent = get(
    ["primary-color", "accent", "a-color", "link-color"],
    semantic.accent,
    darkMode ? "#61afef" : "#0c8f94"
  );
  const bg = get(
    ["bg-color", "bg", "content-write-bg-color"],
    semantic.bg,
    darkMode ? "#282c34" : "#ffffff"
  );
  const text = get(
    ["text-color", "text", "body-text-color"],
    semantic.text,
    darkMode ? "rgba(255, 255, 255, 0.85)" : "rgba(0, 0, 0, 0.75)"
  );
  const surface = get(
    ["side-bar-bg-color", "surface", "surface-color", "blockquote-bg-color"],
    null,
    darkMode ? "#21252b" : "#f3f4f6"
  );
  const border = get(
    ["border", "border-color", "table-border-color"],
    null,
    darkMode ? "#42454a" : "#e0e0e0"
  );
  const muted = get(
    ["muted", "text-color-muted", "text-semi"],
    null,
    darkMode ? "#9ea0a8" : "#667085"
  );
  const selection = `color-mix(in srgb, ${accent}, transparent 80%)`;

  const appValues = [
    accent,
    accent,
    bg,
    surface,
    surface,
    surface,
    text,
    text,
    muted,
    muted,
    muted,
    border,
    border,
    border,
    selection,
    selection,
    selection,
    selection,
    text,
    selection,
    selection,
  ];
  const appCssProperties = Object.fromEntries(
    appKeys.map((key, index) => [`--${key}`, appValues[index]])
  );
  const milkdownCssProperties = {
    "--crepe-color-background": bg,
    "--crepe-color-on-background": text,
    "--crepe-color-surface": surface,
    "--crepe-color-surface-low": surface,
    "--crepe-color-on-surface": text,
    "--crepe-color-on-surface-variant": muted,
    "--crepe-color-outline": border,
    "--crepe-color-primary": accent,
    "--crepe-color-secondary": surface,
    "--crepe-color-on-secondary": text,
    "--crepe-color-inverse": text,
    "--crepe-color-on-inverse": bg,
    "--crepe-color-inline-code": accent,
    "--crepe-color-error": darkMode ? "#e5534b" : "#cf222e",
    "--crepe-color-hover": surface,
    "--crepe-color-selected": selection,
    "--crepe-color-inline-area": surface,
  };
  const palette = { ...appCssProperties, ...milkdownCssProperties };
  const adapted =
    adaptCss(css, name) +
    `\nhtml[data-typora-theme="${name}"] {\n${Object.entries(palette)
      .map(([key, value]) => `  ${key}: ${value};`)
      .join("\n")}\n  color-scheme: ${darkMode ? "dark" : "light"};\n}\n`;
  fs.writeFileSync(path.join(outDir, file), adapted);

  const label = typoraLabels[originalName] ?? originalName;
  catalog.push({
    name,
    label,
    description: `${label}，Typora 官方主题，保留原始排版并适配编辑器类名`,
    dark: darkMode,
    family,
    cssFile: `typora-themes/${family}/${file}`,
    data: { appCssProperties, milkdownCssProperties, themeProperties: palette },
  });
  imported += 1;
}

fs.writeFileSync(
  path.join(workspace, "src/themes/builtin-themes.json"),
  `${JSON.stringify(catalog, null, 2)}\n`
);

const bootstrapCatalog = catalog.map(({ name, cssFile, dark, data }) => ({
  name,
  ...(cssFile ? { cssFile } : {}),
  bg: data.appCssProperties["--background-color"],
  dark,
}));
fs.writeFileSync(
  path.join(workspace, "src/renderer/public/theme-bootstrap.js"),
  `/* Generated by scripts/import-typora-themes.mjs. Do not edit. */
(function () {
  var catalog = ${JSON.stringify(bootstrapCatalog)};
  var legacy = {};
  var name = ${JSON.stringify(legacyOrder[0])}, customs = [];
  try {
    name = localStorage.getItem('theme-name') || name;
    customs = JSON.parse(localStorage.getItem('custom-themes') || '[]');
  } catch (_) {}
  if (!Array.isArray(customs)) customs = [];
  name = legacy[name] || name;
  var custom = customs.find(function (t) { return t && t.name === name; });
  var baseName = (custom && custom.baseTheme) || name;
  var theme = catalog.find(function (t) { return t.name === baseName; }) || catalog[0];
  var html = document.documentElement;
  html.classList.add('theme-' + name);
  if (custom && baseName !== name) html.classList.add('theme-' + baseName);
  if (theme && theme.cssFile) html.dataset.typoraTheme = theme.name;
  var dark = custom && custom.dark !== undefined ? custom.dark : theme && theme.dark;
  html.dataset.themeMode = dark ? 'dark' : 'light';
  html.style.background =
    (custom && custom.data && custom.data.appCssProperties &&
      (custom.data.appCssProperties['--background-color'] ||
        custom.data.appCssProperties['--background-color-1'])) ||
    (theme && theme.bg) || '#ffffff';
  if (theme && theme.cssFile) {
    var link = document.createElement('link');
    link.id = 'typora-theme-css';
    link.rel = 'stylesheet';
    link.href = new URL(theme.cssFile, document.currentScript.src).href;
    document.head.appendChild(link);
  }
})();
`
);

console.log(
  `catalog 共 ${catalog.length} 个主题：存量 ${catalog.length - imported} + Typora 官方 ${imported}`
);
for (const theme of catalog.filter((item) => item.cssFile)) {
  console.log(
    `  ${theme.name}: bg=${theme.data.appCssProperties["--background-color"]} primary=${theme.data.appCssProperties["--primary-color"]}`
  );
}
