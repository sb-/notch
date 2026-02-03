// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    Manager,
};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            // Create the menu
            let menu = create_menu(app.handle())?;
            app.set_menu(menu)?;

            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            Ok(())
        })
        .on_menu_event(|app, event| {
            let window = app.get_webview_window("main").unwrap();
            match event.id().as_ref() {
                "new_note" => {
                    let _ = window.eval("window.__NOTCH__.newNote()");
                }
                "new_notebook" => {
                    let _ = window.eval("window.__NOTCH__.newNotebook()");
                }
                "import" => {
                    let _ = window.eval("window.__NOTCH__.importLibrary()");
                }
                "export" => {
                    let _ = window.eval("window.__NOTCH__.exportNote()");
                }
                "export_library" => {
                    let _ = window.eval("window.__NOTCH__.exportLibrary()");
                }
                "toggle_sidebar" => {
                    let _ = window.eval("window.__NOTCH__.toggleSidebar()");
                }
                "single_pane" => {
                    let _ = window.eval("window.__NOTCH__.setLayoutMode('single')");
                }
                "double_pane" => {
                    let _ = window.eval("window.__NOTCH__.setLayoutMode('double')");
                }
                "triple_pane" => {
                    let _ = window.eval("window.__NOTCH__.setLayoutMode('triple')");
                }
                "editor_only" => {
                    let _ = window.eval("window.__NOTCH__.setEditorViewMode('editor')");
                }
                "preview_only" => {
                    let _ = window.eval("window.__NOTCH__.setEditorViewMode('preview')");
                }
                "split_view" => {
                    let _ = window.eval("window.__NOTCH__.setEditorViewMode('split')");
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn create_menu(handle: &tauri::AppHandle) -> Result<Menu<tauri::Wry>, tauri::Error> {
    // App menu (macOS)
    let app_menu = Submenu::with_items(
        handle,
        "Notch",
        true,
        &[
            &PredefinedMenuItem::about(handle, Some("About Notch"), None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::services(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::hide(handle, None)?,
            &PredefinedMenuItem::hide_others(handle, None)?,
            &PredefinedMenuItem::show_all(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::quit(handle, None)?,
        ],
    )?;

    // File menu
    let file_menu = Submenu::with_items(
        handle,
        "File",
        true,
        &[
            &MenuItem::with_id(handle, "new_note", "New Note", true, Some("CmdOrCtrl+N"))?,
            &MenuItem::with_id(handle, "new_notebook", "New Notebook", true, Some("CmdOrCtrl+Shift+N"))?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "import", "Import Quiver Library...", true, Some("CmdOrCtrl+Shift+I"))?,
            &MenuItem::with_id(handle, "export", "Export Note...", true, Some("CmdOrCtrl+Shift+E"))?,
            &MenuItem::with_id(handle, "export_library", "Export Library...", true, None::<&str>)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::close_window(handle, None)?,
        ],
    )?;

    // Edit menu
    let edit_menu = Submenu::with_items(
        handle,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(handle, None)?,
            &PredefinedMenuItem::redo(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::cut(handle, None)?,
            &PredefinedMenuItem::copy(handle, None)?,
            &PredefinedMenuItem::paste(handle, None)?,
            &PredefinedMenuItem::select_all(handle, None)?,
        ],
    )?;

    // View menu
    let view_menu = Submenu::with_items(
        handle,
        "View",
        true,
        &[
            &MenuItem::with_id(handle, "toggle_sidebar", "Toggle Sidebar", true, Some("CmdOrCtrl+0"))?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "single_pane", "Single Pane", true, Some("CmdOrCtrl+1"))?,
            &MenuItem::with_id(handle, "double_pane", "Two Panes", true, Some("CmdOrCtrl+2"))?,
            &MenuItem::with_id(handle, "triple_pane", "Three Panes", true, Some("CmdOrCtrl+3"))?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "editor_only", "Editor Only", true, Some("CmdOrCtrl+4"))?,
            &MenuItem::with_id(handle, "preview_only", "Preview Only", true, Some("CmdOrCtrl+5"))?,
            &MenuItem::with_id(handle, "split_view", "Side by Side", true, Some("CmdOrCtrl+6"))?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::fullscreen(handle, None)?,
        ],
    )?;

    // Window menu
    let window_menu = Submenu::with_items(
        handle,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(handle, None)?,
            &PredefinedMenuItem::maximize(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::close_window(handle, None)?,
        ],
    )?;

    // Help menu
    let help_menu = Submenu::with_items(
        handle,
        "Help",
        true,
        &[
            &MenuItem::with_id(handle, "documentation", "Documentation", true, None::<&str>)?,
        ],
    )?;

    Menu::with_items(
        handle,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ],
    )
}
