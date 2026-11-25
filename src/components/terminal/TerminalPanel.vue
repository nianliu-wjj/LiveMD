<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Maximize2, Minimize2, RotateCw, TerminalSquare, X } from "lucide-vue-next";
import { hideTerminal, terminalMaximized, terminalVisible } from "@/hooks/useTerminal";
import useWorkSpace from "@/hooks/useWorkSpace";
import "@xterm/xterm/css/xterm.css";

const container = ref<HTMLElement | null>(null);
const { watchedDirPath } = useWorkSpace();
const cwd = computed(() => watchedDirPath.value?.replace(/[/\\]+$/, "") || undefined);
const height = ref(260);
try {
  height.value = Math.max(
    120,
    Math.min(600, Number(localStorage.getItem("livemd-terminal-height")) || 260)
  );
} catch {
  /* 默认高度 */
}
const error = ref("");
const starting = ref(false);
let terminal: Terminal | null = null;
let fit: FitAddon | null = null;
let sessionId: string | null = null;
let disposed = false;
let resizeObserver: ResizeObserver | null = null;
let themeObserver: MutationObserver | null = null;
const subscriptions: UnlistenFn[] = [];

function fitTerminal(): void {
  if (!terminalVisible.value || !container.value?.clientHeight) return;
  fit?.fit();
}

function applyTheme(): void {
  if (!terminal) return;
  const dark = Array.from(document.documentElement.classList).some(
    (name) => name.startsWith("theme-") && name.includes("dark")
  );
  terminal.options.theme = dark
    ? {
        background: "#161b22",
        foreground: "#c9d1d9",
        cursor: "#c9d1d9",
        selectionBackground: "#264f78",
        black: "#484f58",
        red: "#ff7b72",
        green: "#7ee787",
        yellow: "#d29922",
        blue: "#79c0ff",
        magenta: "#d2a8ff",
        cyan: "#a5d6ff",
        white: "#b1bac4",
        brightBlack: "#6e7681",
        brightRed: "#ffa198",
        brightGreen: "#aff5b4",
        brightYellow: "#e3b341",
        brightBlue: "#a5d6ff",
        brightMagenta: "#e2c5ff",
        brightCyan: "#b3f0ff",
        brightWhite: "#f0f6fc",
      }
    : {
        background: "#ffffff",
        foreground: "#24292f",
        cursor: "#24292f",
        selectionBackground: "#add6ff",
        black: "#24292f",
        red: "#cf222e",
        green: "#116329",
        yellow: "#9a6700",
        blue: "#0550ae",
        magenta: "#8250df",
        cyan: "#1b7c83",
        white: "#6e7781",
        brightBlack: "#57606a",
        brightRed: "#a40e26",
        brightGreen: "#1a7f37",
        brightYellow: "#bf8700",
        brightBlue: "#0969da",
        brightMagenta: "#a475f9",
        brightCyan: "#3192aa",
        brightWhite: "#8c959f",
      };
}

async function startSession(): Promise<void> {
  if (starting.value || !terminal) return;
  starting.value = true;
  error.value = "";
  const previous = sessionId;
  sessionId = null;
  try {
    if (previous) await invoke("terminal_close", { sessionId: previous });
    if (disposed) return;
    terminal.clear();
    fitTerminal();
    const id = crypto.randomUUID();
    sessionId = id;
    await invoke("terminal_open", {
      sessionId: id,
      cwd: cwd.value,
      cols: terminal.cols,
      rows: terminal.rows,
    });
    if (disposed) {
      await invoke("terminal_close", { sessionId: id });
      return;
    }
    terminal.focus();
  } catch (cause) {
    sessionId = null;
    error.value = String(cause);
  } finally {
    starting.value = false;
  }
}

let dragY = 0;
let dragHeight = 0;
function startResize(event: PointerEvent): void {
  if (terminalMaximized.value || event.button !== 0) return;
  event.preventDefault();
  dragY = event.clientY;
  dragHeight = height.value;
  window.addEventListener("pointermove", moveResize);
  window.addEventListener("pointerup", stopResize, { once: true });
  window.addEventListener("pointercancel", stopResize, { once: true });
  window.addEventListener("blur", stopResize, { once: true });
}
function moveResize(event: PointerEvent): void {
  height.value = Math.max(
    120,
    Math.min(window.innerHeight * 0.75, dragHeight + dragY - event.clientY)
  );
}
function stopResize(): void {
  window.removeEventListener("pointermove", moveResize);
  window.removeEventListener("pointerup", stopResize);
  window.removeEventListener("pointercancel", stopResize);
  window.removeEventListener("blur", stopResize);
  try {
    localStorage.setItem("livemd-terminal-height", String(height.value));
  } catch {
    /* 存储不可用时仅本次生效 */
  }
}

