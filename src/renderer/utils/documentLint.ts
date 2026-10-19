/**
 * 文档检查核心模块：拼写检查（nspell + dictionary-en）与格式检查（markdownlint）
 *
 * - 拼写检查：从 Markdown 源文本提取英文词元（排除围栏代码块、行内代码、链接 URL、
 *   图片、HTML 标签、表格分隔行），用 Hunspell 词典校验，产出 `{ line, column, word, suggestions }`；
 * - 格式检查：markdownlint 的 `lint({ strings, config })` 全量规则，错误含
 *   lineNumber / ruleNames / ruleDescription / fixInfo；
 * - 修复：markdownlint `applyFixes` 一次性按行号应用所有 fixInfo，返回修复后文本；
 * - 纯函数 + 无副作用（仅规则配置读写 localStorage），供 useDocumentLint hook 与结果面板消费。
 */
import { applyFixes } from "markdownlint";
import { lint } from "markdownlint/promise";
import nspell from "nspell";
import type { Nspell } from "nspell";
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

/** 构造 markdownlint 配置：默认全部启用，用户显式关闭的规则置 false */
export function buildLintConfig(ruleConfig: RuleConfig): Record<string, unknown> {
  const config: Record<string, unknown> = { default: true };
  for (const rule of MARKDOWNLINT_RULES) {
    if (ruleConfig[rule.code] === false) {
      config[rule.code] = false;
    }
  }
  return config;
}

// ============ 格式检查 ============

export async function runFormatCheck(
  content: string,
  ruleConfig: RuleConfig
): Promise<FormatIssue[]> {
  const errors = await lint({
    strings: { document: content },
    config: buildLintConfig(ruleConfig),
  });
  const raw = errors.document ?? [];
  return raw.map((error) => {
    const [code, alias] = error.ruleNames;
    return {
      line: error.lineNumber,
      ruleCode: code ?? "MD000",
      ruleAlias: alias ?? "",
      description: error.ruleDescription,
      infoUrl:
        error.ruleInformation ??
        `${MARKDOWNLINT_DOC_URL_BASE}/${(code ?? "md001").toLowerCase()}.md`,
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
        if (!dictionary) return null;
        spellChecker = nspell(dictionary);
        return spellChecker;
      })
      .catch(() => {
        // 词典加载失败时拼写检查静默降级为无结果
        spellCheckerLoading = null;
        return null;
      });
  }
  return spellCheckerLoading;
}

/**
 * 逐行屏蔽不应参与拼写检查的区域，返回与原文等长的掩码
 *
 * 掩码为 true 的字符视为「不可见」：围栏代码块、行内代码、链接与图片 URL、
 * HTML 标签、引用前缀、表格分隔行。
 */
function buildLineMask(lines: string[]): boolean[][] {
  let inFencedCode = false;
  let fenceMarker = "";
  return lines.map((line) => {
    const mask: boolean[] = Array.from({ length: line.length }, () => false);
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
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
      // 首字母大写的专有名词放行（Markdown 等）
      if (/^[A-Z][a-z]*$/.test(word)) continue;
      // 去重键不含行号：同一错词全文档只 correct/suggest 一次
      const key = word.toLowerCase();
      if (reported.has(key)) continue;
      if (!checker.correct(word)) {
        reported.add(key);
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

export async function runSpellCheck(
  content: string,
  dictionaryBaseUrl?: string
): Promise<SpellIssue[]> {
  const checker = await getSpellChecker(dictionaryBaseUrl);
  if (!checker) return [];

  const lines = content.split("\n");
  const masks = buildLineMask(lines);
  const reported = new Set<string>();
  const issues: SpellIssue[] = [];

  // 分批扫描 + 批间让出主线程：长任务不再冻结 webview，期间可响应用户输入
  for (let from = 0; from < lines.length; from += SCAN_BATCH) {
    const to = Math.min(from + SCAN_BATCH, lines.length);
    for (const candidate of scanLines(lines, masks, from, to, checker, reported)) {
      if (issues.length >= MAX_SPELL_ISSUES) continue;
      issues.push({ ...candidate, suggestions: getSuggestions(checker, candidate.word) });
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return issues;
}

// ============ 汇总入口 ============

/**
 * 执行完整文档检查（拼写 + 格式），顺序执行并各自让出主线程
 *
 * 不用 Promise.all 并行：markdownlint 本身是同线程长任务，并行只会
 * 让拼写扫描的分批 yield 失去意义（格式检查一跑起来主线程照样冻结）。
 */
export async function runDocumentLint(
  content: string,
  ruleConfig: RuleConfig,
  dictionaryBaseUrl?: string,
  spellEnabled = true
): Promise<DocumentLintResult> {
  // 拼写开关关闭时跳过拼写阶段（省掉词典加载与全文档词元扫描）
  const spellIssues = spellEnabled ? await runSpellCheck(content, dictionaryBaseUrl) : [];
  // 进入格式检查前让出主线程，保证 UI 在两阶段之间仍可响应
  await new Promise((resolve) => setTimeout(resolve, 0));
  const formatIssues = await runFormatCheck(content, ruleConfig);
  return { spellIssues, formatIssues };
}
