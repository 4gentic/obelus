use crate::commands::claude::resolve_claude_path;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::oneshot;
use uuid::Uuid;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StreamEvent {
    session_id: String,
    line: String,
    ts: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ExitEvent {
    session_id: String,
    code: Option<i32>,
    cancelled: bool,
}

fn now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    format!("{}ms", ms)
}

fn project_root(state: &AppState, root_id: &str) -> AppResult<PathBuf> {
    let id = Uuid::parse_str(root_id).map_err(|_| AppError::UnknownRootId)?;
    state
        .allowed_roots
        .get(&id)
        .map(|r| r.clone())
        .ok_or(AppError::UnknownRootId)
}

async fn spawn_streaming(
    mut cmd: Command,
    prompt: String,
    app: AppHandle,
    state: &AppState,
) -> AppResult<String> {
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = cmd.spawn().map_err(AppError::from)?;
    let session_id = Uuid::new_v4();
    let session_str = session_id.to_string();

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(prompt.as_bytes())
            .await
            .map_err(AppError::from)?;
        stdin.flush().await.ok();
        drop(stdin);
    }

    if let Some(stdout) = child.stdout.take() {
        let app_clone = app.clone();
        let sid = session_str.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let _ = app_clone.emit(
                    "claude:stdout",
                    StreamEvent {
                        session_id: sid.clone(),
                        line,
                        ts: now_iso(),
                    },
                );
            }
        });
    }

    if let Some(stderr) = child.stderr.take() {
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
                        ts: now_iso(),
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

fn claude_command(
    claude: &Path,
    project_root: &Path,
    model: Option<&str>,
    effort: Option<&str>,
) -> Command {
    let mut cmd = Command::new(claude);
    cmd.arg("--print")
        .arg("--output-format")
        .arg("stream-json")
        .arg("--include-partial-messages")
        .arg("--verbose")
        .arg("--add-dir")
        .arg(project_root)
        .arg("--allowedTools")
        .arg("Read")
        .arg("Glob")
        .arg("Grep")
        .arg("Write");
    if let Some(m) = model.filter(|s| !s.is_empty()) {
        cmd.arg("--model").arg(m);
    }
    if let Some(e) = effort.filter(|s| !s.is_empty()) {
        cmd.arg("--effort").arg(e);
    }
    cmd
}

#[tauri::command]
pub async fn claude_spawn(
    root_id: String,
    bundle_rel_path: String,
    extra_prompt_body: Option<String>,
    model: Option<String>,
    effort: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let claude = resolve_claude_path()
        .await
        .ok_or_else(|| AppError::ClaudeDetect("claude binary not found".into()))?;

    let root = project_root(&state, &root_id)?;
    let bundle_abs = root.join(&bundle_rel_path);

    let plugin_dir: PathBuf = app
        .path()
        .resolve("plugin", tauri::path::BaseDirectory::Resource)
        .map_err(|e| AppError::Other(format!("plugin resource missing: {e}")))?;

    let mut prompt = format!(
        "Run apply-revision with bundle path {}.\n",
        bundle_abs.display()
    );
    if let Some(extra) = extra_prompt_body.as_ref().filter(|s| !s.trim().is_empty()) {
        prompt.push('\n');
        prompt.push_str(extra);
        if !extra.ends_with('\n') {
            prompt.push('\n');
        }
    }

    let mut cmd = claude_command(&claude, &root, model.as_deref(), effort.as_deref());
    cmd.arg("--plugin-dir").arg(&plugin_dir);

    spawn_streaming(cmd, prompt, app, &state).await
}

#[tauri::command]
pub async fn claude_draft_writeup(
    root_id: String,
    bundle_rel_path: String,
    paper_id: String,
    paper_title: String,
    rubric_rel_path: Option<String>,
    model: Option<String>,
    effort: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let claude = resolve_claude_path()
        .await
        .ok_or_else(|| AppError::ClaudeDetect("claude binary not found".into()))?;

    let root = project_root(&state, &root_id)?;
    let bundle_abs = root.join(&bundle_rel_path);

    let plugin_dir: PathBuf = app
        .path()
        .resolve("plugin", tauri::path::BaseDirectory::Resource)
        .map_err(|e| AppError::Other(format!("plugin resource missing: {e}")))?;

    let mut prompt = format!(
        "Run write-review with bundle path {}. Target paperId: {}. Paper title: {}.\n\
         Emit markdown only. Use the default category\u{2192}section map.\n",
        bundle_abs.display(),
        paper_id,
        paper_title,
    );

    if let Some(rubric_rel) = rubric_rel_path.as_ref().filter(|s| !s.trim().is_empty()) {
        let rubric_abs = root.join(rubric_rel);
        prompt.push_str(&format!(
            "Rubric path: {}. Apply the rubric as framing for the review per the skill's \
             rubric-handling rules.\n",
            rubric_abs.display()
        ));
    }

    // write-review is composition (500–1500 words of reviewer voice), not
    // reasoning. Sonnet is the right tool here; Opus just doubles wall-clock
    // for output that reads the same. Explicit user picks still win.
    let effective_model = model.as_deref().or(Some("sonnet"));
    let mut cmd = claude_command(&claude, &root, effective_model, effort.as_deref());
    cmd.arg("--plugin-dir").arg(&plugin_dir);

    spawn_streaming(cmd, prompt, app, &state).await
}

#[tauri::command]
pub async fn claude_ask(
    root_id: String,
    prompt_body: String,
    model: Option<String>,
    effort: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let claude = resolve_claude_path()
        .await
        .ok_or_else(|| AppError::ClaudeDetect("claude binary not found".into()))?;

    let root = project_root(&state, &root_id)?;
    let body = if prompt_body.ends_with('\n') {
        prompt_body
    } else {
        let mut s = prompt_body;
        s.push('\n');
        s
    };
    let cmd = claude_command(&claude, &root, model.as_deref(), effort.as_deref());
    spawn_streaming(cmd, body, app, &state).await
}

#[tauri::command]
pub async fn claude_cancel(
    session_id: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let id = Uuid::parse_str(&session_id)
        .map_err(|_| AppError::Other(format!("invalid session id: {session_id}")))?;
    if let Some((_, tx)) = state.claude_cancellers.remove(&id) {
        let _ = tx.send(());
    }
    Ok(())
}
