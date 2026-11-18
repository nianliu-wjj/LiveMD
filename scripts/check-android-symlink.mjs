import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
if (process.platform === "win32") {
  const directory = mkdtempSync(join(tmpdir(), "livemd-symlink-"));
  try {
    const source = join(directory, "source");
    writeFileSync(source, "test");
    symlinkSync(source, join(directory, "link"), "file");
  } catch (error) {
    console.error(
      "Android 打包需要创建文件符号链接。请在 Windows 设置 → 系统 → 开发者选项中启用开发者模式，或使用管理员终端重新执行打包。",
      error.message
    );
    process.exitCode = 1;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
