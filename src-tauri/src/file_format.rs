use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use regex::Regex;

use crate::models::{FileTraits, LoadedFile};

fn heading_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$").expect("valid heading regex"))
}

fn livemd_markdown_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"!\[([^\]]*)\]\(livemd:///?([^)]+)\)")
            .expect("valid livemd markdown regex")
    })
}

fn livemd_html_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"(?i)<img(\s[^>]*?)src=(["'])livemd:///?([^"']+)(["'])([^>]*)>"#)
            .expect("valid livemd html regex")
    })
}

pub fn detect_file_traits(raw: &str) -> FileTraits {
    FileTraits {
        has_bom: raw.starts_with('\u{feff}'),
        line_ending: if raw.contains("\r\n") { "crlf" } else { "lf" }.to_string(),
        has_trailing_newline: raw.ends_with('\n'),
    }
}

pub fn normalize_markdown(text: &str) -> String {
    text.strip_prefix('\u{feff}')
        .unwrap_or(text)
        .replace("\r\n", "\n")
}

pub fn restore_file_traits(content: &str, traits: Option<&FileTraits>) -> String {
    let Some(traits) = traits else {
        return content.to_string();
    };

    let mut result = content.to_string();

    if traits.line_ending == "crlf" {
        result = result.replace('\n', "\r\n");
    }

    if traits.has_trailing_newline {
        let eol = if traits.line_ending == "crlf" { "\r\n" } else { "\n" };
        if !result.ends_with(eol) {
            result.push_str(eol);
        }
    } else {
        while result.ends_with("\r\n") {
            result.truncate(result.len() - 2);
        }
        while result.ends_with('\n') {
            result.truncate(result.len() - 1);
        }
    }

    if traits.has_bom {
        result.insert(0, '\u{feff}');
    }

    result
}

fn extract_relative_path(url_content: &str) -> Option<String> {
    // 以第一个 "/" 为界切分 base64 段与相对路径；前段做字符集 + 长度预检后实际解码校验。
    // 原实现要求 "=" padding，但 3 字节倍数编码无 padding（如 /test/md. -> L3Rlc3QvbWQu）
    // 会被误判走兜底规则，这里与前端 resolveLivemdUrl 的切分规则保持一致。
    if let Some(index) = url_content.find('/') {
        let (encoded, relative) = url_content.split_at(index);
        let is_base64_segment = !encoded.is_empty()
            && encoded.len() % 4 == 0
            && encoded
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '/' || c == '=');
        if is_base64_segment && STANDARD.decode(encoded).is_ok() {
            return Some(relative[1..].to_string());
        }
    }

    if let Some(index) = url_content.find("/./") {
        return Some(url_content[index + 1..].to_string());
    }

    if let Some(index) = url_content.rfind('/') {
        if index > 0 {
            let possible = &url_content[index + 1..];
            let has_extension = possible
                .rsplit_once('.')
                .map(|(_, ext)| !ext.is_empty())
                .unwrap_or(false);
            if has_extension {
                return Some(possible.to_string());
            }
        }
    }

    None
}

pub fn cleanup_protocol_urls(content: &str) -> String {
    // 内容特征短路：绝大多数文档不含遗留协议字面量，直接返回原串，
    // 跳过下面两次全量正则扫描（只查一个字节特征，开销远低于 regex；读文件热路径 95%+ 命中）
    if !content.contains("livemd://") {
        return content.to_string();
    }

    let result = livemd_markdown_regex().replace_all(content, |caps: &regex::Captures| {
        let alt = caps.get(1).map(|m| m.as_str()).unwrap_or("");
        let url_content = caps.get(2).map(|m| m.as_str()).unwrap_or("");
        match extract_relative_path(url_content) {
            Some(relative) => format!("![{alt}]({relative})"),
            None => caps.get(0).unwrap().as_str().to_string(),
        }
    });

    livemd_html_regex()
        .replace_all(&result, |caps: &regex::Captures| {
            let before = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            let quote = caps.get(2).map(|m| m.as_str()).unwrap_or("\"");
            let url_content = caps.get(3).map(|m| m.as_str()).unwrap_or("");
            let end_quote = caps.get(4).map(|m| m.as_str()).unwrap_or("\"");
            let after = caps.get(5).map(|m| m.as_str()).unwrap_or("");
            if quote != end_quote {
                return caps.get(0).unwrap().as_str().to_string();
            }
            match extract_relative_path(url_content) {
                Some(relative) => format!("<img{before}src={quote}{relative}{quote}{after}>"),
                None => caps.get(0).unwrap().as_str().to_string(),
            }
        })
        .to_string()
}

