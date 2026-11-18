import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = join(root, "src-tauri/icons/app-icon.svg");
const android = join(root, "src-tauri/gen/android/app/src/main/res");
for (const [density, size] of [
  ["mdpi", 48],
  ["hdpi", 72],
  ["xhdpi", 96],
  ["xxhdpi", 144],
  ["xxxhdpi", 192],
]) {
  const directory = join(android, `mipmap-${density}`);
  if (!existsSync(android)) break;
  mkdirSync(directory, { recursive: true });
  const icon = await sharp(source).resize(size, size).png().toBuffer();
  for (const name of ["ic_launcher.png", "ic_launcher_round.png"]) {
    await sharp(icon).toFile(join(directory, name));
  }
  const foregroundSize = Math.round((size * 108) / 48);
  const artworkSize = Math.round(foregroundSize * 0.6);
  const artwork = await sharp(source).resize(artworkSize, artworkSize).png().toBuffer();
  await sharp({
    create: { width: foregroundSize, height: foregroundSize, channels: 4, background: "#faf8ef" },
  })
    .composite([{ input: artwork, gravity: "centre" }])
    .png()
    .toFile(join(directory, "ic_launcher_foreground.png"));
}
// 移除模板 XML 前景，避免资源解析优先使用 Tauri 默认图案。
if (existsSync(android)) {
  rmSync(join(android, "drawable-v24/ic_launcher_foreground.xml"), { force: true });
}
const harmonyIcon = await sharp(source).resize(512, 512).png().toBuffer();
for (const relative of [
  "harmony/AppScope/resources/base/media",
  "harmony/entry/src/main/resources/base/media",
]) {
  const directory = join(root, relative);
  mkdirSync(directory, { recursive: true });
  await sharp(harmonyIcon).toFile(join(directory, "app_icon.png"));
}
console.log("已更新 Android 启动图标与 HarmonyOS 应用、Ability 图标");
