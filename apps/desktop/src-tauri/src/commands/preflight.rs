// Builds a structured "Pre-flight" prelude that the desktop injects into the
// spawn prompt for plan-writer-fast and apply-revision. The plugin's SKILL.md
// trusts this prelude as ground truth — its purpose is to keep the model from
// re-deriving facts the desktop already computed (format, entrypoint,
// per-paper rubric presence, anchor-kind histogram, source-window dedup).
//
// Bundle JSON shape mirrors `packages/bundle-schema/src/schema.ts`. We only
// declare the subset we need; serde ignores unknown fields by default, so the
// schema can grow without breaking this module.

use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Deserialize)]
struct Bundle {
    project: Project,
    #[serde(default)]
    papers: Vec<Paper>,
    #[serde(default)]
    annotations: Vec<Annotation>,
}

#[derive(Deserialize)]
struct Project {
    #[serde(default)]
    main: Option<String>,
}

#[derive(Deserialize)]
struct Paper {
    id: String,
    title: String,
    #[serde(default)]
    entrypoint: Option<String>,
    #[serde(default)]
    pdf: Option<PaperPdf>,
    #[serde(default)]
    rubric: Option<PaperRubric>,
}

#[derive(Deserialize)]
struct PaperPdf {
    #[serde(rename = "relPath")]
    rel_path: String,
    sha256: String,
}

#[derive(Deserialize)]
struct PaperRubric {
    #[serde(default)]
    body: String,
}

#[derive(Deserialize)]
struct Annotation {
    #[serde(default)]
    category: String,
    anchor: Anchor,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum Anchor {
    Pdf {},
    Source {
        file: String,
        #[serde(rename = "lineStart")]
        line_start: u32,
        #[serde(rename = "lineEnd")]
        line_end: u32,
    },
    Html {},
}

pub enum Mode {
    WriterFast,
    Rigorous,
}

pub fn build_prelude(bundle_path: &Path, project_root: &Path, mode: Mode) -> Option<String> {
    let raw = std::fs::read_to_string(bundle_path).ok()?;
    let bundle: Bundle = serde_json::from_str(&raw)
        .map_err(|e| {
            eprintln!("[preflight] bundle parse failed: {e}; skipping prelude");
        })
        .ok()?;
    Some(match mode {
        Mode::WriterFast => render_writer_fast(&bundle),
        Mode::Rigorous => render_rigorous(&bundle, project_root),
    })
}

fn detect_format(extension: Option<&str>) -> &'static str {
    match extension.unwrap_or("") {
        "tex" => "latex",
        "md" => "markdown",
        "typ" => "typst",
        _ => "",
    }
}

fn extension_of(path: &str) -> Option<&str> {
    Path::new(path).extension().and_then(|e| e.to_str())
}

fn primary_entrypoint(bundle: &Bundle) -> Option<String> {
    if let Some(main) = bundle.project.main.as_ref() {
        return Some(main.clone());
    }
    bundle.papers.iter().find_map(|p| p.entrypoint.clone())
}

// (file, [start, end]) windows merged within-file when within 100 lines per
// plan-fix SKILL.md §Reading the paper first. Output is sorted by file then
// start for stable prompt formatting.
fn source_windows(bundle: &Bundle) -> Vec<(String, u32, u32)> {
    let mut by_file: BTreeMap<String, Vec<(u32, u32)>> = BTreeMap::new();
    for ann in &bundle.annotations {
        if let Anchor::Source { file, line_start, line_end } = &ann.anchor {
            let start = line_start.saturating_sub(50).max(1);
            let end = line_end.saturating_add(50);
            by_file.entry(file.clone()).or_default().push((start, end));
        }
    }
    let mut out = Vec::new();
    for (file, mut spans) in by_file {
        spans.sort_unstable();
        let mut merged: Vec<(u32, u32)> = Vec::new();
        for (s, e) in spans {
            if let Some(last) = merged.last_mut() {
                // Merge if overlapping or within 100 lines of the previous window.
                if s <= last.1.saturating_add(100) {
                    last.1 = last.1.max(e);
                    continue;
                }
            }
            merged.push((s, e));
        }
        for (s, e) in merged {
            out.push((file.clone(), s, e));
        }
    }
    out
}

