import assert from "node:assert/strict";
import fs, {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  adaptAndroidProject,
  ensureAndroidProject,
  getAndroidProjectPaths,
  restoreAndroidSources,
  snapshotAndroidSources,
} from "../scripts/android-project.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const fixtureParent = realpathSync(join(projectRoot, ".git"));
const directoryLinkType = process.platform === "win32" ? "junction" : "dir";

function writeFixtureFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function removeFixture(container) {
  const absolute = resolve(container);
  const difference = relative(fixtureParent, absolute);
  assert.ok(
    difference &&
      !isAbsolute(difference) &&
      difference !== ".." &&
      !difference.startsWith(`..${sep}`),
    "测试清理路径必须位于工作区的 .git 目录内"
  );
  // Remove links themselves before recursively removing the fixture tree.
  // This also handles a dangling Windows junction without following its target.
  const unlinkDirectoryLinks = (path) => {
    const info = lstatSync(path);
    if (info.isSymbolicLink()) {
      unlinkSync(path);
    } else if (info.isDirectory()) {
      for (const entry of readdirSync(path)) unlinkDirectoryLinks(join(path, entry));
    }
  };
  unlinkDirectoryLinks(absolute);
  rmSync(absolute, { recursive: true, force: true });
}

function fixture(t) {
  const container = mkdtempSync(join(fixtureParent, "android-project-test-"));
  const root = join(container, "workspace");
  writeFixtureFile(join(root, "package.json"), "{}\n");
  writeFixtureFile(join(root, "src-tauri", "Cargo.toml"), "[package]\nname = 'fixture'\n");
  writeFixtureFile(join(root, "src-tauri", "tauri.conf.json"), "{}\n");
  t.after(() => removeFixture(container));
  return {
    ...getAndroidProjectPaths(root),
    outside: join(container, "outside"),
  };
}

function assertCompatibilityLink(paths) {
  assert.equal(lstatSync(paths.android).isDirectory(), true);
  assert.equal(lstatSync(paths.android).isSymbolicLink(), false);
  assert.equal(lstatSync(paths.legacy).isSymbolicLink(), true);
  assert.equal(realpathSync(paths.legacy), realpathSync(paths.android));
}

test("旧 Android 工程迁移到根目录，保留源码、二进制和本地配置", (t) => {
  const paths = fixture(t);
  const files = new Map([
    ["app/src/main/java/MainActivity.kt", Buffer.from("// custom Android activity\n")],
    ["gradle/wrapper/gradle-wrapper.jar", Buffer.from([0, 1, 255, 17, 0, 128])],
    ["keystore.properties", Buffer.from("local fixture signing settings\n")],
  ]);
  for (const [name, bytes] of files) writeFixtureFile(join(paths.legacy, name), bytes);

  const result = ensureAndroidProject(paths.root);

  assert.equal(result.migrated, true);
  assertCompatibilityLink(paths);
  for (const [name, bytes] of files) {
    assert.deepEqual(readFileSync(join(paths.android, name)), bytes);
    assert.deepEqual(readFileSync(join(paths.legacy, name)), bytes);
  }
});

test("已有根目录工程可重建兼容链接，重复准备不会替换源码或链接", (t) => {
  const paths = fixture(t);
  const source = join(paths.android, "app", "build.gradle.kts");
  writeFixtureFile(source, "// maintained root project\n");

  const first = ensureAndroidProject(paths.root);
  const firstTarget = readlinkSync(paths.legacy);
  const second = ensureAndroidProject(paths.root);

  assert.equal(first.migrated, false);
  assert.equal(first.linkCreated, true);
  assert.equal(second.linkCreated, false);
  assertCompatibilityLink(paths);
  assert.equal(readlinkSync(paths.legacy), firstTarget);
  assert.equal(readFileSync(source, "utf8"), "// maintained root project\n");
  writeFixtureFile(join(paths.legacy, "through-link.txt"), "same physical project");
  assert.equal(
    readFileSync(join(paths.android, "through-link.txt"), "utf8"),
    "same physical project"
  );
});

test("全新工作区创建真实 Android 目录及 Tauri 兼容入口", (t) => {
  const paths = fixture(t);

  const result = ensureAndroidProject(paths.root);

  assert.equal(result.migrated, false);
  assert.equal(result.linkCreated, true);
  assertCompatibilityLink(paths);
});

