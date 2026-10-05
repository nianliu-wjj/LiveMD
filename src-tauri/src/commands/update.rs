use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::OnceLock;
use std::time::Duration;

use futures_util::StreamExt;
use regex::Regex;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_opener::OpenerExt;
use tokio::io::AsyncWriteExt;

use crate::events::broadcast_editor_args;
use crate::models::UpdateInfo;
use crate::state::AppState;
use crate::window;

const LATEST_RELEASE_API: &str =
    "https://api.github.com/repos/nianliu-wjj/LiveMD/releases/latest";
const USER_AGENT: &str = "LiveMD";

#[derive(Debug, Clone, Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
    #[serde(default)]
    size: u64,
}

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    #[serde(default)]
    tag_name: String,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    published_at: Option<String>,
    #[serde(default)]
    html_url: Option<String>,
    #[serde(default)]
    assets: Vec<GitHubAsset>,
}

#[derive(Debug, Clone)]
struct ParsedVersion {
    major: u64,
    minor: u64,
    patch: u64,
    prerelease: Option<String>,
    prerelease_number: u64,
}

fn prefix_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)^(?:Beta-|Alpha-|RC-)?v?").expect("prefix regex"))
}

fn build_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"[-+]([a-zA-Z][a-zA-Z0-9-]*?)$").expect("build metadata regex")
    })
}

fn prerelease_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)-(alpha|beta|rc)\.?(\d+)?$").expect("prerelease regex"))
}

fn prerelease_cleanup_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)-(alpha|beta|rc)\.?\d*$").expect("prerelease cleanup regex"))
}

fn parse_version(version: &str) -> Option<ParsedVersion> {
    let mut cleaned = prefix_regex().replace(version, "").to_string();

    if let Some(captures) = build_regex().captures(&cleaned) {
        if let Some(build) = captures.get(1) {
            if !build.as_str().starts_with(|ch: char| ch.is_ascii_digit()) {
                cleaned = build_regex().replace(&cleaned, "").to_string();
            }
        }
    }

    let mut prerelease = None;
    let mut prerelease_number = 0;
    if let Some(captures) = prerelease_regex().captures(&cleaned) {
        prerelease = captures
            .get(1)
            .map(|value| value.as_str().to_ascii_lowercase());
        prerelease_number = captures
            .get(2)
            .and_then(|value| value.as_str().parse::<u64>().ok())
            .unwrap_or(0);
        cleaned = prerelease_cleanup_regex()
            .replace(&cleaned, "")
            .to_string();
    }

    let parts: Vec<u64> = cleaned
        .split('.')
        .map(|part| part.parse::<u64>().ok())
        .collect::<Option<Vec<_>>>()?;
    if parts.is_empty() {
        return None;
    }

    Some(ParsedVersion {
        major: *parts.first().unwrap_or(&0),
        minor: *parts.get(1).unwrap_or(&0),
        patch: *parts.get(2).unwrap_or(&0),
        prerelease,
        prerelease_number,
    })
}

fn prerelease_order(value: &Option<String>) -> u64 {
    match value.as_deref() {
        Some("alpha") => 1,
        Some("beta") => 2,
        Some("rc") => 3,
        Some(_) => 0,
        None => 999,
    }
}

fn is_newer_version(latest: &str, current: &str) -> bool {
    let (Some(latest), Some(current)) = (parse_version(latest), parse_version(current)) else {
        return latest > current;
    };

    if latest.major != current.major {
        return latest.major > current.major;
    }
    if latest.minor != current.minor {
        return latest.minor > current.minor;
    }
    if latest.patch != current.patch {
        return latest.patch > current.patch;
    }

    let latest_order = prerelease_order(&latest.prerelease);
    let current_order = prerelease_order(&current.prerelease);
    if latest_order != current_order {
        return latest_order > current_order;
    }

    if latest.prerelease.is_some() && current.prerelease.is_some() {
        return latest.prerelease_number > current.prerelease_number;
    }

    false
}

