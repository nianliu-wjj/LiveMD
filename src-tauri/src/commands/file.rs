use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use base64::Engine as _;

use tauri::{AppHandle, Manager, Runtime, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::file_format::{
    create_default_markdown_file_name, detect_file_traits, normalize_markdown, read_markdown_file,
    restore_file_traits,
};
use crate::models::{
    FileTraits, LoadedFile, MobileDocumentInfo, SaveAsPayload, SavePayload, SaveResult,
};
use crate::paths::{cleanup_temporary_images, prepare_image_content_for_save, ImagePathOptions};

/// 读取本地文件并返回 Base64 内容（导出 HTML 时用于内联本地图片）
///
/// 与前端 fetch(asset://) 通路相比，此命令不受 CSP / CORS 限制，
/// 能稳定读取工作区内的图片文件。
#[tauri::command]
pub async fn read_file_base64(file_path: String) -> Result<String, String> {
    let path = Path::new(&file_path);
    if !path.is_file() {
        return Err(format!("文件不存在: {file_path}"));
    }

    let bytes = tokio::fs::read(path)
        .await
        .map_err(|error| format!("读取文件失败: {file_path}: {error}"))?;

    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

fn app_data_dir<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("LiveMD"))
}

fn save_dialog_path<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
    default_name: Option<String>,
) -> Option<PathBuf> {
    // 对话框父窗口仅桌面有意义
    #[cfg(desktop)]
    let builder = app
        .dialog()
        .file()
        .set_parent(window)
        .add_filter("Markdown", &["md", "markdown"]);
    #[cfg(mobile)]
    let builder = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown"]);
    #[cfg(mobile)]
    let _ = window;
    let mut builder = builder;
    if let Some(name) = default_name {
        builder = builder.set_file_name(name);
    }
    builder
        .blocking_save_file()
        .and_then(|path| path.into_path().ok())
}

fn write_save_result(
    file_path: &Path,
    content: &str,
    file_traits: Option<&crate::models::FileTraits>,
    image_local_path: &str,
    use_file_name_folder: bool,
    app_data_dir: &Path,
    image_options: ImagePathOptions,
) -> Result<SaveResult, String> {
    let prepared_content = prepare_image_content_for_save(
        content,
        &file_path.to_string_lossy(),
        image_local_path,
        use_file_name_folder,
        app_data_dir,
        image_options,
    );
    let restored_content = restore_file_traits(&prepared_content, file_traits);
    std::fs::write(file_path, restored_content).map_err(|error| error.to_string())?;

    Ok(SaveResult {
        file_path: file_path.to_string_lossy().to_string(),
        content: prepared_content,
    })
}

#[tauri::command]
pub async fn open_file<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<Option<LoadedFile>, String> {
    // 对话框父窗口仅桌面有意义
    #[cfg(desktop)]
    let dialog = app
        .dialog()
        .file()
        .set_parent(&window)
        .add_filter("Markdown", &["md", "markdown"]);
    #[cfg(mobile)]
    let dialog = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown"]);
    #[cfg(mobile)]
    let _ = &window;
    let picked = dialog.blocking_pick_file();

    let Some(path) = picked.and_then(|path| path.into_path().ok()) else {
        return Ok(None);
    };

    Ok(read_markdown_file(&path.to_string_lossy()))
}

#[tauri::command]
pub async fn save_file<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    payload: SavePayload,
) -> Result<Option<SaveResult>, String> {
    let mut file_path = payload.file_path.filter(|value| !value.is_empty());
    if file_path.is_none() {
        let default_name = create_default_markdown_file_name(&payload.content);
        let Some(path) = save_dialog_path(&app, &window, Some(default_name)) else {
            return Ok(None);
        };
        file_path = Some(path.to_string_lossy().to_string());
    }

    let file_path = file_path.expect("file path is present");
    let result = write_save_result(
        Path::new(&file_path),
        &payload.content,
        payload.file_traits.as_ref(),
        payload.image_local_path.as_deref().unwrap_or(""),
        payload.image_use_file_name_folder.unwrap_or(false),
        &app_data_dir(&app),
        ImagePathOptions {
            prefer_relative: payload.image_prefer_relative.unwrap_or(false),
            add_dot_slash: payload.image_add_dot_slash.unwrap_or(false),
        },
    )?;

    Ok(Some(result))
}

#[tauri::command]
pub async fn save_file_as<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    payload: SaveAsPayload,
) -> Result<Option<SaveResult>, String> {
    let Some(path) = save_dialog_path(&app, &window, None) else {
        return Ok(None);
    };

    let result = write_save_result(
        &path,
        &payload.content,
        payload.file_traits.as_ref(),
        payload.image_local_path.as_deref().unwrap_or(""),
        payload.image_use_file_name_folder.unwrap_or(false),
        &app_data_dir(&app),
        ImagePathOptions {
            prefer_relative: payload.image_prefer_relative.unwrap_or(false),
            add_dot_slash: payload.image_add_dot_slash.unwrap_or(false),
        },
    )?;

    Ok(Some(result))
}

