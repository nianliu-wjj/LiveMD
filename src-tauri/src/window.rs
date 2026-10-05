use std::path::Path;
use std::sync::atomic::Ordering;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{
    AppHandle, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

use crate::events::{emit_args_to, emit_args_to_label};
use crate::models::{MergeResult, WindowBounds};
use crate::state::AppState;

/// 按平台应用窗口外观：
/// - macOS：原生 Overlay 标题栏，保留系统红绿灯按钮与窗口圆角
/// - 其他平台：无边框，由前端自绘窗口控制按钮
pub fn platform_chrome<'a, R: Runtime, M: Manager<R>>(
    builder: WebviewWindowBuilder<'a, R, M>,
) -> WebviewWindowBuilder<'a, R, M> {
    #[cfg(target_os = "macos")]
    {
        builder
            .decorations(true)
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
    }
    #[cfg(not(target_os = "macos"))]
    {
        builder.decorations(false)
    }
}

pub struct CreateWindowOptions {
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub tab_data: Option<Value>,
    pub fast_create: bool,
    pub center: bool,
}

impl Default for CreateWindowOptions {
    fn default() -> Self {
        Self {
            x: None,
            y: None,
            width: None,
            height: None,
            tab_data: None,
            fast_create: false,
            center: true,
        }
    }
}

pub fn adaptive_size<R: Runtime>(
    app: &AppHandle<R>,
    requested_width: Option<f64>,
    requested_height: Option<f64>,
) -> (f64, f64, f64, f64) {
    let (screen_width, screen_height) = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|monitor| {
            let scale = monitor.scale_factor();
            (
                monitor.size().width as f64 / scale,
                monitor.size().height as f64 / scale,
            )
        })
        .unwrap_or((1920.0, 1080.0));

    let low_resolution = screen_width < 1200.0 || screen_height < 760.0;
    let min_width = if low_resolution { 480.0 } else { 800.0 };
    let min_height = if low_resolution { 360.0 } else { 600.0 };
    let width = (requested_width.unwrap_or(1200.0))
        .min((screen_width * 0.82).floor())
        .max(min_width);
    let height = (requested_height.unwrap_or(800.0))
        .min((screen_height * 0.86).floor())
        .max(min_height);

    (width, height, min_width, min_height)
}

pub fn attach_window<R: Runtime>(app: &AppHandle<R>, window: &WebviewWindow<R>, is_main: bool) {
    let label = window.label().to_string();

    {
        let state = app.state::<AppState>();
        let mut windows = state.windows.lock().unwrap();
        let meta = windows.entry(label.clone()).or_default();
        meta.is_main = is_main;
        meta.saved = true;
        if is_main {
            *state.main_label.lock().unwrap() = Some(label.clone());
        }
    }

    sync_window_flags(app, window);

    let app_handle = app.clone();
    let tracked_window = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { api, .. } => {
            let state = app_handle.state::<AppState>();
            let quitting = state.quitting.load(Ordering::SeqCst);
            let (saved, closing, is_main) = {
                let windows = state.windows.lock().unwrap();
                match windows.get(tracked_window.label()) {
                    Some(meta) => (meta.saved, meta.closing, meta.is_main),
                    None => return,
                }
            };

            if quitting || closing {
                return;
            }

            if cfg!(target_os = "macos") && is_main {
                api.prevent_close();
                emit_args_to(&tracked_window, "close", vec![]);
                return;
            }

            if !saved {
                api.prevent_close();
                emit_args_to(&tracked_window, "close:confirm", vec![]);
            }
        }
        WindowEvent::Resized(_) => {
            sync_window_flags(&app_handle, &tracked_window);
        }
        WindowEvent::Focused(true) => {
            let label = tracked_window.label().to_string();
            crate::watcher::check_window_wsl_files(&app_handle, &label);
        }
        WindowEvent::Destroyed => {
            let label = tracked_window.label().to_string();
            crate::commands::drag::cleanup_for_window(&app_handle, &label);
            let remaining = {
                let state = app_handle.state::<AppState>();
                let mut windows = state.windows.lock().unwrap();
                windows.remove(&label);
                if windows.is_empty() {
                    Vec::new()
                } else {
                    windows
                        .iter()
                        .filter(|(_, meta)| !meta.closing)
                        .map(|(label, _)| label.clone())
                        .collect()
                }
            };

            if let Some(next_label) = remaining.first() {
                focus_window(&app_handle, next_label);
            } else if !cfg!(target_os = "macos")
                || app_handle.state::<AppState>().quitting.load(Ordering::SeqCst)
            {
                app_handle.state::<AppState>().quitting.store(true, Ordering::SeqCst);
                app_handle.exit(0);
            }
        }
        _ => {}
    });
}

