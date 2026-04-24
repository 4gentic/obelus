use crate::error::{AppError, AppResult};
use crate::state::AppState;
use std::path::PathBuf;
use tauri::State;

// Confused-deputy boundary. `authorize_project_root` exists solely to
// re-vouch paths that originated from the app's own picker dialogs in a
// previous session (persisted in the on-device projects table). A path that
// is not already vouched this session MUST resolve to a real, existing
// directory AND match an entry in the on-device projects store; we cannot
// check the latter from Rust without a DB dependency, so we rely on the
// following invariants to stay safe:
//
// 1. The only writer to the projects table is the app's own wizard flow,
//    which obtains paths via `open_folder_picker` / `open_paper_picker`.
// 2. The `sql:*` capability set is trimmed to the minimum commands the app
//    actually uses, so untrusted code cannot insert arbitrary project rows.
// 3. The deep-link handler (`apps/desktop/src/lib/deep-link.ts`) only
//    navigates to pre-registered project ids; it does not call this
//    command with payload from the URL.
//
// If any of these invariants changes, replace this command with a
// token-consuming one that takes a handle from `open_folder_picker` only.
#[tauri::command]
pub async fn authorize_project_root(path: String, state: State<'_, AppState>) -> AppResult<String> {
    let raw = PathBuf::from(&path);
    let canon = raw.canonicalize().map_err(AppError::from)?;
    if !canon.is_dir() {
        return Err(AppError::NotADirectory);
    }
    if let Some(existing) = state.vouched_paths.get(&canon) {
        return Ok(existing.to_string());
    }
    let id = uuid::Uuid::new_v4();
    state.allowed_roots.insert(id, canon.clone());
    state.vouched_paths.insert(canon, id);
    Ok(id.to_string())
}
