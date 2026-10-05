//! 图片插入规则相关命令：本地图片复制、网络图片下载
//!
//! 与 `write_temp_image`（剪贴板位图落盘）配套，共同支撑设置页「图片」的四项规则：
//! 本地位置的图片应用规则（`copy_local_image`）、网络位置的图片应用规则（`download_network_image`）、
//! 保存目录选择与图片语法偏好（`ImagePathOptions`）。

use std::path::{Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};

use serde::Deserialize;
use tauri::{AppHandle, Manager, Runtime};

use crate::paths::{
    create_image_file_name, resolve_image_markdown_path, resolve_image_save_directory,
    ImagePathOptions,
};

/// 本地图片（磁盘上已有文件）按规则复制到文档目录的入参
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CopyLocalImagePayload {
    /// 源图片的绝对路径
    pub source_path: String,
    /// 目标目录：相对当前文件目录的子目录或绝对路径（空串 = 当前文件目录）
    #[serde(default)]
    pub target_path: String,
    /// 当前 Markdown 文件路径（决定相对目录的基准与写回 Markdown 的相对路径）
    #[serde(default)]
    pub current_file_path: Option<String>,
    /// 使用 `${filename}.assets` 同名文件夹
    #[serde(default)]
    pub use_file_name_folder: Option<bool>,
    /// 优先写成相对路径
    #[serde(default)]
    pub prefer_relative: Option<bool>,
    /// 相对路径加 ./ 前缀
    #[serde(default)]
    pub add_dot_slash: Option<bool>,
}

/// 网络图片下载落盘的入参
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DownloadNetworkImagePayload {
    /// 图片地址（http/https）
    pub url: String,
    #[serde(default)]
    pub target_path: String,
    #[serde(default)]
    pub current_file_path: Option<String>,
    #[serde(default)]
    pub use_file_name_folder: Option<bool>,
    #[serde(default)]
    pub prefer_relative: Option<bool>,
    #[serde(default)]
    pub add_dot_slash: Option<bool>,
}

/// 应用数据目录（临时图片与无文档时的落盘基准），与 clipboard 命令保持一致
fn app_data_dir<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("LiveMD"))
}

/// 从路径取规范化的绝对形式，用于判断"源文件已经在目标位置上"
fn normalized(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

/// 在目标目录中为图片找一个不冲突的文件名（保留原扩展名）
fn unique_target_path(dir: &Path, file_name: &str) -> PathBuf {
    let candidate = dir.join(file_name);
    if !candidate.exists() {
        return candidate;
    }

    let stem = Path::new(file_name)
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "image".to_string());
    let extension = Path::new(file_name)
        .extension()
        .map(|value| format!(".{}", value.to_string_lossy()))
        .unwrap_or_default();

    for index in 1..1000 {
        let next = dir.join(format!("{stem}-{index}{extension}"));
        if !next.exists() {
            return next;
        }
    }

    // 极端情况下退化为时间戳命名，保证不覆盖已有文件
    let millis = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    dir.join(format!("{stem}-{millis}{extension}"))
}

/// 把磁盘上的图片复制到目标目录，返回写入 Markdown 的地址（失败返回 None）
#[tauri::command]
pub fn copy_local_image<R: Runtime>(
    app: AppHandle<R>,
    payload: CopyLocalImagePayload,
) -> Result<Option<String>, String> {
    let source = Path::new(&payload.source_path);
    if !source.is_file() {
        println!("[image] 源图片不存在，跳过复制: {}", payload.source_path);
        return Ok(None);
    }

    let (absolute_dir, is_relative) = resolve_image_save_directory(
        &payload.target_path,
        payload.current_file_path.as_deref(),
        payload.use_file_name_folder.unwrap_or(false),
        &app_data_dir(&app),
    );
    std::fs::create_dir_all(&absolute_dir).map_err(|error| error.to_string())?;

    let file_name = source
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "image.png".to_string());

    // 源文件与目标同名同目录时直接复用，避免自复制报错
    if normalized(source) == normalized(&absolute_dir.join(&file_name)) {
        return Ok(Some(resolve_image_markdown_path(
            &source.to_string_lossy(),
            is_relative,
            payload.current_file_path.as_deref(),
            ImagePathOptions {
                prefer_relative: payload.prefer_relative.unwrap_or(false),
                add_dot_slash: payload.add_dot_slash.unwrap_or(false),
            },
        )));
    }

    let target = unique_target_path(&absolute_dir, &file_name);
    std::fs::copy(source, &target).map_err(|error| error.to_string())?;
    println!("[image] 本地图片已复制: {} -> {}", payload.source_path, target.display());

    Ok(Some(resolve_image_markdown_path(
        &target.to_string_lossy(),
        is_relative,
        payload.current_file_path.as_deref(),
        ImagePathOptions {
            prefer_relative: payload.prefer_relative.unwrap_or(false),
            add_dot_slash: payload.add_dot_slash.unwrap_or(false),
        },
    )))
}

/// 从 URL 推断文件名（去掉 query / fragment，取最后一段）
fn file_name_from_url(url: &str) -> Option<String> {
    let without_query = url.split(['?', '#']).next().unwrap_or(url);
    let last = without_query.rsplit('/').next()?;
    if last.is_empty() {
        return None;
    }
    let decoded = percent_encoding::percent_decode_str(last)
        .decode_utf8_lossy()
        .to_string();
    Some(decoded)
}

/// 下载网络图片并落盘到目标目录，返回写入 Markdown 的地址（下载失败返回 None）
#[tauri::command]
pub async fn download_network_image<R: Runtime>(
    app: AppHandle<R>,
    payload: DownloadNetworkImagePayload,
) -> Result<Option<String>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())?;

    let response = match client.get(&payload.url).send().await {
        Ok(response) => response,
        Err(error) => {
            println!("[image] 下载网络图片失败: {} ({error})", payload.url);
            return Ok(None);
        }
    };

    if !response.status().is_success() {
        println!(
            "[image] 下载网络图片返回非成功状态: {} ({})",
            payload.url,
            response.status()
        );
        return Ok(None);
    }

    // 扩展名优先取 URL 自带的，缺失时按 Content-Type 推断
    let mime_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.split(';').next().unwrap_or(value).trim().to_string());

    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    if bytes.is_empty() {
        return Ok(None);
    }

    let (absolute_dir, is_relative) = resolve_image_save_directory(
        &payload.target_path,
        payload.current_file_path.as_deref(),
        payload.use_file_name_folder.unwrap_or(false),
        &app_data_dir(&app),
    );
    std::fs::create_dir_all(&absolute_dir).map_err(|error| error.to_string())?;

    let file_name = create_image_file_name(
        file_name_from_url(&payload.url).as_deref(),
        mime_type.as_deref(),
    );
    let target = absolute_dir.join(file_name);
    std::fs::write(&target, &bytes).map_err(|error| error.to_string())?;
    println!("[image] 网络图片已保存: {} -> {}", payload.url, target.display());

    Ok(Some(resolve_image_markdown_path(
        &target.to_string_lossy(),
        is_relative,
        payload.current_file_path.as_deref(),
        ImagePathOptions {
            prefer_relative: payload.prefer_relative.unwrap_or(false),
            add_dot_slash: payload.add_dot_slash.unwrap_or(false),
        },
    )))
}
