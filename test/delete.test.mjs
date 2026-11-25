import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { cleanBuildArtifacts } from "../scripts/delete.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const fixtureParent = realpathSync(join(projectRoot, ".git"));

function writeFile(path, content = "fixture") {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function fixture(t) {
  const container = mkdtempSync(join(fixtureParent, "delete-test-"));
  const root = join(container, "workspace");
  const outside = join(container, "outside");
  mkdirSync(root);
  mkdirSync(outside);
  t.after(() => {
    const difference = relative(fixtureParent, resolve(container));
    assert.ok(
      difference &&
        !isAbsolute(difference) &&
        difference !== ".." &&
        !difference.startsWith(`..${sep}`)
    );
    const removeLinks = (path) => {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) unlinkSync(path);
      else if (stat.isDirectory()) {
        for (const name of readdirSync(path)) removeLinks(join(path, name));
      }
    };
    removeLinks(container);
    rmSync(container, { recursive: true, force: true });
  });
  return { root, outside };
}

test("清理各平台产物与缓存，保留源码、依赖和本地配置", (t) => {
  const { root } = fixture(t);
  const outputs = [
    "dist/assets/app.js",
    "dist-electron/main.js",
    "out/app.exe",
    "build/output.txt",
    "target/debug/app",
    "src-tauri/target/release/app.exe",
    "node_modules/.vite/deps/vue.js",
    "node_modules/.vite-temp/config.mjs",
    "node_modules/.cache/tool/data",
    ".cache/tool/data",
    ".vite/deps/vue.js",
    ".hvigor/cache/data",
    ".eslintcache",
    "coverage/index.html",
    "android/.gradle/cache/data",
    "android/.kotlin/cache/data",
    "android/app/.cxx/output.o",
    "android/app/build/outputs/app.apk",
    "android/buildSrc/build/plugin.jar",
    "harmony/entry/build/app.hap",
    "harmony/.hvigor/livemd-web.sha256",
    "harmony/entry/src/main/resources/rawfile/www/index.html",
  ];
  const preserved = [
    "src/main.ts",
    "src/target/source.txt",
    "src-tauri/Cargo.toml",
    "src-tauri/gen/keep.txt",
    "node_modules/vue/package.json",
    "node_modules/.pnpm/keep.txt",
    "android/app/src/main/java/MainActivity.kt",
    "android/keystore.properties",
    "harmony/build-profile.json5",
    "harmony/oh_modules/keep.txt",
    "harmony/.sign/sign-config.json5",
    ".env.local",
    "pnpm-lock.yaml",
    "notes.md",
  ];
  for (const name of [...outputs, ...preserved]) writeFile(join(root, name), name);

  cleanBuildArtifacts(root, { log: () => {} });

  for (const name of outputs) assert.equal(existsSync(join(root, name)), false, name);
  for (const name of preserved) assert.equal(readFileSync(join(root, name), "utf8"), name);
  assert.deepEqual(cleanBuildArtifacts(root, { log: () => {} }), []);
});

test("预览列出待删除项但保留全部内容", (t) => {
  const { root } = fixture(t);
  writeFile(join(root, "dist", "app.js"), "build output");
  writeFile(join(root, ".eslintcache"), "cache");
  const messages = [];

  const targets = cleanBuildArtifacts(root, {
    dryRun: true,
    log: (message) => messages.push(message),
  });

  assert.deepEqual(targets, ["dist", ".eslintcache"]);
  assert.ok(messages.includes("将删除 dist"));
  assert.equal(readFileSync(join(root, "dist", "app.js"), "utf8"), "build output");
  assert.equal(readFileSync(join(root, ".eslintcache"), "utf8"), "cache");
});

for (const linkName of ["src-tauri", "src-tauri/target"]) {
  test(`清理前拒绝目录链接 ${linkName}，保留项目内外文件`, (t) => {
    const { root, outside } = fixture(t);
    writeFile(join(root, "dist", "app.js"), "build output");
    writeFile(join(outside, "target", "keep.txt"), "outside output");
    const link = join(root, linkName);
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");

    assert.throws(() => cleanBuildArtifacts(root, { log: () => {} }), /拒绝清理/);

    assert.equal(readFileSync(join(root, "dist", "app.js"), "utf8"), "build output");
    assert.equal(readFileSync(join(outside, "target", "keep.txt"), "utf8"), "outside output");
    assert.equal(lstatSync(link).isSymbolicLink(), true);
  });
}

test("命令从脚本定位项目，支持预览并拒绝未知参数", (t) => {
  const { root, outside } = fixture(t);
  const script = join(root, "scripts", "delete.mjs");
  mkdirSync(dirname(script));
  copyFileSync(join(projectRoot, "scripts", "delete.mjs"), script);
  writeFile(join(root, "dist", "app.js"), "project output");
  writeFile(join(outside, "target", "keep.txt"), "other output");
  const run = (args) =>
    spawnSync(process.execPath, [script, ...args], { cwd: outside, encoding: "utf8" });

  const preview = run(["--dry-run"]);
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /将删除 dist/);
  assert.doesNotMatch(preview.stdout, /将删除 target/);
  assert.equal(readFileSync(join(root, "dist", "app.js"), "utf8"), "project output");

  const invalid = run(["--unknown"]);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /用法/);
  assert.equal(existsSync(join(root, "dist", "app.js")), true);

  const cleanup = run([]);
  assert.equal(cleanup.status, 0, cleanup.stderr);
  assert.equal(existsSync(join(root, "dist")), false);
  assert.equal(readFileSync(join(outside, "target", "keep.txt"), "utf8"), "other output");
});
