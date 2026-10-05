use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindow};

/// All LiveMD events carry an argument array. The renderer compatibility layer
/// spreads it back into positional arguments, matching the old IPC bridge.
pub fn emit_args_to<R: Runtime>(window: &WebviewWindow<R>, event: &str, args: Vec<Value>) {
    let _ = window.emit(event, Value::Array(args));
}

pub fn emit_args_to_label<R: Runtime>(app: &AppHandle<R>, label: &str, event: &str, args: Vec<Value>) {
    if let Some(window) = app.get_webview_window(label) {
        emit_args_to(&window, event, args);
    }
}

pub fn broadcast_editor_args<R: Runtime>(app: &AppHandle<R>, event: &str, args: Vec<Value>) {
    use tauri::Manager;
    let state = app.state::<crate::state::AppState>();
    let labels: Vec<String> = {
        let windows = state.windows.lock().unwrap();
        windows
            .iter()
            .filter(|(label, meta)| meta.is_main || label.starts_with("editor-"))
            .map(|(label, _)| label.clone())
            .collect()
    };
    for label in labels {
        emit_args_to_label(app, &label, event, args.clone());
    }
}
