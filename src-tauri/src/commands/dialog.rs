use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, Runtime, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult};

use crate::models::OpenDialogResult;

#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
struct DialogFilter {
    #[serde(default)]
    name: String,
    #[serde(default)]
    extensions: Vec<String>,
}

#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct OpenDialogOptions {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    default_path: Option<String>,
    #[serde(default)]
    filters: Option<Vec<DialogFilter>>,
    #[serde(default)]
    properties: Option<Vec<String>>,
}

fn file_path_to_buf(path: tauri_plugin_dialog::FilePath) -> Option<PathBuf> {
    path.into_path().ok()
}

fn show_message_with_buttons<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
    title: &str,
    message: &str,
    buttons: MessageDialogButtons,
    kind: MessageDialogKind,
) -> MessageDialogResult {
    app.dialog()
        .message(message.to_string())
        .title(title.to_string())
        .parent(window)
        .kind(kind)
        .buttons(buttons)
        .blocking_show_with_result()
}

fn custom_button_index(result: MessageDialogResult, labels: [&str; 3]) -> i32 {
    match result {
        MessageDialogResult::Custom(label) => labels
            .iter()
            .position(|candidate| *candidate == label)
            .map(|index| index as i32)
            .unwrap_or(0),
        MessageDialogResult::Yes => 0,
        MessageDialogResult::No => 1,
        MessageDialogResult::Ok => 0,
        MessageDialogResult::Cancel => 0,
    }
}

#[tauri::command]
pub async fn show_open_dialog<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    options: OpenDialogOptions,
) -> Result<OpenDialogResult, String> {
    let properties = options.properties.unwrap_or_default();
    let is_directory = properties.iter().any(|value| value == "openDirectory");
    let allow_multiple = properties.iter().any(|value| value == "multiSelections");

    let mut builder = app.dialog().file().set_parent(&window);
    if let Some(title) = options.title {
        builder = builder.set_title(title);
    }
    if let Some(default_path) = options.default_path.filter(|value| !value.is_empty()) {
        let path = Path::new(&default_path);
        if path.is_dir() {
            builder = builder.set_directory(path);
        } else if let Some(parent) = path.parent() {
            builder = builder.set_directory(parent);
            if let Some(name) = path.file_name().and_then(|name| name.to_str()) {
                builder = builder.set_file_name(name);
            }
        }
    }
    if let Some(filters) = options.filters {
        for filter in filters {
            if filter.extensions.is_empty() {
                continue;
            }
            let extensions: Vec<&str> = filter.extensions.iter().map(String::as_str).collect();
            builder = builder.add_filter(
                if filter.name.is_empty() {
                    "Files".to_string()
                } else {
                    filter.name
                },
                &extensions,
            );
        }
    }

    let file_paths: Vec<String> = if is_directory {
        if allow_multiple {
            builder
                .blocking_pick_folders()
                .unwrap_or_default()
                .into_iter()
                .filter_map(file_path_to_buf)
                .map(|path| path.to_string_lossy().to_string())
                .collect()
        } else {
            builder
                .blocking_pick_folder()
                .and_then(file_path_to_buf)
                .map(|path| vec![path.to_string_lossy().to_string()])
                .unwrap_or_default()
        }
    } else if allow_multiple {
        builder
            .blocking_pick_files()
            .unwrap_or_default()
            .into_iter()
            .filter_map(file_path_to_buf)
            .map(|path| path.to_string_lossy().to_string())
            .collect()
    } else {
        builder
            .blocking_pick_file()
            .and_then(file_path_to_buf)
            .map(|path| vec![path.to_string_lossy().to_string()])
            .unwrap_or_default()
    };

    Ok(OpenDialogResult {
        canceled: file_paths.is_empty(),
        file_paths,
    })
}