#[tauri::command]
pub async fn read_file_by_path(file_path: String) -> Result<Option<LoadedFile>, String> {
    Ok(read_markdown_file(&file_path))
}

#[tauri::command]
pub async fn is_file_read_only(file_path: String) -> Result<bool, String> {
    let path = Path::new(&file_path);
    let metadata = match std::fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(_) => return Ok(false),
    };
    if metadata.permissions().readonly() {
        return Ok(true);
    }
    match std::fs::OpenOptions::new().write(true).open(path) {
        Ok(_) => Ok(false),
        Err(_) => Ok(true),
    }
}

#[tauri::command]
pub async fn cleanup_local_images<R: Runtime>(
    app: AppHandle<R>,
    content: String,
) -> Result<bool, String> {
    cleanup_temporary_images(&content, &app_data_dir(&app));
    Ok(true)
}

// ---------------------------------------------------------------------------
// 移动端应用文档库
//
// 保存模型：移动端文档统一落在系统磁盘的「应用文档目录」（Android 为
// Android/data/<包名>/files/Documents，鸿蒙为 filesDir/documents），无需存储权限。
// 前端只使用文件名作为文档标识，避免把 content:// URI 当作磁盘路径。
// ---------------------------------------------------------------------------

/// 移动端应用文档目录；桌面端回退到 app_data/documents，便于同一套命令在桌面上调试。
fn mobile_documents_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    #[cfg(mobile)]
    let base = app
        .path()
        .document_dir()
        .or_else(|_| app.path().app_data_dir().map(|dir| dir.join("documents")))
        .map_err(|error| format!("无法获取应用文档目录: {error}"))?;
    #[cfg(desktop)]
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法获取应用文档目录: {error}"))?
        .join("documents");

    match std::fs::symlink_metadata(&base) {
        Ok(metadata) if !metadata.file_type().is_dir() => {
            return Err("应用文档目录不是普通目录".to_string());
        }
        Err(error) if error.kind() != ErrorKind::NotFound => {
            return Err(format!("读取文档目录失败: {error}"));
        }
        _ => {}
    }
    std::fs::create_dir_all(&base).map_err(|error| format!("创建文档目录失败: {error}"))?;
    std::fs::canonicalize(&base).map_err(|error| format!("读取文档目录失败: {error}"))
}

fn is_markdown_file_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.ends_with(".md") || lower.ends_with(".markdown")
}

/// 文件名清洗：只保留最后一段，禁止路径分隔符与 Windows 非法字符，自动补 .md。
fn sanitize_mobile_document_name(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("文件名不能为空".to_string());
    }

    let base = trimmed
        .rsplit(|c| c == '/' || c == '\\')
        .next()
        .unwrap_or(trimmed)
        .trim();
    let cleaned: String = base
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*') {
                '_'
            } else {
                c
            }
        })
        .collect();
    let cleaned = cleaned
        .trim()
        .trim_end_matches(|c: char| c == '.' || c == ' ');
    if cleaned.is_empty() || cleaned == "." || cleaned == ".." {
        return Err("文件名无效".to_string());
    }

    // Windows 设备名无法作为普通文件保存；各端统一加前缀，保持文件名一致。
    let stem = cleaned.split('.').next().unwrap_or_default().to_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ["COM", "LPT"].iter().any(|prefix| {
            stem.strip_prefix(prefix).is_some_and(|suffix| {
                suffix.chars().count() == 1
                    && suffix
                        .chars()
                        .all(|c| matches!(c, '1'..='9' | '¹' | '²' | '³'))
            })
        });
    let cleaned = if reserved {
        format!("_{cleaned}")
    } else {
        cleaned.to_string()
    };
    if is_markdown_file_name(&cleaned) {
        Ok(cleaned)
    } else {
        Ok(format!("{cleaned}.md"))
    }
}

fn mobile_document_info(path: &Path) -> Option<MobileDocumentInfo> {
    let metadata = std::fs::symlink_metadata(path).ok()?;
    if !metadata.file_type().is_file() {
        return None;
    }
    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    Some(MobileDocumentInfo {
        name: path.file_name()?.to_string_lossy().to_string(),
        size: metadata.len(),
        modified_at,
    })
}

