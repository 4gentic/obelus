// Per-project workspace under the app-data directory. Holds artifacts that the
// app produces about a paper but that are not paper source: review bundles,
// plans, writeups, rubrics, apply backups, project metadata. Keying by
// projectId mirrors how `app-state.json::trustedPapers` is keyed by paperId —
// a stable UUID, not a filesystem path.
//
// This is the second sandbox in the desktop. `fs_scoped` is rooted at the
// user's project folder and writes paper source. `workspace` is rooted at
// `<app_data>/projects/<projectId>/` and writes only Obelus artifacts. Code
// outside this module should never join paths into `<app_data>` directly.
//
// `rel_path` is rejected outright if it contains `..` segments OR is absolute
// (or rooted with a leading `/` / `\`) before any filesystem call. Without the
// absolute check, `Path::join` discards the workspace base when given an
// absolute right-hand side, letting a malformed frontend message read or
// overwrite anything in `<app_data>` (e.g. `obelus.db`) or beyond.

use crate::commands::fs_scoped::atomic_write;
use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::path::PathBuf;
use tauri::ipc::Response;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDirEntryDto {
    pub name: String,
    pub kind: WorkspaceEntryKind,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceEntryKind {
    File,
    Dir,
    Other,
}

fn validate_project_id(project_id: &str) -> AppResult<()> {
    Uuid::parse_str(project_id).map_err(|_| AppError::UnknownRootId)?;
    Ok(())
}

fn reject_traversal(rel: &str) -> AppResult<()> {
    if std::path::Path::new(rel).is_absolute()
        || rel.starts_with('/')
        || rel.starts_with('\\')
    {
        return Err(AppError::OutOfScope);
    }
    for comp in rel.split(|c| c == '/' || c == '\\') {
        if comp == ".." {
            return Err(AppError::OutOfScope);
        }
    }
    Ok(())
}

pub(crate) fn workspace_dir_for(app: &AppHandle, project_id: &str) -> AppResult<PathBuf> {
    validate_project_id(project_id)?;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Other(format!("app_data_dir: {e}")))?;
    Ok(app_data.join("projects").join(project_id))
}

async fn ensure_workspace_dir(app: &AppHandle, project_id: &str) -> AppResult<PathBuf> {
    let dir = workspace_dir_for(app, project_id)?;
    tokio::fs::create_dir_all(&dir).await.map_err(AppError::from)?;
    Ok(dir)
}

async fn resolve_for_workspace_write(
    app: &AppHandle,
    project_id: &str,
    rel: &str,
) -> AppResult<PathBuf> {
    reject_traversal(rel)?;
    let dir = ensure_workspace_dir(app, project_id).await?;
    let joined = dir.join(rel);
    let parent = joined.parent().ok_or(AppError::OutOfScope)?;
    tokio::fs::create_dir_all(parent).await.map_err(AppError::from)?;
    let parent_canon = parent.canonicalize().map_err(AppError::from)?;
    let dir_canon = dir.canonicalize().map_err(AppError::from)?;
    if !parent_canon.starts_with(&dir_canon) {
        return Err(AppError::OutOfScope);
    }
    let name = joined.file_name().ok_or(AppError::OutOfScope)?.to_os_string();
    Ok(parent_canon.join(name))
}

fn resolve_for_workspace_read(
    app: &AppHandle,
    project_id: &str,
    rel: &str,
) -> AppResult<PathBuf> {
    reject_traversal(rel)?;
    let dir = workspace_dir_for(app, project_id)?;
    Ok(dir.join(rel))
}