fn render_writer_fast(bundle: &Bundle) -> String {
    let entrypoint = primary_entrypoint(bundle).unwrap_or_default();
    let format = detect_format(extension_of(&entrypoint));
    let mut s = String::new();
    s.push_str("Pre-flight (validated by the desktop; trust it, do not re-derive):\n");
    s.push_str(&format!("- format: {}\n", if format.is_empty() { "(unknown)" } else { format }));
    s.push_str(&format!(
        "- entrypoint: {}\n",
        if entrypoint.is_empty() { "(unknown)".to_string() } else { entrypoint }
    ));
    s.push_str(&format!(
        "- papers: {}, annotations: {}\n",
        bundle.papers.len(),
        bundle.annotations.len()
    ));
    let windows = source_windows(bundle);
    if windows.is_empty() {
        s.push_str("- source windows to read: (none — no source-anchored annotations)\n");
    } else {
        s.push_str("- source windows to read (already deduped/merged):\n");
        for (file, start, end) in &windows {
            s.push_str(&format!("    {file}:[{start}-{end}]\n"));
        }
    }
    s.push_str("- delimiter collisions: none (bundle-builder enforces this at export)\n");
    s
}

fn render_rigorous(bundle: &Bundle, project_root: &Path) -> String {
    let entrypoint = primary_entrypoint(bundle).unwrap_or_default();
    let format = detect_format(extension_of(&entrypoint));

    let mut praise = 0usize;
    let mut aside = 0usize;
    let mut flag = 0usize;
    let mut substantive = 0usize;
    let mut hist_source = 0usize;
    let mut hist_pdf = 0usize;
    let mut hist_html = 0usize;
    for ann in &bundle.annotations {
        match ann.category.as_str() {
            "praise" => praise += 1,
            "aside" => aside += 1,
            "flag" => flag += 1,
            _ => substantive += 1,
        }
        match ann.anchor {
            Anchor::Source { .. } => hist_source += 1,
            Anchor::Pdf {} => hist_pdf += 1,
            Anchor::Html {} => hist_html += 1,
        }
    }
    let all_source = !bundle.annotations.is_empty() && hist_pdf == 0 && hist_html == 0;
    let papers_with_rubric: Vec<&Paper> = bundle
        .papers
        .iter()
        .filter(|p| p.rubric.as_ref().is_some_and(|r| !r.body.trim().is_empty()))
        .collect();

    let mut s = String::new();
    s.push_str("Pre-flight (validated by the desktop; trust it, do not re-derive):\n");
    s.push_str(&format!("- format: {}\n", if format.is_empty() { "(unknown)" } else { format }));
    s.push_str(&format!(
        "- entrypoint: {}\n",
        if entrypoint.is_empty() { "(unknown)".to_string() } else { entrypoint }
    ));
    s.push_str(&format!(
        "- papers: {}, annotations: {}\n",
        bundle.papers.len(),
        bundle.annotations.len()
    ));
    s.push_str(&format!(
        "- substantive blocks: {} (excluding {} praise, {} aside, {} flag)\n",
        substantive, praise, aside, flag
    ));
    s.push_str(&format!(
        "- anchor-kind histogram: source={}, pdf={}, html={}\n",
        hist_source, hist_pdf, hist_html
    ));
    s.push_str(&format!("- all-source-anchored: {}\n", all_source));
    if papers_with_rubric.is_empty() {
        s.push_str("- has-rubric: false\n");
    } else {
        let titles: Vec<String> = papers_with_rubric
            .iter()
            .map(|p| format!("\"{}\"", p.title.replace('"', "\\\"")))
            .collect();
        s.push_str(&format!(
            "- has-rubric: true ({} {})\n",
            if papers_with_rubric.len() == 1 { "paper" } else { "papers" },
            titles.join(", ")
        ));
    }
    s.push_str("- delimiter collisions: none (bundle-builder enforces this at export)\n");

    s.push_str("\nPer-paper:\n");
    for paper in &bundle.papers {
        let per_paper_entrypoint = paper
            .entrypoint
            .clone()
            .or_else(|| bundle.project.main.clone())
            .unwrap_or_default();
        let per_paper_format = detect_format(extension_of(&per_paper_entrypoint));
        s.push_str(&format!(
            "  paper \"{}\" (id {})\n",
            paper.title.replace('"', "\\\""),
            short_id(&paper.id)
        ));
        s.push_str(&format!(
            "    format: {}, entrypoint: {}\n",
            if per_paper_format.is_empty() { "(unknown)" } else { per_paper_format },
            if per_paper_entrypoint.is_empty() {
                "(unknown)".to_string()
            } else {
                per_paper_entrypoint
            }
        ));
        if let Some(pdf) = paper.pdf.as_ref() {
            let status = pdf_sha_status(project_root, &pdf.rel_path, &pdf.sha256);
            s.push_str(&format!("    pdf: {} (sha256 {})\n", pdf.rel_path, status));
        }
    }

    // Hint table: which sweeps the desktop's signals already authorize you to
    // skip. The model still owns the all-deltas-local call (impact-sweep skip).
    s.push_str("\nSkip-condition signals (the orchestrator's contract):\n");
    if all_source {
        s.push_str("- locating-spans: source-only — the pdf/html fuzzy fallback does not run\n");
    }
    if substantive < 2 {
        s.push_str("- coherence-sweep: skipped (substantive blocks < 2)\n");
        if papers_with_rubric.is_empty() {
            s.push_str("- quality-sweep: skipped (no rubric and substantive blocks < 2)\n");
        }
    }
    s
}

