import { ref } from "vue";

export const terminalVisible = ref(false);
export const terminalMaximized = ref(false);

export function toggleTerminal(): void {
  if (window.electronAPI.isMobile) return;
  terminalVisible.value = !terminalVisible.value;
  if (!terminalVisible.value) terminalMaximized.value = false;
}

export function hideTerminal(): void {
  terminalVisible.value = false;
  terminalMaximized.value = false;
}

export default function useTerminal() {
  return { terminalVisible, terminalMaximized, toggleTerminal, hideTerminal };
}