test("自动适配旧 Gradle 模板路径，重复执行保留自定义配置与路径表达式", (t) => {
  const paths = fixture(t);
  const gradleName = "app/build.gradle.kts";
  const taskName = "buildSrc/src/main/java/example/BuildTask.kt";
  const gradleTemplate = [
    "// maintained application settings",
    'val assetDirectory = "../../../custom-assets"',
    'rust { rootDirRel = "../../../" }',
    "// custom dependencies remain here",
    "",
  ].join("\n");
  const taskTemplate = [
    "// maintained Rust build task",
    "fun buildRust() {",
    "    workingDir(File(projectDir, rootDirRel))",
    '    args(listOf("--custom-option"))',
    "}",
    "fun customTask() { workingDir(configuredDirectory) }",
    "",
  ].join("\n");
  writeFixtureFile(join(paths.legacy, gradleName), gradleTemplate);
  writeFixtureFile(join(paths.legacy, taskName), taskTemplate);

  ensureAndroidProject(paths.root);

  const adaptedGradle = readFileSync(join(paths.android, gradleName), "utf8");
  const adaptedTask = readFileSync(join(paths.android, taskName), "utf8");
  const rootDirRel = /rootDirRel = "([^"]+)"/.exec(adaptedGradle)?.[1];
  assert.ok(rootDirRel, "适配后应保留明确的 Rust 工程路径");
  assert.equal(
    realpathSync(resolve(paths.android, "app", rootDirRel)),
    realpathSync(paths.backend)
  );
  assert.ok(adaptedGradle.includes('val assetDirectory = "../../../custom-assets"'));
  assert.ok(adaptedGradle.includes("// custom dependencies remain here"));
  assert.match(
    adaptedTask,
    /workingDir\(File\(projectDir\)\.toPath\(\)\.toRealPath\(\)\.resolve\(rootDirRel\)/
  );
  assert.ok(adaptedTask.includes('args(listOf("--custom-option"))'));
  assert.ok(adaptedTask.includes("fun customTask() { workingDir(configuredDirectory) }"));

  ensureAndroidProject(paths.root);
  adaptAndroidProject(paths.root);
  assert.equal(readFileSync(join(paths.android, gradleName), "utf8"), adaptedGradle);
  assert.equal(readFileSync(join(paths.android, taskName), "utf8"), adaptedTask);

  const customGradle = 'rust { rootDirRel = project.findProperty("rustRoot").toString() }\n';
  const customTask = "fun buildRust() { workingDir(configuredRustDirectory) }\n";
  writeFixtureFile(join(paths.android, gradleName), customGradle);
  writeFixtureFile(join(paths.android, taskName), customTask);
  adaptAndroidProject(paths.root);
  assert.equal(readFileSync(join(paths.android, gradleName), "utf8"), customGradle);
  assert.equal(readFileSync(join(paths.android, taskName), "utf8"), customTask);
});

test("两个实际 Android 工程冲突时保留双方文件", (t) => {
  const paths = fixture(t);
  writeFixtureFile(join(paths.android, "root.txt"), "root content");
  writeFixtureFile(join(paths.legacy, "legacy.txt"), "legacy content");

  assert.throws(() => ensureAndroidProject(paths.root), /均为实际目录/);

  assert.equal(lstatSync(paths.android).isSymbolicLink(), false);
  assert.equal(lstatSync(paths.legacy).isSymbolicLink(), false);
  assert.equal(readFileSync(join(paths.android, "root.txt"), "utf8"), "root content");
  assert.equal(readFileSync(join(paths.legacy, "legacy.txt"), "utf8"), "legacy content");
});

test("根目录 Android 为目录链接时拒绝迁移，不修改链接目标", (t) => {
  const paths = fixture(t);
  writeFixtureFile(join(paths.outside, "preserved.txt"), "outside root");
  symlinkSync(paths.outside, paths.android, directoryLinkType);

  assert.throws(() => ensureAndroidProject(paths.root), /必须是实际工程目录/);

  assert.equal(realpathSync(paths.android), realpathSync(paths.outside));
  assert.equal(readFileSync(join(paths.outside, "preserved.txt"), "utf8"), "outside root");
  assert.equal(existsSync(paths.legacy), false);
});

test("错误的 Tauri 兼容链接不会被覆盖，已有根目录工程保持原状", (t) => {
  const paths = fixture(t);
  writeFixtureFile(join(paths.android, "root.txt"), "root content");
  writeFixtureFile(join(paths.outside, "preserved.txt"), "other project");
  mkdirSync(dirname(paths.legacy), { recursive: true });
  symlinkSync(paths.outside, paths.legacy, directoryLinkType);

  assert.throws(() => ensureAndroidProject(paths.root), /链接目标不正确/);

  assert.equal(realpathSync(paths.legacy), realpathSync(paths.outside));
  assert.equal(readFileSync(join(paths.android, "root.txt"), "utf8"), "root content");
  assert.equal(readFileSync(join(paths.outside, "preserved.txt"), "utf8"), "other project");
});

