// Content-addressed snapshot store for writer-mode drafts.
//
// On disk, under `<workspace>/history/` (i.e. `<app_data>/projects/<projectId>/history/`):
//   blobs/<ab>/<rest>           raw file bytes, keyed by sha256 of content
//   manifests/<ab>/<rest>.json  manifest JSON, keyed by sha256 of its own bytes
//
// Manifests list every tracked text file at a given draft, plus any files
// tombstoned since the parent. They carry no SQL-side metadata (editId,
// parentEditId, kind): that lives in `paper_edits`. Keeping manifests pure
// makes them trivially content-addressed and cheap to dedupe.

use crate::commands::fs_scoped::{atomic_write, is_descendant, root_path_for};
use crate::commands::workspace::workspace_dir_for;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::ipc::Response;
use tauri::{AppHandle, State};
use tokio::io::AsyncReadExt;

const MANIFEST_VERSION: u32 = 1;

// Non-exhaustive text allowlist. Figures (.pdf/.png/.svg) and generated
// artifacts stay out of history for MVP; a future project-settings pass
// will expose a user-editable ignore list.
const TRACKED_EXTS: &[&str] = &[
    "tex", "md", "typ", "bib", "cls", "sty", "yml", "yaml", "json", "txt",
];

fn is_tracked_ext(rel: &str) -> bool {
    match Path::new(rel)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
    {
        Some(ext) => TRACKED_EXTS.iter().any(|&t| t == ext),
        None => false,
    }
}

fn is_excluded_dir(name: &str) -> bool {
    if name.starts_with('.') {
        return true;
    }
    matches!(name, "node_modules" | "out" | "dist" | "build" | "target")
}

fn sha256_hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    let mut out = String::with_capacity(digest.len() * 2);
    for b in digest {
        let _ = write!(out, "{b:02x}");
    }
    out
}

