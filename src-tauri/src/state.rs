use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::Mutex;

use notify::RecommendedWatcher;
use serde_json::Value;

use crate::models::UpdateInfo;

#[derive(Debug, Default, Clone)]
pub struct WindowMeta {    pub is_main: bool,
    pub saved: bool,
    pub closing: bool,
    pub open_files: HashSet<String>,
    pub last_maximized: bool,
    pub last_fullscreen: bool,
}

#[derive(Debug, Default)]
pub struct UpdateState {
    pub info: Option<UpdateInfo>,
    pub downloading: bool,
    pub downloaded_path: Option<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileStamp {
    pub exists: bool,
    pub modified_ms: u64,
    pub size: u64,
}

#[derive(Debug)]
pub struct DragSession {
    pub generation: u64,
    pub source: Option<String>,
    pub new_window: String,
    pub tab_data: Value,
}

#[derive(Debug)]
pub struct WindowDragSession {
    pub generation: u64,
    pub source: String,
}

#[derive(Default)]
pub struct AppState {
    pub windows: Mutex<HashMap<String, WindowMeta>>,
    pub main_label: Mutex<Option<String>>,
    pub quitting: AtomicBool,
    pub renderer_ready: AtomicBool,
    pub pending_startup: Mutex<Vec<String>>,
    pub pending_tabs: Mutex<HashMap<String, Value>>,
    pub merge_previews: Mutex<HashMap<String, Option<String>>>,
    pub drag_session: Mutex<Option<DragSession>>,
    pub window_drag_session: Mutex<Option<WindowDragSession>>,
    pub drag_generation: AtomicU64,
    pub directory_generation: AtomicU64,
    pub wsl_files_generation: AtomicU64,
    pub local_file_watcher: Mutex<Option<RecommendedWatcher>>,
    pub local_directory_watcher: Mutex<Option<RecommendedWatcher>>,
    pub wsl_file_snapshot: Mutex<HashMap<String, FileStamp>>,
    pub update: Mutex<UpdateState>,
    pub update_cancel: AtomicBool,
    pub next_window_id: AtomicU64,
}
