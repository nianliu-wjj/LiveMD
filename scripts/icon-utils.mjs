/**
 * 图标生成公共工具：SVG 预处理、sharp 渲染、ICO / ICNS 打包
 *
 * 被 generate-icons.mjs（安装包 / 文件关联图标）与 generate-tauri-icons.mjs（Tauri 打包图标）共用。
 * 唯一的品牌母版是 src-tauri/icons/app-icon.svg，所有位图都由它派生，禁止手工维护位图。
 */

import { readFileSync } from "node:fs";
import sharp from "sharp";

/**
 * ICO 帧尺寸，**大帧在前**。
 * Windows 自身按请求尺寸择优取帧，不依赖顺序；但部分读取方（图标预览器、旧版打包工具）
 * 会直接取首帧，首帧若是 16px 就会被放大显示而发糊，因此固定把 256px 放在第一位。
 */
export const ICO_SIZES = [256, 128, 64, 48, 32, 24, 16];

/** ICNS 条目类型映射（全部为 PNG 载荷的现代类型，macOS 10.7+ 识别） */
export const ICNS_ENTRIES = [
  { size: 16, type: "icp4" },
  { size: 32, type: "icp5" },
  { size: 64, type: "icp6" },
  { size: 128, type: "ic07" },
  { size: 256, type: "ic08" },
  { size: 512, type: "ic09" },
  { size: 1024, type: "ic10" },
];

/**
 * 读取 SVG 并预处理：
 * - 去掉投影滤镜（位图图标不需要，小尺寸下只会发糊）；
 * - 保留 <defs> 内的渐变 / clipPath（母版的渐变绿依赖它们，不能整段删除 defs）；
 * - 可选替换 viewBox 以裁剪留白。
 */
export function prepareSvg(svgPath, viewBox) {
  let svg = readFileSync(svgPath, "utf-8");
  svg = svg.replace(/<filter\b[\s\S]*?<\/filter>/g, "");
  svg = svg.replace(/\s*filter="[^"]*"/g, "");
  if (viewBox) {
    svg = svg.replace(/viewBox="[^"]*"/, `viewBox="${viewBox}"`);
  }
  return Buffer.from(svg);
}

/** 用 sharp 把 SVG 渲染为指定边长的透明底 PNG */
export async function renderPng(svgBuffer, size) {
  return sharp(svgBuffer, { density: 300 })
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

/** 并行渲染一组尺寸，返回 { [size]: pngBuffer } */
export async function renderPngSet(svgBuffer, sizes) {
  const pngMap = {};
  await Promise.all(
    sizes.map(async (size) => {
      pngMap[size] = await renderPng(svgBuffer, size);
    })
  );
  return pngMap;
}

/**
 * 将多个 PNG 按给定顺序打包为 ICO（PNG 压缩帧，Vista+ 支持）
 * @param {{ size: number, png: Buffer }[]} frames 帧列表，顺序即文件内顺序
 */
export function packIco(frames) {
  const count = frames.length;

  // ICO 头部: 6 字节
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = ICO
  header.writeUInt16LE(count, 4); // image count

  // 目录条目: 每个 16 字节
  const dirEntries = Buffer.alloc(count * 16);
  let dataOffset = 6 + count * 16;

  for (let i = 0; i < count; i++) {
    const { png, size } = frames[i];
    const offset = i * 16;

    dirEntries.writeUInt8(size >= 256 ? 0 : size, offset); // width (0 = 256)
    dirEntries.writeUInt8(size >= 256 ? 0 : size, offset + 1); // height
    dirEntries.writeUInt8(0, offset + 2); // color palette
    dirEntries.writeUInt8(0, offset + 3); // reserved
    dirEntries.writeUInt16LE(1, offset + 4); // color planes
    dirEntries.writeUInt16LE(32, offset + 6); // bits per pixel
    dirEntries.writeUInt32LE(png.length, offset + 8); // data size
    dirEntries.writeUInt32LE(dataOffset, offset + 12); // data offset

    dataOffset += png.length;
  }

  return Buffer.concat([header, dirEntries, ...frames.map((frame) => frame.png)]);
}

/**
 * 将多个 PNG 打包为 ICNS
 * @param {{ type: string, png: Buffer }[]} entries 条目列表（type 为 4 字节 OSType）
 */
export function packIcns(entries) {
  // 'icns' magic(4) + 文件总长(4) + 每条目 type(4) + len(4) + data
  let totalSize = 8;
  for (const entry of entries) {
    totalSize += 8 + entry.png.length;
  }

  const buf = Buffer.alloc(totalSize);
  let offset = 0;

  buf.write("icns", offset);
  offset += 4;
  buf.writeUInt32BE(totalSize, offset);
  offset += 4;

  for (const entry of entries) {
    buf.write(entry.type, offset);
    offset += 4;
    buf.writeUInt32BE(8 + entry.png.length, offset);
    offset += 4;
    entry.png.copy(buf, offset);
    offset += entry.png.length;
  }

  return buf;
}
