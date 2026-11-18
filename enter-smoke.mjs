/**
 * Enter / 图片行 —— 无头浏览器冒烟（CDP 驱动，自包含）
 *
 * 用法：node enter-smoke.mjs
 * 自动完成：起 vite dev（端口 5197）→ 启动本机无头 Chrome/Edge（CDP 端口 5196）
 * → 打开 /debug-dom.html → 断言序列 → 清理进程。
 *
 * 断言清单（与 caret-smoke 共用 debug 页，文档内容逐场景 restoreDoc）：
 *  1 行末粗体闭标记 Enter：上行 marks 完整 + 新行空
 *  2 同场景序列化无损（上行仍为 `head **mk**`，无孤立标记行）
 *  3 行中闭标记后 Enter：split 正常完成，原文文本不丢
 *  4 行末行内代码闭标记 Enter：同断言 1 口径
 *  5 段首 Enter + 焦点移开：模型/DOM 健康基线（全部段落 visible）
 *
 * 冒烟文档与探针全部 ASCII（vite-auto-i18n 会改写中文字面量，见坑 5）。
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const VITE_PORT = 5197;
const CDP_PORT = 5196;
const PAGE_URL = `http://localhost:${VITE_PORT}/debug-dom.html`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(what, timeoutMs, probe) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(400);
  }
  throw new Error(`timeout waiting for ${what}${lastError ? `: ${lastError.message}` : ""}`);
}

function startViteDev() {
  const child = spawn(
    process.execPath,
    [
      join(ROOT, "node_modules", "vite", "bin", "vite.js"),
      "--port",
      String(VITE_PORT),
      "--strictPort",
    ],
    { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"], windowsHide: true }
  );
  child.stderr.on("data", () => {});
  return child;
}

function findBrowser() {
  const candidates = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    process.env.LOCALAPPDATA &&
      join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"),
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      "no headless-capable browser found (checked chrome.exe / msedge.exe standard paths)"
    );
  }
  return found;
}

function startBrowser(browserPath, userDataDir) {
  const child = spawn(
    browserPath,
    [
      "--headless=new",
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--window-size=1400,900",
      PAGE_URL,
    ],
    { stdio: "ignore", windowsHide: true }
  );
  return child;
}

/** CDP 最小客户端：Runtime.evaluate 探针通道 + 真实按键 + 页面错误采集 */
function connectCdp() {
  let ws = null;
  let msgId = 0;
  const waiters = new Map();
  const pageErrors = [];

  const attach = (socket) => {
    ws = socket;
    socket.addEventListener("message", (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
        pageErrors.push(
          msg.params.args
            .map((a) => a.value ?? a.description ?? "")
            .join(" ")
            .slice(0, 300)
        );
      } else if (msg.method === "Runtime.exceptionThrown") {
        pageErrors.push(
          (
            msg.params.exceptionDetails.exception?.description ??
            msg.params.exceptionDetails.text ??
            ""
          ).slice(0, 300)
        );
      } else if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
        pageErrors.push(String(msg.params.entry.text ?? "").slice(0, 300));
      }
      if (msg.id && waiters.has(msg.id)) {
        const resolve = waiters.get(msg.id);
        waiters.delete(msg.id);
        resolve(msg);
      }
    });
  };

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++msgId;
      waiters.set(id, (msg) => {
        if (msg.error) reject(new Error(`${method}: ${JSON.stringify(msg.error)}`));
        else resolve(msg.result);
      });
      ws.send(JSON.stringify({ id, method, params }));
    });

  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(`page error: ${JSON.stringify(result.exceptionDetails).slice(0, 500)}`);
    }
    return result.result?.value;
  };

  const pressEnter = async () => {
    const params = {
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    };
    await send("Input.dispatchKeyEvent", { type: "keyDown", ...params, text: "\r" });
    await send("Input.dispatchKeyEvent", { type: "keyUp", ...params });
    await sleep(120);
  };

  return { attach, send, evaluate, pressEnter, pageErrors };
}

// ── 页面内探针（ASCII，注入后常驻 window） ──
const PROBES = `
window.__setDoc = (content) => {
  window.__debugEditor.restoreDoc(content);
};
window.__focusBlockEnd = () => {
  const view = window.__debugEditor.view;
  const first = view.state.doc.firstChild;
  const pos = 1 + first.content.size;
  view.dispatch(view.state.tr.setSelection(window.__TextSelection.create(view.state.doc, pos)));
  view.focus();
};
window.__focusNeedle = (needle, occurrence = 0, offset = 0) => {
  const view = window.__debugEditor.view;
  let found = null;
  let seen = 0;
  view.state.doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.isText && node.text && node.text.includes(needle)) {
      if (seen === occurrence) {
        found = pos + node.text.indexOf(needle) + offset;
        return false;
      }
      seen++;
    }
    return true;
  });
  if (found === null) throw new Error("needle not found: " + needle);
  view.dispatch(view.state.tr.setSelection(window.__TextSelection.create(view.state.doc, found)));
  view.focus();
};
window.__focusDocEnd = () => {
  const view = window.__debugEditor.view;
  view.dispatch(
    view.state.tr.setSelection(
      window.__TextSelection.create(view.state.doc, view.state.doc.content.size)
    )
  );
  view.focus();
};
window.__docInfo = () => {
  const view = window.__debugEditor.view;
  const children = [];
  view.state.doc.forEach((node) => {
    const texts = [];
    node.descendants((child) => {
      if (child.isText) {
        texts.push({ text: child.text, marks: child.marks.map((m) => m.type.name) });
      }
    });
    children.push({ type: node.type.name, text: node.textContent, texts });
  });
  return {
    md: window.__debugEditor.getMarkdown(),
    childCount: view.state.doc.childCount,
    children,
  };
};
window.__paragraphHealth = () => {
  const view = window.__debugEditor.view;
  return Array.from(view.dom.querySelectorAll("p")).map((p) => ({
    text: p.textContent,
    visibility: getComputedStyle(p).visibility,
    display: getComputedStyle(p).display,
    contentVisibility: getComputedStyle(p).contentVisibility,
  }));
};
true;
`;

