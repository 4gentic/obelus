use crate::error::{AppError, AppResult};
use crate::state::AppState;
use command_group::AsyncCommandGroup;
use serde::Serialize;
use std::path::PathBuf;
use std::process::Stdio;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::oneshot;
use uuid::Uuid;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StreamEvent {
    pub session_id: String,
    pub line: String,
    pub ts: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExitEvent {
    pub session_id: String,
    pub code: Option<i32>,
    pub cancelled: bool,
}

/// Returns a millisecond-since-epoch stamp used as the `ts` field on stream
/// events. Named for what it actually produces — not ISO 8601.
pub fn ms_elapsed_stamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    format!("{}ms", ms)
}

pub fn project_root(state: &AppState, root_id: &str) -> AppResult<PathBuf> {
    let id = Uuid::parse_str(root_id).map_err(|_| AppError::UnknownRootId)?;
    state
        .allowed_roots
        .get(&id)
        .map(|r| r.clone())
        .ok_or(AppError::UnknownRootId)
}

pub fn append_extra_prompt_body(mut base: String, extra: Option<&String>) -> String {
    if let Some(extra) = extra.filter(|s| !s.trim().is_empty()) {
        base.push('\n');
        base.push_str(extra);
        if !base.ends_with('\n') {
            base.push('\n');
        }
    }
    base
}

/// Spawns `cmd`, optionally writes `stdin_data` to its stdin, then streams
/// stdout/stderr to the Tauri event bus as `"claude:stdout"` / `"claude:stderr"`.
/// `label` names the engine in log lines ("claude-session" or "opencode-session").
/// Returns the session ID string used to correlate events and cancellations.
pub async fn spawn_and_stream(
    mut cmd: Command,
    stdin_data: Option<String>,
    label: &'static str,
    app: AppHandle,
    state: &AppState,
) -> AppResult<String> {
    cmd.stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if stdin_data.is_some() {
        cmd.stdin(Stdio::piped());
    }

    let started_at = std::time::Instant::now();
    let mut child = cmd.group_spawn().map_err(AppError::from)?;
    let session_id = Uuid::new_v4();
    let session_str = session_id.to_string();

    if let Some(data) = stdin_data {
        if let Some(mut stdin) = child.inner().stdin.take() {
            stdin.write_all(data.as_bytes()).await.map_err(AppError::from)?;
            stdin.flush().await.ok();
            drop(stdin);
        }
    }

    if let Some(stdout) = child.inner().stdout.take() {
        let app_clone = app.clone();
        let sid = session_str.clone();
        let started_at_for_stdout = started_at;
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            let mut first_seen = false;
            while let Ok(Some(line)) = reader.next_line().await {
                if !first_seen {
                    first_seen = true;
                    eprintln!(
                        "[{}] sessionId={} firstStdoutMs={}",
                        label,
                        sid,
                        started_at_for_stdout.elapsed().as_millis(),
                    );
                }
                let _ = app_clone.emit(
                    "claude:stdout",
                    StreamEvent {
                        session_id: sid.clone(),
                        line,
                        ts: ms_elapsed_stamp(),
                    },
                );
            }
        });
    }

    if let Some(stderr) = child.inner().stderr.take() {
        let app_clone = app.clone();
        let sid = session_str.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let _ = app_clone.emit(
                    "claude:stderr",
                    StreamEvent {
                        session_id: sid.clone(),
                        line,
                        ts: ms_elapsed_stamp(),
                    },
                );
            }
        });
    }

    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
    state.claude_cancellers.insert(session_id, cancel_tx);

    let app_wait = app.clone();
    let sid_wait = session_str.clone();
    tokio::spawn(async move {
        let (code, cancelled) = tokio::select! {
            _ = cancel_rx => {
                let _ = child.kill().await;
                (None, true)
            }
            result = child.wait() => {
                let code = result.ok().and_then(|s| s.code());
                (code, false)
            }
        };
        let state = app_wait.state::<AppState>();
        state.claude_cancellers.remove(&session_id);
        let total_ms = started_at.elapsed().as_millis();
        eprintln!(
            "[{}] sessionId={} totalMs={} exitCode={} cancelled={}",
            label,
            sid_wait,
            total_ms,
            code.map(|c| c.to_string()).unwrap_or_else(|| "?".into()),
            cancelled,
        );
        let _ = app_wait.emit(
            "claude:exit",
            ExitEvent {
                session_id: sid_wait,
                code,
                cancelled,
            },
        );
    });

    Ok(session_str)
}
