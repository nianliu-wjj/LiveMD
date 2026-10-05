use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, UNIX_EPOCH};

use notify::{EventKind, RecursiveMode, Watcher};
use serde_json::json;
use tauri::{AppHandle, Manager, Runtime};

use crate::events::broadcast_editor_args;
use crate::file_format::is_markdown_file_path;
use crate::state::{AppState, FileStamp};
use crate::window;

const IGNORED_DIRS: &[&str] = &[
    ".git",
    ".vscode",
    ".idea",
    "node_modules",
    ".next",
    ".nuxt",
    "dist",
    "build",
    "coverage",
];
const MAX_WATCH_DEPTH: usize = 10;
const MAX_WATCH_ENTRIES: usize = 20_000;

pub fn normalize_watch_path(path: &str) -> String {
    let lower = path.to_ascii_lowercase();
    if lower.starts_with("\\\\?\\unc\\") {
        format!("\\\\{}", &path[8..])
    } else if lower.starts_with("\\\\?\\") && path.len() > 4 {
        path[4..].to_string()
    } else {
        path.to_string()
    }
}

pub fn is_wsl_path(path: &str) -> bool {
    let normalized = normalize_watch_path(path).to_ascii_lowercase();
    normalized.starts_with("\\\\wsl$\\") || normalized.starts_with("\\\\wsl.localhost\\")
}

fn is_ignored_path(path: &Path) -> bool {
    path.components().any(|component| {
        let value = component.as_os_str().to_string_lossy();
        IGNORED_DIRS.iter().any(|ignored| value.eq_ignore_ascii_case(ignored))
    })
}

fn relative_depth(root: &Path, path: &Path) -> usize {
    path.strip_prefix(root)
        .map(|relative| relative.components().count())
        .unwrap_or(usize::MAX)
}

fn file_stamp(path: &Path) -> FileStamp {
    match std::fs::metadata(path) {
        Ok(metadata) if metadata.is_file() => {
            let modified_ms = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis() as u64)
                .unwrap_or_default();
            FileStamp {
                exists: true,
                modified_ms,
                size: metadata.len(),
            }
        }
        _ => FileStamp {
            exists: false,
            modified_ms: 0,
            size: 0,
        },
    }
}

fn collect_window_files<R: Runtime>(app: &AppHandle<R>, only_wsl: bool) -> Vec<String> {
    let state = app.state::<AppState>();
    let windows = state.windows.lock().unwrap();
    let mut files = HashSet::new();
    for meta in windows.values() {
        for file in &meta.open_files {
            if is_wsl_path(file) == only_wsl {
                files.insert(file.clone());
            }
        }
    }
    files.into_iter().collect()
}

pub fn update_file_watchers<R: Runtime>(app: &AppHandle<R>, label: &str, files: Vec<String>) {
    window::update_window_open_files(app, label, files);
    rebuild_local_file_watcher(app);
    restart_wsl_file_poller(app);
}

fn rebuild_local_file_watcher<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<AppState>();
    {
        let mut watcher = state.local_file_watcher.lock().unwrap();
        *watcher = None;
    }

    let paths = collect_window_files(app, false);
    if paths.is_empty() {
        return;
    }

    let app_handle = app.clone();
    let mut watcher = match notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        let Ok(event) = result else {
            return;
        };
        for path in event.paths {
            let path_string = path.to_string_lossy().to_string();
            if is_markdown_file_path(&path_string) {
                broadcast_editor_args(&app_handle, "file:changed", vec![json!(path_string)]);
            }
        }
    }) {
        Ok(watcher) => watcher,
        Err(error) => {
            eprintln!("[watcher] 创建文件监听器失败: {error}");
            return;
        }
    };

    for path in paths {
        let _ = watcher.watch(Path::new(&path), RecursiveMode::NonRecursive);
    }

    *state.local_file_watcher.lock().unwrap() = Some(watcher);
}

fn restart_wsl_file_poller<R: Runtime>(app: &AppHandle<R>) {
    let generation = {
        let state = app.state::<AppState>();
        state.wsl_files_generation.fetch_add(1, Ordering::SeqCst) + 1
    };

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let initial_files = collect_window_files(&app_handle, true);
        let mut previous: HashMap<String, FileStamp> = initial_files
            .iter()
            .map(|path| (path.clone(), file_stamp(Path::new(path))))
            .collect();
        {
            let state = app_handle.state::<AppState>();
            *state.wsl_file_snapshot.lock().unwrap() = previous.clone();
        }

        loop {
            tokio::time::sleep(Duration::from_millis(1500)).await;
            if app_handle
                .state::<AppState>()
                .wsl_files_generation
                .load(Ordering::SeqCst)
                != generation
            {
                break;
            }

            let files = collect_window_files(&app_handle, true);
            let current: HashMap<String, FileStamp> = files
                .iter()
                .map(|path| (path.clone(), file_stamp(Path::new(path))))
                .collect();

            for (path, stamp) in &current {
                if previous.get(path) != Some(stamp) {
                    broadcast_editor_args(&app_handle, "file:changed", vec![json!(path)]);
                }
            }

            {
                let state = app_handle.state::<AppState>();
                *state.wsl_file_snapshot.lock().unwrap() = current.clone();
            }
            previous = current;
        }
    });
}

