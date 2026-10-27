/**
 * 由品牌母版 SVG 生成 Tauri 打包所需的全部图标（src-tauri/icons）
 *
 * 母版：src-tauri/icons/app-icon.svg（渐变绿 squircle 环 + 纸色字母 L）
 * 产物：
 *   - PNG：32x32 / 64x64 / 128x128 / 128x128@2x / icon.png(512) / Square*Logo / StoreLogo
 *   - icon.ico：256 → 16 共 7 帧，256 帧在首位（exe 资源图标，窗口 / 任务栏从它取帧）
 *   - icon.icns：macOS 16 → 1024 七档
 * 用法：pnpm generate-tauri-icons（改完母版后需重新编译 Tauri，exe 资源图标在构建期嵌入）
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ICNS_ENTRIES,
  ICO_SIZES,
  packIcns,
  packIco,
  prepareSvg,
  renderPngSet,
} from "./icon-utils.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const masterSvg = join(root, "src-tauri", "icons", "app-icon.svg");
const outDir = join(root, "src-tauri", "icons");

/** tauri.conf.json bundle.icon 与 Windows 磁贴消费的 PNG：文件名 → 边长 */
const PNG_TARGETS = [
  ["32x32.png", 32],
  ["64x64.png", 64],
  ["128x128.png", 128],
  ["128x128@2x.png", 256],
  ["icon.png", 512],
  ["Square30x30Logo.png", 30],
  ["Square44x44Logo.png", 44],
  ["Square71x71Logo.png", 71],
  ["Square89x89Logo.png", 89],
  ["Square107x107Logo.png", 107],
  ["Square142x142Logo.png", 142],
  ["Square150x150Logo.png", 150],
  ["Square284x284Logo.png", 284],
  ["Square310x310Logo.png", 310],
  ["StoreLogo.png", 50],
];

async function main() {
  console.log(`\x1b[36m[tauri-icons] 母版: ${masterSvg}\x1b[0m`);
  const svgBuffer = prepareSvg(masterSvg);

  // 所有需要的尺寸去重后一次性渲染
  const sizes = [
    ...new Set([
      ...PNG_TARGETS.map(([, size]) => size),
      ...ICO_SIZES,
      ...ICNS_ENTRIES.map((entry) => entry.size),
    ]),
  ].sort((a, b) => a - b);
  const pngMap = await renderPngSet(svgBuffer, sizes);
  console.log(`  已渲染 ${sizes.length} 个尺寸: ${sizes.join(", ")}`);

  for (const [name, size] of PNG_TARGETS) {
    writeFileSync(join(outDir, name), pngMap[size]);
    console.log(`  PNG ${name} (${size}px) ✓`);
  }

  writeFileSync(
    join(outDir, "icon.ico"),
    packIco(ICO_SIZES.map((size) => ({ size, png: pngMap[size] })))
  );
  console.log(`  \x1b[32mICO icon.ico ✓\x1b[0m 帧序: ${ICO_SIZES.join(" > ")}`);

  writeFileSync(
    join(outDir, "icon.icns"),
    packIcns(ICNS_ENTRIES.map((entry) => ({ type: entry.type, png: pngMap[entry.size] })))
  );
  console.log(
    `  \x1b[32mICNS icon.icns ✓\x1b[0m (${ICNS_ENTRIES.map((entry) => entry.size).join(", ")})`
  );

  console.log("\x1b[32m[tauri-icons] 完成\x1b[0m");
}

main().catch((err) => {
  console.error("\x1b[31m[tauri-icons] 失败:\x1b[0m", err);
  process.exit(1);
});
