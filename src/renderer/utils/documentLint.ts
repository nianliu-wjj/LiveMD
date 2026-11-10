/**
 * 文档检查核心模块：拼写检查（nspell + dictionary-en）与格式检查（markdownlint）
 *
 * - 拼写检查：从 Markdown 源文本提取英文词元（排除围栏代码块、行内代码、链接 URL、
 *   图片、HTML 标签、表格分隔行），用 Hunspell 词典校验，产出 `{ line, column, word, suggestions }`；
 * - 格式检查：markdownlint 的 `lint({ strings, config })` 全量规则，错误含
 *   lineNumber / ruleNames / ruleDescription / fixInfo；
 * - 修复：markdownlint `applyFixes` 一次性按行号应用所有 fixInfo，返回修复后文本；
 * - 纯函数 + 无副作用（仅规则配置读写 localStorage），供 useDocumentLint hook 与结果面板消费。
 *
 * 对齐 Typora 格式检查插件的补充（Typora 能查出、此前本项目查不出的根因）：
 * - 自定义规则 MD101/MD102/MD103 经 customRules 传入（见 markdownLintCustomRules.ts）；
 * - MD044 专有名词默认 names 为空数组 → 规则空转，这里注入常见专有名词；
 * - 旧内核缺 Intl.Segmenter 时 markdownlint 模块加载即失败，先注入 polyfill；
 * - 拼写检查接入仓库 cspell.json 的项目词典，并检查句首大写的单词。
 */
// 必须是第一个 import：markdownlint → MD060 → string-width 在模块顶层就会 new Intl.Segmenter()
import "./intlSegmenterPolyfill.ts";
import { applyFixes } from "markdownlint";
import { lint } from "markdownlint/promise";
import nspell from "nspell";
import type { Nspell } from "nspell";
import cspellConfig from "../../../cspell.json" with { type: "json" };
import { CUSTOM_LINT_RULE_CODES, CUSTOM_LINT_RULES } from "./markdownLintCustomRules.ts";
import { MARKDOWNLINT_DOC_URL_BASE, MARKDOWNLINT_RULES } from "./markdownLintRules.ts";

// ============ 类型定义 ============

/** 拼写检查单条结果 */
export interface SpellIssue {
  /** 1-based 行号 */
  line: number;
  /** 1-based 列号 */
  column: number;
  /** 拼写有误的单词 */
  word: string;
  /** 修正建议（最多前 5 个） */
  suggestions: string[];
}

/** 格式检查单条结果（markdownlint LintError 的精简视图） */
export interface FormatIssue {
  /** 1-based 行号 */
  line: number;
  /** 规则编码（MD001 等） */
  ruleCode: string;
  /** 规则别名（heading-increment 等） */
  ruleAlias: string;
  /** 规则说明（markdownlint 原文） */
  description: string;
  /** 规则文档链接 */
  infoUrl: string;
  /** 错误详情（可选） */
  detail: string | null;
  /** 可自动修复时的修复信息 */
  fixInfo: {
    lineNumber: number;
    editColumn?: number | null;
    deleteCount?: number | null;
    insertText?: string | null;
  } | null;
}

/** 文档检查汇总结果 */
export interface DocumentLintResult {
  spellIssues: SpellIssue[];
  formatIssues: FormatIssue[];
  /**
   * 非致命提示（如拼写词典加载失败导致拼写阶段被跳过）
   *
   * 与「检查失败」区分：格式检查结果仍然可信，只是某一阶段没有执行，需要告知用户而不是静默。
   */
  notices?: string[];
}

/** 规则启用状态表：key 为规则编码，value 为是否启用 */
export type RuleConfig = Record<string, boolean>;

/** 规则配置读写所需的最小存储接口（便于注入内存实现做单测） */
export type RuleConfigStorage = Pick<Storage, "getItem" | "setItem">;

// ============ 规则配置（持久化到 localStorage） ============

const RULE_CONFIG_STORAGE_KEY = "livemd-lint-rule-config";

/**
 * 读取规则配置
 *
 * @param storage 默认 window.localStorage；Node 测试环境没有 localStorage 时靠 try/catch 返回空表
 */
