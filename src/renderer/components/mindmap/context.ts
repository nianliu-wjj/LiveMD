/**
 * 思维导图编辑器共享上下文（对应参考项目的 $bus 事件总线 + Vuex store）
 *
 * 编辑器根组件 MindMapEditor.vue 创建引擎实例后通过 provide 下发，所有工具栏 / 侧边栏 / 弹窗组件
 * 用 useMindMapContext() 取得同一份上下文：
 * - mindMap：引擎实例（shallowRef，引擎内部对象不能被 Vue 深度代理）；
 * - bus：编辑器内事件总线，引擎的全部事件会原样转发到这里（与参考项目 $bus 同名同参），
 *   组件间的界面事件（showNodeImage、showNodeLink …）也走这里；
 * - activeNodes：当前激活节点列表（node_active 事件维护）；
 * - activeSidebar：当前展开的右侧面板（同一时刻只显示一个）；
 * - localConfig：编辑器本地偏好（持久化到 localStorage）。
 *
 * 每个编辑器实例一份上下文，互不串扰（同时打开多个弹窗也安全）。
 */
import {
  inject,
  onScopeDispose,
  provide,
  reactive,
  ref,
  shallowRef,
  type InjectionKey,
  type Ref,
  type ShallowRef,
} from "vue";
import type { MindMapInstance, MindMapNodeInstance } from "@/core/mindmap-engine/full";

type Handler = (...args: any[]) => void;

/** 最小事件总线（编辑器实例内使用） */
export class MindMapBus {
  private handlers = new Map<string, Set<Handler>>();

  on(event: string, handler: Handler): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
    return () => this.off(event, handler);
  }

  off(event: string, handler: Handler): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: string, ...args: any[]): void {
    for (const handler of [...(this.handlers.get(event) ?? [])]) {
      try {
        handler(...args);
      } catch (error) {
        // 单个监听器异常不影响其它监听器
        console.error(`[MindMapBus] 事件「${event}」处理失败:`, error);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}

/** 右侧面板标识 */
export type MindMapSidebarName =
  | ""
  | "nodeStyle"
  | "baseStyle"
  | "theme"
  | "structure"
  | "outline"
  | "shortcutKey"
  | "setting"
  | "nodeIconSidebar"
  | "formulaSidebar"
  | "associativeLineStyle";

/** 编辑器本地偏好（持久化） */
export interface MindMapLocalConfig {
  /** 节点富文本编辑 */
  openNodeRichText: boolean;
  /** 左键框选、右键拖动画布 */
  useLeftKeySelectionRightKeyDrag: boolean;
  /** 显示滚动条 */
  isShowScrollbar: boolean;
  /** 禅模式：隐藏工具栏与侧边栏 */
  isZenMode: boolean;
  /** 显示小地图 */
  showMiniMap: boolean;
}

const LOCAL_CONFIG_KEY = "livemd-mindmap-local-config";

const DEFAULT_LOCAL_CONFIG: MindMapLocalConfig = {
  openNodeRichText: true,
  useLeftKeySelectionRightKeyDrag: false,
  isShowScrollbar: false,
  isZenMode: false,
  showMiniMap: false,
};

function readLocalConfig(): MindMapLocalConfig {
  try {
    const raw = localStorage.getItem(LOCAL_CONFIG_KEY);
    return { ...DEFAULT_LOCAL_CONFIG, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...DEFAULT_LOCAL_CONFIG };
  }
}

export interface MindMapContext {
  mindMap: ShallowRef<MindMapInstance | null>;
  bus: MindMapBus;
  activeNodes: ShallowRef<MindMapNodeInstance[]>;
  activeSidebar: Ref<MindMapSidebarName>;
  localConfig: MindMapLocalConfig;
  /** 当前是否为暗色界面（跟随 LiveMD 主题） */
  isDark: Ref<boolean>;
  /** 是否只读（LiveMD 只读模式） */
  isReadonly: Ref<boolean>;
  /** 是否处于大纲编辑模式 */
  isOutlineEdit: Ref<boolean>;
  /** 可撤销 / 可重做（back_forward 事件维护） */
  canBack: Ref<boolean>;
  canForward: Ref<boolean>;
  /** 设置当前面板；再次设置同一面板时关闭 */
  setActiveSidebar(name: MindMapSidebarName): void;
  /** 修改并持久化本地偏好 */
  setLocalConfig(patch: Partial<MindMapLocalConfig>): void;
  /** 执行引擎命令（对应参考项目 $bus.$emit('execCommand', ...)） */
  execCommand(name: string, ...args: any[]): void;
}

const MIND_MAP_CONTEXT: InjectionKey<MindMapContext> = Symbol("mindMapContext");

/** 创建上下文（编辑器根组件调用一次） */
export function createMindMapContext(options: { isDark: boolean; isReadonly: boolean }): MindMapContext {
  const mindMap = shallowRef<MindMapInstance | null>(null);
  const localConfig = reactive(readLocalConfig());
  const activeSidebar = ref<MindMapSidebarName>("");

  const context: MindMapContext = {
    mindMap,
    bus: new MindMapBus(),
    activeNodes: shallowRef([]),
    activeSidebar,
    localConfig,
    isDark: ref(options.isDark),
    isReadonly: ref(options.isReadonly),
    isOutlineEdit: ref(false),
    canBack: ref(false),
    canForward: ref(false),
    setActiveSidebar(name) {
      activeSidebar.value = activeSidebar.value === name ? "" : name;
    },
    setLocalConfig(patch) {
      Object.assign(localConfig, patch);
      try {
        localStorage.setItem(LOCAL_CONFIG_KEY, JSON.stringify(localConfig));
      } catch (error) {
        console.warn("[MindMapContext] 本地偏好保存失败:", error);
      }
    },
    execCommand(name, ...args) {
      if (!mindMap.value) return;
      console.debug("[MindMapContext] 执行命令:", name);
      mindMap.value.execCommand(name, ...args);
    },
  };
  return context;
}

export function provideMindMapContext(context: MindMapContext): void {
  provide(MIND_MAP_CONTEXT, context);
}

/** 子组件获取上下文 */
export function useMindMapContext(): MindMapContext {
  const context = inject(MIND_MAP_CONTEXT, null);
  if (!context) throw new Error("useMindMapContext 必须在 MindMapEditor 内部使用");
  return context;
}

/** 在组件内订阅总线事件，组件卸载时自动取消（对应参考项目 created 里 $bus.$on + beforeDestroy 里 $bus.$off） */
export function useBusEvent(event: string, handler: Handler): void {
  const { bus } = useMindMapContext();
  const dispose = bus.on(event, handler);
  onScopeDispose(dispose);
}
