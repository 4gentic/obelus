use crate::commands::claude::resolve_claude_path;
use crate::commands::preflight;
use crate::commands::workspace::workspace_dir_for;
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

// Mirrors `appendExtra` in packages/prompts/src/formatters/format-spawn-invocation.ts.
// `base` already ends with `\n`; the extra `\n` before the body produces the
// blank line that separates the skill invocation from the supplementary context.
fn append_extra_prompt_body(mut base: String, extra: Option<&String>) -> String {
    if let Some(extra) = extra.filter(|s| !s.trim().is_empty()) {
        base.push('\n');
        base.push_str(extra);
        if !base.ends_with('\n') {
            base.push('\n');
        }
    }
    base
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
        let started_at_for_stdout = started_at;
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            let mut first_seen = false;
            while let Ok(Some(line)) = reader.next_line().await {
                if !first_seen {
                    first_seen = true;
                    eprintln!(
                        "[claude-session] sessionId={} firstStdoutMs={}",
                        sid,
                        started_at_for_stdout.elapsed().as_millis(),
                    );
                }
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

// Hard-coded model + effort for the dispatch / locate / minimal-diff-composition
// skills (apply-revision, plan-writer-fast, write-review, fix-compile). The
// in-code comments at each call site already classify these as "not reasoning"
// — Sonnet matches Opus quality at ~2× throughput, and `--effort high` produces
// 38K+ character single-turn thinking blocks (minutes of wall-clock) for work
// that doesn't reward extended thinking. Held hard-coded rather than
// user-overridable: footgun if exposed via Settings, and the user has no
// signal that would let them pick a better value than the workflow's author.
// Free-form `claude_ask` still respects the user's `claude.model` /
// `claude.effort` settings — that's reasoning territory, the user's call.
const DISPATCH_MODEL: Option<&str> = Some("sonnet");
const DISPATCH_EFFORT: Option<&str> = Some("low");

fn claude_command(
    claude: &Path,
    project_root: &Path,
    workspace_dir: &Path,
    model: Option<&str>,
    effort: Option<&str>,
) -> Command {
    let mut cmd = Command::new(claude);
    // Scope the CLI's world to the paper project. Without `current_dir`, the
    // child inherits the Tauri dev CWD (the Obelus worktree), and Glob/Grep
    // will happily walk our own source tree — adding minutes of wasted
    // exploration and leaking unrelated files into the model's context.
    //
    // `OBELUS_WORKSPACE_DIR` tells the plugin's skills where to write their
    // artifacts (plans, writeups, apply summaries, rendered previews). It
    // lives in app-data, not the user's repo, so the paper folder stays
    // pristine. The skills require this var to be set and refuse to run
    // without it — there is no `.obelus/` fallback that would otherwise
    // write into the user's paper repo.
    cmd.current_dir(project_root)
        .env("OBELUS_WORKSPACE_DIR", workspace_dir)
        .arg("--print")
        .arg("--output-format")
        .arg("stream-json")
        .arg("--include-partial-messages")
        .arg("--verbose")
        .arg("--add-dir")
        .arg(project_root)
        .arg("--add-dir")
        .arg(workspace_dir)
        .arg("--allowedTools")
        .arg("Read")
        .arg("Glob")
        .arg("Grep")
        .arg("Write")
        .arg("Edit");
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
    project_id: String,
    bundle_workspace_rel_path: String,
    extra_prompt_body: Option<String>,
    model: Option<String>,
    effort: Option<String>,
    mode: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let claude = resolve_claude_path()
        .await
        .ok_or_else(|| AppError::ClaudeDetect("claude binary not found".into()))?;

    let root = project_root(&state, &root_id)?;
    let workspace = workspace_dir_for(&app, &project_id)?;
    tokio::fs::create_dir_all(&workspace).await.map_err(AppError::from)?;
    let bundle_abs = workspace.join(&bundle_workspace_rel_path);

    let plugin_dir: PathBuf = app
        .path()
        .resolve("plugin", tauri::path::BaseDirectory::Resource)
        .map_err(|e| AppError::Other(format!("plugin resource missing: {e}")))?;

    // `mode` switches the orchestrator: writer-fast routes to the one-turn
    // plan-writer-fast skill on Haiku (no subagent, no impact / coherence
    // sweeps); any other value (including `None` and the explicit `rigorous`)
    // falls through to apply-revision → plan-fix on Sonnet — the existing
    // structural-review path. The skill name picked here is the routing
    // decision; both skills emit the same OBELUS_WROTE marker so the desktop's
    // ingest path is identical for both.
    let writer_fast = matches!(mode.as_deref(), Some("writer-fast"));
    if let Some(other) = mode.as_deref() {
        if other != "writer-fast" && other != "rigorous" {
            eprintln!(
                "[claude-session] unknown mode {other:?}; falling through to apply-revision",
            );
        }
    }

    // `extra_prompt_body` is supplementary context (prior drafts, indications,
    // per-pass notes) appended after the skill invocation — never the whole
    // prompt. The invocation itself must always reach Claude, or the model has
    // no command to act on and exits without writing a plan. Mirrors
    // `formatSpawnInvocation` in
    // `packages/prompts/src/formatters/format-spawn-invocation.ts`; keep the
    // two in lockstep when either changes. The tool-policy clause exists for
    // apply-revision because Claude, when the paper source happens to be in
    // the working tree (e.g. a writer-mode MD paper), will otherwise
    // short-circuit the skill and use `Edit` on the source directly —
    // bypassing the plan-fix step the desktop needs a file from. plan-writer-fast
    // is a one-turn drafter that writes its plan via its own Write call inside
    // $OBELUS_WORKSPACE_DIR; it doesn't need the tool-policy hammer.
    let skill_name = if writer_fast {
        "plan-writer-fast"
    } else {
        "apply-revision"
    };
    let mut base = if writer_fast {
        // SKILL.md uses `$OBELUS_WORKSPACE_DIR` literally as the output prefix;
        // the model can't read env vars, so the caller has to surface the
        // absolute path in the prompt — the same pattern apply-revision uses.
        // The `/obelus:<skill>` form is the canonical Claude Code invocation
        // shape; the imperative "Run <skill>" works on Sonnet but Haiku treats
        // it as free-form prose and goes hunting for a binary by that name.
        //
        // The tool-policy clause mirrors plan-writer-fast's frontmatter
        // (`allowed-tools: Read Glob Write`) into the prompt because Sonnet
        // otherwise reaches for Bash to "verify" or "compute" things the
        // skill never asks for, blowing the one-turn budget. Saying it in
        // the prompt is defense-in-depth: if `--allowedTools` doesn't actually
        // gate Bash (the flag's parsing is uncertain), the model sees the
        // policy here and respects it.
        format!(
            "/obelus:{} {}\nTool policy: Read, Glob, Write only — no Bash, no Grep, no Edit. One turn: read the source windows the prelude lists, Write the .md and .json plans, end with `OBELUS_WROTE: $OBELUS_WORKSPACE_DIR/plan-<iso>.json` (workspace = {}).\n",
            skill_name,
            bundle_abs.display(),
            workspace.display(),
        )
    } else {
        format!(
            "/obelus:{} {}\nTool policy for this run: write only inside $OBELUS_WORKSPACE_DIR ({}). Do NOT use Edit, Write, or any tool that mutates a source file under the project working tree — the desktop UI applies plans. If you conclude the bundle's edits are already in the working tree, STILL invoke plan-fix with every block ambiguous:true and a reviewer note explaining the no-op; every run must end with `OBELUS_WROTE: $OBELUS_WORKSPACE_DIR/plan-<iso>.json`.\n",
            skill_name,
            bundle_abs.display(),
            workspace.display(),
        )
    };

    // The prelude carries pre-computed metadata the skill would otherwise
    // re-derive turn by turn (format, entrypoint, anchor histogram, source
    // windows, rubric presence). Both SKILL.md files trust it as ground
    // truth; missing prelude (corrupt bundle, etc.) falls back to the skill's
    // host-less validation path.
    let mode_kind = if writer_fast {
        preflight::Mode::WriterFast
    } else {
        preflight::Mode::Rigorous
    };
    if let Some(prelude) = preflight::build_prelude(&bundle_abs, &root, &plugin_dir, mode_kind) {
        base.push('\n');
        base.push_str(&prelude);
        if !base.ends_with('\n') {
            base.push('\n');
        }
    }

    let prompt = append_extra_prompt_body(base, extra_prompt_body.as_ref());

    // Sonnet + low effort, hard-coded — see DISPATCH_MODEL / DISPATCH_EFFORT
    // above. apply-revision + plan-fix are dispatch, location, and minimal-diff
    // composition; plan-writer-fast is a single-turn drafter. Neither benefits
    // from Opus or extended thinking — both just inflate wall-clock. The user's
    // `claude.model` / `claude.effort` settings are intentionally ignored on
    // this path; free-form `claude_ask` is where user picks land.
    let _ = model;
    let _ = effort;
    let mut cmd =
        claude_command(&claude, &root, &workspace, DISPATCH_MODEL, DISPATCH_EFFORT);
    cmd.arg("--plugin-dir").arg(&plugin_dir);

    spawn_streaming(cmd, prompt, app, &state).await
}

#[tauri::command]
pub async fn claude_draft_writeup(
    root_id: String,
    project_id: String,
    bundle_workspace_rel_path: String,
    paper_id: String,
    paper_title: String,
    rubric_workspace_rel_path: Option<String>,
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
    let workspace = workspace_dir_for(&app, &project_id)?;
    tokio::fs::create_dir_all(&workspace).await.map_err(AppError::from)?;
    let bundle_abs = workspace.join(&bundle_workspace_rel_path);

    let plugin_dir: PathBuf = app
        .path()
        .resolve("plugin", tauri::path::BaseDirectory::Resource)
        .map_err(|e| AppError::Other(format!("plugin resource missing: {e}")))?;

    // `extra_prompt_body` is supplementary context appended after the skill
    // invocation; see `claude_spawn` for the rationale. Mirrors
    // `formatSpawnInvocation({ kind: "write-review", … })` in
    // `packages/prompts/src/formatters/format-spawn-invocation.ts`.
    let mut base = format!(
        "/obelus:write-review {} --out\npaperId: {}\npaperTitle: {}\n",
        bundle_abs.display(),
        paper_id,
        paper_title,
    );
    if let Some(rubric_rel) = rubric_workspace_rel_path.as_ref().filter(|s| !s.trim().is_empty()) {
        let rubric_abs = workspace.join(rubric_rel);
        base.push_str(&format!("rubricPath: {}\n", rubric_abs.display()));
    }
    let prompt = append_extra_prompt_body(base, extra_prompt_body.as_ref());

    // write-review is composition (500–1500 words of reviewer voice), not
    // reasoning. Hard-coded Sonnet + low effort — see DISPATCH_MODEL /
    // DISPATCH_EFFORT above.
    let _ = model;
    let _ = effort;
    let mut cmd =
        claude_command(&claude, &root, &workspace, DISPATCH_MODEL, DISPATCH_EFFORT);
    cmd.arg("--plugin-dir").arg(&plugin_dir);

    spawn_streaming(cmd, prompt, app, &state).await
}

#[tauri::command]
pub async fn claude_fix_compile(
    root_id: String,
    project_id: String,
    bundle_workspace_rel_path: String,
    paper_id: String,
    model: Option<String>,
    effort: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let claude = resolve_claude_path()
        .await
        .ok_or_else(|| AppError::ClaudeDetect("claude binary not found".into()))?;

    let root = project_root(&state, &root_id)?;
    let workspace = workspace_dir_for(&app, &project_id)?;
    tokio::fs::create_dir_all(&workspace).await.map_err(AppError::from)?;
    let bundle_abs = workspace.join(&bundle_workspace_rel_path);

    let plugin_dir: PathBuf = app
        .path()
        .resolve("plugin", tauri::path::BaseDirectory::Resource)
        .map_err(|e| AppError::Other(format!("plugin resource missing: {e}")))?;

    // Mirrors `formatSpawnInvocation({ kind: "fix-compile", … })` in
    // `packages/prompts/src/formatters/format-spawn-invocation.ts`; keep the
    // two in lockstep when either changes.
    let prompt = format!(
        "/obelus:fix-compile {}\npaperId: {}\n",
        bundle_abs.display(),
        paper_id,
    );

    // fix-compile is dispatch and minimal-diff edit composition — not
    // reasoning. Hard-coded Sonnet + low effort — see DISPATCH_MODEL /
    // DISPATCH_EFFORT above.
    let _ = model;
    let _ = effort;
    let mut cmd =
        claude_command(&claude, &root, &workspace, DISPATCH_MODEL, DISPATCH_EFFORT);
    cmd.arg("--plugin-dir").arg(&plugin_dir);

    spawn_streaming(cmd, prompt, app, &state).await
}

#[tauri::command]
pub async fn claude_ask(
    root_id: String,
    project_id: String,
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
    let workspace = workspace_dir_for(&app, &project_id)?;
    tokio::fs::create_dir_all(&workspace).await.map_err(AppError::from)?;
    let body = if prompt_body.ends_with('\n') {
        prompt_body
    } else {
        let mut s = prompt_body;
        s.push('\n');
        s
    };
    let cmd = claude_command(&claude, &root, &workspace, model.as_deref(), effort.as_deref());
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

// Mirror a frontend-tagged log line to Rust stderr. The desktop's `[write-perf]`,
// `[review-timing]`, `[phase]`, and similar bracketed `console.info` calls live
// in the WebView's devtools and are invisible to a `pnpm dev:desktop 2>&1 | tee
// …` capture. This command lets the WebView forward those lines so a single
// stderr capture has both the Rust subprocess wall-clock (`[claude-session]`)
// and the JS-side phase / ingest / spawn timings together. Fire-and-forget on
// the WebView side; failures here must not block UI work, so we accept the
// line and `eprintln!` it directly.
#[tauri::command]
pub fn perf_log(line: String) {
    eprintln!("{}", line);
}

// Whether a previously spawned Claude subprocess is still running. The Rust
// process outlives a WebView refresh; on writer-mode mount we use this to
// decide whether to reattach to an in-flight review or mark its row as failed.
#[tauri::command]
pub async fn claude_is_alive(
    session_id: String,
    state: State<'_, AppState>,
) -> AppResult<bool> {
    let id = Uuid::parse_str(&session_id)
        .map_err(|_| AppError::Other(format!("invalid session id: {session_id}")))?;
    Ok(state.claude_cancellers.contains_key(&id))
}