const INVALID_FILE_NAME_CHARS: &[char] = &['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
const MAX_TITLE_FILE_NAME_LENGTH: usize = 80;
const FALLBACK_CONTENT_LENGTH: usize = 15;

fn take_chars(value: &str, max_length: usize) -> String {
    value.chars().take(max_length).collect()
}

fn sanitize_file_name_base(value: &str) -> String {
    let mut sanitized = String::with_capacity(value.len());
    for ch in value.chars() {
        if INVALID_FILE_NAME_CHARS.contains(&ch) || (ch as u32) < 32 {
            sanitized.push(' ');
        } else {
            sanitized.push(ch);
        }
    }

    let collapsed = sanitized.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = collapsed.trim_end_matches(['.', ' ']).trim();
    if trimmed.is_empty() || is_reserved_windows_name(trimmed) {
        return "Untitled".to_string();
    }
    trimmed.to_string()
}

fn is_reserved_windows_name(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    matches!(
        lower.as_str(),
        "con" | "prn" | "aux" | "nul"
    ) || (lower.starts_with("com")
        && lower.len() == 4
        && lower.as_bytes()[3].is_ascii_digit()
        && lower.as_bytes()[3] != b'0')
        || (lower.starts_with("lpt")
            && lower.len() == 4
            && lower.as_bytes()[3].is_ascii_digit()
            && lower.as_bytes()[3] != b'0')
}

fn extract_first_heading(content: &str) -> Option<String> {
    for line in content.lines() {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if let Some(captures) = heading_regex().captures(line) {
            let title = captures.get(1).map(|m| m.as_str().trim()).unwrap_or("");
            if !title.is_empty() {
                return Some(title.to_string());
            }
        }
    }
    None
}

fn ensure_markdown_extension(file_name_base: &str) -> String {
    let lower = file_name_base.to_ascii_lowercase();
    if lower.ends_with(".md") || lower.ends_with(".markdown") {
        file_name_base.to_string()
    } else {
        format!("{file_name_base}.md")
    }
}

pub fn create_default_markdown_file_name(content: &str) -> String {
    let first_heading = extract_first_heading(content);
    let source = match &first_heading {
        Some(heading) => Some(take_chars(heading, MAX_TITLE_FILE_NAME_LENGTH)),
        None => {
            let collapsed = content.split_whitespace().collect::<Vec<_>>().join(" ");
            let fallback = take_chars(collapsed.trim(), FALLBACK_CONTENT_LENGTH);
            if fallback.is_empty() { None } else { Some(fallback) }
        }
    };

    ensure_markdown_extension(&sanitize_file_name_base(&source.unwrap_or_default()))
}

fn strip_wrapping_quotes(input: &str) -> &str {
    let bytes = input.as_bytes();
    if bytes.len() >= 2 {
        let first = bytes[0];
        let last = bytes[bytes.len() - 1];
        if (first == b'"' && last == b'"') || (first == b'\'' && last == b'\'') {
            return &input[1..input.len() - 1];
        }
    }
    input
}

pub fn normalize_markdown_file_path(input: &str) -> String {
    let mut value = strip_wrapping_quotes(input.trim()).to_string();

    while value.len() > 1 {
        let last = value.chars().last().unwrap_or_default();
        if last != '\\' && last != '/' {
            break;
        }
        let path = Path::new(&value);
        match path.parent() {
            Some(parent) if !parent.as_os_str().is_empty() => {
                value.pop();
            }
            _ => break,
        }
    }

    value
}

pub fn is_markdown_file_path(input: &str) -> bool {
    let normalized = normalize_markdown_file_path(input);
    let extension = Path::new(&normalized)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default();
    extension.eq_ignore_ascii_case("md") || extension.eq_ignore_ascii_case("markdown")
}

pub fn absolute_path(input: &str) -> PathBuf {
    let path = Path::new(input);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf())
    }
}