export function readRuleConfig(storage?: RuleConfigStorage): RuleConfig {
  try {
    const target = storage ?? (typeof localStorage === "undefined" ? null : localStorage);
    if (!target) return {};
    const raw = target.getItem(RULE_CONFIG_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: RuleConfig = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "boolean") {
        result[key] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

/** 写入规则配置（localStorage 不可用时静默跳过） */
export function writeRuleConfig(config: RuleConfig, storage?: RuleConfigStorage): void {
  try {
    const target = storage ?? (typeof localStorage === "undefined" ? null : localStorage);
    if (!target) return;
    target.setItem(RULE_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // 忽略持久化失败
  }
}

/**
 * MD044（proper-names）默认专有名词表
 *
 * markdownlint 的 MD044 在 names 为空时直接 return，默认配置下等于没开；
 * Typora 插件为它配置了常用技术名词，这里对齐。只收录小写形式几乎不会作为普通词出现的名词，
 * 避免误报（如 HTML/CSS 常以 index.html 这类文件名出现在正文里，故不收录）。
 */
export const DEFAULT_PROPER_NAMES: readonly string[] = [
  "JavaScript",
  "TypeScript",
  "GitHub",
  "GitLab",
  "Markdown",
  "Node.js",
  "Vue",
  "React",
  "macOS",
];

/** 构造 markdownlint 配置：默认全部启用，用户显式关闭的规则置 false */
export function buildLintConfig(ruleConfig: RuleConfig): Record<string, unknown> {
  const config: Record<string, unknown> = { default: true };
  for (const rule of MARKDOWNLINT_RULES) {
    if (ruleConfig[rule.code] === false) {
      config[rule.code] = false;
    }
  }
  // MD044 未被关闭时注入专有名词表：code_blocks=false 不检查代码块与行内代码（变量名、包名大小写合法）。
  // names 每次复制一份：MD044 会对传入数组原地 sort
  if (config.MD044 !== false) {
    config.MD044 = { names: [...DEFAULT_PROPER_NAMES], code_blocks: false };
  }
  return config;
}

// ============ 格式检查 ============

/** 规则文档链接：官方规则指向 markdownlint 仓库文档，自定义规则没有在线文档 */
function resolveRuleInfoUrl(code: string | undefined, ruleInformation?: string): string {
  if (ruleInformation) return ruleInformation;
  if (code && CUSTOM_LINT_RULE_CODES.has(code)) return "";
  return `${MARKDOWNLINT_DOC_URL_BASE}/${(code ?? "md001").toLowerCase()}.md`;
}

export async function runFormatCheck(
  content: string,
  ruleConfig: RuleConfig
): Promise<FormatIssue[]> {
  const startedAt = Date.now();
  const errors = await lint({
    strings: { document: content },
    config: buildLintConfig(ruleConfig),
    customRules: [...CUSTOM_LINT_RULES],
    // 单条规则抛异常时不中断整次检查：markdownlint 会把异常作为一条问题上报，
    // 其他规则的结果照常返回（过去任一规则异常都会让整次检查被吞成「没有发现问题」）
    handleRuleFailures: true,
  });
  const raw = errors.document ?? [];
  console.debug(
    `[documentLint] 格式检查完成：${raw.length} 项问题，耗时 ${Date.now() - startedAt}ms`
  );
  return raw.map((error) => {
    const [code, alias] = error.ruleNames;
    return {
      line: error.lineNumber,
      ruleCode: code ?? "MD000",
      ruleAlias: alias ?? "",
      description: error.ruleDescription,
      infoUrl: resolveRuleInfoUrl(code, error.ruleInformation),
      detail: error.errorDetail ?? null,
      // fixInfo.lineNumber 可缺省（applyFixes 运行时会用外层 lineNumber 补上），这里统一补齐保证自包含
      fixInfo: error.fixInfo
        ? {
            lineNumber: error.fixInfo.lineNumber ?? error.lineNumber,
            editColumn: error.fixInfo.editColumn ?? null,
            deleteCount: error.fixInfo.deleteCount ?? null,
            insertText: error.fixInfo.insertText ?? null,
          }
        : null,
    };
  });
}

/**
 * 修复全部格式问题：applyFixes 一次性应用所有 fixInfo
 *
 * 返回修复后的文本；无可修复项时返回原文。
 */
export function applyAllFixes(content: string, issues: FormatIssue[]): string {
  // applyFixes 接收的是 error 形状数组（{ lineNumber, fixInfo }），
  // 内部以 error.lineNumber 补全 fixInfo.lineNumber，不能直接传 fixInfo 数组
  const errors = issues
    .filter((issue) => issue.fixInfo !== null)
    .map((issue) => ({
      lineNumber: issue.line,
      fixInfo: {
        lineNumber: issue.fixInfo?.lineNumber ?? issue.line,
        editColumn: issue.fixInfo?.editColumn ?? undefined,
        deleteCount: issue.fixInfo?.deleteCount ?? undefined,
        insertText: issue.fixInfo?.insertText ?? undefined,
      },
    }));
  if (errors.length === 0) return content;
  return applyFixes(content, errors);
}

// ============ 拼写检查 ============

let spellChecker: Nspell | null = null;
let spellCheckerLoading: Promise<Nspell | null> | null = null;

/**
 * 懒加载 Hunspell 词典并创建拼写检查器（词典约 540KB，避免阻塞首屏）
 *
 * dictionary-en 是 Node-only 包（顶层 await fs.readFile 读词典文件），
 * 浏览器里 fs/promises 是空壳会抛 Unhandled Promise Rejection，因此：
 * - 浏览器：fetch public/dictionaries/en/ 下的 .aff / .dic 静态资产；
 * - Node（测试环境）：动态 import("dictionary-en") 直接拿现成词典对象。
 * 动态 import 是关键：静态引入会让 Vite 把 Node-only 代码打进浏览器产物。
 */
async function loadDictionary(
  baseUrl?: string
): Promise<{ aff: Uint8Array; dic: Uint8Array } | null> {
  const isNode = typeof process !== "undefined" && process.versions?.node !== undefined;
  if (isNode) {
    try {
      const { default: dictionary } = await import("dictionary-en");
      return dictionary;
    } catch {
      return null;
    }
  }

  try {
    // base: "./"（vite 配置），以当前文档位置解析静态资产路径
    // base: "./"（vite 配置）。主线程以当前文档位置解析；worker 线程中相对路径
    // 基于脚本位置（assets/）解析会指向错误目录，须由调用方显式传入主线程的 base
    const base = baseUrl ?? import.meta.env?.BASE_URL ?? "./";
    const [affRes, dicRes] = await Promise.all([
      fetch(`${base}dictionaries/en/index.aff`),
      fetch(`${base}dictionaries/en/index.dic`),
    ]);
    if (!affRes.ok || !dicRes.ok) return null;
    return {
      aff: new Uint8Array(await affRes.arrayBuffer()),
      dic: new Uint8Array(await dicRes.arrayBuffer()),
    };
  } catch {
    return null;
  }
}

async function getSpellChecker(baseUrl?: string): Promise<Nspell | null> {
  if (spellChecker) return spellChecker;
  if (!spellCheckerLoading) {
    spellCheckerLoading = loadDictionary(baseUrl)
      .then((dictionary) => {
        if (!dictionary) {
          // 词典不可用：清掉加载中的 Promise，下次检查重新尝试（不把一次失败永久缓存）
          spellCheckerLoading = null;
          return null;
        }
        const checker = nspell(dictionary);
        // 接入项目词典：cspell.json 的 words + MD044 专有名词，避免项目内合法词被报拼写错误
        for (const word of PROJECT_DICTIONARY_WORDS) {
          checker.add(word);
        }
        spellChecker = checker;
        console.info(
          `[documentLint] 拼写词典加载完成，已追加项目词典 ${PROJECT_DICTIONARY_WORDS.length} 个词`
        );
        return spellChecker;
      })
      .catch((error) => {
        console.warn("[documentLint] 拼写词典初始化失败:", error);
        spellCheckerLoading = null;
        return null;
      });
  }
  return spellCheckerLoading;
}

/** 读取 cspell.json 的项目词表（字段缺失或格式不符时返回空表） */
function readCspellWords(config: unknown): string[] {
  const words = (config as { words?: unknown } | null)?.words;
  if (!Array.isArray(words)) return [];
  return words.filter((word): word is string => typeof word === "string" && word.length > 0);
}

/** 拼写检查的项目词典：cspell.json 项目词 + MD044 专有名词（按小写去重） */
export const PROJECT_DICTIONARY_WORDS: readonly string[] = (() => {
  const seen = new Set<string>();
  const result: string[] = [];
  // 专有名词拆出其中的英文词元（Node.js → Node），与拼写扫描的分词口径保持一致
  const properNameTokens = DEFAULT_PROPER_NAMES.flatMap((name) => name.match(/[A-Za-z]+/g) ?? []);
  for (const word of [...readCspellWords(cspellConfig), ...properNameTokens]) {
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(word);
  }
  return result;
})();

/** 项目词典的小写集合：cspell 词表大小写不敏感，混合大小写（LiveMD）nspell 无法匹配小写词条，故直接放行 */
const PROJECT_DICTIONARY_KEYS: ReadonlySet<string> = new Set(
  PROJECT_DICTIONARY_WORDS.map((word) => word.toLowerCase())
);

/**
 * 逐行屏蔽不应参与拼写检查的区域，返回与原文等长的掩码
 *
 * 掩码为 true 的字符视为「不可见」：围栏代码块、行内代码、链接与图片 URL、
 * HTML 标签、引用前缀、表格分隔行。
 */
function buildLineMask(lines: string[]): boolean[][] {
  let inFencedCode = false;
  let fenceMarker = "";
  let inMathBlock = false;
  return lines.map((line) => {
    const mask: boolean[] = Array.from({ length: line.length }, () => false);
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenceMatch && !inMathBlock) {
      if (!inFencedCode) {
        inFencedCode = true;
        fenceMarker = fenceMatch[1][0];
      } else if (fenceMarker === fenceMatch[1][0]) {
        inFencedCode = false;
      }
      mask.fill(true);
      return mask;
    }
    if (inFencedCode) {
      mask.fill(true);
      return mask;
    }
    // 数学块（$$ 围栏，可在引用/列表内）整块屏蔽：LaTeX 命令（\frac、\alpha）不是英文单词
    if (/^[\s>]*\$\$/.test(line)) {
      // 单行 $$...$$ 不切换状态；只有单独的 $$ 围栏行才开/关数学块
      const isSingleLine = /^[\s>]*\$\$.*\S.*\$\$\s*$/.test(line);
      if (!isSingleLine) inMathBlock = !inMathBlock;
      mask.fill(true);
      return mask;
    }
    if (inMathBlock) {
      mask.fill(true);
      return mask;
    }

    const maskedSpans: Array<[number, number]> = [];
    // 引用前缀（只屏蔽前缀本身，后续内容继续扫描）
    const quotePrefix = line.match(/^\s*>+\s?/);
    if (quotePrefix) {
      maskedSpans.push([0, quotePrefix[0].length]);
    }
    // 表格分隔行（| --- | :---: 等）整行屏蔽
    if (/^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes("-")) {
      maskedSpans.push([0, line.length]);
    }
    // 行内元素：行内代码 / 图片 / 链接 / 裸 URL / HTML 标签
    const inlinePatterns = [
      /`[^`]*`/g,
      // 行内数学：$$...$$ 或 $...$（开闭 $ 内侧不能是空白，避免把「$5 and $10」这类金额误当公式）
      /\$\$[^$]+\$\$|\$[^$\s](?:[^$]*[^$\s])?\$/g,
      /!\[[^\]]*\]\([^)]*\)/g,
      /\[[^\]]*\]\([^)]*\)/g,
      /https?:\/\/\S+/g,
      /<[a-zA-Z/][^>]*>/g,
    ];
    for (const pattern of inlinePatterns) {
      pattern.lastIndex = 0;
      let inlineMatch: RegExpExecArray | null;
      while ((inlineMatch = pattern.exec(line)) !== null) {
        maskedSpans.push([inlineMatch.index, inlineMatch.index + inlineMatch[0].length]);
      }
    }

    for (const [start, end] of maskedSpans) {
      mask.fill(true, start, end);
    }
    return mask;
  });
}

/** 英文词元：连续字母（含撇号连接的缩写如 don't） */
/** 英文词元：连续字母（含撇号连接的缩写） */
const WORD_PATTERN = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;

/** suggest 结果按「词的小写形式」全局缓存——同一错词全文档只查一次 */
const suggestionCache = new Map<string, string[]>();

function getSuggestions(checker: Nspell, word: string): string[] {
  const cacheKey = word.toLowerCase();
  const cached = suggestionCache.get(cacheKey);
  if (cached) return cached;
  const suggestions = checker.suggest(word).slice(0, 5);
  suggestionCache.set(cacheKey, suggestions);
  return suggestions;
}

/** 单条拼写问题的视图（用于跨行聚合展示） */
interface SpellCandidate {
  line: number;
  column: number;
  word: string;
}

/** 扫描一段行区间，返回未报过的问题列表（纯函数，供分批主循环调用） */
function scanLines(
  lines: string[],
  masks: boolean[][],
  from: number,
  to: number,
  checker: Nspell,
  reported: Set<string>
): SpellCandidate[] {
  const found: SpellCandidate[] = [];
  for (let lineIndex = from; lineIndex < to; lineIndex += 1) {
    const line = lines[lineIndex];
    const mask = masks[lineIndex];
    let match: RegExpExecArray | null;
    WORD_PATTERN.lastIndex = 0;
    while ((match = WORD_PATTERN.exec(line)) !== null) {
      const word = match[0];
      const start = match.index;
      // 词元落在被屏蔽区域时跳过
      if (mask.slice(start, start + word.length).some(Boolean)) continue;
      if (word.length < 3) continue;
      // 全大写视为缩写词（API、TODO 等）
      if (word === word.toUpperCase()) continue;
      // 项目词典命中（大小写不敏感）直接放行
      if (PROJECT_DICTIONARY_KEYS.has(word.toLowerCase())) continue;
      // 注意：首字母大写的词不再整体放行——句首的「Teh」「Recieve」也要查（Typora 的拼写检查同样会标出），
      // nspell 对首字母大写词会同时匹配其小写词条，普通单词在句首不会误报
      // 去重键不含行号：同一错词全文档只 correct/suggest 一次
      const key = word.toLowerCase();
      if (reported.has(key)) continue;
      reported.add(key);
      if (!checker.correct(word)) {
        found.push({ line: lineIndex + 1, column: start + 1, word });
      }
    }
  }
  return found;
}

/** 扫描批次大小：每批让出一次主线程，保证 UI 可响应 */
const SCAN_BATCH = 200;
/** 单词问题总量上限：超出后不再生成条目（控制面板与内存规模） */
const MAX_SPELL_ISSUES = 500;

/** 拼写词典不可用（加载失败 / 静态资产缺失）：拼写阶段无法执行，需要告知用户而不是返回空结果 */
export class SpellDictionaryUnavailableError extends Error {
  constructor() {
    super("拼写词典加载失败，本次未执行拼写检查");
    this.name = "SpellDictionaryUnavailableError";
  }
}

export async function runSpellCheck(
  content: string,
  dictionaryBaseUrl?: string,
  includeSuggestions = true
): Promise<SpellIssue[]> {
  const checker = await getSpellChecker(dictionaryBaseUrl);
  // 过去这里返回 []，词典加载失败会被误报成「没有拼写问题」
  if (!checker) throw new SpellDictionaryUnavailableError();

  const lines = content.split("\n");
  const masks = buildLineMask(lines);
  const reported = new Set<string>();
  const issues: SpellIssue[] = [];

  // 分批扫描 + 批间让出主线程：长任务不再冻结 webview，期间可响应用户输入
  for (let from = 0; from < lines.length; from += SCAN_BATCH) {
    const to = Math.min(from + SCAN_BATCH, lines.length);
    for (const candidate of scanLines(lines, masks, from, to, checker, reported)) {
      if (issues.length >= MAX_SPELL_ISSUES) continue;
      issues.push({
        ...candidate,
        suggestions: includeSuggestions ? getSuggestions(checker, candidate.word) : [],
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return issues;
}

// ============ 汇总入口 ============

/**
 * 执行完整文档检查：先发布格式结果，再执行拼写检查
 *
 * 不用 Promise.all 并行：markdownlint 本身是同线程长任务，并行只会
 * 让拼写扫描的分批 yield 失去意义（格式检查一跑起来主线程照样冻结）。
 */
export async function runDocumentLint(
  content: string,
  ruleConfig: RuleConfig,
  dictionaryBaseUrl?: string,
  spellEnabled = true,
  onFormatResult?: (result: DocumentLintResult) => void,
  includeSuggestions = true
): Promise<DocumentLintResult> {
  // 格式结果先返回，避免词典加载和拼写建议计算阻塞格式列表。
  const formatIssues = await runFormatCheck(content, ruleConfig);
  onFormatResult?.({ formatIssues, spellIssues: [] });
  const notices: string[] = [];
  // 拼写开关关闭时跳过拼写阶段（省掉词典加载与全文档词元扫描）
  let spellIssues: SpellIssue[] = [];
  if (spellEnabled) {
    try {
      spellIssues = await runSpellCheck(content, dictionaryBaseUrl, includeSuggestions);
    } catch (error) {
      // 拼写阶段失败不拖垮格式检查，但必须作为提示透出（不能静默成「没有拼写问题」）
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[documentLint] 拼写检查失败，已跳过:", message);
      notices.push(message);
    }
  }
  // 进入格式检查前让出主线程，保证 UI 在两阶段之间仍可响应
  await new Promise((resolve) => setTimeout(resolve, 0));
  // 格式检查失败（规则加载失败等）直接向上抛，由调用方展示为「检查失败」
  return notices.length > 0
    ? { spellIssues, formatIssues, notices }
    : { spellIssues, formatIssues };
}
