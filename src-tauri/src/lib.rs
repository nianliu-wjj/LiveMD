mod commands;
mod events;
mod file_format;
mod menu;
mod models;
mod paths;
mod state;
mod watcher;
mod window;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

use crate::state::AppState;

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if app.try_state::<AppState>().is_none() {
                return;
            }
            window::ensure_main_visible(app);
            commands::app::send_launch_file_if_exists(
                app,
                argv.into_iter().skip(1).collect(),
            );
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .on_menu_event(|app, event| menu::handle_event(app, event.id().as_ref()))
        .setup(|app| {
            app.manage(AppState::default());

            if cfg!(target_os = "macos") {
                menu::install(app.handle())?;
            }

            // 主窗口由代码创建：配置文件无法按平台区分外观（macOS Overlay / 其他平台无边框）
            let (width, height, min_width, min_height) =
                window::adaptive_size(app.handle(), Some(1200.0), Some(800.0));
            let main_window = window::platform_chrome(WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::App("index.html".into()),
            ))
            .title("LiveMD")
            .inner_size(width, height)
            .min_inner_size(min_width, min_height)
            .resizable(true)
            .center()
            .build()?;
            window::attach_window(app.handle(), &main_window, true);
            let _ = main_window.show();
            let _ = main_window.set_focus();

            commands::app::send_launch_file_if_exists(
                app.handle(),
                commands::app::initial_launch_files(),
            );

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::get_platform,
            commands::app::get_app_version,
            commands::app::renderer_ready,
            commands::app::open_external,
            commands::app::open_link,
            commands::app::reveal_file_in_folder,
            commands::app::open_theme_editor,
            commands::app::theme_editor_window_control,
            commands::app::save_custom_theme,
            commands::app::get_system_fonts,
            commands::app::open_image_preview,
            commands::app::focus_file_if_open,
            commands::app::open_path,
            commands::clipboard::write_to_clipboard,
            commands::clipboard::write_text_to_clipboard,
            commands::clipboard::get_file_path_in_clipboard,
            commands::clipboard::write_temp_image,
            commands::dialog::show_open_dialog,
            commands::dialog::show_overwrite_confirm,
            commands::dialog::show_close_confirm,
            commands::dialog::show_image_unsaved_choice,
            commands::dialog::show_message_box,
            commands::drag::tear_off_start,
            commands::drag::tear_off_end,
            commands::drag::tear_off_cancel,
            commands::drag::start_window_drag,
            commands::drag::stop_window_drag,
            commands::drag::drop_merge,
            commands::export::export_pdf,
            commands::export::save_binary_file,
            commands::file::open_file,
            commands::file::save_file,
            commands::file::save_file_as,
            commands::file::read_file_by_path,
            commands::file::is_file_read_only,
            commands::file::cleanup_local_images,
            commands::image::copy_local_image,
            commands::image::download_network_image,
            commands::file::read_file_base64,
            commands::update::check_for_updates,
            commands::update::download_update,
            commands::update::cancel_update,
            commands::update::install_update,
            commands::window::set_title,
            commands::window::watch_files,
            commands::window::change_save_status,
            commands::window::window_control,
            commands::window::close_discard,
            commands::window::get_window_bounds,
            commands::window::toggle_fullscreen,
            commands::window::get_initial_tab_data,
            commands::window::create_blank_window,
            commands::window::create_window_with_tab,
            commands::workspace::workspace_get_directory_files,
            commands::workspace::workspace_exists,
            commands::workspace::create_file,
            commands::workspace::create_folder,
            commands::workspace::delete_file,
            commands::workspace::rename_file,
            commands::workspace::move_file,
            commands::workspace::copy_file,
            commands::workspace::watch_directory,
            commands::workspace::unwatch_directory,
            commands::search::search_workspace,
        ])
        .build(tauri::generate_context!())
        .expect("error while building LiveMD");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::ExitRequested { api, code, .. } = &event {
            if code.is_none() && window::prepare_quit(app_handle) {
                api.prevent_exit();
            }
        }

        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = event {
            let files: Vec<String> = urls
                .into_iter()
                .filter_map(|url| url.to_file_path().ok())
                .map(|path| path.to_string_lossy().to_string())
                .collect();
            commands::app::send_files_to_renderer(app_handle, files);
        }

        #[cfg(not(any(target_os = "macos", target_os = "ios")))]
        let _ = (app_handle, event);
    });
}
