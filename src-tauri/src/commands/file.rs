use std::path::{Path, PathBuf};

use base64::Engine as _;

use tauri::{AppHandle, Manager, Runtime, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::file_format::{
    create_default_markdown_file_name, read_markdown_file, restore_file_traits,
};
use crate::models::{LoadedFile, SaveAsPayload, SavePayload, SaveResult};
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
    let mut builder = app
        .dialog()
        .file()
        .set_parent(window)
        .add_filter("Markdown", &["md", "markdown"]);
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
    let picked = app
        .dialog()
        .file()
        .set_parent(&window)
        .add_filter("Markdown", &["md", "markdown"])
        .blocking_pick_file();

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
