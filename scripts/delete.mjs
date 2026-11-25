import { lstatSync, realpathSync, rmSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRoot = fileURLToPath(new URL("..", import.meta.url));

// Only disposable project outputs and caches; keep dependencies and native sources.
const cleanupPaths = [
  "dist",
  "dist-electron",
  "out",
  "build",
  "target",
  "src-tauri/target",
  ".vite",
  ".cache",
  ".hvigor",
  ".eslintcache",
  ".stylelintcache",
  "coverage",
  "node_modules/.vite",
  "node_modules/.vite-temp",
  "node_modules/.cache",
  "android/.gradle",
  "android/.kotlin",
  "android/.cxx",
  "android/.externalNativeBuild",
  "android/build",
  "android/app/build",
  "android/app/.cxx",
  "android/app/.externalNativeBuild",
  "android/buildSrc/build",
  "android/buildSrc/.gradle",
  "android/buildSrc/.kotlin",
  "harmony/build",
  "harmony/entry/build",
  "harmony/.hvigor",
  "harmony/entry/src/main/resources/rawfile/www",
];

function existingTarget(root, name) {
  const target = resolve(root, name);
  const difference = relative(root, target);
  if (
    !difference ||
    isAbsolute(difference) ||
    difference === ".." ||
    difference.startsWith(`..${sep}`)
  ) {
    throw new Error(`清理路径超出项目目录：${target}`);
  }

  // Check every component so a directory junction cannot redirect deletion.
  let current = root;
  for (const component of difference.split(sep)) {
    current = join(current, component);
    try {
      if (lstatSync(current).isSymbolicLink()) {
        throw new Error(`拒绝清理符号链接或目录联接：${current}`);
      }
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }
  return target;
}

export function cleanBuildArtifacts(
  projectRoot = defaultRoot,
  { dryRun = false, log = console.log } = {}
) {
  const root = realpathSync(resolve(projectRoot));
  // Validate the entire list before deleting anything.
  const targets = cleanupPaths.flatMap((name) => {
    const target = existingTarget(root, name);
    return target ? [{ name, target }] : [];
  });

  for (const { name, target } of targets) {
    if (!dryRun) rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    log(`${dryRun ? "将删除" : "已删除"} ${name}`);
  }
  log(dryRun ? `预览完成，共 ${targets.length} 项。` : `清理完成，共删除 ${targets.length} 项。`);
  return targets.map(({ name }) => name);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--dry-run")) {
    console.error("用法：pnpm delete [--dry-run]");
    process.exitCode = 1;
  } else {
    try {
      cleanBuildArtifacts(defaultRoot, { dryRun: args.includes("--dry-run") });
    } catch (error) {
      console.error(`清理失败：${error.message}`);
      process.exitCode = 1;
    }
  }
}