fn select_asset(release: &GitHubRelease) -> Option<&GitHubAsset> {
    #[cfg(windows)]
    {
        return release
            .assets
            .iter()
            .find(|asset| {
                let name = asset.name.to_ascii_lowercase();
                name.ends_with(".exe") && name.contains("setup")
            })
            .or_else(|| {
                release
                    .assets
                    .iter()
                    .find(|asset| asset.name.to_ascii_lowercase().ends_with(".exe"))
            });
    }

    #[cfg(target_os = "macos")]
    {
        let arch = match std::env::consts::ARCH {
            "aarch64" => "arm64",
            "x86_64" => "x64",
            other => other,
        };
        let dmg_assets: Vec<&GitHubAsset> = release
            .assets
            .iter()
            .filter(|asset| asset.name.to_ascii_lowercase().ends_with(".dmg"))
            .collect();

        if let Some(asset) = dmg_assets.iter().find(|asset| asset.name.contains(arch)) {
            return Some(asset);
        }
        if arch == "arm64" {
            return dmg_assets
                .iter()
                .find(|asset| !asset.name.contains("x64"))
                .copied()
                .or_else(|| dmg_assets.first().copied());
        }
        return dmg_assets
            .iter()
            .find(|asset| !asset.name.contains("arm64"))
            .copied();
    }

    #[cfg(target_os = "linux")]
    {
        return release
            .assets
            .iter()
            .find(|asset| asset.name.to_ascii_lowercase().ends_with(".appimage"));
    }

    #[allow(unreachable_code)]
    None
}

fn update_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("updates");
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn broadcast_status<R: Runtime>(app: &AppHandle<R>, value: Value) {
    broadcast_editor_args(app, "update:status", vec![value]);
}

#[tauri::command]
pub async fn check_for_updates<R: Runtime>(app: AppHandle<R>) -> Result<Option<Value>, String> {
    broadcast_status(&app, json!({ "status": "checking" }));

    let client = reqwest::Client::new();
    let response = client
        .get(LATEST_RELEASE_API)
        .header(reqwest::header::USER_AGENT, USER_AGENT)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(|error| error.to_string())?;

    if !response.status().is_success() {
        return Err(format!("GitHub API Error: {}", response.status()));
    }

    let release: GitHubRelease = response.json().await.map_err(|error| error.to_string())?;
    let current_version = app.package_info().version.to_string();

    if !is_newer_version(&release.tag_name, &current_version) {
        broadcast_status(&app, json!({ "status": "not-available" }));
        return Ok(None);
    }

    let Some(asset) = select_asset(&release) else {
        broadcast_status(
            &app,
            json!({ "status": "not-available", "info": { "reason": "no-asset" } }),
        );
        return Ok(None);
    };

    let info = UpdateInfo {
        version: release.tag_name.clone(),
        notes: release.body.clone(),
        date: release.published_at.clone(),
        url: asset.browser_download_url.clone(),
        filename: asset.name.clone(),
        size: asset.size,
        release_page_url: release.html_url.clone(),
    };

    {
        let state = app.state::<AppState>();
        let mut update = state.update.lock().unwrap();
        update.info = Some(info.clone());
        update.downloaded_path = None;
    }

    broadcast_status(&app, json!({ "status": "available", "info": info }));
    Ok(Some(json!({ "updateInfo": info })))
}

#[tauri::command]
pub async fn download_update<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, String> {
    let info = {
        let state = app.state::<AppState>();
        let info = state.update.lock().unwrap().info.clone();
        info.ok_or_else(|| "No update check info found".to_string())?
    };

    let dir = update_dir(&app)?;
    let target_path = dir.join(&info.filename);
    let expected_size = info.size;
    let state = app.state::<AppState>();
    state.update_cancel.store(false, Ordering::SeqCst);
    state.update.lock().unwrap().downloading = true;

    let result = download_to_file(&app, &info, &target_path, expected_size).await;

    {
        let state = app.state::<AppState>();
        state.update.lock().unwrap().downloading = false;
    }

    match result {
        Ok(Some(path)) => {
            {
                let state = app.state::<AppState>();
                state.update.lock().unwrap().downloaded_path = Some(path.clone());
            }
            broadcast_editor_args(&app, "update:download-progress", vec![json!({
                "percent": 100.0,
                "total": expected_size,
                "transferred": expected_size,
            })]);
            broadcast_status(&app, json!({ "status": "downloaded", "info": info }));
            Ok(Some(path.to_string_lossy().to_string()))
        }
        Ok(None) => {
            broadcast_status(&app, json!({ "status": "idle" }));
            Ok(None)
        }
        Err(error) => {
            broadcast_status(&app, json!({ "status": "error", "error": error }));
            Err(error)
        }
    }
}

