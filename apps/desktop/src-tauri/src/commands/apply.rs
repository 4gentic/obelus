// Stages all new bytes in memory before any disk write. Backups precede source
// writes so the backup dir is always complete when a source write starts. On IO
// failure after one or more sources have been promoted, the function restores
// from backup in-order before returning the error.

use crate::commands::fs_scoped::{atomic_write, resolve_for_write};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

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
    root_id: String,
    session_id: String,
    hunks: Vec<HunkInput>,
    state: State<'_, AppState>,
) -> AppResult<ApplyReport> {
    let lock = state.root_lock(&root_id);
    let _guard = lock.lock().await;

    let mut grouped: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for h in hunks {
        grouped.entry(h.file).or_default().push(h.patch);
    }

    let mut staged: Vec<StagedFile> = Vec::with_capacity(grouped.len());
    let mut total_hunks: usize = 0;

    for (rel_path, patches) in grouped {
        let abs_path = resolve_for_write(&root_id, &rel_path, &state).await?;
        let current = tokio::fs::read(&abs_path).await.map_err(AppError::from)?;

        let mut working = current.clone();
        for (idx, patch_text) in patches.iter().enumerate() {
            // plan-fix historically emits patches whose last body line lacks a
            // trailing newline. diffy parses those but then either refuses the
            // hunk (when the last line is context) or applies it corruptly
            // (when the last line is an add, silently jamming the insert into
            // the following source line). A bare `\n` append is a no-op on a
            // well-formed patch and a fix on a malformed one.
            let normalized = ensure_trailing_newline(patch_text);
            let patch = diffy::Patch::from_bytes(normalized.as_bytes())
                .map_err(|e| AppError::Apply(format!("parse {rel_path} hunk #{}: {e}", idx + 1)))?;
            match diffy::apply_bytes(&working, &patch) {
                Ok(next) => working = next,
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
                        Some(next) => working = next,
                        None => {
                            // Surface the ORIGINAL error — the as-written form
                            // is what the reviewer emitted, so the real mismatch
                            // lives there. The retry is a silent recovery path.
                            return Err(AppError::Apply(format!(
                                "apply {rel_path} hunk #{}: {primary}",
                                idx + 1
                            )));
                        }
                    }
                }
            }
        }

        total_hunks += patches.len();
        staged.push(StagedFile {
            rel_path,
            abs_path,
            orig_bytes: current,
            new_bytes: working,
        });
    }

    let mut written: Vec<(PathBuf, Vec<u8>)> = Vec::with_capacity(staged.len());
    let mut manifest_files: Vec<ManifestFile> = Vec::with_capacity(staged.len());

    for sf in &staged {
        let backup_rel = format!(".obelus/backup/{}/{}", session_id, sf.rel_path);
        let backup_abs = match resolve_for_write(&root_id, &backup_rel, &state).await {
            Ok(p) => p,
            Err(e) => {
                rollback(&written).await;
                return Err(e);
            }
        };
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
        session_id: session_id.clone(),
        applied_at: iso8601_utc_now(),
        files: manifest_files,
    };
    let manifest_bytes = serde_json::to_vec_pretty(&manifest)
        .map_err(|e| AppError::Apply(format!("manifest: {e}")))?;
    let manifest_rel = format!(".obelus/backup/{}/.manifest.json", session_id);
    let manifest_abs = match resolve_for_write(&root_id, &manifest_rel, &state).await {
        Ok(p) => p,
        Err(e) => {
            rollback(&written).await;
            return Err(e);
        }
    };
    if let Err(e) = atomic_write(&manifest_abs, &manifest_bytes).await {
        rollback(&written).await;
        return Err(e);
    }

    Ok(ApplyReport {
        files_written,
        hunks_applied: total_hunks,
    })
}

async fn rollback(written: &[(PathBuf, Vec<u8>)]) {
    for (abs, orig) in written {
        let _ = atomic_write(abs, orig).await;
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
    use super::{ensure_trailing_newline, strip_op_separator_space};

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
