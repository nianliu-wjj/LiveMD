use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use regex::Regex;

use crate::file_format::absolute_path;

fn markdown_image_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"!\[([^\]]*)\]\(([^)]+)\)").expect("valid image regex"))
}

fn scheme_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^[a-zA-Z][a-zA-Z\d+\-.]*:").expect("valid scheme regex"))
}

fn hostname_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+(?::\d+)?$")
            .expect("valid hostname regex")
    })
}

pub fn is_absolute_image_directory(input: &str) -> bool {
    if input.is_empty() {
        return false;
    }
    let path = Path::new(input);
    if cfg!(windows) {
        path.is_absolute()
            || input.starts_with("\\\\")
            || input.as_bytes().get(1) == Some(&b':')
    } else {
        path.is_absolute()
    }
}

fn normalize_relative_image_directory(input: &str) -> String {
    let mut value = input.trim();
    while value.starts_with('\\') || value.starts_with('/') {
        value = &value[1..];
    }
    while value.starts_with("./") || value.starts_with(".\\") {
        value = &value[2..];
    }
    value.trim().to_string()
}

pub fn has_uri_scheme(target: &str) -> bool {
    if target.as_bytes().get(1) == Some(&b':')
        && target
            .chars()
            .next()
            .map(|c| c.is_ascii_alphabetic())
            .unwrap_or(false)
    {
        return false;
    }
    scheme_regex().is_match(target)
}

pub fn is_external_link(target: &str) -> bool {
    target.starts_with("//") || (has_uri_scheme(target) && !target.to_ascii_lowercase().starts_with("file:"))
}

pub fn is_obvious_local_path(target: &str) -> bool {
    let bytes = target.as_bytes();
    (bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':')
        || target.starts_with("\\\\")
        || target.starts_with('\\')
        || target.starts_with('/')
        || target.starts_with("./")
        || target.starts_with(".\\")
        || target.starts_with("../")
        || target.starts_with("..\\")
}

pub fn is_likely_hostname_without_protocol(target: &str) -> bool {
    let candidate = target
        .split(['?', '#'])
        .next()
        .unwrap_or_default()
        .trim();
    if candidate.is_empty() || candidate.contains(char::is_whitespace) || candidate.contains('\\') {
        return false;
    }
    if is_obvious_local_path(candidate) || is_external_link(candidate) {
        return false;
    }

    let first_segment = candidate.split('/').next().unwrap_or_default();
    if first_segment.is_empty() {
        return false;
    }

    let lower = first_segment.to_ascii_lowercase();
    if lower == "localhost" || lower.starts_with("localhost:") {
        return true;
    }
    if first_segment.starts_with('[') && first_segment.contains("]:") {
        return true;
    }
    if is_ipv4_with_optional_port(first_segment) {
        return true;
    }
    hostname_regex().is_match(first_segment)
}

fn is_ipv4_with_optional_port(value: &str) -> bool {
    let (address, port) = match value.split_once(':') {
        Some((address, port)) => (address, Some(port)),
        None => (value, None),
    };
    if let Some(port) = port {
        if !port.chars().all(|c| c.is_ascii_digit()) {
            return false;
        }
    }
    let parts: Vec<&str> = address.split('.').collect();
    parts.len() == 4
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.len() <= 3 && part.chars().all(|c| c.is_ascii_digit()))
}

pub fn resolve_local_link_path(target: &str, current_file_path: Option<&str>) -> Option<String> {
    let trimmed = target.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return None;
    }

    if trimmed.to_ascii_lowercase().starts_with("file:") {
        return url::Url::parse(trimmed)
            .ok()
            .and_then(|url| url.to_file_path().ok())
            .map(|path| path.to_string_lossy().to_string());
    }

    if is_external_link(trimmed) {
        return None;
    }

    let clean_path = trimmed
        .split(['?', '#'])
        .next()
        .unwrap_or_default();
    if clean_path.is_empty() {
        return None;
    }

    let path = Path::new(clean_path);
    if path.is_absolute() || clean_path.starts_with("\\\\") {
        return Some(clean_path.to_string());
    }

    let current = current_file_path?;
    let parent = Path::new(current).parent()?;
    let resolved = parent.join(clean_path);
    if resolved.exists() {
        return Some(resolved.to_string_lossy().to_string());
    }

    if is_likely_hostname_without_protocol(trimmed) {
        return None;
    }

    Some(absolute_path(&resolved.to_string_lossy()).to_string_lossy().to_string())
}

pub fn normalize_external_link(target: &str) -> String {
    let trimmed = target.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if is_external_link(trimmed) || trimmed.to_ascii_lowercase().starts_with("file:") {
        return if trimmed.starts_with("//") {
            format!("https:{trimmed}")
        } else {
            trimmed.to_string()
        };
    }
    format!("https://{trimmed}")
}

