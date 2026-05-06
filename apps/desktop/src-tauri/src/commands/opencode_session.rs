use crate::commands::metrics;
use crate::commands::opencode::resolve_opencode_path;
use crate::commands::preflight;
use crate::commands::spawn_common::{append_extra_prompt_body, project_root, spawn_and_stream};
use crate::commands::workspace::workspace_dir_for;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};
use tokio::process::Command;

// OpenCode discovers skills under `.claude/skills/<name>/SKILL.md` relative
// to its working directory. The Tauri-resource `plugin/` ships the SKILL.md
// files; we materialise them inside the per-project workspace before the
// spawn and reference each SKILL.md by absolute path in the prompt — that
// avoids depending on OpenCode's CWD-relative discovery (which uses --dir =
// the user's paper root, not the workspace).
//
// Symlink on Unix; recursive copy on Windows. The workspace already lives in
// app-data, so a stale link from a prior run is harmless — `link_or_copy_dir`
// removes any existing target first.
async fn clear_existing(dst: &Path) -> AppResult<()> {
    let meta = match tokio::fs::symlink_metadata(dst).await {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(AppError::from(e)),
    };
    let ft = meta.file_type();
    if ft.is_dir() {
        tokio::fs::remove_dir_all(dst).await.map_err(AppError::from)?;
    } else {
        tokio::fs::remove_file(dst).await.map_err(AppError::from)?;
    }
    Ok(())
}

async fn link_or_copy_dir(src: &Path, dst: &Path) -> AppResult<()> {
    if tokio::fs::metadata(src).await.is_err() {
        return Err(AppError::Other(format!(
            "source missing: {}",
            src.display()
        )));
    }
    clear_existing(dst).await?;
    if let Some(parent) = dst.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(AppError::from)?;
    }
    #[cfg(unix)]
    {
        tokio::fs::symlink(src, dst).await.map_err(AppError::from)?;
    }
    #[cfg(windows)]
    {
        copy_dir_recursive(src, dst).await?;
    }
    Ok(())
}

#[cfg(windows)]
async fn copy_dir_recursive(src: &Path, dst: &Path) -> AppResult<()> {
    tokio::fs::create_dir_all(dst).await.map_err(AppError::from)?;
    let mut stack: Vec<(PathBuf, PathBuf)> = vec![(src.to_path_buf(), dst.to_path_buf())];
    while let Some((s, d)) = stack.pop() {
        let mut rd = tokio::fs::read_dir(&s).await.map_err(AppError::from)?;
        while let Some(entry) = rd.next_entry().await.map_err(AppError::from)? {
            let from = entry.path();
            let to = d.join(entry.file_name());
            let ft = entry.file_type().await.map_err(AppError::from)?;
            if ft.is_dir() {
                tokio::fs::create_dir_all(&to).await.map_err(AppError::from)?;
                stack.push((from, to));
            } else {
                tokio::fs::copy(&from, &to).await.map_err(AppError::from)?;
            }
        }
    }
    Ok(())
}

// Stages the bundled plugin's `skills/` tree into `<workspace>/.claude/skills/`
// so OpenCode can resolve each SKILL.md by absolute path. Per-project mutex
// serializes concurrent spawns into the same workspace — two spawns landing
// inside the `clear_existing → symlink` window would otherwise leave a
// half-staged tree for whichever spawn arrived second.
async fn stage_opencode_resources(
    plugin_dir: &Path,
    workspace: &Path,
    state: &AppState,
    project_id: &str,
) -> AppResult<()> {
    let lock = state.workspace_lock(project_id);
    let _guard = lock.lock().await;
    let skills_src = plugin_dir.join("skills");
    let skills_dst = workspace.join(".claude").join("skills");
    link_or_copy_dir(&skills_src, &skills_dst).await?;
    Ok(())
}