async fn download_to_file<R: Runtime>(
    app: &AppHandle<R>,
    info: &UpdateInfo,
    target_path: &PathBuf,
    expected_size: u64,
) -> Result<Option<PathBuf>, String> {
    let mut start_byte = 0u64;

    if target_path.exists() {
        let current_size = std::fs::metadata(target_path)
            .map_err(|error| error.to_string())?
            .len();
        if expected_size > 0 && current_size == expected_size {
            return Ok(Some(target_path.clone()));
        }
        if expected_size > 0 && current_size < expected_size {
            start_byte = current_size;
        } else {
            let _ = std::fs::remove_file(target_path);
        }
    }

    let client = reqwest::Client::new();
    let mut request = client
        .get(&info.url)
        .header(reqwest::header::USER_AGENT, USER_AGENT);
    if start_byte > 0 {
        request = request.header(reqwest::header::RANGE, format!("bytes={start_byte}-"));
    }

    let response = request.send().await.map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Download failed: {}", response.status()));
    }

    let mut start_byte = if response.status() == reqwest::StatusCode::PARTIAL_CONTENT {
        start_byte
    } else {
        0
    };
    if response.status() == reqwest::StatusCode::OK && start_byte > 0 {
        start_byte = 0;
    }

    let content_length = response.content_length().unwrap_or_else(|| {
        expected_size.saturating_sub(start_byte)
    });
    let total_bytes = start_byte + content_length;

    let mut options = tokio::fs::OpenOptions::new();
    options.create(true).write(true);
    if start_byte > 0 {
        options.append(true);
    } else {
        options.truncate(true);
    }
    let mut file = options
        .open(target_path)
        .await
        .map_err(|error| error.to_string())?;

    let mut downloaded = start_byte;
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        if app
            .state::<AppState>()
            .update_cancel
            .load(Ordering::SeqCst)
        {
            let _ = file.flush().await;
            return Ok(None);
        }
        let chunk = chunk.map_err(|error| error.to_string())?;
        file.write_all(&chunk)
            .await
            .map_err(|error| error.to_string())?;
        downloaded += chunk.len() as u64;

        if total_bytes > 0 {
            broadcast_editor_args(app, "update:download-progress", vec![json!({
                "percent": (downloaded as f64 / total_bytes as f64) * 100.0,
                "total": total_bytes,
                "transferred": downloaded,
            })]);
        }
    }

    file.flush().await.map_err(|error| error.to_string())?;
    drop(file);

    Ok(Some(target_path.clone()))
}

#[tauri::command]
pub fn cancel_update<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let state = app.state::<AppState>();
    let downloading = state.update.lock().unwrap().downloading;
    if downloading {
        state.update_cancel.store(true, Ordering::SeqCst);
    } else {
        broadcast_status(&app, json!({ "status": "idle" }));
    }
    Ok(())
}

#[tauri::command]
pub async fn install_update<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let path = {
        let state = app.state::<AppState>();
        let update = state.update.lock().unwrap();
        update.downloaded_path.clone().or_else(|| {
            update
                .info
                .as_ref()
                .and_then(|info| update_dir(&app).ok().map(|dir| dir.join(&info.filename)))
        })
    };

    let Some(path) = path else {
        return Err("Installer not found".to_string());
    };
    if !path.exists() {
        return Err("Installer not found".to_string());
    }

    app.opener()
        .open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|error| error.to_string())?;

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(1000)).await;
        window::mark_quitting(&app_handle);
        app_handle.exit(0);
    });

    Ok(())
}