fn get_image_output_extension(file_name: Option<&str>, mime_type: Option<&str>) -> String {
    if let Some(file_name) = file_name {
        if let Some(ext) = Path::new(file_name).extension().and_then(|ext| ext.to_str()) {
            if !ext.is_empty() {
                return format!(".{}", ext.to_ascii_lowercase());
            }
        }
    }

    match mime_type.unwrap_or_default() {
        "image/jpeg" => ".jpg",
        "image/gif" => ".gif",
        "image/webp" => ".webp",
        "image/svg+xml" => ".svg",
        "image/bmp" => ".bmp",
        _ => ".png",
    }
    .to_string()
}

pub fn create_image_file_name(file_name: Option<&str>, mime_type: Option<&str>) -> String {
    let extension = get_image_output_extension(file_name, mime_type);
    let raw_base_name = file_name
        .and_then(|name| Path::new(name).file_stem().and_then(|stem| stem.to_str()))
        .filter(|stem| !stem.is_empty())
        .unwrap_or("image");

    let safe_base_name: String = raw_base_name
        .chars()
        .map(|ch| {
            if matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
                || (ch as u32) < 32
            {
                '-'
            } else {
                ch
            }
        })
        .collect();
    let safe_base_name = safe_base_name.trim();
    let safe_base_name = if safe_base_name.is_empty() {
        "image"
    } else {
        safe_base_name
    };

    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();

    format!("{safe_base_name}-{millis}{extension}")
}

/// 图片地址的书写偏好（来自设置页「图片语法偏好」）
#[derive(Clone, Copy, Debug, Default)]
pub struct ImagePathOptions {
    /// 优先使用相对路径：目标目录是绝对路径时，只要与文档同盘也写成相对路径
    pub prefer_relative: bool,
    /// 为相对路径添加 ./ 前缀
    pub add_dot_slash: bool,
}

pub fn resolve_image_save_directory(
    configured_path: &str,
    current_file_path: Option<&str>,
    use_file_name_folder: bool,
    app_data_dir: &Path,
) -> (PathBuf, bool) {
    if use_file_name_folder {
        if let Some(current) = current_file_path {
            let current_path = Path::new(current);
            // Typora 约定：同名文件夹为 ${filename}.assets（如 demo.md → demo.assets）
            if let (Some(parent), Some(stem)) = (current_path.parent(), current_path.file_stem()) {
                let folder = format!("{}.assets", stem.to_string_lossy());
                return (parent.join(folder), true);
            }
        }
    }

    let normalized_path = configured_path.trim();
    if is_absolute_image_directory(normalized_path) {
        return (PathBuf::from(normalized_path), false);
    }

    let relative_dir = normalize_relative_image_directory(normalized_path);
    let base_dir = current_file_path
        .and_then(|current| Path::new(current).parent())
        .map(Path::to_path_buf)
        .unwrap_or_else(|| app_data_dir.to_path_buf());

    (absolute_path(&base_dir.join(relative_dir).to_string_lossy()), true)
}

fn relative_path(base_dir: &Path, target: &Path) -> PathBuf {
    let base = absolute_path(&base_dir.to_string_lossy());
    let target = absolute_path(&target.to_string_lossy());
    let base_components: Vec<Component<'_>> = base.components().collect();
    let target_components: Vec<Component<'_>> = target.components().collect();

    let mut common = 0;
    while common < base_components.len()
        && common < target_components.len()
        && base_components[common] == target_components[common]
    {
        common += 1;
    }

    if common == 0 {
        return target;
    }

    let mut result = PathBuf::new();
    for _ in common..base_components.len() {
        result.push("..");
    }
    for component in target_components.iter().skip(common) {
        result.push(component.as_os_str());
    }
    result
}

/// 为相对路径补 ./ 前缀（已带 ./、../ 或本身就是绝对路径时保持原样）
fn with_dot_slash_prefix(path: String) -> String {
    if path.starts_with("./") || path.starts_with("../") || path.starts_with('/') {
        return path;
    }
    if is_absolute_image_directory(&path) || has_uri_scheme(&path) {
        return path;
    }
    format!("./{path}")
}

///
/// 把图片的绝对路径整理成写入 Markdown 的地址
///
/// - `is_relative`：保存目录本身就是相对目录（相对文档目录）
/// - `options.prefer_relative`：绝对目录也优先写成相对文档的路径（跨盘符时自动回落为绝对路径）
/// - `options.add_dot_slash`：相对路径补 ./ 前缀
pub fn resolve_image_markdown_path(
    absolute_file_path: &str,
    is_relative: bool,
    current_file_path: Option<&str>,
    options: ImagePathOptions,
) -> String {
    let use_relative = is_relative || (options.prefer_relative && current_file_path.is_some());
    let result = if !use_relative {
        absolute_file_path.replace('\\', "/")
    } else {
        match current_file_path.and_then(|current| Path::new(current).parent()) {
            Some(parent) => relative_path(parent, Path::new(absolute_file_path))
                .to_string_lossy()
                .replace('\\', "/"),
            None => absolute_file_path.replace('\\', "/"),
        }
    };

    if options.add_dot_slash {
        with_dot_slash_prefix(result)
    } else {
        result
    }
}

