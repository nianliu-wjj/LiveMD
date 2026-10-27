/**
 * 从 SVG 生成多尺寸 ICO 和 ICNS 图标（src/assets/icons）
 * - livemd.ico / livemd.icns：应用图标，母版 src-tauri/icons/app-icon.svg（与 Tauri 打包图标同源）
 * - file.ico / file.icns：Markdown 文件关联图标，源 src/renderer/public/file-icon.svg
 * 用法: pnpm generate-icons
 */

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
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
const ROOT = join(__dirname, "..");

// 图标配置
const ICONS = [
  {
    // LiveMD 品牌图标（渐变绿 squircle 环 + 纸色字母 L）
    svg: join(ROOT, "src-tauri/icons/app-icon.svg"),
    output: join(ROOT, "src/assets/icons/livemd"),
  },
  {
    // Markdown 文件关联图标（文档 + 底部 md 色带 + LiveMD L 角标）
    svg: join(ROOT, "src/renderer/public/file-icon.svg"),
    output: join(ROOT, "src/assets/icons/file"),
  },
];

async function main() {
  for (const icon of ICONS) {
    console.log(`\x1b[36m生成图标: ${icon.output}\x1b[0m`);

    const svgBuffer = prepareSvg(icon.svg, icon.viewBox);

    // 收集所有需要的尺寸（去重）后并行渲染
    const allSizes = [...new Set([...ICO_SIZES, ...ICNS_ENTRIES.map((entry) => entry.size)])].sort(
      (a, b) => a - b
    );
    const pngMap = await renderPngSet(svgBuffer, allSizes);
    console.log(`  PNG ${allSizes.join("/")} ✓`);

    // 打包 ICO（大帧在前）
    writeFileSync(
      `${icon.output}.ico`,
      packIco(ICO_SIZES.map((size) => ({ size, png: pngMap[size] })))
    );
    console.log(`  \x1b[32mICO ✓\x1b[0m (${ICO_SIZES.join(", ")})`);

    // 打包 ICNS
    writeFileSync(
      `${icon.output}.icns`,
      packIcns(ICNS_ENTRIES.map((entry) => ({ type: entry.type, png: pngMap[entry.size] })))
    );
    console.log(`  \x1b[32mICNS ✓\x1b[0m (${ICNS_ENTRIES.map((entry) => entry.size).join(", ")})`);
  }

  console.log(`\n\x1b[32m图标生成完成\x1b[0m`);
}

main().catch((err) => {
  console.error("\x1b[31m图标生成失败:\x1b[0m", err);
  process.exit(1);
});
