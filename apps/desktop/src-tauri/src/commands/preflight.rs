// Builds a structured "Pre-flight" prelude that the desktop injects into the
// spawn prompt for plan-writer-fast and apply-revision. The plugin's SKILL.md
// trusts this prelude as ground truth — its purpose is to keep the model from
// re-deriving facts the desktop already computed (format, entrypoint,
// per-paper rubric presence, anchor-kind histogram, source-window dedup).
//
// Bundle JSON shape mirrors `packages/bundle-schema/src/schema.ts`. We only
// declare the subset we need; serde ignores unknown fields by default, so the
// schema can grow without breaking this module.

use jsonschema::Validator;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::OnceLock;
use std::time::Instant;

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
    #[serde(default)]
    files: Vec<ProjectFile>,
}

#[derive(Deserialize)]
struct ProjectFile {
    #[serde(rename = "relPath")]
    rel_path: String,
    format: String,
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

// WS3 telemetry. `bundle-stats` and `preflight-rust` events use these shapes.
pub struct BundleStats {
    pub annotations: usize,
    pub anchor_source: usize,
    pub anchor_pdf: usize,
    pub anchor_html: usize,
    pub papers: usize,
    pub files: usize,
    pub bytes: u64,
}

pub struct PreludeTimings {
    pub prelude_ms: u128,
    pub sha256_ms: u128,
    pub total_ms: u128,
}

// Returns the prelude string plus the bundle's anchor histogram / file
// inventory and a coarse breakdown of where the wall-clock went. Used by
// `claude_session::claude_spawn` for the prompt prelude and the WS3
// `bundle-stats` / `preflight-rust` events.
pub fn build_prelude_with_metrics(
    bundle_path: &Path,
    project_root: &Path,
    plugin_dir: &Path,
    mode: Mode,
) -> Option<(String, BundleStats, PreludeTimings)> {
    let total = Instant::now();
    let raw = std::fs::read_to_string(bundle_path).ok()?;
    let bytes = raw.as_bytes().len() as u64;
    let bundle: Bundle = serde_json::from_str(&raw)
        .map_err(|e| {
            eprintln!("[preflight] bundle parse failed: {e}; skipping prelude");
        })
        .ok()?;
    let stats = compute_bundle_stats(&bundle, bytes);

    let mut sha256_ms: u128 = 0;
    let prelude = match mode {
        Mode::WriterFast => render_writer_fast(&bundle),
        Mode::Rigorous => render_rigorous_timed(&bundle, project_root, plugin_dir, &mut sha256_ms),
    };

    let total_ms = total.elapsed().as_millis();
    let timings = PreludeTimings {
        prelude_ms: total_ms.saturating_sub(sha256_ms),
        sha256_ms,
        total_ms,
    };
    Some((prelude, stats, timings))
}

fn compute_bundle_stats(bundle: &Bundle, bytes: u64) -> BundleStats {
    let mut anchor_source = 0;
    let mut anchor_pdf = 0;
    let mut anchor_html = 0;
    for ann in &bundle.annotations {
        match ann.anchor {
            Anchor::Source { .. } => anchor_source += 1,
            Anchor::Pdf {} => anchor_pdf += 1,
            Anchor::Html {} => anchor_html += 1,
        }
    }
    BundleStats {
        annotations: bundle.annotations.len(),
        anchor_source,
        anchor_pdf,
        anchor_html,
        papers: bundle.papers.len(),
        files: bundle.project.files.len(),
        bytes,
    }
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

// Source files in the bundle's project inventory. The plan-writer-fast and
// plan-fix SKILLs read these in full as the rewrite-coherence context — the
// per-mark windows are still emitted as locator hints, but the agent must
// see the whole paper to produce edits that respect terminology and tone
// across sections. Filters to the textual source formats the plugin patches
// (tex / md / typ); excludes binaries (pdf), bibliographies, and assets.
fn whole_paper_files(bundle: &Bundle) -> Vec<String> {
    let mut out: Vec<String> = bundle
        .project
        .files
        .iter()
        .filter(|f| matches!(f.format.as_str(), "tex" | "md" | "typ"))
        .map(|f| f.rel_path.clone())
        .collect();
    out.sort();
    out.dedup();
    out
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
        s.push_str("- locator windows (per-mark hint): (none — no source-anchored annotations)\n");
    } else {
        s.push_str("- locator windows (per-mark hint, already deduped/merged):\n");
        for (file, start, end) in &windows {
            s.push_str(&format!("    {file}:[{start}-{end}]\n"));
        }
    }
    let whole_paper = whole_paper_files(bundle);
    if whole_paper.is_empty() {
        s.push_str("- whole-paper read list: (none indexed)\n");
    } else {
        s.push_str(
            "- whole-paper read list (Read all of these in one parallel batch — \
             the per-mark windows above are only locator hints):\n",
        );
        for path in &whole_paper {
            s.push_str(&format!("    {path}\n"));
        }
    }
    s.push_str("- delimiter collisions: none (bundle-builder enforces this at export)\n");
    s
}

fn render_rigorous_timed(
    bundle: &Bundle,
    project_root: &Path,
    plugin_dir: &Path,
    sha256_ms: &mut u128,
) -> String {
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
    // The schema check ran in Rust before the spawn — the model can trust the
    // bundle's structure and skip its own re-validation pass over the schema.
    s.push_str("- bundle-validated: true\n");
    // The model's path to plan-fix's SKILL.md, given so it can `Read` the
    // skill body directly without Glob-hunting. Both apply-revision and
    // plan-fix have `disable-model-invocation: true`, which blocks Skill-tool
    // dispatch — the model has to load plan-fix as a regular file, and
    // without this line it spends 5–8 seconds (and a thinking block) finding
    // it. The path is absolute and resolved via Tauri's plugin-resource
    // resolution, so it works in both dev (`apps/desktop/src-tauri/target`)
    // and the compiled bundle (`/Applications/Obelus.app/.../plugin`).
    let plan_fix_path = plugin_dir.join("skills").join("plan-fix").join("SKILL.md");
    s.push_str(&format!("- plan-fix skill: {}\n", plan_fix_path.display()));
    s.push_str(&format!("- format: {}\n", if format.is_empty() { "(unknown)" } else { format }));
    s.push_str(&format!(
        "- entrypoint: {}\n",
        if entrypoint.is_empty() { "(unknown)" } else { entrypoint.as_str() }
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
    // `all-source-anchored` is derivable from the histogram above (pdf==0 &&
    // html==0); kept implicit so the prelude doesn't restate the same fact.
    // The skip-condition block below still uses the boolean to guide the
    // orchestrator.
    if papers_with_rubric.is_empty() {
        s.push_str("- has-rubric: false\n");
    } else {
        let titles: Vec<String> = papers_with_rubric
            .iter()
            .map(|p| format!("\"{}\"", sanitize_title_for_prelude(&p.title)))
            .collect();
        s.push_str(&format!(
            "- has-rubric: true ({} {})\n",
            if papers_with_rubric.len() == 1 { "paper" } else { "papers" },
            titles.join(", ")
        ));
    }
    let whole_paper = whole_paper_files(bundle);
    if whole_paper.is_empty() {
        s.push_str("- whole-paper read list: (none indexed)\n");
    } else {
        s.push_str(
            "- whole-paper read list (Read all of these in one parallel batch — \
             the per-mark windows are locator hints; the rewrite-coherence \
             context is the whole source):\n",
        );
        for path in &whole_paper {
            s.push_str(&format!("    {path}\n"));
        }
    }
    s.push_str("- delimiter collisions: none (bundle-builder enforces this at export)\n");

    s.push_str("\nPer-paper:\n");
    let single_paper = bundle.papers.len() == 1;
    for paper in &bundle.papers {
        let per_paper_entrypoint = paper
            .entrypoint
            .clone()
            .or_else(|| bundle.project.main.clone())
            .unwrap_or_default();
        let per_paper_format = detect_format(extension_of(&per_paper_entrypoint));
        s.push_str(&format!(
            "  paper \"{}\" (id {})\n",
            sanitize_title_for_prelude(&paper.title),
            short_id(&paper.id)
        ));
        // Suppress the per-paper format/entrypoint line when it duplicates the
        // global one — the only case where the per-paper view adds nothing.
        // Multi-paper bundles still surface it because each paper can carry
        // its own entrypoint.
        let duplicates_global =
            single_paper && per_paper_format == format && per_paper_entrypoint == entrypoint;
        if !duplicates_global {
            s.push_str(&format!(
                "    format: {}, entrypoint: {}\n",
                if per_paper_format.is_empty() { "(unknown)" } else { per_paper_format },
                if per_paper_entrypoint.is_empty() {
                    "(unknown)".to_string()
                } else {
                    per_paper_entrypoint
                }
            ));
        }
        if let Some(pdf) = paper.pdf.as_ref() {
            let t = Instant::now();
            let status = pdf_sha_status(project_root, &pdf.rel_path, &pdf.sha256);
            *sha256_ms = sha256_ms.saturating_add(t.elapsed().as_millis());
            s.push_str(&format!("    pdf: {} (sha256 {})\n", pdf.rel_path, status));
        }
    }

    // Hint table: signals that affect the workflow. Rigor itself is opt-in by
    // mode choice — sweeps are NOT gated on a substantive-block count. The
    // model decides per phase whether the actual content yields anything to
    // emit (a coherence-sweep that finds no drift emits zero blocks; that's
    // correct, and very different from never running).
    if all_source {
        s.push_str("\nSkip-condition signals (the orchestrator's contract):\n");
        s.push_str("- locating-spans: source-only — the pdf/html fuzzy fallback does not run\n");
    }
    s
}

fn short_id(id: &str) -> String {
    let head: String = id.chars().take(8).collect();
    format!("{head}…")
}

// Belt-and-braces: bundle-builder already refuses titles with the OBELUS
// delimiters or C0/DEL control chars at export time. We re-sanitize at the
// prelude boundary so a future ingestion path that bypasses the builder can't
// forge a second prelude line via embedded newlines, and so non-ASCII glyphs
// surrounded by " stay quoted on a single line.
fn sanitize_title_for_prelude(title: &str) -> String {
    let mut out = String::with_capacity(title.len());
    for ch in title.chars() {
        if ch == '"' {
            out.push_str("\\\"");
        } else if ch == '\t' {
            out.push(' ');
        } else if ch.is_control() {
            // Drop newlines and other C0/DEL — never let them survive into the
            // line-oriented prelude.
            continue;
        } else {
            out.push(ch);
        }
    }
    out
}

// Compiled validator, cached for the process lifetime. The schema artifact at
// `<plugin>/schemas/bundle.schema.json` is the same JSON the plugin enforces;
// reading it from the desktop side keeps both surfaces in lockstep without a
// generator step. The first call pays the parse + compile cost (a few ms);
// subsequent calls reuse the compiled validator.
static SCHEMA_VALIDATOR: OnceLock<Result<Validator, String>> = OnceLock::new();

fn get_or_compile_validator(plugin_dir: &Path) -> Result<&'static Validator, String> {
    let cell = SCHEMA_VALIDATOR.get_or_init(|| {
        let path = plugin_dir.join("schemas").join("bundle.schema.json");
        let body = std::fs::read_to_string(&path)
            .map_err(|e| format!("read schema {}: {e}", path.display()))?;
        let schema: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| format!("parse schema {}: {e}", path.display()))?;
        jsonschema::draft202012::new(&schema)
            .map_err(|e| format!("compile schema: {e}"))
    });
    match cell {
        Ok(v) => Ok(v),
        Err(e) => Err(e.clone()),
    }
}

// Validate the bundle JSON against the pinned JSON Schema. Returns up to the
// first 3 human-readable error strings so the desktop can surface them without
// flooding the UI. The 3-error cap mirrors the plugin's apply-revision
// halt-condition table — three reasons is enough to act on, the rest are
// usually downstream of the first.
pub fn validate_bundle_against_schema(
    bundle_json: &serde_json::Value,
    plugin_dir: &Path,
) -> Result<(), Vec<String>> {
    let validator = match get_or_compile_validator(plugin_dir) {
        Ok(v) => v,
        Err(e) => return Err(vec![format!("schema unavailable: {e}")]),
    };
    let errors: Vec<String> = validator
        .iter_errors(bundle_json)
        .take(3)
        .map(|err| format!("{err} (at {})", err.instance_path()))
        .collect();
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
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
              "main": "chapters/00-abstract.typ",
              "files": [
                {"relPath": "chapters/00-abstract.typ", "format": "typ"},
                {"relPath": "chapters/01-intro.typ", "format": "typ"},
                {"relPath": "refs.bib", "format": "bib"}
              ]
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
        let plugin = tmp.path().join("plugin");
        let (out, _stats, _t) =
            build_prelude_with_metrics(&path, tmp.path(), &plugin, Mode::WriterFast).unwrap();
        assert!(out.contains("- format: typst"));
        assert!(out.contains("- entrypoint: chapters/00-abstract.typ"));
        assert!(out.contains("- papers: 1, annotations: 2"));
        // Two source-anchored marks at L12 and L80 in the same file: their
        // ±50 windows are [1..62] and [30..130] respectively; merged.
        assert!(out.contains("chapters/00-abstract.typ:[1-130]"), "got: {out}");
        // Whole-paper read list filters to source formats only — `refs.bib`
        // must not appear; both .typ chapters must.
        assert!(out.contains("chapters/00-abstract.typ\n"), "got: {out}");
        assert!(out.contains("chapters/01-intro.typ\n"), "got: {out}");
        assert!(!out.contains("refs.bib"), "got: {out}");
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
        let plugin = tmp.path().join("plugin");
        let (out, stats, _t) =
            build_prelude_with_metrics(&path, tmp.path(), &plugin, Mode::Rigorous).unwrap();
        // WS3 bundle-stats: histogram numbers from `compute_bundle_stats`
        // must agree with the histogram printed in the rigorous prelude body.
        assert_eq!(stats.papers, 1);
        assert_eq!(stats.annotations, 3);
        assert_eq!(stats.anchor_source, 2);
        assert_eq!(stats.anchor_pdf, 1);
        assert_eq!(stats.anchor_html, 0);
        assert!(out.contains("- bundle-validated: true"), "got: {out}");
        assert!(out.contains("- format: latex"));
        assert!(out.contains("- substantive blocks: 1 (excluding 1 praise, 1 aside, 0 flag)"));
        assert!(out.contains("- anchor-kind histogram: source=2, pdf=1, html=0"));
        // `all-source-anchored` was removed from the prelude; it's derivable
        // from the histogram (pdf==0 && html==0).
        assert!(!out.contains("all-source-anchored"), "got: {out}");
        assert!(out.contains("- has-rubric: false"));
        // Rigorous mode never gates sweeps on a substantive-mark count, so the
        // prelude must NOT emit any "skipped because substantive < N" lines.
        assert!(!out.contains("coherence-sweep: skipped"), "got: {out}");
        assert!(!out.contains("quality-sweep: skipped"), "got: {out}");
        // The plan-fix path is given so the model doesn't have to Glob-hunt
        // for it. Resolved against the plugin dir argument.
        let expected = plugin.join("skills").join("plan-fix").join("SKILL.md");
        assert!(
            out.contains(&format!("- plan-fix skill: {}", expected.display())),
            "got: {out}"
        );
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

    // The validator is cached behind a `OnceLock`, so the first test that
    // initialises it pins the schema for the whole process. Both validator
    // tests stage the same schema artifact (the one shipped with the plugin)
    // into their temp dirs — the cache key is the schema body, not the path,
    // so subsequent calls reuse the validator regardless of which test wins
    // the race.
    fn stage_real_schema(plugin_dir: &Path) {
        let schemas = plugin_dir.join("schemas");
        std::fs::create_dir_all(&schemas).unwrap();
        let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../packages/claude-plugin/schemas/bundle.schema.json");
        std::fs::copy(&src, schemas.join("bundle.schema.json")).unwrap_or_else(|e| {
            panic!("copy schema from {}: {e}", src.display());
        });
    }

    #[test]
    fn validate_bundle_against_schema_accepts_known_good_bundle() {
        let tmp = tempfile::tempdir().unwrap();
        let plugin = tmp.path().join("plugin");
        stage_real_schema(&plugin);
        // Mirrors the shape of `packages/claude-plugin/fixtures/sample/bundle.json`
        // but trimmed to the minimum required by the schema.
        let bundle: serde_json::Value = serde_json::json!({
            "bundleVersion": "1.0",
            "tool": { "name": "obelus", "version": "0.1.0" },
            "project": {
                "id": "11111111-1111-4111-8111-111111111111",
                "label": "x",
                "kind": "writer",
                "categories": [{ "slug": "unclear", "label": "unclear" }]
            },
            "papers": [{
                "id": "22222222-2222-4222-8222-222222222222",
                "title": "T",
                "revision": 1,
                "createdAt": "2026-04-19T00:00:00.000Z"
            }],
            "annotations": []
        });
        validate_bundle_against_schema(&bundle, &plugin)
            .expect("known-good bundle should validate");
    }

    #[test]
    fn validate_bundle_against_schema_rejects_missing_bundle_version() {
        let tmp = tempfile::tempdir().unwrap();
        let plugin = tmp.path().join("plugin");
        stage_real_schema(&plugin);
        let bundle: serde_json::Value = serde_json::json!({
            "tool": { "name": "obelus", "version": "0.1.0" },
            "project": {
                "id": "11111111-1111-4111-8111-111111111111",
                "label": "x",
                "kind": "writer",
                "categories": [{ "slug": "unclear", "label": "unclear" }]
            },
            "papers": [{
                "id": "22222222-2222-4222-8222-222222222222",
                "title": "T",
                "revision": 1,
                "createdAt": "2026-04-19T00:00:00.000Z"
            }],
            "annotations": []
        });
        let errors = validate_bundle_against_schema(&bundle, &plugin)
            .expect_err("bundle missing bundleVersion should fail validation");
        assert!(!errors.is_empty(), "expected at least one error");
        assert!(errors.len() <= 3, "errors capped at 3, got {}", errors.len());
        assert!(
            errors.iter().any(|e| e.contains("bundleVersion")),
            "expected an error mentioning bundleVersion; got {errors:?}",
        );
    }
}
