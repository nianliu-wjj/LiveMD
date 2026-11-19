import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = createRequire(require.resolve("vite"))("esbuild");
test("移动默认只读，可显式解除；桌面默认允许编辑", async () => {
  const directory = mkdtempSync(join(root, ".git", "readonly-test-"));
  try {
    for (const mobile of [true, false]) {
      globalThis.window = { electronAPI: { isMobile: mobile } };
      const output = join(directory, `mode-${mobile}.mjs`);
      esbuild.buildSync({
        entryPoints: [join(root, "src/hooks/useReadOnlyMode.ts")],
        bundle: true,
        packages: "external",
        platform: "node",
        format: "esm",
        outfile: output,
      });
      const { isReadOnlyMode, toggleReadOnlyMode } = await import(pathToFileURL(output).href);
      assert.equal(isReadOnlyMode.value, mobile);
      toggleReadOnlyMode(false);
      assert.equal(isReadOnlyMode.value, false);
      toggleReadOnlyMode(true);
      assert.equal(isReadOnlyMode.value, true);
    }
  } finally {
    delete globalThis.window;
    rmSync(directory, { recursive: true, force: true });
  }
});
