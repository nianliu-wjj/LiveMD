//! 工作区全文搜索
//!
//! 对应 typora_plugin 的 search_multi / ripgrep 能力：
//! 递归扫描工作区内的文本文件，返回匹配行及上下文预览。

use std::path::{Path, PathBuf};

use regex::Regex;
use regex::RegexBuilder;
use serde::{Deserialize, Serialize};

const MAX_DEPTH: usize = 24;
const MAX_SCANNED_FILES: usize = 20_000;
const MAX_FILE_SIZE: u64 = 2 * 1024 * 1024;
const MAX_RESULTS_PER_FILE: usize = 50;
const DEFAULT_MAX_RESULTS: usize = 500;
const MAX_ALLOWED_RESULTS: usize = 2000;
const PREVIEW_MAX_CHARS: usize = 200;
const PREVIEW_LEAD_CHARS: usize = 40;

const IGNORED_DIRS: &[&str] = &[
    ".git",
    ".svn",
    ".hg",
    ".idea",
    ".vscode",
    "node_modules",
    "dist",
    "build",
    "target",
    ".next",
    ".nuxt",
    "coverage",
    ".cache",
    ".obsidian",
    "__pycache__",
    ".venv",
    "venv",
];

/// 参与搜索的文本文件扩展名
const SEARCHABLE_EXTENSIONS: &[&str] = &[
    "md", "markdown", "mdown", "mkd", "txt", "text", "json", "jsonc", "yaml", "yml", "toml", "ini",
    "cfg", "conf", "js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts", "vue", "svelte", "html",
    "htm", "css", "scss", "less", "sass", "xml", "svg", "csv", "tsv", "log", "py", "rs", "go",
    "java", "kt", "kts", "c", "h", "cpp", "hpp", "cc", "hh", "cs", "php", "rb", "sh", "bash", "zsh",
    "bat", "cmd", "ps1", "sql", "lua", "r", "dart", "swift", "m", "mm", "tex", "bib",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchWorkspaceOptions {
    pub root: String,
    pub query: String,
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default)]
    pub use_regex: bool,
    pub max_results: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchMatch {
    pub path: String,
    pub line: usize,
    pub column: usize,
    pub preview: String,
    /// 预览文本中匹配片段起始位置（字符索引）
    pub match_start: usize,
    /// 匹配片段长度（字符数）
    pub match_length: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchResult {
    pub matches: Vec<WorkspaceSearchMatch>,
    pub truncated: bool,
    pub scanned_files: usize,
}

struct SearchState {
    matches: Vec<WorkspaceSearchMatch>,
    truncated: bool,
    scanned_files: usize,
    max_results: usize,
}

impl SearchState {
    fn is_full(&self) -> bool {
        self.matches.len() >= self.max_results
    }
}

fn has_searchable_extension(path: &Path) -> bool {
    match path.extension().and_then(|ext| ext.to_str()) {
        Some(extension) => {
            let lower = extension.to_ascii_lowercase();
            SEARCHABLE_EXTENSIONS.iter().any(|item| *item == lower)
        }
        // 无扩展名的文本文件（Dockerfile、LICENSE 等）也参与搜索
        None => true,
    }
}

fn should_skip_dir(name: &str) -> bool {
    if name.starts_with('.') {
        return true;
    }
    IGNORED_DIRS
        .iter()
        .any(|ignored| name.eq_ignore_ascii_case(ignored))
}

/// 构建预览片段：长行截取匹配位置周围的内容
fn build_preview(line: &str, pattern: &Regex) -> Option<(String, usize, usize)> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    let matched = pattern.find(trimmed)?;
    let char_start = trimmed[..matched.start()].chars().count();
    let match_chars = trimmed[matched.start()..matched.end()].chars().count();
    let total_chars = trimmed.chars().count();

    let (slice_start, slice_end) = if total_chars <= PREVIEW_MAX_CHARS {
        (0, total_chars)
    } else {
        let desired_start = char_start.saturating_sub(PREVIEW_LEAD_CHARS);
        let max_start = total_chars.saturating_sub(PREVIEW_MAX_CHARS);
        let slice_start = desired_start.min(max_start);
        (slice_start, (slice_start + PREVIEW_MAX_CHARS).min(total_chars))
    };

    let preview: String = trimmed
        .chars()
        .skip(slice_start)
        .take(slice_end - slice_start)
        .collect();

    Some((preview, char_start - slice_start, match_chars))
}

fn search_file(path: &Path, pattern: &Regex, state: &mut SearchState) {
    let Ok(metadata) = std::fs::metadata(path) else {
        return;
    };
    if !metadata.is_file() || metadata.len() > MAX_FILE_SIZE {
        return;
    }

    let Ok(bytes) = std::fs::read(path) else {
        return;
    };
    // 跳过非 UTF-8（多为二进制）文件
    let Ok(content) = String::from_utf8(bytes) else {
        return;
    };

    state.scanned_files += 1;
    if state.scanned_files > MAX_SCANNED_FILES {
        state.truncated = true;
        return;
    }

    let path_string = path.to_string_lossy().to_string();
    let mut per_file = 0usize;

    for (line_index, line) in content.lines().enumerate() {
        if state.is_full() {
            state.truncated = true;
            return;
        }
        let Some((preview, match_start, match_length)) = build_preview(line, pattern) else {
            continue;
        };

        state.matches.push(WorkspaceSearchMatch {
            path: path_string.clone(),
            line: line_index + 1,
            column: match_start + 1,
            preview,
            match_start,
            match_length,
        });

        per_file += 1;
        if per_file >= MAX_RESULTS_PER_FILE {
            break;
        }
    }
}

