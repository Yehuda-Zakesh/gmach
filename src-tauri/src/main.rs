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

/// Folders that are never part of the software library — kept in sync with
/// the IGNORED_DIRS list in app/js/core/fs.js.
const IGNORED_DIR_NAMES: &[&str] = &[
    "system volume information",
    "$recycle.bin",
    ".git",
    ".svn",
    "node_modules",
    "__macosx",
];

/// Files that are noise rather than library content — kept in sync with the
/// IGNORED_FILES list in app/js/core/fs.js. Anything starting with "." is
/// also skipped (checked separately, see `is_ignored_file`).
const IGNORED_FILE_NAMES: &[&str] = &[
    "thumbs.db",
    "desktop.ini",
    ".ds_store",
    "autorun.inf",
    "readme.md",
];

fn is_ignored_dir(name: &str) -> bool {
    IGNORED_DIR_NAMES.contains(&name.to_lowercase().as_str())
}

fn is_ignored_file(name: &str) -> bool {
    let lower = name.to_lowercase();
    IGNORED_FILE_NAMES.contains(&lower.as_str()) || lower.starts_with('.')
}

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

/// Picks a name that doesn't collide with anything already in `dir`,
/// appending " (1)", " (2)", … before the extension — the same convention
/// browsers use for repeat downloads.
fn unique_destination(dir: &Path, file_name: &str) -> PathBuf {
    let candidate = dir.join(file_name);
    if !candidate.exists() {
        return candidate;
    }

    let path = Path::new(file_name);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or(file_name);
    let ext = path.extension().and_then(|s| s.to_str());

    for n in 1..1000 {
        let name = match ext {
            Some(e) => format!("{stem} ({n}).{e}"),
            None => format!("{stem} ({n})"),
        };
        let candidate = dir.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }

    dir.join(file_name) // give up after 999 collisions; overwrite
}

