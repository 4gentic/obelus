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
use std::time::Instant;
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
            "at": crate::commands::time::now_iso_millis(),
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
        applied_at: crate::commands::time::now_iso_seconds(),
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
        // The engine routinely miscounts the `@@ -a,b +c,d @@` line counts;
        // diffy rejects such a hunk at parse time even when the body is correct.
        // Recompute the counts from the body before parsing — a deterministic
        // repair of a redundant checksum, not a guess (the body, not the header,
        // decides what changes).
        let header_fixed = recompute_hunk_header_counts(normalized.as_ref());
        let patch = match diffy::Patch::from_bytes(header_fixed.as_bytes()) {
            Ok(p) => p,
            Err(e) => {
                // Recompute already fixed count mismatches, so a parse failure
                // here is a genuinely malformed body. The deletion-anchored
                // fallback parses the body itself; try it before giving up.
                let stripped = strip_op_separator_space(header_fixed.as_ref());
                if let Some(next) = apply_deletion_anchored(&working, &stripped) {
                    working = next;
                    applied += 1;
                } else {
                    failures.push(HunkFailure {
                        file: rel_path.to_owned(),
                        index: idx + 1,
                        reason: format!("parse: {e}"),
                    });
                }
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
                let stripped = strip_op_separator_space(header_fixed.as_ref());
                let retry = diffy::Patch::from_bytes(stripped.as_bytes())
                    .ok()
                    .and_then(|p| diffy::apply_bytes(&working, &p).ok());
                match retry {
                    Some(next) => {
                        working = next;
                        applied += 1;
                    }
                    None => {
                        // Last resort: the engine sometimes truncates a long
                        // wrapped source line when copying boundary context, so
                        // diffy can match neither position nor context even
                        // though the deletion block is verbatim. Anchor on that
                        // block instead — but only when it is unique.
                        if let Some(next) = apply_deletion_anchored(&working, &stripped) {
                            working = next;
                            applied += 1;
                        } else {
                            // Surface the ORIGINAL error — the as-written form
                            // is what the reviewer emitted, so the real mismatch
                            // lives there. The retries are silent recovery paths.
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

// Rewrite every hunk header's line counts (`@@ -a,b +c,d @@`) to match its body.
// diffy 0.4.2 rejects a hunk whose header counts disagree with the body
// ("Hunk header does not match hunk") — a check the engine fails often, since it
// hand-counts the header. The counts are a redundant checksum: diffy applies the
// body and searches for the context, so deriving them from the body is exact,
// not a heuristic. Start positions and any `@@ … @@` function-context suffix are
// preserved verbatim. Body classification mirrors diffy's `hunk_lines` tokenizer:
// a leading space or a bare empty line is context (counts on both sides), `-` is
// a deletion (old only), `+` an insertion (new only), and a `\ No newline…`
// marker is not counted.
fn recompute_hunk_header_counts(patch: &str) -> std::borrow::Cow<'_, str> {
    let lines: Vec<&str> = patch.split_inclusive('\n').collect();
    let mut out = String::with_capacity(patch.len());
    let mut changed = false;

    for (i, line) in lines.iter().enumerate() {
        let Some((old_start, new_start, tail)) = parse_hunk_header(line) else {
            out.push_str(line);
            continue;
        };

        let (mut old_count, mut new_count) = (0usize, 0usize);
        for body in &lines[i + 1..] {
            match body.as_bytes().first() {
                Some(b'@') => break,
                Some(b' ') | Some(b'\n') => {
                    old_count += 1;
                    new_count += 1;
                }
                Some(b'-') => old_count += 1,
                Some(b'+') => new_count += 1,
                // A `\ No newline…` marker and any malformed body line add no
                // count; diffy rejects a genuinely malformed body regardless.
                _ => {}
            }
        }

        let newline = if line.ends_with('\n') { "\n" } else { "" };
        let rebuilt = format!("@@ -{old_start},{old_count} +{new_start},{new_count} @@{tail}{newline}");
        if rebuilt != *line {
            changed = true;
        }
        out.push_str(&rebuilt);
    }

    if changed {
        std::borrow::Cow::Owned(out)
    } else {
        std::borrow::Cow::Borrowed(patch)
    }
}

// Parse a `@@ -a[,b] +c[,d] @@[ suffix]` header line, returning the old start,
// new start, and the verbatim tail after ` @@` (e.g. "" or " fn foo"). Returns
// None for non-header or unparseable lines so they pass through untouched; the
// start fields must be non-empty digit runs so a recomputed header never becomes
// something diffy would reject when the original start was already malformed.
fn parse_hunk_header(line: &str) -> Option<(&str, &str, &str)> {
    let line = line.strip_suffix('\n').unwrap_or(line);
    let rest = line.strip_prefix("@@ ")?;
    let idx = rest.find(" @@")?;
    let ranges = &rest[..idx];
    let tail = &rest[idx + 3..];
    let (r1, r2) = ranges.split_once(' ')?;
    let old_start = r1.strip_prefix('-')?.split(',').next()?;
    let new_start = r2.strip_prefix('+')?.split(',').next()?;
    let is_digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    if !is_digits(old_start) || !is_digits(new_start) {
        return None;
    }
    Some((old_start, new_start, tail))
}

// Apply a single hunk by its deletion block when diffy can't match the context.
// When every context line sits at the hunk boundaries (none interleaved between
// the `-`/`+` lines), the deleted lines alone define an unambiguous edit: find
// the verbatim, line-aligned, UNIQUE occurrence of the deleted block in `working`
// and replace it with the inserted block. The uniqueness + line-alignment guards
// keep this sound — it drops only the unreliable boundary context (which the
// engine may have truncated), never guessing placement. Returns None (so the
// caller keeps the original failure) for any shape that isn't safe: interior
// context, an empty deletion block (a pure insertion has no anchor), or a block
// that occurs zero or more than once.
fn apply_deletion_anchored(working: &[u8], normalized_patch: &str) -> Option<Vec<u8>> {
    let lines: Vec<&str> = normalized_patch.split_inclusive('\n').collect();
    let header_idx = lines.iter().position(|l| l.starts_with("@@ "))?;

    let mut del = String::new();
    let mut ins = String::new();
    let mut seen_core = false;
    let mut trailing_context = false;
    for line in &lines[header_idx + 1..] {
        match line.as_bytes().first() {
            Some(b'@') => break,
            Some(b'-') => {
                if trailing_context {
                    return None; // context interleaved between deletions
                }
                seen_core = true;
                del.push_str(&line[1..]);
            }
            Some(b'+') => {
                if trailing_context {
                    return None;
                }
                seen_core = true;
                ins.push_str(&line[1..]);
            }
            // Context (leading space or a bare empty line) is allowed only at
            // the boundaries; mark it so a later core line trips the guard.
            Some(b' ') | Some(b'\n') => {
                if seen_core {
                    trailing_context = true;
                }
            }
            Some(b'\\') => {}
            _ => return None,
        }
    }

    if del.is_empty() {
        return None;
    }

    let occurrences = find_line_aligned(working, del.as_bytes());
    if occurrences.len() != 1 {
        return None;
    }
    let start = occurrences[0];
    let end = start + del.len();
    let mut result = Vec::with_capacity(working.len() - del.len() + ins.len());
    result.extend_from_slice(&working[..start]);
    result.extend_from_slice(ins.as_bytes());
    result.extend_from_slice(&working[end..]);
    Some(result)
}

// Byte offsets where `needle` occurs in `haystack` AND the match starts at a line
// boundary (file start or just after a `\n`) and ends at one (file end or the
// match's last byte is `\n`). Line alignment stops an anchor from landing inside
// a longer line.
fn find_line_aligned(haystack: &[u8], needle: &[u8]) -> Vec<usize> {
    if needle.is_empty() || needle.len() > haystack.len() {
        return Vec::new();
    }
    let ends_with_newline = needle[needle.len() - 1] == b'\n';
    haystack
        .windows(needle.len())
        .enumerate()
        .filter(|&(i, window)| {
            window == needle
                && (i == 0 || haystack[i - 1] == b'\n')
                && (ends_with_newline || i + needle.len() == haystack.len())
        })
        .map(|(i, _)| i)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{
        apply_deletion_anchored, apply_patches_to_bytes, ensure_trailing_newline,
        recompute_hunk_header_counts, strip_op_separator_space,
    };

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

    #[test]
    fn recompute_leaves_correct_header_borrowed() {
        let p = "@@ -1,2 +1,2 @@\n context\n-del\n+ins\n";
        let out = recompute_hunk_header_counts(p);
        assert!(matches!(out, std::borrow::Cow::Borrowed(_)));
        assert_eq!(out.as_ref(), p);
    }

    #[test]
    fn recompute_fixes_wrong_new_count() {
        // The real 09-conclusion shape: header claims +N,3 but the body has one
        // context + one insertion = 2 new-side lines.
        let p = "@@ -24,4 +24,3 @@\n keep\n-a\n-b\n-c\n+x\n";
        assert_eq!(
            recompute_hunk_header_counts(p).as_ref(),
            "@@ -24,4 +24,2 @@\n keep\n-a\n-b\n-c\n+x\n"
        );
    }

    #[test]
    fn recompute_fixes_wrong_old_count_and_both() {
        let p = "@@ -3,9 +3,9 @@\n keep\n-gone\n+new\n";
        assert_eq!(
            recompute_hunk_header_counts(p).as_ref(),
            "@@ -3,2 +3,2 @@\n keep\n-gone\n+new\n"
        );
    }

    #[test]
    fn recompute_expands_omitted_counts() {
        let p = "@@ -5 +5 @@\n-a\n+b\n";
        assert_eq!(recompute_hunk_header_counts(p).as_ref(), "@@ -5,1 +5,1 @@\n-a\n+b\n");
    }

    #[test]
    fn recompute_preserves_function_context_and_counts_blank_lines() {
        // A bare empty line counts as context (diffy treats `\n` as context).
        let p = "@@ -1,9 +1,9 @@ Section 2\n foo\n\n+bar\n";
        assert_eq!(
            recompute_hunk_header_counts(p).as_ref(),
            "@@ -1,2 +1,3 @@ Section 2\n foo\n\n+bar\n"
        );
    }

    #[test]
    fn recompute_leaves_non_header_lines_untouched() {
        let p = "not a patch at all\n";
        let out = recompute_hunk_header_counts(p);
        assert!(matches!(out, std::borrow::Cow::Borrowed(_)));
        assert_eq!(out.as_ref(), p);
    }

    #[test]
    fn miscounted_header_applies_after_recompute() {
        // Header counts are wrong (9,9) but the body is correct; diffy alone
        // would reject this at parse time. End-to-end it now applies.
        let source = b"l1\nl2\nl3\n";
        let patch = "@@ -1,9 +1,9 @@\n l1\n-l2\n+L2\n l3\n".to_owned();
        let out = apply_patches_to_bytes(source, &[patch], "paper.txt");
        assert_eq!(out.applied, 1, "failures: {:?}", out.failures);
        assert_eq!(out.failures.len(), 0);
        assert_eq!(String::from_utf8(out.working).unwrap(), "l1\nL2\nl3\n");
    }

    #[test]
    fn deletion_anchored_lands_truncated_leading_context() {
        // The 06-empirical shape: the engine copied only the tail of a long
        // wrapped source line as the leading context, so diffy can match
        // neither position nor context — but the deletion block is verbatim and
        // unique, so the fallback lands it.
        let source =
            b"a long unwrapped paragraph that ends with the source frameworks.\n== Heading\n\nbody one\nbody two\nafter\n";
        let patch = "@@ -1,99 +1,99 @@\n the source frameworks.\n+\n+*Open problem.*\n-== Heading\n-\n-body one\n-body two\n".to_owned();
        let out = apply_patches_to_bytes(source, &[patch], "paper.txt");
        assert_eq!(out.applied, 1, "failures: {:?}", out.failures);
        assert_eq!(
            String::from_utf8(out.working).unwrap(),
            "a long unwrapped paragraph that ends with the source frameworks.\n\n*Open problem.*\nafter\n"
        );
    }

    #[test]
    fn deletion_anchored_refuses_non_unique_block() {
        // The deletion block appears twice — anchoring would be ambiguous, so
        // the fallback declines and the hunk is reported as a failure.
        let source = b"X\nDUP\nY\nDUP\nZ\n";
        let patch = "@@ -1,99 +1,99 @@\n wrong context\n-DUP\n+CHANGED\n".to_owned();
        let out = apply_patches_to_bytes(source, &[patch], "paper.txt");
        assert_eq!(out.applied, 0);
        assert_eq!(out.failures.len(), 1);
        assert_eq!(out.working.as_slice(), source);
    }

    #[test]
    fn deletion_anchored_refuses_interior_context() {
        // Context interleaved between deletions can't be dropped safely.
        let working = b"keep\nfirst\nmid\nsecond\ntail\n";
        let patch = "@@ -1,9 +1,9 @@\n bad anchor\n-first\n mid\n-second\n+done\n";
        assert!(apply_deletion_anchored(working, patch).is_none());
    }

    #[test]
    fn deletion_anchored_refuses_pure_insertion() {
        let working = b"alpha\nbeta\n";
        let patch = "@@ -1,9 +1,9 @@\n bad anchor\n+inserted\n";
        assert!(apply_deletion_anchored(working, patch).is_none());
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

