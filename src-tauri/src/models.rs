use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileTraits {
    pub has_bom: bool,
    pub line_ending: String,
    pub has_trailing_newline: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LoadedFile {
    pub file_path: String,
    pub content: String,
    pub file_traits: FileTraits,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub file_path: String,
    pub content: String,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SavePayload {
    pub file_path: Option<String>,
    pub content: String,
    pub file_traits: Option<FileTraits>,
    pub image_local_path: Option<String>,
    pub image_use_file_name_folder: Option<bool>,
    /// 图片语法偏好：优先相对路径 / 相对路径加 ./ 前缀
    pub image_prefer_relative: Option<bool>,
    pub image_add_dot_slash: Option<bool>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SaveAsPayload {
    pub content: String,
    pub file_traits: Option<FileTraits>,
    pub image_local_path: Option<String>,
    pub image_use_file_name_folder: Option<bool>,
    /// 图片语法偏好：优先相对路径 / 相对路径加 ./ 前缀
    pub image_prefer_relative: Option<bool>,
    pub image_add_dot_slash: Option<bool>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OpenDialogResult {
    pub canceled: bool,
    pub file_paths: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub mtime: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<WorkspaceEntry>>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WindowBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImagePreviewItem {
    pub src: String,
    #[serde(default)]
    pub alt: Option<String>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImagePreviewPayload {
    pub src: String,
    #[serde(default)]
    pub alt: Option<String>,
    #[serde(default)]
    pub items: Option<Vec<ImagePreviewItem>>,
    #[serde(default)]
    pub index: Option<usize>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub notes: Option<String>,
    pub date: Option<String>,
    pub url: String,
    pub filename: String,
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub release_page_url: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MergeResult {
    pub action: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FocusResult {
    pub found: bool,
}
