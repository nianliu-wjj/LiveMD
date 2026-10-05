use serde::Deserialize;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::paths::{
    create_image_file_name, resolve_image_markdown_path, resolve_image_save_directory,
    ImagePathOptions,
};

#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardWritePayload {
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub html: String,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WriteTempImagePayload {
    pub file: Vec<u8>,
    pub target_path: String,
    #[serde(default)]
    pub current_file_path: Option<String>,
    #[serde(default)]
    pub file_name: Option<String>,
    #[serde(default)]
    pub mime_type: Option<String>,
    #[serde(default)]
    pub use_file_name_folder: Option<bool>,
    /// 无特殊操作：图片先落到应用临时目录，保存文档时不做迁移
    #[serde(default)]
    pub save_to_temp: Option<bool>,
    /// 图片语法偏好
    #[serde(default)]
    pub prefer_relative: Option<bool>,
    #[serde(default)]
    pub add_dot_slash: Option<bool>,
}

fn app_data_dir<R: Runtime>(app: &AppHandle<R>) -> std::path::PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("LiveMD"))
}

#[tauri::command]
pub fn write_to_clipboard<R: Runtime>(
    app: AppHandle<R>,
    payload: ClipboardWritePayload,
) -> bool {
    let clipboard = app.clipboard();
    if !payload.html.is_empty() {
        clipboard
            .write_html(payload.html, Some(payload.text))
            .is_ok()
    } else {
        clipboard.write_text(payload.text).is_ok()
    }
}

#[tauri::command]
pub fn write_text_to_clipboard<R: Runtime>(app: AppHandle<R>, text: String) -> bool {
    app.clipboard().write_text(text).is_ok()
}

#[tauri::command]
pub fn get_file_path_in_clipboard() -> Option<String> {
    #[cfg(windows)]
    {
        let paths: Vec<String> =
            clipboard_win::get_clipboard(clipboard_win::formats::FileList).unwrap_or_default();
        return paths.into_iter().next();
    }

    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("pbpaste")
            .args(["-Prefer", "public.file-url"])
            .output()
            .ok()?;
        let text = String::from_utf8_lossy(&output.stdout);
        let first = text.lines().next()?.trim();
        if first.is_empty() {
            return None;
        }
        return url::Url::parse(first)
            .ok()
            .and_then(|url| url.to_file_path().ok())
            .map(|path| path.to_string_lossy().to_string());
    }

    #[cfg(not(any(windows, target_os = "macos")))]
    {
        None
    }
}

#[tauri::command]
pub fn write_temp_image<R: Runtime>(
    app: AppHandle<R>,
    payload: WriteTempImagePayload,
) -> Result<String, String> {
    // 「无特殊操作」：先落到应用临时目录（保存文档时由 cleanup 逻辑清理，不做迁移）
    let save_to_temp = payload.save_to_temp.unwrap_or(false);
    let (absolute_dir, is_relative) = if save_to_temp {
        (app_data_dir(&app).join("temp-images"), false)
    } else {
        resolve_image_save_directory(
            &payload.target_path,
            payload.current_file_path.as_deref(),
            payload.use_file_name_folder.unwrap_or(false),
            &app_data_dir(&app),
        )
    };

    std::fs::create_dir_all(&absolute_dir).map_err(|error| error.to_string())?;
    let output_path = absolute_dir.join(create_image_file_name(
        payload.file_name.as_deref(),
        payload.mime_type.as_deref(),
    ));
    std::fs::write(&output_path, payload.file)
        .map_err(|error| error.to_string())?;

    Ok(resolve_image_markdown_path(
        &output_path.to_string_lossy(),
        is_relative,
        payload.current_file_path.as_deref(),
        ImagePathOptions {
            // 临时目录一定写成绝对路径，避免文档移动后路径失效
            prefer_relative: !save_to_temp && payload.prefer_relative.unwrap_or(false),
            add_dot_slash: payload.add_dot_slash.unwrap_or(false),
        },
    ))
}