watch([terminalVisible, terminalMaximized], async () => {
  await nextTick();
  fitTerminal();
  if (terminalVisible.value) terminal?.focus();
});
onMounted(async () => {
  if (!container.value) return;
  terminal = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: 'Consolas, "SFMono-Regular", monospace',
    scrollback: 5000,
  });
  fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(container.value);
  applyTheme();
  terminal.onData((data) => {
    if (sessionId)
      void invoke("terminal_write", { sessionId, data }).catch((cause) => {
        error.value = String(cause);
      });
  });
  terminal.onResize(({ cols, rows }) => {
    if (sessionId) void invoke("terminal_resize", { sessionId, cols, rows }).catch(() => {});
  });
  resizeObserver = new ResizeObserver(fitTerminal);
  resizeObserver.observe(container.value);
  themeObserver = new MutationObserver(applyTheme);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  try {
    const target = { kind: "Window" as const, label: getCurrentWindow().label };
    const listeners = await Promise.all([
      listen<{ sessionId: string; data: string }>(
        "terminal:output",
        ({ payload }) => {
          if (payload.sessionId === sessionId)
            terminal?.write(Uint8Array.from(atob(payload.data), (char) => char.charCodeAt(0)));
        },
        { target }
      ),
      listen<{ sessionId: string }>(
        "terminal:exit",
        ({ payload }) => {
          if (payload.sessionId !== sessionId) return;
          sessionId = null;
          terminal?.writeln("\r\n进程已退出");
        },
        { target }
      ),
    ]);
    if (disposed) {
      listeners.forEach((stop) => stop());
      return;
    }
    subscriptions.push(...listeners);
    await nextTick();
    await startSession();
  } catch (cause) {
    error.value = String(cause);
  }
});
onUnmounted(() => {
  disposed = true;
  stopResize();
  resizeObserver?.disconnect();
  themeObserver?.disconnect();
  subscriptions.forEach((stop) => stop());
  if (sessionId) void invoke("terminal_close", { sessionId }).catch(() => {});
  terminal?.dispose();
  terminal = null;
});
</script>

<template>
  <section
    class="terminal-panel"
    :class="{ maximized: terminalMaximized }"
    :style="terminalMaximized ? {} : { height: `${height}px` }"
    aria-label="终端面板"
  >
    <div v-if="!terminalMaximized" class="resize-handle" @pointerdown="startResize" />
    <header>
      <TerminalSquare :size="16" /><span class="title">终端</span>
      <button
        type="button"
        title="重启终端"
        aria-label="重启终端"
        :disabled="starting"
        @click="startSession"
      >
        <RotateCw :size="15" />
      </button>
      <button
        type="button"
        :title="terminalMaximized ? '还原终端' : '最大化终端'"
        :aria-label="terminalMaximized ? '还原终端' : '最大化终端'"
        @click="terminalMaximized = !terminalMaximized"
      >
        <Minimize2 v-if="terminalMaximized" :size="15" /><Maximize2 v-else :size="15" />
      </button>
      <button type="button" title="收起终端" aria-label="收起终端" @click="hideTerminal">
        <X :size="16" />
      </button>
    </header>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div ref="container" class="terminal-container" />
  </section>
</template>

<style scoped>
.terminal-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 120px;
  flex-shrink: 0;
  border-top: 1px solid var(--border-color-1);
  background: var(--background-color);
  color: var(--text-color-1);
}
.terminal-panel.maximized {
  flex: 1;
  height: 0;
}
.resize-handle {
  position: absolute;
  height: 6px;
  left: 0;
  right: 0;
  top: -3px;
  cursor: ns-resize;
  touch-action: none;
  z-index: 1;
}
header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  flex-shrink: 0;
  font-size: 12px;
}
.title {
  flex: 1;
}
button {
  display: flex;
  align-items: center;
  padding: 4px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
button:hover {
  background: var(--hover-color);
}
.terminal-container {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 0 8px 4px;
}
.error {
  margin: 4px 12px;
  color: #cf222e;
  font-size: 12px;
}
</style>