// `--dangerously-skip-permissions` is safe here: the spawn always sets CWD to
// the user's paper root, OBELUS_WORKSPACE_DIR to app-data, and the prompt
// instructs the agent to write only inside the workspace. No source files are
// reachable for unguarded mutation.
//
// `--model` is intentionally not passed: under OpenCode the model is the
// user's domain, configured via `opencode auth login` and `opencode.jsonc`.
// This avoids forcing an Anthropic dependency on users who run OpenCode
// against OpenAI/OpenRouter/Bedrock/Vertex.
//
// `--format json` makes OpenCode emit one NDJSON event per line on stdout
// (`step_start` / `tool_use` / `text` / `step_finish`). The desktop's stream
// listener parses these — without the flag, OpenCode prints a TTY-formatted
// transcript that yields no parseable phase events and the UI sits silent.
//
// `--print-logs --log-level INFO` enables stderr log lines. We only need a
// single one — `service=llm … small=false agent=build` — to learn which
// provider+model the session resolved to (the `--format json` stream itself
// never carries the model id). The cost is ~10–20 INFO lines on stderr that
// the listener already routes to console.debug; small price for surfacing
// "what model is actually running" in the dock.
fn build_opencode_command(opencode: &Path, project_root: &Path, workspace: &Path) -> Command {
    let mut cmd = Command::new(opencode);
    cmd.current_dir(project_root)
        .env("OBELUS_WORKSPACE_DIR", workspace)
        .arg("run")
        .arg("--dir")
        .arg(project_root)
        .arg("--format")
        .arg("json")
        .arg("--print-logs")
        .arg("--log-level")
        .arg("INFO")
        .arg("--dangerously-skip-permissions");
    cmd
}

