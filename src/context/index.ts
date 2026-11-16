import type { Ref } from "vue";
import { defineComponent, ref } from "vue";
import { createContext } from "./createContext";

interface LivemdContext {
  isCollapsed: Ref<boolean>;
  collapse: () => void;
  expand: () => void;
  toggleCollapse: () => void;
}

const [useLivemd, provideContext] = createContext<LivemdContext>("Livemd");

function initState() {
  const isCollapsed = ref(false);

  function collapse() {
    isCollapsed.value = true;
  }

  function expand() {
    isCollapsed.value = false;
  }

  function toggleCollapse() {
    isCollapsed.value = !isCollapsed.value;
  }

  provideContext({
    isCollapsed,
    collapse,
    expand,
    toggleCollapse,
  });
}

const LivemdProvider = defineComponent((_, { slots }) => {
  initState();

  return () => slots.default?.();
});

export { LivemdProvider, useLivemd };
