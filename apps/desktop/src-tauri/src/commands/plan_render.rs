// Project a plan JSON (the contract written by the plan-fix / plan-writer-fast
// skills) into a human-readable Markdown rendering. The desktop's diff-review
// UI reads only the .json — the .md is a reading aid for the user, produced
// here so the model never has to re-emit the same content in a second shape.
// See WS8 in docs/plan.md.

use crate::error::{AppError, AppResult};
use crate::commands::workspace::workspace_dir_for;
use serde::Deserialize;
use std::path::Path;
use tauri::AppHandle;

#[derive(Deserialize)]
struct PlanFile {
    #[serde(default, rename = "bundleId")]
    bundle_id: String,
    #[serde(default)]
    format: String,
    #[serde(default)]
    entrypoint: String,
    #[serde(default)]
    blocks: Vec<PlanBlock>,
}

#[derive(Deserialize)]
struct PlanBlock {
    #[serde(default, rename = "annotationIds")]
    annotation_ids: Vec<String>,
    #[serde(default)]
    file: String,
    #[serde(default)]
    category: String,
    #[serde(default)]
    patch: String,
    #[serde(default)]
    ambiguous: bool,
    #[serde(default, rename = "reviewerNotes")]
    reviewer_notes: String,
    #[serde(default, rename = "emptyReason")]
    empty_reason: Option<String>,
}

// Project a parsed plan JSON value into a Markdown document. The fields in the
// JSON contract are the only inputs — Quote / Note / Where line ranges from
// the older author-emitted `.md` are not available here, by design (WS8).
// Keep this dependency-free; it is a few `format!`s.
pub fn render_plan_md(plan_json: &serde_json::Value, stamp: Option<&str>) -> String {
    let plan: PlanFile = match serde_json::from_value(plan_json.clone()) {
        Ok(p) => p,
        Err(_) => PlanFile {
            bundle_id: String::new(),
            format: String::new(),
            entrypoint: String::new(),
            blocks: Vec::new(),
        },
    };
    let mut out = String::new();
    let header_stamp = stamp.unwrap_or("").trim();
    if header_stamp.is_empty() {
        out.push_str("# Obelus Plan\n\n");
    } else {
        out.push_str(&format!("# Obelus Plan — {}\n\n", header_stamp));
    }
    out.push_str(&format!("Bundle: {}\n", plan.bundle_id));
    let format_label = if plan.format.is_empty() { "(unknown)" } else { plan.format.as_str() };
    out.push_str(&format!("Format: {}\n", format_label));
    let entrypoint_label =
        if plan.entrypoint.is_empty() { "(none)".to_string() } else { plan.entrypoint.clone() };
    out.push_str(&format!("Entrypoint: {}\n\n", entrypoint_label));
    out.push_str("---\n\n");

    for (idx, block) in plan.blocks.iter().enumerate() {
        let heading_id = block.annotation_ids.first().cloned().unwrap_or_default();
        let category = if block.category.is_empty() { "(uncategorised)" } else { block.category.as_str() };
        out.push_str(&format!("## {}. {} — {}\n\n", idx + 1, category, heading_id));
        let file_label = if block.file.is_empty() { "(unresolved)" } else { block.file.as_str() };
        out.push_str(&format!("**File**: `{}`\n", file_label));
        if block.annotation_ids.len() > 1 {
            out.push_str(&format!("**Affects**: {}\n", block.annotation_ids.join(", ")));
        }
        out.push('\n');

        if block.patch.is_empty() {
            out.push_str("**Change**: (none)\n\n");
        } else {
            out.push_str("**Change**:\n\n```diff\n");
            out.push_str(&block.patch);
            if !block.patch.ends_with('\n') {
                out.push('\n');
            }
            out.push_str("```\n\n");
        }

        if !block.reviewer_notes.trim().is_empty() {
            out.push_str(&format!("**Reviewer notes**: {}\n\n", block.reviewer_notes.trim()));
        }

        out.push_str(&format!("**Ambiguous**: {}\n", if block.ambiguous { "true" } else { "false" }));
        let empty_reason_label = block.empty_reason.clone().unwrap_or_else(|| "none".to_string());
        out.push_str(&format!("**Empty reason**: {}\n\n", empty_reason_label));
        out.push_str("---\n\n");
    }

    out.push_str(&render_summary(&plan));
    out
}

