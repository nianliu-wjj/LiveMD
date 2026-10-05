use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

use crate::events::emit_args_to;
use crate::models::WindowBounds;
use crate::state::AppState;
use crate::window;

#[tauri::command]
pub fn set_title<R: Runtime>(window: WebviewWindow<R>, file_path: Option<String>) {
    window::set_title(&window, file_path.as_deref());
}

#[tauri::command]
pub fn watch_files<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    file_paths: Vec<String>,
) {
    crate::watcher::update_file_watchers(&app, window.label(), file_paths);
}

#[tauri::command]
pub fn change_save_status<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    is_saved: bool,
) {
    window::set_window_saved(&app, window.label(), is_saved);
    emit_args_to(&window, "save-status-changed", vec![serde_json::json!(is_saved)]);
}

#[tauri::command]
pub fn window_control<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    action: String,
) {
    window::window_control(&app, &window, &action);
}

#[tauri::command]
pub fn close_discard<R: Runtime>(app: AppHandle<R>, window: WebviewWindow<R>) {
    window::close_discard(&app, window.label());
}

#[tauri::command]
pub fn get_window_bounds<R: Runtime>(window: WebviewWindow<R>) -> Option<WindowBounds> {
    window::get_window_bounds(&window)
}

#[tauri::command]
pub fn toggle_fullscreen<R: Runtime>(window: WebviewWindow<R>) {
    window::toggle_fullscreen(&window);
}

#[tauri::command]
pub async fn get_initial_tab_data<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<Option<Value>, String> {
    let label = window.label().to_string();
    let data = app
        .state::<AppState>()
        .pending_tabs
        .lock()
        .unwrap()
        .remove(&label);

    if let Some(value) = &data {
        if value
            .get("isModified")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            window::set_window_saved(&app, &label, false);
        }
    }

    Ok(data)
}

/// 打开新的空白编辑器窗口（菜单入口）。
/// 与 tear_off_start 不同：不进入拖拽会话，窗口停在默认位置，不跟随鼠标。
#[tauri::command]
pub async fn create_blank_window<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    window::create_editor_window(
        &app,
        window::CreateWindowOptions {
            fast_create: true,
            ..Default::default()
        },
    )
    .map(|_| true)
    .map_err(|error| {
        eprintln!("[create-blank-window] 创建窗口失败: {error}");
        error
    })
}

/// 打开携带指定 Tab 数据的新编辑器窗口（「在新窗口打开」用）
///
/// tab_data 为 JSON（与拖拽分离的 Tab 载荷同构），渲染层通过 get_initial_tab_data 取回；
/// 其中额外携带的 workspaceDir 由渲染层自行消费，把该目录设为工作区。
#[tauri::command]
pub async fn create_window_with_tab<R: Runtime>(
    app: AppHandle<R>,
    tab_data: Value,
) -> Result<bool, String> {
    window::create_editor_window(
        &app,
        window::CreateWindowOptions {
            fast_create: true,
            tab_data: Some(tab_data),
            ..Default::default()
        },
    )
    .map(|_| true)
    .map_err(|error| {
        eprintln!("[create-window-with-tab] 创建窗口失败: {error}");
        error
    })
}
