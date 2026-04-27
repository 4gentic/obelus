// Stages all new bytes in memory before any disk write. Backups precede source
// writes so the backup dir is always complete when a source write starts. On IO
// failure after one or more sources have been promoted, the function restores
// from backup in-order before returning the error.

use crate::commands::fs_scoped::{atomic_write, resolve_for_write};
use crate::commands::metrics;
use crate::commands::workspace::workspace_dir_for;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, State};

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HunkInput {
    pub file: String,
    pub patch: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ApplyReport {
    pub files_written: usize,
    pub hunks_applied: usize,
    pub hunks_failed: Vec<HunkFailure>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HunkFailure {
    pub file: String,
    // 1-based to match the existing "hunk #N" idiom in error messages.
    pub index: usize,
    pub reason: String,
}

struct StagedFile {
    rel_path: String,
    abs_path: PathBuf,
    orig_bytes: Vec<u8>,
    new_bytes: Vec<u8>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ManifestFile {
    rel: String,
    sha256_before: String,
    sha256_after: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    session_id: String,
    applied_at: String,
    files: Vec<ManifestFile>,
}

#[tauri::command]
pub async fn apply_hunks(
    app: AppHandle,
    root_id: String,
    project_id: String,
    session_id: String,
    hunks: Vec<HunkInput>,
    state: State<'_, AppState>,
) -> AppResult<ApplyReport> {
    let started = Instant::now();
    let result = apply_hunks_inner(&app, &root_id, &project_id, &session_id, hunks, &state).await;
    // WS3 boundary log: even on Err we want a row, so the metrics tally
    // matches the user-visible "tried to apply N" experience.
    let workspace = workspace_dir_for(&app, &project_id).ok();
    if let Some(workspace) = workspace.as_ref() {
        let total_ms = started.elapsed().as_millis();
        let (applied, failed) = match result.as_ref() {
            Ok(r) => (r.hunks_applied, r.hunks_failed.len()),
            Err(_) => (0, 0),
        };
        let payload = serde_json::json!({
            "event": "apply",
            "at": metrics::now_iso(),
            "sessionId": session_id,
            "blocksApplied": applied,
            "blocksFailed": failed,
            "totalMs": total_ms,
            "ok": result.is_ok(),
        });
        metrics::append_event_bestoffer(workspace, &session_id, &payload).await;
    }
    result
}

async fn apply_hunks_inner(
    app: &AppHandle,
    root_id: &str,
    project_id: &str,
    session_id: &str,
    hunks: Vec<HunkInput>,
    state: &State<'_, AppState>,
) -> AppResult<ApplyReport> {
    let lock = state.root_lock(root_id);
    let _guard = lock.lock().await;
    let backup_root = workspace_dir_for(app, project_id)?
        .join("backup")
        .join(session_id);

    let mut grouped: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for h in hunks {
        grouped.entry(h.file).or_default().push(h.patch);
    }

    let mut staged: Vec<StagedFile> = Vec::with_capacity(grouped.len());
    let mut total_hunks: usize = 0;
    let mut failures: Vec<HunkFailure> = Vec::new();

    for (rel_path, patches) in grouped {
        let abs_path = resolve_for_write(root_id, &rel_path, state).await?;
        let current = tokio::fs::read(&abs_path).await.map_err(AppError::from)?;

        let outcome = apply_patches_to_bytes(&current, &patches, &rel_path);

        // Files where every hunk failed must not change on disk: no backup,
        // no write, no manifest entry. A file with at least one success gets
        // staged with the bytes reached after applying the successful hunks
        // in order.
        failures.extend(outcome.failures);
        if outcome.applied == 0 {
            continue;
        }
        total_hunks += outcome.applied;
        staged.push(StagedFile {
            rel_path,
            abs_path,
            orig_bytes: current,
            new_bytes: outcome.working,
        });
    }

    // Every hunk failed: no disk writes, no backup, no manifest. The caller
    // still needs the per-hunk failure list to surface in the UI.
    if staged.is_empty() {
        return Ok(ApplyReport {
            files_written: 0,
            hunks_applied: 0,
            hunks_failed: failures,
        });
    }

    let mut written: Vec<(PathBuf, Vec<u8>)> = Vec::with_capacity(staged.len());
    let mut manifest_files: Vec<ManifestFile> = Vec::with_capacity(staged.len());

    for sf in &staged {
        let backup_abs = backup_root.join(&sf.rel_path);
        if let Some(parent) = backup_abs.parent() {
            if let Err(e) = tokio::fs::create_dir_all(parent).await {
                rollback(&written).await;
                return Err(AppError::from(e));
            }
        }
        if let Err(e) = atomic_write(&backup_abs, &sf.orig_bytes).await {
            rollback(&written).await;
            return Err(e);
        }

        if let Err(e) = atomic_write(&sf.abs_path, &sf.new_bytes).await {
            rollback(&written).await;
            return Err(e);
        }
        written.push((sf.abs_path.clone(), sf.orig_bytes.clone()));

        manifest_files.push(ManifestFile {
            rel: sf.rel_path.clone(),
            sha256_before: sha256_hex(&sf.orig_bytes),
            sha256_after: sha256_hex(&sf.new_bytes),
        });
    }

    let files_written = staged.len();
    let manifest = Manifest {
        session_id: session_id.to_owned(),
        applied_at: iso8601_utc_now(),
        files: manifest_files,
    };
    let manifest_bytes = serde_json::to_vec_pretty(&manifest)
        .map_err(|e| AppError::Apply(format!("manifest: {e}")))?;
    let manifest_abs = backup_root.join(".manifest.json");
    if let Err(e) = atomic_write(&manifest_abs, &manifest_bytes).await {
        rollback(&written).await;
        return Err(e);
    }

    Ok(ApplyReport {
        files_written,
        hunks_applied: total_hunks,
        hunks_failed: failures,
    })
}

async fn rollback(written: &[(PathBuf, Vec<u8>)]) {
    for (abs, orig) in written {
        let _ = atomic_write(abs, orig).await;
    }
}

struct PatchOutcome {
    working: Vec<u8>,
    applied: usize,
    failures: Vec<HunkFailure>,
}

// Per-file hunk application. Applies each patch in order; on failure, records
// a `HunkFailure` and continues against the current working bytes (successes
// compound, failures don't). Extracted so the partial-apply semantics can be
// exercised without the Tauri filesystem harness.
fn apply_patches_to_bytes(current: &[u8], patches: &[String], rel_path: &str) -> PatchOutcome {
    let mut working = current.to_vec();
    let mut applied: usize = 0;
    let mut failures: Vec<HunkFailure> = Vec::new();

    for (idx, patch_text) in patches.iter().enumerate() {
        let normalized = ensure_trailing_newline(patch_text);
        let patch = match diffy::Patch::from_bytes(normalized.as_bytes()) {
            Ok(p) => p,
            Err(e) => {
                failures.push(HunkFailure {
                    file: rel_path.to_owned(),
                    index: idx + 1,
                    reason: format!("parse: {e}"),
                });
                continue;
            }
        };
        match diffy::apply_bytes(&working, &patch) {
            Ok(next) => {
                working = next;
                applied += 1;
            }
            Err(primary) => {
                // plan-fix also emits body lines shaped `-<space><content>`
                // and `+<space><content>` — a decorative separator absent
                // from canonical unified diff. diffy treats that space as
                // part of the content, so every hunk's context check fails
                // against the actual file bytes. Retry with the space
                // stripped on `-`/`+` lines only; context (` …`) lines are
                // left alone because the leading space is their operator.
                let stripped = strip_op_separator_space(normalized.as_ref());
                let retry = diffy::Patch::from_bytes(stripped.as_bytes())
                    .ok()
                    .and_then(|p| diffy::apply_bytes(&working, &p).ok());
                match retry {
                    Some(next) => {
                        working = next;
                        applied += 1;
                    }
                    None => {
                        // Surface the ORIGINAL error — the as-written form
                        // is what the reviewer emitted, so the real mismatch
                        // lives there. The retry is a silent recovery path.
                        failures.push(HunkFailure {
                            file: rel_path.to_owned(),
                            index: idx + 1,
                            reason: primary.to_string(),
                        });
                    }
                }
            }
        }
    }

    PatchOutcome {
        working,
        applied,
        failures,
    }
}

// Ensure the patch ends with exactly one `\n`. Unified-diff parsers treat a
// missing terminator as `\ No newline at end of file`, which means the inserted
// bytes run into the following source line — and for context-terminated hunks,
// the parser rejects the apply outright.
fn ensure_trailing_newline(patch: &str) -> std::borrow::Cow<'_, str> {
    if patch.is_empty() || patch.ends_with('\n') {
        std::borrow::Cow::Borrowed(patch)
    } else {
        std::borrow::Cow::Owned(format!("{patch}\n"))
    }
}

// plan-fix's documented patch shape is `-<space><before>\n+<space><after>\n`,
// using the space as a decorative operator/content separator. Canonical
// unified diff has no such separator — the op is a single char and the rest
// of the line is content. diffy is strict, so it treats that space as part
// of the removed/added content and the context check fails against the file.
//
// Strip exactly one space immediately following a `-` or `+` at the start of
// a body line. Leave ` ` (context) lines alone: the leading space IS their
// operator, and stripping it would erase the marker. Leave header lines
// (`@@ …`, `--- `, `+++ `) alone — they start with `@` or the first char
// after `-`/`+` is another `-`/`+`, not a space, so the rule doesn't fire.
fn strip_op_separator_space(patch: &str) -> String {
    let mut out = String::with_capacity(patch.len());
    for (idx, line) in patch.split_inclusive('\n').enumerate() {
        // The first line is always the hunk header `@@ -X,N +Y,M @@` which
        // contains a ` ` between the ranges; skip it to avoid mangling.
        if idx == 0 || line.starts_with("@@") {
            out.push_str(line);
            continue;
        }
        let bytes = line.as_bytes();
        if bytes.len() >= 2 && (bytes[0] == b'-' || bytes[0] == b'+') && bytes[1] == b' ' {
            out.push(bytes[0] as char);
            out.push_str(&line[2..]);
        } else {
            out.push_str(line);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{apply_patches_to_bytes, ensure_trailing_newline, strip_op_separator_space};

    #[test]
    fn leaves_well_formed_patches_alone() {
        let p = "@@ -1 +1 @@\n-foo\n+bar\n";
        assert!(matches!(ensure_trailing_newline(p), std::borrow::Cow::Borrowed(_)));
    }

    #[test]
    fn appends_newline_when_missing() {
        let p = "@@ -1 +1 @@\n-foo\n+bar";
        let out = ensure_trailing_newline(p);
        assert!(out.ends_with('\n'));
        assert_eq!(out.as_ref(), "@@ -1 +1 @@\n-foo\n+bar\n");
    }

    #[test]
    fn context_terminated_patch_applies_after_normalization() {
        // The abstract-patch shape from plan-fix: last body line is context.
        // Without normalization, diffy rejects hunk #1. With it, the apply
        // succeeds.
        let source = "#par[\n  original line.\n]\n";
        let malformed = "@@ -1,3 +1,3 @@\n #par[\n-  original line.\n+  replaced line.\n ]";
        let normalized = ensure_trailing_newline(malformed);
        let patch = diffy::Patch::from_bytes(normalized.as_bytes()).expect("parse");
        let applied = diffy::apply_bytes(source.as_bytes(), &patch).expect("apply");
        assert_eq!(String::from_utf8(applied).unwrap(), "#par[\n  replaced line.\n]\n");
    }

    #[test]
    fn add_terminated_patch_does_not_jam_next_line_after_normalization() {
        // The more-examples patch shape: last body line is an add. Without the
        // trailing newline, diffy "succeeds" but produces corrupt bytes — the
        // insert jams into the next source line. With the trailing newline the
        // apply produces the expected output.
        let source = "line a\nline b\nline c\n";
        let malformed = "@@ -1,2 +1,3 @@\n line a\n-line b\n+line b1\n+line b2";
        let normalized = ensure_trailing_newline(malformed);
        let patch = diffy::Patch::from_bytes(normalized.as_bytes()).expect("parse");
        let applied = diffy::apply_bytes(source.as_bytes(), &patch).expect("apply");
        assert_eq!(String::from_utf8(applied).unwrap(), "line a\nline b1\nline b2\nline c\n");
    }

    #[test]
    fn strip_op_separator_space_rewrites_plan_fix_shape() {
        let input = "@@ -3,1 +3,1 @@\n- Agentic AI systems\n+ Agentic AI contexts\n";
        let out = strip_op_separator_space(input);
        assert_eq!(out, "@@ -3,1 +3,1 @@\n-Agentic AI systems\n+Agentic AI contexts\n");
    }

    #[test]
    fn strip_op_separator_space_leaves_standard_unified_diff_alone() {
        let input = "@@ -1,2 +1,2 @@\n context a\n-remove me\n+add me\n";
        let out = strip_op_separator_space(input);
        assert_eq!(out, input);
    }

    #[test]
    fn strip_op_separator_space_preserves_context_leading_space() {
        // Context lines are ` <content>`. The leading space IS the op; stripping
        // it would erase the marker and diffy would reject the hunk.
        let input = "@@ -1,1 +1,1 @@\n keep this line verbatim\n";
        let out = strip_op_separator_space(input);
        assert_eq!(out, input);
    }

    #[test]
    fn plan_fix_shaped_patch_applies_via_fallback() {
        // End-to-end: the exact shape plan-fix emits (reproduced from the
        // failing case on paper/short/01-introduction.typ) applies cleanly
        // after strip_op_separator_space normalization.
        let source = "Line 1\nLine 2\nAgentic AI systems are being deployed in settings.\n";
        let plan_fix = "@@ -3,1 +3,1 @@\n- Agentic AI systems are being deployed in settings.\n+ Agentic AI systems are being deployed in contexts.\n";
        // As-is: diffy should reject.
        let asis = diffy::Patch::from_bytes(plan_fix.as_bytes()).expect("parse");
        assert!(diffy::apply_bytes(source.as_bytes(), &asis).is_err());
        // Stripped: diffy should accept.
        let stripped = strip_op_separator_space(plan_fix);
        let patch = diffy::Patch::from_bytes(stripped.as_bytes()).expect("parse");
        let applied = diffy::apply_bytes(source.as_bytes(), &patch).expect("apply");
        assert_eq!(
            String::from_utf8(applied).unwrap(),
            "Line 1\nLine 2\nAgentic AI systems are being deployed in contexts.\n"
        );
    }

    // Partial-apply: three hunks on the same file, middle hunk has context
    // that cannot match — the first and third apply cleanly, the middle
    // is reported as a failure, and the working bytes reflect only the
    // two successful hunks.
    #[test]
    fn partial_apply_continues_past_middle_failure() {
        let source = b"alpha\nbeta\ngamma\ndelta\nepsilon\n";
        let good_a = "@@ -1,2 +1,2 @@\n-alpha\n+ALPHA\n beta\n".to_owned();
        // Claims a removal of `NOT-IN-FILE` with real context around it;
        // diffy matches the context but the `-` line mismatches the source.
        let bad = "@@ -2,3 +2,3 @@\n beta\n-NOT-IN-FILE\n+WHATEVER\n delta\n".to_owned();
        let good_c = "@@ -4,2 +4,2 @@\n delta\n-epsilon\n+EPSILON\n".to_owned();

        let out = apply_patches_to_bytes(source, &[good_a, bad, good_c], "paper.txt");
        assert_eq!(out.applied, 2);
        assert_eq!(out.failures.len(), 1);
        assert_eq!(out.failures[0].file, "paper.txt");
        assert_eq!(out.failures[0].index, 2);
        assert_eq!(
            String::from_utf8(out.working).unwrap(),
            "ALPHA\nbeta\ngamma\ndelta\nEPSILON\n"
        );
    }

    // All hunks fail: working bytes are unchanged from the input, applied
    // is zero, and every failure is recorded with its 1-based index.
    #[test]
    fn all_hunks_fail_leaves_bytes_untouched() {
        let source = b"one\ntwo\nthree\n";
        // Context AND delete lines both target text that doesn't appear in
        // the source, so neither position-matching nor context-matching can
        // make diffy accept the hunk.
        let bad_a = "@@ -1,3 +1,3 @@\n zeta-context\n-not-a-real-line\n+x\n eta-context\n"
            .to_owned();
        // Malformed header — diffy's parser rejects this outright.
        let bad_b = "@@ not a real header @@\n-x\n+y\n".to_owned();

        let out = apply_patches_to_bytes(source, &[bad_a, bad_b], "paper.txt");
        assert_eq!(out.applied, 0, "failures: {:?}", out.failures);
        assert_eq!(out.working.as_slice(), source);
        assert_eq!(out.failures.len(), 2);
        assert_eq!(out.failures[0].index, 1);
        assert_eq!(out.failures[1].index, 2);
        assert!(
            out.failures[1].reason.starts_with("parse: "),
            "expected parse failure, got: {}",
            out.failures[1].reason
        );
    }

    // A successful hunk followed by a dependent second hunk that only lines
    // up against the post-first-hunk state: compounding works.
    #[test]
    fn successful_hunks_compound() {
        let source = b"alpha\nbeta\ngamma\n";
        let first = "@@ -1,1 +1,1 @@\n-alpha\n+ALPHA\n".to_owned();
        // `ALPHA` is the line only after `first` applies, so this hunk's
        // context matches only on the post-first working state.
        let second = "@@ -1,2 +1,2 @@\n ALPHA\n-beta\n+BETA\n".to_owned();

        let out = apply_patches_to_bytes(source, &[first, second], "paper.txt");
        assert_eq!(out.applied, 2);
        assert_eq!(out.failures.len(), 0);
        assert_eq!(
            String::from_utf8(out.working).unwrap(),
            "ALPHA\nBETA\ngamma\n"
        );
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest {
        let _ = write!(out, "{byte:02x}");
    }
    out
}

// UTC ISO 8601 formatter without pulling in a date dependency.
fn iso8601_utc_now() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let (y, mo, d, h, mi, s) = civil_from_days(secs);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}Z")
}

// Howard Hinnant's civil_from_days, adapted for i64 seconds since 1970-01-01 UTC.
fn civil_from_days(secs: i64) -> (i32, u32, u32, u32, u32, u32) {
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let h = (rem / 3600) as u32;
    let mi = ((rem % 3600) / 60) as u32;
    let s = (rem % 60) as u32;

    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = (y + if mo <= 2 { 1 } else { 0 }) as i32;
    (y, mo, d, h, mi, s)
}