pub fn read_markdown_file(file_path: &str) -> Option<LoadedFile> {
    let normalized = normalize_markdown_file_path(file_path);
    if normalized.is_empty() || !is_markdown_file_path(&normalized) {
        return None;
    }

    let path = absolute_path(&normalized);
    let metadata = std::fs::metadata(&path).ok()?;
    if !metadata.is_file() {
        return None;
    }

    let bytes = std::fs::read(&path).ok()?;
    let raw = String::from_utf8_lossy(&bytes);
    let file_traits = detect_file_traits(&raw);
    let content = cleanup_protocol_urls(&normalize_markdown(&raw));

    Some(LoadedFile {
        file_path: normalized,
        content,
        file_traits,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_and_restores_traits() {
        let raw = "\u{feff}# 标题\r\n正文\r\n";
        let traits = detect_file_traits(raw);
        assert!(traits.has_bom);
        assert_eq!(traits.line_ending, "crlf");
        assert!(traits.has_trailing_newline);
        assert_eq!(normalize_markdown(raw), "# 标题\n正文\n");
        assert_eq!(restore_file_traits("# 标题\n正文\n", Some(&traits)), raw);
    }

    #[test]
    fn creates_default_file_name_from_heading() {
        assert_eq!(
            create_default_markdown_file_name("正文\n\n# 第一标题\n\n## 第二标题"),
            "第一标题.md"
        );
        assert_eq!(
            create_default_markdown_file_name("这是一段没有标题的正文内容，后面还有更多文字"),
            "这是一段没有标题的正文内容，后.md"
        );
        assert_eq!(create_default_markdown_file_name("# a/b:c*?"), "a b c.md");
        assert_eq!(create_default_markdown_file_name("# CON"), "Untitled.md");
    }

    #[test]
    fn cleanup_protocol_urls_short_circuits_plain_content() {
        // 不含 livemd:// 特征的内容走短路分支，必须原样返回
        let plain = "# 标题\n\n![a](img/a.png)\n<img src=\"b.png\" alt=\"x\">\n";
        assert_eq!(cleanup_protocol_urls(plain), plain);
        assert_eq!(cleanup_protocol_urls(""), "");
    }

    #[test]
    fn cleans_legacy_livemd_urls() {
        // 无 padding 的 base64 段（9 字节 -> 12 字符，无 '='）
        assert_eq!(
            cleanup_protocol_urls("![a](livemd://L3Rlc3QvbWQu/b/c.png)"),
            "![a](b/c.png)"
        );
        // 带 padding 的 base64 段
        assert_eq!(
            cleanup_protocol_urls("![a](livemd://L3Rlc3QvbWQuZA==/img/a.png)"),
            "![a](img/a.png)"
        );
        // HTML img 形式的 livemd:// 链接
        assert_eq!(
            cleanup_protocol_urls(r#"<img src="livemd://L3Rlc3QvbWQu/img/a.png" alt="x">"#),
            r#"<img src="img/a.png" alt="x">"#
        );
        // 非 base64 段走兜底规则（取末段文件名）
        assert_eq!(
            cleanup_protocol_urls("![a](livemd://assets/img/a.png)"),
            "![a](a.png)"
        );
    }
}
