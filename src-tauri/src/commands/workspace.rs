use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use regex::Regex;
use tauri::AppHandle;
use tauri::Runtime;

use crate::models::WorkspaceEntry;
use crate::watcher;

const MAX_DEPTH: usize = 10;
const MAX_FILES_PER_DIR: usize = 100;

const IGNORE_PATTERNS: &[&str] = &[
    ".git",
    ".vscode",
    ".idea",
    "node_modules",
    ".next",
    ".nuxt",
    "dist",
    "build",
    "coverage",
    ".DS_Store",
    "Thumbs.db",
];

fn is_supported_workspace_file(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    [".md", ".markdown", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"]
        .iter()
        .any(|extension| lower.ends_with(extension))
}

fn should_ignore_directory(name: &str) -> bool {
    IGNORE_PATTERNS
        .iter()
        .any(|ignored| name.eq_ignore_ascii_case(ignored))
}

fn mtime_ms(path: &Path) -> f64 {
    std::fs::metadata(path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as f64)
        .unwrap_or(0.0)
}

/// 文件名自然排序：把连续数字当作一个整体按数值比较（1, 2, 3, …, 10, 11），
/// 其余字符忽略大小写逐字比较；完全相等时再按原始名称区分大小写，保证排序稳定。
pub fn natural_name_cmp(left: &str, right: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;

    let left_chars: Vec<char> = left.chars().collect();
    let right_chars: Vec<char> = right.chars().collect();
    let (mut i, mut j) = (0usize, 0usize);

    while i < left_chars.len() && j < right_chars.len() {
        let (lc, rc) = (left_chars[i], right_chars[j]);
        if lc.is_ascii_digit() && rc.is_ascii_digit() {
            // 各自取出完整数字段，先比数值（去前导零后按长度、再按字面），再比位数（少的在前，如 01 < 001）
            let li = i;
            while i < left_chars.len() && left_chars[i].is_ascii_digit() {
                i += 1;
            }
            let rj = j;
            while j < right_chars.len() && right_chars[j].is_ascii_digit() {
                j += 1;
            }
            let left_num: String = left_chars[li..i].iter().collect();
            let right_num: String = right_chars[rj..j].iter().collect();
            let left_trim = left_num.trim_start_matches('0');
            let right_trim = right_num.trim_start_matches('0');
            let ordering = left_trim
                .len()
                .cmp(&right_trim.len())
                .then_with(|| left_trim.cmp(right_trim))
                .then_with(|| left_num.len().cmp(&right_num.len()));
            if ordering != Ordering::Equal {
                return ordering;
            }
            continue;
        }

        let ordering = lc
            .to_lowercase()
            .cmp(rc.to_lowercase());
        if ordering != Ordering::Equal {
            return ordering;
        }
        i += 1;
        j += 1;
    }

    (left_chars.len() - i)
        .cmp(&(right_chars.len() - j))
        .then_with(|| left.cmp(right))
}

fn compare_names(left: &WorkspaceEntry, right: &WorkspaceEntry) -> std::cmp::Ordering {
    natural_name_cmp(&left.name, &right.name)
}

fn scan_directory(dir_path: &Path, is_wsl_remote: bool, depth: usize) -> Vec<WorkspaceEntry> {
    if depth > MAX_DEPTH {
        return Vec::new();
    }

    let Ok(read_dir) = std::fs::read_dir(dir_path) else {
        return Vec::new();
    };

    let mut items: Vec<_> = read_dir.flatten().take(MAX_FILES_PER_DIR).collect();
    items.sort_by_key(|entry| entry.file_name());

    let mut directories = Vec::new();
    let mut files = Vec::new();

    for item in items {
        let name = item.file_name().to_string_lossy().to_string();
        let item_path = item.path();
        let file_type = match item.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };

        if file_type.is_symlink() {
            if is_wsl_remote || !is_supported_workspace_file(&name) {
                continue;
            }
            files.push(WorkspaceEntry {
                name,
                path: item_path.to_string_lossy().to_string(),
                is_directory: false,
                mtime: mtime_ms(&item_path),
                children: None,
            });
            continue;
        }

        if file_type.is_dir() {
            if should_ignore_directory(&name) {
                continue;
            }
            let children = scan_directory(&item_path, is_wsl_remote, depth + 1);
            directories.push(WorkspaceEntry {
                name,
                path: item_path.to_string_lossy().to_string(),
                is_directory: true,
                mtime: mtime_ms(&item_path),
                children: Some(children),
            });
        } else if file_type.is_file() && is_supported_workspace_file(&name) {
            files.push(WorkspaceEntry {
                name,
                path: item_path.to_string_lossy().to_string(),
                is_directory: false,
                mtime: mtime_ms(&item_path),
                children: None,
            });
        }
    }

    directories.sort_by(compare_names);
    files.sort_by(compare_names);
    directories.extend(files);
    directories
}

