// Compiles a .tex source file to PDF via the user's installed `latexmk`.
// The rendered PDF is written as a sibling of the source — `main.tex` →
// `main.pdf` in the same directory — matching the Typst command's convention
// so the reviewer's PDF viewer (almost always already pointing at that sibling
// path) refreshes onto the freshly-written bytes.
//
// latexmk orchestrates the multi-pass + bibtex/biber dance that every direct
// `pdflatex` / `xelatex` invocation would have to re-implement. The enum
// carried in `paper_build.compiler` therefore maps onto a latexmk engine
// flag rather than a separate binary.

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
pub struct LatexCompileReport {
    pub output_rel_path: String,
    pub stderr: String,
}

fn pdf_rel_for(source_rel: &str) -> String {
    let trimmed = source_rel.trim_end_matches('/');
    match trimmed.rsplit_once('.') {
        Some((stem, ext)) if ext.eq_ignore_ascii_case("tex") => format!("{stem}.pdf"),
        _ => format!("{trimmed}.pdf"),
    }
}

fn locate_latexmk() -> Option<PathBuf> {
    which::which("latexmk").ok()
}

fn engine_flag_for(compiler: &str) -> &'static str {
    match compiler {
        "xelatex" => "-xelatex",
        _ => "-pdf",
    }
}

// LaTeX tooling writes most diagnostics to stdout, not stderr. Surface the
// last N lines so "! Undefined control sequence" and its neighbours reach the
// error banner without drowning it in font-warning chatter.
fn tail_lines(buf: &str, n: usize) -> String {
    let lines: Vec<&str> = buf.lines().collect();
    if lines.len() <= n {
        return buf.to_owned();
    }
    lines[lines.len() - n..].join("\n")
}

#[tauri::command]
pub async fn compile_latex(
    root_id: String,
    rel_path: String,
    compiler: String,
    state: State<'_, AppState>,
) -> AppResult<LatexCompileReport> {
    let latexmk = locate_latexmk()
        .ok_or_else(|| AppError::Other("latexmk binary not found on PATH".into()))?;

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

    let (source_parent, input_name) = input_abs
        .parent()
        .zip(input_abs.file_name())
        .ok_or_else(|| AppError::Other("source path is not a regular file".into()))?;

    let mut cmd = Command::new(&latexmk);
    cmd.arg(engine_flag_for(&compiler))
        .arg("-interaction=nonstopmode")
        .arg("-halt-on-error")
        .arg("-file-line-error")
        .arg(input_name)
        .current_dir(source_parent)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let output = cmd
        .output()
        .await
        .map_err(|e| AppError::Other(format!("latexmk spawn: {e}")))?;

    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();

    if !output.status.success() {
        let mut combined = String::new();
        if !stdout.trim().is_empty() {
            combined.push_str(&tail_lines(&stdout, 40));
        }
        if !stderr.trim().is_empty() {
            if !combined.is_empty() {
                combined.push('\n');
            }
            combined.push_str(&tail_lines(&stderr, 40));
        }
        let msg = if combined.trim().is_empty() {
            format!("latexmk exited with code {:?}", output.status.code())
        } else {
            combined
        };
        return Err(AppError::Other(msg));
    }

    // `latexmk` writes the file itself; re-read + atomic-write so the final
    // PDF lands via the same fsync + rename path as every other on-disk
    // artefact the app produces.
    let bytes = tokio::fs::read(&output_abs).await.map_err(AppError::from)?;
    atomic_write(&output_abs, &bytes).await?;

    Ok(LatexCompileReport {
        output_rel_path: output_rel,
        stderr,
    })
}

#[cfg(test)]
mod tests {
    use super::{engine_flag_for, pdf_rel_for, tail_lines};

    #[test]
    fn pdf_rel_replaces_tex_extension() {
        assert_eq!(pdf_rel_for("main.tex"), "main.pdf");
        assert_eq!(pdf_rel_for("chapters/intro.tex"), "chapters/intro.pdf");
    }

    #[test]
    fn pdf_rel_preserves_directory_structure() {
        assert_eq!(pdf_rel_for("a/b/c/paper.tex"), "a/b/c/paper.pdf");
    }

    #[test]
    fn pdf_rel_handles_non_tex_extension_gracefully() {
        assert_eq!(pdf_rel_for("notes.md"), "notes.md.pdf");
    }

    #[test]
    fn engine_flag_maps_xelatex_and_default() {
        assert_eq!(engine_flag_for("xelatex"), "-xelatex");
        assert_eq!(engine_flag_for("latexmk"), "-pdf");
        assert_eq!(engine_flag_for("pdflatex"), "-pdf");
    }

    #[test]
    fn tail_lines_returns_last_n() {
        let text = (1..=10).map(|n| n.to_string()).collect::<Vec<_>>().join("\n");
        assert_eq!(tail_lines(&text, 3), "8\n9\n10");
    }

    #[test]
    fn tail_lines_returns_whole_string_when_short() {
        assert_eq!(tail_lines("a\nb", 5), "a\nb");
    }
}