#[tauri::command]
pub async fn workspace_path(
    app: AppHandle,
    project_id: String,
    rel_path: String,
) -> AppResult<String> {
    reject_traversal(&rel_path)?;
    let dir = ensure_workspace_dir(&app, &project_id).await?;
    let abs = if rel_path.is_empty() {
        dir
    } else {
        dir.join(&rel_path)
    };
    Ok(abs.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn workspace_write_text(
    app: AppHandle,
    project_id: String,
    rel_path: String,
    body: String,
) -> AppResult<()> {
    let abs = resolve_for_workspace_write(&app, &project_id, &rel_path).await?;
    atomic_write(&abs, body.as_bytes()).await
}

#[tauri::command]
pub async fn workspace_write_bytes(
    app: AppHandle,
    project_id: String,
    rel_path: String,
    bytes: Vec<u8>,
) -> AppResult<()> {
    let abs = resolve_for_workspace_write(&app, &project_id, &rel_path).await?;
    atomic_write(&abs, &bytes).await
}

#[tauri::command]
pub async fn workspace_read_file(
    app: AppHandle,
    project_id: String,
    rel_path: String,
) -> AppResult<Response> {
    let abs = resolve_for_workspace_read(&app, &project_id, &rel_path)?;
    let bytes = tokio::fs::read(&abs).await.map_err(AppError::from)?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub async fn workspace_read_dir(
    app: AppHandle,
    project_id: String,
    rel_path: String,
) -> AppResult<Vec<WorkspaceDirEntryDto>> {
    let abs = resolve_for_workspace_read(&app, &project_id, &rel_path)?;
    let mut entries: Vec<WorkspaceDirEntryDto> = Vec::new();
    let mut rd = match tokio::fs::read_dir(&abs).await {
        Ok(rd) => rd,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(entries),
        Err(err) => return Err(AppError::from(err)),
    };
    while let Some(entry) = rd.next_entry().await.map_err(AppError::from)? {
        let name = entry.file_name().to_string_lossy().into_owned();
        let kind = match entry.file_type().await {
            Ok(ft) if ft.is_dir() => WorkspaceEntryKind::Dir,
            Ok(ft) if ft.is_file() => WorkspaceEntryKind::File,
            _ => WorkspaceEntryKind::Other,
        };
        entries.push(WorkspaceDirEntryDto { name, kind });
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

#[tauri::command]
pub async fn workspace_delete(app: AppHandle, project_id: String) -> AppResult<()> {
    let dir = workspace_dir_for(&app, &project_id)?;
    match tokio::fs::remove_dir_all(&dir).await {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(AppError::from(err)),
    }
}

// Removes every top-level file in the project's workspace whose name embeds
// the paper UUID. The plugin writes paper-keyed artifacts as
// `writeup-<paperId>-<iso>.md`; any future paper-keyed artifact must follow
// the same convention. `paper_id` is UUID-validated before use as a
// substring match, otherwise a forged value could match every entry.
// Subdirectories are not recursed (the workspace is flat today).
#[tauri::command]
pub async fn workspace_remove_paper_files(
    app: AppHandle,
    project_id: String,
    paper_id: String,
) -> AppResult<u32> {
    Uuid::parse_str(&paper_id).map_err(|_| AppError::UnknownRootId)?;
    let dir = workspace_dir_for(&app, &project_id)?;
    let mut rd = match tokio::fs::read_dir(&dir).await {
        Ok(rd) => rd,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(err) => return Err(AppError::from(err)),
    };
    let mut removed: u32 = 0;
    while let Some(entry) = rd.next_entry().await.map_err(AppError::from)? {
        let ft = match entry.file_type().await {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if !ft.is_file() {
            continue;
        }
        let name = entry.file_name();
        let Some(name_str) = name.to_str() else {
            continue;
        };
        if !name_str.contains(&paper_id) {
            continue;
        }
        match tokio::fs::remove_file(entry.path()).await {
            Ok(()) => removed += 1,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => return Err(AppError::from(err)),
        }
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reject_traversal_blocks_parent_segments() {
        assert!(matches!(reject_traversal(".."), Err(AppError::OutOfScope)));
        assert!(matches!(
            reject_traversal("foo/../bar"),
            Err(AppError::OutOfScope)
        ));
        assert!(matches!(
            reject_traversal("foo\\..\\bar"),
            Err(AppError::OutOfScope)
        ));
    }

    #[test]
    fn reject_traversal_blocks_absolute_paths() {
        assert!(matches!(
            reject_traversal("/etc/passwd"),
            Err(AppError::OutOfScope)
        ));
        assert!(matches!(reject_traversal("/"), Err(AppError::OutOfScope)));
        assert!(matches!(
            reject_traversal("\\windows\\system32"),
            Err(AppError::OutOfScope)
        ));
    }

    #[test]
    fn reject_traversal_accepts_safe_rel_paths() {
        assert!(reject_traversal("plan.json").is_ok());
        assert!(reject_traversal("sessions/abc/plan.json").is_ok());
        assert!(reject_traversal("").is_ok());
    }
}
