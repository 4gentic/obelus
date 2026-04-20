use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::oneshot;
use uuid::Uuid;

const MAX_RUBRIC_BYTES: u64 = 256 * 1024;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PickedRoot {
    pub path: String,
    pub root_id: String,
}

// Register a freshly-picked directory as an allowed root. Canonicalization here
// is the single point where a user-selected path enters the trust boundary.
fn register_root(state: &AppState, raw: PathBuf) -> Option<PickedRoot> {
    let canon = raw.canonicalize().ok()?;
    if !canon.is_dir() {
        return None;
    }
    if let Some(existing) = state.vouched_paths.get(&canon) {
        return Some(PickedRoot {
            path: canon.display().to_string(),
            root_id: existing.to_string(),
        });
    }
    let id = Uuid::new_v4();
    state.allowed_roots.insert(id, canon.clone());
    state.vouched_paths.insert(canon.clone(), id);
    Some(PickedRoot {
        path: canon.display().to_string(),
        root_id: id.to_string(),
    })
}

#[tauri::command]
pub async fn open_folder_picker(app: AppHandle) -> Option<PickedRoot> {
    let (tx, rx) = oneshot::channel();
    app.dialog().file().pick_folder(move |picked| {
        let path = picked.and_then(|p| p.as_path().map(PathBuf::from));
        let _ = tx.send(path);
    });
    let path = rx.await.ok().flatten()?;
    let state = app.state::<AppState>();
    register_root(&state, path)
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PickedPdf {
    pub path: String,
    pub root_id: String,
    pub file_name: String,
}

#[tauri::command]
pub async fn open_pdf_picker(app: AppHandle) -> Option<PickedPdf> {
    let (tx, rx) = oneshot::channel();
    app.dialog()
        .file()
        .add_filter("PDF", &["pdf"])
        .pick_file(move |picked| {
            let path = picked.and_then(|p| p.as_path().map(PathBuf::from));
            let _ = tx.send(path);
        });
    let file_path = rx.await.ok().flatten()?;
    let canon = file_path.canonicalize().ok()?;
    let parent = canon.parent()?.to_path_buf();
    let file_name = canon.file_name()?.to_string_lossy().into_owned();
    let state = app.state::<AppState>();
    let root = register_root(&state, parent)?;
    Some(PickedPdf {
        path: canon.display().to_string(),
        root_id: root.root_id,
        file_name,
    })
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PickedRubric {
    pub name: String,
    pub content: String,
}

// Reads the rubric file inside Rust and returns its contents to the frontend.
// Deliberately does NOT register the picked file's parent as a new allowed
// root: a rubric is a one-shot import, not an ongoing scope, and widening the
// trust boundary on every rubric pick would defeat the purpose of scoped fs.
#[tauri::command]
pub async fn open_rubric_picker(app: AppHandle) -> AppResult<Option<PickedRubric>> {
    let (tx, rx) = oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Rubric", &["md", "txt", "markdown"])
        .pick_file(move |picked| {
            let path = picked.and_then(|p| p.as_path().map(PathBuf::from));
            let _ = tx.send(path);
        });
    let Some(file_path) = rx.await.ok().flatten() else {
        return Ok(None);
    };
    let canon = file_path
        .canonicalize()
        .map_err(|e| AppError::Other(format!("rubric path could not be canonicalized: {e}")))?;
    if !canon.is_file() {
        return Err(AppError::Other("rubric path is not a file".into()));
    }
    let metadata = tokio::fs::metadata(&canon)
        .await
        .map_err(|e| AppError::Other(format!("rubric metadata: {e}")))?;
    if metadata.len() > MAX_RUBRIC_BYTES {
        return Err(AppError::Other(format!(
            "rubric exceeds maximum size of {} bytes",
            MAX_RUBRIC_BYTES
        )));
    }
    let bytes = tokio::fs::read(&canon)
        .await
        .map_err(|e| AppError::Other(format!("rubric read: {e}")))?;
    let content = String::from_utf8(bytes)
        .map_err(|_| AppError::Other("rubric is not valid UTF-8".into()))?;
    let name = canon
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "rubric.md".to_string());
    Ok(Some(PickedRubric { name, content }))
}
