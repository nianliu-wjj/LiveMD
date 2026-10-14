/**
 * 代码块语言扩展按需加载
 *
 * `@codemirror/lang-*` 各 LanguageSupport 包体积大（JavaScript / HTML / Markdown 各数百 KB），
 * 静态 import 会全部进入首屏同步依赖。这里改为动态 import + 模块级实例缓存：
 * - 同一语言只加载、实例化一次（`loadedExtensions` 缓存）；并发请求共享同一个 in-flight Promise；
 * - 体积很小的 legacy-modes（StreamLanguage）保留静态 import，同步即可用；
 * - 调用方先用 `getLoadedLanguageExtension` 同步取已缓存实例，未命中再 `loadLanguageExtension` 异步拉取，
 *   拉取完成后通过 Compartment.reconfigure 注入，高亮延后数十毫秒出现，不阻塞 CodeMirror 实例创建。
 */

import type { Extension } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { csharp, scala, kotlin, objectiveC } from "@codemirror/legacy-modes/mode/clike";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { r } from "@codemirror/legacy-modes/mode/r";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { octave } from "@codemirror/legacy-modes/mode/octave";
import { perl } from "@codemirror/legacy-modes/mode/perl";
import { powerShell } from "@codemirror/legacy-modes/mode/powershell";

type LanguageLoader = () => Promise<Extension>;

/** 动态加载的 LanguageSupport 包：key 为语言名（小写，含常用别名） */
const dynamicLoaders: Record<string, LanguageLoader> = {
  javascript: async () => (await import("@codemirror/lang-javascript")).javascript(),
  js: async () => (await import("@codemirror/lang-javascript")).javascript(),
  typescript: async () =>
    (await import("@codemirror/lang-javascript")).javascript({ typescript: true }),
  ts: async () => (await import("@codemirror/lang-javascript")).javascript({ typescript: true }),
  jsx: async () => (await import("@codemirror/lang-javascript")).javascript({ jsx: true }),
  tsx: async () =>
    (await import("@codemirror/lang-javascript")).javascript({ jsx: true, typescript: true }),
  python: async () => (await import("@codemirror/lang-python")).python(),
  py: async () => (await import("@codemirror/lang-python")).python(),
  html: async () => (await import("@codemirror/lang-html")).html(),
  css: async () => (await import("@codemirror/lang-css")).css(),
  json: async () => (await import("@codemirror/lang-json")).json(),
  markdown: async () => (await import("@codemirror/lang-markdown")).markdown(),
  md: async () => (await import("@codemirror/lang-markdown")).markdown(),
  go: async () => (await import("@codemirror/lang-go")).go(),
  golang: async () => (await import("@codemirror/lang-go")).go(),
  java: async () => (await import("@codemirror/lang-java")).java(),
  cpp: async () => (await import("@codemirror/lang-cpp")).cpp(),
  "c++": async () => (await import("@codemirror/lang-cpp")).cpp(),
  c: async () => (await import("@codemirror/lang-cpp")).cpp(),
  php: async () => (await import("@codemirror/lang-php")).php(),
  rust: async () => (await import("@codemirror/lang-rust")).rust(),
  rs: async () => (await import("@codemirror/lang-rust")).rust(),
  sql: async () => (await import("@codemirror/lang-sql")).sql(),
  xml: async () => (await import("@codemirror/lang-xml")).xml(),
  yaml: async () => (await import("@codemirror/lang-yaml")).yaml(),
  yml: async () => (await import("@codemirror/lang-yaml")).yaml(),
};

/** 同步可用的 legacy StreamLanguage 模式（体积小，无需拆包） */
const legacyExtensions: Record<string, () => Extension> = {
  ruby: () => StreamLanguage.define(ruby),
  rb: () => StreamLanguage.define(ruby),
  shell: () => StreamLanguage.define(shell),
  bash: () => StreamLanguage.define(shell),
  sh: () => StreamLanguage.define(shell),
  csharp: () => StreamLanguage.define(csharp),
  "c#": () => StreamLanguage.define(csharp),
  cs: () => StreamLanguage.define(csharp),
  kotlin: () => StreamLanguage.define(kotlin),
  kt: () => StreamLanguage.define(kotlin),
  scala: () => StreamLanguage.define(scala),
  swift: () => StreamLanguage.define(swift),
  "objective-c": () => StreamLanguage.define(objectiveC),
  objc: () => StreamLanguage.define(objectiveC),
  dockerfile: () => StreamLanguage.define(dockerFile),
  toml: () => StreamLanguage.define(toml),
  r: () => StreamLanguage.define(r),
  lua: () => StreamLanguage.define(lua),
  matlab: () => StreamLanguage.define(octave),
  m: () => StreamLanguage.define(octave),
  octave: () => StreamLanguage.define(octave),
  perl: () => StreamLanguage.define(perl),
  pl: () => StreamLanguage.define(perl),
  powershell: () => StreamLanguage.define(powerShell),
  ps1: () => StreamLanguage.define(powerShell),
};

/** 已实例化的语言扩展：同一语言只解析一次 */
const loadedExtensions = new Map<string, Extension>();

/** 加载中的请求：同一语言的并发请求共享同一个 Promise */
const inflightLoads = new Map<string, Promise<Extension | null>>();

/** 是否存在该语言的高亮支持（动态或 legacy） */
export function hasLanguageSupport(language: string): boolean {
  const key = language.toLowerCase();
  return key in dynamicLoaders || key in legacyExtensions;
}

/**
 * 同步获取已可用的语言扩展：已缓存的动态包或 legacy 模式；动态包未加载时返回 null
 */
export function getLoadedLanguageExtension(language: string): Extension | null {
  const key = language.toLowerCase();
  const cached = loadedExtensions.get(key);
  if (cached) return cached;

  const legacy = legacyExtensions[key];
  if (legacy) {
    const extension = legacy();
    loadedExtensions.set(key, extension);
    return extension;
  }
  return null;
}

/**
 * 异步加载语言扩展：缓存命中直接返回，否则动态 import 对应包并缓存实例；
 * 无对应包（纯文本 / mermaid / 未知语言）返回 null。
 */
export function loadLanguageExtension(language: string): Promise<Extension | null> {
  const key = language.toLowerCase();
  const sync = getLoadedLanguageExtension(key);
  if (sync) return Promise.resolve(sync);

  const loader = dynamicLoaders[key];
  if (!loader) return Promise.resolve(null);

  let pending = inflightLoads.get(key);
  if (!pending) {
    pending = loader()
      .then((extension) => {
        loadedExtensions.set(key, extension);
        inflightLoads.delete(key);
        return extension;
      })
      .catch((error: unknown) => {
        // 加载失败（网络 / 分包缺失）：降级为无高亮，下次再请求会重试
        inflightLoads.delete(key);
        console.warn(`[code-block-languages] 语言包加载失败: ${key}`, error);
        return null;
      });
    inflightLoads.set(key, pending);
  }
  return pending;
}
