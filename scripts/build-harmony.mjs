/**
 * 鸿蒙壳的 web 产物同步：build:web → dist 复制到 ArkTS 工程的 rawfile/www
 *
 * 用法：node scripts/build-harmony.mjs
 * 之后在 DevEco Studio 打开 harmony/ 构建 HAP（或 hvigorw assembleHap）。
 */

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");

const dist = join(root, "dist");
if (!existsSync(dist)) {
  console.error("dist/ 不存在，请先执行 pnpm build:web");
  process.exit(1);
}

const dest = join(root, "harmony", "entry", "src", "main", "resources", "rawfile", "www");
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(dist, dest, { recursive: true });

console.log(`已同步 web 构建产物 → ${dest}`);
console.log("下一步：DevEco Studio 打开 harmony/ 目录构建 HAP（详见 harmony/README.md）");