test("失效的 Tauri 目录链接仍被保留，不被误当作缺失入口", (t) => {
  const paths = fixture(t);
  writeFixtureFile(join(paths.android, "root.txt"), "root content");
  mkdirSync(dirname(paths.legacy), { recursive: true });
  symlinkSync(paths.outside, paths.legacy, directoryLinkType);
  const originalTarget = readlinkSync(paths.legacy);

  assert.throws(() => ensureAndroidProject(paths.root));

  assert.equal(lstatSync(paths.legacy).isSymbolicLink(), true);
  assert.equal(readlinkSync(paths.legacy), originalTarget);
  assert.equal(readFileSync(join(paths.android, "root.txt"), "utf8"), "root content");
});

test("兼容路径的父目录指向工作区外时拒绝写入", (t) => {
  const paths = fixture(t);
  mkdirSync(paths.outside);
  symlinkSync(paths.outside, join(paths.backend, "gen"), directoryLinkType);

  assert.throws(() => ensureAndroidProject(paths.root), /超出工作区/);

  assert.equal(existsSync(paths.android), false);
  assert.deepEqual(readdirSync(paths.outside), []);
});

test("创建兼容链接失败时回滚旧工程迁移，原文件仍在原路径", (t) => {
  const paths = fixture(t);
  writeFixtureFile(join(paths.legacy, "preserved.txt"), "original project");
  t.mock.method(fs, "symlinkSync", () => {
    const error = new Error("fixture link creation denied");
    error.code = "EPERM";
    throw error;
  });
  syncBuiltinESMExports();
  try {
    assert.throws(() => ensureAndroidProject(paths.root), { code: "EPERM" });
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }

  assert.equal(existsSync(paths.android), false);
  assert.equal(lstatSync(paths.legacy).isDirectory(), true);
  assert.equal(lstatSync(paths.legacy).isSymbolicLink(), false);
  assert.equal(readFileSync(join(paths.legacy, "preserved.txt"), "utf8"), "original project");
});

test("初始化后恢复自维护 Gradle 和 Kotlin 源码，保留新生成文件与本地签名配置", (t) => {
  const paths = fixture(t);
  const maintained = new Map([
    ["app/build.gradle.kts", "// custom signing and rootDirRel\n"],
    ["buildSrc/src/main/java/example/BuildTask.kt", "// custom canonical working directory\n"],
    ["app/src/main/java/example/MainActivity.kt", "// custom activity\n"],
    ["gradlew", "#!/bin/sh\n# custom wrapper\n"],
  ]);
  for (const [name, content] of maintained) writeFixtureFile(join(paths.android, name), content);
  chmodSync(join(paths.android, "gradlew"), 0o755);
  const wrapperMode = statSync(join(paths.android, "gradlew")).mode & 0o777;
  const generated = "app/src/main/java/example/generated/GeneratedTask.kt";
  writeFixtureFile(join(paths.android, generated), "// old generated source\n");
  writeFixtureFile(join(paths.android, "tauri.settings.gradle"), "// old local dependency paths\n");
  writeFixtureFile(join(paths.android, "keystore.properties"), "old local fixture settings\n");

  const snapshot = snapshotAndroidSources(paths.root);
  const names = snapshot.map((file) => file.name.replaceAll("\\", "/"));
  for (const name of maintained.keys()) assert.ok(names.includes(name));
  assert.equal(names.includes("keystore.properties"), false);
  assert.equal(names.includes("tauri.settings.gradle"), false);
  assert.equal(names.includes(generated), false);
  for (const name of maintained.keys())
    writeFixtureFile(join(paths.android, name), "// generated replacement\n");
  chmodSync(join(paths.android, "gradlew"), 0o644);
  writeFixtureFile(join(paths.android, generated), "// refreshed generated source\n");
  writeFixtureFile(
    join(paths.android, "tauri.settings.gradle"),
    "// refreshed local dependency paths\n"
  );
  writeFixtureFile(join(paths.android, "keystore.properties"), "updated local fixture settings\n");

  restoreAndroidSources(snapshot, paths.root);

  for (const [name, content] of maintained) {
    assert.equal(readFileSync(join(paths.android, name), "utf8"), content);
  }
  assert.equal(statSync(join(paths.android, "gradlew")).mode & 0o777, wrapperMode);
  assert.equal(
    readFileSync(join(paths.android, generated), "utf8"),
    "// refreshed generated source\n"
  );
  assert.equal(
    readFileSync(join(paths.android, "tauri.settings.gradle"), "utf8"),
    "// refreshed local dependency paths\n"
  );
  assert.equal(
    readFileSync(join(paths.android, "keystore.properties"), "utf8"),
    "updated local fixture settings\n"
  );
});
