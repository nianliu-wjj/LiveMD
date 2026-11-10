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
  { find: "@renderer", replacement: path.resolve(__dirname, "./src/renderer") },
  { find: "@ui", replacement: path.resolve(__dirname, "./src/renderer/components/ui") },
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
  // 思维导图引擎的依赖只在打开思维导图时按需加载：预先纳入依赖预构建，避免开发服务器运行中首次遇到
  // 这些依赖时重新优化，导致已打开页面里的按需 import 失效（504 Outdated Optimize Dep，表现为点击无反应）
  optimizeDeps: {
    include: [
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
    ],
  },
  root: "src/renderer",
  base: "./",
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "src/renderer/index.html"),
        "theme-editor": path.resolve(__dirname, "src/renderer/theme-editor.html"),
        "image-preview": path.resolve(__dirname, "src/renderer/image-preview.html"),
      },
    },
  },
  resolve: {
    alias,
  },
});
