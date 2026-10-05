use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};
use tauri_plugin_opener::OpenerExt;

use crate::events::{broadcast_editor_args, emit_args_to};
use crate::file_format::{absolute_path, is_markdown_file_path, read_markdown_file};
use crate::models::{FocusResult, ImagePreviewItem, ImagePreviewPayload, LoadedFile};
use crate::paths::{normalize_external_link, resolve_local_link_path};
use crate::state::AppState;
use crate::window;

#[tauri::command]
pub fn get_platform() -> String {
    match std::env::consts::OS {
        "windows" => "win32",
        "macos" => "darwin",
        other => other,
    }
    .to_string()
}

#[tauri::command]
pub fn get_app_version<R: Runtime>(app: AppHandle<R>) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub async fn renderer_ready<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let state = app.state::<AppState>();
    state
        .renderer_ready
        .store(true, std::sync::atomic::Ordering::SeqCst);
    let pending = {
        let mut pending = state.pending_startup.lock().unwrap();
        std::mem::take(&mut *pending)
    };
    if !pending.is_empty() {
        send_files_to_renderer(&app, pending);
    }
    Ok(())
}

#[tauri::command]
pub async fn open_external<R: Runtime>(app: AppHandle<R>, url: String) -> Result<(), String> {
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn open_link<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    href: String,
    current_file_path: Option<String>,
) -> Result<(), String> {
    if let Some(local_path) = resolve_local_link_path(&href, current_file_path.as_deref()) {
        if is_markdown_file_path(&local_path) {
            let source_label = window.label().to_string();
            if let Some(target) =
                window::find_window_with_file(&app, &local_path, Some(&source_label))
            {
                window::focus_file_in_window(&app, &target, &local_path);
                return Ok(());
            }

            if let Some(result) = read_markdown_file(&local_path) {
                let payload = serde_json::to_value(result).unwrap_or(Value::Null);
                emit_args_to(&window, "open-file-at-launch", vec![payload]);
                let _ = window.set_focus();
                return Ok(());
            }
        }

        return app
            .opener()
            .open_path(local_path, None::<&str>)
            .map_err(|error| error.to_string());
    }

    let external_url = normalize_external_link(&href);
    if external_url.is_empty() {
        return Ok(());
    }
    app.opener()
        .open_url(external_url, None::<&str>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn reveal_file_in_folder<R: Runtime>(
    app: AppHandle<R>,
    file_path: String,
) -> Result<bool, String> {
    if file_path.is_empty() {
        return Ok(false);
    }

    let path = absolute_path(&file_path);
    if path.exists() {
        return app
            .opener()
            .reveal_item_in_dir(&path)
            .map(|_| true)
            .map_err(|error| error.to_string());
    }

    let Some(parent) = path.parent() else {
        return Ok(false);
    };
    if !parent.exists() {
        return Ok(false);
    }
    app.opener()
        .open_path(parent.to_string_lossy().to_string(), None::<&str>)
        .map(|_| true)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn open_theme_editor<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    window::create_theme_editor_window(&app).map(|_| ())
}

#[tauri::command]
pub async fn theme_editor_window_control<R: Runtime>(
    app: AppHandle<R>,
    action: String,
) -> Result<(), String> {
    let window = window::create_theme_editor_window(&app)?;
    match action.as_str() {
        "minimize" => {
            let _ = window.minimize();
        }
        "maximize" => {
            if window.is_maximized().unwrap_or(false) {
                let _ = window.unmaximize();
            } else {
                let _ = window.maximize();
            }
        }
        "close" => {
            let _ = window.close();
        }
        _ => {}
    }
    Ok(())
}

#[tauri::command]
pub async fn save_custom_theme<R: Runtime>(app: AppHandle<R>, theme: Value) -> Result<(), String> {
    broadcast_editor_args(&app, "custom-theme-saved", vec![theme]);
    Ok(())
}

#[tauri::command]
pub async fn get_system_fonts() -> Result<Vec<String>, String> {
    let mut database = fontdb::Database::new();
    database.load_system_fonts();
    let mut fonts: Vec<String> = database
        .faces()
        .flat_map(|face| face.families.iter().map(|(name, _)| name.clone()))
        .filter(|name| !name.is_empty() && !name.starts_with('@'))
        .collect();
    fonts.sort_by_key(|name| name.to_ascii_lowercase());
    fonts.dedup_by(|left, right| left.eq_ignore_ascii_case(right));
    Ok(fonts)
}

fn normalize_launch_file_paths(paths: &[String]) -> Vec<String> {
    let mut normalized = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for path in paths {
        if !is_markdown_file_path(path) {
            continue;
        }
        let absolute = absolute_path(path).to_string_lossy().to_string();
        let key = if cfg!(windows) {
            absolute.to_ascii_lowercase()
        } else {
            absolute.clone()
        };
        if !seen.insert(key) {
            continue;
        }
        normalized.push(absolute);
    }

    normalized
}

fn read_launch_files(paths: &[String]) -> Vec<LoadedFile> {
    paths
        .iter()
        .filter_map(|path| read_markdown_file(path))
        .collect()
}

fn append_pending_startup<R: Runtime>(app: &AppHandle<R>, paths: Vec<String>) {
    let state = app.state::<AppState>();
    let mut pending = state.pending_startup.lock().unwrap();
    let mut existing: std::collections::HashSet<String> = pending
        .iter()
        .map(|path| {
            if cfg!(windows) {
                path.to_ascii_lowercase()
            } else {
                path.clone()
            }
        })
        .collect();
    for path in paths {
        let key = if cfg!(windows) {
            path.to_ascii_lowercase()
        } else {
            path.clone()
        };
        if existing.insert(key) {
            pending.push(path);
        }
    }
}

pub fn send_files_to_renderer<R: Runtime>(app: &AppHandle<R>, paths: Vec<String>) {
    let normalized = normalize_launch_file_paths(&paths);
    if normalized.is_empty() {
        return;
    }

    let state = app.state::<AppState>();
    if !state
        .renderer_ready
        .load(std::sync::atomic::Ordering::SeqCst)
    {
        append_pending_startup(app, normalized);
        return;
    }

    let files = read_launch_files(&normalized);
    if files.is_empty() {
        return;
    }

    let target_label = state.main_label.lock().unwrap().clone().or_else(|| {
        state
            .windows
            .lock()
            .unwrap()
            .keys()
            .find(|label| label.starts_with("editor-"))
            .cloned()
    });
    let Some(label) = target_label else {
        append_pending_startup(app, normalized);
        return;
    };

    let Some(target) = app.get_webview_window(&label) else {
        append_pending_startup(app, normalized);
        return;
    };

    let mut payload = serde_json::to_value(&files[0]).unwrap_or(Value::Null);
    if let Value::Object(ref mut object) = payload {
        object.insert(
            "files".to_string(),
            serde_json::to_value(&files).unwrap_or(Value::Null),
        );
    }

    if target.is_minimized().unwrap_or(false) {
        let _ = target.unminimize();
    }
    let _ = target.show();
    let _ = target.set_focus();
    emit_args_to(&target, "open-file-at-launch", vec![payload]);
}

pub fn send_launch_file_if_exists<R: Runtime>(app: &AppHandle<R>, argv: Vec<String>) {
    let files: Vec<String> = argv
        .into_iter()
        .filter(|argument| is_markdown_file_path(argument))
        .collect();
    if !files.is_empty() {
        send_files_to_renderer(app, files);
    }
}

pub fn initial_launch_files() -> Vec<String> {
    std::env::args()
        .skip(1)
        .filter(|argument| is_markdown_file_path(argument))
        .collect()
}

#[tauri::command]
pub async fn open_image_preview<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    payload: ImagePreviewPayload,
) -> Result<(), String> {
    if payload.src.is_empty() {
        return Ok(());
    }

    let items = payload
        .items
        .clone()
        .filter(|items| !items.is_empty())
        .unwrap_or_else(|| {
            vec![ImagePreviewItem {
                src: payload.src.clone(),
                alt: payload.alt.clone(),
            }]
        });
    let initial_index = payload
        .index
        .filter(|index| *index < items.len())
        .unwrap_or_else(|| {
            items
                .iter()
                .position(|item| item.src == payload.src)
                .unwrap_or(0)
        });

    let preview_payload = json!({
        "items": items,
        "index": initial_index,
    });
    let script = format!(
        "window.__LIVEMD_IMAGE_PREVIEW__ = {};",
        serde_json::to_string(&preview_payload).unwrap_or_else(|_| "null".to_string())
    );

    if let Some(existing) = app.get_webview_window("image-preview") {
        let update_script = format!(
            "window.__LIVEMD_SET_PREVIEW__ && window.__LIVEMD_SET_PREVIEW__({});",
            serde_json::to_string(&preview_payload).unwrap_or_else(|_| "null".to_string())
        );
        let _ = existing.eval(&update_script);
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }

    let scale_factor = window.scale_factor().unwrap_or(1.0);
    let (parent_width, parent_height) = window
        .outer_size()
        .map(|size| {
            (
                size.width as f64 / scale_factor,
                size.height as f64 / scale_factor,
            )
        })
        .unwrap_or((1100.0, 800.0));
    let parent_position = window.outer_position().ok();
    let preview_width = (parent_width * 0.82).max(480.0);
    let preview_height = (parent_height * 0.82).max(360.0);

    let mut builder = tauri::WebviewWindowBuilder::new(
        &app,
        "image-preview",
        tauri::WebviewUrl::App("image-preview.html".into()),
    )
    .title("图片预览")
    .inner_size(preview_width, preview_height)
    .min_inner_size(320.0, 240.0)
    .decorations(false)
    .initialization_script(&script);

    if let Some(position) = parent_position {
        builder = builder.position(
            position.x as f64 / scale_factor + (parent_width - preview_width) / 2.0,
            position.y as f64 / scale_factor + (parent_height - preview_height) / 2.0,
        );
    }

    let preview = builder.build().map_err(|error| error.to_string())?;
    let _ = preview.set_focus();
    Ok(())
}

#[tauri::command]
pub async fn focus_file_if_open<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    file_path: String,
) -> Result<FocusResult, String> {
    let source = window.label().to_string();
    if let Some(target) = window::find_window_with_file(&app, &file_path, Some(&source)) {
        window::focus_file_in_window(&app, &target, &file_path);
        Ok(FocusResult { found: true })
    } else {
        Ok(FocusResult { found: false })
    }
}

#[tauri::command]
pub async fn open_path<R: Runtime>(app: AppHandle<R>, path: String) -> Result<(), String> {
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|error| error.to_string())
}