fn search_directory(dir: &Path, pattern: &Regex, state: &mut SearchState, depth: usize) {
    if depth > MAX_DEPTH || state.is_full() || state.scanned_files > MAX_SCANNED_FILES {
        return;
    }

    let Ok(read_dir) = std::fs::read_dir(dir) else {
        return;
    };

    let mut entries: Vec<PathBuf> = read_dir.flatten().map(|entry| entry.path()).collect();
    entries.sort();

    for entry in entries {
        if state.is_full() || state.scanned_files > MAX_SCANNED_FILES {
            state.truncated = true;
            return;
        }

        let Ok(file_type) = std::fs::symlink_metadata(&entry) else {
            continue;
        };
        if file_type.file_type().is_symlink() {
            continue;
        }

        if file_type.is_dir() {
            let name = entry.file_name().and_then(|name| name.to_str()).unwrap_or("");
            if should_skip_dir(name) {
                continue;
            }
            search_directory(&entry, pattern, state, depth + 1);
        } else if file_type.is_file() && has_searchable_extension(&entry) {
            search_file(&entry, pattern, state);
        }
    }
}

fn run_search(options: SearchWorkspaceOptions) -> Result<WorkspaceSearchResult, String> {
    let query = options.query.trim();
    if query.is_empty() {
        return Ok(WorkspaceSearchResult {
            matches: Vec::new(),
            truncated: false,
            scanned_files: 0,
        });
    }

    let root = Path::new(&options.root);
    if options.root.trim().is_empty() || !root.is_dir() {
        return Err("工作区目录不存在".to_string());
    }

    let pattern_source = if options.use_regex {
        query.to_string()
    } else {
        regex::escape(query)
    };
    let pattern = RegexBuilder::new(&pattern_source)
        .case_insensitive(!options.case_sensitive)
        .build()
        .map_err(|error| format!("正则表达式无效: {error}"))?;

    let max_results = options
        .max_results
        .unwrap_or(DEFAULT_MAX_RESULTS)
        .clamp(1, MAX_ALLOWED_RESULTS);

    let mut state = SearchState {
        matches: Vec::new(),
        truncated: false,
        scanned_files: 0,
        max_results,
    };
    search_directory(root, &pattern, &mut state, 0);

    state
        .matches
        .sort_by(|left, right| left.path.cmp(&right.path).then(left.line.cmp(&right.line)));

    Ok(WorkspaceSearchResult {
        matches: state.matches,
        truncated: state.truncated,
        scanned_files: state.scanned_files,
    })
}

#[tauri::command]
pub async fn search_workspace(
    options: SearchWorkspaceOptions,
) -> Result<WorkspaceSearchResult, String> {
    tauri::async_runtime::spawn_blocking(move || run_search(options))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_workspace(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("livemd-search-{name}-{nanos}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn finds_matches_case_insensitively_in_markdown() {
        let dir = temp_workspace("basic");
        fs::write(
            dir.join("note.md"),
            "# 标题\nHello LiveMD\nsecond hello line\n",
        )
        .expect("write note");

        let result = run_search(SearchWorkspaceOptions {
            root: dir.to_string_lossy().to_string(),
            query: "hello".to_string(),
            case_sensitive: false,
            use_regex: false,
            max_results: None,
        })
        .expect("search");

        assert_eq!(result.matches.len(), 2);
        assert_eq!(result.matches[0].line, 2);
        assert_eq!(result.matches[1].line, 3);
        assert!(result.matches[0].preview.contains("Hello"));

        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn honors_case_sensitivity_and_skips_ignored_directories() {
        let dir = temp_workspace("case");
        fs::create_dir_all(dir.join("node_modules")).expect("mkdir");
        fs::write(dir.join("note.md"), "Hello\nhello\n").expect("write note");
        fs::write(dir.join("node_modules").join("dep.md"), "hello\n").expect("write dep");

        let result = run_search(SearchWorkspaceOptions {
            root: dir.to_string_lossy().to_string(),
            query: "Hello".to_string(),
            case_sensitive: true,
            use_regex: false,
            max_results: None,
        })
        .expect("search");

        assert_eq!(result.matches.len(), 1);
        assert_eq!(result.matches[0].line, 1);

        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn supports_regular_expressions() {
        let dir = temp_workspace("regex");
        fs::write(dir.join("note.md"), "version 1.2.3\nversion abc\n").expect("write note");

        let result = run_search(SearchWorkspaceOptions {
            root: dir.to_string_lossy().to_string(),
            query: r"version \d+\.\d+\.\d+".to_string(),
            case_sensitive: true,
            use_regex: true,
            max_results: None,
        })
        .expect("search");

        assert_eq!(result.matches.len(), 1);
        assert_eq!(result.matches[0].line, 1);

        fs::remove_dir_all(dir).ok();
    }
}
