// Compiles a .typ source file to PDF via the user's installed `typst` CLI.
// The rendered PDF is written as a sibling of the source — `main.typ` →
// `main.pdf` in the same directory — matching the Typst CLI convention. The
// reviewer's PDF viewer is almost always already pointing at that sibling
// path, so a successful compile overwrites the file they're reviewing.

use crate::commands::fs_scoped::{atomic_write, is_descendant, resolve, resolve_for_write, root_path_for};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::Serialize;
use std::path::PathBuf;
use std::process::Stdio;
use tauri::State;
use tokio::process::Command;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TypstCompileReport {
    pub output_rel_path: String,
    pub stderr: String,
}

fn pdf_rel_for(source_rel: &str) -> String {
    let trimmed = source_rel.trim_end_matches('/');
    match trimmed.rsplit_once('.') {
        Some((stem, ext)) if ext.eq_ignore_ascii_case("typ") => format!("{stem}.pdf"),
        _ => format!("{trimmed}.pdf"),
    }
}

fn locate_typst() -> Option<PathBuf> {
    which::which("typst").ok()
}

#[tauri::command]
pub async fn compile_typst(
    root_id: String,
    rel_path: String,
    state: State<'_, AppState>,
) -> AppResult<TypstCompileReport> {
    let typst = locate_typst()
        .ok_or_else(|| AppError::Other("typst binary not found on PATH".into()))?;

    let input_abs = resolve(&root_id, &rel_path, &state)?;
    let root_abs = root_path_for(&root_id, &state)?;
    // `resolve` already canonicalizes + checks descendance, but re-assert before
    // spawning an external process: defense-in-depth against symlink-swap races
    // between canonicalize() and spawn.
    if !is_descendant(&input_abs, &root_abs) {
        return Err(AppError::OutOfScope);
    }
    let output_rel = pdf_rel_for(&rel_path);
    let output_abs = resolve_for_write(&root_id, &output_rel, &state).await?;

    let mut cmd = Command::new(&typst);
    cmd.arg("compile")
        .arg("--root")
        .arg(&root_abs)
        .arg(&input_abs)
        .arg(&output_abs)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let output = cmd
        .output()
        .await
        .map_err(|e| AppError::Other(format!("typst spawn: {e}")))?;

    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    if !output.status.success() {
        return Err(AppError::Other(if stderr.trim().is_empty() {
            format!("typst exited with code {:?}", output.status.code())
        } else {
            stderr
        }));
    }

    // `typst compile` writes the file itself, but we re-read + atomic-write to
    // ensure the final PDF lands via the same fsync + rename path as every
    // other on-disk artefact the app produces.
    let bytes = tokio::fs::read(&output_abs).await.map_err(AppError::from)?;
    atomic_write(&output_abs, &bytes).await?;

    Ok(TypstCompileReport {
        output_rel_path: output_rel,
        stderr,
    })
}

#[cfg(test)]
mod tests {
    use super::pdf_rel_for;

    #[test]
    fn pdf_rel_replaces_typ_extension() {
        assert_eq!(pdf_rel_for("main.typ"), "main.pdf");
        assert_eq!(pdf_rel_for("chapters/intro.typ"), "chapters/intro.pdf");
    }

    #[test]
    fn pdf_rel_preserves_directory_structure() {
        assert_eq!(pdf_rel_for("a/b/c/paper.typ"), "a/b/c/paper.pdf");
    }

    #[test]
    fn pdf_rel_handles_non_typ_extension_gracefully() {
        assert_eq!(pdf_rel_for("notes.md"), "notes.md.pdf");
    }
}