#[tauri::command]
pub async fn show_overwrite_confirm<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    file_name: String,
) -> Result<i32, String> {
    let message = format!("文件 \"{file_name}\" 已存在，是否要覆盖当前内容？");
    let result = show_message_with_buttons(
        &app,
        &window,
        "文件已存在",
        &format!("{message}\n\n选择\"保存\"将先保存当前内容，然后打开新文件。"),
        MessageDialogButtons::YesNoCancelCustom(
            "取消".to_string(),
            "覆盖".to_string(),
            "保存".to_string(),
        ),
        MessageDialogKind::Info,
    );
    Ok(custom_button_index(result, ["取消", "覆盖", "保存"]))
}

#[tauri::command]
pub async fn show_close_confirm<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    file_name: String,
) -> Result<i32, String> {
    let result = show_message_with_buttons(
        &app,
        &window,
        "文件未保存",
        &format!("文件 \"{file_name}\" 有未保存的更改。\n\n是否要保存更改？"),
        MessageDialogButtons::YesNoCancelCustom(
            "取消".to_string(),
            "不保存".to_string(),
            "保存".to_string(),
        ),
        MessageDialogKind::Warning,
    );
    Ok(custom_button_index(result, ["取消", "不保存", "保存"]))
}

#[tauri::command]
pub async fn show_image_unsaved_choice<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<String, String> {
    let result = show_message_with_buttons(
        &app,
        &window,
        "保存文件后再插入图片？",
        "当前文档尚未保存，无法创建文件同名图片文件夹。\n\n你可以先保存当前 Markdown 文件，或临时使用现有本地路径设置保存图片。",
        MessageDialogButtons::YesNoCancelCustom(
            "保存文件".to_string(),
            "使用现有路径".to_string(),
            "取消".to_string(),
        ),
        MessageDialogKind::Warning,
    );
    Ok(match custom_button_index(result, ["保存文件", "使用现有路径", "取消"]) {
        0 => "save".to_string(),
        1 => "fallback".to_string(),
        _ => "cancel".to_string(),
    })
}

#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct MessageBoxOptions {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    detail: Option<String>,
    #[serde(default)]
    buttons: Option<Vec<String>>,
    #[serde(default)]
    default_id: Option<usize>,
}

#[tauri::command]
pub async fn show_message_box<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    options: MessageBoxOptions,
) -> Result<serde_json::Value, String> {
    let title = options.title.unwrap_or_else(|| "LiveMD".to_string());
    let message = match options.detail {
        Some(detail) if !detail.is_empty() => {
            format!("{}\n\n{}", options.message.unwrap_or_default(), detail)
        }
        _ => options.message.unwrap_or_default(),
    };
    let labels = options.buttons.unwrap_or_else(|| vec!["确定".to_string()]);
    let default_id = options.default_id.unwrap_or(0).min(labels.len().saturating_sub(1));

    let (buttons, mapping): (MessageDialogButtons, Vec<usize>) = match labels.len() {
        0 => (MessageDialogButtons::Ok, vec![0]),
        1 => (
            MessageDialogButtons::OkCustom(labels[0].clone()),
            vec![0],
        ),
        2 => (
            MessageDialogButtons::OkCancelCustom(labels[0].clone(), labels[1].clone()),
            vec![0, 1],
        ),
        _ => (
            MessageDialogButtons::YesNoCancelCustom(
                labels[0].clone(),
                labels[1].clone(),
                labels[2].clone(),
            ),
            vec![0, 1, 2],
        ),
    };

    let result = show_message_with_buttons(
        &app,
        &window,
        &title,
        &message,
        buttons,
        MessageDialogKind::Info,
    );

    let index = match result {
        MessageDialogResult::Custom(label) => labels
            .iter()
            .position(|candidate| *candidate == label)
            .unwrap_or(default_id),
        MessageDialogResult::Yes | MessageDialogResult::Ok => mapping.first().copied().unwrap_or(0),
        MessageDialogResult::No => mapping.get(1).copied().unwrap_or(0),
        MessageDialogResult::Cancel => labels.len().saturating_sub(1),
    };

    Ok(json!({ "response": index as i32, "checkboxChecked": false }))
}
