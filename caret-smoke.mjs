/**
 * 光标区域级标记显示 —— 无头浏览器冒烟（CDP 驱动，自包含）
 *
 * 用法：node caret-smoke.mjs
 * 自动完成：起 vite dev（端口 5199）→ 启动本机无头 Chrome/Edge（CDP 端口 5198）
 * → 打开 /debug-dom.html → 断言序列 → 清理进程。
 *
 * 断言清单（docs/BUGFIX-CARET-REGION.md 7.2 + P4 复检）：
 *  1 粗体内容内：该区域开/闭标记亮起（meta display=inline）
 *  2 粗体外（隔 ≥1 字符）：全部标记隐藏
 *  3 引用块 "> " 前缀上：全部标记隐藏（前缀永不显示）
 *  4 引用内粗体：仅该区域亮起（块外零泄漏）
 *  5 标题块内：heading 前缀经焦点块 CSS 显示（现状保持），且区域集合为空
 *    （heading 不进自管 style 通道）
 *  6 光标 8 次跨块移动：零 childList 突变、零非 class 属性突变
 *    （text wrapper 重建禁令 / 外改禁令的 DOM 证据）
 *  7 原文无损往返（getMarkdown 与注入内容一致）
 *  8 泄漏复检：bold/highlight 微区域交替 + 全部移出后 style 通道清空
 *  9b/9c P4 回归：li/ul/ol/table 与 p/h/blockquote 的 content-visibility 保持 visible
 *
 * 冒烟文档与探针全部 ASCII（vite-auto-i18n 会改写中文字面量，见坑 5）。
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const VITE_PORT = 5199;
const CDP_PORT = 5198;
// vite 默认绑定 localhost（本机 IPv6 ::1 栈），探针必须同走 localhost 而非 127.0.0.1；
// CDP 的 /json 端点由 Chrome 固定绑 127.0.0.1，不受此影响
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

/** CDP 最小客户端：Runtime.evaluate 探针通道 + 页面错误采集 */
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

  return { attach, send, evaluate, pageErrors };
}

// ── 页面内探针（ASCII，注入后常驻 window） ──
const PROBES = `
window.__findPos = (needle, occurrence = 0, offsetInNeedle = 0) => {
  const view = window.__debugEditor.view;
  let found = null;
  let seen = 0;
  view.state.doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.isText && node.text && node.text.includes(needle)) {
      if (seen === occurrence) {
        found = pos + node.text.indexOf(needle) + offsetInNeedle;
        return false;
      }
      seen++;
    }
    return true;
  });
  return found;
};
window.__setCursor = (pos) => {
  const view = window.__debugEditor.view;
  view.dispatch(view.state.tr.setSelection(window.__TextSelection.create(view.state.doc, pos)));
};
window.__metaStates = () => {
  const view = window.__debugEditor.view;
  return Array.from(view.dom.querySelectorAll(".livemd-syntax")).map((el) => ({
    type: el.dataset.syntaxType || "",
    display: getComputedStyle(el.querySelector(".livemd-syntax-meta") || el).display,
  }));
};
window.__caretDebugState = () => {
  const ed = window.__debugEditor;
  const dbg = ed.view.dom.__caretDebug;
  return dbg ? { active: dbg.active, regionCount: dbg.regions.length, cssLength: dbg.css.length } : null;
};
window.__installMutationWatch = () => {
  const view = window.__debugEditor.view;
  window.__mutations = [];
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "childList") window.__mutations.push("childList");
      else if (m.type === "attributes" && m.attributeName !== "class")
        window.__mutations.push("attr:" + m.attributeName);
    }
  });
  observer.observe(view.dom, { subtree: true, childList: true, attributes: true });
};
window.__takeMutations = () => window.__mutations.splice(0);
window.__liContentVisibility = () => {
  const li = window.__debugEditor.view.dom.querySelector("li");
  return li ? getComputedStyle(li).contentVisibility : "missing";
};
window.__contentVisibilityFamily = () => {
  const root = window.__debugEditor.view.dom;
  const pick = (selector) => {
    const el = root.querySelector(selector);
    return el ? getComputedStyle(el).contentVisibility : "missing";
  };
  return {
    li: pick("li"),
    ul: pick("ul"),
    ol: pick("ol"),
    table: pick("table"),
    p: pick("p"),
    h1: pick("h1"),
    h2: pick("h2"),
    h3: pick("h3"),
    h6: pick("h6"),
    blockquote: pick("blockquote"),
    "blockquoteChild": pick("blockquote > *")
  };
};
true;
`;