/// Resolves the current user's Downloads folder, creating it if it somehow
/// doesn't exist yet.
fn downloads_dir() -> Result<PathBuf, String> {
    let dir = dirs::download_dir().ok_or_else(|| "לא נמצאה תיקיית ההורדות של המשתמש.".to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Copies the file straight into the user's Downloads folder — no dialog,
/// no destination choice. The whole point is that someone with zero
/// computer background always finds it in the same predictable place.
#[tauri::command]
fn download_item(rel_path: String, suggested_name: String) -> Result<String, String> {
    let source = resolve_in_data_root(&rel_path)?;
    if !source.exists() {
        return Err("הקובץ אינו קיים.".into());
    }

    let dir = downloads_dir()?;
    let dest = unique_destination(&dir, &suggested_name);
    fs::copy(&source, &dest).map_err(|e| e.to_string())?;

    Ok(dest
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&suggested_name)
        .to_string())
}

/// Copies every file of the package straight into the user's Downloads
/// folder — no dialog, same reasoning as download_item above.
#[tauri::command]
fn download_package(rel_paths: Vec<String>, suggested_names: Vec<String>) -> Result<usize, String> {
    let dir = downloads_dir()?;

    let mut copied = 0usize;
    for (rel_path, name) in rel_paths.iter().zip(suggested_names.iter()) {
        let source = match resolve_in_data_root(rel_path) {
            Ok(p) => p,
            Err(_) => continue,
        };
        if !source.exists() {
            continue;
        }
        let dest = unique_destination(&dir, name);
        if fs::copy(&source, dest).is_ok() {
            copied += 1;
        }
    }

    Ok(copied)
}

/// Launches a file already inside data/ with its default OS application —
/// the "run this program, it's already on this computer" action.
#[tauri::command]
fn open_item(rel_path: String) -> Result<(), String> {
    let path = resolve_in_data_root(&rel_path)?;
    if !path.exists() {
        return Err("הקובץ אינו קיים.".into());
    }

    let path_str = path.to_str().ok_or("נתיב לא תקין.")?;

    // `cmd /C start "" <path>` hands off to whatever the OS associates with
    // this file type (runs an .exe directly, opens a .pdf in its viewer,
    // etc.) — the empty "" is the window-title placeholder `start` requires
    // once a quoted path is involved.
    std::process::Command::new("cmd")
        .args(["/C", "start", "", path_str])
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Recursively walks `dir` (folders before their contents) and appends every
/// non-ignored entry to `out`, using slash-separated paths relative to
/// `root` — the exact shape reconcile() expects from a browser-side scan.
fn walk_software_dir(
    root: &Path,
    dir: &Path,
    out: &mut Vec<serde_json::Value>,
) -> std::io::Result<()> {
    let mut entries: Vec<_> = fs::read_dir(dir)?.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.file_name());

    for entry in entries {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let rel = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        let file_type = entry.file_type()?;

        if file_type.is_dir() {
            if is_ignored_dir(&name) {
                continue;
            }
            out.push(serde_json::json!({
                "path": rel,
                "name": name,
                "kind": "folder",
                "size": 0,
                "lastModified": 0,
            }));
            walk_software_dir(root, &path, out)?;
            continue;
        }

        if is_ignored_file(&name) {
            continue;
        }

        let metadata = entry.metadata()?;
        let last_modified = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        out.push(serde_json::json!({
            "path": rel,
            "name": name,
            "kind": "file",
            "size": metadata.len(),
            "lastModified": last_modified,
        }));
    }

    Ok(())
}

/// Lists everything under data/software — the desktop-app replacement for
/// the browser's manual folder-picker scan. The location is already known
/// (it's the one folder this app itself manages), so this needs no dialog
/// at all and is safe to run automatically every time the admin console
/// opens.
#[tauri::command]
fn list_software_directory() -> Result<Vec<serde_json::Value>, String> {
    let root = ensure_data_root().map_err(|e| e.to_string())?;
    let software_dir = root.join("software");
    fs::create_dir_all(&software_dir).map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    walk_software_dir(&root, &software_dir, &mut out).map_err(|e| e.to_string())?;
    Ok(out)
}

/// Opens a native "choose files" dialog and copies whatever is picked
/// straight into data/software/ — this replaces manually dragging files
/// into the folder before scanning. Returns enough metadata about each
/// copied file for the JS side to reconcile it into the catalog exactly
/// like a folder scan would.
#[tauri::command]
async fn import_software_files(app: AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let (tx, rx) = std::sync::mpsc::channel::<Option<Vec<PathBuf>>>();
    app.dialog().file().pick_files(move |paths| {
        let converted = paths.map(|list| {
            list.into_iter()
                .filter_map(|p| p.into_path().ok())
                .collect()
        });
        let _ = tx.send(converted);
    });

    let chosen: Option<Vec<PathBuf>> = rx.recv().map_err(|e| e.to_string())?;
    let Some(files) = chosen else {
        return Ok(vec![]); // dialog cancelled
    };

    let dest_dir = data_root().join("software");
    fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;

    let mut added = Vec::new();
    for src in files {
        let Some(os_name) = src.file_name() else { continue };
        let name = os_name.to_string_lossy().to_string();
        let dest = unique_destination(&dest_dir, &name);

        if fs::copy(&src, &dest).is_err() {
            continue;
        }

        let size = fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
        let last_modified = fs::metadata(&dest)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let rel_path = format!(
            "software/{}",
            dest.file_name().and_then(|n| n.to_str()).unwrap_or(&name)
        );

        added.push(serde_json::json!({
            "path": rel_path,
            "name": dest.file_name().and_then(|n| n.to_str()).unwrap_or(&name),
            "size": size,
            "lastModified": last_modified,
        }));
    }

    Ok(added)
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
            download_package,
            open_item,
            import_software_files,
            list_software_directory
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
                .maximized(true)
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
