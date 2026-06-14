// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    Emitter, Manager, State,
};

const LIBRARY_EXTENSION: &str = "notch";
const LIBRARY_MANIFEST: &str = "manifest.json";
const LIBRARY_DATABASE: &str = "notch.db";

#[derive(Default)]
struct PendingLibraryPath(Mutex<Option<String>>);

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LibraryManifest {
    id: String,
    name: String,
    created_at: i64,
    version: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LibraryInfo {
    id: String,
    name: String,
    path: String,
    db_path: String,
    created_at: i64,
}

fn main() {
    let mut builder = tauri::Builder::default();

    // The updater + process plugins are desktop-only.
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }

    let app = builder
        .manage(PendingLibraryPath::default())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            create_library_package,
            open_library_package,
            take_pending_library_path
        ])
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
                "new_library" => {
                    let _ = window.eval("window.__NOTCH__.newLibrary()");
                }
                "open_library" => {
                    let _ = window.eval("window.__NOTCH__.openLibrary()");
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
                "search_all_notes" => {
                    let _ = window.eval("window.__NOTCH__.searchAllNotes()");
                }
                "find_in_note" => {
                    let _ = window.eval("window.__NOTCH__.findInNote()");
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
                "check_for_updates" => {
                    let _ = window.eval("window.__NOTCH__.checkForUpdates()");
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = event {
            handle_opened_urls(app_handle, urls);
        }
    });
}

#[tauri::command]
fn create_library_package(path: String, name: String) -> Result<LibraryInfo, String> {
    let name = normalize_library_name(&name);
    let dir = ensure_library_extension(PathBuf::from(path));

    if dir.exists() {
        if !dir.is_dir() {
            return Err("A file already exists at that location.".to_string());
        }

        if dir.join(LIBRARY_MANIFEST).exists() || dir.join(LIBRARY_DATABASE).exists() {
            return Err("A Notch library already exists at that location.".to_string());
        }

        let mut entries = fs::read_dir(&dir)
            .map_err(|err| format!("Could not inspect library directory: {err}"))?;
        if entries.next().is_some() {
            return Err("Choose an empty location for the new library.".to_string());
        }
    }

    fs::create_dir_all(&dir).map_err(|err| format!("Could not create library: {err}"))?;

    let created_at = current_timestamp_ms();
    let manifest = LibraryManifest {
        id: generate_library_id(created_at),
        name,
        created_at,
        version: 1,
    };

    write_manifest(&dir, &manifest)?;

    let db_path = dir.join(LIBRARY_DATABASE);
    if !db_path.exists() {
        fs::File::create(&db_path)
            .map_err(|err| format!("Could not create library database: {err}"))?;
    }

    library_info(dir, manifest)
}

#[tauri::command]
fn open_library_package(path: String) -> Result<LibraryInfo, String> {
    let dir = library_dir_from_path(Path::new(&path))?;
    let manifest_path = dir.join(LIBRARY_MANIFEST);
    let db_path = dir.join(LIBRARY_DATABASE);

    let manifest = if manifest_path.exists() {
        read_manifest(&dir)?
    } else if db_path.exists() {
        let created_at = fs::metadata(&db_path)
            .ok()
            .and_then(|metadata| metadata.created().ok())
            .and_then(system_time_to_ms)
            .unwrap_or_else(current_timestamp_ms);
        let manifest = LibraryManifest {
            id: generate_library_id(created_at),
            name: library_name_from_path(&dir),
            created_at,
            version: 1,
        };
        write_manifest(&dir, &manifest)?;
        manifest
    } else {
        return Err("That folder is not a Notch library.".to_string());
    };

    if !db_path.exists() {
        fs::File::create(&db_path)
            .map_err(|err| format!("Could not create library database: {err}"))?;
    }

    library_info(dir, manifest)
}

#[tauri::command]
fn take_pending_library_path(state: State<'_, PendingLibraryPath>) -> Option<String> {
    state.0.lock().ok().and_then(|mut pending| pending.take())
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn handle_opened_urls(app: &tauri::AppHandle, urls: Vec<tauri::Url>) {
    for url in urls {
        let Ok(path) = url.to_file_path() else {
            continue;
        };
        if !looks_like_library_path(&path) {
            continue;
        }

        let path = library_dir_from_path(&path).unwrap_or(path);
        let path = path_to_string(&path);

        if let Some(state) = app.try_state::<PendingLibraryPath>() {
            if let Ok(mut pending) = state.0.lock() {
                *pending = Some(path.clone());
            }
        }

        if let Some(window) = app.get_webview_window("main") {
            let _ = window.emit("notch-library-opened", path);
            let _ = window.set_focus();
        }
    }
}

fn normalize_library_name(name: &str) -> String {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        "Untitled Library".to_string()
    } else {
        trimmed.to_string()
    }
}

fn ensure_library_extension(mut path: PathBuf) -> PathBuf {
    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case(LIBRARY_EXTENSION))
        .unwrap_or(false)
    {
        path
    } else {
        path.set_extension(LIBRARY_EXTENSION);
        path
    }
}

