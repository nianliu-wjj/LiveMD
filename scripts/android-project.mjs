import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRoot = fileURLToPath(new URL("..", import.meta.url));

function statOrNull(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function samePath(first, second) {
  return process.platform === "win32"
    ? first.toLowerCase() === second.toLowerCase()
    : first === second;
}

function assertInside(root, path) {
  const difference = relative(root, path);
  if (
    isAbsolute(difference) ||
    difference === ".." ||
    difference.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  ) {
    throw new Error(`Android 工程路径超出工作区：${path}`);
  }
}

function assertParentInside(root, path) {
  let ancestor = dirname(path);
  while (!statOrNull(ancestor)) ancestor = dirname(ancestor);
  assertInside(root, realpathSync(ancestor));
}

export function getAndroidProjectPaths(projectRoot = defaultRoot) {
  const root = realpathSync(resolve(projectRoot));
  return {
    root,
    android: join(root, "android"),
    legacy: join(root, "src-tauri", "gen", "android"),
    backend: join(root, "src-tauri"),
  };
}

/** Update only the known Tauri template paths when adopting an old scaffold. */
export function adaptAndroidProject(projectRoot = defaultRoot) {
  const { android } = getAndroidProjectPaths(projectRoot);
  const update = (path, transform) => {
    const stat = statOrNull(path);
    if (!stat?.isFile() || stat.isSymbolicLink()) return;
    assertInside(android, realpathSync(path));
    const original = readFileSync(path, "utf8");
    const updated = transform(original);
    if (updated !== original) writeFileSync(path, updated);
  };
  update(join(android, "app", "build.gradle.kts"), (content) =>
    content.replace(/(rootDirRel\s*=\s*")(?:\.\.[/\\]){3}(")/g, "$1../../src-tauri$2")
  );
  const visit = (directory) => {
    if (!statOrNull(directory)) return;
    assertInside(android, realpathSync(directory));
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name === "BuildTask.kt") {
        update(path, (content) =>
          content.replace(
            /workingDir\(File\(projectDir,\s*rootDirRel\)\)/g,
            "workingDir(File(projectDir).toPath().toRealPath().resolve(rootDirRel).normalize().toFile())"
          )
        );
      }
    }
  };
  visit(join(android, "buildSrc", "src"));
}

/** Maintain the real root project and Tauri's ignored compatibility entry. */
export function ensureAndroidProject(projectRoot = defaultRoot) {
  const paths = getAndroidProjectPaths(projectRoot);
  const { root, android, legacy } = paths;
  assertInside(root, android);
  assertInside(root, legacy);
  assertParentInside(root, android);
  assertParentInside(root, legacy);

  const androidStat = statOrNull(android);
  const legacyStat = statOrNull(legacy);
  if (androidStat && (!androidStat.isDirectory() || androidStat.isSymbolicLink())) {
    throw new Error("根目录 android 必须是实际工程目录，不能是文件或目录链接");
  }
  if (legacyStat && !legacyStat.isSymbolicLink() && !legacyStat.isDirectory()) {
    throw new Error("src-tauri/gen/android 不是目录或兼容链接");
  }
  if (legacyStat?.isSymbolicLink()) {
    if (!androidStat || !samePath(realpathSync(legacy), realpathSync(android))) {
      throw new Error("src-tauri/gen/android 链接目标不正确，请保留现有文件并检查路径");
    }
    adaptAndroidProject(root);
    return { ...paths, migrated: false, linkCreated: false };
  }
  if (androidStat && legacyStat) {
    throw new Error("android 与 src-tauri/gen/android 均为实际目录，停止迁移以保留两份工程");
  }

  const migrated = Boolean(legacyStat);
  const created = !androidStat && !legacyStat;
  // Both resolved endpoints and their existing ancestors were checked above.
  if (migrated) renameSync(legacy, android);
  else if (created) mkdirSync(android);

  try {
    mkdirSync(dirname(legacy), { recursive: true });
    const target = process.platform === "win32" ? android : relative(dirname(legacy), android);
    symlinkSync(target, legacy, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (migrated) renameSync(android, legacy);
    else if (created) rmdirSync(android);
    throw error;
  }
  adaptAndroidProject(root);
  return { ...paths, migrated, linkCreated: true };
}

/** Preserve maintained native sources when Tauri refreshes machine-local files. */
export function snapshotAndroidSources(projectRoot = defaultRoot) {
  const { android } = getAndroidProjectPaths(projectRoot);
  const files = [
    ".editorconfig",
    ".gitignore",
    "build.gradle.kts",
    "gradle.properties",
    "gradlew",
    "gradlew.bat",
    "settings.gradle",
    "buildSrc/build.gradle.kts",
    "app/.gitignore",
    "app/build.gradle.kts",
    "app/proguard-rules.pro",
    "gradle/wrapper/gradle-wrapper.jar",
    "gradle/wrapper/gradle-wrapper.properties",
  ];
  const visit = (directory) => {
    const absolute = join(android, directory);
    if (!statOrNull(absolute)) return;
    assertInside(android, realpathSync(absolute));
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || ["generated", "jniLibs", "build"].includes(entry.name))
        continue;
      const name = join(directory, entry.name);
      if (entry.isDirectory()) visit(name);
      else if (entry.isFile() && /\.(kt|java|xml|png|webp|svg)$/i.test(entry.name))
        files.push(name);
    }
  };
  visit("buildSrc/src");
  visit("app/src/main");
  return files.flatMap((name) => {
    const path = join(android, name);
    const stat = statOrNull(path);
    return stat?.isFile() && !stat.isSymbolicLink()
      ? [{ name, content: readFileSync(path), mode: stat.mode }]
      : [];
  });
}

export function restoreAndroidSources(snapshot, projectRoot = defaultRoot) {
  const { android } = getAndroidProjectPaths(projectRoot);
  for (const file of snapshot) {
    const path = resolve(android, file.name);
    assertInside(android, path);
    assertParentInside(android, path);
    if (statOrNull(path)?.isSymbolicLink()) throw new Error(`拒绝覆盖原生源码链接：${path}`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.content);
    chmodSync(path, file.mode);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = ensureAndroidProject();
  console.log(`Android 实际工程：${result.android}`);
  console.log(`Tauri 兼容路径：${result.legacy}`);
}