/// 文档路径仅包含清洗后的文件名，不允许通过符号链接读写沙箱外的文件。
fn mobile_document_path(dir: &Path, name: &str) -> Result<PathBuf, String> {
    let file_name = sanitize_mobile_document_name(name)?;
    let path = dir.join(file_name);
    match std::fs::symlink_metadata(&path) {
        Ok(metadata) if !metadata.file_type().is_file() => {
            return Err("文档不是普通文件".to_string());
        }
        Err(error) if error.kind() != ErrorKind::NotFound => {
            return Err(format!("读取文档信息失败: {error}"));
        }
        _ => {}
    }
    Ok(path)
}

fn read_mobile_document_from_dir(dir: &Path, name: &str) -> Result<Option<LoadedFile>, String> {
    let path = mobile_document_path(dir, name)?;
    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("读取文档失败: {error}")),
    };
    let raw =
        String::from_utf8(bytes).map_err(|_| "文档不是有效的 UTF-8 文件，无法读取".to_string())?;
    Ok(Some(LoadedFile {
        file_path: path.to_string_lossy().to_string(),
        content: normalize_markdown(&raw),
        file_traits: detect_file_traits(&raw),
    }))
}

fn save_mobile_document_to_dir(
    dir: &Path,
    name: &str,
    content: &str,
    file_traits: Option<&FileTraits>,
) -> Result<MobileDocumentInfo, String> {
    let path = mobile_document_path(dir, name)?;
    let normalized;
    let content = if file_traits.is_some() {
        normalized = normalize_markdown(content);
        &normalized
    } else {
        content
    };
    let restored = restore_file_traits(content, file_traits);
    let temporary = dir.join(format!(".livemd-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(restored.as_bytes())?;
        file.sync_all()?;
        drop(file);
        // 同目录重命名原子替换原文档；失败时旧内容仍保留。
        std::fs::rename(&temporary, &path)
    })();
    if let Err(error) = result {
        let _ = std::fs::remove_file(&temporary);
        return Err(format!("保存文档失败: {error}"));
    }
    mobile_document_info(&path).ok_or_else(|| "保存后无法读取文档信息".to_string())
}

fn delete_mobile_documents_from_dir(dir: &Path, names: &[String]) -> Result<usize, String> {
    // 在删除前验证所有路径，避免非法文件名导致一半已删、一半报错。
    let paths = names
        .iter()
        .map(|name| mobile_document_path(dir, name))
        .collect::<Result<Vec<_>, _>>()?;
    let mut deleted = 0;
    for path in paths {
        match std::fs::remove_file(&path) {
            Ok(()) => deleted += 1,
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(format!("删除文档失败: {error}")),
        }
    }
    Ok(deleted)
}

