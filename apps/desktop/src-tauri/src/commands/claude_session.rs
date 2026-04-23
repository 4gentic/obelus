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

    let started_at = std::time::Instant::now();
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
        // Belt-and-braces wall-clock log: the desktop frontend also emits
        // `[review-timing]` off the stream, but if that listener ever misses
        // an event the subprocess's own view is authoritative for total time.
        let total_ms = started_at.elapsed().as_millis();
        eprintln!(
            "[claude-session] sessionId={} totalMs={} exitCode={} cancelled={}",
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

    // When the React side supplies a fully-formed prompt via `extra_prompt_body`
    // (built by `formatSpawnInvocation` from `@obelus/prompts`), use it as the
    // whole prompt — that path is the canonical spec. Otherwise fall back to
    // the inline template, kept here only until every call site routes through
    // the prompts package; deferred per Step 2 of the prompt-consolidation plan.
    let prompt = match extra_prompt_body.as_ref().filter(|s| !s.trim().is_empty()) {
        Some(extra) => {
            if extra.ends_with('\n') {
                extra.clone()
            } else {
                format!("{}\n", extra)
            }
        }
        None => format!(
            "Run apply-revision with bundle path {}.\n",
            bundle_abs.display()
        ),
    };

    // apply-revision + plan-fix are dispatch, location, and minimal-diff
    // composition — not reasoning. Sonnet matches Opus quality at ~2×
    // throughput; falling back to Claude Code's global default (typically
    // Opus) was the single biggest contributor to 10-minute review runs on
    // paper-sized context. Explicit user picks still win.
    let effective_model = model.as_deref().or(Some("sonnet"));
    let mut cmd = claude_command(&claude, &root, effective_model, effort.as_deref());
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

    // When the React side supplies a fully-formed prompt via `extra_prompt_body`
    // (built by `formatSpawnInvocation` from `@obelus/prompts`), use it as the
    // whole prompt. Otherwise fall back to the inline template; same deferral
    // note as `claude_spawn`.
    let prompt = match extra_prompt_body.as_ref().filter(|s| !s.trim().is_empty()) {
        Some(extra) => {
            if extra.ends_with('\n') {
                extra.clone()
            } else {
                format!("{}\n", extra)
            }
        }
        None => {
            // Mirrors `formatSpawnInvocation({ kind: "write-review", … })` in
            // `packages/prompts/src/formatters/format-spawn-invocation.ts`. Keep
            // the two in lockstep when either changes; the SKILL is the smart
            // side, this is just the trigger.
            let mut prompt = format!(
                "Run write-review with bundle path {}.\npaperId: {}\npaperTitle: {}\n",
                bundle_abs.display(),
                paper_id,
                paper_title,
            );
            if let Some(rubric_rel) = rubric_rel_path.as_ref().filter(|s| !s.trim().is_empty()) {
                let rubric_abs = root.join(rubric_rel);
                prompt.push_str(&format!("rubricPath: {}\n", rubric_abs.display()));
            }
            prompt
        }
    };

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
