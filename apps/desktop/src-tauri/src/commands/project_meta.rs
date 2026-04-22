// Project-metadata scanner. Walks the project root, classifies each file into a
// `ProjectFileFormat`, picks a heuristic "main" when the caller did not pin one,
// and mirrors the result to `<project-root>/.obelus/project.json` so the Claude
// Code plugin can read it without going through the desktop app.
//
// The scanner is intentionally separate from `history::walk_tracked`: history
// owns a narrow text-only allowlist (blobs stay small), whereas project
// metadata wants a broader view (PDFs, class files, assets) that downstream
// tools actually need to reason about.

use crate::commands::fs_scoped::{atomic_write, root_path_for};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::State;

const PROJECT_META_VERSION: u32 = 1;

fn is_excluded_dir(name: &str) -> bool {
    if name.starts_with('.') {
        return true;
    }
    matches!(
        name,
        "node_modules" | "out" | "dist" | "build" | "target" | "__pycache__"
    )
}

fn classify_extension(rel: &str) -> &'static str {
    let ext = Path::new(rel)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "tex" => "tex",
        "md" | "markdown" => "md",
        "typ" => "typ",
        "bib" => "bib",
        "cls" => "cls",
        "sty" => "sty",
        "bst" => "bst",
        "pdf" => "pdf",
        "yml" | "yaml" => "yml",
        "json" => "json",
        "txt" => "txt",
        _ => "other",
    }
}

fn role_for(rel: &str, format: &str) -> Option<&'static str> {
    match format {
        "bib" => Some("bib"),
        "cls" | "sty" | "bst" => Some("include"),
        "pdf" => Some("asset"),
        _ => {
            if rel.ends_with("/figures") || rel.contains("/figures/") || rel.contains("/images/") {
                Some("asset")
            } else {
                None
            }
        }
    }
}

fn mtime_ms_of(metadata: &std::fs::Metadata) -> i64 {
    metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScannedFile {
    pub rel_path: String,
    pub format: String,
    pub role: Option<String>,
    pub size: u64,
    pub mtime_ms: i64,
}

async fn walk_project(root: &Path) -> AppResult<Vec<ScannedFile>> {
    let mut out: Vec<ScannedFile> = Vec::new();
    let mut stack: Vec<PathBuf> = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let mut rd = tokio::fs::read_dir(&dir).await.map_err(AppError::from)?;
        while let Some(entry) = rd.next_entry().await.map_err(AppError::from)? {
            let file_type = match entry.file_type().await {
                Ok(ft) => ft,
                Err(_) => continue,
            };
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if file_type.is_dir() {
                if is_excluded_dir(&name_str) {
                    continue;
                }
                stack.push(entry.path());
            } else if file_type.is_file() {
                let path = entry.path();
                let rel = match path.strip_prefix(root) {
                    Ok(r) => r.to_string_lossy().replace('\\', "/"),
                    Err(_) => continue,
                };
                let format = classify_extension(&rel);
                if format == "other" {
                    continue;
                }
                let role = role_for(&rel, format).map(str::to_string);
                let std_meta = match std::fs::metadata(&path) {
                    Ok(m) => m,
                    Err(_) => continue,
                };
                out.push(ScannedFile {
                    rel_path: rel,
                    format: format.to_string(),
                    role,
                    size: std_meta.len(),
                    mtime_ms: mtime_ms_of(&std_meta),
                });
            }
        }
    }
    out.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
    Ok(out)
}

fn depth_of(rel: &str) -> usize {
    rel.split('/').count().saturating_sub(1)
}

fn score_tex_candidate(rel: &str) -> i64 {
    // Lower is better.
    let base = Path::new(rel)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    let mut score = (depth_of(rel) as i64) * 100;
    score += rel.len() as i64;
    if base == "main.tex" {
        score -= 10_000;
    } else if base == "paper.tex" {
        score -= 9_000;
    } else if base == "manuscript.tex" {
        score -= 8_000;
    } else if base == "thesis.tex" {
        score -= 7_000;
    }
    score
}

fn score_typ_candidate(rel: &str) -> i64 {
    let base = Path::new(rel)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    let mut score = (depth_of(rel) as i64) * 100;
    score += rel.len() as i64;
    if base == "main.typ" {
        score -= 10_000;
    } else if base == "paper.typ" {
        score -= 9_000;
    } else if base == "report.typ" {
        score -= 8_000;
    }
    score
}

