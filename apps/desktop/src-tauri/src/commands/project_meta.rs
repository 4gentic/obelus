// Project-metadata scanner. Walks the project root, classifies each file into a
// `ProjectFileFormat`, picks a heuristic "main" when the caller did not pin
// one, and mirrors the result to the project's app-data workspace as
// `project.json` so the Claude Code plugin can read it without going through
// the desktop app.
//
// The scanner is intentionally separate from `history::walk_tracked`: history
// owns a narrow text-only allowlist (blobs stay small), whereas project
// metadata wants a broader view (PDFs, class files, assets) that downstream
// tools actually need to reason about.

use crate::commands::fs_scoped::{atomic_write, root_path_for};
use crate::commands::workspace::workspace_dir_for;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, State};

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

// Filename is intentionally not a signal here — a `notes.tex` carrying
// `\documentclass` is more authoritative than a `main.tex` that doesn't, and
// we refuse to guess based on names. Within a format, ties break by depth
// (shallower wins) then by path length (shorter wins).
fn score_candidate(rel: &str) -> i64 {
    (depth_of(rel) as i64) * 100 + rel.len() as i64
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
    // Returns (format, main_rel_path). A candidate qualifies only when its
    // content carries a document-entrypoint marker — `\documentclass` for
    // .tex, `#set document(` or `#show:` for .typ. Markdown has no analogous
    // signal and is therefore not auto-detected; the user pins via the ★
    // button on the file row when reviewing a markdown manuscript.
    //
    // When both .tex and .typ candidates exist, ties break by most recent
    // mtime (the file the user has been editing).

    async fn best_tex(root: &Path, files: &[ScannedFile]) -> Option<(String, i64)> {
        let mut best: Option<(String, i64)> = None;
        for f in files.iter().filter(|f| f.format == "tex") {
            let abs = root.join(&f.rel_path);
            if !file_contains(&abs, r"\documentclass", 32 * 1024).await {
                continue;
            }
            let score = score_candidate(&f.rel_path);
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
            let score = score_candidate(&f.rel_path);
            match best {
                Some((_, bs)) if bs <= score => {}
                _ => best = Some((f.rel_path.clone(), score)),
            }
        }
        best
    }

    let tex = best_tex(root, files).await;
    let typ = best_typ(root, files).await;

    let mut winners: Vec<(&'static str, String, i64)> = Vec::new();
    if let Some((rel, _)) = tex {
        let mtime = files
            .iter()
            .find(|f| f.rel_path == rel)
            .map(|f| f.mtime_ms)
            .unwrap_or(0);
        winners.push(("tex", rel, mtime));
    }
    if let Some((rel, _)) = typ {
        let mtime = files
            .iter()
            .find(|f| f.rel_path == rel)
            .map(|f| f.mtime_ms)
            .unwrap_or(0);
        winners.push(("typ", rel, mtime));
    }

    let Some((fmt, rel, _)) = winners.into_iter().max_by_key(|w| w.2) else {
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
    app: AppHandle,
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

    let workspace = workspace_dir_for(&app, &input.project_id)?;
    tokio::fs::create_dir_all(&workspace).await.map_err(AppError::from)?;
    let meta_path = workspace.join("project.json");
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
    async fn content_beats_filename_for_tex() {
        // A non-canonical name that carries the marker must win over a
        // canonical name that doesn't. Filenames are not a signal.
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        write(&root.join("main.tex"), "\\section{not the entrypoint}").await;
        write(
            &root.join("notes.tex"),
            r"\documentclass{article}\begin{document}hi\end{document}",
        )
        .await;
        let files = walk_project(&root).await.unwrap();
        let (fmt, main) = detect_main(&root, &files).await;
        assert_eq!(fmt.as_deref(), Some("tex"));
        assert_eq!(main.as_deref(), Some("notes.tex"));
    }

    #[tokio::test]
    async fn detects_main_typ_via_set_document() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        write(&root.join("notes.typ"), "#set document(title: \"x\")\n= Hi").await;
        write(&root.join("snippet.typ"), "= just a heading").await;
        let files = walk_project(&root).await.unwrap();
        let (fmt, main) = detect_main(&root, &files).await;
        assert_eq!(fmt.as_deref(), Some("typ"));
        assert_eq!(main.as_deref(), Some("notes.typ"));
    }

    #[tokio::test]
    async fn markdown_is_never_auto_detected() {
        // Markdown carries no entrypoint signal; we refuse to guess. Even with
        // a single .md present, detect_main returns None — the user must pin.
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        write(&root.join("paper.md"), "# Title\n\nbody").await;
        let files = walk_project(&root).await.unwrap();
        let (fmt, main) = detect_main(&root, &files).await;
        assert_eq!(fmt, None);
        assert_eq!(main, None);
    }

    #[tokio::test]
    async fn no_main_when_no_file_carries_marker() {
        // Tex / typ files exist but neither carries its entrypoint marker —
        // detection must abstain rather than fall back to a name guess.
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        write(&root.join("main.tex"), "\\section{partial}").await;
        write(&root.join("paper.typ"), "= a heading\nplain prose").await;
        let files = walk_project(&root).await.unwrap();
        let (fmt, main) = detect_main(&root, &files).await;
        assert_eq!(fmt, None);
        assert_eq!(main, None);
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