pub fn check_window_wsl_files<R: Runtime>(app: &AppHandle<R>, label: &str) {
    let files: Vec<String> = window::window_open_files(app, label)
        .into_iter()
        .filter(|path| is_wsl_path(path))
        .collect();
    if files.is_empty() {
        return;
    }

    let state = app.state::<AppState>();
    let mut snapshot = state.wsl_file_snapshot.lock().unwrap();
    for path in files {
        let stamp = file_stamp(Path::new(&path));
        let changed = snapshot.get(&path) != Some(&stamp);
        if changed {
            snapshot.insert(path.clone(), stamp);
            drop(snapshot);
            broadcast_editor_args(app, "file:changed", vec![json!(path)]);
            snapshot = state.wsl_file_snapshot.lock().unwrap();
        }
    }
}

pub fn watch_directory<R: Runtime>(app: &AppHandle<R>, dir_path: &str) {
    let generation = {
        let state = app.state::<AppState>();
        state.directory_generation.fetch_add(1, Ordering::SeqCst) + 1
    };

    {
        let state = app.state::<AppState>();
        *state.local_directory_watcher.lock().unwrap() = None;
    }

    let path = PathBuf::from(dir_path);
    if dir_path.is_empty() || !path.exists() {
        return;
    }

    if is_wsl_path(dir_path) {
        start_wsl_directory_poller(app.clone(), path, generation);
        return;
    }

    start_local_directory_watcher(app.clone(), path, generation);
}

pub fn unwatch_directory<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<AppState>();
    state.directory_generation.fetch_add(1, Ordering::SeqCst);
    *state.local_directory_watcher.lock().unwrap() = None;
}

fn start_local_directory_watcher<R: Runtime>(
    app: AppHandle<R>,
    root: PathBuf,
    generation: u64,
) {
    let debounce_token = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let token_for_events = debounce_token.clone();
    let root_for_events = root.clone();
    let app_for_events = app.clone();

    let mut watcher = match notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        let Ok(event) = result else {
            return;
        };
        if !matches!(
            event.kind,
            EventKind::Create(_) | EventKind::Remove(_) | EventKind::Modify(notify::event::ModifyKind::Name(_))
        ) {
            return;
        }
        let relevant = event.paths.iter().any(|event_path| {
            !is_ignored_path(event_path) && relative_depth(&root_for_events, event_path) <= MAX_WATCH_DEPTH
        });
        if !relevant {
            return;
        }

        let token = token_for_events.fetch_add(1, Ordering::SeqCst) + 1;
        let app_handle = app_for_events.clone();
        let debounce = token_for_events.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(300)).await;
            if debounce.load(Ordering::SeqCst) != token {
                return;
            }
            let current_generation = app_handle
                .state::<AppState>()
                .directory_generation
                .load(Ordering::SeqCst);
            if current_generation == generation {
                broadcast_editor_args(&app_handle, "workspace:directory-changed", vec![]);
            }
        });
    }) {
        Ok(watcher) => watcher,
        Err(error) => {
            eprintln!("[watcher] 创建目录监听器失败: {error}");
            return;
        }
    };

    if let Err(error) = watcher.watch(&root, RecursiveMode::Recursive) {
        eprintln!("[watcher] 监听目录失败: {error}");
        return;
    }

    *app.state::<AppState>()
        .local_directory_watcher
        .lock()
        .unwrap() = Some(watcher);
}

fn start_wsl_directory_poller<R: Runtime>(app: AppHandle<R>, root: PathBuf, generation: u64) {
    tauri::async_runtime::spawn(async move {
        let mut previous = snapshot_directory(&root);
        loop {
            tokio::time::sleep(Duration::from_millis(4000)).await;
            if app
                .state::<AppState>()
                .directory_generation
                .load(Ordering::SeqCst)
                != generation
            {
                break;
            }

            let current = snapshot_directory(&root);
            if current != previous {
                previous = current;
                broadcast_editor_args(&app, "workspace:directory-changed", vec![]);
            }
        }
    });
}

fn snapshot_directory(root: &Path) -> HashSet<String> {
    let mut entries = HashSet::new();
    let mut stack = vec![(root.to_path_buf(), 0usize)];

    while let Some((directory, depth)) = stack.pop() {
        if depth > MAX_WATCH_DEPTH || entries.len() >= MAX_WATCH_ENTRIES {
            continue;
        }
        let Ok(read_dir) = std::fs::read_dir(&directory) else {
            continue;
        };
        for entry in read_dir.flatten() {
            if entries.len() >= MAX_WATCH_ENTRIES {
                break;
            }
            let path = entry.path();
            if is_ignored_path(&path) {
                continue;
            }
            entries.insert(path.to_string_lossy().to_string());
            let Ok(metadata) = std::fs::symlink_metadata(&path) else {
                continue;
            };
            if metadata.file_type().is_symlink() {
                continue;
            }
            if metadata.is_dir() {
                stack.push((path, depth + 1));
            }
        }
    }

    entries
}


