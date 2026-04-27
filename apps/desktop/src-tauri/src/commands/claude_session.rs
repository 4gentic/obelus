use crate::commands::claude::resolve_claude_path;
use crate::commands::metrics;
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

// Default model + effort for the dispatch / locate / minimal-diff-composition
// skills (apply-revision, plan-writer-fast, write-review, fix-compile). The
// in-code comments at each call site already classify these as "not reasoning"
// — Sonnet matches Opus quality at ~2× throughput, and `--effort high` produces
// 38K+ character single-turn thinking blocks (minutes of wall-clock) for work
// that doesn't reward extended thinking. The user can override both via the
// "Advanced" disclosure on the start-review panel; without an override these
// defaults apply.
const DEFAULT_DISPATCH_MODEL: &str = "sonnet";
const DEFAULT_DISPATCH_EFFORT: &str = "low";

const ALLOWED_MODELS: &[&str] = &["sonnet", "opus", "haiku"];
const ALLOWED_EFFORTS: &[&str] = &["low", "medium", "high", "xhigh", "max"];

fn validate_model(value: Option<&str>) -> AppResult<&str> {
    let v = value.unwrap_or(DEFAULT_DISPATCH_MODEL);
    if ALLOWED_MODELS.contains(&v) {
        Ok(v)
    } else {
        Err(AppError::Other(format!(
            "invalid model {v:?}; allowed: {}",
            ALLOWED_MODELS.join(", ")
        )))
    }
}

