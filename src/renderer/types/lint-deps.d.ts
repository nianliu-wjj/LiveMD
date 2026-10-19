/**
 * markdownlint / nspell / dictionary-en 的最小类型声明
 *
 * 为什么手写：tsconfig 的 moduleResolution 为 Node，无法解析 markdownlint 的 .d.mts 产物，
 * 直接 import 会报「找不到类型声明」。这里只声明本仓库实际用到的成员，
 * 既让类型检查通过，也避免把第三方的完整类型面搬进来。
 */

declare module "markdownlint/promise" {
  export interface MarkdownlintFixInfo {
    lineNumber?: number;
    editColumn?: number | null;
    deleteCount?: number | null;
    insertText?: string | null;
  }

  export interface MarkdownlintError {
    lineNumber: number;
    ruleNames: string[];
    ruleDescription: string;
    ruleInformation?: string;
    errorDetail?: string | null;
    fixInfo?: MarkdownlintFixInfo | null;
  }

  export interface MarkdownlintOptions {
    strings: Record<string, string>;
    config?: Record<string, unknown>;
    resultVersion?: number;
  }

  /** 键为 strings 传入的文档名（本项目固定为 document） */
  export type MarkdownlintResult = Record<string, MarkdownlintError[]>;

  export function lint(options: MarkdownlintOptions): Promise<MarkdownlintResult>;
}

declare module "markdownlint" {
  export interface MarkdownlintFixableError {
    lineNumber: number;
    fixInfo?: {
      lineNumber?: number;
      editColumn?: number;
      deleteCount?: number;
      insertText?: string;
    };
  }

  export function applyFixes(input: string, errors: MarkdownlintFixableError[]): string;
}

declare module "nspell" {
  /** Hunspell 词典（aff 规则 + dic 词表），支持 Uint8Array 或字符串两种来源 */
  export interface NspellDictionary {
    aff: Uint8Array | string;
    dic: Uint8Array | string;
  }

  export interface Nspell {
    correct(word: string): boolean;
    suggest(word: string): string[];
    add(word: string): void;
  }

  export default function nspell(dictionary: NspellDictionary): Nspell;
}

declare module "dictionary-en" {
  const dictionary: { aff: Uint8Array; dic: Uint8Array };
  export default dictionary;
}