fn library_dir_from_path(path: &Path) -> Result<PathBuf, String> {
    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case(LIBRARY_EXTENSION))
        .unwrap_or(false)
    {
        return Ok(path.to_path_buf());
    }

    if path
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name == LIBRARY_MANIFEST || name == LIBRARY_DATABASE)
        .unwrap_or(false)
    {
        if let Some(parent) = path.parent() {
            return library_dir_from_path(parent);
        }
    }

    Err("Select a .notch library package.".to_string())
}

fn looks_like_library_path(path: &Path) -> bool {
    library_dir_from_path(path).is_ok()
}

fn read_manifest(dir: &Path) -> Result<LibraryManifest, String> {
    let manifest_path = dir.join(LIBRARY_MANIFEST);
    let manifest = fs::read_to_string(&manifest_path)
        .map_err(|err| format!("Could not read library manifest: {err}"))?;
    serde_json::from_str(&manifest)
        .map_err(|err| format!("Library manifest is not valid JSON: {err}"))
}

fn write_manifest(dir: &Path, manifest: &LibraryManifest) -> Result<(), String> {
    let manifest_path = dir.join(LIBRARY_MANIFEST);
    let json = serde_json::to_string_pretty(manifest)
        .map_err(|err| format!("Could not serialize library manifest: {err}"))?;
    fs::write(manifest_path, json).map_err(|err| format!("Could not write library manifest: {err}"))
}

fn library_info(dir: PathBuf, manifest: LibraryManifest) -> Result<LibraryInfo, String> {
    let dir = fs::canonicalize(&dir).unwrap_or(dir);
    let db_path = dir.join(LIBRARY_DATABASE);
    Ok(LibraryInfo {
        id: manifest.id,
        name: manifest.name,
        path: path_to_string(&dir),
        db_path: format!("sqlite:{}", path_to_string(&db_path)),
        created_at: manifest.created_at,
    })
}

fn library_name_from_path(path: &Path) -> String {
    path.file_stem()
        .and_then(|name| name.to_str())
        .map(normalize_library_name)
        .unwrap_or_else(|| "Untitled Library".to_string())
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn current_timestamp_ms() -> i64 {
    system_time_to_ms(SystemTime::now()).unwrap_or(0)
}

fn system_time_to_ms(time: SystemTime) -> Option<i64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
}

fn generate_library_id(_created_at: i64) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("library-{nanos}-{}", std::process::id())
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
            &MenuItem::with_id(
                handle,
                "new_notebook",
                "New Notebook",
                true,
                Some("CmdOrCtrl+Shift+N"),
            )?,
            &MenuItem::with_id(handle, "new_library", "New Library...", true, None::<&str>)?,
            &MenuItem::with_id(
                handle,
                "open_library",
                "Open Library...",
                true,
                Some("CmdOrCtrl+O"),
            )?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(
                handle,
                "import",
                "Import Quiver Library...",
                true,
                Some("CmdOrCtrl+Shift+I"),
            )?,
            &MenuItem::with_id(
                handle,
                "export",
                "Export Note...",
                true,
                Some("CmdOrCtrl+Shift+E"),
            )?,
            &MenuItem::with_id(
                handle,
                "export_library",
                "Export Library...",
                true,
                None::<&str>,
            )?,
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
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(
                handle,
                "find_in_note",
                "Find in Note...",
                true,
                Some("CmdOrCtrl+F"),
            )?,
            &MenuItem::with_id(
                handle,
                "search_all_notes",
                "Search All Notes...",
                true,
                Some("CmdOrCtrl+Shift+F"),
            )?,
        ],
    )?;

    // View menu
    let view_menu = Submenu::with_items(
        handle,
        "View",
        true,
        &[
            &MenuItem::with_id(
                handle,
                "toggle_sidebar",
                "Toggle Sidebar",
                true,
                Some("CmdOrCtrl+0"),
            )?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(
                handle,
                "single_pane",
                "Single Pane",
                true,
                Some("CmdOrCtrl+1"),
            )?,
            &MenuItem::with_id(
                handle,
                "double_pane",
                "Two Panes",
                true,
                Some("CmdOrCtrl+2"),
            )?,
            &MenuItem::with_id(
                handle,
                "triple_pane",
                "Three Panes",
                true,
                Some("CmdOrCtrl+3"),
            )?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(
                handle,
                "editor_only",
                "Editor Only",
                true,
                Some("CmdOrCtrl+4"),
            )?,
            &MenuItem::with_id(
                handle,
                "preview_only",
                "Preview Only",
                true,
                Some("CmdOrCtrl+5"),
            )?,
            &MenuItem::with_id(
                handle,
                "split_view",
                "Side by Side",
                true,
                Some("CmdOrCtrl+6"),
            )?,
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
            &MenuItem::with_id(
                handle,
                "check_for_updates",
                "Check for Updates...",
                true,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(
                handle,
                "documentation",
                "Documentation",
                true,
                None::<&str>,
            )?,
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
