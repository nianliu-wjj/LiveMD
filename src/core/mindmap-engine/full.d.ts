/**
 * 思维导图引擎类型声明（引擎为移植的 JS 源码，这里只声明本项目用到的公共接口）
 */

/** 节点数据（与 simple-mind-map / .smm 格式一致） */
export interface MindMapNodeData {
  data: {
    text: string;
    uid?: string;
    expand?: boolean;
    richText?: boolean;
    [key: string]: unknown;
  };
  children: MindMapNodeData[];
}

/** 引擎运行时节点实例（只声明常用成员） */
export interface MindMapNodeInstance {
  uid: string;
  isRoot: boolean;
  isGeneralization: boolean;
  layerIndex: number;
  nodeData: MindMapNodeData;
  parent: MindMapNodeInstance | null;
  children: MindMapNodeInstance[];
  getData(key?: string): any;
  getStyle(prop: string, root?: boolean): any;
  setStyle(prop: string, value: unknown): void;
  setStyles(style: Record<string, unknown>): void;
  [key: string]: any;
}

export interface MindMapInstance {
  el: HTMLElement;
  opt: Record<string, any>;
  renderer: {
    activeNodeList: MindMapNodeInstance[];
    root: MindMapNodeInstance | null;
    [key: string]: any;
  };
  view: {
    scale: number;
    enlarge(cx?: number, cy?: number, isTouchPad?: boolean): void;
    narrow(cx?: number, cy?: number, isTouchPad?: boolean): void;
    setScale(scale: number, cx?: number, cy?: number): void;
    fit(getRect?: unknown, enlarge?: boolean, fitPadding?: number): void;
    reset(): void;
    getTransformData(): unknown;
    [key: string]: any;
  };
  command: { history: unknown[]; activeHistoryIndex: number; [key: string]: any };
  keyCommand: { addShortcut(key: string, fn: () => void): void; [key: string]: any };
  [plugin: string]: any;
  on(event: string, fn: (...args: any[]) => void): void;
  off(event: string, fn: (...args: any[]) => void): void;
  emit(event: string, ...args: any[]): void;
  execCommand(name: string, ...args: any[]): void;
  getData(withConfig?: boolean): any;
  setData(data: unknown): void;
  setFullData(data: unknown): void;
  updateData(data: unknown): void;
  setLayout(layout: string): void;
  getLayout(): string;
  setTheme(theme: string, notRender?: boolean): void;
  getTheme(): string;
  setThemeConfig(config: Record<string, unknown>, notRender?: boolean): void;
  getThemeConfig(prop?: string): any;
  getCustomThemeConfig(): Record<string, unknown>;
  updateConfig(opt: Record<string, unknown>): void;
  setMode(mode: "readonly" | "edit"): void;
  resize(): void;
  render(callback?: () => void, source?: string): void;
  reRender(callback?: () => void, source?: string): void;
  export(type: string, isDownload?: boolean, name?: string, ...args: any[]): Promise<any>;
  getSvgData(options?: Record<string, unknown>): any;
  destroy(): void;
}

export interface MindMapStatic {
  new (opt: Record<string, unknown>): MindMapInstance;
  iconList: Array<{ name: string; type: string; list: Array<{ name: string; icon: string }> }>;
  constants: Record<string, any>;
  defaultTheme: Record<string, any>;
  xmind: {
    parseXmindFile(file: File, handleMultiCanvas?: unknown): Promise<MindMapNodeData>;
    transformToXmind(data: MindMapNodeData, name: string): Promise<Blob>;
    [key: string]: any;
  };
  markdown: {
    transformToMarkdown(data: MindMapNodeData): string;
    transformMarkdownTo(markdown: string): MindMapNodeData;
  };
  version: string;
  [key: string]: any;
}

declare const MindMap: MindMapStatic;
export default MindMap;