fn short_id(id: &str) -> String {
    let head: String = id.chars().take(8).collect();
    format!("{head}…")
}

fn pdf_sha_status(project_root: &Path, rel_path: &str, expected_hex: &str) -> &'static str {
    let abs = project_root.join(rel_path);
    let bytes = match std::fs::read(&abs) {
        Ok(b) => b,
        Err(_) => return "missing",
    };
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let actual = hasher.finalize();
    let actual_hex: String = actual.iter().map(|b| format!("{b:02x}")).collect();
    if actual_hex.eq_ignore_ascii_case(expected_hex.trim()) {
        "matches"
    } else {
        "mismatches"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_bundle(dir: &Path, body: &str) -> std::path::PathBuf {
        let path = dir.join("bundle.json");
        std::fs::write(&path, body).unwrap();
        path
    }

    #[test]
    fn writer_fast_prelude_reports_format_entrypoint_counts_and_windows() {
        let tmp = tempfile::tempdir().unwrap();
        let bundle = r#"{
            "tool": { "name": "obelus", "version": "0.1.0" },
            "project": {
              "id": "p", "label": "x", "kind": "writer",
              "categories": [{"slug":"unclear","label":"unclear"}],
              "main": "chapters/00-abstract.typ"
            },
            "papers": [{ "id": "11111111-1111-4111-8111-111111111111", "title": "T", "revision": 1, "createdAt": "2026-04-19T00:00:00.000Z", "entrypoint": "chapters/00-abstract.typ" }],
            "annotations": [
              {
                "id": "a1", "paperId": "11111111-1111-4111-8111-111111111111",
                "category": "unclear", "quote": "x", "contextBefore": "", "contextAfter": "",
                "note": "", "thread": [], "createdAt": "2026-04-19T00:00:00.000Z",
                "anchor": { "kind": "source", "file": "chapters/00-abstract.typ",
                            "lineStart": 12, "colStart": 0, "lineEnd": 12, "colEnd": 10 }
              },
              {
                "id": "a2", "paperId": "11111111-1111-4111-8111-111111111111",
                "category": "unclear", "quote": "x", "contextBefore": "", "contextAfter": "",
                "note": "", "thread": [], "createdAt": "2026-04-19T00:00:00.000Z",
                "anchor": { "kind": "source", "file": "chapters/00-abstract.typ",
                            "lineStart": 80, "colStart": 0, "lineEnd": 80, "colEnd": 10 }
              }
            ]
        }"#;
        let path = write_bundle(tmp.path(), bundle);
        let out = build_prelude(&path, tmp.path(), Mode::WriterFast).unwrap();
        assert!(out.contains("- format: typst"));
        assert!(out.contains("- entrypoint: chapters/00-abstract.typ"));
        assert!(out.contains("- papers: 1, annotations: 2"));
        // Two source-anchored marks at L12 and L80 in the same file: their
        // ±50 windows are [1..62] and [30..130] respectively; merged.
        assert!(out.contains("chapters/00-abstract.typ:[1-130]"), "got: {out}");
    }

    #[test]
    fn rigorous_prelude_reports_anchor_histogram_and_skip_signals() {
        let tmp = tempfile::tempdir().unwrap();
        let bundle = r#"{
            "tool": { "name": "obelus", "version": "0.1.0" },
            "project": {
              "id": "p", "label": "x", "kind": "writer",
              "categories": [
                {"slug":"unclear","label":"unclear"},
                {"slug":"praise","label":"praise"},
                {"slug":"aside","label":"aside"}
              ],
              "main": "paper.tex"
            },
            "papers": [{ "id": "11111111-1111-4111-8111-111111111111", "title": "Concluding Notes", "revision": 1, "createdAt": "2026-04-19T00:00:00.000Z" }],
            "annotations": [
              { "id": "a1", "paperId": "11111111-1111-4111-8111-111111111111", "category": "unclear", "quote": "x", "contextBefore": "", "contextAfter": "", "note": "", "thread": [], "createdAt": "2026-04-19T00:00:00.000Z", "anchor": { "kind": "source", "file": "paper.tex", "lineStart": 1, "colStart": 0, "lineEnd": 1, "colEnd": 5 } },
              { "id": "a2", "paperId": "11111111-1111-4111-8111-111111111111", "category": "praise", "quote": "x", "contextBefore": "", "contextAfter": "", "note": "", "thread": [], "createdAt": "2026-04-19T00:00:00.000Z", "anchor": { "kind": "source", "file": "paper.tex", "lineStart": 2, "colStart": 0, "lineEnd": 2, "colEnd": 5 } },
              { "id": "a3", "paperId": "11111111-1111-4111-8111-111111111111", "category": "aside", "quote": "x", "contextBefore": "", "contextAfter": "", "note": "", "thread": [], "createdAt": "2026-04-19T00:00:00.000Z", "anchor": { "kind": "pdf", "page": 1, "bbox": [0,0,1,1], "textItemRange": { "start":[0,0], "end":[0,1] } } }
            ]
        }"#;
        let path = write_bundle(tmp.path(), bundle);
        let out = build_prelude(&path, tmp.path(), Mode::Rigorous).unwrap();
        assert!(out.contains("- format: latex"));
        assert!(out.contains("- substantive blocks: 1 (excluding 1 praise, 1 aside, 0 flag)"));
        assert!(out.contains("- anchor-kind histogram: source=2, pdf=1, html=0"));
        assert!(out.contains("- all-source-anchored: false"));
        assert!(out.contains("- has-rubric: false"));
        // substantive < 2 → coherence-sweep skip and quality-sweep skip both surface.
        assert!(out.contains("coherence-sweep: skipped"));
        assert!(out.contains("quality-sweep: skipped"));
    }

    #[test]
    fn pdf_sha_check_reports_matches_and_mismatches() {
        let tmp = tempfile::tempdir().unwrap();
        let pdf_path = tmp.path().join("paper.pdf");
        std::fs::write(&pdf_path, b"hello").unwrap();
        // sha256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
        let good = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
        assert_eq!(pdf_sha_status(tmp.path(), "paper.pdf", good), "matches");
        assert_eq!(pdf_sha_status(tmp.path(), "paper.pdf", "0".repeat(64).as_str()), "mismatches");
        assert_eq!(pdf_sha_status(tmp.path(), "missing.pdf", good), "missing");
    }
}