fn sync_window_flags<R: Runtime>(app: &AppHandle<R>, window: &WebviewWindow<R>) {
    let label = window.label().to_string();
    let maximized = window.is_maximized().unwrap_or(false);
    let fullscreen = window.is_fullscreen().unwrap_or(false);

    let changed = {
        let state = app.state::<AppState>();
        let mut windows = state.windows.lock().unwrap();
        if let Some(meta) = windows.get_mut(&label) {
            let changed_maximized = meta.last_maximized != maximized;
            let changed_fullscreen = meta.last_fullscreen != fullscreen;
            meta.last_maximized = maximized;
            meta.last_fullscreen = fullscreen;
            (changed_maximized, changed_fullscreen)
        } else {
            (false, false)
        }
    };

    if changed.0 {
        emit_args_to(window, "window:maximized-change", vec![json!(maximized)]);
    }
    if changed.1 {
        emit_args_to(window, "window:fullscreen-change", vec![json!(fullscreen)]);
    }
}

pub fn create_editor_window<R: Runtime>(
    app: &AppHandle<R>,
    options: CreateWindowOptions,
) -> Result<WebviewWindow<R>, String> {
    let state = app.state::<AppState>();
    let id = state.next_window_id.fetch_add(1, Ordering::SeqCst) + 1;
    let label = format!("editor-{id}");

    let (width, height, min_width, min_height) =
        adaptive_size(app, options.width, options.height);

    let mut x = options.x;
    let mut y = options.y;
    if let (Some(x_value), Some(y_value)) = (x, y) {
        if options.center {
            x = Some((x_value - width / 2.0).round());
            y = Some((y_value - 20.0).round());
        }
    }

    if let Some(tab_data) = options.tab_data {
        let is_modified = tab_data
            .get("isModified")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        state
            .pending_tabs
            .lock()
            .unwrap()
            .insert(label.clone(), tab_data);
        if is_modified {
            let mut windows = state.windows.lock().unwrap();
            let meta = windows.entry(label.clone()).or_default();
            meta.saved = false;
        }
    }

    let mut builder = platform_chrome(WebviewWindowBuilder::new(
        app,
        &label,
        WebviewUrl::App("index.html".into()),
    ))
    .title("LiveMD")
    .inner_size(width, height)
    .min_inner_size(min_width, min_height)
    .resizable(true)
    .visible(!options.fast_create);

    if let (Some(x_value), Some(y_value)) = (x, y) {
        builder = builder.position(x_value, y_value);
    }

    let window = match builder.build() {
        Ok(window) => window,
        Err(error) => {
            app.state::<AppState>()
                .pending_tabs
                .lock()
                .unwrap()
                .remove(&label);
            return Err(error.to_string());
        }
    };

    attach_window(app, &window, false);
    if let Some(tab_data) = app.state::<AppState>().pending_tabs.lock().unwrap().get(&label) {
        let is_modified = tab_data
            .get("isModified")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if is_modified {
            let state = app.state::<AppState>();
            let mut windows = state.windows.lock().unwrap();
            if let Some(meta) = windows.get_mut(&label) {
                meta.saved = false;
            }
        }
    }

    if options.fast_create {
        let _ = window.show();
    }

    Ok(window)
}

pub fn create_theme_editor_window<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<WebviewWindow<R>, String> {
    if let Some(existing) = app.get_webview_window("theme-editor") {
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(existing);
    }

    let builder = platform_chrome(WebviewWindowBuilder::new(
        app,
        "theme-editor",
        WebviewUrl::App("theme-editor.html".into()),
    ))
    .title("LiveMD - 主题编辑器")
    .inner_size(1000.0, 700.0)
    .min_inner_size(800.0, 600.0)
    .resizable(true);

    let window = builder.build().map_err(|error| error.to_string())?;
    attach_window(app, &window, false);
    Ok(window)
}

