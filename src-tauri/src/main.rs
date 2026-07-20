// Prevents an extra console window from popping up on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::{Path, PathBuf};

use base64::Engine;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

/// Seed content embedded into the exe at compile time, used only the first
/// time the app runs (when data/ doesn't exist yet beside the exe).
const SEED_DATABASE_JSON: &str = include_str!("../../seed/database.json");
const SEED_SOFTWARE_README: &str = include_str!("../../seed/software-README.md");
const SEED_IMAGES_README: &str = include_str!("../../seed/images-README.md");

const DATA_DIR_NAME: &str = "data";
const DATABASE_FILE_NAME: &str = "database.json";

/// The single folder that sits beside the .exe and holds everything mutable:
/// database.json, software/ (the actual installers) and images/ (uploaded
/// icons). Created automatically on first run — see `ensure_data_root`.
fn data_root() -> PathBuf {
    let exe_dir = std::env::current_exe()
        .expect("cannot resolve the running executable's path")
        .parent()
        .expect("executable has no parent directory")
        .to_path_buf();
    exe_dir.join(DATA_DIR_NAME)
}

/// Creates data/, data/software/, data/images/ and seeds database.json plus
/// the two README files the very first time the app runs. Safe to call on
/// every launch — it never overwrites anything that already exists.
fn ensure_data_root() -> std::io::Result<PathBuf> {
    let root = data_root();
    let software_dir = root.join("software");
    let images_dir = root.join("images");
    let db_path = root.join(DATABASE_FILE_NAME);

    fs::create_dir_all(&software_dir)?;
    fs::create_dir_all(&images_dir)?;

    if !db_path.exists() {
        fs::write(&db_path, SEED_DATABASE_JSON)?;
    }

    let software_readme = software_dir.join("README.md");
    if !software_readme.exists() {
        fs::write(&software_readme, SEED_SOFTWARE_README)?;
    }

    let images_readme = images_dir.join("README.md");
    if !images_readme.exists() {
        fs::write(&images_readme, SEED_IMAGES_README)?;
    }

    Ok(root)
}

/// Resolves a relative path (as stored in the database, e.g. "software/x.exe")
/// against the data root, rejecting anything that tries to escape it.
fn resolve_in_data_root(rel_path: &str) -> Result<PathBuf, String> {
    let clean = rel_path.replace('\\', "/");
    if clean.contains("..") || clean.starts_with('/') || clean.contains(':') {
        return Err("נתיב לא תקין.".into());
    }
    Ok(data_root().join(clean))
}

// --- Commands invoked from the web page (js/admin/persist.js, js/app/download.js) ---