/** 断言序列 */
async function runAssertions(cdp) {
  const { evaluate, pressEnter } = cdp;
  const results = [];
  const check = (name, pass, detail = "") => results.push({ name, pass, detail });

  await evaluate(PROBES);

  const setDoc = async (content) => {
    await evaluate(`window.__setDoc(${JSON.stringify(content)})`);
    await sleep(160);
  };

  const hasMark = (child, text, mark) =>
    child.texts.some((t) => t.text === text && t.marks.includes(mark));
  const markerCount = (child) =>
    child.texts.filter((t) => t.marks.includes("syntax_marker")).length;

  // 1/2 行末粗体闭标记 Enter
  await setDoc("head **mk**");
  await evaluate("window.__focusBlockEnd()");
  await pressEnter();
  let info = await evaluate("window.__docInfo()");
  const boldParagraph = info.children[0];
  check(
    "1 行末粗体闭标记 Enter：上行 marks 完整 + 新行空",
    info.childCount === 2 &&
      info.children[1].text === "" &&
      hasMark(boldParagraph, "mk", "strong") &&
      markerCount(boldParagraph) === 2,
    JSON.stringify(info)
  );
  check(
    "2 行末粗体闭标记 Enter：序列化无损",
    info.md.trimEnd() === "head **mk**" &&
      !info.md.split("\n").some((line) => line.trim() === "**"),
    `md=${JSON.stringify(info.md)}`
  );

  // 3 行中闭标记后 Enter（回拨现状固化）
  await setDoc("aa**mk**bb");
  await evaluate('window.__focusNeedle("bb", 0, 0)');
  await pressEnter();
  info = await evaluate("window.__docInfo()");
  check(
    "3 行中闭标记后 Enter：split 正常完成且文本不丢",
    info.childCount === 2 && info.children.map((c) => c.text).join("") === "aa**mk**bb",
    JSON.stringify(info)
  );

  // 4 行末行内代码闭标记 Enter
  await setDoc("head `mk`");
  await evaluate("window.__focusBlockEnd()");
  await pressEnter();
  info = await evaluate("window.__docInfo()");
  check(
    "4 行末行内代码闭标记 Enter：上行 marks 完整 + 新行空",
    info.childCount === 2 &&
      info.children[1].text === "" &&
      hasMark(info.children[0], "mk", "code_inline") &&
      markerCount(info.children[0]) === 2 &&
      info.md.trimEnd() === "head `mk`",
    JSON.stringify(info)
  );

  // 5 段首 Enter + 焦点移开（模型/DOM 健康基线）
  await setDoc("first\n\nsecond\n\nthird");
  await evaluate('window.__focusNeedle("second", 0, 0)');
  await pressEnter();
  await evaluate("window.__focusDocEnd()");
  info = await evaluate("window.__docInfo()");
  const paragraphHealth = await evaluate("window.__paragraphHealth()");
  check(
    "5 段首 Enter 后焦点移开：模型/DOM 健康基线",
    info.childCount === 4 &&
      info.children.map((c) => c.text).join("|") === "first||second|third" &&
      paragraphHealth.length === 4 &&
      paragraphHealth.every(
        (p) =>
          p.visibility === "visible" && p.display !== "none" && p.contentVisibility === "visible"
      ),
    `info=${JSON.stringify(info)} health=${JSON.stringify(paragraphHealth)}`
  );

  return results;
}

async function main() {
  const vite = startViteDev();
  const userDataDir = mkdtempSync(join(tmpdir(), "livemd-enter-smoke-"));
  let browser = null;
  let exitCode = 0;
  try {
    await waitFor("vite dev server", 90_000, async () => {
      const response = await fetch(PAGE_URL);
      return response.ok;
    });

    const browserPath = findBrowser();
    browser = startBrowser(browserPath, userDataDir);
    const target = await waitFor("chrome CDP target", 60_000, async () => {
      const list = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((r) => r.json());
      return (
        list.find((t) => t.type === "page" && t.url.startsWith(`http://localhost:${VITE_PORT}`)) ||
        null
      );
    });

    const cdp = connectCdp();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve);
      ws.addEventListener("error", () => reject(new Error("cdp websocket error")));
    });
    cdp.attach(ws);
    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");

    await waitFor("editor ready", 120_000, async () => {
      const ready = await cdp.evaluate(
        "Boolean(window.__debugEditor && window.__debugEditor.view)"
      );
      return ready === true;
    }).catch((error) => {
      if (cdp.pageErrors.length > 0) {
        throw new Error(`${error.message} | page errors: ${cdp.pageErrors.join(" || ")}`);
      }
      throw error;
    });

    const results = await runAssertions(cdp);

    for (const r of results) {
      console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : `  |  ${r.detail}`}`);
    }
    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} assertions passed`);
    if (failed.length > 0) exitCode = 1;
  } catch (error) {
    console.error("SMOKE ERROR:", error.message);
    exitCode = 1;
  } finally {
    try {
      if (browser) browser.kill();
    } catch {}
    try {
      vite.kill();
    } catch {}
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {}
  }
  process.exit(exitCode);
}

await main();