#[tauri::command]
pub async fn workspace_get_directory_files(
    dir_path: String,
) -> Result<Vec<WorkspaceEntry>, String> {
    if dir_path.is_empty() || !Path::new(&dir_path).exists() {
        return Ok(Vec::new());
    }

    let is_wsl_remote = watcher::is_wsl_path(&dir_path);
    tauri::async_runtime::spawn_blocking(move || {
        scan_directory(Path::new(&dir_path), is_wsl_remote, 0)
    })
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn workspace_exists(dir_path: String) -> bool {
    !dir_path.is_empty() && Path::new(&dir_path).exists()
}

#[tauri::command]
pub fn create_file(dir_path: String, file_name: String) -> Result<Option<String>, String> {
    let path = PathBuf::from(&dir_path).join(&file_name);
    match std::fs::write(&path, "") {
        Ok(()) => Ok(Some(path.to_string_lossy().to_string())),
        Err(error) => {
            eprintln!("创建文件失败: {error}");
            Ok(None)
        }
    }
}

#[tauri::command]
pub fn create_folder(dir_path: String, folder_name: String) -> Result<Option<String>, String> {
    let path = PathBuf::from(&dir_path).join(&folder_name);
    match std::fs::create_dir_all(&path) {
        Ok(()) => Ok(Some(path.to_string_lossy().to_string())),
        Err(error) => {
            eprintln!("创建文件夹失败: {error}");
            Ok(None)
        }
    }
}

#[tauri::command]
pub fn delete_file(file_path: String) -> Result<bool, String> {
    let path = Path::new(&file_path);
    let result = if path.is_dir() {
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path)
    };
    match result {
        Ok(()) => Ok(true),
        Err(error) => {
            eprintln!("删除文件失败: {error}");
            Ok(false)
        }
    }
}

#[tauri::command]
pub fn rename_file(old_path: String, new_name: String) -> Result<Option<String>, String> {
    let old = Path::new(&old_path);
    let Some(parent) = old.parent() else {
        return Ok(None);
    };
    let new_path = parent.join(&new_name);
    match std::fs::rename(old, &new_path) {
        Ok(()) => Ok(Some(new_path.to_string_lossy().to_string())),
        Err(error) => {
            eprintln!("重命名文件失败: {error}");
            Ok(None)
        }
    }
}