// Matches the shape our content-addressed store emits: 64-char lowercase hex.
// Renderer-supplied shas flow into blob_abs / manifest_abs untyped, so
// enforcing hex here is the only thing preventing `aa/../../etc/passwd` style
// paths from escaping `<workspace>/history/` via `PathBuf::join`'s
// absolute-argument-replaces-base rule.
fn is_sha256(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

async fn sha256_file_hex(abs: &Path) -> AppResult<String> {
    let file = tokio::fs::File::open(abs).await.map_err(AppError::from)?;
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
    use std::fmt::Write;
    let mut out = String::with_capacity(digest.len() * 2);
    for b in digest {
        let _ = write!(out, "{b:02x}");
    }
    Ok(out)
}

fn blob_abs(workspace: &Path, sha: &str) -> AppResult<PathBuf> {
    if !is_sha256(sha) {
        return Err(AppError::Apply(format!("invalid blob sha: {sha}")));
    }
    let (ab, rest) = sha.split_at(2);
    Ok(workspace
        .join("history")
        .join("blobs")
        .join(ab)
        .join(rest))
}

fn manifest_abs(workspace: &Path, sha: &str) -> AppResult<PathBuf> {
    if !is_sha256(sha) {
        return Err(AppError::Apply(format!("invalid manifest sha: {sha}")));
    }
    let (ab, rest) = sha.split_at(2);
    Ok(workspace
        .join("history")
        .join("manifests")
        .join(ab)
        .join(format!("{rest}.json")))
}

async fn ensure_parent(abs: &Path) -> AppResult<()> {
    if let Some(parent) = abs.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(AppError::from)?;
    }
    Ok(())
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct ManifestFile {
    rel: String,
    sha256: String,
    size: u64,
    mtime_ms: i64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct ManifestBody {
    version: u32,
    files: Vec<ManifestFile>,
    tombstones: Vec<String>,
}

async fn read_manifest(workspace: &Path, sha: &str) -> AppResult<ManifestBody> {
    let abs = manifest_abs(workspace, sha)?;
    let bytes = tokio::fs::read(&abs).await.map_err(AppError::from)?;
    serde_json::from_slice::<ManifestBody>(&bytes)
        .map_err(|e| AppError::Apply(format!("manifest {sha}: {e}")))
}

async fn write_blob_if_missing(
    workspace: &Path,
    sha: &str,
    bytes: &[u8],
) -> AppResult<(bool, u64)> {
    let abs = blob_abs(workspace, sha)?;
    if tokio::fs::metadata(&abs).await.is_ok() {
        return Ok((false, 0));
    }
    ensure_parent(&abs).await?;
    atomic_write(&abs, bytes).await?;
    Ok((true, bytes.len() as u64))
}

fn mtime_ms_of(metadata: &std::fs::Metadata) -> i64 {
    metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

async fn walk_tracked(root: &Path) -> AppResult<Vec<String>> {
    let mut hits: Vec<String> = Vec::new();
    let mut stack: Vec<PathBuf> = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let mut rd = tokio::fs::read_dir(&dir).await.map_err(AppError::from)?;
        while let Some(entry) = rd.next_entry().await.map_err(AppError::from)? {
            let file_type = match entry.file_type().await {
                Ok(ft) => ft,
                Err(_) => continue,
            };
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if file_type.is_dir() {
                if is_excluded_dir(&name_str) {
                    continue;
                }
                stack.push(entry.path());
            } else if file_type.is_file() {
                let path = entry.path();
                let rel = match path.strip_prefix(root) {
                    Ok(r) => r.to_string_lossy().replace('\\', "/"),
                    Err(_) => continue,
                };
                if !is_tracked_ext(&rel) {
                    continue;
                }
                hits.push(rel);
            }
        }
    }
    hits.sort();
    Ok(hits)
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HistorySnapshotReport {
    pub manifest_sha256: String,
    pub files_total: usize,
    pub blobs_written: usize,
    pub bytes_written: u64,
    pub is_new_manifest: bool,
}

async fn do_snapshot(
    root: &Path,
    workspace: &Path,
    explicit_rel_paths: &[String],
    tombstoned_rel_paths: &[String],
) -> AppResult<HistorySnapshotReport> {
    if !root.is_dir() {
        return Err(AppError::NotADirectory);
    }

    let mut rel_set: BTreeSet<String> = BTreeSet::from_iter(walk_tracked(root).await?);
    for rel in explicit_rel_paths {
        if !rel.is_empty() {
            rel_set.insert(rel.clone());
        }
    }

    let mut files: Vec<ManifestFile> = Vec::with_capacity(rel_set.len());
    let mut blobs_written = 0usize;
    let mut bytes_written = 0u64;

    for rel in rel_set {
        let abs = root.join(&rel);
        let canon = match abs.canonicalize() {
            Ok(p) => p,
            Err(_) => continue,
        };
        if !is_descendant(&canon, root) {
            continue;
        }
        let bytes = tokio::fs::read(&canon).await.map_err(AppError::from)?;
        let sha = sha256_hex(&bytes);
        let std_meta = std::fs::metadata(&canon).map_err(AppError::from)?;
        let size = std_meta.len();
        let mtime_ms = mtime_ms_of(&std_meta);
        let (wrote, n) = write_blob_if_missing(workspace, &sha, &bytes).await?;
        if wrote {
            blobs_written += 1;
            bytes_written += n;
        }
        files.push(ManifestFile {
            rel,
            sha256: sha,
            size,
            mtime_ms,
        });
    }

    let mut tombstones: Vec<String> = tombstoned_rel_paths.to_vec();
    tombstones.sort();
    tombstones.dedup();

    let body = ManifestBody {
        version: MANIFEST_VERSION,
        files,
        tombstones,
    };
    let manifest_bytes = serde_json::to_vec_pretty(&body)
        .map_err(|e| AppError::Apply(format!("manifest serialize: {e}")))?;
    let manifest_sha = sha256_hex(&manifest_bytes);
    let manifest_path = manifest_abs(workspace, &manifest_sha)?;
    let is_new_manifest = tokio::fs::metadata(&manifest_path).await.is_err();
    if is_new_manifest {
        ensure_parent(&manifest_path).await?;
        atomic_write(&manifest_path, &manifest_bytes).await?;
    }

    Ok(HistorySnapshotReport {
        manifest_sha256: manifest_sha,
        files_total: body.files.len(),
        blobs_written,
        bytes_written,
        is_new_manifest,
    })
}

#[tauri::command]
pub async fn history_snapshot(
    app: AppHandle,
    root_id: String,
    project_id: String,
    explicit_rel_paths: Vec<String>,
    tombstoned_rel_paths: Vec<String>,
    state: State<'_, AppState>,
) -> AppResult<HistorySnapshotReport> {
    let root = root_path_for(&root_id, &state)?;
    let workspace = workspace_dir_for(&app, &project_id)?;
    // Lock keyed by `root_id` (not `project_id`) because history is the only
    // writer of `<workspace>/history/` and this serialises with `apply_hunks`
    // / `fs_scoped` writes against the same paper tree on disk.
    let lock = state.root_lock(&root_id);
    let _guard = lock.lock().await;
    do_snapshot(&root, &workspace, &explicit_rel_paths, &tombstoned_rel_paths).await
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HistoryDivergenceReport {
    pub modified: Vec<String>,
    pub added: Vec<String>,
    pub missing: Vec<String>,
}

async fn do_detect_divergence(
    root: &Path,
    workspace: &Path,
    target_manifest_sha: &str,
) -> AppResult<HistoryDivergenceReport> {
    let manifest = read_manifest(workspace, target_manifest_sha).await?;

    let mut modified: Vec<String> = Vec::new();
    let mut missing: Vec<String> = Vec::new();
    let in_manifest: BTreeSet<String> =
        manifest.files.iter().map(|f| f.rel.clone()).collect();

    for entry in &manifest.files {
        let abs = root.join(&entry.rel);
        let meta = match tokio::fs::metadata(&abs).await {
            Ok(m) => m,
            Err(_) => {
                missing.push(entry.rel.clone());
                continue;
            }
        };
        if meta.len() != entry.size {
            modified.push(entry.rel.clone());
            continue;
        }
        let std_meta = std::fs::metadata(&abs).map_err(AppError::from)?;
        let mtime = mtime_ms_of(&std_meta);
        if mtime == entry.mtime_ms {
            continue;
        }
        let actual = sha256_file_hex(&abs).await?;
        if actual != entry.sha256 {
            modified.push(entry.rel.clone());
        }
    }

    let current = walk_tracked(root).await?;
    let added: Vec<String> = current
        .into_iter()
        .filter(|rel| !in_manifest.contains(rel))
        .collect();

    Ok(HistoryDivergenceReport {
        modified,
        added,
        missing,
    })
}

#[tauri::command]
pub async fn history_detect_divergence(
    app: AppHandle,
    root_id: String,
    project_id: String,
    target_manifest_sha: String,
    state: State<'_, AppState>,
) -> AppResult<HistoryDivergenceReport> {
    let root = root_path_for(&root_id, &state)?;
    let workspace = workspace_dir_for(&app, &project_id)?;
    do_detect_divergence(&root, &workspace, &target_manifest_sha).await
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HistoryCheckoutReport {
    pub files_written: usize,
    pub files_deleted: usize,
}

async fn do_checkout(
    root: &Path,
    workspace: &Path,
    target_manifest_sha: &str,
    expected_parent_manifest_sha: Option<&str>,
) -> AppResult<HistoryCheckoutReport> {
    let target = read_manifest(workspace, target_manifest_sha).await?;

    if let Some(parent_sha) = expected_parent_manifest_sha {
        let divergence = do_detect_divergence(root, workspace, parent_sha).await?;
        if !divergence.modified.is_empty()
            || !divergence.added.is_empty()
            || !divergence.missing.is_empty()
        {
            return Err(AppError::Apply(
                "working tree diverged from expected parent".into(),
            ));
        }
    }

    let mut writes: Vec<(PathBuf, Option<Vec<u8>>, Vec<u8>)> =
        Vec::with_capacity(target.files.len());
    for entry in &target.files {
        let blob = blob_abs(workspace, &entry.sha256)?;
        let new_bytes = tokio::fs::read(&blob)
            .await
            .map_err(|e| AppError::Apply(format!("missing blob {}: {e}", entry.sha256)))?;
        let abs = root.join(&entry.rel);
        if !abs.starts_with(root) {
            return Err(AppError::OutOfScope);
        }
        // None distinguishes "file was absent" from "file was empty" so the
        // rollback path can delete the new file instead of stamping a 0-byte
        // stub over its previously-nonexistent path.
        let orig_bytes = match tokio::fs::read(&abs).await {
            Ok(b) => Some(b),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(AppError::from(e)),
        };
        writes.push((abs, orig_bytes, new_bytes));
    }

    let mut committed: Vec<(PathBuf, Option<Vec<u8>>)> = Vec::with_capacity(writes.len());
    for (abs, orig, new) in &writes {
        if let Some(parent) = abs.parent() {
            if let Err(e) = tokio::fs::create_dir_all(parent).await {
                rollback(&committed).await;
                return Err(AppError::from(e));
            }
        }
        if let Err(e) = atomic_write(abs, new).await {
            rollback(&committed).await;
            return Err(e);
        }
        committed.push((abs.clone(), orig.clone()));
    }

    let mut files_deleted: usize = 0;
    for rel in &target.tombstones {
        let abs = root.join(rel);
        if !abs.starts_with(root) {
            continue;
        }
        if tokio::fs::metadata(&abs).await.is_ok() && tokio::fs::remove_file(&abs).await.is_ok() {
            files_deleted += 1;
        }
    }

    Ok(HistoryCheckoutReport {
        files_written: writes.len(),
        files_deleted,
    })
}

#[tauri::command]
pub async fn history_checkout(
    app: AppHandle,
    root_id: String,
    project_id: String,
    target_manifest_sha: String,
    expected_parent_manifest_sha: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<HistoryCheckoutReport> {
    let root = root_path_for(&root_id, &state)?;
    let workspace = workspace_dir_for(&app, &project_id)?;
    // Lock keyed by `root_id` (not `project_id`) — checkout writes paper bytes
    // back into the user's tree, so it must serialise with `apply_hunks` and
    // any other paper-tree writer keyed off the same root.
    let lock = state.root_lock(&root_id);
    let _guard = lock.lock().await;
    do_checkout(
        &root,
        &workspace,
        &target_manifest_sha,
        expected_parent_manifest_sha.as_deref(),
    )
    .await
}

async fn rollback(committed: &[(PathBuf, Option<Vec<u8>>)]) {
    for (abs, orig) in committed {
        match orig {
            Some(bytes) => {
                let _ = atomic_write(abs, bytes).await;
            }
            None => {
                let _ = tokio::fs::remove_file(abs).await;
            }
        }
    }
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HistoryGcReport {
    pub blobs_deleted: usize,
    pub manifests_deleted: usize,
    pub bytes_freed: u64,
}

async fn do_gc(workspace: &Path, live_manifest_shas: &[String]) -> AppResult<HistoryGcReport> {
    let history_root = workspace.join("history");
    if !history_root.is_dir() {
        return Ok(HistoryGcReport {
            blobs_deleted: 0,
            manifests_deleted: 0,
            bytes_freed: 0,
        });
    }

    let live_set: BTreeSet<String> = live_manifest_shas.iter().cloned().collect();
    let mut referenced_blobs: BTreeSet<String> = BTreeSet::new();
    for sha in &live_set {
        if let Ok(manifest) = read_manifest(workspace, sha).await {
            for entry in manifest.files {
                referenced_blobs.insert(entry.sha256);
            }
        }
    }

    let mut blobs_deleted = 0usize;
    let mut manifests_deleted = 0usize;
    let mut bytes_freed: u64 = 0;

    let blobs_root = history_root.join("blobs");
    if blobs_root.is_dir() {
        let mut lvl1 = tokio::fs::read_dir(&blobs_root).await.map_err(AppError::from)?;
        while let Some(entry) = lvl1.next_entry().await.map_err(AppError::from)? {
            if !entry.file_type().await.map(|ft| ft.is_dir()).unwrap_or(false) {
                continue;
            }
            let ab = entry.file_name().to_string_lossy().into_owned();
            let mut lvl2 = tokio::fs::read_dir(entry.path()).await.map_err(AppError::from)?;
            while let Some(blob) = lvl2.next_entry().await.map_err(AppError::from)? {
                if !blob.file_type().await.map(|ft| ft.is_file()).unwrap_or(false) {
                    continue;
                }
                let rest = blob.file_name().to_string_lossy().into_owned();
                let sha = format!("{ab}{rest}");
                if referenced_blobs.contains(&sha) {
                    continue;
                }
                let size = blob.metadata().await.map(|m| m.len()).unwrap_or(0);
                if tokio::fs::remove_file(blob.path()).await.is_ok() {
                    blobs_deleted += 1;
                    bytes_freed += size;
                }
            }
        }
    }

    let manifests_root = history_root.join("manifests");
    if manifests_root.is_dir() {
        let mut lvl1 = tokio::fs::read_dir(&manifests_root).await.map_err(AppError::from)?;
        while let Some(entry) = lvl1.next_entry().await.map_err(AppError::from)? {
            if !entry.file_type().await.map(|ft| ft.is_dir()).unwrap_or(false) {
                continue;
            }
            let ab = entry.file_name().to_string_lossy().into_owned();
            let mut lvl2 = tokio::fs::read_dir(entry.path()).await.map_err(AppError::from)?;
            while let Some(mf) = lvl2.next_entry().await.map_err(AppError::from)? {
                if !mf.file_type().await.map(|ft| ft.is_file()).unwrap_or(false) {
                    continue;
                }
                let name = mf.file_name().to_string_lossy().into_owned();
                let rest = name.strip_suffix(".json").unwrap_or(&name);
                let sha = format!("{ab}{rest}");
                if live_set.contains(&sha) {
                    continue;
                }
                let size = mf.metadata().await.map(|m| m.len()).unwrap_or(0);
                if tokio::fs::remove_file(mf.path()).await.is_ok() {
                    manifests_deleted += 1;
                    bytes_freed += size;
                }
            }
        }
    }

    Ok(HistoryGcReport {
        blobs_deleted,
        manifests_deleted,
        bytes_freed,
    })
}

#[tauri::command]
pub async fn history_gc(
    app: AppHandle,
    root_id: String,
    project_id: String,
    live_manifest_shas: Vec<String>,
    state: State<'_, AppState>,
) -> AppResult<HistoryGcReport> {
    // root_id is required (and validated) so the renderer can't GC a workspace
    // for a project the current root doesn't own.
    let _root = root_path_for(&root_id, &state)?;
    let workspace = workspace_dir_for(&app, &project_id)?;
    do_gc(&workspace, &live_manifest_shas).await
}

// Raw blob bytes for the inter-draft compare viewer. Returns via the IPC
// binary channel (same convention as `fs_read_file`), so the JSON encoder
// doesn't inflate Vec<u8>.
#[tauri::command]
pub async fn history_read_blob(
    app: AppHandle,
    root_id: String,
    project_id: String,
    sha256: String,
    state: State<'_, AppState>,
) -> AppResult<Response> {
    let _root = root_path_for(&root_id, &state)?;
    let workspace = workspace_dir_for(&app, &project_id)?;
    let abs = blob_abs(&workspace, &sha256)?;
    let bytes = tokio::fs::read(&abs).await.map_err(AppError::from)?;
    Ok(Response::new(bytes))
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub rel: String,
    // "added" | "removed" | "modified" | "binary"
    pub status: String,
    pub unified: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DiffManifestsReport {
    pub files: Vec<FileDiff>,
}

async fn blob_text(workspace: &Path, sha: &str) -> AppResult<Option<String>> {
    let abs = blob_abs(workspace, sha)?;
    let bytes = tokio::fs::read(&abs).await.map_err(AppError::from)?;
    match std::str::from_utf8(&bytes) {
        Ok(s) => Ok(Some(s.to_owned())),
        Err(_) => Ok(None),
    }
}

async fn do_diff_manifests(
    workspace: &Path,
    from_sha: &str,
    to_sha: &str,
) -> AppResult<DiffManifestsReport> {
    let from = read_manifest(workspace, from_sha).await?;
    let to = read_manifest(workspace, to_sha).await?;

    use std::collections::BTreeMap;
    let from_map: BTreeMap<&str, &str> = from
        .files
        .iter()
        .map(|f| (f.rel.as_str(), f.sha256.as_str()))
        .collect();
    let to_map: BTreeMap<&str, &str> = to
        .files
        .iter()
        .map(|f| (f.rel.as_str(), f.sha256.as_str()))
        .collect();

    let mut rels: BTreeSet<&str> = BTreeSet::new();
    rels.extend(from_map.keys().copied());
    rels.extend(to_map.keys().copied());

    let mut files: Vec<FileDiff> = Vec::new();
    for rel in rels {
        match (from_map.get(rel), to_map.get(rel)) {
            (Some(a), Some(b)) if a == b => continue,
            (Some(a), Some(b)) => {
                let old_text = blob_text(workspace, a).await?;
                let new_text = blob_text(workspace, b).await?;
                match (old_text, new_text) {
                    (Some(o), Some(n)) => files.push(FileDiff {
                        rel: rel.to_string(),
                        status: "modified".into(),
                        unified: diffy::create_patch(&o, &n).to_string(),
                    }),
                    _ => files.push(FileDiff {
                        rel: rel.to_string(),
                        status: "binary".into(),
                        unified: String::new(),
                    }),
                }
            }
            (None, Some(b)) => {
                let new_text = blob_text(workspace, b).await?;
                match new_text {
                    Some(n) => files.push(FileDiff {
                        rel: rel.to_string(),
                        status: "added".into(),
                        unified: diffy::create_patch("", &n).to_string(),
                    }),
                    None => files.push(FileDiff {
                        rel: rel.to_string(),
                        status: "binary".into(),
                        unified: String::new(),
                    }),
                }
            }
            (Some(a), None) => {
                let old_text = blob_text(workspace, a).await?;
                match old_text {
                    Some(o) => files.push(FileDiff {
                        rel: rel.to_string(),
                        status: "removed".into(),
                        unified: diffy::create_patch(&o, "").to_string(),
                    }),
                    None => files.push(FileDiff {
                        rel: rel.to_string(),
                        status: "binary".into(),
                        unified: String::new(),
                    }),
                }
            }
            (None, None) => {}
        }
    }

    Ok(DiffManifestsReport { files })
}

#[tauri::command]
pub async fn history_diff_manifests(
    app: AppHandle,
    root_id: String,
    project_id: String,
    from_manifest_sha: String,
    to_manifest_sha: String,
    state: State<'_, AppState>,
) -> AppResult<DiffManifestsReport> {
    let _root = root_path_for(&root_id, &state)?;
    let workspace = workspace_dir_for(&app, &project_id)?;
    do_diff_manifests(&workspace, &from_manifest_sha, &to_manifest_sha).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    async fn write(path: &Path, body: &str) {
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await.unwrap();
        }
        tokio::fs::write(path, body).await.unwrap();
    }

    // Two TempDirs per test: `root` is the user's paper tree, `workspace` is
    // the per-project app-data subdir that holds blobs/ and manifests/. Keeping
    // them physically separate in tests guards against any helper accidentally
    // resurrecting the old `<root>/.obelus/history/` layout.
    fn make_workspace() -> (TempDir, PathBuf) {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().canonicalize().unwrap();
        (tmp, path)
    }

    #[tokio::test]
    async fn snapshot_then_checkout_round_trip_restores_bytes() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        let (_ws_tmp, workspace) = make_workspace();
        write(&root.join("paper.tex"), "hello world").await;
        write(&root.join("nested/intro.md"), "draft one").await;

        let snap = do_snapshot(&root, &workspace, &[], &[]).await.unwrap();
        assert_eq!(snap.files_total, 2);
        assert!(snap.blobs_written >= 2);

        write(&root.join("paper.tex"), "hello CHANGED").await;
        tokio::fs::remove_file(root.join("nested/intro.md"))
            .await
            .unwrap();

        let report = do_checkout(&root, &workspace, &snap.manifest_sha256, None)
            .await
            .unwrap();
        assert_eq!(report.files_written, 2);

        let paper = tokio::fs::read_to_string(root.join("paper.tex")).await.unwrap();
        assert_eq!(paper, "hello world");
        let intro = tokio::fs::read_to_string(root.join("nested/intro.md"))
            .await
            .unwrap();
        assert_eq!(intro, "draft one");

        // Snapshots must NOT have polluted the user's paper tree.
        assert!(
            !root.join(".obelus").exists(),
            "snapshot store leaked into paper root"
        );
    }

    #[tokio::test]
    async fn divergence_detects_modified_added_missing() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        let (_ws_tmp, workspace) = make_workspace();
        write(&root.join("a.tex"), "aa").await;
        write(&root.join("b.tex"), "bb").await;
        let snap = do_snapshot(&root, &workspace, &[], &[]).await.unwrap();

        write(&root.join("a.tex"), "aa changed").await;
        tokio::fs::remove_file(root.join("b.tex")).await.unwrap();
        write(&root.join("c.tex"), "cc").await;

        let div = do_detect_divergence(&root, &workspace, &snap.manifest_sha256)
            .await
            .unwrap();
        assert!(div.modified.iter().any(|r| r == "a.tex"));
        assert!(div.missing.iter().any(|r| r == "b.tex"));
        assert!(div.added.iter().any(|r| r == "c.tex"));
    }

    #[tokio::test]
    async fn checkout_refuses_when_expected_parent_diverged() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        let (_ws_tmp, workspace) = make_workspace();
        write(&root.join("x.tex"), "original").await;
        let snap_a = do_snapshot(&root, &workspace, &[], &[]).await.unwrap();

        write(&root.join("x.tex"), "edited by hand").await;
        let snap_b = do_snapshot(&root, &workspace, &[], &[]).await.unwrap();
        assert_ne!(snap_a.manifest_sha256, snap_b.manifest_sha256);

        // Working tree currently matches snap_b. Asking to checkout snap_a with
        // snap_a as the expected parent is a lie — divergence must be refused.
        let err = do_checkout(
            &root,
            &workspace,
            &snap_a.manifest_sha256,
            Some(&snap_a.manifest_sha256),
        )
        .await
        .unwrap_err();
        match err {
            AppError::Apply(msg) => assert!(msg.contains("diverged")),
            other => panic!("expected Apply, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn gc_preserves_live_and_removes_unreferenced() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        let (_ws_tmp, workspace) = make_workspace();
        write(&root.join("x.tex"), "live").await;
        let snap_live = do_snapshot(&root, &workspace, &[], &[]).await.unwrap();

        write(&root.join("x.tex"), "disposable").await;
        let snap_gone = do_snapshot(&root, &workspace, &[], &[]).await.unwrap();
        assert_ne!(snap_live.manifest_sha256, snap_gone.manifest_sha256);

        // Reset working tree to live content so the live manifest is honest.
        write(&root.join("x.tex"), "live").await;

        let gc = do_gc(&workspace, &[snap_live.manifest_sha256.clone()])
            .await
            .unwrap();
        assert!(gc.blobs_deleted >= 1);
        assert!(gc.manifests_deleted >= 1);

        // Live manifest must still be usable.
        let div = do_detect_divergence(&root, &workspace, &snap_live.manifest_sha256)
            .await
            .unwrap();
        assert!(div.modified.is_empty());
        assert!(div.missing.is_empty());
    }

    #[tokio::test]
    async fn diff_manifests_classifies_added_removed_modified() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        let (_ws_tmp, workspace) = make_workspace();
        write(&root.join("kept.tex"), "line 1\nline 2\n").await;
        write(&root.join("old.md"), "about to vanish\n").await;
        let snap_a = do_snapshot(&root, &workspace, &[], &[]).await.unwrap();

        // Modify kept.tex, delete old.md, add new.md
        write(&root.join("kept.tex"), "line 1\nline 2 changed\n").await;
        tokio::fs::remove_file(root.join("old.md")).await.unwrap();
        write(&root.join("new.md"), "hello\n").await;
        let snap_b = do_snapshot(&root, &workspace, &[], &[]).await.unwrap();

        let report =
            do_diff_manifests(&workspace, &snap_a.manifest_sha256, &snap_b.manifest_sha256)
                .await
                .unwrap();
        let by_rel: std::collections::BTreeMap<_, _> =
            report.files.iter().map(|f| (f.rel.as_str(), f)).collect();
        assert_eq!(by_rel["kept.tex"].status, "modified");
        assert!(by_rel["kept.tex"].unified.contains("line 2 changed"));
        assert_eq!(by_rel["old.md"].status, "removed");
        assert_eq!(by_rel["new.md"].status, "added");
        assert!(by_rel["new.md"].unified.contains("+hello"));
    }

    #[tokio::test]
    async fn diff_manifests_skips_unchanged_files() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        let (_ws_tmp, workspace) = make_workspace();
        write(&root.join("a.tex"), "same\n").await;
        write(&root.join("b.tex"), "also same\n").await;
        let snap_a = do_snapshot(&root, &workspace, &[], &[]).await.unwrap();

        write(&root.join("b.tex"), "now different\n").await;
        let snap_b = do_snapshot(&root, &workspace, &[], &[]).await.unwrap();

        let report =
            do_diff_manifests(&workspace, &snap_a.manifest_sha256, &snap_b.manifest_sha256)
                .await
                .unwrap();
        assert_eq!(report.files.len(), 1);
        assert_eq!(report.files[0].rel, "b.tex");
    }

    #[tokio::test]
    async fn manifest_is_content_addressed_and_dedupes() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        let (_ws_tmp, workspace) = make_workspace();
        write(&root.join("x.tex"), "same").await;
        let snap1 = do_snapshot(&root, &workspace, &[], &[]).await.unwrap();
        let snap2 = do_snapshot(&root, &workspace, &[], &[]).await.unwrap();
        assert_eq!(snap1.manifest_sha256, snap2.manifest_sha256);
        assert!(snap1.is_new_manifest);
        assert!(!snap2.is_new_manifest);
    }

    #[test]
    fn is_sha256_accepts_valid_lowercase_hex() {
        assert!(is_sha256(&"a".repeat(64)));
        let mixed = "0123456789abcdef".repeat(4);
        assert_eq!(mixed.len(), 64);
        assert!(is_sha256(&mixed));
    }

    #[test]
    fn is_sha256_rejects_wrong_length() {
        assert!(!is_sha256(""));
        assert!(!is_sha256("abc"));
        assert!(!is_sha256(&"a".repeat(63)));
        assert!(!is_sha256(&"a".repeat(65)));
    }

    #[test]
    fn is_sha256_rejects_uppercase_and_non_hex() {
        assert!(!is_sha256(&"A".repeat(64)));
        assert!(!is_sha256(&"g".repeat(64)));
        let mixed = format!("{}{}", "a".repeat(32), "A".repeat(32));
        assert!(!is_sha256(&mixed));
    }

    #[test]
    fn is_sha256_rejects_path_traversal_inputs() {
        assert!(!is_sha256("aa/../../../../../etc/passwd"));
        let padded = format!("aa/../../../../{}", "x".repeat(49));
        assert_eq!(padded.len(), 64);
        assert!(!is_sha256(&padded));
    }

    #[test]
    fn blob_abs_and_manifest_abs_reject_non_sha() {
        let workspace = Path::new("/tmp/obelus-test-workspace");
        match blob_abs(workspace, "aa/../../../../../etc/passwd") {
            Err(AppError::Apply(msg)) => assert!(msg.contains("invalid blob sha"), "{msg}"),
            other => panic!("expected Apply error, got {other:?}"),
        }
        match manifest_abs(workspace, "not-a-sha") {
            Err(AppError::Apply(msg)) => assert!(msg.contains("invalid manifest sha"), "{msg}"),
            other => panic!("expected Apply error, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn checkout_rollback_removes_new_files_and_restores_modified() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        let (_ws_tmp, workspace) = make_workspace();
        write(&root.join("a.tex"), "original").await;
        write(&root.join("b.tex"), "to_add").await;
        write(&root.join("z/c.tex"), "z_original").await;

        let snap = do_snapshot(&root, &workspace, &[], &[]).await.unwrap();

        // Pre-checkout state: a.tex modified, b.tex absent, z/ replaced with a
        // regular file so create_dir_all("z") trips mid-loop. Checkout sorts
        // by rel (a.tex → b.tex → z/c.tex), so a.tex and b.tex commit before
        // the z/c.tex step fails — exercising both rollback branches.
        write(&root.join("a.tex"), "modified").await;
        tokio::fs::remove_file(root.join("b.tex")).await.unwrap();
        tokio::fs::remove_dir_all(root.join("z")).await.unwrap();
        write(&root.join("z"), "blocker").await;

        let err = do_checkout(&root, &workspace, &snap.manifest_sha256, None)
            .await
            .expect_err("expected checkout to fail at create_dir_all(z)");
        assert!(
            matches!(err, AppError::Io(_) | AppError::Apply(_)),
            "unexpected error variant: {err:?}"
        );

        // a.tex: rollback restored its pre-checkout bytes, not the target bytes.
        let a = tokio::fs::read_to_string(root.join("a.tex")).await.unwrap();
        assert_eq!(a, "modified", "rollback must restore pre-checkout bytes");

        // b.tex: was absent pre-checkout — rollback must delete, not leave a
        // 0-byte stub. This is the regression this whole test exists for.
        assert!(
            !root.join("b.tex").exists(),
            "b.tex was absent pre-checkout; rollback must not leave a stub"
        );
    }
}
