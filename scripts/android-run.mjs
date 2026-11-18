import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, symlinkSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const elevated = args[0] === "--elevated";
if (elevated) args.shift();
if (!["build", "dev"].includes(args[0])) {
  console.error("用法：node scripts/android-run.mjs build [--apk] 或 dev");
  process.exit(1);
}

function canSymlink() {
  const directory = mkdtempSync(join(tmpdir(), "livemd-symlink-"));
  try {
    const source = join(directory, "source");
    writeFileSync(source, "test");
    symlinkSync(source, join(directory, "link"), "file");
    return true;
  } catch (error) {
    if (!["EPERM", "EACCES"].includes(error.code)) throw error;
    return false;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function run(script, scriptArgs = []) {
  const result = spawnSync(process.execPath, [script, ...scriptArgs], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.platform === "win32" && !canSymlink()) {
  if (elevated) {
    console.error("管理员进程仍不能创建符号链接，请检查 Windows 安全策略。");
    process.exit(1);
  }
  console.log("Android 构建需要符号链接权限，即将弹出 Windows 管理员确认窗口。");
  const directory = mkdtempSync(join(tmpdir(), "livemd-admin-"));
  try {
    // 使用 JSON 传输参数与环境，不将用户参数拼接到 PowerShell 命令中。
    const request = join(directory, "request.json");
    const resultPath = join(directory, "result.json");
    writeFileSync(
      request,
      JSON.stringify({
        node: process.execPath,
        root,
        args,
        environment: Object.fromEntries(
          Object.entries(process.env).filter(([name]) =>
            /^(JAVA_HOME|ANDROID_HOME|ANDROID_SDK_ROOT|NDK_HOME|ANDROID_NDK_HOME|CARGO_HOME|RUSTUP_HOME|PATH|HTTP_PROXY|HTTPS_PROXY|NO_PROXY)$/i.test(
              name
            )
          )
        ),
      })
    );
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        join(root, "scripts/android-elevate.ps1"),
        "-RequestPath",
        request,
        "-ResultPath",
        resultPath,
      ],
      { cwd: root, stdio: "inherit" }
    );
    if (result.error) throw result.error;
    const logPath = resultPath + ".log";
    try {
      const savedLog = join(tmpdir(), "livemd-android-build.log");
      writeFileSync(savedLog, readFileSync(logPath));
      console.log(`完整构建日志：${savedLog}`);
    } catch {
      /* UAC cancellation may produce no build log. */
    }
    process.exitCode =
      result.status === 0
        ? JSON.parse(readFileSync(resultPath, "utf8")).exitCode
        : (result.status ?? 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
} else {
  const iconsStatus = run(join(root, "scripts/generate-mobile-icons.mjs"));
  process.exitCode =
    iconsStatus || run(join(root, "node_modules/@tauri-apps/cli/tauri.js"), ["android", ...args]);
}
