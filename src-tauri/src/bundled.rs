//! bundled.rs — Syncing the online "bundled software" catalog.
//!
//! Distinct from everything else in this app: every other write to
//! database.json is triggered by the administrator (write_database,
//! import_software_files, list_software_directory). This is the one thing
//! that touches the catalog on its own, on a timer the app controls, not the
//! user — so the rule here is stricter than anywhere else in the codebase:
//! never block startup, never surface an error to the user, and never touch
//! an item the admin didn't ask this module to manage (matched strictly by
//! extra.bundledId, never by name or path).
//!
//! See /bundled/README.md at the repo root for how the manifest is
//! maintained and what each field means.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

const MANIFEST_URL: &str =
    "https://raw.githubusercontent.com/Yehuda-Zakesh/gmach/main/bundled/manifest.json";
const REQUEST_TIMEOUT_SECS: u64 = 15;

/// How often to re-check for updates while the app stays open. A launch
/// with no connection yet, or a connection that only appears later in a
/// long-running session, still gets picked up without needing a restart —
/// there's no reliable cross-platform "network just came back" OS event
/// worth wiring up here, so a modest poll interval does the same job with
/// far less complexity.
const RECHECK_INTERVAL_SECS: u64 = 60 * 60; // 1 hour

#[derive(Debug, Deserialize)]
struct ManifestItem {
    id: String,
    name: String,
    version: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    category: String,
    #[serde(default)]
    instructions: String,
    #[serde(rename = "fileName")]
    file_name: String,
    #[serde(rename = "downloadUrl")]
    download_url: String,
    /// Multi-gigabyte items are opt-in only — see admin.html's "תוכנות
    /// מובנות גדולות" panel and db.settings.bundledOptIn. Absent/false
    /// means "download for everyone automatically", same as before this
    /// field existed.
    #[serde(default)]
    large: bool,
    /// Groups items that must be turned on/off together (e.g. the two
    /// halves of one database). Falls back to `id` when absent, so a
    /// large item without an explicit group is just its own group of one.
    #[serde(default)]
    group: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct Manifest {
    #[serde(default)]
    items: Vec<ManifestItem>,
}

#[derive(Clone, serde::Serialize)]
struct BundledUpdateEvent {
    added: usize,
    updated: usize,
}

/// Fire-and-forget: spawned once from main.rs's `setup()`, after the main
/// window is already built and visible, so a slow or absent connection never
/// delays the app opening. Checks immediately, then keeps checking every
/// `RECHECK_INTERVAL_SECS` for as long as the app stays open.
pub fn spawn_sync(app: AppHandle, data_root: PathBuf) {
    tauri::async_runtime::spawn(async move {
        loop {
            if let Err(e) = sync(&app, &data_root).await {
                // Deliberately quiet: no network, a GitHub hiccup, or a
                // malformed manifest are all routine and must never interrupt
                // an otherwise-offline app. Visible only in a dev console.
                #[cfg(debug_assertions)]
                eprintln!("bundled sync skipped: {e}");
                #[cfg(not(debug_assertions))]
                let _ = e;
            }

            tokio::time::sleep(Duration::from_secs(RECHECK_INTERVAL_SECS)).await;
        }
    });
}

async fn sync(app: &AppHandle, data_root: &Path) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|e| e.to_string())?;

    let manifest: Manifest = client
        .get(MANIFEST_URL)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    if manifest.items.is_empty() {
        return Ok(());
    }

    let bundled_dir = data_root.join("software").join("bundled");
    fs::create_dir_all(&bundled_dir).map_err(|e| e.to_string())?;

    let db_path = data_root.join("database.json");

    for mi in &manifest.items {
        // Re-read the database fresh for every item (not once up front) so a
        // multi-gigabyte download earlier in this same pass can't hold a
        // stale in-memory copy while the admin edits something else via the
        // admin console in parallel.
        let db_text = fs::read_to_string(&db_path).map_err(|e| e.to_string())?;
        let mut db: Value = serde_json::from_str(&db_text).map_err(|e| e.to_string())?;

        if mi.large {
            let group = mi.group.as_deref().unwrap_or(mi.id.as_str());
            let opted_in = db
                .pointer(&format!("/settings/bundledOptIn/{group}"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if !opted_in {
                continue;
            }
        }

        let items = match db.get_mut("items").and_then(|v| v.as_array_mut()) {
            Some(items) => items,
            None => continue,
        };

        let existing_idx = items.iter().position(|it| {
            it.pointer("/extra/bundledId").and_then(|v| v.as_str()) == Some(mi.id.as_str())
        });

        let current_version = existing_idx
            .and_then(|i| items[i].pointer("/extra/bundledVersion"))
            .and_then(|v| v.as_str())
            .unwrap_or("");

        // Already at the published version — nothing to download or write.
        if existing_idx.is_some() && current_version == mi.version {
            continue;
        }

        // A failed download for one item must never abort the rest of the
        // catalog sync — skip it and try again on the next launch.
        let bytes = match fetch_bytes(&client, &mi.download_url).await {
            Some(b) => b,
            None => continue,
        };

        let dest = bundled_dir.join(sanitize_file_name(&mi.file_name));
        if fs::write(&dest, &bytes).is_err() {
            continue;
        }

        let file_name = dest
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(&mi.file_name)
            .to_string();
        let rel_path = format!("software/bundled/{file_name}");
        let now = now_iso();
        let size = bytes.len() as u64;
        drop(bytes); // large buffer no longer needed once written to disk

        let mut event = BundledUpdateEvent { added: 0, updated: 0 };

        if let Some(i) = existing_idx {
            let item = &mut items[i];
            item["name"] = json!(mi.name);
            item["version"] = json!(mi.version);
            item["description"] = json!(mi.description);
            item["category"] = json!(mi.category);
            item["instructions"] = json!(mi.instructions);
            item["fileName"] = json!(file_name);
            item["path"] = json!(rel_path);
            item["size"] = json!(size);
            item["updatedAt"] = json!(now);
            item["missing"] = json!(false);
            item["isNew"] = json!(true);
            if !item["extra"].is_object() {
                item["extra"] = json!({});
            }
            item["extra"]["bundledId"] = json!(mi.id);
            item["extra"]["bundledVersion"] = json!(mi.version);
            item["source"] = json!("bundled");
            event.updated = 1;
        } else {
            items.push(json!({
                "id": format!("bundled-{}", mi.id),
                "name": mi.name,
                "fileName": file_name,
                "path": rel_path,
                "kind": "file",
                "type": "",
                "description": mi.description,
                "version": mi.version,
                "instructions": mi.instructions,
                "category": mi.category,
                "updatedAt": now,
                "addedAt": now,
                "isNew": true,
                "hidden": false,
                "thumbnail": "",
                "icon": "",
                "parentId": null,
                "folderMode": "category",
                "packagePath": "",
                "order": 0,
                "size": size,
                "missing": false,
                "tags": [],
                "source": "bundled",
                "extra": { "bundledId": mi.id, "bundledVersion": mi.version }
            }));
            event.added = 1;
        }

        // Persisted and announced the moment THIS item is ready — a 30MB
        // installer must not sit waiting behind gigabytes of other
        // downloads still in flight.
        let text = serde_json::to_string_pretty(&db).map_err(|e| e.to_string())?;
        fs::write(&db_path, text).map_err(|e| e.to_string())?;
        let _ = app.emit("bundled-updates-applied", event);
    }

    Ok(())
}

async fn fetch_bytes(client: &reqwest::Client, url: &str) -> Option<bytes::Bytes> {
    let resp = client.get(url).send().await.ok()?;
    let resp = resp.error_for_status().ok()?;
    resp.bytes().await.ok()
}

/// Strips path separators out of a manifest-supplied file name so a
/// malicious or malformed manifest entry can never write outside
/// data/software/bundled/.
fn sanitize_file_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    if base.trim().is_empty() {
        "download".to_string()
    } else {
        base.to_string()
    }
}

/// UTC RFC3339 timestamp, no external date/time dependency — this only ever
/// feeds display fields (updatedAt/addedAt), so second precision is enough.
/// Uses Howard Hinnant's civil_from_days algorithm to turn days-since-epoch
/// into a calendar date.
fn now_iso() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let days = secs.div_euclid(86400);
    let rem = secs.rem_euclid(86400);
    let (hour, minute, second) = (rem / 3600, (rem % 3600) / 60, rem % 60);

    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let day = doy - (153 * mp + 2) / 5 + 1; // [1, 31]
    let month = if mp < 10 { mp + 3 } else { mp - 9 }; // [1, 12]
    let year = if month <= 2 { y + 1 } else { y };

    format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.000Z"
    )
}
