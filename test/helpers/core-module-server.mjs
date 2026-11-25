import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");

/** 核心单测只需加载 TS；避免启动 Vite 的扫描、监听和 SSR 消息通道。 */
export async function createServer({ root, testModules }) {
  const testRoot = path.resolve(root, "test");
  const outdir = mkdtempSync(path.join(testRoot, ".core-modules-"));
  const entries = Object.fromEntries(
    testModules.map((entry, index) => [`module-${index}`, path.join(root, entry.slice(1))])
  );
  try {
    await build({
      entryPoints: entries,
      bundle: true,
      splitting: true,
      format: "esm",
      platform: "node",
      packages: "external",
      outdir,
      outExtension: { ".js": ".mjs" },
      loader: { ".css": "empty" },
      plugins: [
        {
          name: "empty-css",
          setup(build) {
            build.onResolve({ filter: /\.css$/ }, (args) => ({
              path: args.path,
              namespace: "empty-css",
            }));
            build.onLoad({ filter: /.*/, namespace: "empty-css" }, () => ({
              contents: "export default {};",
              loader: "js",
            }));
          },
        },
      ],
      define: { "import.meta.env": '{"DEV":true,"PROD":false,"MODE":"test"}' },
    });
  } catch (error) {
    rmSync(outdir, { recursive: true, force: true });
    throw error;
  }
  return {
    ssrLoadModule(entry) {
      const index = testModules.indexOf(entry);
      if (index < 0) throw new Error(`未声明的测试模块: ${entry}`);
      return import(pathToFileURL(path.join(outdir, `module-${index}.mjs`)));
    },
    async close() {
      if (path.dirname(outdir) !== testRoot || !path.basename(outdir).startsWith(".core-modules-"))
        throw new Error("测试目录无效");
      rmSync(outdir, { recursive: true, force: true });
    },
  };
}
