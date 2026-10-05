use std::sync::atomic::Ordering;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

use crate::events::emit_args_to_label;
use crate::models::MergeResult;
use crate::state::{AppState, DragSession, WindowDragSession};
use crate::window;

fn set_merge_preview<R: Runtime>(
    app: &AppHandle<R>,
    source: &str,
    tab_data: &Value,
    x: f64,
    y: f64,
    exclude: &[String],
    generation: u64,
) -> Option<String> {
    let mut excluded = exclude.to_vec();
    excluded.push(source.to_string());
    let target = window::find_window_at(app, x, y, &excluded);

    let state = app.state::<AppState>();
    let mut previews = state.merge_previews.lock().unwrap();

    // A stop/drop/end command bumps the generation before clearing previews.
    // Check it while holding the preview lock so a late drag loop cannot emit
    // a preview after the merge has already been finalized.
    if state.drag_generation.load(Ordering::SeqCst) != generation {
        return None;
    }

    let previous = previews.get(source).cloned().flatten();

    if previous == target {
        if let Some(target) = &target {
            emit_args_to_label(
                app,
                target,
                "tab:merge-preview-update",
                vec![json!(x), json!(y)],
            );
        }
        return target;
    }

    if let Some(previous) = &previous {
        emit_args_to_label(app, previous, "tab:merge-preview-cancel", vec![]);
    }
    if let Some(target) = &target {
        emit_args_to_label(
            app,
            target,
            "tab:merge-preview",
            vec![tab_data.clone(), json!(x), json!(y)],
        );
    }

    previews.insert(source.to_string(), target.clone());
    target
}

fn finish_merge<R: Runtime>(
    app: &AppHandle<R>,
    source: &str,
    target: Option<String>,
    tab_data: Value,
) -> Option<String> {
    let state = app.state::<AppState>();
    let mut previews = state.merge_previews.lock().unwrap();
    let preview_target = previews.remove(source).flatten();

    // Use the release position for both whole-window and torn-off tab drags.
    // A preview over another window must be cancelled before committing.
    if let Some(preview_target) = &preview_target {
        if target.as_ref() != Some(preview_target) {
            emit_args_to_label(app, preview_target, "tab:merge-preview-cancel", vec![]);
        }
    }

    if let Some(target) = &target {
        let event = if preview_target.as_ref() == Some(target) {
            "tab:merge-preview-finalize"
        } else {
            "tab:merge-in"
        };
        // Both events carry the committed data so the renderer can promote
        // the preview in place, or insert one tab if no preview was received.
        emit_args_to_label(app, target, event, vec![tab_data]);
    }
    target
}

fn clear_merge_preview<R: Runtime>(app: &AppHandle<R>, source: &str) {
    let target = app
        .state::<AppState>()
        .merge_previews
        .lock()
        .unwrap()
        .remove(source)
        .flatten();
    if let Some(target) = &target {
        emit_args_to_label(app, target, "tab:merge-preview-cancel", vec![]);
    }
}

fn close_preview_window<R: Runtime>(app: &AppHandle<R>, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.destroy();
    }
}

#[tauri::command]
pub async fn tear_off_start<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    tab_data: Value,
    screen_x: f64,
    screen_y: f64,
    offset_x: f64,
    offset_y: f64,
) -> Result<bool, String> {
    let source = window.label().to_string();
    let new_window = match window::create_editor_window(
        &app,
        window::CreateWindowOptions {
            x: Some((screen_x - offset_x).round()),
            y: Some((screen_y - offset_y).round()),
            tab_data: Some(tab_data.clone()),
            fast_create: true,
            center: false,
            ..Default::default()
        },
    ) {
        Ok(window) => window,
        Err(error) => {
            eprintln!("[tear-off] 创建窗口失败: {error}");
            return Ok(false);
        }
    };

    let new_label = new_window.label().to_string();
    let generation = {
        let state = app.state::<AppState>();
        let generation = state.drag_generation.fetch_add(1, Ordering::SeqCst) + 1;
        *state.drag_session.lock().unwrap() = Some(DragSession {
            generation,
            source: Some(source.clone()),
            new_window: new_label.clone(),
            tab_data: tab_data.clone(),
        });
        generation
    };

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut hidden_for_preview = false;
        loop {
            tokio::time::sleep(Duration::from_millis(16)).await;
            let state = app_handle.state::<AppState>();
            if state.drag_generation.load(Ordering::SeqCst) != generation {
                break;
            }
            let session_active = state
                .drag_session
                .lock()
                .unwrap()
                .as_ref()
                .map(|session| session.generation == generation)
                .unwrap_or(false);
            if !session_active {
                break;
            }

            let Some(new_window) = app_handle.get_webview_window(&new_label) else {
                break;
            };
            let cursor = window::cursor_logical(&new_window).or_else(|| {
                app_handle
                    .get_webview_window(&source)
                    .and_then(|window| window::cursor_logical(&window))
            });
            let Some((cursor_x, cursor_y)) = cursor else {
                continue;
            };

            let _ = new_window.set_position(tauri::LogicalPosition::new(
                cursor_x - offset_x,
                cursor_y - offset_y,
            ));

            let target = set_merge_preview(
                &app_handle,
                &source,
                &tab_data,
                cursor_x,
                cursor_y,
                &[new_label.clone()],
                generation,
            );

            if target.is_some() && !hidden_for_preview {
                let _ = new_window.hide();
                hidden_for_preview = true;
            } else if target.is_none() && hidden_for_preview {
                let _ = new_window.show();
                hidden_for_preview = false;
            }
        }

        if let Some(window) = app_handle.get_webview_window(&new_label) {
            let _ = window.show();
        }
    });

    Ok(true)
}