pub fn close_window<R: Runtime>(app: &AppHandle<R>, label: &str) {
    let window = match app.get_webview_window(label) {
        Some(window) => window,
        None => return,
    };

    let should_confirm = {
        let state = app.state::<AppState>();
        let mut windows = state.windows.lock().unwrap();
        match windows.get_mut(label) {
            Some(meta) if !meta.closing => {
                if meta.saved {
                    meta.closing = true;
                    false
                } else {
                    true
                }
            }
            _ => return,
        }
    };

    if should_confirm {
        emit_args_to(&window, "close:confirm", vec![]);
    } else {
        let _ = window.destroy();
    }
}

/// Routes a user-initiated quit through the normal per-window close
/// confirmation flow. Returns true when at least one window was asked to
/// close, in which case the caller should defer the actual exit.
pub fn prepare_quit<R: Runtime>(app: &AppHandle<R>) -> bool {
    let Some(state) = app.try_state::<AppState>() else {
        return false;
    };
    if state.quitting.load(Ordering::SeqCst) {
        return false;
    }

    let labels: Vec<String> = {
        let windows = state.windows.lock().unwrap();
        windows
            .iter()
            .filter(|(_, meta)| !meta.closing)
            .map(|(label, _)| label.clone())
            .collect()
    };

    let mut emitted = false;
    for label in labels {
        if let Some(window) = app.get_webview_window(&label) {
            emit_args_to(&window, "close:confirm", Vec::new());
            emitted = true;
        }
    }
    emitted
}

pub fn close_discard<R: Runtime>(app: &AppHandle<R>, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        {
            let state = app.state::<AppState>();
            let mut windows = state.windows.lock().unwrap();
            if let Some(meta) = windows.get_mut(label) {
                meta.closing = true;
            }
        }
        let _ = window.destroy();
    }

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(80)).await;
        let state = app_handle.state::<AppState>();
        let remaining: Vec<String> = {
            let windows = state.windows.lock().unwrap();
            windows
                .iter()
                .filter(|(_, meta)| !meta.closing)
                .map(|(label, _)| label.clone())
                .collect()
        };
        if let Some(next_label) = remaining.first() {
            focus_window(&app_handle, next_label);
        } else {
            state.quitting.store(true, Ordering::SeqCst);
            app_handle.exit(0);
        }
    });
}

pub fn focus_window<R: Runtime>(app: &AppHandle<R>, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        if window.is_minimized().unwrap_or(false) {
            let _ = window.unminimize();
        }
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn window_control<R: Runtime>(app: &AppHandle<R>, window: &WebviewWindow<R>, action: &str) {
    match action {
        "minimize" => {
            let _ = window.minimize();
        }
        "maximize" => {
            if window.is_fullscreen().unwrap_or(false) {
                let _ = window.set_fullscreen(false);
            } else if window.is_maximized().unwrap_or(false) {
                let _ = window.unmaximize();
            } else {
                let _ = window.maximize();
            }
            schedule_flag_sync(app, window);
        }
        "close" => {
            let is_main = {
                let state = app.state::<AppState>();
                let windows = state.windows.lock().unwrap();
                windows
                    .get(window.label())
                    .map(|meta| meta.is_main)
                    .unwrap_or(false)
            };
            if cfg!(target_os = "macos") && is_main {
                let _ = window.hide();
            } else {
                close_window(app, window.label());
            }
        }
        _ => {}
    }
}

fn schedule_flag_sync<R: Runtime>(app: &AppHandle<R>, window: &WebviewWindow<R>) {
    let app_handle = app.clone();
    let window = window.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(120)).await;
        sync_window_flags(&app_handle, &window);
    });
}

pub fn toggle_fullscreen<R: Runtime>(window: &WebviewWindow<R>) {
    let fullscreen = window.is_fullscreen().unwrap_or(false);
    let _ = window.set_fullscreen(!fullscreen);
}

pub fn set_title<R: Runtime>(window: &WebviewWindow<R>, file_path: Option<&str>) {
    let title = match file_path {
        Some(path) if !path.is_empty() => format!(
            "LiveMD - {}",
            Path::new(path)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or(path)
        ),
        _ => "LiveMD - Untitled".to_string(),
    };
    let _ = window.set_title(&title);
}

