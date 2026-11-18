/**
 * 鸿蒙壳的 web 产物同步：build:web → dist 复制到 ArkTS 工程的 rawfile/www
 *
 * 用法：node scripts/build-harmony.mjs
 * 之后在 DevEco Studio 打开 harmony/ 构建 HAP（或 hvigorw assembleHap）。
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));

const dist = join(root, "dist");
const stamp = join(root, "harmony", ".hvigor", "livemd-web.sha256");
function fingerprint() {
  const hash = createHash("sha256");
  const visit = (relative) => {
    const absolute = join(root, relative);
    if (!existsSync(absolute)) return;
    for (const item of readdirSync(absolute, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      const child = join(relative, item.name);
      if (item.isDirectory()) visit(child);
      else {
        hash.update(child);
        hash.update(readFileSync(join(root, child)));
      }
    }
  };
  for (const directory of ["src", "public", "lang"]) visit(directory);
  for (const file of [
    "package.json",
    "pnpm-lock.yaml",
    "vite.config.mts",
    "index.html",
    "theme-editor.html",
    "image-preview.html",
  ]) {
    hash.update(readFileSync(join(root, file)));
  }
  return hash.digest("hex");
}
if (
  process.argv.includes("--prepare") &&
  (!existsSync(dist) || !existsSync(stamp) || readFileSync(stamp, "utf8") !== fingerprint())
) {
  execFileSync(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "build"], {
    cwd: root,
    stdio: "inherit",
  });
}
if (!existsSync(dist)) {
  console.error("dist/ 不存在，请先执行 pnpm build:web");
  process.exit(1);
}

const dest = join(root, "harmony", "entry", "src", "main", "resources", "rawfile", "www");
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(dist, dest, { recursive: true });

mkdirSync(join(root, "harmony", ".hvigor"), { recursive: true });
writeFileSync(stamp, fingerprint());

console.log(`已同步 web 构建产物 → ${dest}`);
console.log("下一步：DevEco Studio 打开 harmony/ 目录构建 HAP（详见 harmony/README.md）");