#[tauri::command]
pub async fn tear_off_end<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    screen_x: f64,
    screen_y: f64,
) -> Result<MergeResult, String> {
    let source = window.label().to_string();
    let session = {
        let state = app.state::<AppState>();
        state.drag_generation.fetch_add(1, Ordering::SeqCst);
        let session = state.drag_session.lock().unwrap().take();
        session
    };
    let Some(session) = session else {
        return Ok(window::result_merge("failed"));
    };

    let target = window::find_window_at(
        &app,
        screen_x,
        screen_y,
        &[source.clone(), session.new_window.clone()],
    );
    if let Some(target) = finish_merge(
        &app,
        session.source.as_deref().unwrap_or(&source),
        target,
        session.tab_data,
    ) {
        window::focus_window(&app, &target);
        close_preview_window(&app, &session.new_window);
        return Ok(window::result_merge("merged"));
    }

    window::focus_after_delay(&app, session.new_window, 200);
    Ok(window::result_merge("created"))
}

#[tauri::command]
pub async fn tear_off_cancel<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    let session = {
        let state = app.state::<AppState>();
        state.drag_generation.fetch_add(1, Ordering::SeqCst);
        let session = state.drag_session.lock().unwrap().take();
        session
    };
    if let Some(session) = session {
        let source = session.source.unwrap_or_default();
        if !source.is_empty() {
            clear_merge_preview(&app, &source);
        }
        close_preview_window(&app, &session.new_window);
    }
    Ok(true)
}

#[tauri::command]
pub fn start_window_drag<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    tab_data: Value,
    offset_x: f64,
    offset_y: f64,
) {
    let source = window.label().to_string();
    let generation = {
        let state = app.state::<AppState>();
        let generation = state.drag_generation.fetch_add(1, Ordering::SeqCst) + 1;
        *state.window_drag_session.lock().unwrap() = Some(WindowDragSession {
            generation,
            source: source.clone(),
        });
        generation
    };

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(16)).await;
            let state = app_handle.state::<AppState>();
            if state.drag_generation.load(Ordering::SeqCst) != generation {
                break;
            }
            let session_active = state
                .window_drag_session
                .lock()
                .unwrap()
                .as_ref()
                .map(|session| session.generation == generation)
                .unwrap_or(false);
            if !session_active {
                break;
            }

            let Some(source_window) = app_handle.get_webview_window(&source) else {
                break;
            };
            let Some((cursor_x, cursor_y)) = window::cursor_logical(&source_window) else {
                continue;
            };
            let _ = source_window.set_position(tauri::LogicalPosition::new(
                cursor_x - offset_x,
                cursor_y - offset_y,
            ));
            set_merge_preview(
                &app_handle,
                &source,
                &tab_data,
                cursor_x,
                cursor_y,
                &[],
                generation,
            );
        }
    });
}

#[tauri::command]
pub fn stop_window_drag<R: Runtime>(app: AppHandle<R>) {
    let session = {
        let state = app.state::<AppState>();
        state.drag_generation.fetch_add(1, Ordering::SeqCst);
        let session = state.window_drag_session.lock().unwrap().take();
        session
    };
    if let Some(session) = session {
        clear_merge_preview(&app, &session.source);
    }
}

#[tauri::command]
pub async fn drop_merge<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    tab_data: Value,
    screen_x: f64,
    screen_y: f64,
) -> Result<MergeResult, String> {
    let source = window.label().to_string();
    {
        let state = app.state::<AppState>();
        state.drag_generation.fetch_add(1, Ordering::SeqCst);
        let _ = state.window_drag_session.lock().unwrap().take();
    }

    let release_target = window::find_window_at(&app, screen_x, screen_y, &[source.clone()]);

    if let Some(target) = finish_merge(&app, &source, release_target, tab_data) {
        window::focus_window(&app, &target);
        return Ok(window::result_merge("merged"));
    }

    Ok(window::result_merge("none"))
}

pub fn cleanup_for_window<R: Runtime>(app: &AppHandle<R>, label: &str) {
    let state = app.state::<AppState>();
    {
        let mut previews = state.merge_previews.lock().unwrap();
        previews.remove(label);
    }
    {
        let mut session = state.drag_session.lock().unwrap();
        if session
            .as_ref()
            .map(|session| session.new_window == label || session.source.as_deref() == Some(label))
            .unwrap_or(false)
        {
            *session = None;
            state.drag_generation.fetch_add(1, Ordering::SeqCst);
        }
    }
    {
        let mut session = state.window_drag_session.lock().unwrap();
        if session
            .as_ref()
            .map(|session| session.source == label)
            .unwrap_or(false)
        {
            *session = None;
            state.drag_generation.fetch_add(1, Ordering::SeqCst);
        }
    }
}
