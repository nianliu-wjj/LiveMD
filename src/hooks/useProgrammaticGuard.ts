/**
 * 程序更新哨兵（无感渲染 P2 / 承诺 Z4「程序更新零假编辑」）
 *
 * 程序化文档写入（两阶段挂载注入、文件 watcher 回写、检查修复写回等）同样
 * 走 PM 事务 → change 事件。消费端（脏标记、tab.content 回写、自动保存）把
 * 这些回声误判为用户编辑 → 脏标记误亮、保存回环、内容"刷新一下"
 * （docs/SEAMLESS-RENDER-DESIGN.md 1.1 Z4 / 4.2 节，MDmeow 同型防御）。
 *
 * 双保险机制：
 * - **包裹抑制**：runProgrammatic 包裹一次程序化写入，期间 change 事件
 *   一律判假（视图变换语义，不是内容修改）；
 * - **基线核对**：即使抑制遗漏（异步尾巴、未包裹的旁路路径），与基线一致的
 *   change（PM doc 深相等 + 序列化字符串相等）也判假——内容没有任何变化的
 *   "change" 不携带编辑语义；命中即判假，不命中视为真实编辑并重建基线；
 * - **基线重建**：每次被接受的真实编辑与每次程序化写入结束后，基线重建为
 *   当前文档状态，保证后续核对对象始终是"用户看到的最近状态"。
 *
 * 解耦：本模块不 import 编辑器内核，PM doc 以最小结构接口（eq）传入。
 */

/** PM doc 最小结构描述（只用到 eq 深相等） */
interface GuardDoc {
  eq(other: GuardDoc): boolean;
}

export interface ProgrammaticGuard {
  /**
   * 判定一次 change 是否为真实用户编辑。
   * @param doc 当前 PM doc（editor.view.state.doc）；缺省时退化为纯字符串核对
   * @param markdown 当前序列化内容
   * @returns true = 真实编辑（内部已重建基线）；false = 假编辑（跳过消费）
   */
  isRealEdit(doc: GuardDoc | null | undefined, markdown: string): boolean;
  /** 包裹一次程序化写入：期间 change 判假，结束后用快照重建基线 */
  runProgrammatic<T>(fn: () => T): T;
  /** 手动重建基线（未走 runProgrammatic 的写入路径用） */
  refreshBaseline(doc: GuardDoc | null | undefined, markdown: string): void;
  /** 是否处于程序化写入窗口（外部插件 / 调试观测用） */
  isSuppressing(): boolean;
}

export function useProgrammaticGuard(
  /** 程序化写入结束后的文档状态快照提供者（doc + 序列化串） */
  getSnapshot: () => { doc: GuardDoc | null; markdown: string }
): ProgrammaticGuard {
  /** 嵌套包裹深度（restoreDoc 内部再触发 inject 时保持抑制） */
  let suppressing = 0;
  let baselineDoc: GuardDoc | null = null;
  let baselineMarkdown: string | null = null;

  const refreshBaseline = (doc: GuardDoc | null | undefined, markdown: string): void => {
    baselineDoc = doc ?? null;
    baselineMarkdown = markdown;
  };

  const isRealEdit = (doc: GuardDoc | null | undefined, markdown: string): boolean => {
    // 包裹期内：程序化写入的回声，一律判假
    if (suppressing > 0) return false;
    // 基线核对：doc 深相等 + 序列化串相等 → 内容没有任何变化的假编辑。
    // 字符串不等时无需走 doc 深比较（大文档 O(size) 只在字符串相同时发生）
    if (baselineMarkdown === markdown && doc && baselineDoc?.eq(doc)) return false;
    if (baselineMarkdown === markdown && !doc && baselineDoc === null) return false;
    // 真实编辑：基线重建为当前状态（此后连打两字再删回原样，第二次编辑
    // 因基线已前移而仍判真——脏标记语义由消费端对照 originalContent 计算）
    refreshBaseline(doc, markdown);
    return true;
  };

  const runProgrammatic = <T>(fn: () => T): T => {
    suppressing += 1;
    try {
      return fn();
    } finally {
      suppressing -= 1;
      // 写入结束：基线对齐写入后的真实状态（快照取编辑器当前 doc + 序列化串，
      // 序列化复用 getMarkdown 缓存，程序化写入是低频路径，代价可忽略）
      const snapshot = getSnapshot();
      refreshBaseline(snapshot.doc, snapshot.markdown);
    }
  };

  return {
    isRealEdit,
    runProgrammatic,
    refreshBaseline,
    isSuppressing: () => suppressing > 0,
  };
}
