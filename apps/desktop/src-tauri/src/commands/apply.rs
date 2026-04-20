// Stages all new bytes in memory before any disk write. Backups precede source
// writes so the backup dir is always complete when a source write starts. On IO
// failure after one or more sources have been promoted, the function restores
// from backup in-order before returning the error.

use crate::commands::fs_scoped::{atomic_write, resolve_for_write};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HunkInput {
    pub file: String,
    pub patch: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ApplyReport {
    pub files_written: usize,
    pub hunks_applied: usize,
}

struct StagedFile {
    rel_path: String,
    abs_path: PathBuf,
    orig_bytes: Vec<u8>,
    new_bytes: Vec<u8>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ManifestFile {
    rel: String,
    sha256_before: String,
    sha256_after: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    session_id: String,
    applied_at: String,
    files: Vec<ManifestFile>,
}

#[tauri::command]
pub async fn apply_hunks(
    root_id: String,
    session_id: String,
    hunks: Vec<HunkInput>,
    state: State<'_, AppState>,
) -> AppResult<ApplyReport> {
    let mut grouped: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for h in hunks {
        grouped.entry(h.file).or_default().push(h.patch);
    }

    let mut staged: Vec<StagedFile> = Vec::with_capacity(grouped.len());
    let mut total_hunks: usize = 0;

    for (rel_path, patches) in grouped {
        let abs_path = resolve_for_write(&root_id, &rel_path, &state).await?;
        let current = tokio::fs::read(&abs_path).await.map_err(AppError::from)?;

        let mut working = current.clone();
        for patch_text in &patches {
            let patch = diffy::Patch::from_bytes(patch_text.as_bytes())
                .map_err(|e| AppError::Apply(format!("parse {rel_path}: {e}")))?;
            working = diffy::apply_bytes(&working, &patch)
                .map_err(|e| AppError::Apply(format!("apply {rel_path}: {e}")))?;
        }

        total_hunks += patches.len();
        staged.push(StagedFile {
            rel_path,
            abs_path,
            orig_bytes: current,
            new_bytes: working,
        });
    }

    let mut written: Vec<(PathBuf, Vec<u8>)> = Vec::with_capacity(staged.len());
    let mut manifest_files: Vec<ManifestFile> = Vec::with_capacity(staged.len());

    for sf in &staged {
        let backup_rel = format!(".obelus/backup/{}/{}", session_id, sf.rel_path);
        let backup_abs = match resolve_for_write(&root_id, &backup_rel, &state).await {
            Ok(p) => p,
            Err(e) => {
                rollback(&written).await;
                return Err(e);
            }
        };
        if let Err(e) = atomic_write(&backup_abs, &sf.orig_bytes).await {
            rollback(&written).await;
            return Err(e);
        }

        if let Err(e) = atomic_write(&sf.abs_path, &sf.new_bytes).await {
            rollback(&written).await;
            return Err(e);
        }
        written.push((sf.abs_path.clone(), sf.orig_bytes.clone()));

        manifest_files.push(ManifestFile {
            rel: sf.rel_path.clone(),
            sha256_before: sha256_hex(&sf.orig_bytes),
            sha256_after: sha256_hex(&sf.new_bytes),
        });
    }

    let files_written = staged.len();
    let manifest = Manifest {
        session_id: session_id.clone(),
        applied_at: iso8601_utc_now(),
        files: manifest_files,
    };
    let manifest_bytes = serde_json::to_vec_pretty(&manifest)
        .map_err(|e| AppError::Apply(format!("manifest: {e}")))?;
    let manifest_rel = format!(".obelus/backup/{}/.manifest.json", session_id);
    let manifest_abs = match resolve_for_write(&root_id, &manifest_rel, &state).await {
        Ok(p) => p,
        Err(e) => {
            rollback(&written).await;
            return Err(e);
        }
    };
    if let Err(e) = atomic_write(&manifest_abs, &manifest_bytes).await {
        rollback(&written).await;
        return Err(e);
    }

    Ok(ApplyReport {
        files_written,
        hunks_applied: total_hunks,
    })
}

async fn rollback(written: &[(PathBuf, Vec<u8>)]) {
    for (abs, orig) in written {
        let _ = atomic_write(abs, orig).await;
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

// UTC ISO 8601 formatter without pulling in a date dependency.
fn iso8601_utc_now() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let (y, mo, d, h, mi, s) = civil_from_days(secs);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}Z")
}

// Howard Hinnant's civil_from_days, adapted for i64 seconds since 1970-01-01 UTC.
fn civil_from_days(secs: i64) -> (i32, u32, u32, u32, u32, u32) {
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let h = (rem / 3600) as u32;
    let mi = ((rem % 3600) / 60) as u32;
    let s = (rem % 60) as u32;

    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = (y + if mo <= 2 { 1 } else { 0 }) as i32;
    (y, mo, d, h, mi, s)
}