fn render_summary(plan: &PlanFile) -> String {
    let mut counts: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
    let mut merged_blocks = 0usize;
    let mut ambiguous = 0usize;
    let mut synth_cascade = 0usize;
    let mut synth_impact = 0usize;
    let mut synth_quality = 0usize;
    let mut synth_directive = 0usize;
    let mut synth_coherence = 0usize;
    for block in &plan.blocks {
        let first_id = block.annotation_ids.first().cloned().unwrap_or_default();
        if first_id.starts_with("cascade-") {
            synth_cascade += 1;
        } else if first_id.starts_with("impact-") {
            synth_impact += 1;
        } else if first_id.starts_with("quality-") {
            synth_quality += 1;
        } else if first_id.starts_with("directive-") {
            synth_directive += 1;
        } else if first_id.starts_with("coherence-") {
            synth_coherence += 1;
        } else {
            *counts.entry(block.category.clone()).or_insert(0) += 1;
        }
        if block.annotation_ids.len() > 1 {
            merged_blocks += 1;
        }
        if block.ambiguous {
            ambiguous += 1;
        }
    }

    let mut s = String::new();
    s.push_str("## Summary\n\n");
    s.push_str("| Category | Count |\n");
    s.push_str("|---|---|\n");
    for (cat, n) in &counts {
        let label = if cat.is_empty() { "(uncategorised)" } else { cat.as_str() };
        s.push_str(&format!("| {} | {} |\n", label, n));
    }
    if synth_cascade > 0 {
        s.push_str(&format!("| cascade-* | {} |\n", synth_cascade));
    }
    if synth_impact > 0 {
        s.push_str(&format!("| impact-* | {} |\n", synth_impact));
    }
    if synth_quality > 0 {
        s.push_str(&format!("| quality-* | {} |\n", synth_quality));
    }
    if synth_directive > 0 {
        s.push_str(&format!("| directive-* | {} |\n", synth_directive));
    }
    if synth_coherence > 0 {
        s.push_str(&format!("| coherence-* | {} |\n", synth_coherence));
    }
    s.push_str(&format!("| **Total** | **{}** |\n\n", plan.blocks.len()));
    s.push_str(&format!("Merged blocks: {}\n", merged_blocks));
    s.push_str(&format!("Ambiguous: {}\n", ambiguous));
    s.push_str(&format!("Bundle: {}\n", plan.bundle_id));
    s
}

// Read a plan JSON at `<workspace>/<rel_path>`, project it, and write the .md
// next to it (same stem, `.md` extension). Returns the absolute path of the
// .md just written. Best-effort callers swallow the error and log; the JSON
// remains the source of truth either way.
pub async fn project_plan_md(
    workspace_dir: &Path,
    plan_json_path: &Path,
) -> AppResult<std::path::PathBuf> {
    let bytes = tokio::fs::read(plan_json_path).await.map_err(AppError::from)?;
    let value: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|e| AppError::Other(format!("plan JSON parse failed at {}: {e}", plan_json_path.display())))?;

    // Pull the timestamp out of the file stem (`plan-<iso>.json`) so the
    // rendered .md heading stays anchored to the run that produced it.
    let stamp = plan_json_path
        .file_stem()
        .and_then(|s| s.to_str())
        .and_then(|stem| stem.strip_prefix("plan-"))
        .map(|s| s.to_owned());

    let md_body = render_plan_md(&value, stamp.as_deref());
    let md_path = plan_json_path.with_extension("md");
    if !md_path.starts_with(workspace_dir) {
        return Err(AppError::OutOfScope);
    }
    tokio::fs::write(&md_path, md_body.as_bytes()).await.map_err(AppError::from)?;
    Ok(md_path)
}

