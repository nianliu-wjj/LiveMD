/**
 * 思维导图编辑器共享上下文（对应参考项目的 $bus 事件总线 + Vuex store + api/index.js 存取函数）
 *
 * 编辑器根组件 MindMapEditor.vue 创建上下文并 provide，所有工具栏 / 侧边栏 / 弹窗组件
 * 通过 useMindMapContext() 取得同一份上下文：
 * - mindMap：引擎实例（shallowRef，引擎内部对象不能被 Vue 深度代理）；
 * - bus：编辑器内事件总线。引擎事件由根组件原样转发到这里（事件名、参数与参考项目 $bus 一致），
 *   组件之间的界面事件（showNodeImage、showNodeLink、execCommand、setData、export …）也走这里；
 * - activeNodes：当前激活节点（node_active 事件维护）；
 * - activeSidebar：当前展开的右侧面板（同一时刻只显示一个；"" 表示全部收起）；
 * - localConfig：编辑器界面偏好（富文本、滚动条、禅模式、鼠标行为 …，持久化）；
 * - engineConfig：「设置」面板修改的引擎选项（对应参考项目 getConfig / storeConfig，持久化，
 *   新打开的思维导图同样生效）。
 *
 * 思维导图数据本身不在这里持久化：编辑结果在「保存」时由根组件 getData(true) 写回 Markdown 代码块，
 * 组件修改了主题 / 结构 / 基础样式等之后调用 notifyChange() 刷新「未保存」状态即可
 * （对应参考项目里的 storeData 调用点）。
 *
 * 每个编辑器实例一份上下文，互不串扰。
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
import { MINDMAP_ENGINE_CONFIG_KEY } from "@/core/utils/mindmap-document";

type Handler = (...args: any[]) => void;

/** 最小事件总线（编辑器实例内使用，接口对齐参考项目的 $bus.$on / $emit / $off） */
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
    // 复制一份再遍历：监听器内部可能 off 自身
    for (const handler of Array.from(this.handlers.get(event) ?? [])) {
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

/**
 * 右侧面板标识（与参考项目 activeSidebar 取值一致）
 * - 右侧触发栏：nodeStyle / baseStyle / theme / structure / outline / setting / shortcutKey
 * - 工具栏触发：nodeIconSidebar / formulaSidebar / noteSidebar / nodeOuterFrameStyle / associativeLineStyle
 */
export type MindMapSidebarName =
  | ""
  | "nodeStyle"
  | "baseStyle"
  | "theme"
  | "structure"
  | "outline"
  | "setting"
  | "shortcutKey"
  | "nodeIconSidebar"
  | "formulaSidebar"
  | "noteSidebar"
  | "nodeOuterFrameStyle"
  | "associativeLineStyle";

/** 编辑器界面偏好（对应参考项目 store.localConfig，去掉 AI 与语言） */
export interface MindMapLocalConfig {
  /** 节点富文本编辑（开启时动态加载 RichText 插件） */
  openNodeRichText: boolean;
  /** 左键框选、右键拖动画布（关闭时左键拖动画布、右键框选） */
  useLeftKeySelectionRightKeyDrag: boolean;
  /** 显示画布滚动条（开启时动态加载 Scrollbar 插件） */
  isShowScrollbar: boolean;
  /** 禅模式：隐藏工具栏、侧边栏与底部栏 */
  isZenMode: boolean;
  /** 拖入 .smm / .json / .xmind / .md 文件时导入 */
  enableDragImport: boolean;
}

const LOCAL_CONFIG_KEY = "livemd-mindmap-local-config";
/** 与代码块预览共用：预览读取其中影响外观的选项，保证与编辑器所见一致 */
const ENGINE_CONFIG_KEY = MINDMAP_ENGINE_CONFIG_KEY;

const DEFAULT_LOCAL_CONFIG: MindMapLocalConfig = {
  openNodeRichText: true,
  useLeftKeySelectionRightKeyDrag: false,
  isShowScrollbar: false,
  isZenMode: false,
  enableDragImport: true,
};

function readJson<T extends object>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return { ...fallback, ...(raw ? (JSON.parse(raw) as Partial<T>) : {}) };
  } catch (error) {
    console.warn(`[MindMapContext] 读取 ${key} 失败，使用默认值:`, error);
    return { ...fallback };
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`[MindMapContext] 保存 ${key} 失败:`, error);
  }
}

/** 读取「设置」面板保存的引擎选项（根组件创建引擎时合并到选项中） */
export function readEngineConfig(): Record<string, any> {
  return readJson<Record<string, any>>(ENGINE_CONFIG_KEY, {});
}