/// 列出应用文档目录中的 Markdown 文档（按修改时间倒序）
#[tauri::command]
pub async fn list_mobile_documents<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<MobileDocumentInfo>, String> {
    let dir = mobile_documents_dir(&app)?;
    let entries = std::fs::read_dir(&dir)
        .map_err(|error| format!("读取文档目录失败: {}: {error}", dir.display()))?;

    let mut documents = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| format!("读取文档目录失败: {error}"))?;
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !is_markdown_file_name(name)
            || sanitize_mobile_document_name(name).as_deref() != Ok(name)
        {
            continue;
        }
        if let Some(info) = mobile_document_info(&path) {
            documents.push(info);
        }
    }

    documents.sort_by(|a, b| {
        b.modified_at
            .cmp(&a.modified_at)
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(documents)
}

/// 按文件名读取应用文档
#[tauri::command]
pub async fn read_mobile_document<R: Runtime>(
    app: AppHandle<R>,
    name: String,
) -> Result<Option<LoadedFile>, String> {
    read_mobile_document_from_dir(&mobile_documents_dir(&app)?, &name)
}

/// 按文件名写入应用文档（已存在则覆盖）
#[tauri::command]
pub async fn save_mobile_document<R: Runtime>(
    app: AppHandle<R>,
    name: String,
    content: String,
    file_traits: Option<FileTraits>,
) -> Result<MobileDocumentInfo, String> {
    save_mobile_document_to_dir(
        &mobile_documents_dir(&app)?,
        &name,
        &content,
        file_traits.as_ref(),
    )
}

/// 删除若干应用文档，返回实际删除数量
#[tauri::command]
pub async fn delete_mobile_documents<R: Runtime>(
    app: AppHandle<R>,
    names: Vec<String>,
) -> Result<usize, String> {
    delete_mobile_documents_from_dir(&mobile_documents_dir(&app)?, &names)
}

#[cfg(test)]
mod mobile_document_tests {
    use super::*;

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let path = std::env::temp_dir()
                .join(format!("livemd-mobile-docs-test-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let temp = std::env::temp_dir();
            assert_eq!(self.0.parent(), Some(temp.as_path()));
            assert!(self
                .0
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("livemd-mobile-docs-test-"));
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn sanitizes_names_without_leaving_document_directory() {
        assert_eq!(
            sanitize_mobile_document_name("../../中文.MD").unwrap(),
            "中文.MD"
        );
        assert_eq!(
            sanitize_mobile_document_name(r"C:\fakepath\笔记.markdown").unwrap(),
            "笔记.markdown"
        );
        assert_eq!(sanitize_mobile_document_name("CON.md").unwrap(), "_CON.md");
        assert_eq!(
            sanitize_mobile_document_name("a:\0\u{7f}?. ").unwrap(),
            "a____.md"
        );
        assert!(sanitize_mobile_document_name("../..").is_err());
    }

    #[test]
    fn preserves_traits_overwrites_short_content_and_deletes_only_selected_files() {
        let dir = TestDirectory::new();
        let traits = FileTraits {
            has_bom: true,
            line_ending: "crlf".into(),
            has_trailing_newline: true,
        };
        let content = "# 中文🙂\n正文\n";
        let raw = "\u{feff}# 中文🙂\r\n正文\r\n";
        let saved =
            save_mobile_document_to_dir(&dir.0, "../../笔记.md", content, Some(&traits)).unwrap();
        assert_eq!(saved.name, "笔记.md");
        assert_eq!(saved.size, raw.len() as u64);
        assert_eq!(std::fs::read_to_string(dir.0.join("笔记.md")).unwrap(), raw);
        let loaded = read_mobile_document_from_dir(&dir.0, "笔记.md")
            .unwrap()
            .unwrap();
        assert_eq!(loaded.content, content);
        assert!(loaded.file_traits.has_bom);
        assert_eq!(loaded.file_traits.line_ending, "crlf");
        assert!(loaded.file_traits.has_trailing_newline);
        let encoded = serde_json::to_value(&loaded.file_traits).unwrap();
        assert_eq!(encoded["hasBOM"], true);
        assert!(encoded.get("hasBom").is_none());
        assert!(
            serde_json::from_value::<FileTraits>(encoded)
                .unwrap()
                .has_bom
        );

        save_mobile_document_to_dir(&dir.0, "笔记.md", "短", None).unwrap();
        save_mobile_document_to_dir(&dir.0, "空.md", "", None).unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.0.join("笔记.md")).unwrap(),
            "短"
        );
        assert_eq!(
            read_mobile_document_from_dir(&dir.0, "空.md")
                .unwrap()
                .unwrap()
                .content,
            ""
        );
        let deleted = delete_mobile_documents_from_dir(
            &dir.0,
            &["笔记.md".into(), "笔记.md".into(), "缺失.md".into()],
        )
        .unwrap();
        assert_eq!(deleted, 1);
        assert!(read_mobile_document_from_dir(&dir.0, "笔记.md")
            .unwrap()
            .is_none());
        assert!(dir.0.join("空.md").is_file());
        assert_eq!(std::fs::read_dir(&dir.0).unwrap().count(), 1);
    }

    #[test]
    fn rejects_non_regular_files_and_invalid_utf8_without_deleting_other_documents() {
        let dir = TestDirectory::new();
        std::fs::create_dir(dir.0.join("目录.md")).unwrap();
        save_mobile_document_to_dir(&dir.0, "保留.md", "原文", None).unwrap();
        assert!(save_mobile_document_to_dir(&dir.0, "目录.md", "不能写目录", None).is_err());
        assert!(read_mobile_document_from_dir(&dir.0, "目录.md").is_err());
        assert!(
            delete_mobile_documents_from_dir(&dir.0, &["保留.md".into(), "目录.md".into()])
                .is_err()
        );
        assert_eq!(
            std::fs::read_to_string(dir.0.join("保留.md")).unwrap(),
            "原文"
        );
        std::fs::write(dir.0.join("编码.md"), [0xff, 0xfe]).unwrap();
        assert!(read_mobile_document_from_dir(&dir.0, "编码.md")
            .unwrap_err()
            .contains("UTF-8"));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symbolic_links() {
        let dir = TestDirectory::new();
        let outside = TestDirectory::new();
        std::fs::write(outside.0.join("外部.md"), "外部原文").unwrap();
        std::os::unix::fs::symlink(outside.0.join("外部.md"), dir.0.join("链接.md")).unwrap();
        assert!(read_mobile_document_from_dir(&dir.0, "链接.md").is_err());
        assert!(save_mobile_document_to_dir(&dir.0, "链接.md", "覆盖", None).is_err());
        assert!(delete_mobile_documents_from_dir(&dir.0, &["链接.md".into()]).is_err());
        assert_eq!(
            std::fs::read_to_string(outside.0.join("外部.md")).unwrap(),
            "外部原文"
        );
    }
}