fn validate_effort(value: Option<&str>) -> AppResult<&str> {
    let v = value.unwrap_or(DEFAULT_DISPATCH_EFFORT);
    if ALLOWED_EFFORTS.contains(&v) {
        Ok(v)
    } else {
        Err(AppError::Other(format!(
            "invalid effort {v:?}; allowed: {}",
            ALLOWED_EFFORTS.join(", ")
        )))
    }
}

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
    // For "writer-fast" / "rigorous", this is the workspace-relative path to
    // the bundle JSON. For "deep-review", it is the workspace-relative path to
    // an already-written `plan-<iso>.json` the deep-review skill should read.
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

    // `mode` switches the orchestrator. writer-fast → one-turn plan-writer-fast
    // skill on Haiku (no subagent, no impact / coherence sweeps). deep-review →
    // the user-invocable deep-review skill, which reads an already-written
    // rigorous plan and emits additional `quality-*` blocks. Anything else
    // (including `None` and the explicit `rigorous`) falls through to
    // apply-revision → plan-fix on Sonnet — the existing structural-review
    // path. All three skills emit the same OBELUS_WROTE marker so the
    // desktop's ingest path is identical.
    let writer_fast = matches!(mode.as_deref(), Some("writer-fast"));
    let deep_review = matches!(mode.as_deref(), Some("deep-review"));
    if let Some(other) = mode.as_deref() {
        if other != "writer-fast" && other != "rigorous" && other != "deep-review" {
            eprintln!(
                "[claude-session] unknown mode {other:?}; falling through to apply-revision",
            );
        }
    }

    // Schema-validate the bundle before doing any other work — but only when
    // the workspace path actually points at a bundle. For deep-review the path
    // is a plan JSON, not a bundle, and validating it against the bundle
    // schema would error out a perfectly valid invocation.
    let validation_ms: u128 = if deep_review {
        0
    } else {
        let validation_started = std::time::Instant::now();
        let bundle_value: serde_json::Value = match tokio::fs::read(&bundle_abs).await {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| {
                AppError::Other(format!("bundle parse failed at {}: {e}", bundle_abs.display()))
            })?,
            Err(e) => {
                return Err(AppError::Other(format!(
                    "bundle read failed at {}: {e}",
                    bundle_abs.display()
                )));
            }
        };
        if let Err(errors) = preflight::validate_bundle_against_schema(&bundle_value, &plugin_dir) {
            eprintln!(
                "[claude-session] bundle validation failed bundle={} errors={:?}",
                bundle_abs.display(),
                errors,
            );
            return Err(AppError::Other(format!(
                "bundle does not match schema: {}",
                errors.join("; ")
            )));
        }
        validation_started.elapsed().as_millis()
    };

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
    } else if deep_review {
        "deep-review"
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
            "/obelus:{} {}\nTool policy: Read, Glob, Write only — no Bash, no Grep, no Edit. One turn: read the source windows the prelude lists, Write the .json plan (the desktop projects the sibling .md), end with `OBELUS_WROTE: $OBELUS_WORKSPACE_DIR/plan-<iso>.json` (workspace = {}).\n",
            skill_name,
            bundle_abs.display(),
            workspace.display(),
        )
    } else if deep_review {
        // deep-review takes a plan path, not a bundle path, and writes a sibling
        // `plan-<original-iso>-deep.json` under the same workspace. Its
        // frontmatter allows Read / Glob / Grep / Write only — Edit is off, the
        // skill never mutates source. The Rust-side prelude is bundle-shaped
        // (anchor histograms, locator windows, whole-paper read list), so we
        // skip it here; the deep-review skill reads the original plan + the
        // bundle the plan points at on its own.
        format!(
            "/obelus:{} {}\nTool policy for this run: Read, Glob, Grep, Write only — no Edit, no Bash. Write only inside $OBELUS_WORKSPACE_DIR ({}). The skill must end with `OBELUS_WROTE: $OBELUS_WORKSPACE_DIR/plan-<original-iso>-deep.json`.\n",
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
    // windows, rubric presence). Both bundle-shaped SKILL.md files trust it as
    // ground truth; missing prelude (corrupt bundle, etc.) falls back to the
    // skill's host-less validation path. deep-review takes a plan, not a
    // bundle, so the bundle-shaped prelude does not apply — the skill reads
    // the original plan and the bundle it references itself.
    let metrics_seed: Option<(preflight::BundleStats, preflight::PreludeTimings)> = if deep_review {
        None
    } else {
        let mode_kind = if writer_fast {
            preflight::Mode::WriterFast
        } else {
            preflight::Mode::Rigorous
        };
        match preflight::build_prelude_with_metrics(&bundle_abs, &root, &plugin_dir, mode_kind) {
            Some((prelude, stats, timings)) => {
                base.push('\n');
                base.push_str(&prelude);
                if !base.ends_with('\n') {
                    base.push('\n');
                }
                Some((stats, timings))
            }
            None => None,
        }
    };

    let prompt = append_extra_prompt_body(base, extra_prompt_body.as_ref());

    // The dispatch / locate / minimal-diff-composition skills default to
    // sonnet/low (see DEFAULT_DISPATCH_*). The Advanced disclosure on the
    // start-review panel can override either; the values arrive here through
    // the Tauri boundary and are validated against the allow-list.
    let effective_model = validate_model(model.as_deref())?;
    let effective_effort = validate_effort(effort.as_deref())?;
    eprintln!(
        "[claude-session] spawn-model rootId={} requested={:?} effective={:?}/{:?} mode={:?}",
        root_id,
        model,
        effective_model,
        effective_effort,
        mode,
    );
    let mut cmd = claude_command(
        &claude,
        &root,
        &workspace,
        Some(effective_model),
        Some(effective_effort),
    );
    cmd.arg("--plugin-dir").arg(&plugin_dir);

    let session_id = spawn_streaming(cmd, prompt, app, &state).await?;

    let now = metrics::now_iso();
    let validated_event = serde_json::json!({
        "event": "bundle-validated",
        "at": now,
        "sessionId": session_id,
        "validationMs": validation_ms,
        "errorCount": 0,
    });
    metrics::append_event_bestoffer(&workspace, &session_id, &validated_event).await;

    if let Some((stats, timings)) = metrics_seed {
        let bundle_stats = serde_json::json!({
            "event": "bundle-stats",
            "at": now,
            "sessionId": session_id,
            "annotations": stats.annotations,
            "anchorSource": stats.anchor_source,
            "anchorPdf": stats.anchor_pdf,
            "anchorHtml": stats.anchor_html,
            "papers": stats.papers,
            "files": stats.files,
            "bytes": stats.bytes,
            "model": effective_model,
            "effort": effective_effort,
        });
        metrics::append_event_bestoffer(&workspace, &session_id, &bundle_stats).await;
        let preflight_event = serde_json::json!({
            "event": "preflight-rust",
            "at": now,
            "sessionId": session_id,
            "preludeMs": timings.prelude_ms,
            "sha256Ms": timings.sha256_ms,
            "totalMs": timings.total_ms,
        });
        metrics::append_event_bestoffer(&workspace, &session_id, &preflight_event).await;
    }

    Ok(session_id)
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

    // write-review is composition (500–1500 words of reviewer voice). The
    // user-facing Advanced picker on the start-review panel feeds through
    // here too; defaults sit at sonnet/low when nothing was selected.
    let effective_model = validate_model(model.as_deref())?;
    let effective_effort = validate_effort(effort.as_deref())?;
    let mut cmd = claude_command(
        &claude,
        &root,
        &workspace,
        Some(effective_model),
        Some(effective_effort),
    );
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

    // fix-compile is dispatch and minimal-diff edit composition. Same picker
    // as claude_spawn / claude_draft_writeup; defaults to sonnet/low.
    let effective_model = validate_model(model.as_deref())?;
    let effective_effort = validate_effort(effort.as_deref())?;
    let mut cmd = claude_command(
        &claude,
        &root,
        &workspace,
        Some(effective_model),
        Some(effective_effort),
    );
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