#[tauri::command]
fn read_database() -> Result<String, String> {
    let root = ensure_data_root().map_err(|e| e.to_string())?;
    fs::read_to_string(root.join(DATABASE_FILE_NAME)).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_database(json: String) -> Result<(), String> {
    let root = ensure_data_root().map_err(|e| e.to_string())?;
    fs::write(root.join(DATABASE_FILE_NAME), json).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_image(rel_path: String, base64_data: String) -> Result<String, String> {
    let dest = resolve_in_data_root(&rel_path)?;
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_data)
        .map_err(|e| e.to_string())?;
    fs::write(&dest, bytes).map_err(|e| e.to_string())?;
    Ok(rel_path)
}

#[tauri::command]
async fn download_item(app: AppHandle, rel_path: String, suggested_name: String) -> Result<bool, String> {
    let source = resolve_in_data_root(&rel_path)?;
    if !source.exists() {
        return Err("הקובץ אינו קיים.".into());
    }

    let (tx, rx) = std::sync::mpsc::channel::<Option<PathBuf>>();
    app.dialog()
        .file()
        .set_file_name(&suggested_name)
        .save_file(move |path| {
            let _ = tx.send(path.and_then(|p| p.into_path().ok()));
        });

    let chosen: Option<PathBuf> = rx.recv().map_err(|e| e.to_string())?;
    match chosen {
        Some(dest) => {
            fs::copy(&source, &dest).map_err(|e| e.to_string())?;
            Ok(true)
        }
        None => Ok(false), // user cancelled the dialog
    }
}

#[tauri::command]
async fn download_package(
    app: AppHandle,
    rel_paths: Vec<String>,
    suggested_names: Vec<String>,
) -> Result<usize, String> {
    let (tx, rx) = std::sync::mpsc::channel::<Option<PathBuf>>();
    app.dialog().file().pick_folder(move |folder| {
        let _ = tx.send(folder.and_then(|p| p.into_path().ok()));
    });

    let chosen_folder: Option<PathBuf> = rx.recv().map_err(|e| e.to_string())?;
    let Some(folder) = chosen_folder else {
        return Ok(0); // user cancelled
    };

    let mut copied = 0usize;
    for (rel_path, name) in rel_paths.iter().zip(suggested_names.iter()) {
        let source = match resolve_in_data_root(rel_path) {
            Ok(p) => p,
            Err(_) => continue,
        };
        if !source.exists() {
            continue;
        }
        if fs::copy(&source, folder.join(name)).is_ok() {
            copied += 1;
        }
    }

    Ok(copied)
}

/// Builds a `file://`-style JS string assignment injected before any page
/// script runs, so window.USBLibDatabase is ready synchronously exactly like
/// the old `<script src="data/database.js">` used to guarantee.
fn boot_script(database_json: &str, data_root_path: &Path) -> String {
    // serde_json::to_string on a &str produces a properly escaped JS/JSON
    // string literal — safe to splice into a JS assignment either way.
    let root_literal = serde_json::to_string(&data_root_path.to_string_lossy()).unwrap();
    format!(
        "window.USBLibDatabase = {database_json};\nwindow.__DATA_ROOT__ = {root_literal};"
    )
}

fn open_admin_window(app: &AppHandle, database_json: &str, root: &Path) {
    if let Some(existing) = app.get_webview_window("admin") {
        let _ = existing.set_focus();
        return;
    }

    let _ = WebviewWindowBuilder::new(app, "admin", WebviewUrl::App("admin.html".into()))
        .title("ניהול ספריית התוכנה")
        .inner_size(1100.0, 780.0)
        .min_inner_size(760.0, 560.0)
        .initialization_script(&boot_script(database_json, root))
        .build();
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_database,
            write_database,
            write_image,
            download_item,
            download_package
        ])
        .setup(|app| {
            let root = ensure_data_root()?;
            let database_json = fs::read_to_string(root.join(DATABASE_FILE_NAME))?;

            // Let convertFileSrc() (used by js/core/db.js's imageSrc) read
            // uploaded icons/thumbnails from outside the bundle.
            app.asset_protocol_scope().allow_directory(&root, true)?;

            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("גמ\"ח תוכנה")
                .inner_size(1200.0, 820.0)
                .min_inner_size(820.0, 600.0)
                .initialization_script(&boot_script(&database_json, &root))
                .build()?;

            // Native menu: the app's one entrance into the admin console.
            // Deliberately not a link inside index.html — admin.html stays
            // un-linked from the public page, same as the original design.
            let open_admin_item =
                MenuItem::with_id(app, "open-admin", "מסך ניהול", true, None::<&str>)?;
            let quit_item = PredefinedMenuItem::quit(app, Some("יציאה"))?;
            let app_submenu =
                Submenu::with_items(app, "אפליקציה", true, &[&open_admin_item, &quit_item])?;
            let menu = Menu::with_items(app.handle(), &[&app_submenu])?;
            app.set_menu(menu)?;

            let handle = app.handle().clone();
            let root_for_menu = root.clone();
            app.on_menu_event(move |app_handle, event| {
                if event.id().as_ref() == "open-admin" {
                    // Re-read the database so the admin window opens against
                    // whatever was most recently saved, not a stale copy.
                    let json = fs::read_to_string(root_for_menu.join(DATABASE_FILE_NAME))
                        .unwrap_or_else(|_| SEED_DATABASE_JSON.to_string());
                    open_admin_window(app_handle, &json, &root_for_menu);
                }
                let _ = &handle;
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the gmach application");
}
