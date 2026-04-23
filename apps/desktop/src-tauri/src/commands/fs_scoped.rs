use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tauri::ipc::Response;
use tauri::State;
use tokio::io::AsyncReadExt;
use uuid::Uuid;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DirEntryDto {
    pub name: String,
    pub kind: EntryKind,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    File,
    Dir,
    Other,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FsStatDto {
    pub size: u64,
    pub sha256: String,
}

fn root_for(root_id: &str, state: &AppState) -> AppResult<PathBuf> {
    let id = Uuid::parse_str(root_id).map_err(|_| AppError::UnknownRootId)?;
    state
        .allowed_roots
        .get(&id)
        .ok_or(AppError::UnknownRootId)
        .map(|r| r.clone())
}

pub(super) fn resolve(root_id: &str, rel: &str, state: &AppState) -> AppResult<PathBuf> {
    let root = root_for(root_id, state)?;
    let joined = root.join(rel);
    let canon = joined.canonicalize().map_err(AppError::from)?;
    if !is_descendant(&canon, &root) {
        return Err(AppError::OutOfScope);
    }
    Ok(canon)
}

pub(super) fn root_path_for(root_id: &str, state: &AppState) -> AppResult<PathBuf> {
    root_for(root_id, state)
}

// Write target may not exist yet; canonicalize the parent instead and verify
// descendance from there. `..` components are rejected outright so they can't
// climb above the root via lexical joins.
pub(super) async fn resolve_for_write(
    root_id: &str,
    rel: &str,
    state: &AppState,
) -> AppResult<PathBuf> {
    let root = root_for(root_id, state)?;
    for comp in rel.split(|c| c == '/' || c == '\\') {
        if comp == ".." {
            return Err(AppError::OutOfScope);
        }
    }
    let joined = root.join(rel);
    let parent = joined.parent().ok_or(AppError::OutOfScope)?;
    tokio::fs::create_dir_all(parent).await.map_err(AppError::from)?;
    let parent_canon = parent.canonicalize().map_err(AppError::from)?;
    if !is_descendant(&parent_canon, &root) {
        return Err(AppError::OutOfScope);
    }
    let name = joined
        .file_name()
        .ok_or(AppError::OutOfScope)?
        .to_os_string();
    Ok(parent_canon.join(name))
}

pub(super) fn is_descendant(child: &Path, ancestor: &Path) -> bool {
    child.starts_with(ancestor)
}

// Returns raw bytes via the IPC binary channel rather than a JSON `number[]`.
// The JSON encoder inflates Vec<u8> ~3-4× and chokes on multi-MB PDFs.
#[tauri::command]
pub async fn fs_read_file(
    root_id: String,
    rel_path: String,
    state: State<'_, AppState>,
) -> AppResult<Response> {
    let abs = resolve(&root_id, &rel_path, &state)?;
    let bytes = tokio::fs::read(&abs).await.map_err(AppError::from)?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub async fn fs_read_dir(
    root_id: String,
    rel_path: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<DirEntryDto>> {
    let abs = resolve(&root_id, &rel_path, &state)?;
    if !abs.is_dir() {
        return Err(AppError::NotADirectory);
    }
    let mut entries = Vec::new();
    let mut rd = tokio::fs::read_dir(&abs).await.map_err(AppError::from)?;
    while let Some(entry) = rd.next_entry().await.map_err(AppError::from)? {
        let name = entry.file_name().to_string_lossy().into_owned();
        let kind = match entry.file_type().await {
            Ok(ft) if ft.is_dir() => EntryKind::Dir,
            Ok(ft) if ft.is_file() => EntryKind::File,
            _ => EntryKind::Other,
        };
        entries.push(DirEntryDto { name, kind });
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

#[tauri::command]
pub async fn fs_write_bytes(
    root_id: String,
    rel_path: String,
    bytes: Vec<u8>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let abs = resolve_for_write(&root_id, &rel_path, &state).await?;
    atomic_write(&abs, &bytes).await
}

pub(super) async fn atomic_write(abs: &Path, bytes: &[u8]) -> AppResult<()> {
    let tmp = abs.with_extension(format!(
        "{}.tmp",
        abs.extension().map(|e| e.to_string_lossy().into_owned()).unwrap_or_default()
    ));
    {
        let mut file = tokio::fs::File::create(&tmp).await.map_err(AppError::from)?;
        tokio::io::AsyncWriteExt::write_all(&mut file, bytes)
            .await
            .map_err(AppError::from)?;
        file.sync_all().await.map_err(AppError::from)?;
    }
    tokio::fs::rename(&tmp, abs).await.map_err(AppError::from)?;
    Ok(())
}

#[tauri::command]
pub async fn fs_write_text(
    root_id: String,
    rel_path: String,
    body: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let abs = resolve_for_write(&root_id, &rel_path, &state).await?;
    atomic_write(&abs, body.as_bytes()).await
}

// Creates a new empty file at `rel_path`. Unlike `fs_write_text`, which would
// clobber an existing file, this uses `create_new` so the caller can't
// accidentally overwrite user data. The frontend surfaces `AlreadyExists` as
// an inline error on the create-file input.
#[tauri::command]
pub async fn fs_create_file(
    root_id: String,
    rel_path: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let abs = resolve_for_write(&root_id, &rel_path, &state).await?;
    let mut opts = tokio::fs::OpenOptions::new();
    opts.write(true).create_new(true);
    match opts.open(&abs).await {
        Ok(file) => {
            file.sync_all().await.map_err(AppError::from)?;
            Ok(())
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Err(AppError::AlreadyExists),
        Err(e) => Err(AppError::from(e)),
    }
}

#[tauri::command]
pub async fn fs_move_path(
    root_id: String,
    from_rel_path: String,
    to_rel_path: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    if from_rel_path == to_rel_path {
        return Ok(());
    }
    let from_abs = resolve(&root_id, &from_rel_path, &state)?;
    // Validate the destination before `resolve_for_write` runs its
    // `create_dir_all`. Otherwise a move that's about to be rejected —
    // especially move-into-own-descendant — leaves stub directories behind,
    // worst case inside the folder the user is trying to move.
    for comp in to_rel_path.split(|c| c == '/' || c == '\\') {
        if comp == ".." {
            return Err(AppError::OutOfScope);
        }
    }
    let root = root_path_for(&root_id, &state)?;
    let to_abs_pre = root.join(&to_rel_path);
    if to_abs_pre.starts_with(&from_abs) {
        return Err(AppError::OutOfScope);
    }
    if tokio::fs::try_exists(&to_abs_pre).await.map_err(AppError::from)? {
        return Err(AppError::AlreadyExists);
    }
    let to_abs = resolve_for_write(&root_id, &to_rel_path, &state).await?;
    tokio::fs::rename(&from_abs, &to_abs).await.map_err(AppError::from)?;
    Ok(())
}

// Writes a text file to an absolute path the user just picked via the native
// `save()` dialog. The dialog is the user-trust boundary; this command only
// rejects relative paths so a malformed frontend call can't append-to-cwd.
// Distinct from `fs_write_text`, which is strictly scoped to a project root.
#[tauri::command]
pub async fn fs_write_text_abs(path: String, body: String) -> AppResult<()> {
    let abs = Path::new(&path);
    if !abs.is_absolute() {
        return Err(AppError::OutOfScope);
    }
    if let Some(parent) = abs.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(AppError::from)?;
    }
    atomic_write(abs, body.as_bytes()).await
}

#[tauri::command]
pub async fn fs_list_pdfs(
    root_id: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<String>> {
    let root = root_path_for(&root_id, &state)?;
    if !root.is_dir() {
        return Err(AppError::NotADirectory);
    }
    let mut hits = Vec::new();
    let mut stack: Vec<PathBuf> = vec![root.clone()];
    while let Some(dir) = stack.pop() {
        let mut rd = tokio::fs::read_dir(&dir).await.map_err(AppError::from)?;
        while let Some(entry) = rd.next_entry().await.map_err(AppError::from)? {
            let path = entry.path();
            let ft = match entry.file_type().await {
                Ok(ft) => ft,
                Err(_) => continue,
            };
            if ft.is_dir() {
                // Skip hidden dirs like .obelus, .git to keep the walk tight.
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if name.starts_with('.') {
                    continue;
                }
                stack.push(path);
            } else if ft.is_file() {
                let ext_is_pdf = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.eq_ignore_ascii_case("pdf"))
                    .unwrap_or(false);
                if ext_is_pdf {
                    if let Ok(rel) = path.strip_prefix(&root) {
                        hits.push(rel.to_string_lossy().replace('\\', "/"));
                    }
                }
            }
        }
    }
    hits.sort();
    Ok(hits)
}

#[tauri::command]
pub async fn fs_stat(
    root_id: String,
    rel_path: String,
    state: State<'_, AppState>,
) -> AppResult<FsStatDto> {
    let abs = resolve(&root_id, &rel_path, &state)?;
    let file = tokio::fs::File::open(&abs).await.map_err(AppError::from)?;
    let size = file.metadata().await.map_err(AppError::from)?.len();
    let mut reader = tokio::io::BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = reader.read(&mut buf).await.map_err(AppError::from)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let digest = hasher.finalize();
    let mut hash = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use std::fmt::Write;
        let _ = write!(hash, "{byte:02x}");
    }
    Ok(FsStatDto { size, sha256: hash })
}