/// 移动文件到目标目录（目标同名文件由调用方先行确认覆盖）
///
/// - 目标目录不存在时自动创建；
/// - Windows 下 fs::rename 遇到已存在的目标会失败，故先移除目标；
/// - 跨卷移动失败时退化为「复制 + 删除源文件」。
#[tauri::command]
pub fn move_file(file_path: String, target_dir: String) -> Result<Option<String>, String> {
    let source = PathBuf::from(&file_path);
    if !source.is_file() {
        return Ok(None);
    }
    let Some(file_name) = source.file_name() else {
        return Ok(None);
    };

    let target_dir_path = PathBuf::from(&target_dir);
    if let Err(error) = std::fs::create_dir_all(&target_dir_path) {
        eprintln!("移动文件失败（创建目标目录）: {error}");
        return Ok(None);
    }
    let target = target_dir_path.join(file_name);

    if target.exists() && std::fs::remove_file(&target).is_err() {
        eprintln!("移动文件失败: 无法覆盖已存在的目标文件");
        return Ok(None);
    }

    match std::fs::rename(&source, &target) {
        Ok(()) => Ok(Some(target.to_string_lossy().to_string())),
        Err(rename_error) => match std::fs::copy(&source, &target) {
            Ok(_) => match std::fs::remove_file(&source) {
                Ok(()) => Ok(Some(target.to_string_lossy().to_string())),
                Err(remove_error) => {
                    eprintln!("移动文件失败（跨卷删除源文件）: {remove_error}");
                    Ok(None)
                }
            },
            Err(copy_error) => {
                eprintln!("移动文件失败: {rename_error} / {copy_error}");
                Ok(None)
            }
        },
    }
}

/// 复制文件到目标路径（父目录不存在时自动创建）
#[tauri::command]
pub fn copy_file(source_path: String, target_path: String) -> Result<Option<String>, String> {
    let source = Path::new(&source_path);
    if !source.is_file() {
        return Ok(None);
    }

    let target = PathBuf::from(&target_path);
    if let Some(parent) = target.parent() {
        if let Err(error) = std::fs::create_dir_all(parent) {
            eprintln!("复制文件失败（创建目标目录）: {error}");
            return Ok(None);
        }
    }

    match std::fs::copy(source, &target) {
        Ok(_) => Ok(Some(target.to_string_lossy().to_string())),
        Err(error) => {
            eprintln!("复制文件失败: {error}");
            Ok(None)
        }
    }
}

#[tauri::command]
pub fn watch_directory<R: Runtime>(app: AppHandle<R>, dir_path: String) {
    watcher::watch_directory(&app, &dir_path);
}

#[tauri::command]
pub fn unwatch_directory<R: Runtime>(app: AppHandle<R>) {
    watcher::unwatch_directory(&app);
}

#[allow(dead_code)]
fn supported_file_regex() -> &'static Regex {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)\.(?:md|markdown|png|jpe?g|gif|webp|svg|bmp)$")
            .expect("valid workspace file regex")
    })
}

#[cfg(test)]
mod tests {
    use super::natural_name_cmp;
    use std::cmp::Ordering;

    #[test]
    fn sorts_numeric_segments_by_value() {
        let mut names = vec!["10.md", "2.md", "1.md", "11.md", "3.md"];
        names.sort_by(|a, b| natural_name_cmp(a, b));
        assert_eq!(names, vec!["1.md", "2.md", "3.md", "10.md", "11.md"]);
    }

    #[test]
    fn sorts_mixed_prefix_and_numbers() {
        let mut names = vec!["第10章.md", "第2章.md", "第1章.md", "chapter-12.md", "chapter-9.md"];
        names.sort_by(|a, b| natural_name_cmp(a, b));
        assert_eq!(
            names,
            vec!["chapter-9.md", "chapter-12.md", "第1章.md", "第2章.md", "第10章.md"]
        );
    }

    #[test]
    fn ignores_case_but_stays_stable() {
        assert_eq!(natural_name_cmp("Readme.md", "readme.md"), Ordering::Less);
        assert_eq!(natural_name_cmp("a1", "A1"), Ordering::Greater);
        assert_eq!(natural_name_cmp("abc", "abd"), Ordering::Less);
        // 前导零：数值相同时位数少的在前
        assert_eq!(natural_name_cmp("01.md", "001.md"), Ordering::Less);
        assert_eq!(natural_name_cmp("1.md", "01.md"), Ordering::Less);
    }
}