fn score_md_candidate(rel: &str, size: u64) -> i64 {
    let base = Path::new(rel)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    // Skip obvious non-manuscript markdown.
    let is_chrome = matches!(
        base.to_ascii_lowercase().as_str(),
        "readme.md" | "changelog.md" | "license.md" | "contributing.md" | "code_of_conduct.md",
    );
    let mut score = (depth_of(rel) as i64) * 100;
    // Larger files score lower (better). Cap contribution so depth still matters.
    score -= (size.min(1_000_000) as i64) / 1024;
    if is_chrome {
        score += 1_000_000;
    }
    if base == "paper.md" {
        score -= 10_000;
    } else if base == "manuscript.md" {
        score -= 9_000;
    }
    score
}

async fn file_contains(abs: &Path, needle: &str, max_bytes: usize) -> bool {
    let bytes = match tokio::fs::read(abs).await {
        Ok(b) => b,
        Err(_) => return false,
    };
    let slice = if bytes.len() > max_bytes {
        &bytes[..max_bytes]
    } else {
        &bytes[..]
    };
    match std::str::from_utf8(slice) {
        Ok(text) => text.contains(needle),
        Err(_) => false,
    }
}

async fn detect_main(root: &Path, files: &[ScannedFile]) -> (Option<String>, Option<String>) {
    // Returns (format, main_rel_path). Prefers the format whose best candidate
    // actually signals a document entrypoint; ties broken by most recent mtime.

    async fn best_tex(root: &Path, files: &[ScannedFile]) -> Option<(String, i64)> {
        let mut best: Option<(String, i64)> = None;
        for f in files.iter().filter(|f| f.format == "tex") {
            let abs = root.join(&f.rel_path);
            if !file_contains(&abs, r"\documentclass", 32 * 1024).await {
                continue;
            }
            let score = score_tex_candidate(&f.rel_path);
            match best {
                Some((_, bs)) if bs <= score => {}
                _ => best = Some((f.rel_path.clone(), score)),
            }
        }
        best
    }

    async fn best_typ(root: &Path, files: &[ScannedFile]) -> Option<(String, i64)> {
        let mut best: Option<(String, i64)> = None;
        for f in files.iter().filter(|f| f.format == "typ") {
            let abs = root.join(&f.rel_path);
            let has_doc = file_contains(&abs, "#set document(", 32 * 1024).await
                || file_contains(&abs, "#show:", 32 * 1024).await;
            if !has_doc {
                continue;
            }
            let score = score_typ_candidate(&f.rel_path);
            match best {
                Some((_, bs)) if bs <= score => {}
                _ => best = Some((f.rel_path.clone(), score)),
            }
        }
        best
    }

    fn best_md(files: &[ScannedFile]) -> Option<(String, i64)> {
        let mut best: Option<(String, i64)> = None;
        for f in files.iter().filter(|f| f.format == "md") {
            let score = score_md_candidate(&f.rel_path, f.size);
            if score >= 900_000 {
                continue;
            }
            match best {
                Some((_, bs)) if bs <= score => {}
                _ => best = Some((f.rel_path.clone(), score)),
            }
        }
        best
    }

    let tex = best_tex(root, files).await;
    let typ = best_typ(root, files).await;
    let md = best_md(files);

    let mut winners: Vec<(&'static str, String, i64, i64)> = Vec::new();
    if let Some((rel, score)) = tex {
        let mtime = files
            .iter()
            .find(|f| f.rel_path == rel)
            .map(|f| f.mtime_ms)
            .unwrap_or(0);
        winners.push(("tex", rel, score, mtime));
    }
    if let Some((rel, score)) = typ {
        let mtime = files
            .iter()
            .find(|f| f.rel_path == rel)
            .map(|f| f.mtime_ms)
            .unwrap_or(0);
        winners.push(("typ", rel, score, mtime));
    }
    if let Some((rel, score)) = md {
        let mtime = files
            .iter()
            .find(|f| f.rel_path == rel)
            .map(|f| f.mtime_ms)
            .unwrap_or(0);
        winners.push(("md", rel, score, mtime));
    }

    // Pick the most recently modified candidate to break format ties; within a
    // single format this collapses to the sole winner.
    let Some((fmt, rel, _, _)) = winners.into_iter().max_by_key(|w| w.3) else {
        return (None, None);
    };
    (Some(fmt.to_string()), Some(rel))
}

fn default_compiler_for(format: &str) -> Option<&'static str> {
    match format {
        "tex" => Some("latexmk"),
        "md" => Some("pandoc"),
        "typ" => Some("typst"),
        _ => None,
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct DiskMetaFile {
    rel_path: String,
    format: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    role: Option<String>,
    size: u64,
    mtime_ms: i64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct DiskMetaCompile {
    compiler: Option<String>,
    args: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    output_rel_dir: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct DiskMeta {
    version: u32,
    project_id: String,
    label: String,
    kind: String,
    format: Option<String>,
    main: Option<String>,
    main_is_pinned: bool,
    compile: DiskMetaCompile,
    files: Vec<DiskMetaFile>,
    scanned_at: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProjectScanReport {
    pub project_id: String,
    pub format: Option<String>,
    pub main_rel_path: Option<String>,
    pub main_is_pinned: bool,
    pub compiler: Option<String>,
    pub files: Vec<ScannedFile>,
    pub scanned_at: String,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProjectScanInput {
    pub project_id: String,
    pub label: String,
    pub kind: String,
    pub pinned_main_rel_path: Option<String>,
    pub scanned_at: String,
}

#[tauri::command]
pub async fn project_scan(
    root_id: String,
    input: ProjectScanInput,
    state: State<'_, AppState>,
) -> AppResult<ProjectScanReport> {
    let root = root_path_for(&root_id, &state)?;
    if !root.is_dir() {
        return Err(AppError::NotADirectory);
    }

    let files = walk_project(&root).await?;
    let (detected_format, detected_main) = detect_main(&root, &files).await;

    let (main_rel_path, main_is_pinned) = match &input.pinned_main_rel_path {
        Some(pinned) if !pinned.is_empty() => (Some(pinned.clone()), true),
        _ => (detected_main, false),
    };

    let effective_format: Option<String> = match &main_rel_path {
        Some(rel) => match classify_extension(rel) {
            "tex" => Some("tex".into()),
            "md" => Some("md".into()),
            "typ" => Some("typ".into()),
            _ => detected_format.clone(),
        },
        None => detected_format.clone(),
    };

    let compiler = effective_format
        .as_deref()
        .and_then(default_compiler_for)
        .map(str::to_string);

    let scanned_at = input.scanned_at.clone();

    let disk_meta = DiskMeta {
        version: PROJECT_META_VERSION,
        project_id: input.project_id.clone(),
        label: input.label.clone(),
        kind: input.kind.clone(),
        format: effective_format.clone(),
        main: main_rel_path.clone(),
        main_is_pinned,
        compile: DiskMetaCompile {
            compiler: compiler.clone(),
            args: Vec::new(),
            output_rel_dir: None,
        },
        files: files
            .iter()
            .map(|f| DiskMetaFile {
                rel_path: f.rel_path.clone(),
                format: f.format.clone(),
                role: f.role.clone(),
                size: f.size,
                mtime_ms: f.mtime_ms,
            })
            .collect(),
        scanned_at: scanned_at.clone(),
    };

    let meta_path = root.join(".obelus").join("project.json");
    if let Some(parent) = meta_path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(AppError::from)?;
    }
    let body = serde_json::to_vec_pretty(&disk_meta)
        .map_err(|e| AppError::Apply(format!("project.json serialize: {e}")))?;
    atomic_write(&meta_path, &body).await?;

    Ok(ProjectScanReport {
        project_id: input.project_id,
        format: effective_format,
        main_rel_path,
        main_is_pinned,
        compiler,
        files,
        scanned_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    async fn write(path: &Path, body: &str) {
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await.unwrap();
        }
        tokio::fs::write(path, body).await.unwrap();
    }

    #[tokio::test]
    async fn detects_main_tex_via_documentclass() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        write(
            &root.join("main.tex"),
            r"\documentclass{article}\begin{document}hi\end{document}",
        )
        .await;
        write(&root.join("helper.tex"), "\\section{util}").await;
        write(&root.join("refs.bib"), "@book{a,title={A}}").await;
        let files = walk_project(&root).await.unwrap();
        let (fmt, main) = detect_main(&root, &files).await;
        assert_eq!(fmt.as_deref(), Some("tex"));
        assert_eq!(main.as_deref(), Some("main.tex"));
    }

    #[tokio::test]
    async fn walk_skips_noise_dirs_and_classifies_bib() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        write(&root.join("paper.tex"), "\\documentclass{article}").await;
        write(&root.join("refs.bib"), "@book{a}").await;
        write(&root.join("node_modules/junk.md"), "no").await;
        let files = walk_project(&root).await.unwrap();
        let rels: Vec<_> = files.iter().map(|f| f.rel_path.as_str()).collect();
        assert!(rels.contains(&"paper.tex"));
        assert!(rels.contains(&"refs.bib"));
        assert!(!rels.iter().any(|r| r.starts_with("node_modules/")));
        let bib = files.iter().find(|f| f.rel_path == "refs.bib").unwrap();
        assert_eq!(bib.format, "bib");
        assert_eq!(bib.role.as_deref(), Some("bib"));
    }
}
