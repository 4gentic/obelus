// WS3: append-only metrics for one Claude review session. The frontend writes
// stream-derived events (phase, tool-call, plan-stats), and this module's
// Rust callers (preflight, apply) write the events they own. Both sides land
// in the same workspace file, one JSON object per line.
//
// File path: `<workspace_dir>/metrics-<sessionId>.jsonl`. Naming by session
// UUID (not ISO) keeps Rust- and TS-side appenders in sync without an extra
// channel — both sides know the session id.
//
// Errors are logged to stderr but never bubble up: a metrics write failure
// must never abort a real operation. The metrics file is observability, not
// a contract.
//
// IMPORTANT: This file is desktop-only and writes to `<app_data>` only. No
// network, no user-paper-tree access.

use crate::commands::workspace::workspace_dir_for;
use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

fn metrics_path(workspace_dir: &Path, session_id: &str) -> PathBuf {
    workspace_dir.join(format!("metrics-{session_id}.jsonl"))
}

pub(crate) async fn append_event(
    workspace_dir: &Path,
    session_id: &str,
    event_json: &str,
) -> std::io::Result<()> {
    tokio::fs::create_dir_all(workspace_dir).await?;
    let path = metrics_path(workspace_dir, session_id);
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .await?;
    let mut line = event_json.to_owned();
    if !line.ends_with('\n') {
        line.push('\n');
    }
    file.write_all(line.as_bytes()).await?;
    // Flush before drop so a crash mid-run still leaves the partial JSONL
    // readable up to the last completed write.
    file.flush().await?;
    Ok(())
}

// Fire-and-forget convenience: serializable payload + boundary log on failure.
// Called from Rust hot paths (claude_spawn, apply_hunks, preflight) where a
// metrics-write hiccup must never fail the surrounding operation.
pub(crate) async fn append_event_bestoffer(
    workspace_dir: &Path,
    session_id: &str,
    payload: &serde_json::Value,
) {
    let line = match serde_json::to_string(payload) {
        Ok(s) => s,
        Err(err) => {
            eprintln!("[metrics] serialize failed sessionId={session_id} err={err}");
            return;
        }
    };
    if let Err(err) = append_event(workspace_dir, session_id, &line).await {
        eprintln!(
            "[metrics] append failed sessionId={session_id} path={} err={err}",
            workspace_dir.display(),
        );
    }
}

#[tauri::command]
pub async fn metrics_append(
    app: AppHandle,
    project_id: String,
    session_id: String,
    event_json: String,
) -> AppResult<()> {
    Uuid::parse_str(&session_id).map_err(|_| AppError::Other("invalid session id".into()))?;
    let workspace = workspace_dir_for(&app, &project_id)?;
    if let Err(err) = append_event(&workspace, &session_id, &event_json).await {
        eprintln!(
            "[metrics] append failed sessionId={session_id} path={} err={err}",
            workspace.display(),
        );
        return Err(AppError::from(err));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn appends_two_events_one_per_line_ordered() {
        let tmp = tempfile::tempdir().unwrap();
        let session = "00000000-0000-4000-8000-000000000001";

        append_event(tmp.path(), session, r#"{"event":"first","i":1}"#)
            .await
            .unwrap();
        append_event(tmp.path(), session, r#"{"event":"second","i":2}"#)
            .await
            .unwrap();

        let body = std::fs::read_to_string(tmp.path().join(format!("metrics-{session}.jsonl")))
            .unwrap();
        let lines: Vec<&str> = body.lines().collect();
        assert_eq!(lines.len(), 2, "got: {body:?}");
        let first: serde_json::Value = serde_json::from_str(lines[0]).expect("line 0 is JSON");
        let second: serde_json::Value = serde_json::from_str(lines[1]).expect("line 1 is JSON");
        assert_eq!(first["event"], "first");
        assert_eq!(first["i"], 1);
        assert_eq!(second["event"], "second");
        assert_eq!(second["i"], 2);
    }

    #[tokio::test]
    async fn append_appends_does_not_overwrite_across_calls() {
        let tmp = tempfile::tempdir().unwrap();
        let session = "00000000-0000-4000-8000-000000000002";

        append_event(tmp.path(), session, r#"{"event":"a"}"#).await.unwrap();
        // A second call to a separate "session" should have its own file.
        append_event(tmp.path(), "00000000-0000-4000-8000-000000000003", r#"{"event":"b"}"#)
            .await
            .unwrap();
        // And the first session's file remains a single line.
        append_event(tmp.path(), session, r#"{"event":"c"}"#).await.unwrap();

        let s1 =
            std::fs::read_to_string(tmp.path().join(format!("metrics-{session}.jsonl"))).unwrap();
        assert_eq!(s1.lines().count(), 2);
    }

    #[tokio::test]
    async fn append_event_normalises_missing_trailing_newline() {
        let tmp = tempfile::tempdir().unwrap();
        let session = "00000000-0000-4000-8000-000000000004";
        append_event(tmp.path(), session, r#"{"a":1}"#).await.unwrap();
        let body =
            std::fs::read_to_string(tmp.path().join(format!("metrics-{session}.jsonl"))).unwrap();
        assert!(body.ends_with('\n'), "expected trailing newline; got {body:?}");
    }
}
