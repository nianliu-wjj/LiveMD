use tauri::menu::{AboutMetadata, MenuBuilder, MenuItem, SubmenuBuilder};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_opener::OpenerExt;

use crate::events::emit_args_to;

pub const MENU_NEW: &str = "menu-new";
pub const MENU_OPEN: &str = "menu-open";
pub const MENU_SAVE: &str = "menu-save";
pub const MENU_SAVE_AS: &str = "menu-save-as";
pub const MENU_CLOSE_TAB: &str = "menu-close-tab";
pub const MENU_TOGGLE_SOURCE: &str = "menu-toggle-source";
const MENU_GITHUB: &str = "menu-github";

const GITHUB_URL: &str = "https://github.com/nianliu-wjj/LiveMD";

/// Builds the macOS application menu. The menu API is cross-platform so this
/// module is compiled on every platform, but it is only installed on macOS.
pub fn install<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let about = AboutMetadata {
        name: Some("LiveMD".into()),
        version: Some(app.package_info().version.to_string()),
        ..Default::default()
    };

    let app_menu = SubmenuBuilder::with_id(app, "app-menu", "LiveMD")
        .about_with_text("关于 LiveMD", Some(about))
        .separator()
        .services_with_text("服务")
        .separator()
        .hide_with_text("隐藏 LiveMD")
        .hide_others_with_text("隐藏其他")
        .show_all_with_text("全部显示")
        .separator()
        .quit_with_text("退出 LiveMD")
        .build()?;

    let file_menu = SubmenuBuilder::with_id(app, "file-menu", "文件")
        .item(&MenuItem::with_id(
            app,
            MENU_NEW,
            "新建",
            true,
            Some("CmdOrCtrl+N"),
        )?)
        .item(&MenuItem::with_id(
            app,
            MENU_OPEN,
            "打开…",
            true,
            Some("CmdOrCtrl+O"),
        )?)
        .separator()
        .item(&MenuItem::with_id(
            app,
            MENU_SAVE,
            "保存",
            true,
            Some("CmdOrCtrl+S"),
        )?)
        .item(&MenuItem::with_id(
            app,
            MENU_SAVE_AS,
            "另存为…",
            true,
            Some("CmdOrCtrl+Shift+S"),
        )?)
        .separator()
        .item(&MenuItem::with_id(
            app,
            MENU_CLOSE_TAB,
            "关闭标签页",
            true,
            Some("CmdOrCtrl+W"),
        )?)
        .build()?;

    let edit_menu = SubmenuBuilder::with_id(app, "edit-menu", "编辑")
        .undo_with_text("撤销")
        .redo_with_text("重做")
        .separator()
        .cut_with_text("剪切")
        .copy_with_text("复制")
        .paste_with_text("粘贴")
        .select_all_with_text("全选")
        .build()?;

    let view_menu = SubmenuBuilder::with_id(app, "view-menu", "视图")
        .item(&MenuItem::with_id(
            app,
            MENU_TOGGLE_SOURCE,
            "切换源码模式",
            true,
            None::<&str>,
        )?)
        .separator()
        .fullscreen_with_text("进入全屏幕")
        .build()?;

    let window_menu = SubmenuBuilder::with_id(app, "window-menu", "窗口")
        .minimize_with_text("最小化")
        .separator()
        .bring_all_to_front_with_text("前置全部窗口")
        .build()?;

    let help_menu = SubmenuBuilder::with_id(app, "help-menu", "帮助")
        .item(&MenuItem::with_id(
            app,
            MENU_GITHUB,
            "LiveMD GitHub",
            true,
            None::<&str>,
        )?)
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ])
        .build()?;

    app.set_menu(menu)?;
    Ok(())
}

pub fn handle_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    match id {
        MENU_NEW | MENU_OPEN | MENU_SAVE | MENU_SAVE_AS | MENU_CLOSE_TAB | MENU_TOGGLE_SOURCE => {
            emit_to_focused(app, id)
        }
        MENU_GITHUB => {
            let _ = app.opener().open_url(GITHUB_URL, None::<&str>);
        }
        _ => {}
    }
}

/// Native menu actions belong to the currently focused editor window. Falling
/// back to the main window keeps the menu usable while no window has focus.
fn emit_to_focused<R: Runtime>(app: &AppHandle<R>, event: &str) {
    let focused = app
        .webview_windows()
        .into_values()
        .find(|window| window.is_focused().unwrap_or(false));
    if let Some(window) = focused.or_else(|| app.get_webview_window("main")) {
        emit_args_to(&window, event, Vec::new());
    }
}