// Tauri command exposed to the frontend. Called by the jobs-listener when it
// sees an `OBELUS_WROTE: <path>.json` marker — the desktop projects the .md
// before surfacing the marker to the diff-review UI as the "plan ready"
// signal.
#[tauri::command]
pub async fn plan_render_md(
    app: AppHandle,
    project_id: String,
    plan_json_abs_path: String,
) -> AppResult<String> {
    let workspace = workspace_dir_for(&app, &project_id)?;
    let json_path = std::path::PathBuf::from(&plan_json_abs_path);
    if !json_path.starts_with(&workspace) {
        return Err(AppError::OutOfScope);
    }
    let md_path = project_plan_md(&workspace, &json_path).await?;
    Ok(md_path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_block(annotation_ids: &[&str], category: &str, patch: &str, file: &str) -> serde_json::Value {
        serde_json::json!({
            "annotationIds": annotation_ids,
            "file": file,
            "category": category,
            "patch": patch,
            "ambiguous": false,
            "reviewerNotes": "",
            "emptyReason": serde_json::Value::Null,
        })
    }

    #[test]
    fn render_includes_header_and_per_block_diff_fences() {
        let plan = serde_json::json!({
            "bundleId": "bundle-abc.json",
            "format": "typst",
            "entrypoint": "main.typ",
            "blocks": [
                {
                    "annotationIds": ["abc-123"],
                    "file": "paper/short/main.typ",
                    "category": "wrong",
                    "patch": "@@ -5,1 +5,1 @@\n-old\n+new\n",
                    "ambiguous": false,
                    "reviewerNotes": "Looks safe.",
                    "emptyReason": null,
                },
                {
                    "annotationIds": ["cascade-abc-1"],
                    "file": "paper/short/intro.typ",
                    "category": "wrong",
                    "patch": "@@ -1,1 +1,1 @@\n-foo\n+bar\n",
                    "ambiguous": false,
                    "reviewerNotes": "Cascaded from abc-123: same referent.",
                    "emptyReason": null,
                },
            ],
        });
        let md = render_plan_md(&plan, Some("20260427-140000"));
        assert!(md.starts_with("# Obelus Plan — 20260427-140000\n"));
        assert!(md.contains("Bundle: bundle-abc.json"));
        assert!(md.contains("Format: typst"));
        assert!(md.contains("Entrypoint: main.typ"));
        assert!(md.contains("## 1. wrong — abc-123"));
        assert!(md.contains("**File**: `paper/short/main.typ`"));
        assert!(md.contains("```diff\n@@ -5,1 +5,1 @@\n-old\n+new\n```"));
        assert!(md.contains("**Reviewer notes**: Looks safe."));
        assert!(md.contains("**Ambiguous**: false"));
        assert!(md.contains("**Empty reason**: none"));
        assert!(md.contains("## 2. wrong — cascade-abc-1"));
        assert!(md.contains("Cascaded from abc-123"));
        assert!(md.contains("## Summary"));
        assert!(md.contains("| **Total** | **2** |"));
        assert!(md.contains("| cascade-* | 1 |"));
    }

    #[test]
    fn empty_patch_blocks_render_with_empty_reason_and_no_diff_fence() {
        let plan = serde_json::json!({
            "bundleId": "bundle.json",
            "format": "latex",
            "entrypoint": "main.tex",
            "blocks": [
                {
                    "annotationIds": ["impact-xyz-1"],
                    "file": "paper.tex",
                    "category": "unclear",
                    "patch": "",
                    "ambiguous": false,
                    "reviewerNotes": "Impact of xyz: structural.",
                    "emptyReason": "structural-note",
                },
            ],
        });
        let md = render_plan_md(&plan, None);
        assert!(md.contains("**Change**: (none)"));
        assert!(md.contains("**Empty reason**: structural-note"));
        assert!(!md.contains("```diff"));
        assert!(md.contains("| impact-* | 1 |"));
    }

    #[test]
    fn merged_block_emits_affects_line() {
        let plan = serde_json::json!({
            "bundleId": "b.json",
            "format": "markdown",
            "entrypoint": "doc.md",
            "blocks": [
                fixture_block(&["aaa-1", "bbb-2"], "rephrase", "@@ -1 +1 @@\n-a\n+b\n", "doc.md"),
            ],
        });
        let md = render_plan_md(&plan, Some("stamp"));
        assert!(md.contains("**Affects**: aaa-1, bbb-2"));
    }

    #[test]
    fn missing_optional_top_level_fields_render_with_unknown_placeholders() {
        let plan = serde_json::json!({
            "bundleId": "b.json",
            "format": "",
            "entrypoint": "",
            "blocks": [],
        });
        let md = render_plan_md(&plan, None);
        assert!(md.contains("Format: (unknown)"));
        assert!(md.contains("Entrypoint: (none)"));
        assert!(md.contains("| **Total** | **0** |"));
    }

    #[tokio::test]
    async fn project_plan_md_writes_md_next_to_json_inside_workspace() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_path_buf();
        let json_path = workspace.join("plan-20260427-140000.json");
        let plan = serde_json::json!({
            "bundleId": "b.json",
            "format": "typst",
            "entrypoint": "main.typ",
            "blocks": [
                {
                    "annotationIds": ["abc-1"],
                    "file": "main.typ",
                    "category": "rephrase",
                    "patch": "@@ -1,1 +1,1 @@\n-a\n+b\n",
                    "ambiguous": false,
                    "reviewerNotes": "ok",
                    "emptyReason": null,
                },
            ],
        });
        tokio::fs::write(&json_path, serde_json::to_vec(&plan).unwrap()).await.unwrap();

        let md_path = project_plan_md(&workspace, &json_path).await.unwrap();
        assert_eq!(md_path, workspace.join("plan-20260427-140000.md"));
        let body = tokio::fs::read_to_string(&md_path).await.unwrap();
        assert!(body.starts_with("# Obelus Plan — 20260427-140000"));
        assert!(body.contains("```diff"));
    }

    #[tokio::test]
    async fn project_plan_md_rejects_path_outside_workspace() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().join("ws");
        tokio::fs::create_dir_all(&workspace).await.unwrap();
        let outside = tmp.path().join("plan.json");
        tokio::fs::write(&outside, b"{\"bundleId\":\"b\",\"format\":\"\",\"entrypoint\":\"\",\"blocks\":[]}")
            .await
            .unwrap();
        let res = project_plan_md(&workspace, &outside).await;
        assert!(matches!(res, Err(AppError::OutOfScope)));
    }
}