// OpenCode shares the spawn polish with Claude Code: bundle pre-validation,
// prelude construction, metrics emission. The two diverge on argv shape
// (`opencode run ... <prompt>`) and how the skill is dispatched — Claude Code
// resolves `/obelus:<skill>` through its plugin loader, OpenCode reads the
// SKILL.md by absolute path under the workspace.
#[tauri::command]
pub async fn opencode_spawn(
    root_id: String,
    project_id: String,
    bundle_workspace_rel_path: String,
    extra_prompt_body: Option<String>,
    // `model` and `effort` are accepted for IPC parity with claude_spawn but
    // are not forwarded to OpenCode — its model is configured via
    // `opencode auth login` and `opencode.jsonc`. We log a one-line notice on
    // every spawn that received non-null values so the discard is visible in
    // `[opencode-session]` stderr; users on the Advanced disclosure can see
    // their selection is a no-op rather than silently taking no effect.
    model: Option<String>,
    effort: Option<String>,
    mode: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let opencode = resolve_opencode_path()
        .await
        .ok_or_else(|| AppError::Other("opencode binary not found".into()))?;

    let root = project_root(&state, &root_id)?;
    let workspace = workspace_dir_for(&app, &project_id)?;
    tokio::fs::create_dir_all(&workspace).await.map_err(AppError::from)?;
    let bundle_abs = workspace.join(&bundle_workspace_rel_path);

    let plugin_dir: PathBuf = app
        .path()
        .resolve("plugin", tauri::path::BaseDirectory::Resource)
        .map_err(|e| AppError::Other(format!("plugin resource missing: {e}")))?;

    stage_opencode_resources(&plugin_dir, &workspace, &state, &project_id).await?;

    if model.is_some() || effort.is_some() {
        eprintln!(
            "[opencode-session] ignoring model={:?} effort={:?} (configure via opencode.jsonc / opencode auth login)",
            model, effort,
        );
    }

    let writer_fast = matches!(mode.as_deref(), Some("writer-fast"));
    let deep_review = matches!(mode.as_deref(), Some("deep-review"));
    if let Some(other) = mode.as_deref() {
        if other != "writer-fast" && other != "rigorous" && other != "deep-review" {
            eprintln!(
                "[opencode-session] unknown mode {other:?}; falling through to apply-revision",
            );
        }
    }

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
                "[opencode-session] bundle validation failed bundle={} errors={:?}",
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

    let skill_name = if writer_fast {
        "plan-writer-fast"
    } else if deep_review {
        "deep-review"
    } else {
        "apply-revision"
    };

    let workspace_abs = workspace.display();
    let mut base = if writer_fast {
        format!(
            "Workspace (write all output here): {workspace_abs}\n\
             Run skill `{skill_name}` — read {workspace_abs}/.claude/skills/{skill_name}/SKILL.md and follow it on bundle {bundle}.\n\
             Tool policy: Read, Glob, Write only — no Bash, no Grep, no Edit. One turn: read the source windows the SKILL.md prelude lists, Write the .json plan, end with `OBELUS_WROTE: {workspace_abs}/plan-<iso>.json`.\n",
            workspace_abs = workspace_abs,
            skill_name = skill_name,
            bundle = bundle_abs.display(),
        )
    } else if deep_review {
        format!(
            "Workspace (write all output here): {workspace_abs}\n\
             Run skill `{skill_name}` — read {workspace_abs}/.claude/skills/{skill_name}/SKILL.md and follow it on plan {bundle}.\n\
             Tool policy: Read, Glob, Grep, Write only — no Edit, no Bash. Write only inside the workspace. End with `OBELUS_WROTE: {workspace_abs}/plan-<original-iso>-deep.json`.\n",
            workspace_abs = workspace_abs,
            skill_name = skill_name,
            bundle = bundle_abs.display(),
        )
    } else {
        // Mirrors the apply-revision prompt in `claude_session.rs` (the
        // rigorous else-branch). The "STILL invoke plan-fix" clause is
        // load-bearing: a model that decides edits are already in the working
        // tree must still emit a plan with every block `ambiguous: true` —
        // otherwise the desktop reports "no plan matched session bundle X".
        // The tool policy is split into two clauses to avoid the comma-list
        // misread ("Edit, Write" parsed as two banned tools); the skill needs
        // Write to land its plan inside the workspace.
        format!(
            "Workspace (write all output here): {workspace_abs}\n\
             Run skill `{skill_name}` — read {workspace_abs}/.claude/skills/{skill_name}/SKILL.md and follow it on bundle {bundle}.\n\
             Tool policy: write only inside the workspace. Do NOT use Edit on any source file, and do NOT use Write outside the workspace — the desktop UI applies plans. If you conclude the bundle's edits are already in the working tree, STILL invoke plan-fix with every block ambiguous:true and a reviewer note explaining the no-op; every run must end with `OBELUS_WROTE: {workspace_abs}/plan-<iso>.json`.\n",
            workspace_abs = workspace_abs,
            skill_name = skill_name,
            bundle = bundle_abs.display(),
        )
    };

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

    eprintln!(
        "[opencode-session] spawn rootId={} mode={:?} skill={} model=(default)",
        root_id, mode, skill_name,
    );

    let mut cmd = build_opencode_command(&opencode, &root, &workspace);
    cmd.arg(prompt);

    let session_id = spawn_and_stream(cmd, None, "opencode-session", app, &state).await?;

    let now = crate::commands::time::now_iso_millis();
    let validated_event = serde_json::json!({
        "event": "bundle-validated",
        "engine": "openCode",
        "at": now,
        "sessionId": session_id,
        "validationMs": validation_ms,
        "errorCount": 0,
    });
    metrics::append_event_bestoffer(&workspace, &session_id, &validated_event).await;

    if let Some((stats, timings)) = metrics_seed {
        let bundle_stats = serde_json::json!({
            "event": "bundle-stats",
            "engine": "openCode",
            "at": now,
            "sessionId": session_id,
            "annotations": stats.annotations,
            "anchorSource": stats.anchor_source,
            "anchorPdf": stats.anchor_pdf,
            "anchorHtml": stats.anchor_html,
            "papers": stats.papers,
            "files": stats.files,
            "bytes": stats.bytes,
            "model": "(default)",
            "effort": "(ignored)",
        });
        metrics::append_event_bestoffer(&workspace, &session_id, &bundle_stats).await;
        let preflight_event = serde_json::json!({
            "event": "preflight-rust",
            "engine": "openCode",
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
pub async fn opencode_ask(
    root_id: String,
    project_id: String,
    prompt_body: String,
    _model: Option<String>,
    _effort: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let opencode = resolve_opencode_path()
        .await
        .ok_or_else(|| AppError::Other("opencode binary not found".into()))?;

    let root = project_root(&state, &root_id)?;
    let workspace = workspace_dir_for(&app, &project_id)?;
    tokio::fs::create_dir_all(&workspace).await.map_err(AppError::from)?;

    let plugin_dir: PathBuf = app
        .path()
        .resolve("plugin", tauri::path::BaseDirectory::Resource)
        .map_err(|e| AppError::Other(format!("plugin resource missing: {e}")))?;
    stage_opencode_resources(&plugin_dir, &workspace, &state, &project_id).await?;

    let body = if prompt_body.ends_with('\n') {
        prompt_body
    } else {
        let mut s = prompt_body;
        s.push('\n');
        s
    };

    let mut cmd = build_opencode_command(&opencode, &root, &workspace);
    cmd.arg(body);
    spawn_and_stream(cmd, None, "opencode-session", app, &state).await
}

#[tauri::command]
pub async fn opencode_draft_writeup(
    root_id: String,
    project_id: String,
    bundle_workspace_rel_path: String,
    paper_id: String,
    paper_title: String,
    rubric_workspace_rel_path: Option<String>,
    extra_prompt_body: Option<String>,
    _model: Option<String>,
    _effort: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let opencode = resolve_opencode_path()
        .await
        .ok_or_else(|| AppError::Other("opencode binary not found".into()))?;

    let root = project_root(&state, &root_id)?;
    let workspace = workspace_dir_for(&app, &project_id)?;
    tokio::fs::create_dir_all(&workspace).await.map_err(AppError::from)?;
    let bundle_abs = workspace.join(&bundle_workspace_rel_path);

    let plugin_dir: PathBuf = app
        .path()
        .resolve("plugin", tauri::path::BaseDirectory::Resource)
        .map_err(|e| AppError::Other(format!("plugin resource missing: {e}")))?;
    stage_opencode_resources(&plugin_dir, &workspace, &state, &project_id).await?;

    // The `--out` flag is a positional argument the write-review skill parses
    // out of its input (see `write-review/SKILL.md`'s arg grammar). Narrating
    // it as English ("with --out") would let the skill default to inline
    // mode and emit the letter into the transcript with no `OBELUS_WROTE:`
    // marker — desktop never sees the file. Pass it as part of the input.
    let workspace_abs = workspace.display();
    let mut base = format!(
        "Workspace (write all output here): {workspace_abs}\n\
         Run skill `write-review` — read {workspace_abs}/.claude/skills/write-review/SKILL.md and follow it on input `{bundle} --out`.\n\
         Out-of-band mode: write the reviewer letter as `writeup-{paper_id}-<iso>.md` inside the workspace; the final stdout line must be `OBELUS_WROTE: <absolute-path-to-that-file>`. Do not stream the letter inline.\n\
         paperId: {paper_id}\n\
         paperTitle: {paper_title}\n",
        workspace_abs = workspace_abs,
        bundle = bundle_abs.display(),
        paper_id = paper_id,
        paper_title = paper_title,
    );
    if let Some(rubric_rel) = rubric_workspace_rel_path.as_ref().filter(|s| !s.trim().is_empty()) {
        let rubric_abs = workspace.join(rubric_rel);
        base.push_str(&format!("rubricPath: {}\n", rubric_abs.display()));
    }
    let prompt = append_extra_prompt_body(base, extra_prompt_body.as_ref());

    let mut cmd = build_opencode_command(&opencode, &root, &workspace);
    cmd.arg(prompt);
    spawn_and_stream(cmd, None, "opencode-session", app, &state).await
}

#[tauri::command]
pub async fn opencode_fix_compile(
    root_id: String,
    project_id: String,
    bundle_workspace_rel_path: String,
    paper_id: String,
    _model: Option<String>,
    _effort: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let opencode = resolve_opencode_path()
        .await
        .ok_or_else(|| AppError::Other("opencode binary not found".into()))?;

    let root = project_root(&state, &root_id)?;
    let workspace = workspace_dir_for(&app, &project_id)?;
    tokio::fs::create_dir_all(&workspace).await.map_err(AppError::from)?;
    let bundle_abs = workspace.join(&bundle_workspace_rel_path);

    let plugin_dir: PathBuf = app
        .path()
        .resolve("plugin", tauri::path::BaseDirectory::Resource)
        .map_err(|e| AppError::Other(format!("plugin resource missing: {e}")))?;
    stage_opencode_resources(&plugin_dir, &workspace, &state, &project_id).await?;

    let workspace_abs = workspace.display();
    let prompt = format!(
        "Workspace (write all output here): {workspace_abs}\n\
         Run skill `fix-compile` — read {workspace_abs}/.claude/skills/fix-compile/SKILL.md and follow it on compile-error bundle {bundle}.\n\
         paperId: {paper_id}\n\
         Write only inside the workspace; end with `OBELUS_WROTE: {workspace_abs}/plan-<iso>.json`.\n",
        workspace_abs = workspace_abs,
        bundle = bundle_abs.display(),
        paper_id = paper_id,
    );

    let mut cmd = build_opencode_command(&opencode, &root, &workspace);
    cmd.arg(prompt);
    spawn_and_stream(cmd, None, "opencode-session", app, &state).await
}