/** 断言序列：每步返回 { name, pass, detail } */
async function runAssertions(evaluate) {
  const results = [];
  const check = (name, pass, detail = "") => results.push({ name, pass, detail });

  // 探针安装 + 编辑器就绪
  await evaluate(PROBES);

  const setCursor = async (needle, occurrence, offset) => {
    const pos = await evaluate(
      `window.__findPos(${JSON.stringify(needle)}, ${occurrence}, ${offset})`
    );
    if (pos === null) throw new Error(`needle not found: ${needle}#${occurrence}`);
    await evaluate(`window.__setCursor(${pos})`);
  };

  const allNone = (states) => states.every((s) => s.display === "none");
  /** 光标邻接区域的标记亮起数（区域内开/闭标记各一个 meta，共 2） */
  const litCount = (states, type) =>
    states.filter((s) => s.type === type && s.display !== "none").length;

  let states;

  // 1 粗体内容内 → 仅该区域 strong 亮起（2 个 meta），其余类型全暗
  await setCursor("bold", 0, 2);
  states = await evaluate("window.__metaStates()");
  check(
    "1 粗体内容内 strong 亮起",
    litCount(states, "strong") === 2 &&
      litCount(states, "blockquote") === 0 &&
      litCount(states, "heading") === 0 &&
      litCount(states, "highlight") === 0,
    JSON.stringify(states)
  );

  // 2 粗体外（bb 内部，隔 ≥1 字符）→ 全部隐藏
  await setCursor("bb", 0, 1);
  states = await evaluate("window.__metaStates()");
  check("2 粗体外全部隐藏", allNone(states), JSON.stringify(states));

  // 3 引用块 > 前缀上（quote 前 2 字符 → "> " 内部）→ 全部隐藏
  await setCursor("quote", 0, -2);
  states = await evaluate("window.__metaStates()");
  check("3 引用 > 前缀不显示", allNone(states), JSON.stringify(states));

  // 4 引用内粗体 → 仅 bold2 区域亮起（行一首段的 strong 保持隐藏：块外零泄漏）
  await setCursor("bold2", 0, 2);
  states = await evaluate("window.__metaStates()");
  check(
    "4 引用内粗体仅该区域亮起",
    litCount(states, "strong") === 2 &&
      litCount(states, "heading") === 0 &&
      litCount(states, "highlight") === 0,
    JSON.stringify(states)
  );

  // 5 标题块内：heading 前缀由焦点块 CSS 显示；区域集合为空
  await setCursor("heading-text", 0, 3);
  states = await evaluate("window.__metaStates()");
  const headingMeta = states.filter((s) => s.type === "heading");
  const caretState = await evaluate("window.__caretDebugState()");
  check(
    "5 标题焦点块显示 heading 前缀且区域集合为空",
    headingMeta.length > 0 &&
      headingMeta.filter((s) => s.display !== "none").length === 1 &&
      caretState &&
      caretState.regionCount === 0,
    `metas=${JSON.stringify(headingMeta)} caret=${JSON.stringify(caretState)}`
  );

  // 6 光标 8 次跨块移动：零结构性突变
  await evaluate("window.__installMutationWatch()");
  for (const step of [
    ["bold", 0, 1],
    ["quote", 0, 2],
    ["heading-text", 0, 1],
    ["hl", 0, 1],
    ["list-item", 0, 2],
    ["bb", 0, 1],
    ["bold2", 0, 3],
    ["tail", 0, 1],
  ]) {
    await setCursor(...step);
  }
  const mutations = await evaluate("window.__takeMutations()");
  check(
    "6 光标移动零结构突变",
    Array.isArray(mutations) && mutations.length === 0,
    JSON.stringify(mutations)
  );

  // 7 原文无损往返
  const roundtrip = await evaluate(
    "(() => { const got = window.__debugEditor.getMarkdown(); const want = window.__debugContent; return { same: got.trimEnd() === want.trimEnd(), got: got.slice(0, 120) }; })()"
  );
  check(
    "7 原文无损往返",
    roundtrip && roundtrip.same === true,
    `got=${roundtrip && roundtrip.got}`
  );

  // 8 泄漏复检：bold → highlight 命中，再移到远离任何标记的位置（dd 内部），
  // 通道必须清空（无残留选择器 = 无泄漏）
  await setCursor("bold", 1, 2);
  states = await evaluate("window.__metaStates()");
  const boldLit = litCount(states, "strong") === 2;
  await setCursor("hl", 0, 1);
  states = await evaluate("window.__metaStates()");
  const hlLit = litCount(states, "highlight") === 2;
  await setCursor("dd", 0, 1);
  const finalState = await evaluate("window.__caretDebugState()");
  check(
    "8 泄漏复检：bold/highlight 命中且移出后通道清空",
    boldLit && hlLit && finalState && finalState.regionCount === 0 && finalState.cssLength === 0,
    `bold=${boldLit} hl=${hlLit} final=${JSON.stringify(finalState)}`
  );

  // 9b/9c P4 回归：所有曾躺枪的 textblock 宿主保持 visible
  const cv = await evaluate("window.__contentVisibilityFamily()");
  const families = {
    "9b li/ul/ol/table content-visibility = visible": ["li", "ul", "ol", "table"],
    "9c p/h/blockquote content-visibility = visible": [
      "p",
      "h1",
      "h2",
      "h3",
      "h6",
      "blockquote",
      "blockquoteChild",
    ],
  };
  for (const [name, keys] of Object.entries(families)) {
    const bad = keys.filter((key) => cv[key] !== "visible");
    check(name, bad.length === 0, `bad=${bad.join(",") || "-"} values=${JSON.stringify(cv)}`);
  }

  return results;
}

async function main() {
  const vite = startViteDev();
  const userDataDir = mkdtempSync(join(tmpdir(), "livemd-caret-smoke-"));
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
      // 就绪失败时带出页面侧错误（模块装载失败 / 运行时异常）
      if (cdp.pageErrors.length > 0) {
        throw new Error(`${error.message} | page errors: ${cdp.pageErrors.join(" || ")}`);
      }
      throw error;
    });

    const results = await runAssertions(cdp.evaluate);

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