pub fn is_app_temp_image_path(image_path: &str, app_data_dir: &Path) -> bool {
    if image_path.is_empty() {
        return false;
    }
    let normalized = absolute_path(image_path);
    let app_data = absolute_path(&app_data_dir.to_string_lossy());
    normalized.starts_with(&app_data) || normalized == app_data
}

pub fn replace_markdown_image_sources<F>(content: &str, mut replacer: F) -> String
where
    F: FnMut(&str) -> Option<String>,
{
    markdown_image_regex()
        .replace_all(content, |caps: &regex::Captures| {
            let full = caps.get(0).unwrap().as_str();
            let alt = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            let src = caps.get(2).map(|m| m.as_str()).unwrap_or("");
            match replacer(src) {
                Some(next) if next != src => format!("![{alt}]({next})"),
                _ => full.to_string(),
            }
        })
        .to_string()
}

pub fn collect_temp_image_sources(content: &str, app_data_dir: &Path) -> Vec<String> {
    let mut sources = Vec::new();
    replace_markdown_image_sources(content, |src| {
        if is_absolute_image_directory(src)
            && is_app_temp_image_path(src, app_data_dir)
            && Path::new(src).exists()
        {
            sources.push(src.to_string());
        }
        None
    });
    sources.sort();
    sources.dedup();
    sources
}

pub fn prepare_image_content_for_save(
    content: &str,
    target_file_path: &str,
    image_local_path: &str,
    use_file_name_folder: bool,
    app_data_dir: &Path,
    options: ImagePathOptions,
) -> String {
    let temp_sources = collect_temp_image_sources(content, app_data_dir);
    if temp_sources.is_empty() {
        return content.to_string();
    }

    let (absolute_dir, is_relative) =
        resolve_image_save_directory(image_local_path, Some(target_file_path), use_file_name_folder, app_data_dir);

    if !is_relative {
        return content.to_string();
    }

    if !absolute_dir.exists() {
        let _ = std::fs::create_dir_all(&absolute_dir);
    }

    let sources = temp_sources;
    for source in &sources {
        let source_path = Path::new(source);
        let Some(file_name) = source_path.file_name() else {
            continue;
        };
        let target_path = absolute_dir.join(file_name);
        if source_path != target_path.as_path() && source_path.exists() {
            let _ = std::fs::copy(source_path, &target_path);
            let _ = std::fs::remove_file(source_path);
        }
    }

    replace_markdown_image_sources(content, |src| {
        if !sources.iter().any(|source| source == src) {
            return None;
        }
        let Some(file_name) = Path::new(src).file_name() else {
            return None;
        };
        let target_path = absolute_dir.join(file_name);
        if !target_path.exists() {
            return None;
        }
        Some(resolve_image_markdown_path(
            &target_path.to_string_lossy(),
            true,
            Some(target_file_path),
            options,
        ))
    })
}

pub fn cleanup_temporary_images(content: &str, app_data_dir: &Path) {
    for image_path in collect_temp_image_sources(content, app_data_dir) {
        let _ = std::fs::remove_file(image_path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_relative_image_path() {
        let result = resolve_image_markdown_path(
            "C:\\docs\\images\\a.png",
            true,
            Some("C:\\docs\\note.md"),
            ImagePathOptions::default(),
        );
        assert_eq!(result, "images/a.png");

        // 开启 ./ 前缀后写入 ./images/a.png
        let with_prefix = resolve_image_markdown_path(
            "C:\\docs\\images\\a.png",
            true,
            Some("C:\\docs\\note.md"),
            ImagePathOptions {
                prefer_relative: true,
                add_dot_slash: true,
            },
        );
        assert_eq!(with_prefix, "./images/a.png");

        // 绝对目录 + 优先相对路径：与文档同盘时写成相对路径
        let prefer_relative = resolve_image_markdown_path(
            "C:\\docs\\assets\\a.png",
            false,
            Some("C:\\docs\\note.md"),
            ImagePathOptions {
                prefer_relative: true,
                add_dot_slash: true,
            },
        );
        assert_eq!(prefer_relative, "./assets/a.png");
    }

    #[test]
    fn detects_external_links() {
        assert!(is_external_link("https://example.com"));
        assert!(is_external_link("//example.com"));
        assert!(!is_external_link("C:\\docs\\a.md"));
        assert_eq!(normalize_external_link("example.com"), "https://example.com");
    }
}