pub fn get_window_bounds<R: Runtime>(window: &WebviewWindow<R>) -> Option<WindowBounds> {
    let scale = window.scale_factor().ok()?;
    let position = window.outer_position().ok()?;
    let size = window.outer_size().ok()?;
    Some(WindowBounds {
        x: position.x as f64 / scale,
        y: position.y as f64 / scale,
        width: size.width as f64 / scale,
        height: size.height as f64 / scale,
    })
}

pub fn logical_bounds<R: Runtime>(window: &WebviewWindow<R>) -> Option<(f64, f64, f64, f64)> {
    let bounds = get_window_bounds(window)?;
    Some((bounds.x, bounds.y, bounds.width, bounds.height))
}

pub fn cursor_logical<R: Runtime>(window: &WebviewWindow<R>) -> Option<(f64, f64)> {
    let scale = window.scale_factor().ok()?;
    let position = window.cursor_position().ok()?;
    Some((position.x / scale, position.y / scale))
}

pub fn find_window_at<R: Runtime>(
    app: &AppHandle<R>,
    x: f64,
    y: f64,
    exclude: &[String],
) -> Option<String> {
    let state = app.state::<AppState>();
    let labels: Vec<String> = {
        let windows = state.windows.lock().unwrap();
        windows
            .iter()
            .filter(|(label, meta)| {
                (meta.is_main || label.starts_with("editor-")) && !meta.closing && !exclude.contains(label)
            })
            .map(|(label, _)| label.clone())
            .collect()
    };

    for label in labels {
        let Some(window) = app.get_webview_window(&label) else {
            continue;
        };
        let Some((wx, wy, width, height)) = logical_bounds(&window) else {
            continue;
        };
        if x >= wx && x <= wx + width && y >= wy && y <= wy + height {
            return Some(label);
        }
    }
    None
}

pub fn focus_after_delay<R: Runtime>(app: &AppHandle<R>, label: String, delay_ms: u64) {
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(delay_ms)).await;
        focus_window(&app_handle, &label);
    });
}

pub fn focus_file_in_window<R: Runtime>(app: &AppHandle<R>, target: &str, file_path: &str) {
    emit_args_to_label(app, target, "tab:activate-file", vec![json!(file_path)]);
    focus_window(app, target);
}

pub fn result_merge(action: &str) -> MergeResult {
    MergeResult {
        action: action.to_string(),
    }
}

pub fn ensure_main_visible<R: Runtime>(app: &AppHandle<R>) {
    let main_label = app.state::<AppState>().main_label.lock().unwrap().clone();
    if let Some(label) = main_label {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

pub fn set_window_saved<R: Runtime>(app: &AppHandle<R>, label: &str, saved: bool) -> bool {
    let state = app.state::<AppState>();
    let mut windows = state.windows.lock().unwrap();
    if let Some(meta) = windows.get_mut(label) {
        meta.saved = saved;
        true
    } else {
        false
    }
}

pub fn window_open_files<R: Runtime>(app: &AppHandle<R>, label: &str) -> Vec<String> {
    let state = app.state::<AppState>();
    let windows = state.windows.lock().unwrap();
    windows
        .get(label)
        .map(|meta| meta.open_files.iter().cloned().collect())
        .unwrap_or_default()
}

pub fn update_window_open_files<R: Runtime>(app: &AppHandle<R>, label: &str, files: Vec<String>) {
    let state = app.state::<AppState>();
    let mut windows = state.windows.lock().unwrap();
    if let Some(meta) = windows.get_mut(label) {
        meta.open_files = files.into_iter().collect();
    }
}

pub fn find_window_with_file<R: Runtime>(
    app: &AppHandle<R>,
    file_path: &str,
    exclude: Option<&str>,
) -> Option<String> {
    let state = app.state::<AppState>();
    let windows = state.windows.lock().unwrap();
    let target = normalize_key(file_path);
    for (label, meta) in windows.iter() {
        if Some(label.as_str()) == exclude || meta.closing {
            continue;
        }
        if meta
            .open_files
            .iter()
            .any(|file| normalize_key(file) == target)
        {
            return Some(label.clone());
        }
    }
    None
}

fn normalize_key(file_path: &str) -> String {
    if cfg!(windows) {
        file_path.replace('/', "\\").to_ascii_lowercase()
    } else {
        file_path.to_string()
    }
}

pub fn mark_quitting<R: Runtime>(app: &AppHandle<R>) {
    app.state::<AppState>()
        .quitting
        .store(true, Ordering::SeqCst);
}