/** 根组件注册的动作（工具栏「保存」「退出」等调用） */
export interface MindMapEditorActions {
  /** 把当前思维导图写回文档（不关闭编辑器） */
  save: () => void;
  /** 退出编辑器（有未保存修改时询问） */
  close: () => void;
}

export interface MindMapContext {
  mindMap: ShallowRef<MindMapInstance | null>;
  bus: MindMapBus;
  /** 当前激活节点列表 */
  activeNodes: ShallowRef<MindMapNodeInstance[]>;
  /** 当前展开的右侧面板，"" 表示收起 */
  activeSidebar: Ref<MindMapSidebarName>;
  localConfig: MindMapLocalConfig;
  /** 「设置」面板修改过的引擎选项 */
  engineConfig: Record<string, any>;
  /** 编辑器界面是否为暗色（默认跟随 LiveMD 主题，底部栏可切换） */
  isDark: Ref<boolean>;
  /** 是否只读（底部栏可切换） */
  isReadonly: Ref<boolean>;
  /** 是否处于大纲编辑模式（全屏大纲） */
  isOutlineEdit: Ref<boolean>;
  /** 可撤销 / 可重做（back_forward 事件维护） */
  canBack: Ref<boolean>;
  canForward: Ref<boolean>;
  /** 是否有未写回文档的修改 */
  isDirty: Ref<boolean>;
  /** 根组件注册的动作 */
  actions: MindMapEditorActions;
  /** 设置当前面板（传 "" 收起），对应参考项目 setActiveSidebar */
  setActiveSidebar(name: MindMapSidebarName | null): void;
  /** 修改并持久化界面偏好，对应参考项目 setLocalConfig */
  setLocalConfig(patch: Partial<MindMapLocalConfig>): void;
  /** 修改引擎选项：立即作用于当前实例并持久化，对应参考项目 mindMap.updateConfig + storeConfig */
  setEngineConfig(patch: Record<string, any>): void;
  /** 执行引擎命令（对应参考项目 $bus.$emit('execCommand', ...)） */
  execCommand(name: string, ...args: any[]): void;
  /** 数据（主题 / 结构 / 样式等）已修改：刷新未保存状态（对应参考项目 storeData 调用点） */
  notifyChange(): void;
}

const MIND_MAP_CONTEXT: InjectionKey<MindMapContext> = Symbol("mindMapContext");

/** 创建上下文（编辑器根组件调用一次） */
export function createMindMapContext(options: {
  isDark: boolean;
  isReadonly: boolean;
}): MindMapContext {
  const mindMap = shallowRef<MindMapInstance | null>(null);
  const localConfig = reactive(readJson(LOCAL_CONFIG_KEY, DEFAULT_LOCAL_CONFIG));
  const engineConfig = reactive(readEngineConfig());
  const activeSidebar = ref<MindMapSidebarName>("");
  const bus = new MindMapBus();

  const context: MindMapContext = {
    mindMap,
    bus,
    activeNodes: shallowRef([]),
    activeSidebar,
    localConfig,
    engineConfig,
    isDark: ref(options.isDark),
    isReadonly: ref(options.isReadonly),
    isOutlineEdit: ref(false),
    canBack: ref(false),
    canForward: ref(false),
    isDirty: ref(false),
    actions: {
      save: () => console.warn("[MindMapContext] save 动作尚未注册"),
      close: () => console.warn("[MindMapContext] close 动作尚未注册"),
    },
    setActiveSidebar(name) {
      activeSidebar.value = name ?? "";
    },
    setLocalConfig(patch) {
      Object.assign(localConfig, patch);
      writeJson(LOCAL_CONFIG_KEY, localConfig);
    },
    setEngineConfig(patch) {
      Object.assign(engineConfig, patch);
      writeJson(ENGINE_CONFIG_KEY, engineConfig);
      mindMap.value?.updateConfig(patch);
    },
    execCommand(name, ...args) {
      if (!mindMap.value) return;
      console.debug("[MindMapContext] 执行命令:", name);
      mindMap.value.execCommand(name, ...args);
    },
    notifyChange() {
      bus.emit("mm:change");
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

/**
 * 在组件内订阅总线事件，组件卸载时自动取消
 * （对应参考项目 created 里 this.$bus.$on + beforeDestroy 里 this.$bus.$off）
 */
export function useBusEvent(event: string, handler: Handler): void {
  const { bus } = useMindMapContext();
  const dispose = bus.on(event, handler);
  onScopeDispose(dispose);
}
