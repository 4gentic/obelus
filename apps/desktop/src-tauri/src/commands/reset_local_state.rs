use std::fs;
use std::io;

use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

// Recovery hatch for the boot-failure screen: deletes the SQLite database and
// the persisted UI store, then expects the caller to `relaunch` so the Rust
// side reopens from a clean slate. Pre-release only — aligned with CLAUDE.md's
// "Pre-release resets" track. If the desktop app ever ships publicly, this
// command should grow a confirmation token and per-file backup instead.
#[tauri::command]
pub fn reset_local_state(app: AppHandle) -> AppResult<()> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Other(format!("app_data_dir: {e}")))?;

    let targets = [
        "obelus.db",
        "obelus.db-journal",
        "obelus.db-shm",
        "obelus.db-wal",
        "app-state.json",
    ];

    let mut failures: Vec<String> = Vec::new();
    for name in targets {
        let path = dir.join(name);
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(err) if err.kind() == io::ErrorKind::NotFound => {}
            Err(err) => failures.push(format!("{}: {err}", path.display())),
        }
    }

    let projects = dir.join("projects");
    match fs::remove_dir_all(&projects) {
        Ok(()) => {}
        Err(err) if err.kind() == io::ErrorKind::NotFound => {}
        Err(err) => failures.push(format!("{}: {err}", projects.display())),
    }

    if failures.is_empty() {
        Ok(())
    } else {
        Err(AppError::Other(failures.join("; ")))
    }
}
