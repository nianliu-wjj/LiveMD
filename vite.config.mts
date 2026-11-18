import path from "node:path";
import { createRequire } from "node:module";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import vitePluginsAutoI18n, { EmptyTranslator, GoogleTranslator } from "vite-auto-i18n-plugin";

const require = createRequire(import.meta.url);

/**
 * 定位 decode-named-character-reference 的纯 JS 实现（index.js）。
 *
 * 该包的 browser 条件导出（index.dom.js）在模块顶层执行 `document.createElement`，
 * 被 vite 打进文档检查 Web Worker 的 chunk 后，Worker 无 DOM → 脚本加载即 ReferenceError，
 * 整个检查 worker 随之失效。强制走 Node/default 条件的 index.js（纯 JS 查表实现，语义一致）。
 * pnpm 下它不是顶层依赖，从 markdownlint 的真实目录出发解析即可命中 .pnpm 提升目录。
 */
function resolveDecodeNamedCharacterReference(): string | null {
  try {
    const markdownlintDir = path.dirname(require.resolve("markdownlint"));
    return require.resolve("decode-named-character-reference", { paths: [markdownlintDir] });
  } catch (error) {
    console.warn("[vite] 无法定位 decode-named-character-reference，跳过纯 JS 版 alias:", error);
    return null;
  }
}

const decodeNamedCharacterReferencePath = resolveDecodeNamedCharacterReference();

const alias = [
  { find: "@ui", replacement: path.resolve(__dirname, "./src/components/ui") },
  { find: "@", replacement: path.resolve(__dirname, "./src") },
  // 精确匹配包名（不影响子路径导入），主包与 worker 包共用同一 resolve 配置
  ...(decodeNamedCharacterReferencePath
    ? [
        {
          find: /^decode-named-character-reference$/,
          replacement: decodeNamedCharacterReferencePath,
        },
      ]
    : []),
];
const useGoogleTranslator = process.env.LIVEMD_ENABLE_TRANSLATE === "1";
const i18nPlugin = vitePluginsAutoI18n({
  deepScan: true,
  // 移植的思维导图引擎（含主题）不参与自动翻译：其中的中文多为 CSS 注释、默认节点文字与内部比较用的字面量，
  // 改写成 $t() 既无翻译价值，又会把这些字符串写进打包进首屏的翻译字典
  excludedPath: ["node_modules", "mindmap-engine"],
  globalPath: "./lang",
  namespace: "lang",
  distPath: "./dist/assets",
  distKey: "index",
  targetLangList: ["ja", "ko", "ru", "en", "fr"],
  originLang: "zh-cn",
  translator: useGoogleTranslator
    ? new GoogleTranslator({
        proxyOption: {
          port: 7890,
          host: "127.0.0.1",
          headers: {
            "User-Agent": "Node",
          },
        },
      })
    : new EmptyTranslator(),
});

export default defineConfig({
  plugins: [vue(), i18nPlugin],
  // 文档检查 Web Worker 以 ES 模块格式打包（lintWorkerClient 使用 type: "module"）
  worker: {
    format: "es",
  },
  server: {
    open: false,
  },
  // 按需加载的依赖预先纳入依赖预构建，避免开发服务器运行中首次遇到这些依赖时重新优化，
  // 导致已打开页面里的按需 import 失效（504 Outdated Optimize Dep，Safari/WebKit 下表现为
  // "Importing a module script failed"，点击无反应或渲染报错）：
  // - 思维导图引擎依赖只在打开思维导图时加载
  // - mermaid 只在代码块渲染 Mermaid 图时动态 import；其依赖树庞大（dagre/cytoscape/elkjs 等），
  //   运行中冷发现会连续触发多轮重新优化，必须启动时一次预构建完成
  optimizeDeps: {
    // 只扫描应用自身的 HTML 入口。默认的 **/*.html 会把 harmony/entry 下由
    // build-harmony 复制的离线包（rawfile/www）也纳入依赖扫描，其中的大体积
    // 构建产物会让扫描反复重启，最终导致 dev server 无法就绪（冒烟脚本超时）。
    entries: ["index.html", "theme-editor.html", "image-preview.html", "debug-dom.html"],
    include: [
      // 语言包预构建，避免首次动态加载触发重新优化并使旧模块 URL 失效。
      "@codemirror/lang-javascript",
      "@codemirror/lang-python",
      "@codemirror/lang-html",
      "@codemirror/lang-css",
      "@codemirror/lang-json",
      "@codemirror/lang-markdown",
      "@codemirror/lang-go",
      "@codemirror/lang-java",
      "@codemirror/lang-cpp",
      "@codemirror/lang-php",
      "@codemirror/lang-rust",
      "@codemirror/lang-sql",
      "@codemirror/lang-xml",
      "@codemirror/lang-yaml",
      "@svgdotjs/svg.js",
      "deepmerge",
      "eventemitter3",
      "uuid",
      "quill",
      "quill-delta",
      "parchment",
      "jszip",
      "xml-js",
      "pdf-lib",
      "mdast-util-from-markdown",
      "katex",
      "mermaid",
    ],
  },
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        "theme-editor": path.resolve(__dirname, "theme-editor.html"),
        "image-preview": path.resolve(__dirname, "image-preview.html"),
      },
    },
  },
  resolve: {
    alias,
  },
});
